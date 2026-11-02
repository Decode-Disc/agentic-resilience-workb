import { savedMaterialMissionFields } from "@convex/domain/savedMaterialOperations";
import { preparationModelLimitsValidator } from "@convex/domain/sourcePreparationAuthority";
import {
    workbenchCommand,
    workbenchCommandOutcome,
} from "@convex/domain/workbenchContracts";
import { reasoningEffort } from "@convex/modelConfigurationSchema";
import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
    agentResultValidator,
    agentScopeValidator,
    agentStateValidator,
    operationPinValidator,
} from "./agentSchemas";
import {
    agentBackendValidator,
    agentDefinitionIdValidator,
    agentDefinitionVersionValidator,
    executionScopeValidator,
    missionStatusValidator,
    operationOutcomeValidator,
    operationRefusalValidator,
    requestInputValidator,
} from "./executionProtocol";
import { retainedPayloadValidator } from "./operationContracts";

const missionFields = {
    historyProjection: v.optional(
        v.object({
            version: v.literal(1),
            throughSequence: v.number(),
            cursor: v.union(v.string(), v.null()),
            ready: v.boolean(),
        }),
    ),
    modelRevisionId: v.optional(v.id("modelRevisions")),
    reasoningEffort: v.optional(reasoningEffort),
    piActiveWriter: v.optional(v.string()),
    piRebinding: v.optional(v.boolean()),
    executionRuntime: v.optional(v.literal("pi-durable")),
    piWakeId: v.optional(v.id("_scheduled_functions")),
    piWakeAt: v.optional(v.number()),
    piWakeToken: v.optional(v.string()),
    piResultWakePending: v.optional(v.boolean()),
    parentRequestId: v.optional(v.id("agentOperationRequests")),
    rootMissionId: v.optional(v.id("agentMissions")),
    childMissionRequests: v.optional(v.number()),
    generationStorageRef: v.optional(v.string()),
    executionScope: v.optional(executionScopeValidator),
    conversationTurnId: v.optional(v.id("agentConversationTurns")),
    generationBackend: v.optional(agentBackendValidator),
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
    piPublication: defineTable({
        key: v.literal("workers"),
        held: v.boolean(),
    }).index("by_key", ["key"]),
    piSessions: defineTable({
        missionId: v.id("agentMissions"),
        conversationId: v.optional(v.id("agentConversations")),
        settledSequence: v.optional(v.number()),
        settlementAttempts: v.optional(v.number()),
        settlementEpoch: v.optional(v.number()),
        settlementFailureCode: v.optional(v.string()),
        generation: v.number(),
        writer: v.string(),
        epoch: v.number(),
        leaseUntil: v.number(),
        sequence: v.number(),
        nextId: v.number(),
        retainedBytes: v.optional(v.number()),
    })
        .index("by_mission", ["missionId"])
        .index("by_conversation", ["conversationId"])
        .index("by_lease_until", ["leaseUntil"]),
    piCommits: defineTable({
        sessionId: v.id("piSessions"),
        sequence: v.number(),
        key: v.string(),
        payload: v.string(),
    })
        .index("by_session_and_sequence", ["sessionId", "sequence"])
        .index("by_session_and_key", ["sessionId", "key"]),
    agentConversations: defineTable({
        modelCatalogId: v.optional(v.id("modelCatalog")),
        reasoningEffort: v.optional(reasoningEffort),
        modelSelectionRevision: v.optional(v.number()),
        modelSelectionKey: v.optional(v.string()),
        modelSelectionHash: v.optional(v.string()),
        definitionId: v.optional(agentDefinitionIdValidator),
        definitionVersion: v.optional(agentDefinitionVersionValidator),
        queuePaused: v.optional(v.boolean()),
        admissionFailure: v.optional(
            v.object({
                code: v.string(),
                messageId: v.optional(v.id("agentMessageDeliveries")),
            }),
        ),
        runId: v.id("researchRuns"),
        storageRef: v.string(),
        queuedCount: v.number(),
        activeTurnId: v.optional(v.id("agentConversationTurns")),
        createdAt: v.number(),
    }).index("by_run", ["runId"]),
    agentConversationTurns: defineTable({
        runId: v.id("researchRuns"),
        conversationId: v.id("agentConversations"),
        status: v.union(
            v.literal("active"),
            v.literal("published"),
            v.literal("interrupted"),
            v.literal("cancelled"),
        ),
        instructionVersion: v.number(),
        generation: v.number(),
        messageCount: v.number(),
        hasOperations: v.optional(v.boolean()),
        nativeInitialMessageIds: v.optional(
            v.array(v.id("agentMessageDeliveries")),
        ),
        nativeInitialInstructionVersion: v.optional(v.number()),
        missionId: v.optional(v.id("agentMissions")),
        publishedMessageId: v.optional(v.id("agentMessageDeliveries")),
        publicationHash: v.optional(v.string()),
        createdAt: v.number(),
        completedAt: v.optional(v.number()),
    }).index("by_run", ["runId"]),
    agentMessageDeliveries: defineTable({
        runId: v.id("researchRuns"),
        conversationId: v.id("agentConversations"),
        storageMessageRef: v.string(),
        framingBaseRevisionId: v.optional(v.id("framingRevisions")),
        controlCommand: v.optional(
            v.object({
                name: workbenchCommand,
                expectedGeneration: v.number(),
                outcome: workbenchCommandOutcome,
                confirmationMessageId: v.id("agentMessageDeliveries"),
            }),
        ),
        nativeControlStatus: v.optional(
            v.union(v.literal("pending"), v.literal("recorded")),
        ),
        requestKey: v.string(),
        contentHash: v.string(),
        role: v.union(v.literal("user"), v.literal("assistant")),
        delivery: v.union(
            v.literal("queue"),
            v.literal("steer"),
            v.literal("reply"),
            v.literal("control"),
        ),
        status: v.union(
            v.literal("queued"),
            v.literal("removed"),
            v.literal("active"),
            v.literal("processed"),
            v.literal("interrupted"),
        ),
        turnId: v.optional(v.id("agentConversationTurns")),
        createdAt: v.number(),
    })
        .index("by_run_and_key", ["runId", "requestKey"])
        .index("by_run", ["runId"])
        .index("by_run_and_status", ["runId", "status"])
        .index("by_turn", ["turnId"])
        .index("by_run_and_native_control", ["runId", "nativeControlStatus"]),
    agentInvocationPayloads: defineTable({
        invocationId: v.id("agentInvocations"),
        runId: v.id("researchRuns"),
        ...retainedPayloadValidator.fields,
        part: v.union(v.literal("request"), v.literal("reply")),
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
                protocolVersion: v.union(v.literal(2), v.literal(3)),
                scope: agentScopeValidator,
                state: agentStateValidator,
                result: v.optional(agentResultValidator),
            }),
        ),
    )
        .index("by_run_and_request_key", ["runId", "requestKey"])
        .index("by_run_and_objective_key", ["runId", "objectiveKey"])
        .index("by_run_and_status", ["runId", "status"])
        .index("by_pi_active_writer", ["piActiveWriter"]),
    agentInvocations: defineTable({
        purpose: v.optional(v.literal("compaction")),
        generationBackend: v.optional(agentBackendValidator),
        generationStorageRef: v.optional(v.string()),
        journalVersion: v.optional(v.literal(1)),
        conversationTurnId: v.optional(v.id("agentConversationTurns")),
        instructionVersion: v.optional(v.number()),
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
        admissionEventId: v.optional(v.id("agentExecutionEvents")),
        deadlineAt: v.optional(v.number()),
        runId: v.optional(v.id("researchRuns")),
        protocolVersion: v.optional(v.literal(3)),
        missionId: v.optional(v.id("agentMissions")),
        instructionVersion: v.optional(v.number()),
        waitEventId: v.optional(v.string()),
        waitReference: v.optional(v.string()),
        childMissionId: v.optional(v.id("agentMissions")),
        sourceMessageId: v.optional(v.id("agentMessageDeliveries")),
        interpretedNeed: v.optional(v.string()),
        adoptedAt: v.optional(v.number()),
        adoptionRefusalCode: v.optional(v.string()),
        knownNotDispatched: v.optional(v.literal(true)),
        adoptionGeneration: v.optional(v.number()),
        waitNotified: v.optional(v.boolean()),
        expiryJobId: v.optional(v.id("_scheduled_functions")),
        invocationId: v.optional(v.id("agentInvocations")),
        actor: v.union(v.literal("system"), v.literal("agent")),
        cause: v.string(),
        input: requestInputValidator,
        pin: v.optional(operationPinValidator),
        effect: v.optional(
            v.object({
                pin: operationPinValidator,
                outcome: operationOutcomeValidator,
            }),
        ),
        expectedCaptureId: v.optional(v.id("sourceCaptures")),
        expectedContentHash: v.optional(v.string()),
        operationVersion: v.number(),
        expectedGeneration: v.number(),
        logicalKey: v.string(),
        status: v.union(
            v.literal("pending"),
            v.literal("running"),
            v.literal("waiting"),
            v.literal("observed"),
            v.literal("unknown"),
            v.literal("completed"),
        ),
        outcome: v.optional(operationOutcomeValidator),
        createdAt: v.number(),
        completedAt: v.optional(v.number()),
    })
        .index("by_run_and_logical_key", ["runId", "logicalKey"])
        .index("by_mission", ["missionId"])
        .index("by_mission_and_logical_key", ["missionId", "logicalKey"])
        .index("by_mission_and_actor", ["missionId", "actor"])
        .index("by_mission_and_status", ["missionId", "status"])
        .index("by_invocation", ["invocationId"]),
    agentExecutionEvents: defineTable({
        payload: v.optional(retainedPayloadValidator),
        historySourceSequence: v.optional(v.number()),
        actor: v.optional(
            v.union(
                v.object({ type: v.literal("system") }),
                v.object({
                    type: v.literal("agent"),
                    missionId: v.id("agentMissions"),
                }),
                v.object({
                    type: v.literal("visitor"),
                    visitorId: v.id("visitors"),
                }),
            ),
        ),
        parentRequestId: v.optional(v.id("agentOperationRequests")),
        missionId: v.optional(v.id("agentMissions")),
        runId: v.id("researchRuns"),
        sequence: v.optional(v.number()),
        kind: v.string(),
        cause: v.string(),
        invocationId: v.optional(v.id("agentInvocations")),
        requestId: v.optional(v.id("agentOperationRequests")),
        code: v.optional(v.string()),
        admissionOutcome: v.optional(operationRefusalValidator),
        interpretedNeed: v.optional(v.string()),
        generation: v.optional(v.number()),
        instructionVersion: v.optional(v.number()),
        occurredAt: v.number(),
        conversationTurnId: v.optional(v.id("agentConversationTurns")),
        messageId: v.optional(v.id("agentMessageDeliveries")),
    })
        .index("by_mission_and_sequence", ["missionId", "sequence"])
        .index("by_mission_and_history_source", [
            "missionId",
            "historySourceSequence",
        ])
        .index("by_mission_and_kind", ["missionId", "kind"])
        .index("by_invocation_and_kind", ["invocationId", "kind"])
        .index("by_run", ["runId"]),
};
