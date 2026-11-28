export { requireQualificationResultDeadline } from "./execution/providerCallReceipts";

import {
    assertProviderQualificationAllowance,
    existingProviderAttempt,
    hasUnresolvedStructuredTermination,
    insertProviderReceipt,
    invocationCall,
    qualificationInvocationCapacity,
    reportedCostSettlement,
    requireBrowserQualification,
    requireProviderDiagnostic,
    requireQualifiedBrowserMission,
    reserveMissionModelAttempt,
    reserveModelAttempt,
} from "./execution/providerCallReceipts";
import {
    providerAttemptValidator,
    recordAttemptResultValidator,
    serviceValidator,
} from "./execution/providerReceiptValidators";

export { requireQualifiedBrowserMission } from "./execution/providerCallReceipts";
export { providerAttemptValidator } from "./execution/providerReceiptValidators";

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
import { readResponseControlPolicy } from "@convex/execution/modelConfigurationCore";
import {
    patchQualificationReceipt,
    qualificationModelReservationUsd,
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
    preparationFailureClass,
    readPreparationBudget,
    readPreparationLimits,
    sourcePreparationError,
} from "./domain/sourcePreparationAuthority";
import {
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
    MAX_SOURCE_EMBEDDING_ATTEMPTS,
    MAX_SOURCE_EMBEDDING_BATCH_TEXTS,
    MAX_SOURCE_EMBEDDING_INPUT_BYTES,
    MAX_SOURCE_EMBEDDING_TEXT_BYTES,
    SOURCES_MAX_EVIDENCE_REFERENCES,
    supportsStructuredOutputPolicy,
} from "./resourcePolicy";
import type { readWorkbenchQualification } from "./runWorkspace";
import schema from "./schema";

/** Known observations settle independently; only qualification-funded results carry this adoption deadline. */
const billingResult = v.object({ scheduled: v.boolean() });
const billingReason =
    schema.tables.providerCalls.validator.fields.billing.fields.reason;

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

export const recordAttempt = internalMutation({
    args: providerAttemptValidator.fields,
    returns: recordAttemptResultValidator,
    handler: async (
        ctx,
        args,
    ): Promise<Infer<typeof recordAttemptResultValidator>> => {
        if (
            args.status === "started" &&
            args.service === "model" &&
            (args.operation === "agent_reasoning" ||
                args.operation === "agent_compaction") &&
            !args.operationRequestId &&
            !args.sourceId &&
            !args.acceptedDecisionId
        )
            return reserveMissionModelAttempt(ctx, args);
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
        requireProviderDiagnostic(args);
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
                return existingProviderAttempt(ctx, args, existing, now);
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
                await reserveModelAttempt(ctx, run, mission, preparation);
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
                        capacity = await qualificationInvocationCapacity(
                            ctx,
                            args.invocationId,
                        );
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
                await assertProviderQualificationAllowance(
                    ctx,
                    args,
                    qualification,
                    qualificationReservationUsd,
                    modelReservationUsd,
                    now,
                );
            }
            return insertProviderReceipt(ctx, args, {
                now,
                qualification,
                qualificationReservationUsd,
                reservedMaxOutputTokens: structuredCapacity?.maxTokens,
                structuredOutputPolicy,
                recoveryOfProviderCallId,
                remainingModelAuthorityMs,
            });
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
