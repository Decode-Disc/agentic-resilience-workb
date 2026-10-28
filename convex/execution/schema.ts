import { savedMaterialMissionFields } from "@convex/domain/savedMaterialOperations";
import { preparationModelLimitsValidator } from "@convex/domain/sourcePreparationAuthority";
import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
    agentResultValidator,
    agentScopeValidator,
    agentStateValidator,
    operationPinValidator,
} from "./agentSchemas";
import {
    agentDefinitionIdValidator,
    agentDefinitionVersionValidator,
    missionStatusValidator,
    operationOutcomeValidator,
    requestInputValidator,
} from "./executionProtocol";

const missionFields = {
    runId: v.id("researchRuns"),
    ownerVisitorId: v.id("visitors"),
    definitionId: agentDefinitionIdValidator,
    definitionVersion: agentDefinitionVersionValidator,
    requestKey: v.string(),
    objectiveKey: v.string(),
    generation: v.number(),
    deadlineAt: v.number(),
    modelLimits: preparationModelLimitsValidator,
    status: missionStatusValidator,
    blockCode: v.optional(v.string()),
    workflowId: v.optional(v.string()),
    provenance: v.optional(v.union(v.literal("live"), v.literal("simulation"))),
    lastInvocationId: v.optional(v.id("agentInvocations")),
    lastSettledInvocationId: v.optional(v.id("agentInvocations")),
    noProgressTurns: v.number(),
    progressKeys: v.array(v.string()),
    workingNotes: v.string(),
    obligations: v.array(v.string()),
    nextEventSequence: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
};

export const executionTables = {
    agentInvocationPayloads: defineTable({
        invocationId: v.id("agentInvocations"),
        runId: v.id("researchRuns"),
        version: v.literal(1),
        part: v.union(v.literal("request"), v.literal("reply")),
        state: v.union(v.literal("complete"), v.literal("incomplete")),
        json: v.optional(v.string()),
        contentHash: v.optional(v.string()),
        sizeBytes: v.number(),
        code: v.optional(v.string()),
        createdAt: v.number(),
    }).index("by_invocation_and_part", ["invocationId", "part"]),
    agentMissions: defineTable(
        v.union(
            v.object({
                ...missionFields,
                definitionId: v.literal("saved_material_inspection_v1"),
                corpusRevisionId: v.id("corpusRevisions"),
                ...savedMaterialMissionFields,
                completionRefs: v.array(v.id("sourceCaptures")),
            }),
            v.object({
                ...missionFields,
                protocolVersion: v.literal(2),
                scope: agentScopeValidator,
                state: agentStateValidator,
                result: v.optional(agentResultValidator),
            }),
        ),
    )
        .index("by_run_and_request_key", ["runId", "requestKey"])
        .index("by_run_and_objective_key", ["runId", "objectiveKey"])
        .index("by_run_and_status", ["runId", "status"]),
    agentInvocations: defineTable({
        journalVersion: v.optional(v.literal(1)),
        missionId: v.optional(v.id("agentMissions")),
        runId: v.id("researchRuns"),
        corpusRevisionId: v.optional(v.id("corpusRevisions")),
        scopeKey: v.optional(v.string()),
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
        receivedWhileAuthorized: v.optional(v.boolean()),
        adoptionGeneration: v.optional(v.number()),
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
        pin: v.optional(operationPinValidator),
        expectedCaptureId: v.optional(v.id("sourceCaptures")),
        expectedContentHash: v.optional(v.string()),
        operationVersion: v.number(),
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
        missionId: v.optional(v.id("agentMissions")),
        runId: v.id("researchRuns"),
        sequence: v.optional(v.number()),
        kind: v.string(),
        cause: v.string(),
        invocationId: v.optional(v.id("agentInvocations")),
        requestId: v.optional(v.id("agentOperationRequests")),
        code: v.optional(v.string()),
        occurredAt: v.number(),
    })
        .index("by_mission_and_sequence", ["missionId", "sequence"])
        .index("by_run", ["runId"]),
};
