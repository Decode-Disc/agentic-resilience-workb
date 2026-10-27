import { savedMaterialOperationValidator } from "@convex/domain/savedMaterialOperations";
import { preparationModelLimitsValidator } from "@convex/domain/sourcePreparationAuthority";
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const EXECUTION_VERSION = 1;
export const MAX_CONTEXT_BYTES = 128 * 1024;
export const MAX_OPERATION_RESULT_BYTES = 64 * 1024;
export const MAX_OBSERVABLE_OUTPUT_BYTES = 512 * 1024;
export const MAX_WORKING_NOTES_BYTES = 16 * 1024;
export const MAX_BATCH_REQUESTS = 4;
export const MAX_NO_PROGRESS_TURNS = 3;
export const HISTORY_PAGE_SIZE = 20;
export const EXECUTION_WINDOW_MS = 15 * 60 * 1000;

export const invocationResponseValidator = v.union(
    v.object({
        kind: v.literal("operations"),
        requests: v.array(
            v.object({
                callId: v.string(),
                name: v.string(),
                inputJson: v.string(),
            }),
        ),
        workingNotes: v.optional(v.string()),
    }),
    v.object({
        kind: v.literal("complete"),
        captureIds: v.array(v.id("sourceCaptures")),
        workingNotes: v.optional(v.string()),
    }),
    v.object({ kind: v.literal("blocked"), code: v.string() }),
);

export const requestInputValidator = v.union(
    savedMaterialOperationValidator,
    v.object({
        kind: v.literal("invalid"),
        name: v.string(),
        inputJson: v.string(),
    }),
);

export const operationOutcomeValidator = v.union(
    v.object({
        kind: v.literal("success"),
        valueJson: v.string(),
        captureId: v.optional(v.id("sourceCaptures")),
        progressKey: v.optional(v.string()),
        progressKeys: v.optional(v.array(v.string())),
    }),
    v.object({ kind: v.literal("unavailable"), code: v.string() }),
    v.object({ kind: v.literal("refused"), code: v.string() }),
);

export const missionStatusValidator = v.union(
    v.literal("ready"),
    v.literal("running"),
    v.literal("waiting"),
    v.literal("completed"),
    v.literal("blocked"),
    v.literal("cancelled"),
);

export const executionTables = {
    agentMissions: defineTable({
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        ownerVisitorId: v.id("visitors"),
        definitionId: v.literal("saved_material_inspection_v1"),
        definitionVersion: v.literal(1),
        requestKey: v.string(),
        objectiveKey: v.string(),
        generation: v.number(),
        deadlineAt: v.number(),
        modelLimits: preparationModelLimitsValidator,
        status: missionStatusValidator,
        blockCode: v.optional(v.string()),
        workflowId: v.optional(v.string()),
        provenance: v.optional(
            v.union(v.literal("live"), v.literal("simulation")),
        ),
        lastInvocationId: v.optional(v.id("agentInvocations")),
        lastSettledInvocationId: v.optional(v.id("agentInvocations")),
        noProgressTurns: v.number(),
        progressKeys: v.array(v.string()),
        inspectedCaptureIds: v.array(v.id("sourceCaptures")),
        workingNotes: v.string(),
        obligations: v.array(v.string()),
        completionRefs: v.array(v.id("sourceCaptures")),
        nextEventSequence: v.number(),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_run_and_request_key", ["runId", "requestKey"])
        .index("by_run_and_objective_key", ["runId", "objectiveKey"])
        .index("by_run_and_status", ["runId", "status"]),
    agentInvocations: defineTable({
        missionId: v.optional(v.id("agentMissions")),
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        generation: v.number(),
        definitionVersion: v.number(),
        taskKey: v.string(),
        provenance: v.union(v.literal("live"), v.literal("simulation")),
        status: v.union(
            v.literal("started"),
            v.literal("returned"),
            v.literal("blocked"),
        ),
        inputJson: v.string(),
        outputJson: v.optional(v.string()),
        rawOutputJson: v.optional(v.string()),
        receivedOutputJson: v.optional(v.string()),
        requestIds: v.optional(v.array(v.id("agentOperationRequests"))),
        providerCallId: v.optional(v.id("providerCalls")),
        blockCode: v.optional(v.string()),
        createdAt: v.number(),
        progressCount: v.optional(v.number()),
        completedAt: v.optional(v.number()),
    })
        .index("by_mission", ["missionId"])
        .index("by_run_and_task_key", ["runId", "taskKey"]),
    agentOperationRequests: defineTable({
        missionId: v.id("agentMissions"),
        invocationId: v.optional(v.id("agentInvocations")),
        actor: v.union(v.literal("system"), v.literal("agent")),
        cause: v.string(),
        input: requestInputValidator,
        expectedCaptureId: v.optional(v.id("sourceCaptures")),
        expectedContentHash: v.optional(v.string()),
        operationVersion: v.literal(1),
        expectedGeneration: v.number(),
        logicalKey: v.string(),
        status: v.union(
            v.literal("pending"),
            v.literal("running"),
            v.literal("completed"),
        ),
        outcome: v.optional(operationOutcomeValidator),
        createdAt: v.number(),
        completedAt: v.optional(v.number()),
    })
        .index("by_mission", ["missionId"])
        .index("by_mission_and_logical_key", ["missionId", "logicalKey"])
        .index("by_mission_and_status", ["missionId", "status"])
        .index("by_invocation", ["invocationId"]),
    agentExecutionEvents: defineTable({
        missionId: v.id("agentMissions"),
        runId: v.id("researchRuns"),
        sequence: v.number(),
        kind: v.string(),
        cause: v.string(),
        invocationId: v.optional(v.id("agentInvocations")),
        requestId: v.optional(v.id("agentOperationRequests")),
        code: v.optional(v.string()),
        occurredAt: v.number(),
    }).index("by_mission_and_sequence", ["missionId", "sequence"]),
};
