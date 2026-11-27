import type { DataModel, Doc, Id } from "@convex/_generated/dataModel";
import {
    preparationMaxConcurrency,
    preparationModelLimits,
} from "@convex/resourceLimits";
import {
    LEGACY_PREPARATION_MODEL_ATTEMPT_LIMIT,
    MAX_HISTORICAL_SOURCE_CANDIDATES,
    PREPARATION_RECOVERY_COOLDOWN_MS,
    RESOURCE_POLICY_VERSION,
} from "@convex/resourcePolicy";
import type { GenericDatabaseReader } from "convex/server";
import { ConvexError, type Infer, v } from "convex/values";
import { isExecutableQualificationVersion } from "./sourceQualification";
import {
    isResumableResearchPause,
    isSourcesSettlementPause,
} from "./transitions";

/** Preparation journal protocol identity, not a resource allowance. */
export const SOURCE_PREPARATION_SOURCE_ACTIONS_VERSION = "source_actions_v4";
export const SOURCE_PREPARATION_EXECUTION_PLAN_VERSION =
    SOURCE_PREPARATION_SOURCE_ACTIONS_VERSION;

/** The preparation model operations that own a one-shot visible output stream. */
export const ONE_SHOT_PREPARATION_OPERATIONS = [
    "source_qualification",
    "source_comparison",
    "source_documentary_control",
] as const;

export function isOneShotPreparationOperation(operation: string) {
    return ONE_SHOT_PREPARATION_OPERATIONS.some((value) => value === operation);
}

/** Transport facts emitted at send and response boundaries. */
export type ObserveProviderDispatch = (
    outcome: "unknown" | "response_received",
) => void;

export const preparationDispatchOutcomeValidator = v.union(
    v.literal("not_dispatched"),
    v.literal("response_received"),
    v.literal("unknown"),
);

export const sourcePreparationExecutionPlanValidator = v.union(
    v.literal("collect_then_compare_v1"),
    v.literal("inline_controls_v2"),
    v.literal("source_actions_v3"),
    v.literal(SOURCE_PREPARATION_SOURCE_ACTIONS_VERSION),
);

/** Both versions retain the same source-action workflow; v4 changes structured model contracts. */
export function usesSourceActions(version: string | undefined): boolean {
    return (
        version === "source_actions_v3" ||
        version === SOURCE_PREPARATION_SOURCE_ACTIONS_VERSION
    );
}

export const sourcePreparationPhaseValidator = v.union(
    v.literal("reading"),
    v.literal("comparison"),
    v.literal("supplement"),
    v.literal("proposal"),
);

export const sourcePreparationProgressValidator = v.object({
    phase: sourcePreparationPhaseValidator,
    current: v.optional(v.number()),
    total: v.optional(v.number()),
    updatedAt: v.number(),
});
export const MAX_PREPARATION_ATTEMPT_HISTORY =
    MAX_HISTORICAL_SOURCE_CANDIDATES + 4;

/** Accepts provider seconds or an HTTP date without renewing allowance. */
export function providerRetryAfterAt(
    value: string | null,
    now: number,
): number | undefined {
    if (!value?.trim()) return undefined;
    const seconds = Number(value);
    const date = Number.isFinite(seconds)
        ? seconds >= 0
            ? now + seconds * 1000
            : NaN
        : Date.parse(value);
    return Number.isSafeInteger(date) ? Math.max(now, date) : undefined;
}

export const preparationModelLimitsValidator = v.object({
    work: v.number(),
    incidents: v.number(),
});

export const structuredOutputPolicyValidator = v.object({
    version: v.string(),
    maxConsecutiveWhitespace: v.number(),
});

export const PREPARATION_BUDGET_VERSION = 2;
export const preparationBudgetValidator = v.object({
    version: v.literal(PREPARATION_BUDGET_VERSION),
    work: v.number(),
    incidents: v.number(),
    reserved: v.number(),
    dispatches: v.number(),
});

type PreparationBudget = Infer<typeof preparationBudgetValidator>;
type PreparationAttemptObservation = Pick<
    Doc<"providerCalls">,
    "status" | "errorCode" | "dispatchOutcome" | "httpStatus"
> &
    Partial<
        Pick<
            Doc<"providerCalls">,
            | "service"
            | "operation"
            | "providerObservation"
            | "billing"
            | "invocationId"
        >
    >;

/** A received valid response is productive; ambiguity retains both possible charges. */
export function preparationBudgetOutcome(
    call: PreparationAttemptObservation,
): "work" | "incidents" | "reserved" | "released" {
    const kind = preparationFailureClass(call);
    if (kind === "not_dispatched") return "released";
    if (kind === "succeeded") return "work";
    if (kind === "unknown") return "reserved";
    return "incidents";
}

/** Legacy receipts are bounded by their original envelope; unexplained consumption stays reserved. */
export async function readPreparationBudget(
    db: GenericDatabaseReader<DataModel>,
    run: Doc<"researchRuns">,
    preparation?: Doc<"sourceSelectionProposalRebuilds">,
): Promise<PreparationBudget> {
    if (run.sourcePreparationBudget) return run.sourcePreparationBudget;
    const histories = await Promise.all(
        (["source_qualification", "source_comparison"] as const).map(
            (operation) =>
                db
                    .query("providerCalls")
                    .withIndex("by_run_operation_input_and_attempt", (q) =>
                        q.eq("runId", run._id).eq("operation", operation),
                    )
                    .take(LEGACY_PREPARATION_MODEL_ATTEMPT_LIMIT + 1),
        ),
    );
    const budget: PreparationBudget = {
        version: PREPARATION_BUDGET_VERSION,
        work: 0,
        incidents: 0,
        reserved: 0,
        dispatches: 0,
    };
    for (const call of histories.flat()) {
        const outcome = preparationBudgetOutcome(call);
        if (outcome === "released") continue;
        budget.dispatches++;
        budget[
            call.inputHash && /^[a-f0-9]{64}$/.test(call.inputHash)
                ? outcome
                : "reserved"
        ]++;
    }
    const unexplained = Math.max(
        0,
        Math.max(
            run.sourceQualificationAttemptCount ?? 0,
            preparation?.modelAttemptCount ?? 0,
            // Without the cumulative counter, a clipped read can conceal the entire legacy envelope.
            run.sourceQualificationAttemptCount === undefined &&
                histories.some(
                    (calls) =>
                        calls.length > LEGACY_PREPARATION_MODEL_ATTEMPT_LIMIT,
                )
                ? LEGACY_PREPARATION_MODEL_ATTEMPT_LIMIT
                : 0,
        ) - budget.dispatches,
    );
    budget.reserved += unexplained;
    budget.dispatches += unexplained;
    return budget;
}

/** Both review and dispatch admission use the same conservative remaining capacity. */
export function preparationBudgetBlock(
    budget: PreparationBudget,
    limits: Infer<typeof preparationModelLimitsValidator>,
) {
    if (budget.work + budget.reserved >= limits.work)
        return "work_budget_exhausted" as const;
    if (budget.incidents + budget.reserved >= limits.incidents)
        return "incident_budget_exhausted" as const;
    if (budget.dispatches >= limits.work + limits.incidents)
        return "model_attempt_limit_reached" as const;
    return undefined;
}

/** Active executions retain their snapshot; a new explicit execution reads current configuration. */
export function readPreparationLimits(
    preparation?: Doc<"sourceSelectionProposalRebuilds">,
) {
    if (preparation?.modelLimits) return preparation.modelLimits;
    try {
        return preparationModelLimits();
    } catch {
        throw sourcePreparationError("preparation_configuration_invalid");
    }
}

/** Historical journals retain two; only a new explicit execution adopts configuration. */
export function readPreparationConcurrency(
    preparation?: Doc<"sourceSelectionProposalRebuilds">,
) {
    if (preparation) return preparation.maxConcurrentSources ?? 2;
    try {
        return preparationMaxConcurrency();
    } catch {
        throw sourcePreparationError("preparation_configuration_invalid");
    }
}

/** A retry flag alone cannot prove that a dispatched request returned a failure. */
export function preparationFailureClass(call: PreparationAttemptObservation) {
    if (
        call.dispatchOutcome === "not_dispatched" ||
        ["missing_configuration", "paid_work_disabled"].includes(
            call.errorCode ?? "",
        )
    )
        return "not_dispatched";
    if (call.status === "succeeded" || call.status === "partial")
        return "succeeded";
    if (
        call.status === "failed" &&
        call.service === "model" &&
        call.operation &&
        call.invocationId &&
        isOneShotPreparationOperation(call.operation) &&
        (call.errorCode === "invalid_output" ||
            call.errorCode === "structured_output_whitespace" ||
            call.errorCode === "structured_result_unavailable" ||
            call.errorCode === "request_timeout")
    )
        return call.providerObservation?.termination
            ? "invalid_output"
            : "unknown";
    if (
        [
            "request_timeout",
            "cancelled",
            "attempt_outcome_unknown",
            "network_error",
            "TypeError",
            "SecTimeoutError",
            "ExaLogicalTimeoutError",
        ].includes(call.errorCode ?? "")
    )
        return "unknown";
    if (call.dispatchOutcome === "response_received") {
        if ([408, 429, 500, 502, 503, 504].includes(call.httpStatus ?? 0))
            return "transient";
        if (call.errorCode === "invalid_output") return "invalid_output";
        return "terminal";
    }
    if (call.errorCode === "invalid_output") return "invalid_output";
    if (/^http_(408|429|500|502|503|504)$/.test(call.errorCode ?? ""))
        return "transient";
    if (
        [
            "access_unavailable",
            "request_invalid",
            "response_too_large",
            "invalid_local_result",
        ].includes(call.errorCode ?? "")
    )
        return "terminal";
    return "unknown";
}

/** Selects the next lifetime attempt; explicit recovery never renews an input's allowance. */
export function nextPreparationAttempt(
    calls: Doc<"providerCalls">[],
    preparation: Pick<
        Doc<"sourceSelectionProposalRebuilds">,
        "resumesPreparationId" | "createdAt"
    > & { _id?: Id<"sourceSelectionProposalRebuilds"> },
    now: number,
    initialAttempts = 2,
): { attempt?: number; errorCode?: string; retryAt?: number } {
    const dispatched = calls.filter(
        (c) => preparationFailureClass(c) !== "not_dispatched",
    );
    const last = [...dispatched].sort((a, b) => b.attempt - a.attempt)[0];
    if (!last)
        return calls.length >= MAX_PREPARATION_ATTEMPT_HISTORY
            ? { errorCode: "attempt_history_limit_reached" }
            : { attempt: 1 };
    const kind = preparationFailureClass(last);
    if (kind === "succeeded") return { errorCode: "result_already_recorded" };
    if (kind === "unknown") return { errorCode: "attempt_outcome_unknown" };
    if (calls.some((call) => call.billing?.state === "conflict"))
        return { errorCode: "billing_conflict" };
    if (kind === "terminal")
        return { errorCode: last.errorCode ?? "terminal_failure" };
    const modelOperation = [
        "source_qualification",
        "source_comparison",
    ].includes(last.operation);
    if (!modelOperation && last.attempt >= initialAttempts + 1)
        return { errorCode: "recovery_attempt_exhausted" };
    if ((last.retryAfterAt ?? 0) > now)
        return { errorCode: "recovery_cooldown", retryAt: last.retryAfterAt };
    if (last.preparationId !== preparation._id) {
        if (
            !preparation.resumesPreparationId ||
            (preparation._id &&
                (last.completedAt ?? Infinity) > preparation.createdAt)
        )
            return { errorCode: "explicit_recovery_required" };
        const retryAt = Math.max(
            (last.completedAt ?? last.createdAt) +
                PREPARATION_RECOVERY_COOLDOWN_MS,
            last.retryAfterAt ?? 0,
        );
        if (now < retryAt) return { errorCode: "recovery_cooldown", retryAt };
    } else if (last.attempt >= initialAttempts)
        return { errorCode: "explicit_recovery_required" };
    return { attempt: last.attempt + 1 };
}

export function sourcePreparationError(code: string) {
    return new ConvexError({ area: "source_preparation", code });
}

/** Reads only application-owned failure codes; raw provider errors never become UI copy. */
export function preparationFailureCode(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null || !("data" in error))
        return undefined;
    const data = error.data;
    if (
        typeof data !== "object" ||
        data === null ||
        !("area" in data) ||
        data.area !== "source_preparation" ||
        !("code" in data)
    )
        return undefined;
    return typeof data.code === "string" ? data.code : undefined;
}

/** Preparation authority is distinct from the accepted-decision fence for analytical evidence. */
async function readCurrentPreparation(
    db: GenericDatabaseReader<DataModel>,
    args: {
        preparationId: Id<"sourceSelectionProposalRebuilds">;
        sourceId?: Id<"sources">;
    },
    mode: "execution" | "observation" | "settlement" = "execution",
) {
    const preparation = await db.get(args.preparationId);
    if (
        preparation?.kind !== "preparation" ||
        preparation.status !== "started" ||
        !preparation.qualificationVersion ||
        !isExecutableQualificationVersion(preparation.qualificationVersion) ||
        preparation.deadlineAt === undefined
    ) {
        throw sourcePreparationError("stale_execution");
    }
    const run = await db.get(preparation.runId);
    const revision = await db.get(preparation.corpusRevisionId);
    const visitor = run?.ownerVisitorId
        ? await db.get(run.ownerVisitorId)
        : null;
    const invitation = visitor ? await db.get(visitor.invitationId) : null;
    const pausedObservation =
        mode !== "execution" &&
        run?.agentExecutionVersion === 3 &&
        (mode === "observation"
            ? isResumableResearchPause(run)
            : isSourcesSettlementPause(run)) &&
        run.executionGeneration === preparation.executionGeneration + 1;
    const expectedLifecycle =
        preparation.entryPoint === "initial_discovery"
            ? "discovering_sources"
            : "awaiting_source_review";
    if (
        !run ||
        !revision ||
        !visitor ||
        visitor.status !== "active" ||
        invitation?.status !== "claimed" ||
        invitation.claimedByVisitorId !== visitor._id ||
        (run.executionStatus !== "running" && !pausedObservation) ||
        run.lifecycleState !== expectedLifecycle ||
        (run.executionGeneration !== preparation.executionGeneration &&
            !pausedObservation) ||
        run.sourcePreparationId !== preparation._id ||
        run.activeCorpusRevisionId !== revision._id ||
        revision.runId !== run._id ||
        revision.status !== "draft" ||
        (run.workflowVersion ?? 1) !== preparation.workflowVersion
    ) {
        throw sourcePreparationError("stale_execution");
    }
    const readingScope =
        preparation.readingSourceIds ?? preparation.manualSourceIds;
    if (args.sourceId && readingScope && !readingScope.includes(args.sourceId))
        throw sourcePreparationError("source_outside_preparation");
    if (
        args.sourceId &&
        (await readPreparationSourceDecision(db, {
            runId: run._id,
            corpusRevisionId: revision._id,
            sourceId: args.sourceId,
        })) === "rejected"
    )
        throw sourcePreparationError("source_rejected");
    return { preparation, run, revision, visitor };
}

/** Shares source-decision validation between execution fences and preparation completion. */
export async function readPreparationSourceDecision(
    db: GenericDatabaseReader<DataModel>,
    args: {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        sourceId: Id<"sources">;
        allowMissingSourceMetadata?: boolean;
    },
) {
    const source = await db.get(args.sourceId);
    if (
        (source && source.runId !== args.runId) ||
        (!source && !args.allowMissingSourceMetadata)
    )
        throw sourcePreparationError("source_not_owned");
    const head = await db
        .query("sourceReviewItems")
        .withIndex("by_revision_and_source", (q) =>
            q
                .eq("corpusRevisionId", args.corpusRevisionId)
                .eq("sourceId", args.sourceId),
        )
        .unique();
    const decision = head
        ? await db.get(head.latestDecisionId)
        : await db
              .query("sourceDecisions")
              .withIndex("by_revision_source_and_occurred_at", (q) =>
                  q
                      .eq("corpusRevisionId", args.corpusRevisionId)
                      .eq("sourceId", args.sourceId),
              )
              .order("desc")
              .first();
    if (
        head &&
        (!decision ||
            head.runId !== args.runId ||
            decision.runId !== args.runId ||
            decision.sourceId !== args.sourceId ||
            decision.corpusRevisionId !== args.corpusRevisionId ||
            decision.decision !== head.decision)
    ) {
        throw sourcePreparationError("source_decision_invalid");
    }
    return decision?.decision ?? "pending";
}

/** Resolves the bounded preparation scope and current exclusions for both batching and completion. */
export async function readEligiblePreparationSourceIds(
    db: GenericDatabaseReader<DataModel>,
    preparation: Doc<"sourceSelectionProposalRebuilds">,
): Promise<Id<"sources">[]> {
    const readingScope =
        preparation.readingSourceIds ?? preparation.manualSourceIds;
    const candidates = readingScope
        ? await Promise.all(readingScope.map((id) => db.get(id)))
        : await db
              .query("sources")
              .withIndex("by_run_and_url", (q) =>
                  q.eq("runId", preparation.runId),
              )
              .take(MAX_HISTORICAL_SOURCE_CANDIDATES + 1);
    if (candidates.length > MAX_HISTORICAL_SOURCE_CANDIDATES)
        throw sourcePreparationError("preparation_scope_invalid");
    const eligible: Id<"sources">[] = [];
    for (const source of candidates) {
        if (!source || source.runId !== preparation.runId)
            throw sourcePreparationError("source_not_owned");
        if (
            (await readPreparationSourceDecision(db, {
                runId: preparation.runId,
                corpusRevisionId: preparation.corpusRevisionId,
                sourceId: source._id,
            })) !== "rejected"
        )
            eligible.push(source._id);
    }
    return eligible;
}

/** An engaged operation may retain its observation during the analyst pause; this grants no I/O or progression. */
export async function assertPreparationObservationFence(
    db: GenericDatabaseReader<DataModel>,
    args: {
        preparationId: Id<"sourceSelectionProposalRebuilds">;
        sourceId?: Id<"sources">;
    },
) {
    return readCurrentPreparation(db, args, "observation");
}

/** Expiry stops I/O while the unchanged generation can still produce a partial review. */
export async function assertPreparationExecutionFence(
    db: GenericDatabaseReader<DataModel>,
    args: {
        preparationId: Id<"sourceSelectionProposalRebuilds">;
        sourceId?: Id<"sources">;
        now: number;
    },
) {
    const state = await readCurrentPreparation(db, args);
    if (state.preparation.resourcePolicy !== RESOURCE_POLICY_VERSION)
        throw sourcePreparationError("resource_policy_unsupported");
    if (
        (state.preparation.deadlineAt ?? 0) <= args.now ||
        state.preparation.leaseExpiresAt <= args.now
    )
        throw sourcePreparationError("stale_execution");
    return state;
}

/** Settling retained material dispatches nothing, so the paid-work deadline and lease never block it; currency, authority and cancellation still do. */
export async function assertPreparationSettlementFence(
    db: GenericDatabaseReader<DataModel>,
    args: { preparationId: Id<"sourceSelectionProposalRebuilds"> },
) {
    const state = await readCurrentPreparation(db, args, "settlement");
    if (state.preparation.resourcePolicy !== RESOURCE_POLICY_VERSION)
        throw sourcePreparationError("resource_policy_unsupported");
    return state;
}

/** Comparisons can reuse earlier proposal pins after new targeted content arrives, without reopening retrieval or qualification. */
export async function assertPreparationComparisonFence(
    db: GenericDatabaseReader<DataModel>,
    args: {
        preparationId: Id<"sourceSelectionProposalRebuilds">;
        sourceId: Id<"sources">;
        sourceCaptureId?: Id<"sourceCaptures">;
        qualificationTaskId?: Id<"aiTaskResults">;
        now: number;
    },
) {
    const state = await assertPreparationExecutionFence(db, {
        preparationId: args.preparationId,
        now: args.now,
    });
    const scope =
        state.preparation.readingSourceIds ?? state.preparation.manualSourceIds;
    if (scope && !scope.includes(args.sourceId)) {
        const proposalId =
            state.preparation.target &&
            state.preparation.readingSourceIds?.length
                ? state.preparation.expectedProposalId
                : undefined;
        const pinned = proposalId
            ? await db
                  .query("sourceSelectionProposalItems")
                  .withIndex("by_proposal_and_source", (q) =>
                      q
                          .eq("proposalId", proposalId)
                          .eq("sourceId", args.sourceId),
                  )
                  .unique()
            : null;
        if (
            !pinned?.sourceCaptureId ||
            !pinned.qualificationTaskId ||
            pinned.runId !== state.run._id ||
            (args.sourceCaptureId &&
                pinned.sourceCaptureId !== args.sourceCaptureId) ||
            (args.qualificationTaskId &&
                pinned.qualificationTaskId !== args.qualificationTaskId)
        )
            throw sourcePreparationError("source_outside_preparation");
    }
    if (
        (await readPreparationSourceDecision(db, {
            runId: state.run._id,
            corpusRevisionId: state.revision._id,
            sourceId: args.sourceId,
        })) === "rejected"
    )
        throw sourcePreparationError("source_rejected");
    return state;
}

export async function assertPreparationCompletionFence(
    db: GenericDatabaseReader<DataModel>,
    args: { preparationId: Id<"sourceSelectionProposalRebuilds"> },
) {
    return readCurrentPreparation(db, args);
}

export const sourcePreparationOutcomeValidator = v.object({
    sourceId: v.id("sources"),
    result: v.union(
        v.object({
            status: v.literal("qualified"),
            sourceCaptureId: v.id("sourceCaptures"),
            taskId: v.id("aiTaskResults"),
        }),
        v.object({
            status: v.literal("unavailable"),
            sourceCaptureId: v.optional(v.id("sourceCaptures")),
            reasonCode: v.string(),
        }),
    ),
});

export const sourcePreparationStopCodeValidator = v.union(
    v.literal("cancelled"),
    v.literal("execution_slot_unavailable"),
    v.literal("preparation_failed"),
    v.literal("execution_expired"),
    v.literal("missing_configuration"),
    v.literal("paid_work_disabled"),
    v.literal("access_unavailable"),
    v.literal("transport_unavailable"),
    v.literal("request_invalid"),
    v.literal("model_attempt_limit_reached"),
    v.literal("work_budget_exhausted"),
    v.literal("incident_budget_exhausted"),
);
