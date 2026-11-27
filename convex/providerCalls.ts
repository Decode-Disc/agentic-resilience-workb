import { requireSourcesAcquisitionRequest } from "@convex/domain/documentaryAccess";
import {
    RESPONSE_CONTROL_LIMITS,
    responseReviewOperationKey,
} from "@convex/domain/workbenchResponseControlContracts";
import {
    isOneShotPreparationOperation,
    operationHasStarted,
    ownsScheduledEpoch,
} from "@convex/execution/executionProtocol";
import { resolveReasoningPreference } from "@convex/integrations/modelRouting";
import { readResponseControlPolicy } from "@convex/modelConfiguration";
import {
    assertQualificationAllowance,
    patchQualificationReceipt,
    qualificationCategory,
    qualificationModelReservationUsd,
    updateQualificationUsage,
} from "@convex/qualificationUsage";
import {
    framingProviderInputHash,
    framingSecReadInput,
    requirePublicContextRequest,
} from "@convex/workbenchPublicContext";
import { ConvexError, type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
    internalMutation,
    internalQuery,
    type MutationCtx,
    mutation,
    type QueryCtx,
} from "./_generated/server";
import { requireAdmin } from "./administrationAuthority";
import { assertEvidenceExecutionFence } from "./domain/evidenceAuthority";
import { manualSourceIntakeError } from "./domain/manualSourceIntake";
import {
    readSupplementalSearchAttempts,
    supplementalSearchInputHash,
    supplementalSearchOperationKey,
} from "./domain/sourceDiscoveryRecovery";
import { sha256Hex, stableStringify } from "./domain/sourcePassages";
import {
    assertPreparationComparisonFence,
    assertPreparationExecutionFence,
    MAX_PREPARATION_ATTEMPT_HISTORY,
    nextPreparationAttempt,
    preparationBudgetBlock,
    preparationDispatchOutcomeValidator,
    preparationFailureClass,
    readPreparationBudget,
    readPreparationLimits,
    sourcePreparationError,
} from "./domain/sourcePreparationAuthority";
import {
    executionError,
    publicationControl,
    requireMissionAuthority,
} from "./execution/authority";
import { admittedInputHash } from "./execution/journal";
import { preparationModelOutputLimit } from "./integrations/modelRouting";
import { rateLimiter } from "./rateLimiter";
import {
    BILLING_LOOKUP_LEASE_MS as BILLING_LEASE_MS,
    MAX_CONCURRENT_SOURCE_EMBEDDING_CALLS,
    MAX_EXA_TEXT_CHARACTERS,
    MAX_PREPARATION_DIAGNOSTIC_BYTES,
    MAX_SOURCE_EMBEDDING_ATTEMPTS,
    MAX_SOURCE_EMBEDDING_BATCH_TEXTS,
    MAX_SOURCE_EMBEDDING_INPUT_BYTES,
    MAX_SOURCE_EMBEDDING_TEXT_BYTES,
    MAX_SOURCES_QUALIFICATION_RECEIPTS,
    MODEL_SETTLEMENT_GRACE_MS,
    IO_PROVIDER_LEASE_MS as PROVIDER_LEASE_MS,
    SOURCE_EMBEDDING_PROVIDER_LEASE_MS,
    SOURCES_MAX_EVIDENCE_REFERENCES,
    supportsStructuredOutputPolicy,
} from "./resourcePolicy";
import {
    readWorkbenchQualification,
    readWorkbenchQualificationDeadline,
} from "./runWorkspace";
import schema, { providerStreamTerminationValidator } from "./schema";

/** Known observations settle independently; only qualification-funded results carry this adoption deadline. */
export async function requireQualificationResultDeadline(
    ctx: QueryCtx,
    receipt: Doc<"providerCalls">,
) {
    if (receipt.qualificationReservationUsd === undefined) return;
    const run = receipt.runId ? await ctx.db.get(receipt.runId) : null;
    const deadlineAt = run
        ? await readWorkbenchQualificationDeadline(ctx, run)
        : undefined;
    if (deadlineAt === undefined) throw executionError("not_authorized");
    if (deadlineAt <= Date.now()) throw executionError("execution_deadline");
}

async function requireBrowserQualification(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
) {
    if (run.purpose !== "browser_test") return null;
    const qualification = await readWorkbenchQualification(ctx, run);
    const control = await ctx.db
        .query("paidWorkControls")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .unique();
    if (!qualification || control?.enabled === false)
        throw sourcePreparationError("paid_work_disabled");
    return qualification;
}

/** The same qualification authority is required at reservation and immediately before external dispatch. */
export async function requireQualifiedBrowserMission(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
    mission: Doc<"agentMissions"> | null,
    preparationId?: Id<"sourceSelectionProposalRebuilds">,
) {
    const qualification = await requireBrowserQualification(ctx, run);
    if (!qualification) return null;
    const sourcesModelRevisionId =
        qualification.sourcesModelRevisionId ?? qualification.modelRevisionId;
    if (mission) {
        if (
            mission.runId !== run._id ||
            mission.modelRevisionId !==
                (mission.definitionId === "sources_v1"
                    ? sourcesModelRevisionId
                    : qualification.modelRevisionId) ||
            !(
                qualification.sourcesLot
                    ? ["workbench_v1", "workbench_v2", "sources_v1"]
                    : ["workbench_v1"]
            ).includes(mission.definitionId)
        )
            throw sourcePreparationError("paid_work_disabled");
    } else {
        const preparation = preparationId
            ? await ctx.db.get(preparationId)
            : null;
        if (
            !qualification.sourcesLot ||
            !preparation?.sourcesMission ||
            preparation.runId !== run._id ||
            preparation.modelRevisionId !== sourcesModelRevisionId
        )
            throw sourcePreparationError("paid_work_disabled");
    }
    if (qualification.reasoningSelection) {
        const role =
            !mission || mission.definitionId === "sources_v1"
                ? "sources"
                : "workbench";
        const model = await ctx.db.get(
            role === "sources"
                ? sourcesModelRevisionId
                : qualification.modelRevisionId,
        );
        if (
            !model ||
            (mission?.reasoningEffort ?? model.reasoningEffort) !==
                resolveReasoningPreference(
                    model.descriptor,
                    qualification.reasoningSelection[role],
                )
        )
            throw sourcePreparationError("paid_work_disabled");
    }
    return qualification;
}

const serviceValidator = v.union(
    v.literal("model"),
    v.literal("sec"),
    v.literal("exa"),
    v.literal("url_metadata"),
    v.literal("pdf"),
);
const providerCallStatusValidator = v.union(
    v.literal("started"),
    v.literal("succeeded"),
    v.literal("partial"),
    v.literal("failed"),
);

/** Factual response identity survives an interrupted stream without settling its outcome. */
export const observeGeneration = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        generationId: v.optional(v.string()),
        httpStatus: v.optional(v.number()),
        requestId: v.optional(v.string()),
        diagnostic:
            schema.tables.providerCalls.validator.fields.transportDiagnostic,
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const call = await invocationCall(ctx, args.invocationId);
        if (
            (args.generationId !== undefined &&
                !/^[\w.:-]{1,256}$/.test(args.generationId)) ||
            (args.requestId !== undefined &&
                !/^[\w.:-]{1,256}$/.test(args.requestId)) ||
            (args.httpStatus !== undefined &&
                (!Number.isInteger(args.httpStatus) ||
                    args.httpStatus < 100 ||
                    args.httpStatus > 599)) ||
            (args.generationId === undefined &&
                args.httpStatus === undefined &&
                args.requestId === undefined &&
                args.diagnostic === undefined)
        )
            throw new Error("Invalid provider observation");
        if (call.providerObservation?.generationId && args.generationId) {
            if (call.providerObservation.generationId !== args.generationId)
                throw new Error("Provider generation identity changed");
        }
        await patchQualificationReceipt(ctx, call, {
            providerObservation: {
                ...call.providerObservation,
                ...(args.generationId
                    ? { generationId: args.generationId }
                    : {}),
                ...(args.httpStatus !== undefined
                    ? { httpStatus: args.httpStatus }
                    : {}),
                ...(args.requestId ? { requestId: args.requestId } : {}),
                observedAt: call.providerObservation?.observedAt ?? Date.now(),
            },
            ...(args.diagnostic
                ? {
                      transportDiagnostic:
                          call.transportDiagnostic ?? args.diagnostic,
                  }
                : {}),
        });
        if (
            args.generationId &&
            !call.providerObservation?.generationId &&
            call.operationEpoch !== undefined
        )
            await ctx.runMutation(internal.providerCalls.requestBilling, {
                invocationId: args.invocationId,
            });
        return null;
    },
});

async function invocationCall(
    ctx: QueryCtx | MutationCtx,
    invocationId: Id<"agentInvocations">,
) {
    const invocation = await ctx.db.get(invocationId);
    const call = invocation?.providerCallId
        ? await ctx.db.get(invocation.providerCallId)
        : null;
    const request = await ctx.db
        .query("agentInvocationPayloads")
        .withIndex("by_invocation_and_part", (q) =>
            q.eq("invocationId", invocationId).eq("part", "request"),
        )
        .unique();
    if (
        !call ||
        !invocation ||
        invocation.provenance !== "live" ||
        request?.state !== "complete" ||
        call.service !== "model" ||
        call.invocationId !== invocation._id ||
        call.inputHash !==
            (invocation.preparationInputHash ??
                admittedInputHash(invocation)) ||
        (invocation.preparationInputHash !== undefined &&
            (invocation.missionId !== undefined ||
                !call.preparationId ||
                call.operationKey !== invocation.taskKey ||
                call.corpusRevisionId !== invocation.corpusRevisionId)) ||
        call.executionGeneration !== invocation.generation ||
        call.missionId !== invocation.missionId ||
        call.runId !== invocation.runId
    )
        throw new Error("Invalid provider observation");
    return call;
}

const billingResult = v.object({ scheduled: v.boolean() });
const billingReason =
    schema.tables.providerCalls.validator.fields.billing.fields.reason;

function reportedCostSettlement(
    call: Doc<"providerCalls">,
    cost: number | undefined,
    observation?: Pick<
        Infer<typeof providerAttemptValidator>,
        "status" | "dispatchOutcome"
    >,
) {
    if (cost !== undefined && (!Number.isFinite(cost) || cost < 0))
        throw new Error("Invalid provider cost");
    if (
        cost !== undefined &&
        call.reportedCost !== undefined &&
        Math.abs(call.reportedCost - cost) > 1e-12
    ) {
        return {
            reportedCost: call.reportedCost,
            billing: {
                state: "conflict" as const,
                reason: "amount_conflict" as const,
                attempt: call.billing?.attempt ?? 0,
                updatedAt: Date.now(),
            },
        };
    }
    return {
        reportedCost: call.reportedCost ?? cost,
        reportedCostFinal:
            call.reportedCostFinal === true ||
            (cost !== undefined &&
                observation !== undefined &&
                observation.status !== "partial" &&
                (observation.dispatchOutcome === "response_received" ||
                    observation.status === "succeeded")),
    };
}

function hasUnresolvedStructuredTermination(call: Doc<"providerCalls">) {
    return (
        call.service === "model" &&
        isOneShotPreparationOperation(call.operation) &&
        call.providerObservation?.termination === undefined
    );
}

async function structuredBillingOwner(
    ctx: QueryCtx,
    call: Doc<"providerCalls">,
) {
    if (
        call.operationEpoch === undefined ||
        !call.operationRequestId ||
        call.executionGeneration === undefined ||
        !hasUnresolvedStructuredTermination(call)
    )
        return null;
    const request = await ctx.db.get(call.operationRequestId);
    if (
        !request?.runId ||
        request.status !== "waiting" ||
        request.outcome ||
        !ownsScheduledEpoch(
            request,
            call.executionGeneration,
            call.operationEpoch,
        )
    )
        return null;
    const mission = request.missionId
        ? await ctx.db.get(request.missionId)
        : null;
    const deadlineAt = Math.min(
        request.deadlineAt ?? Infinity,
        mission?.deadlineAt ?? Infinity,
    );
    const run = await ctx.db.get(request.runId);
    if (
        !run ||
        run.withdrawnAt ||
        !["paused", "running"].includes(run.executionStatus) ||
        !Number.isFinite(deadlineAt) ||
        deadlineAt <= Date.now()
    )
        return null;
    return { request, deadlineAt };
}

/** Only the original admitted call can request accounting; this grants no execution authority. */
export const requestBilling = internalMutation({
    args: { invocationId: v.id("agentInvocations") },
    returns: v.null(),
    handler: async (ctx, args) => {
        if ((await publicationControl(ctx))?.held) return null;
        const invocation = await ctx.db.get(args.invocationId);
        if (!invocation?.providerCallId) return null;
        const call = await ctx.db.get(invocation.providerCallId);
        if (
            !call?.providerObservation?.generationId ||
            call.billing ||
            (!hasUnresolvedStructuredTermination(call) &&
                (call.reportedCost !== undefined ||
                    call.status === "succeeded"))
        )
            return null;
        await invocationCall(ctx, args.invocationId);
        const wakeId = await ctx.scheduler.runAfter(
            5000,
            internal.integrations.openRouterGeneration.reconcile,
            { providerCallId: call._id, attempt: 1 },
        );
        await patchQualificationReceipt(ctx, call, {
            billing: {
                state: "pending",
                attempt: 0,
                updatedAt: Date.now(),
                retryAt: Date.now() + BILLING_LEASE_MS,
                wakeId,
            },
        });
        return null;
    },
});

/** Explicit administrator recovery reads accounting only, never repeats model inference. */
export const retryBilling = mutation({
    args: { providerCallId: v.id("providerCalls") },
    returns: billingResult,
    handler: async (ctx, args) => {
        await requireAdmin(ctx);
        if ((await publicationControl(ctx))?.held) return { scheduled: false };
        const call = await ctx.db.get(args.providerCallId);
        if (!call?.invocationId) return { scheduled: false };
        await invocationCall(ctx, call.invocationId);
        if (
            !call.providerObservation?.generationId ||
            !call.billing ||
            !["pending", "unavailable", "checking"].includes(
                call.billing.state,
            ) ||
            Date.now() < (call.billing.retryAt ?? Infinity)
        )
            return { scheduled: false };
        await patchQualificationReceipt(ctx, call, {
            billing: {
                state: "pending",
                attempt: call.billing.attempt,
                updatedAt: Date.now(),
                retryAt: Date.now() + BILLING_LEASE_MS,
            },
        });
        await ctx.scheduler.runAfter(
            0,
            internal.integrations.openRouterGeneration.reconcile,
            { providerCallId: call._id, attempt: call.billing.attempt + 1 },
        );
        return { scheduled: true };
    },
});

export const claimBilling = internalMutation({
    args: { providerCallId: v.id("providerCalls"), attempt: v.number() },
    returns: v.union(v.object({ generationId: v.string() }), v.null()),
    handler: async (ctx, args) => {
        if ((await publicationControl(ctx))?.held) return null;
        const call = await ctx.db.get(args.providerCallId);
        if (
            !call?.invocationId ||
            !call.providerObservation?.generationId ||
            !call.billing ||
            call.billing.attempt + 1 !== args.attempt
        )
            return null;
        const owner = await structuredBillingOwner(ctx, call);
        if (
            call.billing.state !== "pending" &&
            (!owner ||
                !["checking", "unavailable", "confirmed"].includes(
                    call.billing.state,
                ) ||
                (call.billing.retryAt ?? Infinity) > Date.now())
        )
            return null;
        await invocationCall(ctx, call.invocationId);
        if (
            call.reportedCost !== undefined &&
            !hasUnresolvedStructuredTermination(call)
        ) {
            await patchQualificationReceipt(ctx, call, {
                billing: {
                    state: "confirmed",
                    attempt: call.billing.attempt,
                    updatedAt: Date.now(),
                },
            });
            return null;
        }
        const retryAt = Date.now() + BILLING_LEASE_MS;
        const wakeId =
            owner && retryAt < owner.deadlineAt
                ? await ctx.scheduler.runAt(
                      retryAt,
                      internal.integrations.openRouterGeneration.reconcile,
                      {
                          providerCallId: call._id,
                          attempt: args.attempt + 1,
                      },
                  )
                : undefined;
        await patchQualificationReceipt(ctx, call, {
            // A new termination lookup must preserve the prior lookup's confirmed price.
            ...(call.billing.state === "confirmed" &&
            call.reportedCost !== undefined
                ? { reportedCostFinal: true }
                : {}),
            billing: {
                state: "checking",
                attempt: args.attempt,
                updatedAt: Date.now(),
                retryAt,
                wakeId,
            },
        });
        return { generationId: call.providerObservation.generationId };
    },
});

export const settleBilling = internalMutation({
    args: {
        providerCallId: v.id("providerCalls"),
        attempt: v.number(),
        generationId: v.string(),
        cancelled: v.optional(v.literal(true)),
        cost: v.optional(v.number()),
        reason: billingReason,
        httpStatus: v.optional(v.number()),
        latencyMs: v.optional(v.number()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const call = await ctx.db.get(args.providerCallId);
        if (
            !call?.invocationId ||
            call.billing?.state !== "checking" ||
            call.billing.attempt !== args.attempt ||
            call.providerObservation?.generationId !== args.generationId
        )
            return null;
        await invocationCall(ctx, call.invocationId);
        if ((args.cost === undefined) === (args.reason === undefined))
            throw new Error("Invalid billing result");
        const owner = await structuredBillingOwner(ctx, call);
        const retryAt = call.billing.retryAt ?? Date.now() + BILLING_LEASE_MS;
        const reschedule =
            owner && !args.cancelled && retryAt < owner.deadlineAt;
        if (!reschedule && call.billing.wakeId)
            await ctx.scheduler.cancel(call.billing.wakeId);
        await patchQualificationReceipt(ctx, call, {
            billing: {
                state: args.cost !== undefined ? "confirmed" : "unavailable",
                attempt: args.attempt,
                updatedAt: Date.now(),
                httpStatus: args.httpStatus,
                latencyMs: args.latencyMs,
                ...(args.reason ? { reason: args.reason } : {}),
                ...(args.reason || reschedule ? { retryAt } : {}),
                ...(reschedule ? { wakeId: call.billing.wakeId } : {}),
            },
            ...reportedCostSettlement(call, args.cost),
            ...(args.cancelled
                ? {
                      providerObservation: {
                          ...call.providerObservation,
                          termination: call.providerObservation.termination ?? {
                              kind: "cancelled" as const,
                              source: "generation_lookup" as const,
                              generationId: args.generationId,
                              observedAt: Date.now(),
                          },
                      },
                  }
                : {}),
        });
        if (
            owner &&
            args.cancelled &&
            call.executionGeneration !== undefined &&
            call.operationEpoch !== undefined
        )
            await ctx.scheduler.runAfter(
                0,
                internal.execution.operations.wakeStructuredExecution,
                {
                    requestId: owner.request._id,
                    expectedGeneration: call.executionGeneration,
                    epoch: call.operationEpoch,
                },
            );
        return null;
    },
});

function providerLeaseDurationMs(
    service: "sec" | "exa" | "url_metadata" | "pdf" | "model",
    operation: string,
    remainingAuthorityMs?: number,
): number {
    if (service === "model") {
        if (operation === "source_embedding")
            return SOURCE_EMBEDDING_PROVIDER_LEASE_MS;
        if (
            remainingAuthorityMs === undefined ||
            !Number.isSafeInteger(remainingAuthorityMs) ||
            remainingAuthorityMs <= 0
        )
            throw sourcePreparationError("execution_deadline");
        return remainingAuthorityMs + MODEL_SETTLEMENT_GRACE_MS;
    }
    if (
        service === "exa" &&
        (operation === "get_contents" || operation === "framing_context_read")
    ) {
        return PROVIDER_LEASE_MS.exaContents;
    }
    if (service === "exa" && operation === "resolve_company_website") {
        return PROVIDER_LEASE_MS.companyWebsite;
    }
    return PROVIDER_LEASE_MS[service];
}

export const reserveSecRateLimit = internalMutation({
    args: {},
    returns: v.object({ retryAfter: v.optional(v.number()) }),
    handler: async (ctx, _args) => {
        const { retryAfter } = await rateLimiter.limit(ctx, "secRequests");
        return { retryAfter };
    },
});

export const reserveExaWebsiteRateLimit = internalMutation({
    args: { authUserId: v.id("users") },
    returns: v.null(),
    handler: async (ctx, args) => {
        const globalStatus = await rateLimiter.limit(ctx, "exaWebsiteGlobal");
        const sessionStatus = await rateLimiter.limit(
            ctx,
            "exaWebsitePerUser",
            { key: `auth:${args.authUserId}` },
        );
        if (!globalStatus.ok || !sessionStatus.ok) {
            throw new Error("Exa website enrichment rate limit reached");
        }
        return null;
    },
});

export const reserveSourceMetadataRateLimit = internalMutation({
    args: { authUserId: v.id("users") },
    returns: v.null(),
    handler: async (ctx, args) => {
        const globalStatus = await rateLimiter.limit(
            ctx,
            "sourceMetadataGlobal",
        );
        const sessionStatus = await rateLimiter.limit(
            ctx,
            "sourceMetadataPerUser",
            { key: `auth:${args.authUserId}` },
        );
        if (!globalStatus.ok || !sessionStatus.ok) {
            throw new ConvexError(
                manualSourceIntakeError("intake_rate_limited").data,
            );
        }
        return null;
    },
});

const recordAttemptResultValidator = v.object({
    deadlineAt: v.optional(v.number()),
    providerCallId: v.id("providerCalls"),
    shouldExecute: v.boolean(),
    status: providerCallStatusValidator,
    errorCode: v.optional(v.string()),
    retryable: v.optional(v.boolean()),
});

const preparationAttemptPlanValidator = v.object({
    attempt: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    retryAt: v.optional(v.number()),
    diagnosticReason: v.optional(v.string()),
});

/** Advises actions before dispatch; recordAttempt revalidates atomically before granting work. */
export const nextPreparationAttemptForInput = internalQuery({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        sourceId: v.id("sources"),
        operation: v.string(),
        inputHash: v.string(),
        now: v.number(),
    },
    returns: preparationAttemptPlanValidator,
    handler: async (
        ctx,
        args,
    ): Promise<Infer<typeof preparationAttemptPlanValidator>> => {
        const { preparation } = await assertPreparationExecutionFence(ctx.db, {
            preparationId: args.preparationId,
            now: args.now,
        });
        await (args.operation === "source_comparison"
            ? assertPreparationComparisonFence
            : assertPreparationExecutionFence)(ctx.db, {
            preparationId: args.preparationId,
            sourceId: args.sourceId,
            now: args.now,
        });
        let calls = await ctx.db
            .query("providerCalls")
            .withIndex("by_run_operation_input_and_attempt", (q) =>
                q
                    .eq("runId", preparation.runId)
                    .eq("operation", args.operation)
                    .eq("inputHash", args.inputHash),
            )
            .order("desc")
            .take(MAX_PREPARATION_ATTEMPT_HISTORY);
        if (!args.operation.startsWith("source_")) {
            const legacy = await ctx.db
                .query("providerCalls")
                .withIndex("by_run_source_operation", (q) =>
                    q
                        .eq("runId", preparation.runId)
                        .eq("sourceId", args.sourceId)
                        .eq("operation", args.operation),
                )
                .order("desc")
                .take(MAX_PREPARATION_ATTEMPT_HISTORY);
            calls = [...calls, ...legacy.filter((c) => !c.inputHash)];
        }
        const plan = nextPreparationAttempt(
            calls,
            preparation,
            args.now,
            args.operation === "source_supplement_search" ? 1 : 2,
        );
        if (
            !plan.attempt ||
            ![
                "source_qualification",
                "source_comparison",
                "source_documentary_control",
            ].includes(args.operation)
        )
            return {
                ...plan,
                ...(plan.attempt
                    ? {}
                    : { diagnosticReason: calls[0]?.diagnostic?.reason }),
            };
        const run = await ctx.db.get(preparation.runId);
        if (!run) throw sourcePreparationError("stale_execution");
        const blocked = preparationBudgetBlock(
            await readPreparationBudget(ctx.db, run, preparation),
            readPreparationLimits(preparation),
        );
        if (blocked) return { errorCode: blocked };
        return plan;
    },
});

export const providerAttemptValidator = v.object({
    searchQuery: v.optional(v.string()),
    modelContextWindowTokens: v.optional(v.number()),
    operationRequestId: v.optional(v.id("agentOperationRequests")),
    operationEpoch: v.optional(v.number()),
    missionId: v.optional(v.id("agentMissions")),
    invocationId: v.optional(v.id("agentInvocations")),
    inputHash: v.optional(v.string()),
    runId: v.optional(v.id("researchRuns")),
    corpusRevisionId: v.optional(v.id("corpusRevisions")),
    sourceId: v.optional(v.id("sources")),
    preparationId: v.optional(v.id("sourceSelectionProposalRebuilds")),
    acceptedDecisionId: v.optional(v.id("sourceDecisions")),
    executionGeneration: v.optional(v.number()),
    workflowVersion: v.optional(v.number()),
    stepKey: v.optional(v.string()),
    service: serviceValidator,
    operation: v.string(),
    operationKey: v.string(),
    status: providerCallStatusValidator,
    attempt: v.number(),
    latencyMs: v.optional(v.number()),
    usage: v.optional(v.any()),
    reportedCost: v.optional(v.number()),
    embeddingInputBytes: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    diagnostic: schema.tables.providerCalls.validator.fields.diagnostic,
    retryable: v.optional(v.boolean()),
    termination: v.optional(providerStreamTerminationValidator),
    dispatchOutcome: v.optional(preparationDispatchOutcomeValidator),
    httpStatus: v.optional(v.number()),
    retryAfterAt: v.optional(v.number()),
});

export const recordAttempt = internalMutation({
    args: providerAttemptValidator.fields,
    returns: recordAttemptResultValidator,
    handler: async (
        ctx,
        args,
    ): Promise<Infer<typeof recordAttemptResultValidator>> => {
        const now = Date.now();
        if (args.status === "started" && (await publicationControl(ctx))?.held)
            throw sourcePreparationError("provider_publication_held");
        if (
            args.termination &&
            (args.service !== "model" ||
                args.status === "started" ||
                args.dispatchOutcome !== "response_received" ||
                !args.preparationId ||
                !isOneShotPreparationOperation(args.operation))
        )
            throw sourcePreparationError("attempt_identity_conflict");
        if (
            args.status === "started" &&
            args.operationRequestId &&
            args.preparationId
        ) {
            const request = await ctx.db.get(args.operationRequestId);
            if (request?.input.kind === "acquire_document") {
                const acquisition = await requireSourcesAcquisitionRequest(
                    ctx,
                    request,
                    args.executionGeneration ?? -1,
                );
                if (
                    args.runId !== acquisition.run._id ||
                    args.preparationId !== acquisition.preparation._id ||
                    !acquisition.source ||
                    args.sourceId !== acquisition.source._id ||
                    args.inputHash !==
                        acquisition.pin.target.requestInputHash ||
                    !acquisition.data.work.some(
                        (work) =>
                            work.requestId === request._id &&
                            work.sourceId === args.sourceId,
                    )
                )
                    throw sourcePreparationError("attempt_identity_conflict");
            }
        }
        const framingLookup =
            args.operation === "framing_context_search" ||
            args.operation === "framing_context_read";
        const framingSecStep =
            args.operation === "framing_context_read" &&
            args.service === "sec" &&
            (args.stepKey === "sec_submissions" ||
                args.stepKey === "sec_filing");
        if (
            framingLookup &&
            (!args.operationRequestId ||
                !args.missionId ||
                (args.operation === "framing_context_search" &&
                    args.service !== "exa") ||
                !["exa", "sec", "url_metadata"].includes(args.service) ||
                args.invocationId ||
                args.preparationId ||
                args.sourceId ||
                args.acceptedDecisionId ||
                args.executionGeneration === undefined ||
                args.attempt !== 1 ||
                (!framingSecStep && args.stepKey !== args.operation) ||
                args.operationKey !==
                    `workbench:${args.operationRequestId}:${args.stepKey}` ||
                !args.inputHash ||
                !/^[a-f0-9]{64}$/.test(args.inputHash))
        )
            throw sourcePreparationError("attempt_identity_conflict");
        const framingAuthority =
            framingLookup &&
            args.status === "started" &&
            args.operationRequestId &&
            args.executionGeneration !== undefined
                ? await requirePublicContextRequest(
                      ctx,
                      args.operationRequestId,
                      args.executionGeneration,
                  )
                : undefined;
        if (
            framingAuthority &&
            (((framingAuthority.operation === "read_public_context" ||
                framingAuthority.operation === "acquire_document") &&
                args.operation !== "framing_context_read") ||
                (framingAuthority.operation === "search_public_context" &&
                    args.operation !== "framing_context_search") ||
                framingAuthority.mission._id !== args.missionId ||
                framingAuthority.run._id !== args.runId ||
                framingAuthority.run.activeCorpusRevisionId !==
                    args.corpusRevisionId ||
                framingAuthority.mission.definitionVersion !==
                    args.workflowVersion ||
                (framingAuthority.suppliedReference
                    ? args.operation !== "framing_context_read" ||
                      args.service !==
                          (framingAuthority.suppliedReference.confirmedSec
                              ? "sec"
                              : framingAuthority.selectedCandidate
                                ? "exa"
                                : "url_metadata")
                    : args.service !== "exa"))
        )
            throw sourcePreparationError("attempt_identity_conflict");
        if (
            framingAuthority?.operation === "search_public_context" &&
            (args.searchQuery !== framingAuthority.query ||
                args.inputHash !==
                    sha256Hex(
                        stableStringify({
                            query: framingAuthority.query,
                            limit: SOURCES_MAX_EVIDENCE_REFERENCES,
                        }),
                    ))
        )
            throw sourcePreparationError("attempt_identity_conflict");
        if (
            framingAuthority?.operation === "read_public_context" ||
            framingAuthority?.operation === "acquire_document"
        ) {
            const reference = framingAuthority.suppliedReference;
            if (framingAuthority.retainedRead || !reference)
                throw sourcePreparationError("attempt_identity_conflict");
            if (!reference.confirmedSec) {
                const expected = framingAuthority.selectedCandidate
                    ? {
                          urls: [reference.url],
                          options: {
                              text: { maxCharacters: MAX_EXA_TEXT_CHARACTERS },
                          },
                      }
                    : reference;
                if (
                    args.inputHash !==
                    framingProviderInputHash(
                        expected,
                        framingAuthority.acquisitionInputHash,
                    )
                )
                    throw sourcePreparationError("attempt_identity_conflict");
            }
        }
        if (framingAuthority?.suppliedReference?.confirmedSec) {
            const input = framingSecReadInput(
                framingAuthority.suppliedReference,
                args.stepKey,
            );
            if (
                !input ||
                args.inputHash !==
                    framingProviderInputHash(
                        input,
                        framingAuthority.acquisitionInputHash,
                    )
            )
                throw sourcePreparationError("attempt_identity_conflict");
        }
        let qualification: Awaited<
            ReturnType<typeof readWorkbenchQualification>
        > = null;
        if (args.status === "started" && args.runId) {
            const run = await ctx.db.get(args.runId);
            if (run && run.purpose === "browser_test") {
                const mission = args.missionId
                    ? await ctx.db.get(args.missionId)
                    : null;
                if (framingAuthority && mission) {
                    qualification = await requireQualifiedBrowserMission(
                        ctx,
                        run,
                        mission,
                    );
                    if (!qualification?.scenarios)
                        throw sourcePreparationError("paid_work_disabled");
                } else if (args.service === "model") {
                    qualification = await requireQualifiedBrowserMission(
                        ctx,
                        run,
                        mission,
                        args.preparationId,
                    );
                    if (
                        qualification?.sourcesLot &&
                        !(
                            mission
                                ? [
                                      "agent_reasoning",
                                      "agent_compaction",
                                      ...(qualification.responseControl?.enabled
                                          ? ["response_coherence"]
                                          : []),
                                  ]
                                : ["source_documentary_control"]
                        ).includes(args.operation)
                    )
                        throw sourcePreparationError("paid_work_disabled");
                } else {
                    qualification = await requireBrowserQualification(ctx, run);
                    if (
                        !qualification?.sourcesLot ||
                        !(
                            (args.service === "sec" &&
                                [
                                    "revalidate_company",
                                    "resolve_company",
                                    "retrieve_filing_html",
                                ].includes(args.operation)) ||
                            (args.service === "exa" &&
                                args.preparationId &&
                                ["source_need_search", "get_contents"].includes(
                                    args.operation,
                                ))
                        )
                    )
                        throw sourcePreparationError("paid_work_disabled");
                }
            }
        }
        if (
            args.diagnostic &&
            (args.diagnostic.reason.length > 100 ||
                new TextEncoder().encode(args.diagnostic.output ?? "").length >
                    MAX_PREPARATION_DIAGNOSTIC_BYTES ||
                !Number.isSafeInteger(args.diagnostic.originalBytes) ||
                args.diagnostic.originalBytes < 0)
        )
            throw new Error("Invalid provider output diagnostic");
        if (!framingLookup && (args.missionId || args.invocationId)) {
            const invocation = args.invocationId
                ? await ctx.db.get(args.invocationId)
                : null;
            const mission = args.missionId
                ? await ctx.db.get(args.missionId)
                : null;
            let reviewIdentity = false;
            if (
                args.operationRequestId &&
                mission?.conversationTurnId &&
                invocation
            ) {
                const request = await ctx.db.get(args.operationRequestId);
                const turn = await ctx.db.get(mission.conversationTurnId);
                const check = turn?.responseControl?.checks.find(
                    (c) =>
                        c.requestId === args.operationRequestId &&
                        c.invocationId === invocation._id,
                );
                reviewIdentity = !!(
                    request?.actor === "system" &&
                    request.missionId === mission._id &&
                    request.input.kind === "check_response_coherence" &&
                    request.input.invocationId === invocation._id &&
                    (!qualification?.sourcesLot ||
                        (qualification.responseControl?.enabled &&
                            stableStringify(qualification.responseControl) ===
                                stableStringify(
                                    turn?.responseControl?.policy,
                                ))) &&
                    check?.requestJson &&
                    check.requestHash === sha256Hex(check.requestJson) &&
                    args.inputHash === check.requestHash &&
                    args.operation === "response_coherence" &&
                    args.stepKey === args.operation &&
                    args.attempt === 1 &&
                    args.operationKey ===
                        responseReviewOperationKey(request._id) &&
                    (turn?.responseControl?.checks.length ?? Infinity) <=
                        RESPONSE_CONTROL_LIMITS.checksPerTurn
                );
                if (
                    args.status === "started" &&
                    (!reviewIdentity ||
                        request?.status !== "running" ||
                        !(await readResponseControlPolicy(ctx)).enabled)
                )
                    throw sourcePreparationError("response_review_unavailable");
            }
            if (
                !mission ||
                !invocation ||
                args.preparationId ||
                args.service !== "model" ||
                invocation.provenance !== "live" ||
                invocation.missionId !== mission._id ||
                invocation.runId !== args.runId ||
                mission.runId !== args.runId ||
                invocation.corpusRevisionId !== args.corpusRevisionId ||
                args.executionGeneration !== invocation.generation ||
                args.workflowVersion !== mission.definitionVersion ||
                (args.operationRequestId
                    ? !reviewIdentity
                    : args.operation !==
                          (invocation.purpose === "compaction"
                              ? "agent_compaction"
                              : "agent_reasoning") ||
                      args.stepKey !== args.operation ||
                      args.attempt !== 1 ||
                      args.inputHash !== admittedInputHash(invocation) ||
                      args.operationKey !==
                          `mission:${mission._id}:invocation:${invocation._id}:attempt:1`)
            )
                throw sourcePreparationError("qualification_attempt_invalid");
            // Factual settlement retains the original attempt; admission alone needs the current generation.
            if (args.status === "started")
                await requireMissionAuthority(
                    ctx,
                    mission._id,
                    invocation.generation,
                );
        }
        if (
            args.service === "model" &&
            !args.missionId &&
            (!args.preparationId ||
                !args.inputHash ||
                !/^[a-f0-9]{64}$/.test(args.inputHash) ||
                ![
                    "source_qualification",
                    "source_comparison",
                    "source_documentary_control",
                    "source_embedding",
                ].includes(args.operation) ||
                !Number.isSafeInteger(args.attempt) ||
                args.attempt < 1)
        ) {
            throw sourcePreparationError(
                args.operation === "source_comparison"
                    ? "comparison_attempt_invalid"
                    : "qualification_attempt_invalid",
            );
        }
        if (args.preparationId) {
            const preparation = await ctx.db.get(args.preparationId);
            if (
                preparation?.kind !== "preparation" ||
                preparation.runId !== args.runId ||
                preparation.corpusRevisionId !== args.corpusRevisionId ||
                (args.status === "started" &&
                    preparation.executionGeneration !==
                        args.executionGeneration) ||
                preparation.workflowVersion !== args.workflowVersion ||
                args.acceptedDecisionId ||
                (!args.sourceId &&
                    !(
                        (args.service === "exa" || args.service === "sec") &&
                        [
                            "source_supplement_search",
                            "source_need_search",
                        ].includes(args.operation)
                    )) ||
                args.stepKey !== "source_preparation"
            ) {
                throw sourcePreparationError("stale_execution");
            }
            if (args.service === "model") {
                const operationStep =
                    args.operation === "source_comparison"
                        ? "source_comparison"
                        : args.operation === "source_embedding"
                          ? "source_embedding"
                          : "source_preparation";
                if (
                    args.operationKey !==
                    `${preparation.operationKey}:step:${operationStep}:input:${args.inputHash}:attempt:${args.attempt}`
                )
                    throw sourcePreparationError(
                        args.operation === "source_comparison"
                            ? "comparison_attempt_invalid"
                            : "qualification_attempt_invalid",
                    );
            }
            if (args.status === "started") {
                if (args.operation === "source_comparison" && args.sourceId) {
                    await assertPreparationComparisonFence(ctx.db, {
                        preparationId: args.preparationId,
                        sourceId: args.sourceId,
                        now,
                    });
                } else {
                    await assertPreparationExecutionFence(ctx.db, {
                        preparationId: args.preparationId,
                        sourceId: args.sourceId,
                        now,
                    });
                }
            }
        }
        if (
            args.stepKey === "extracting_evidence" ||
            (args.sourceId && args.acceptedDecisionId)
        ) {
            if (
                !args.runId ||
                !args.corpusRevisionId ||
                !args.sourceId ||
                !args.acceptedDecisionId ||
                args.executionGeneration === undefined
            ) {
                throw new Error(
                    "Research execution fence violation: missing required fence arguments",
                );
            }
            await assertEvidenceExecutionFence(ctx.db, {
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                sourceId: args.sourceId,
                acceptedDecisionId: args.acceptedDecisionId,
                executionGeneration: args.executionGeneration,
            });
        }

        if (args.status === "started") {
            if (
                !(
                    args.stepKey === "extracting_evidence" ||
                    (args.sourceId && args.acceptedDecisionId)
                ) &&
                args.runId &&
                !args.missionId
            ) {
                const run = await ctx.db.get(args.runId);
                const executionIsActive = args.operation.startsWith(
                    "rebuild_source_proposal_",
                )
                    ? run?.executionStatus === "paused" &&
                      run.lifecycleState === "awaiting_source_review" &&
                      run.pauseReason === "source_review"
                    : args.service === "url_metadata"
                      ? run?.executionStatus === "paused" &&
                        [
                            "awaiting_evidence_sufficiency_review",
                            "awaiting_source_review",
                        ].includes(run.lifecycleState)
                      : run?.executionStatus === "running";
                if (
                    !run ||
                    args.executionGeneration === undefined ||
                    run.executionGeneration !== args.executionGeneration ||
                    !executionIsActive
                ) {
                    throw new Error("Research execution is no longer active");
                }
            }

            if (args.service === "exa" || args.service === "model") {
                const paidWork = await ctx.db
                    .query("paidWorkControls")
                    .withIndex("by_key", (query) => query.eq("key", "global"))
                    .unique();
                if (paidWork?.enabled === false) {
                    if (args.preparationId || args.missionId)
                        throw sourcePreparationError("paid_work_disabled");
                    const existing = await ctx.db
                        .query("providerCalls")
                        .withIndex("by_operation_key", (query) =>
                            query.eq("operationKey", args.operationKey),
                        )
                        .first();
                    if (existing) {
                        return {
                            providerCallId: existing._id,
                            shouldExecute: false,
                            status: "failed" as const,
                        };
                    }
                    const providerCallId = await ctx.db.insert(
                        "providerCalls",
                        {
                            runId: args.runId,
                            corpusRevisionId: args.corpusRevisionId,
                            preparationId: args.preparationId,
                            sourceId: args.sourceId,
                            executionGeneration: args.executionGeneration,
                            workflowVersion: args.workflowVersion,
                            stepKey: args.stepKey,
                            service: args.service,
                            operation: args.operation,
                            operationKey: args.operationKey,
                            status: "failed",
                            attempt: args.attempt,
                            errorCode: "paid_work_disabled",
                            createdAt: now,
                            completedAt: now,
                        },
                    );
                    return {
                        providerCallId,
                        shouldExecute: false,
                        status: "failed" as const,
                        ...(args.preparationId
                            ? { errorCode: "paid_work_disabled" }
                            : {}),
                    };
                }
            }

            const logicalAttempt =
                args.preparationId && args.inputHash
                    ? (
                          await ctx.db
                              .query("providerCalls")
                              .withIndex(
                                  "by_run_operation_input_and_attempt",
                                  (q) =>
                                      q
                                          .eq("runId", args.runId)
                                          .eq("operation", args.operation)
                                          .eq("inputHash", args.inputHash)
                                          .eq("attempt", args.attempt),
                              )
                              .take(MAX_PREPARATION_ATTEMPT_HISTORY)
                      ).find(
                          (call) =>
                              preparationFailureClass(call) !==
                              "not_dispatched",
                      )
                    : null;
            const matches = logicalAttempt
                ? [logicalAttempt]
                : await ctx.db
                      .query("providerCalls")
                      .withIndex("by_operation_key", (query) =>
                          query.eq("operationKey", args.operationKey),
                      )
                      .collect();
            const existing = matches.find(
                (call) =>
                    call.service === args.service &&
                    call.operation === args.operation &&
                    call.attempt === args.attempt &&
                    call.runId === args.runId &&
                    (!args.preparationId ||
                        preparationFailureClass(call) !== "not_dispatched"),
            );
            if (existing) {
                if (framingLookup && existing.inputHash !== args.inputHash)
                    throw sourcePreparationError("attempt_identity_conflict");
                if (
                    existing.status === "started" &&
                    existing.leaseExpiresAt !== undefined &&
                    existing.leaseExpiresAt <= now
                ) {
                    if (args.preparationId || args.missionId) {
                        await patchQualificationReceipt(ctx, existing, {
                            status: "failed",
                            errorCode: "attempt_outcome_unknown",
                            retryable: false,
                            completedAt: now,
                        });
                        return {
                            providerCallId: existing._id,
                            shouldExecute: false,
                            status: "failed" as const,
                            errorCode: "attempt_outcome_unknown",
                        };
                    }
                    const leaseExpiresAt =
                        now +
                        providerLeaseDurationMs(args.service, args.operation);
                    await ctx.db.patch(existing._id, {
                        leaseExpiresAt,
                        createdAt: now,
                    });
                    return {
                        providerCallId: existing._id,
                        shouldExecute: true,
                        status: "started" as const,
                    };
                }
                return {
                    providerCallId: existing._id,
                    shouldExecute: false,
                    status: existing.status,
                    ...(args.service === "model"
                        ? {
                              errorCode: existing.errorCode,
                              retryable: existing.retryable,
                          }
                        : {}),
                };
            }

            if (framingAuthority) {
                const limit =
                    args.operation === "framing_context_search"
                        ? framingAuthority.allowance.searches
                        : framingAuthority.allowance.readings;
                if (limit <= 0)
                    throw sourcePreparationError(
                        "public_context_allowance_exhausted",
                    );
                const admitted = await ctx.db
                    .query("providerCalls")
                    .withIndex("by_run_operation_input_and_attempt", (q) =>
                        q
                            .eq("runId", framingAuthority.run._id)
                            .eq("operation", args.operation),
                    )
                    .take(limit);
                if (admitted.length >= limit)
                    throw sourcePreparationError(
                        "public_context_allowance_exhausted",
                    );
            }
            let recoveryOfProviderCallId: Id<"providerCalls"> | undefined;
            let structuredOutputPolicy: Doc<"providerCalls">["structuredOutputPolicy"];
            let remainingModelAuthorityMs: number | undefined;
            if (
                args.preparationId &&
                args.inputHash &&
                args.operation !== "source_embedding"
            ) {
                const preparation = await ctx.db.get(args.preparationId);
                if (!preparation)
                    throw sourcePreparationError("stale_execution");
                let calls = await ctx.db
                    .query("providerCalls")
                    .withIndex("by_run_operation_input_and_attempt", (q) =>
                        q
                            .eq("runId", args.runId)
                            .eq("operation", args.operation)
                            .eq("inputHash", args.inputHash),
                    )
                    .order("desc")
                    .take(MAX_PREPARATION_ATTEMPT_HISTORY);
                if (args.operation === "source_supplement_search") {
                    const run = args.runId
                        ? await ctx.db.get(args.runId)
                        : null;
                    const supplement = run?.automaticSupplementOperationId
                        ? await ctx.db.get(run.automaticSupplementOperationId)
                        : null;
                    const queryIndex =
                        supplement?.supplementQueries?.findIndex(
                            (query, index) =>
                                args.operationKey ===
                                    supplementalSearchOperationKey(
                                        supplement._id,
                                        index,
                                        args.attempt,
                                    ) &&
                                args.inputHash ===
                                    supplementalSearchInputHash(query),
                        ) ?? -1;
                    if (!supplement || queryIndex < 0)
                        throw sourcePreparationError("supplement_invalid");
                    calls = await readSupplementalSearchAttempts(
                        ctx.db,
                        preparation.runId,
                        supplement,
                        queryIndex,
                    );
                } else if (!args.operation.startsWith("source_")) {
                    const legacy = await ctx.db
                        .query("providerCalls")
                        .withIndex("by_run_source_operation", (q) =>
                            q
                                .eq("runId", args.runId)
                                .eq("sourceId", args.sourceId)
                                .eq("operation", args.operation),
                        )
                        .order("desc")
                        .take(MAX_PREPARATION_ATTEMPT_HISTORY);
                    calls.push(...legacy.filter((c) => !c.inputHash));
                }
                const plan = nextPreparationAttempt(
                    calls,
                    preparation,
                    now,
                    args.operation === "source_supplement_search" ? 1 : 2,
                );
                if (plan.attempt !== args.attempt)
                    throw sourcePreparationError(
                        plan.errorCode ?? "qualification_attempt_invalid",
                    );
                if (
                    args.attempt >
                    (args.operation === "source_supplement_search" ? 1 : 2)
                )
                    recoveryOfProviderCallId = [...calls].sort(
                        (a, b) => b.attempt - a.attempt,
                    )[0]?._id;
            }

            if (args.operation === "source_embedding") {
                const run = args.runId ? await ctx.db.get(args.runId) : null;
                const bytes = args.embeddingInputBytes;
                if (
                    !run ||
                    args.attempt !== 1 ||
                    bytes === undefined ||
                    !Number.isSafeInteger(bytes) ||
                    bytes < 1 ||
                    bytes >
                        MAX_SOURCE_EMBEDDING_BATCH_TEXTS *
                            MAX_SOURCE_EMBEDDING_TEXT_BYTES
                )
                    throw sourcePreparationError(
                        "embedding_reservation_invalid",
                    );
                const used = run.sourceEmbeddingReservedBytes ?? 0;
                // One UTF-8 byte per token deliberately overestimates ordinary English tokenization.
                if (
                    used + bytes > MAX_SOURCE_EMBEDDING_INPUT_BYTES ||
                    (run.sourceEmbeddingAttemptCount ?? 0) >=
                        MAX_SOURCE_EMBEDDING_ATTEMPTS
                )
                    throw sourcePreparationError("embedding_budget_exhausted");
                const calls = await ctx.db
                    .query("providerCalls")
                    .withIndex("by_run_operation_input_and_attempt", (q) =>
                        q
                            .eq("runId", run._id)
                            .eq("operation", "source_embedding"),
                    )
                    .take(129);
                if (
                    calls.filter(
                        (call) =>
                            call.status === "started" &&
                            (call.leaseExpiresAt ?? 0) > now,
                    ).length >= MAX_CONCURRENT_SOURCE_EMBEDDING_CALLS
                )
                    throw sourcePreparationError("embedding_concurrency_limit");
                await ctx.db.patch(run._id, {
                    sourceEmbeddingReservedBytes: used + bytes,
                    sourceEmbeddingAttemptCount:
                        (run.sourceEmbeddingAttemptCount ?? 0) + 1,
                });
            }
            if (
                args.service === "model" &&
                (args.preparationId || args.missionId) &&
                args.operation !== "source_embedding"
            ) {
                const preparation = args.preparationId
                    ? await ctx.db.get(args.preparationId)
                    : null;
                if (
                    preparation &&
                    isOneShotPreparationOperation(args.operation)
                ) {
                    structuredOutputPolicy = preparation.structuredOutputPolicy;
                    if (!supportsStructuredOutputPolicy(structuredOutputPolicy))
                        throw sourcePreparationError(
                            "structured_output_policy_unsupported",
                        );
                }
                const request = args.operationRequestId
                    ? await ctx.db.get(args.operationRequestId)
                    : null;
                if (
                    args.operationRequestId &&
                    (!request ||
                        request.runId !== args.runId ||
                        (request.scheduledExecution?.dispatchGeneration ??
                            request.expectedGeneration) !==
                            args.executionGeneration ||
                        (args.operationEpoch !== undefined &&
                            (request.scheduledExecution?.phase !== "running" ||
                                !ownsScheduledEpoch(
                                    request,
                                    args.executionGeneration ?? -1,
                                    args.operationEpoch,
                                ))) ||
                        (isOneShotPreparationOperation(args.operation) &&
                            request.scheduledExecution &&
                            args.operationEpoch === undefined) ||
                        !operationHasStarted(request) ||
                        (args.missionId &&
                            request.missionId !== args.missionId))
                )
                    throw sourcePreparationError("stale_execution");
                const missionId = args.missionId ?? request?.missionId;
                const mission = missionId ? await ctx.db.get(missionId) : null;
                const run = args.runId ? await ctx.db.get(args.runId) : null;
                if ((!preparation && !mission) || !run)
                    throw sourcePreparationError("stale_execution");
                if (missionId)
                    await requireMissionAuthority(
                        ctx,
                        missionId,
                        args.executionGeneration ?? 0,
                    );
                remainingModelAuthorityMs =
                    Math.min(
                        preparation?.deadlineAt ?? Infinity,
                        mission?.deadlineAt ?? Infinity,
                        request ? (request.deadlineAt ?? 0) : Infinity,
                        qualification?.deadlineAt ?? Infinity,
                    ) - now;
                const budget = await readPreparationBudget(
                    ctx.db,
                    run,
                    preparation ?? undefined,
                );
                const blocked = preparationBudgetBlock(
                    budget,
                    mission?.modelLimits ??
                        readPreparationLimits(preparation ?? undefined),
                );
                if (blocked) throw sourcePreparationError(blocked);
                if (preparation)
                    await ctx.db.patch(preparation._id, {
                        modelAttemptCount:
                            (preparation.modelAttemptCount ?? 0) + 1,
                        modelLimits: readPreparationLimits(preparation),
                    });
                await ctx.db.patch(run._id, {
                    sourceQualificationAttemptCount: budget.dispatches + 1,
                    sourcePreparationBudget: {
                        ...budget,
                        reserved: budget.reserved + 1,
                        dispatches: budget.dispatches + 1,
                    },
                });
            }
            let qualificationReservationUsd: number | undefined;
            let structuredCapacity:
                | { contextWindow: number; maxTokens: number }
                | undefined;
            if (
                args.service === "model" &&
                args.preparationId &&
                args.operation !== "source_embedding"
            ) {
                const preparation = await ctx.db.get(args.preparationId);
                if (preparation) {
                    if (preparation.preparationStudy)
                        throw sourcePreparationError(
                            "qualification_structured_capacity_not_authorized",
                        );
                    const model = preparation.modelRevisionId
                        ? await ctx.db.get(preparation.modelRevisionId)
                        : null;
                    if (!model)
                        throw sourcePreparationError("missing_configuration");
                    structuredCapacity = {
                        contextWindow: model.descriptor.contextWindow,
                        maxTokens: preparationModelOutputLimit({
                            model: model.model,
                            descriptor: model.descriptor,
                        }),
                    };
                }
            }
            if (qualification) {
                let modelReservationUsd = 0;
                if (args.service === "model") {
                    let capacity = structuredCapacity;
                    if (args.operation === "response_coherence") {
                        const contextWindow = args.modelContextWindowTokens;
                        if (
                            typeof contextWindow !== "number" ||
                            !Number.isSafeInteger(contextWindow) ||
                            contextWindow < 1
                        )
                            throw sourcePreparationError(
                                "missing_configuration",
                            );
                        // The verified decisions endpoint charges input only and produces no completion tokens.
                        capacity = { contextWindow, maxTokens: 0 };
                    } else if (args.invocationId) {
                        const invocation = await ctx.db.get(args.invocationId);
                        const mission = invocation?.missionId
                            ? await ctx.db.get(invocation.missionId)
                            : null;
                        const model = mission?.modelRevisionId
                            ? await ctx.db.get(mission.modelRevisionId)
                            : null;
                        if (!model)
                            throw sourcePreparationError(
                                "missing_configuration",
                            );
                        capacity = {
                            contextWindow: model.descriptor.contextWindow,
                            maxTokens: preparationModelOutputLimit({
                                model: model.model,
                                descriptor: model.descriptor,
                            }),
                        };
                        if (
                            invocation?.generationBackend?.id === "pi-durable"
                        ) {
                            const request = await ctx.db
                                .query("agentInvocationPayloads")
                                .withIndex("by_invocation_and_part", (q) =>
                                    q
                                        .eq("invocationId", invocation._id)
                                        .eq("part", "request"),
                                )
                                .unique();
                            const output = request?.effectiveMaxOutputTokens;
                            if (
                                request?.state !== "complete" ||
                                typeof output !== "number" ||
                                !Number.isSafeInteger(output) ||
                                output < 1 ||
                                output > model.descriptor.maxTokens
                            )
                                throw sourcePreparationError(
                                    "invalid_model_output_limit",
                                );
                            capacity.maxTokens = output;
                        }
                    }
                    if (!capacity)
                        throw sourcePreparationError("missing_configuration");
                    modelReservationUsd =
                        qualificationModelReservationUsd(capacity);
                }
                qualificationReservationUsd =
                    args.service === "model"
                        ? modelReservationUsd
                        : args.service === "exa"
                          ? [
                                "source_need_search",
                                "framing_context_search",
                            ].includes(args.operation)
                              ? 0.007
                              : args.operation === "framing_context_read"
                                ? 0.001 * SOURCES_MAX_EVIDENCE_REFERENCES
                                : 0.001
                          : 0;
                if (qualification.scenarios && args.runId) {
                    const run = await ctx.db.get(args.runId);
                    if (!run?.browserTestContextId)
                        throw sourcePreparationError("paid_work_disabled");
                    await assertQualificationAllowance(
                        ctx,
                        run.browserTestContextId,
                        args.runId,
                        args,
                        qualificationReservationUsd,
                    );
                } else {
                    const calls = (
                        await Promise.all(
                            (
                                qualification.sourcesLot ?? [
                                    qualification.runId,
                                ]
                            ).map((runId) =>
                                ctx.db
                                    .query("providerCalls")
                                    .withIndex("by_run", (q) =>
                                        q.eq("runId", runId),
                                    )
                                    .take(
                                        MAX_SOURCES_QUALIFICATION_RECEIPTS + 1,
                                    ),
                            ),
                        )
                    ).flat();
                    const reserved = calls.reduce(
                        (sum, call) =>
                            sum +
                            Math.max(
                                call.qualificationReservationUsd ??
                                    (call.service === "model"
                                        ? modelReservationUsd
                                        : 0),
                                call.reportedCost ?? 0,
                            ),
                        0,
                    );
                    const kind = qualificationCategory(args);
                    const perDossierLimit = {
                        model: 20,
                        search: 2,
                        acquisition: 6,
                        technical: 64,
                    }[kind];
                    const lotLimit = {
                        model: Math.min(
                            40,
                            qualification.maximumRequests ?? 40,
                        ),
                        search: qualification.maximumSearchAttempts ?? 4,
                        acquisition: qualification.maximumAcquisitions ?? 12,
                        technical: 128,
                    }[kind];
                    if (
                        (qualification.sourcesLot
                            ? calls.length >=
                                  MAX_SOURCES_QUALIFICATION_RECEIPTS ||
                              calls.filter(
                                  (call) =>
                                      call.runId === args.runId &&
                                      qualificationCategory(call) === kind,
                              ).length >= perDossierLimit ||
                              calls.filter(
                                  (call) =>
                                      qualificationCategory(call) === kind,
                              ).length >= lotLimit ||
                              calls.some(
                                  (call) =>
                                      call.dispatchOutcome === "unknown" ||
                                      (call.status === "started" &&
                                          (call.leaseExpiresAt ?? 0) <= now),
                              )
                            : calls.length >=
                              (qualification.maximumRequests ?? Infinity)) ||
                        reserved + qualificationReservationUsd >
                            qualification.maximumCostUsd ||
                        calls.some(
                            (call) =>
                                call.reportedCost !== undefined &&
                                call.reportedCost >
                                    (call.qualificationReservationUsd ?? 0),
                        )
                    )
                        throw sourcePreparationError(
                            "qualification_budget_exhausted",
                        );
                }
            }
            const qualificationContextId =
                qualification?.scenarios && args.runId
                    ? (await ctx.db.get(args.runId))?.browserTestContextId
                    : undefined;
            const providerCallId = await ctx.db.insert("providerCalls", {
                reservedMaxOutputTokens: structuredCapacity?.maxTokens,
                modelContextWindowTokens: args.modelContextWindowTokens,
                qualificationReservationUsd,
                qualificationContextId,
                costAccountingPolicy: qualification?.costAccountingPolicy,
                operationRequestId: args.operationRequestId,
                missionId: args.missionId,
                invocationId: args.invocationId,
                operationEpoch: args.operationEpoch,
                ...(structuredOutputPolicy ? { structuredOutputPolicy } : {}),
                inputHash: args.inputHash,
                searchQuery: args.searchQuery,
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                preparationId: args.preparationId,
                sourceId: args.sourceId,
                executionGeneration: args.executionGeneration,
                workflowVersion: args.workflowVersion,
                stepKey: args.stepKey,
                service: args.service,
                operation: args.operation,
                operationKey: args.operationKey,
                status: "started",
                attempt: args.attempt,
                recoveryOfProviderCallId,
                leaseExpiresAt:
                    now +
                    providerLeaseDurationMs(
                        args.service,
                        args.operation,
                        remainingModelAuthorityMs,
                    ),
                usage:
                    args.operation === "source_embedding"
                        ? { reservedInputBytes: args.embeddingInputBytes }
                        : undefined,
                createdAt: now,
            });
            if (qualificationContextId) {
                const call = await ctx.db.get(providerCallId);
                if (!call) throw new Error("Missing provider receipt");
                await updateQualificationUsage(ctx, null, call);
            }
            if (args.invocationId && !args.operationRequestId)
                await ctx.db.patch(args.invocationId, { providerCallId });
            return {
                ...(remainingModelAuthorityMs === undefined
                    ? {}
                    : { deadlineAt: now + remainingModelAuthorityMs }),
                providerCallId,
                shouldExecute: true,
                status: "started" as const,
            };
        }

        const matches = await ctx.db
            .query("providerCalls")
            .withIndex("by_operation_key", (query) =>
                query.eq("operationKey", args.operationKey),
            )
            .collect();
        const existing = matches.find(
            (call) =>
                call.service === args.service &&
                call.operation === args.operation &&
                call.attempt === args.attempt &&
                call.runId === args.runId &&
                (!args.preparationId ||
                    preparationFailureClass(call) !== "not_dispatched"),
        );
        if (!existing) {
            throw new Error("Provider attempt was not started");
        }
        if (
            framingLookup &&
            (existing.missionId !== args.missionId ||
                existing.operationRequestId !== args.operationRequestId ||
                existing.inputHash !== args.inputHash ||
                existing.corpusRevisionId !== args.corpusRevisionId ||
                existing.executionGeneration !== args.executionGeneration ||
                existing.workflowVersion !== args.workflowVersion)
        )
            throw sourcePreparationError("attempt_identity_conflict");
        if (
            args.preparationId &&
            (existing.preparationId !== args.preparationId ||
                existing.corpusRevisionId !== args.corpusRevisionId ||
                existing.sourceId !== args.sourceId ||
                existing.executionGeneration !== args.executionGeneration ||
                existing.workflowVersion !== args.workflowVersion ||
                existing.stepKey !== args.stepKey ||
                ((args.inputHash !== undefined ||
                    args.operation === "source_need_search") &&
                    existing.inputHash !== args.inputHash))
        )
            throw sourcePreparationError("attempt_identity_conflict");
        if (args.termination && !existing.invocationId)
            throw sourcePreparationError("attempt_identity_conflict");
        const terminalObservation =
            args.termination && !existing.providerObservation?.termination
                ? {
                      providerObservation: {
                          ...existing.providerObservation,
                          observedAt:
                              existing.providerObservation?.observedAt ??
                              args.termination.observedAt,
                          termination: args.termination,
                      },
                  }
                : {};
        if (
            (framingLookup || args.service === "model") &&
            (args.preparationId || args.missionId) &&
            args.operation !== "source_embedding"
        ) {
            if (
                existing.status !== "started" &&
                !(
                    args.missionId &&
                    existing.errorCode === "attempt_outcome_unknown" &&
                    args.dispatchOutcome === "response_received"
                )
            ) {
                if (
                    existing.status !== args.status ||
                    existing.errorCode !== args.errorCode
                )
                    throw sourcePreparationError("attempt_result_conflict");
                const settlement = reportedCostSettlement(
                    existing,
                    args.reportedCost,
                    args,
                );
                await patchQualificationReceipt(ctx, existing, {
                    ...settlement,
                    ...terminalObservation,
                });
                return {
                    providerCallId: existing._id,
                    shouldExecute: false,
                    status: existing.status,
                };
            }
        }
        const update = {
            status: args.status,
            latencyMs: args.latencyMs,
            usage: args.usage,
            ...reportedCostSettlement(existing, args.reportedCost, args),
            ...terminalObservation,
            errorCode: args.errorCode,
            ...(args.diagnostic ? { diagnostic: args.diagnostic } : {}),
            retryable: args.retryable,
            dispatchOutcome:
                args.dispatchOutcome ??
                (["succeeded", "partial"].includes(args.status)
                    ? "response_received"
                    : undefined),
            httpStatus: args.httpStatus,
            retryAfterAt: args.retryAfterAt,
            completedAt: now,
        };
        await patchQualificationReceipt(ctx, existing, update);
        return {
            providerCallId: existing._id,
            shouldExecute: false,
            status: args.status,
        };
    },
});

export const getSucceededUrlMetadata = internalQuery({
    args: { operationKey: v.string() },
    returns: v.union(
        v.object({
            canonicalUrl: v.string(),
            title: v.string(),
        }),
        v.null(),
    ),
    handler: async (ctx, args) => {
        const calls = await ctx.db
            .query("providerCalls")
            .withIndex("by_operation_key", (query) =>
                query.eq("operationKey", args.operationKey),
            )
            .collect();
        const succeeded = calls.find(
            (call) =>
                call.service === "url_metadata" &&
                call.operation === "inspect_launch_manual_source" &&
                call.status === "succeeded",
        );
        const usage = succeeded?.usage;
        if (
            !usage ||
            typeof usage !== "object" ||
            typeof usage.canonicalUrl !== "string" ||
            typeof usage.title !== "string"
        ) {
            return null;
        }
        return {
            canonicalUrl: usage.canonicalUrl,
            title: usage.title,
        };
    },
});

export const recordConfigurationFailure = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.optional(v.id("corpusRevisions")),
        sourceId: v.optional(v.id("sources")),
        acceptedDecisionId: v.optional(v.id("sourceDecisions")),
        executionGeneration: v.number(),
        service: serviceValidator,
        operation: v.string(),
        operationKey: v.string(),
        errorCode: v.string(),
    },
    returns: v.id("providerCalls"),
    handler: async (ctx, args) => {
        if (args.sourceId && args.acceptedDecisionId && args.corpusRevisionId) {
            await assertEvidenceExecutionFence(ctx.db, {
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                sourceId: args.sourceId,
                acceptedDecisionId: args.acceptedDecisionId,
                executionGeneration: args.executionGeneration,
            });
        } else {
            const run = await ctx.db.get(args.runId);
            if (
                !run ||
                run.executionGeneration !== args.executionGeneration ||
                run.executionStatus !== "running"
            ) {
                throw new Error("Research execution is no longer active");
            }
        }
        const existing = await ctx.db
            .query("providerCalls")
            .withIndex("by_operation_key", (query) =>
                query.eq("operationKey", args.operationKey),
            )
            .first();
        if (existing) {
            return existing._id;
        }
        const now = Date.now();
        return ctx.db.insert("providerCalls", {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            executionGeneration: args.executionGeneration,
            service: args.service,
            operation: args.operation,
            operationKey: args.operationKey,
            status: "failed",
            attempt: 0,
            errorCode: args.errorCode,
            createdAt: now,
            completedAt: now,
        });
    },
});
