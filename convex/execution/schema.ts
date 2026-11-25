import { framingCitationPolicy } from "@convex/domain/framingContracts";
import { savedMaterialMissionFields } from "@convex/domain/savedMaterialOperations";
import { preparationModelLimitsValidator } from "@convex/domain/sourcePreparationAuthority";
import {
    sourcesCompletionAdmission,
    sourcesOperationAdmission,
} from "@convex/domain/sourcesContracts";
import { auditActorValidator } from "@convex/domain/validators";
import {
    workbenchCommand,
    workbenchCommandOutcome,
    workbenchOperationAdmission,
} from "@convex/domain/workbenchContracts";
import {
    responseControlState,
    responseControlSummary,
    workbenchCompletionAdmission,
} from "@convex/domain/workbenchResponseControlContracts";
import { reasoningEffort } from "@convex/modelConfigurationSchema";
import { vEventId } from "@convex-dev/workflow";
import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
    agentResultValidator,
    agentScopeValidator,
    agentStateValidator,
    operationPinValidator,
} from "./agentSchemas";
import {
    approvalActionValidator,
    approvalDecisionValidator,
    approvalRequesterValidator,
    storedApprovalStatusValidator,
} from "./approvalContracts";
import {
    agentBackendValidator,
    agentDefinitionIdValidator,
    agentDefinitionVersionValidator,
    executionScopeValidator,
    generationAuthorityValidator,
    missionStatusValidator,
    operationOutcomeValidator,
    operationRefusalValidator,
    requestInputValidator,
} from "./executionProtocol";
import {
    completionFeedbackValidator,
    historyReadReceiptValidator,
    protectedDiagnosticValidator,
    retainedPayloadValidator,
} from "./operationContracts";
import { textManifestValidator } from "./retainedText";

const retainedTextCheckpointValidator = v.object({
    words: v.array(v.number()),
    tail: v.array(v.number()),
    sizeBytes: v.number(),
});

export const nativeInputBodyValidator = v.union(
    v.object({ messageId: v.id("agentMessageDeliveries"), text: v.string() }),
    v.object({
        messageId: v.id("agentMessageDeliveries"),
        contentHash: v.string(),
    }),
);

export const nativeInputsValidator = v.array(
    v.object({
        requestId: v.string(),
        nativeInputSequence: v.number(),
        instructionVersion: v.number(),
        messages: v.array(nativeInputBodyValidator),
    }),
);

const missionFields = {
    completionEventId: v.optional(vEventId()),
    completionNotified: v.optional(v.boolean()),
    historyMaterialSequence: v.optional(v.number()),
    historyProjection: v.optional(
        v.object({
            version: v.literal(1),
            throughSequence: v.number(),
            cursor: v.union(v.string(), v.null()),
            ready: v.boolean(),
            snapshot: v.optional(
                v.object({
                    anchorSequence: v.number(),
                    throughSequence: v.number(),
                }),
            ),
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
    ...generationAuthorityValidator.fields,
    modelLimits: preparationModelLimitsValidator,
    status: missionStatusValidator,
    blockCode: v.optional(v.string()),
    workflowId: v.optional(v.string()),
    provenance: v.optional(v.union(v.literal("live"), v.literal("simulation"))),
    lastInvocationId: v.optional(v.id("agentInvocations")),
    firstProviderInput: v.optional(
        v.object({
            invocationId: v.id("agentInvocations"),
            providerCallId: v.id("providerCalls"),
            contentHash: v.string(),
        }),
    ),
    lastSettledInvocationId: v.optional(v.id("agentInvocations")),
    noProgressTurns: v.number(),
    recoveryRead: v.optional(
        v.object({
            refusalInvocationId: v.id("agentInvocations"),
            restorationInvocationId: v.optional(v.id("agentInvocations")),
        }),
    ),
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
        retainedStreamUpgrade: v.optional(
            v.union(
                v.literal("draining"),
                v.literal("frozen"),
                v.literal("active"),
            ),
        ),
    }).index("by_key", ["key"]),
    piSessions: defineTable({
        publicPreview: v.optional(
            v.object({
                turnId: v.id("agentConversationTurns"),
                invocationId: v.id("agentInvocations"),
                instructionVersion: v.number(),
                sequence: v.number(),
                text: v.string(),
            }),
        ),
        observationSequence: v.optional(v.number()),
        observationEntry: v.optional(v.number()),
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
    retainedTexts: defineTable({
        key: v.string(),
        stream: v.optional(
            v.object({
                sealed: v.boolean(),
                nextSequence: v.number(),
                lastAppendHash: v.optional(v.string()),
                fragments: v.number(),
                tail: v.string(),
            }),
        ),
        ...textManifestValidator.fields,
        received: v.number(),
        receivedBytes: v.number(),
        receivedCharacters: v.number(),
        fragmentEnds: v.array(v.number()),
        checkpoint: v.optional(retainedTextCheckpointValidator),
        streamManifestReady: v.optional(v.literal(true)),
        streamManifestBackfill: v.optional(
            v.object({
                frontier: v.string(),
                checkpoint: retainedTextCheckpointValidator,
            }),
        ),
    })
        .index("by_key", ["key"])
        .index("by_stream_manifest_readiness", [
            "stream.sealed",
            "streamManifestReady",
        ]),
    retainedTextFragments: defineTable({
        textId: v.id("retainedTexts"),
        index: v.number(),
        content: v.string(),
    }).index("by_text_and_index", ["textId", "index"]),
    piCommits: defineTable({
        sessionId: v.id("piSessions"),
        sequence: v.number(),
        key: v.string(),
        payload: v.optional(v.string()),
        textId: v.optional(v.id("retainedTexts")),
    })
        .index("by_session_and_sequence", ["sessionId", "sequence"])
        .index("by_session_and_key", ["sessionId", "key"]),
    agentConversations: defineTable({
        storageMigrationFrozen: v.optional(v.literal(true)),
        storageMigrationEpoch: v.optional(v.number()),
        storageMigrationSourceHash: v.optional(v.string()),
        nativeInputSequence: v.optional(v.number()),
        publicationRevision: v.optional(v.number()),
        responseFactsRevisionHash: v.optional(v.string()),
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
        storageRef: v.optional(v.string()),
        queuedCount: v.number(),
        activeTurnId: v.optional(v.id("agentConversationTurns")),
        createdAt: v.number(),
    })
        .index("by_run", ["runId"])
        .index("by_storage_ref", ["storageRef"]),
    agentConversationTurns: defineTable({
        responseControl: v.optional(responseControlState),
        framingCitationPolicy: v.optional(framingCitationPolicy),
        preview: v.optional(
            v.object({
                invocationId: v.id("agentInvocations"),
                instructionVersion: v.number(),
                sequence: v.number(),
                text: v.string(),
            }),
        ),
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
        nativeInputSequence: v.optional(v.number()),
        responseControl: v.optional(responseControlSummary),
        publicationRevision: v.optional(v.number()),
        runId: v.id("researchRuns"),
        conversationId: v.id("agentConversations"),
        storageMessageRef: v.optional(v.string()),
        bodyTextId: v.optional(v.id("retainedTexts")),
        bodyContentHash: v.optional(v.string()),
        storageMigrationCopy: v.optional(
            v.object({
                sourceIdentity: v.string(),
                textId: v.id("retainedTexts"),
                verifiedHash: v.optional(v.string()),
            }),
        ),
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
        approvalRequestId: v.optional(v.id("approvalRequests")),
        approvalDecision: v.optional(
            v.object({
                requestId: v.id("approvalRequests"),
                confirmationMessageId: v.id("agentMessageDeliveries"),
            }),
        ),
        requestKey: v.string(),
        contentHash: v.string(),
        role: v.union(v.literal("user"), v.literal("assistant")),
        delivery: v.union(
            v.literal("queue"),
            v.literal("steer"),
            v.literal("reply"),
            v.literal("control"),
            v.literal("notice"),
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
        .index("by_body_text", ["bodyTextId"])
        .index("by_run", ["runId"])
        .index("by_run_and_status", ["runId", "status"])
        .index("by_turn", ["turnId"])
        .index("by_run_and_native_control", ["runId", "nativeControlStatus"])
        .index("by_run_and_delivery_and_native_input_sequence", [
            "runId",
            "delivery",
            "nativeInputSequence",
        ]),
    agentInvocationPayloads: defineTable({
        invocationId: v.id("agentInvocations"),
        runId: v.id("researchRuns"),
        ...retainedPayloadValidator.fields,
        part: v.union(v.literal("request"), v.literal("reply")),
        effectiveMaxOutputTokens: v.optional(v.number()),
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
                resultTextId: v.optional(v.id("retainedTexts")),
                legacyTextualResultCopy: v.optional(
                    v.object({
                        sourceIdentity: v.string(),
                        textId: v.id("retainedTexts"),
                    }),
                ),
                textualOutcome: v.optional(
                    v.object({
                        version: v.literal(1),
                        ownership: v.optional(v.literal("mission")),
                        kind: v.union(
                            v.literal("workbench_v1"),
                            v.literal("conversation_validation_v1"),
                        ),
                        textId: v.id("retainedTexts"),
                        contentHash: v.string(),
                    }),
                ),
            }),
        ),
    )
        .index("by_run_and_request_key", ["runId", "requestKey"])
        .index("by_run_and_objective_key", ["runId", "objectiveKey"])
        .index("by_run_and_status", ["runId", "status"])
        .index("by_pi_active_writer", ["piActiveWriter"]),
    agentInvocations: defineTable({
        visibleOutput: v.optional(
            v.object({
                textId: v.id("retainedTexts"),
                complete: v.boolean(),
                contentHash: v.optional(v.string()),
                sizeBytes: v.optional(v.number()),
                terminalReason: v.optional(v.string()),
            }),
        ),
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
        inputTextId: v.optional(v.id("retainedTexts")),
        sourcesOperationAdmission: v.optional(sourcesOperationAdmission),
        sourcesCompletionAdmission: v.optional(sourcesCompletionAdmission),
        workbenchOperationAdmission: v.optional(workbenchOperationAdmission),
        workbenchCompletionAdmission: v.optional(workbenchCompletionAdmission),
        inputContentHash: v.optional(v.string()),
        preparationInputHash: v.optional(v.string()),
        nativePreparation: v.optional(
            v.object({
                observationSequence: v.optional(v.number()),
                controlSequence: v.optional(v.number()),
                serializer: v.string(),
                inputHash: v.string(),
                toolSetKey: v.string(),
                instructionsHash: v.string(),
            }),
        ),
        outputJson: v.optional(v.string()),
        outputTextId: v.optional(v.id("retainedTexts")),
        rawOutputJson: v.optional(v.string()),
        rawOutputTextId: v.optional(v.id("retainedTexts")),
        receivedOutputJson: v.optional(v.string()),
        receivedOutputTextId: v.optional(v.id("retainedTexts")),
        correction: v.optional(completionFeedbackValidator),
        nativeOperations: v.optional(
            v.object({
                responseHash: v.string(),
                calls: v.array(
                    v.object({
                        callId: v.string(),
                        completion: v.optional(v.literal(true)),
                    }),
                ),
            }),
        ),
        nativeCompletion: v.optional(
            v.object({
                callId: v.string(),
                responseHash: v.string(),
            }),
        ),
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
        .index("by_mission_and_status", ["missionId", "status"])
        .index("by_run_and_task_key", ["runId", "taskKey"]),
    agentOperationRequests: defineTable({
        historyRead: v.optional(historyReadReceiptValidator),
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
        scheduledJobId: v.optional(v.id("_scheduled_functions")),
        scheduledStartedAt: v.optional(v.number()),
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
        .index("by_run_and_status", ["runId", "status"])
        .index("by_preparation_and_status", ["pin.preparationId", "status"])
        .index("by_documentary_preparation_and_status", [
            "pin.scope.preparationId",
            "pin.scope.kind",
            "status",
        ])
        .index("by_mission", ["missionId"])
        .index("by_mission_and_logical_key", ["missionId", "logicalKey"])
        .index("by_mission_and_actor", ["missionId", "actor"])
        .index("by_mission_and_status", ["missionId", "status"])
        .index("by_mission_and_input_kind", ["missionId", "input.kind"])
        .index("by_run_and_input_kind", [
            "runId",
            "input.kind",
            "input.continuation",
        ])
        .index("by_invocation", ["invocationId"]),
    agentExecutionEvents: defineTable({
        nativeInputSequence: v.optional(v.number()),
        contextHistoryHash: v.optional(v.string()),
        contextObservation: v.optional(
            v.object({
                version: v.literal(1),
                key: v.string(),
                topic: v.union(
                    v.literal("framing"),
                    v.literal("research"),
                    v.literal("documentary"),
                    v.literal("analyst_request"),
                    v.literal("analyst_decision"),
                ),
                textId: v.id("retainedTexts"),
            }),
        ),
        protectedDiagnostic: v.optional(protectedDiagnosticValidator),
        invocationPayloadId: v.optional(v.id("agentInvocationPayloads")),
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
        .index("by_run_and_native_input_sequence", [
            "runId",
            "nativeInputSequence",
        ])
        .index("by_run_and_context_key", ["runId", "contextObservation.key"])
        .index("by_kind_and_context_history_hash", [
            "kind",
            "contextHistoryHash",
        ])
        .index("by_mission_and_sequence", ["missionId", "sequence"])
        .index("by_mission_and_history_source", [
            "missionId",
            "historySourceSequence",
        ])
        .index("by_mission_and_kind", ["missionId", "kind"])
        .index("by_request_and_kind", ["requestId", "kind"])
        .index("by_invocation_and_kind", ["invocationId", "kind"])
        .index("by_run", ["runId"]),
    approvalRequests: defineTable({
        runId: v.id("researchRuns"),
        action: approvalActionValidator,
        alternative: v.optional(approvalActionValidator),
        requestedBy: approvalRequesterValidator,
        expectedGeneration: v.number(),
        status: storedApprovalStatusValidator,
        decision: v.optional(approvalDecisionValidator),
        createdAt: v.number(),
    })
        .index("by_run_and_status", ["runId", "status"])
        .index("by_run_action_generation", [
            "runId",
            "action",
            "expectedGeneration",
        ]),
    approvalGrants: defineTable({
        runId: v.id("researchRuns"),
        action: approvalActionValidator,
        grantedBy: auditActorValidator,
        grantedAt: v.number(),
        revokedAt: v.optional(v.number()),
        revokedBy: v.optional(auditActorValidator),
    }).index("by_run_and_action", ["runId", "action"]),
};
