import {
    preparationDispatchOutcomeValidator,
    structuredOutputPolicyValidator,
} from "@convex/domain/sourcePreparationAuthority";
import { defineTable } from "convex/server";
import { v } from "convex/values";
import { protectedDiagnosticValidator } from "./operationContracts";
import { piDispatchLeaseValidator } from "./piSession";
export const providerStreamTerminationValidator = v.object({
    kind: v.literal("finished"),
    source: v.literal("stream"),
    rawFinishReason: v.string(),
    observedAt: v.number(),
});
export const providerCallsTable = defineTable({
    searchQuery: v.optional(v.string()),
    modelContextWindowTokens: v.optional(v.number()),
    reservedMaxOutputTokens: v.optional(v.number()),
    operationRequestId: v.optional(v.id("agentOperationRequests")),
    operationEpoch: v.optional(v.number()),
    qualificationReservationUsd: v.optional(v.number()),
    costAccountingPolicy: v.optional(
        v.union(v.literal("conservative_v1"), v.literal("known_final_v1")),
    ),
    reportedCostFinal: v.optional(v.boolean()),
    qualificationContextId: v.optional(v.id("browserTestContexts")),
    missionId: v.optional(v.id("agentMissions")),
    invocationId: v.optional(v.id("agentInvocations")),
    inputHash: v.optional(v.string()),
    runId: v.optional(v.id("researchRuns")),
    corpusRevisionId: v.optional(v.id("corpusRevisions")),
    sourceId: v.optional(v.id("sources")),
    preparationId: v.optional(v.id("sourceSelectionProposalRebuilds")),
    executionGeneration: v.optional(v.number()),
    workflowVersion: v.optional(v.number()),
    stepKey: v.optional(v.string()),
    service: v.union(
        v.literal("model"),
        v.literal("sec"),
        v.literal("exa"),
        v.literal("url_metadata"),
        v.literal("pdf"),
    ),
    operation: v.string(),
    operationKey: v.string(),
    status: v.union(
        v.literal("started"),
        v.literal("succeeded"),
        v.literal("partial"),
        v.literal("failed"),
    ),
    attempt: v.number(),
    latencyMs: v.optional(v.number()),
    usage: v.optional(v.any()),
    reportedCost: v.optional(v.number()),
    providerObservation: v.optional(
        v.object({
            termination: v.optional(
                v.union(
                    providerStreamTerminationValidator,
                    v.object({
                        kind: v.literal("cancelled"),
                        source: v.literal("generation_lookup"),
                        generationId: v.string(),
                        observedAt: v.number(),
                    }),
                ),
            ),
            generationId: v.optional(v.string()),
            observedAt: v.number(),
            httpStatus: v.optional(v.number()),
            requestId: v.optional(v.string()),
        }),
    ),
    structuredOutputPolicy: v.optional(structuredOutputPolicyValidator),
    transportDiagnostic: v.optional(protectedDiagnosticValidator),
    billing: v.optional(
        v.object({
            wakeId: v.optional(v.id("_scheduled_functions")),
            state: v.union(
                v.literal("pending"),
                v.literal("checking"),
                v.literal("confirmed"),
                v.literal("unavailable"),
                v.literal("conflict"),
            ),
            attempt: v.number(),
            updatedAt: v.number(),
            reason: v.optional(
                v.union(
                    v.literal("missing_configuration"),
                    v.literal("not_found"),
                    v.literal("http_error"),
                    v.literal("timeout"),
                    v.literal("response_too_large"),
                    v.literal("invalid_response"),
                    v.literal("transport_error"),
                    v.literal("amount_conflict"),
                ),
            ),
            retryAt: v.optional(v.number()),
            httpStatus: v.optional(v.number()),
            latencyMs: v.optional(v.number()),
        }),
    ),
    errorCode: v.optional(v.string()),
    diagnostic: v.optional(
        v.object({
            reason: v.string(),
            finishReason: v.optional(v.string()),
            output: v.optional(v.string()),
            originalBytes: v.number(),
            truncated: v.boolean(),
        }),
    ),
    retryable: v.optional(v.boolean()),
    dispatchOutcome: v.optional(preparationDispatchOutcomeValidator),
    httpStatus: v.optional(v.number()),
    retryAfterAt: v.optional(v.number()),
    recoveryOfProviderCallId: v.optional(v.id("providerCalls")),
    leaseExpiresAt: v.optional(v.number()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
})
    .index("by_operation_key", ["operationKey"])
    .index("by_operation_request_and_attempt", [
        "operationRequestId",
        "attempt",
    ])
    .index("by_mission_service_status_operation", [
        "missionId",
        "service",
        "status",
        "operation",
    ])
    .index("by_qualification_context_and_status_and_lease", [
        "qualificationContextId",
        "status",
        "leaseExpiresAt",
    ])
    .index("by_qualification_context", ["qualificationContextId"])
    .index("by_run_operation_input_and_attempt", [
        "runId",
        "operation",
        "inputHash",
        "attempt",
    ])
    .index("by_run", ["runId"])
    .index("by_run_and_status_and_created_at", ["runId", "status", "createdAt"])
    .index("by_run_source_operation", ["runId", "sourceId", "operation"])
    .index("by_created_at", ["createdAt"]);
export const serviceValidator = v.union(
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

export const recordAttemptResultValidator = v.object({
    deadlineAt: v.optional(v.number()),
    providerCallId: v.id("providerCalls"),
    shouldExecute: v.boolean(),
    status: providerCallStatusValidator,
    errorCode: v.optional(v.string()),
    retryable: v.optional(v.boolean()),
});

export const providerAttemptValidator = v.object({
    piLease: v.optional(piDispatchLeaseValidator),
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
    diagnostic: providerCallsTable.validator.fields.diagnostic,
    retryable: v.optional(v.boolean()),
    termination: v.optional(providerStreamTerminationValidator),
    dispatchOutcome: v.optional(preparationDispatchOutcomeValidator),
    httpStatus: v.optional(v.number()),
    retryAfterAt: v.optional(v.number()),
});

/** Mission generation cannot carry documentary, review-operation or preparation fields. */
export const missionModelAttemptValidator = providerAttemptValidator.pick(
    "piLease",
    "missionId",
    "invocationId",
    "runId",
    "corpusRevisionId",
    "executionGeneration",
    "workflowVersion",
    "stepKey",
    "service",
    "operation",
    "operationKey",
    "attempt",
    "inputHash",
    "status",
    "diagnostic",
);
