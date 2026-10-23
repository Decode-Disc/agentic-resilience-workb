import type { DataModel, Doc, Id } from "@convex/_generated/dataModel";
import { MAX_HISTORICAL_SOURCE_CANDIDATES } from "@convex/resourceLimits";
import type { GenericDatabaseReader } from "convex/server";
import { ConvexError, v } from "convex/values";
import { SOURCE_QUALIFICATION_VERSION } from "./sourceQualification";

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
) {
    const preparation = await db.get(args.preparationId);
    if (
        preparation?.kind !== "preparation" ||
        preparation.status !== "started" ||
        preparation.qualificationVersion !== SOURCE_QUALIFICATION_VERSION ||
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
        run.executionStatus !== "running" ||
        run.lifecycleState !== expectedLifecycle ||
        run.executionGeneration !== preparation.executionGeneration ||
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
    },
) {
    const source = await db.get(args.sourceId);
    if (!source || source.runId !== args.runId)
        throw sourcePreparationError("source_not_owned");
    const head = await db
        .query("sourceReviewItems")
        .withIndex("by_revision_and_source", (q) =>
            q
                .eq("corpusRevisionId", args.corpusRevisionId)
                .eq("sourceId", source._id),
        )
        .unique();
    const decision = head
        ? await db.get(head.latestDecisionId)
        : await db
              .query("sourceDecisions")
              .withIndex("by_revision_source_and_occurred_at", (q) =>
                  q
                      .eq("corpusRevisionId", args.corpusRevisionId)
                      .eq("sourceId", source._id),
              )
              .order("desc")
              .first();
    if (
        head &&
        (!decision ||
            head.runId !== args.runId ||
            decision.runId !== args.runId ||
            decision.sourceId !== source._id ||
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
    if (
        (state.preparation.deadlineAt ?? 0) <= args.now ||
        state.preparation.leaseExpiresAt <= args.now
    )
        throw sourcePreparationError("stale_execution");
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
    v.literal("missing_configuration"),
    v.literal("paid_work_disabled"),
    v.literal("access_unavailable"),
    v.literal("transport_unavailable"),
    v.literal("request_invalid"),
    v.literal("model_attempt_limit_reached"),
);
