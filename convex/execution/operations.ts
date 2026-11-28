import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    type ActionCtx,
    internalAction,
    internalMutation,
    internalQuery,
    type MutationCtx,
    type QueryCtx,
} from "@convex/_generated/server";
import { readResearchState } from "@convex/domain/researchState";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { requireInstructionVersion } from "@convex/execution/conversationCore";
import { pauseResearchAtBoundary } from "@convex/execution/researchControlCore";
import {
    CONVEX_NODE_ACTION_TIMEOUT_MS,
    DOSSIER_PURGE_PARENT_SCAN_BYTES,
    EXECUTION_WINDOW_MS,
    MAX_OPERATION_RESULT_BYTES,
} from "@convex/resourcePolicy";
import { workflow } from "@convex/workflow";
import type { EventId, WorkflowId } from "@convex-dev/workflow";
import { type Infer, v } from "convex/values";
import { validate } from "convex-helpers/validators";
import { getAgentDefinition, getNativeOperation } from "./agentCatalog";
import type { AgentProgress } from "./agentDefinition";
import {
    agentDefinitionIdValidator,
    operationPinValidator,
} from "./agentSchemas";
import {
    executionError,
    executionFailureCode,
    readOperationCause,
    recordMissionEvent,
    requireDossierAuthority,
    requireMissionAuthority,
    requireRunAuthority,
} from "./authority";
import { classifyDispatchFailure, protectedDiagnostic } from "./errors";
import {
    type AgentOperationDefinition,
    type OperationExecutionResult,
    operationHasStarted,
    operationInputValidator,
    operationOutcomeValidator,
    type operationRefusalValidator,
    ownsScheduledEpoch,
    requestInputValidator,
    type ScheduledOperationArgs,
    scheduledOperationArgs,
    validateOperationExecutionResult,
} from "./executionProtocol";
import {
    prepareMissionHistorySnapshot,
    verifyHistoryReadReceipt,
} from "./history";
import {
    operationEventObservation,
    retainExecutionEventPayload,
} from "./journal";
import {
    domainDataPatch,
    operationIdentityScope,
    retainedOperationPin,
} from "./missionData";
import {
    currentRunStateResultValidator,
    dispatchFailureValidator,
    historyReadReceiptValidator,
    historySourceFor,
    isCommonConsultation,
} from "./operationContracts";
import { validateOperationValue } from "./operationResults";
import { schedulePiMission } from "./piControl";
import {
    piDispatchLeaseValidator,
    requirePiDispatchLease,
    sessionForMission,
} from "./piSession";
import { adoptProgress, agentProgressValidator } from "./progress";
import {
    deleteOperationObservationBatch,
    stageOperationObservation,
    textFragmentValidator,
} from "./retainedText";
import { missionDocument } from "./tableValidators";

type Outcome = Infer<typeof operationOutcomeValidator>;
type Input = Infer<typeof requestInputValidator>;

/** Remove dossier-owned observations before the request that names them. */
export async function purgeDossierOperationBatch(
    ctx: MutationCtx,
    runId: Id<"researchRuns">,
    limit: number,
) {
    const { page: requests, isDone } = await ctx.db
        .query("agentOperationRequests")
        .withIndex("by_run_and_status", (q) => q.eq("runId", runId))
        .paginate({
            cursor: null,
            numItems: limit,
            maximumBytesRead: DOSSIER_PURGE_PARENT_SCAN_BYTES,
        });
    for (const request of requests) {
        const drained = await deleteOperationObservationBatch(
            ctx,
            request._id,
            limit,
        );
        if (drained === false) return true;
        await ctx.db.delete(request._id);
        if (drained) return true;
    }
    return !isDone;
}

/** Runs in the scheduled action itself; no parent action remains open to await another worker. */
export async function executeScheduledOperation(
    ctx: ActionCtx,
    args: ScheduledOperationArgs,
    execute: () => Promise<Outcome>,
): Promise<Outcome | null> {
    let phase: Parameters<typeof classifyDispatchFailure>[1] =
        "before_callback";
    try {
        const started = await ctx.runMutation(
            internal.execution.operations.beginScheduledExecution,
            args,
        );
        if (!started) return null;
        phase = "effect_callback";
        const outcome = await execute();
        return await ctx.runMutation(
            internal.execution.operations.recordResult,
            {
                ...args,
                outcome,
            },
        );
    } catch (error) {
        return ctx.runMutation(
            internal.execution.operations.settleDispatchFailure,
            {
                ...args,
                failure: classifyDispatchFailure(error, phase),
            },
        );
    }
}

/** Binds settlement of an engaged operation to an authorized research workflow without redispatching it. */
export async function registerOperationWaitEvent(
    ctx: MutationCtx,
    args: {
        requestId: Id<"agentOperationRequests">;
        workflowId: WorkflowId;
        expectedGeneration: number;
    },
): Promise<EventId | null> {
    const request = await ctx.db.get(args.requestId);
    if (!request) throw executionError("operation_unavailable");
    const runId =
        request.runId ??
        (request.missionId
            ? (await ctx.db.get(request.missionId))?.runId
            : undefined);
    if (!runId) throw executionError("operation_scope_invalid");
    const { run } = await requireRunAuthority(
        ctx,
        runId,
        args.expectedGeneration,
    );
    if (run.workflowId !== args.workflowId)
        throw executionError("stale_execution");
    if (!["running", "waiting"].includes(request.status)) return null;
    if (request.waitEventId) return request.waitEventId as EventId;
    const eventId = await workflow.createEvent(ctx, {
        name: `operation:${request._id}`,
        workflowId: args.workflowId,
    });
    await ctx.db.patch(request._id, {
        waitEventId: eventId,
        waitNotified: false,
    });
    return eventId;
}

function declaredOperation(input: Input, mission?: Doc<"agentMissions">) {
    return input.kind === "invalid"
        ? undefined
        : mission
          ? getAgentDefinition(mission.definitionId, mission.definitionVersion)
                .operations[input.kind]
          : getNativeOperation(input.kind);
}

function operationFor(input: Input, mission?: Doc<"agentMissions">) {
    const operation = declaredOperation(input, mission);
    if (!operation) throw executionError("operation_not_allowed");
    return operation;
}
async function recordEvent(
    ctx: MutationCtx,
    request: Doc<"agentOperationRequests">,
    kind: string,
    code?: string,
    admissionOutcome?: Infer<typeof operationRefusalValidator>,
    options?: {
        historySource?: true;
        diagnostic?: Doc<"agentExecutionEvents">["protectedDiagnostic"];
    },
) {
    const event = {
        kind,
        cause: request.cause,
        invocationId: request.invocationId,
        requestId: request._id,
        code,
        protectedDiagnostic: options?.diagnostic,
        admissionOutcome,
        messageId: request.sourceMessageId,
        interpretedNeed: request.interpretedNeed,
        generation: request.expectedGeneration,
        instructionVersion: request.instructionVersion,
        actor:
            request.actor === "agent" && request.missionId
                ? { type: "agent" as const, missionId: request.missionId }
                : { type: "system" as const },
    };
    const mission = request.missionId
        ? await ctx.db.get(request.missionId)
        : null;
    const historySource =
        !isCommonConsultation(request.input.kind) &&
        (kind === "operation_effect_applied" ||
            options?.historySource === true);
    let eventId: Id<"agentExecutionEvents">;
    if (mission)
        eventId = await recordMissionEvent(ctx, mission, {
            ...event,
            historySource: historySource ? "material" : undefined,
        });
    else if (request.runId)
        eventId = await ctx.db.insert("agentExecutionEvents", {
            ...event,
            runId: request.runId,
            occurredAt: Date.now(),
        });
    else throw executionError("request_unavailable");
    const observation = operationEventObservation(
        request,
        kind,
        admissionOutcome,
    );
    if (observation !== undefined)
        await retainExecutionEventPayload(ctx, eventId, observation);
    return eventId;
}

async function requestAtAdmission(
    ctx: QueryCtx,
    request: Doc<"agentOperationRequests">,
) {
    const cause = await readOperationCause(
        ctx,
        request,
        request.admissionEventId,
    );
    if (!cause) return request;
    return {
        ...request,
        actor:
            cause.actor?.type === "agent"
                ? ("agent" as const)
                : ("system" as const),
        cause: cause.cause,
        invocationId: cause.invocationId,
        sourceMessageId: cause.messageId,
        interpretedNeed: cause.interpretedNeed,
        instructionVersion: cause.instructionVersion,
    };
}
async function authority(
    ctx: QueryCtx,
    request: Doc<"agentOperationRequests">,
    expectedGeneration: number,
) {
    const admittedRequest = await requestAtAdmission(ctx, request);
    const mission = request.missionId
        ? (
              await requireMissionAuthority(
                  ctx,
                  request.missionId,
                  expectedGeneration,
              )
          ).mission
        : undefined;
    // Invalid inputs have a terminal admission receipt, not an executable operation.
    if (request.input.kind === "invalid") {
        if (!mission) throw executionError("not_authorized");
        await requireInstructionVersion(
            ctx,
            mission,
            admittedRequest.instructionVersion,
        );
        if (
            request.status !== "completed" ||
            !request.knownNotDispatched ||
            request.outcome?.kind !== "refused" ||
            request.outcome.code !==
                (request.input.refusalCode ?? "invalid_operation_input")
        )
            throw executionError("invalid_operation_input");
        return {
            mission,
            runId: mission.runId,
            admittedRequest,
            operation: undefined,
        };
    }
    const operation = operationFor(request.input, mission);
    if (operation.systemOnly && request.actor !== "system")
        throw executionError("operation_not_allowed");
    const runId = mission?.runId ?? request.runId;
    if (!runId) throw executionError("not_authorized");
    if (!mission) {
        if (request.actor !== "system" || !operation.nativeAuthority)
            throw executionError("operation_not_allowed");
        const state =
            operation?.nativeAuthority === "research"
                ? await requireRunAuthority(ctx, runId, expectedGeneration)
                : await requireDossierAuthority(ctx, runId);
        if (state.run.executionGeneration !== expectedGeneration)
            throw executionError("stale_execution");
        if (
            request.status !== "completed" &&
            request.deadlineAt !== undefined &&
            request.deadlineAt <= Date.now()
        )
            throw executionError("execution_deadline");
    } else
        await requireInstructionVersion(
            ctx,
            mission,
            admittedRequest.instructionVersion,
        );
    const retiredDocumentaryOperation =
        request.operationVersion === 2 &&
        operation.version === 3 &&
        (request.input.kind === "submit_documentary_qualification" ||
            request.input.kind === "request_documentary_check");
    if (
        request.status === "completed" &&
        (isCommonConsultation(request.input.kind) ||
            (retiredDocumentaryOperation && request.outcome)) &&
        request.operationVersion !== operation.version
    )
        return { mission, runId };
    if (
        (request.status !== "completed" &&
            (request.adoptionGeneration ?? request.expectedGeneration) !==
                expectedGeneration) ||
        request.operationVersion !== operation.version
    )
        throw executionError(
            (isCommonConsultation(request.input.kind) ||
                retiredDocumentaryOperation) &&
                request.operationVersion !== operation.version
                ? "operation_version_conflict"
                : "stale_execution",
        );
    const expectedPin = request.effect?.pin ?? retainedOperationPin(request);
    const pin = await operation.pin(
        ctx,
        mission,
        request.input,
        runId,
        isCommonConsultation(request.input.kind)
            ? request.pin
            : request.effect?.pin,
    );
    if (pin.kind !== "available") throw executionError(pin.code);
    if (stableStringify(pin.pin) !== stableStringify(expectedPin))
        throw executionError("version_conflict");
    return { mission, operation, runId, admittedRequest };
}

/** Validates the receipt before transactions that must preflight their domain write. */
export async function prepareOperationEffect(
    ctx: MutationCtx,
    request: Doc<"agentOperationRequests">,
    value: unknown,
) {
    const operation = operationFor(
        request.input,
        request.missionId
            ? ((await ctx.db.get(request.missionId)) ?? undefined)
            : undefined,
    );
    const valueJson = JSON.stringify(
        validateOperationValue(operation.resultValidator, value, ctx.db),
    );
    const outcome = await operation.validateOutcome(
        request,
        { kind: "success", valueJson },
        ctx,
    );
    if (
        outcome.kind !== "success" ||
        new TextEncoder().encode(outcome.valueJson).length >
            MAX_OPERATION_RESULT_BYTES
    )
        throw executionError("operation_result_capacity");
    return { valueJson, outcome };
}

/** Persists a native effect's receipt atomically with its domain write, without replacing its admission pin. */
export async function retainOperationEffect(
    ctx: MutationCtx,
    request: Doc<"agentOperationRequests">,
    pin: import("./agentDefinition").OperationPin,
    value: unknown,
) {
    const { valueJson, outcome } = await prepareOperationEffect(
        ctx,
        request,
        value,
    );
    const effect = { pin, outcome };
    if (request.effect) {
        if (stableStringify(request.effect) !== stableStringify(effect))
            throw executionError("operation_result_conflict");
        return valueJson;
    }
    if (!operationHasStarted(request))
        throw executionError("operation_not_dispatched");
    await ctx.db.patch(request._id, { effect });
    await recordEvent(ctx, { ...request, effect }, "operation_effect_applied");
    return valueJson;
}

/** One retained logical request drives both system calls and deferred model tools. */
export async function persistOperationRequest(
    ctx: MutationCtx,
    mission: Doc<"agentMissions"> | undefined,
    args: {
        runId?: Id<"researchRuns">;
        expectedGeneration?: number;
        invocationId?: Id<"agentInvocations">;
        actor: "system" | "agent";
        cause: string;
        input: Input;
        sourceMessageId?: Id<"agentMessageDeliveries">;
        interpretedNeed?: string;
    },
) {
    if (!args.cause || args.cause.length > 160)
        throw executionError("invalid_operation_cause");
    const runId = mission?.runId ?? args.runId;
    if (!runId) throw executionError("not_authorized");
    if (args.sourceMessageId) {
        const message = await ctx.db.get(args.sourceMessageId);
        if (
            message?.runId !== runId ||
            message.role !== "user" ||
            (mission?.conversationTurnId &&
                message.turnId !== mission.conversationTurnId)
        )
            throw executionError("instruction_correlation_invalid");
    }
    if (
        args.interpretedNeed &&
        (!args.sourceMessageId ||
            new TextEncoder().encode(args.interpretedNeed).length > 16 * 1024)
    )
        throw executionError("instruction_capacity");
    let pin: import("./agentDefinition").OperationPin | undefined;
    let outcome: Infer<typeof operationRefusalValidator> | undefined;
    let operation: AgentOperationDefinition | undefined;
    try {
        if (args.input.kind === "invalid")
            throw executionError(
                args.input.refusalCode ?? "invalid_operation_input",
            );
        operation = operationFor(args.input, mission);
        if (operation.systemOnly && args.actor !== "system")
            throw executionError("operation_not_allowed");
        if (!mission && !operation.nativeAuthority)
            throw executionError("operation_not_allowed");
        const pinMission =
            mission &&
            args.input.kind === "consult_mission_state" &&
            args.input.cursor === undefined
                ? await prepareMissionHistorySnapshot(ctx, mission)
                : mission;
        const scope = await operation.pin(ctx, pinMission, args.input, runId);
        if (scope.kind === "available") pin = scope.pin;
        else outcome = { kind: "unavailable", code: scope.code };
    } catch (error) {
        const code = executionFailureCode(error);
        if (!code) throw error;
        outcome = {
            kind: "refused",
            code,
            ...(args.input.kind === "invalid" && args.input.validation
                ? { validation: args.input.validation }
                : {}),
        };
    }
    const version = operation?.version ?? 1;
    const identity = operation
        ? operation.identity({
              mission,
              runId,
              version,
              input: args.input,
              pin,
          })
        : mission
          ? {
                objective: mission.objectiveKey,
                version,
                ...operationIdentityScope(mission, pin),
                input: args.input,
            }
          : { runId, version, input: args.input };
    const logicalKey = sha256Hex(stableStringify(identity));
    const turn = mission?.conversationTurnId
        ? await ctx.db.get(mission.conversationTurnId)
        : null;
    if (turn && !turn.hasOperations)
        await ctx.db.patch(turn._id, { hasOperations: true });
    const expectedGeneration = mission?.generation ?? args.expectedGeneration;
    if (expectedGeneration === undefined)
        throw executionError("stale_execution");
    const previous = mission
        ? await ctx.db
              .query("agentOperationRequests")
              .withIndex("by_mission_and_logical_key", (q) =>
                  q.eq("missionId", mission._id).eq("logicalKey", logicalKey),
              )
              .unique()
        : await ctx.db
              .query("agentOperationRequests")
              .withIndex("by_run_and_logical_key", (q) =>
                  q.eq("runId", runId).eq("logicalKey", logicalKey),
              )
              .unique();
    if (previous) {
        const admissionEventId = await recordEvent(
            ctx,
            {
                ...previous,
                cause: args.cause,
                invocationId: args.invocationId,
                sourceMessageId: args.sourceMessageId,
                interpretedNeed: args.interpretedNeed,
                actor: args.actor,
                expectedGeneration,
                instructionVersion: turn?.instructionVersion,
            },
            "operation_reused",
            outcome?.code,
            outcome,
        );
        const reopenUndispatched = previous.knownNotDispatched && !outcome;
        await ctx.db.patch(previous._id, {
            admissionEventId,
            ...((previous.status === "pending" || reopenUndispatched) &&
            !outcome
                ? {
                      actor: args.actor,
                      cause: args.cause,
                      invocationId: args.invocationId,
                      sourceMessageId: args.sourceMessageId,
                      interpretedNeed: args.interpretedNeed,
                      instructionVersion: turn?.instructionVersion,
                      expectedGeneration,
                      adoptionGeneration: undefined,
                  }
                : previous.status !== "completed"
                  ? { adoptionGeneration: expectedGeneration }
                  : {}),
            ...(reopenUndispatched
                ? {
                      status: "pending" as const,
                      outcome: undefined,
                      completedAt: undefined,
                      knownNotDispatched: undefined,
                      adoptionRefusalCode: undefined,
                  }
                : {}),
            ...(previous.adoptionRefusalCode && previous.outcome && !outcome
                ? {
                      status: "observed" as const,
                      adoptionGeneration: expectedGeneration,
                      adoptionRefusalCode: undefined,
                  }
                : {}),
        });
        return previous._id;
    }
    const requestId = await ctx.db.insert("agentOperationRequests", {
        runId,
        missionId: mission?._id,
        protocolVersion: 3,
        deadlineAt: mission?.deadlineAt ?? Date.now() + EXECUTION_WINDOW_MS,
        instructionVersion: turn?.instructionVersion,
        sourceMessageId: args.sourceMessageId,
        interpretedNeed: args.interpretedNeed,
        actor: args.actor,
        cause: args.cause,
        invocationId: args.invocationId,
        input: args.input,
        pin,
        expectedGeneration,
        operationVersion: version,
        logicalKey,
        status: outcome ? "completed" : "pending",
        outcome,
        knownNotDispatched: outcome ? true : undefined,
        createdAt: Date.now(),
        completedAt: outcome ? Date.now() : undefined,
    });
    const request = await ctx.db.get(requestId);
    if (!request) throw executionError("request_unavailable");
    const admissionEventId = await recordEvent(
        ctx,
        request,
        outcome ? "operation_refused" : "operation_requested",
        outcome?.code,
        outcome,
    );
    await ctx.db.patch(requestId, { admissionEventId });
    return requestId;
}
export const enqueue = internalMutation({
    args: {
        missionId: v.id("agentMissions"),
        expectedGeneration: v.number(),
        cause: v.string(),
        input: operationInputValidator,
        sourceMessageId: v.optional(v.id("agentMessageDeliveries")),
        interpretedNeed: v.optional(v.string()),
    },
    returns: v.id("agentOperationRequests"),
    handler: async (ctx, args) => {
        const { mission } = await requireMissionAuthority(
            ctx,
            args.missionId,
            args.expectedGeneration,
        );
        return persistOperationRequest(ctx, mission, {
            ...args,
            actor: "system",
        });
    },
});
export const enqueueNative = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        expectedGeneration: v.number(),
        cause: v.string(),
        input: operationInputValidator,
        sourceMessageId: v.optional(v.id("agentMessageDeliveries")),
        interpretedNeed: v.optional(v.string()),
    },
    returns: v.id("agentOperationRequests"),
    handler: async (ctx, args) => {
        const operation = getNativeOperation(args.input.kind);
        const { run } =
            operation?.nativeAuthority === "research"
                ? await requireRunAuthority(
                      ctx,
                      args.runId,
                      args.expectedGeneration,
                  )
                : await requireDossierAuthority(ctx, args.runId);
        if (run.executionGeneration !== args.expectedGeneration)
            throw executionError("stale_execution");
        return persistOperationRequest(ctx, undefined, {
            ...args,
            actor: "system",
        });
    },
});
export const readRunState = internalQuery({
    args: {
        runId: v.id("researchRuns"),
        expectedGeneration: v.number(),
        missionId: v.optional(v.id("agentMissions")),
    },
    returns: currentRunStateResultValidator,
    handler: async (ctx, args) => {
        const { run } = args.missionId
            ? await requireMissionAuthority(
                  ctx,
                  args.missionId,
                  args.expectedGeneration,
              )
            : await requireDossierAuthority(ctx, args.runId);
        if (run._id !== args.runId) throw executionError("not_authorized");
        if (
            !args.missionId &&
            run.executionGeneration !== args.expectedGeneration
        )
            throw executionError("stale_execution");
        return {
            lifecycleState: run.lifecycleState,
            executionStatus: run.executionStatus,
            executionGeneration: run.executionGeneration,
            research: await readResearchState(ctx, run),
        };
    },
});

const claimOperationInTxArgs = v.object({
    requestId: v.id("agentOperationRequests"),
    expectedGeneration: v.number(),
    piLease: v.optional(piDispatchLeaseValidator),
});

async function claimOperationInTx(
    ctx: MutationCtx,
    args: Infer<typeof claimOperationInTxArgs>,
    atomicLocal = false,
) {
    const request = await ctx.db.get(args.requestId);
    if (!request) throw executionError("request_unavailable");
    const retainedMission = request.missionId
        ? await ctx.db.get(request.missionId)
        : null;
    if (
        (request.status !== "completed" &&
            (request.adoptionGeneration ?? request.expectedGeneration) !==
                args.expectedGeneration) ||
        (retainedMission &&
            retainedMission.generation !== args.expectedGeneration)
    ) {
        if (retainedMission?.executionRuntime !== "pi-durable")
            await recordEvent(
                ctx,
                request,
                "dispatch_refused",
                "stale_execution",
            );
        return {
            kind: "outcome" as const,
            outcome: { kind: "refused" as const, code: "stale_execution" },
        };
    }
    if (retainedMission)
        await requirePiDispatchLease(
            ctx,
            retainedMission,
            args.expectedGeneration,
            args.piLease,
        );
    let state: Awaited<ReturnType<typeof authority>>;
    try {
        state = await authority(ctx, request, args.expectedGeneration);
    } catch (error) {
        const code = executionFailureCode(error);
        if (!code) throw error;
        // Known native effects still enter result observation; adoption below retains every authority fence.
        if (request.effect && !request.outcome)
            return {
                kind: "adopt" as const,
                outcome: request.effect.outcome,
            };
        const outcome = { kind: "refused" as const, code };
        if (request.status === "pending")
            await ctx.db.patch(request._id, {
                status: "completed",
                outcome,
                knownNotDispatched: true,
                completedAt: Date.now(),
            });
        await recordEvent(
            ctx,
            await requestAtAdmission(ctx, request),
            "dispatch_refused",
            code,
            outcome,
        );
        return { kind: "outcome" as const, outcome };
    }
    if (request.adoptionRefusalCode)
        return {
            kind: "outcome" as const,
            outcome: {
                kind: "refused" as const,
                code: request.adoptionRefusalCode,
            },
        };
    if (request.outcome)
        return request.status === "observed"
            ? { kind: "adopt" as const, outcome: request.outcome }
            : { kind: "outcome" as const, outcome: request.outcome };
    if (request.effect && !request.outcome)
        return { kind: "adopt" as const, outcome: request.effect.outcome };
    if (request.status === "waiting") {
        if (!request.waitReference)
            throw executionError("wait_reference_unavailable");
        return {
            kind: "outcome" as const,
            outcome: {
                kind: "waiting" as const,
                reference: request.waitReference,
            },
        };
    }
    if (request.status === "running" || request.status === "unknown") {
        const unavailable = unknownObservationOutcome(state.operation);
        if (unavailable) {
            await markOperationUnknown(ctx, request);
            return { kind: "outcome" as const, outcome: unavailable };
        }
        if (state.mission)
            await ctx.db.patch(state.mission._id, {
                status: "blocked",
                blockCode: "operation_outcome_unknown",
            });
        await recordEvent(
            ctx,
            request,
            "operation_unknown",
            "operation_outcome_unknown",
        );
        return {
            kind: "outcome" as const,
            outcome: {
                kind: "refused" as const,
                code: "operation_outcome_unknown",
            },
        };
    }
    if (
        (state.mission || state.operation?.nativeAuthority === "research") &&
        (await pauseResearchAtBoundary(ctx, state.runId, state.mission))
    )
        return {
            kind: "outcome" as const,
            outcome: {
                kind: "unavailable" as const,
                code: "research_paused",
            },
        };
    if (state.mission && state.operation?.effectKind !== "read") {
        const missionId = state.mission._id;
        for (const status of ["running", "waiting"] as const) {
            const active = await ctx.db
                .query("agentOperationRequests")
                .withIndex("by_mission_and_status", (q) =>
                    q.eq("missionId", missionId).eq("status", status),
                )
                .first();
            if (active && active._id !== request._id)
                return {
                    kind: "outcome" as const,
                    outcome: {
                        kind: "unavailable" as const,
                        code: "operation_in_progress",
                    },
                };
        }
    }
    if (atomicLocal && !state.operation?.executeInTransaction)
        throw executionError("operation_not_allowed");
    const waitEventId =
        request.waitEventId ??
        (!atomicLocal &&
        state.mission?.workflowId &&
        "protocolVersion" in state.mission &&
        state.mission.protocolVersion === 3
            ? await workflow.createEvent(ctx, {
                  name: `operation:${request._id}`,
                  workflowId: state.mission.workflowId as WorkflowId,
              })
            : undefined);
    const deadlineAt = state.mission?.deadlineAt ?? request.deadlineAt;
    const expiryJobId =
        atomicLocal || deadlineAt === undefined
            ? undefined
            : await ctx.scheduler.runAt(
                  deadlineAt,
                  internal.execution.operations.expire,
                  {
                      requestId: request._id,
                      expectedGeneration: request.expectedGeneration,
                  },
              );
    const scheduledJobId = state.operation?.scheduledAction
        ? await ctx.scheduler.runAfter(0, state.operation.scheduledAction, {
              requestId: args.requestId,
              expectedGeneration: args.expectedGeneration,
              epoch: 1,
          })
        : undefined;
    const waitReference = scheduledJobId
        ? `operation:${request._id}`
        : undefined;
    await ctx.db.patch(request._id, {
        status: scheduledJobId ? "waiting" : "running",
        scheduledExecution: scheduledJobId
            ? {
                  phase: "queued",
                  epoch: 1,
                  dispatchGeneration: args.expectedGeneration,
                  jobId: scheduledJobId,
              }
            : undefined,
        waitReference,
        waitEventId,
        expiryJobId,
    });
    await recordEvent(ctx, request, "operation_dispatched");
    if (waitReference) {
        await recordEvent(ctx, request, "operation_waiting");
        return {
            kind: "outcome" as const,
            outcome: { kind: "waiting" as const, reference: waitReference },
        };
    }
    if (request.input.kind === "invalid")
        throw executionError("invalid_operation_input");
    return {
        kind: "execute" as const,
        missionId: state.mission?._id,
        runId: state.runId,
        input: request.input,
    };
}

export const claim = internalMutation({
    args: claimOperationInTxArgs.fields,
    returns: v.union(
        v.object({
            kind: v.literal("execute"),
            missionId: v.optional(v.id("agentMissions")),
            runId: v.id("researchRuns"),
            input: operationInputValidator,
        }),
        v.object({
            kind: v.literal("outcome"),
            outcome: operationOutcomeValidator,
        }),
        v.object({
            kind: v.literal("adopt"),
            outcome: operationOutcomeValidator,
        }),
    ),
    handler: (ctx, args) => claimOperationInTx(ctx, args),
});

async function ownedStructuredAttempt(
    ctx: QueryCtx,
    request: Doc<"agentOperationRequests">,
) {
    const execution = request.scheduledExecution;
    if (!execution) return null;
    const call =
        execution.phase === "waiting_provider"
            ? await ctx.db.get(execution.callId)
            : await ctx.db
                  .query("providerCalls")
                  .withIndex("by_operation_request_and_attempt", (q) =>
                      q.eq("operationRequestId", request._id),
                  )
                  .order("desc")
                  .first();
    return call?.operationRequestId === request._id &&
        call.runId === request.runId &&
        call.operationEpoch === execution.epoch &&
        call.executionGeneration === execution.dispatchGeneration &&
        call.service === "model"
        ? call
        : null;
}

async function deferStructuredExecution(
    ctx: MutationCtx,
    request: Doc<"agentOperationRequests">,
    call: Doc<"providerCalls">,
) {
    const execution = request.scheduledExecution;
    if (execution?.phase !== "running" || !call.invocationId)
        throw executionError("operation_not_dispatched");
    if (execution.wakeId) await ctx.scheduler.cancel(execution.wakeId);
    const args = {
        requestId: request._id,
        expectedGeneration: execution.dispatchGeneration,
        epoch: execution.epoch,
    };
    const wakeId = await ctx.scheduler.runAfter(
        0,
        internal.execution.operations.wakeStructuredExecution,
        args,
    );
    const scheduledExecution = {
        phase: "waiting_provider" as const,
        epoch: execution.epoch,
        dispatchGeneration: execution.dispatchGeneration,
        wakeId,
        callId: call._id,
        firstInvocationId: execution.firstInvocationId ?? call.invocationId,
    };
    await ctx.db.patch(request._id, { scheduledExecution });
    if (request.runId) await pauseResearchAtBoundary(ctx, request.runId);
    return scheduledExecution;
}

/** Binds paused waiting work to a generation whose slot has been reclaimed. */
export const authorizeStructuredResume = internalMutation({
    args: { runId: v.id("researchRuns"), generation: v.number() },
    returns: v.null(),
    handler: async (ctx, { runId, generation }) => {
        const run = await ctx.db.get(runId);
        if (
            run?.executionStatus !== "running" ||
            run.executionGeneration !== generation
        )
            throw executionError("stale_execution");
        const requests = await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", runId).eq("status", "waiting"),
            )
            .take(9);
        for (const request of requests)
            if (request.scheduledExecution?.phase === "waiting_provider")
                await ctx.db.patch(request._id, {
                    structuredResumeGeneration: generation,
                });
        return null;
    },
});

/** Closes a fenced worker's observation and schedules only a still-authorized successor. */
export const wakeStructuredExecution = internalMutation({
    args: scheduledOperationArgs,
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        const request = await ctx.db.get(args.requestId);
        if (
            !request?.runId ||
            request.status !== "waiting" ||
            request.outcome ||
            !ownsScheduledEpoch(request, args.expectedGeneration, args.epoch)
        )
            return null;
        const mission = request.missionId
            ? await ctx.db.get(request.missionId)
            : null;
        const operation = operationFor(request.input, mission ?? undefined);
        if (
            operation.effectKind !== "durable_effect" ||
            !operation.scheduledAction ||
            operation.scheduledRecovery !== "structured_model_v1"
        )
            return null;
        const call = await ownedStructuredAttempt(ctx, request);
        let execution = request.scheduledExecution;
        if (
            !call?.invocationId ||
            !call.preparationId ||
            !call.sourceId ||
            !call.inputHash ||
            !execution
        )
            return null;
        if (execution.phase === "running") {
            const job = await ctx.db.system.get(execution.jobId);
            if (
                Date.now() < execution.platformDeadlineAt &&
                (job?.state.kind === "inProgress" ||
                    job?.state.kind === "pending")
            )
                return null;
            execution = await deferStructuredExecution(ctx, request, call);
        }
        if (execution.phase !== "waiting_provider") return null;
        await pauseResearchAtBoundary(ctx, request.runId);
        const run = await ctx.db.get(request.runId);
        const preparation = await ctx.db.get(call.preparationId);
        if (!preparation) return null;
        const deadlineAt = Math.min(
            request.deadlineAt ?? Infinity,
            mission?.deadlineAt ?? Infinity,
            preparation.deadlineAt ?? Infinity,
        );
        if (call.status === "started" && call.providerObservation?.termination)
            await ctx.runMutation(
                internal.execution.invocationLifecycle
                    .closeAbandonedStructuredAttempt,
                args,
            );
        if (
            !run ||
            run.withdrawnAt ||
            run.executionStatus !== "running" ||
            run.researchPauseRequested
        )
            return null;
        if (
            request.adoptionGeneration !== run.executionGeneration &&
            request.expectedGeneration !== run.executionGeneration
        )
            return null;
        const finish = async (outcome: Outcome) => {
            await ctx.runMutation(internal.execution.operations.recordResult, {
                ...args,
                expectedGeneration: run.executionGeneration,
                recovery: "owned_wake",
                outcome,
            });
            return null;
        };
        if (deadlineAt <= Date.now())
            return finish({ kind: "unavailable", code: "execution_deadline" });
        if (
            run.executionGeneration !== execution.dispatchGeneration &&
            request.structuredResumeGeneration !== run.executionGeneration
        )
            return null;
        try {
            await authority(ctx, request, run.executionGeneration);
        } catch (error) {
            const code = executionFailureCode(error);
            if (!code) throw error;
            return finish({ kind: "refused", code });
        }
        if (call.status === "succeeded") {
            const recovered = await operation.recoverScheduledResult?.(
                ctx,
                {
                    ...request,
                    scheduledExecution: execution,
                },
                run.executionGeneration,
            );
            return recovered ? finish(recovered) : null;
        }
        if (!call.providerObservation?.termination) return null;
        const plan = await ctx.runQuery(
            internal.providerCalls.nextPreparationAttemptForInput,
            {
                preparationId: call.preparationId,
                sourceId: call.sourceId,
                inputHash: call.inputHash,
                operation: call.operation,
                now: Date.now(),
            },
        );
        if (
            plan.errorCode === "recovery_cooldown" &&
            plan.retryAt &&
            plan.retryAt < deadlineAt
        ) {
            const wakeId = await ctx.scheduler.runAt(
                plan.retryAt,
                internal.execution.operations.wakeStructuredExecution,
                args,
            );
            await ctx.db.patch(request._id, {
                scheduledExecution: { ...execution, wakeId },
            });
            return null;
        }
        if (!plan.attempt)
            return finish({
                kind: "unavailable",
                code: plan.errorCode ?? "documentary_control_unfinished",
                ...(call.diagnostic?.reason
                    ? {
                          validation: {
                              path: "documentaryControl",
                              expected: `A complete documentary examination matching the submitted contribution identities (${call.diagnostic.reason}).`,
                          },
                      }
                    : {}),
            });
        const dispatchGeneration = run.executionGeneration;
        const epoch = (execution.lastIssuedEpoch ?? execution.epoch) + 1;
        const jobId = await ctx.scheduler.runAfter(
            0,
            operation.scheduledAction,
            {
                requestId: request._id,
                expectedGeneration: dispatchGeneration,
                epoch,
            },
        );
        await ctx.db.patch(request._id, {
            scheduledExecution: {
                phase: "queued",
                epoch,
                dispatchGeneration,
                jobId,
                firstInvocationId: execution.firstInvocationId,
            },
        });
        return null;
    },
});

/** Only the first delivery of an owned scheduled operation may enter its external work. */
export const beginScheduledExecution = internalMutation({
    args: scheduledOperationArgs,
    returns: v.boolean(),
    handler: async (ctx, args) => {
        const request = await ctx.db.get(args.requestId);
        const scheduled = request?.scheduledExecution;
        if (
            !request ||
            scheduled?.phase !== "queued" ||
            !ownsScheduledEpoch(request, args.expectedGeneration, args.epoch) ||
            request.status !== "waiting" ||
            request.outcome
        )
            return false;
        if (
            scheduled.firstInvocationId &&
            request.runId &&
            (await ctx.db.get(request.runId))?.researchPauseRequested
        ) {
            const prior = await ctx.db
                .query("providerCalls")
                .withIndex("by_operation_request_and_attempt", (q) =>
                    q.eq("operationRequestId", request._id),
                )
                .order("desc")
                .first();
            if (
                prior?.operationEpoch !== undefined &&
                prior.operationEpoch < scheduled.epoch &&
                prior.executionGeneration !== undefined
            ) {
                await ctx.db.patch(request._id, {
                    scheduledExecution: {
                        phase: "waiting_provider",
                        epoch: prior.operationEpoch,
                        lastIssuedEpoch: scheduled.epoch,
                        dispatchGeneration: prior.executionGeneration,
                        callId: prior._id,
                        firstInvocationId: scheduled.firstInvocationId,
                    },
                });
                await pauseResearchAtBoundary(ctx, request.runId);
            }
            return false;
        }
        const state = await authority(ctx, request, args.expectedGeneration);
        if (!state.operation?.scheduledAction)
            throw executionError("operation_not_dispatched");
        const startedAt = Date.now();
        const platformDeadlineAt = startedAt + CONVEX_NODE_ACTION_TIMEOUT_MS;
        const wakeId = state.operation.scheduledRecovery
            ? await ctx.scheduler.runAt(
                  platformDeadlineAt,
                  internal.execution.operations.wakeStructuredExecution,
                  args,
              )
            : undefined;
        await ctx.db.patch(request._id, {
            scheduledExecution: {
                ...scheduled,
                phase: "running",
                startedAt,
                platformDeadlineAt,
                wakeId,
            },
        });
        await recordEvent(ctx, request, "operation_execution_started");
        return true;
    },
});

const recordResultInTxArgs = v.object({
    requestId: v.id("agentOperationRequests"),
    expectedGeneration: v.number(),
    outcome: operationOutcomeValidator,
    epoch: v.optional(v.number()),
    recovery: v.optional(v.literal("owned_wake")),
    historyRead: v.optional(historyReadReceiptValidator),
});

/** A waiting request contributes one wake only when the mission can still consume its result. */
async function notifyPiOperationResult(
    ctx: MutationCtx,
    request: Doc<"agentOperationRequests">,
    mission: Doc<"agentMissions"> | null,
) {
    if (
        mission?.executionRuntime !== "pi-durable" ||
        request.status !== "waiting" ||
        request.outcome
    )
        return;
    const session = mission.piActiveWriter
        ? await sessionForMission(ctx, mission)
        : null;
    const active =
        session &&
        session.writer === mission.piActiveWriter &&
        session.generation === mission.generation &&
        session.leaseUntil > Date.now();
    await ctx.db.patch(mission._id, {
        piResultWakeVersion: (mission.piResultWakeVersion ?? 0) + 1,
        ...(!active ? { piResultWakePending: true } : {}),
    });
    if (!active) await schedulePiMission(ctx, mission._id, mission.generation);
}

async function recordResultInTx(
    ctx: MutationCtx,
    args: Infer<typeof recordResultInTxArgs>,
): Promise<Outcome> {
    const request = await ctx.db.get(args.requestId);
    if (
        !request ||
        (request.status !== "completed" &&
            request.expectedGeneration !== args.expectedGeneration &&
            request.adoptionGeneration !== args.expectedGeneration)
    )
        throw executionError("request_unavailable");
    if (
        request.scheduledExecution &&
        ((args.epoch !== undefined &&
            !(args.recovery &&
            request.scheduledExecution.phase === "waiting_provider"
                ? request.scheduledExecution.epoch === args.epoch
                : ownsScheduledEpoch(
                      request,
                      args.expectedGeneration,
                      args.epoch,
                  ))) ||
            (args.epoch === undefined && !request.outcome && !request.effect) ||
            (request.scheduledExecution.phase === "waiting_provider" &&
                !args.recovery))
    )
        return { kind: "refused", code: "stale_execution" };
    if (
        request.outcome &&
        stableStringify(request.outcome) !== stableStringify(args.outcome) &&
        args.outcome.kind !== "waiting"
    )
        throw executionError("operation_result_conflict");
    if (request.status === "completed") {
        try {
            await authority(ctx, request, args.expectedGeneration);
        } catch (error) {
            const code = executionFailureCode(error);
            if (!code) throw error;
            return { kind: "refused", code };
        }
        if (!request.outcome)
            throw executionError("operation_result_unavailable");
        if (request.adoptionRefusalCode)
            return { kind: "refused", code: request.adoptionRefusalCode };
        return request.outcome;
    }
    const mission = request.missionId
        ? await ctx.db.get(request.missionId)
        : null;
    const operation = operationFor(request.input, mission ?? undefined);
    if (
        request.effect &&
        stableStringify(request.effect.outcome) !==
            stableStringify(args.outcome)
    )
        throw executionError("operation_result_conflict");
    let outcome = args.outcome;
    const missingEffectReceipt =
        operation.effectKind === "atomic_effect" &&
        outcome.kind === "success" &&
        !request.effect;
    let adoptionRefusalCode: string | undefined;
    let diagnostic: Doc<"agentExecutionEvents">["protectedDiagnostic"];
    if (outcome.kind === "success") {
        try {
            validateOperationValue(
                operation.resultValidator,
                JSON.parse(outcome.valueJson),
                ctx.db,
            );
            const validated = await operation.validateOutcome(
                request,
                outcome,
                ctx,
            );
            if (
                !validate(operationOutcomeValidator, validated, {
                    db: ctx.db,
                }) ||
                (operation.effectKind === "read" &&
                    validated.kind === "waiting")
            )
                throw executionError("operation_contract_invalid");
            if ("code" in validated) adoptionRefusalCode = validated.code;
            else outcome = validated;
        } catch (error) {
            // Preserve the known observation; only pure domain callbacks are guarded here.
            adoptionRefusalCode = "operation_adoption_failed";
            diagnostic = protectedDiagnostic(error, "validate_outcome");
        }
    }
    if (
        outcome.kind === "success" &&
        new TextEncoder().encode(outcome.valueJson).length >
            MAX_OPERATION_RESULT_BYTES
    )
        outcome = {
            kind: "unavailable",
            code: "operation_result_capacity",
        };
    const historyRead = args.historyRead ?? request.historyRead;
    if (
        historyRead &&
        request.historyRead &&
        stableStringify(historyRead) !== stableStringify(request.historyRead)
    )
        throw executionError("operation_result_conflict");
    if (
        outcome.kind === "success" &&
        historySourceFor(request.input.kind) &&
        request.operationVersion >= 2
    ) {
        if (!historyRead) throw executionError("history_receipt_invalid");
        verifyHistoryReadReceipt(
            request,
            historyRead,
            args.expectedGeneration,
            outcome.valueJson,
        );
    } else if (historyRead) throw executionError("history_receipt_invalid");
    if (outcome.kind === "waiting") {
        if (!outcome.reference || outcome.reference.length > 160)
            throw executionError("invalid_wait_reference");
        if (request.outcome) return request.outcome;
        if (
            operation.effectKind === "durable_effect" &&
            operation.scheduledAction &&
            operation.scheduledRecovery
        ) {
            const call = await ownedStructuredAttempt(ctx, request);
            if (!call) throw executionError("operation_not_dispatched");
            await deferStructuredExecution(ctx, request, call);
        }
        await ctx.db.patch(request._id, {
            status: "waiting",
            waitReference: outcome.reference,
        });
        await recordEvent(ctx, request, "operation_waiting");
        return outcome;
    }
    if (!["running", "waiting", "observed", "unknown"].includes(request.status))
        throw executionError("operation_not_dispatched");
    if (!request.outcome) {
        const execution = request.scheduledExecution;
        if (
            (execution?.phase === "running" ||
                execution?.phase === "waiting_provider") &&
            execution.wakeId
        )
            await ctx.scheduler.cancel(execution.wakeId);
        if (request.expiryJobId)
            await ctx.scheduler.cancel(request.expiryJobId);
        await ctx.db.patch(request._id, {
            outcome,
            historyRead,
            status: "observed",
            ...(request.scheduledExecution
                ? {
                      scheduledExecution: {
                          phase: "finished" as const,
                          epoch: request.scheduledExecution.epoch,
                          dispatchGeneration:
                              request.scheduledExecution.dispatchGeneration,
                      },
                  }
                : {}),
            completedAt: Date.now(),
        });
        await recordEvent(
            ctx,
            { ...request, outcome },
            "operation_observed",
            undefined,
            undefined,
            { diagnostic },
        );
        if (request.waitEventId && !request.waitNotified) {
            await workflow.sendEvent(ctx, {
                id: request.waitEventId as EventId,
                value: null,
            });
            await ctx.db.patch(request._id, { waitNotified: true });
        }
    }
    try {
        await authority(ctx, request, args.expectedGeneration);
    } catch (error) {
        const code = executionFailureCode(error);
        if (!code) throw error;
        if (mission) {
            let canContinue = false;
            try {
                await requireMissionAuthority(
                    ctx,
                    mission._id,
                    args.expectedGeneration,
                );
                canContinue = true;
            } catch (missionError) {
                if (!executionFailureCode(missionError)) throw missionError;
            }
            if (canContinue) {
                await ctx.db.patch(request._id, {
                    status: "completed",
                    adoptionRefusalCode: code,
                });
                await notifyPiOperationResult(ctx, request, mission);
            }
        }
        await recordEvent(ctx, request, "late_operation_result_refused", code);
        return { kind: "refused", code };
    }
    await notifyPiOperationResult(ctx, request, mission);
    let advancedDomainProgress = false;
    if (mission) {
        const definition = getAgentDefinition(
            mission.definitionId,
            mission.definitionVersion,
        );
        let progress: AgentProgress = {};
        let accounting: ReturnType<typeof adoptProgress> = {
            kind: "ready",
            keys: mission.progressKeys,
            added: 0,
        };
        if (!adoptionRefusalCode && !missingEffectReceipt) {
            try {
                const {
                    progressKeys: _keys,
                    noProgressTurns: _turns,
                    lastSettledInvocationId: _settled,
                    recoveryRead: _recoveryRead,
                    ...domainMission
                } = mission;
                progress =
                    outcome.kind === "success" &&
                    !isCommonConsultation(request.input.kind)
                        ? definition.progress(domainMission, outcome)
                        : {};
                if (
                    !validate(agentProgressValidator, progress, {
                        db: ctx.db,
                    }) ||
                    (progress.state &&
                        !validate(definition.stateValidator, progress.state, {
                            db: ctx.db,
                        }))
                )
                    throw executionError("mission_state_invalid");
                accounting = adoptProgress(
                    mission.progressKeys,
                    outcome.kind === "success"
                        ? [
                              ...(progress.facts ?? []),
                              ...(historyRead?.restorable === false
                                  ? []
                                  : (historyRead?.fragmentIds ?? [])),
                          ]
                        : [],
                );
            } catch (error) {
                adoptionRefusalCode = "operation_adoption_failed";
                diagnostic = protectedDiagnostic(error, "reduce_progress");
            }
        }
        const code = missingEffectReceipt
            ? "operation_effect_receipt_missing"
            : (adoptionRefusalCode ??
              (accounting.kind === "blocked"
                  ? accounting.code
                  : progress.blockCode));
        if (code) {
            await ctx.db.patch(mission._id, {
                status: "blocked",
                blockCode: code,
            });
            await ctx.db.patch(request._id, {
                status: "completed",
                adoptionRefusalCode: code,
            });
            await recordEvent(
                ctx,
                { ...request, outcome },
                "operation_adoption_failed",
                code,
                undefined,
                { diagnostic },
            );
            return adoptionRefusalCode || missingEffectReceipt
                ? { kind: "refused", code }
                : outcome;
        }
        if (accounting.kind !== "ready")
            throw executionError("progress_contract_invalid");
        advancedDomainProgress =
            !isCommonConsultation(request.input.kind) && accounting.added > 0;
        await ctx.db.patch(mission._id, {
            ...domainDataPatch(
                mission,
                progress.state ? { state: progress.state } : {},
            ),
            progressKeys: accounting.keys,
            ...(progress.obligations
                ? { obligations: progress.obligations }
                : {}),
        });
    } else {
        const code = missingEffectReceipt
            ? "operation_effect_receipt_missing"
            : adoptionRefusalCode;
        if (code) {
            await ctx.db.patch(request._id, {
                status: "completed",
                adoptionRefusalCode: code,
            });
            await recordEvent(
                ctx,
                { ...request, outcome },
                "operation_adoption_failed",
                code,
                undefined,
                { diagnostic },
            );
            return { kind: "refused", code };
        }
    }
    await ctx.db.patch(request._id, {
        status: "completed",
        adoptedAt: Date.now(),
        adoptionRefusalCode: undefined,
    });
    await recordEvent(
        ctx,
        {
            ...(await requestAtAdmission(ctx, request)),
            expectedGeneration: args.expectedGeneration,
            outcome,
        },
        "operation_completed",
        outcome.kind === "success" ? undefined : outcome.code,
        undefined,
        { historySource: advancedDomainProgress ? true : undefined },
    );
    const runId = mission?.runId ?? request.runId;
    if (runId && (mission || operation.nativeAuthority === "research"))
        await pauseResearchAtBoundary(ctx, runId, mission ?? undefined);
    return outcome;
}

export const recordResult = internalMutation({
    args: recordResultInTxArgs.fields,
    returns: operationOutcomeValidator,
    handler: (ctx, args) => recordResultInTx(ctx, args),
});
export const dispatch = internalAction({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
        piLease: v.optional(piDispatchLeaseValidator),
    },
    returns: operationOutcomeValidator,
    handler: async (ctx, { piLease, ...args }): Promise<Outcome> => {
        const claimed = await ctx.runMutation(
            internal.execution.operations.claim,
            { ...args, piLease },
        );
        if (claimed.kind === "outcome") return claimed.outcome;
        if (claimed.kind === "adopt")
            return ctx.runMutation(internal.execution.operations.recordResult, {
                ...args,
                outcome: claimed.outcome,
            });
        let phase: Parameters<typeof classifyDispatchFailure>[1] =
            "before_callback";
        let outcome: Outcome;
        let historyRead:
            | import("./operationContracts").HistoryReadReceipt
            | undefined;
        try {
            const mission = claimed.missionId
                ? await ctx.runQuery(
                      internal.execution.operations.missionForDispatch,
                      {
                          missionId: claimed.missionId,
                          expectedGeneration: args.expectedGeneration,
                      },
                  )
                : undefined;
            const operation = operationFor(claimed.input, mission ?? undefined);
            if (!operation.execute)
                throw executionError("operation_not_dispatched");
            const executeArgs = {
                ...args,
                piLease,
                missionId: claimed.missionId,
                runId: claimed.runId,
                input: claimed.input,
            };
            phase =
                operation.effectKind === "read"
                    ? "read_callback"
                    : "effect_callback";
            const result =
                operation.effectKind === "read"
                    ? await operation.execute(
                          { runQuery: ctx.runQuery.bind(ctx) },
                          executeArgs,
                      )
                    : await operation.execute(ctx, executeArgs);
            const observed = validateOperationExecutionResult(
                operation,
                result,
                claimed.input.kind,
            );
            outcome = observed.outcome;
            historyRead = observed.historyRead;
        } catch (error) {
            return ctx.runMutation(
                internal.execution.operations.settleDispatchFailure,
                {
                    ...args,
                    failure: classifyDispatchFailure(error, phase),
                },
            );
        }
        return ctx.runMutation(internal.execution.operations.recordResult, {
            ...args,
            outcome,
            historyRead,
        });
    },
});

function unknownObservationOutcome(operation?: AgentOperationDefinition) {
    return operation?.effectKind === "durable_effect"
        ? operation.unknownOutcome
        : undefined;
}

async function markOperationUnknown(
    ctx: MutationCtx,
    request: Doc<"agentOperationRequests">,
) {
    const mission = request.missionId
        ? await ctx.db.get(request.missionId)
        : null;
    const unavailable = unknownObservationOutcome(
        declaredOperation(request.input, mission ?? undefined),
    );
    if (request.status === "unknown" && !unavailable) return;
    await ctx.db.patch(
        request._id,
        unavailable
            ? {
                  status: "completed",
                  outcome: unavailable,
                  completedAt: Date.now(),
              }
            : { status: "unknown" },
    );
    if (unavailable && mission && request.status === "waiting") {
        // Keep the factual non-retryable outcome even if permission to resume has ended.
        let active: Doc<"agentMissions"> | null = null;
        try {
            active = (
                await requireMissionAuthority(
                    ctx,
                    mission._id,
                    request.adoptionGeneration ?? request.expectedGeneration,
                )
            ).mission;
        } catch (error) {
            if (!executionFailureCode(error)) throw error;
        }
        await notifyPiOperationResult(ctx, request, active);
    }
    if (
        !unavailable &&
        mission &&
        !["cancelled", "completed"].includes(mission.status)
    )
        await ctx.db.patch(mission._id, {
            status: "blocked",
            blockCode: "operation_outcome_unknown",
        });
    if (request.waitEventId && !request.waitNotified) {
        await workflow.sendEvent(ctx, {
            id: request.waitEventId as EventId,
            value: null,
        });
        await ctx.db.patch(request._id, { waitNotified: true });
    }
    await recordEvent(
        ctx,
        request,
        "operation_unknown",
        "operation_outcome_unknown",
    );
}

/** Settles observed callback failures; an unacknowledged transaction still relies on expiry. */
const settleDispatchFailureInTxArgs = v.object({
    requestId: v.id("agentOperationRequests"),
    expectedGeneration: v.number(),
    failure: dispatchFailureValidator,
    epoch: v.optional(v.number()),
});

async function settleDispatchFailureInTx(
    ctx: MutationCtx,
    args: Infer<typeof settleDispatchFailureInTxArgs>,
): Promise<Outcome> {
    const request = await ctx.db.get(args.requestId);
    if (
        !request ||
        (request.expectedGeneration !== args.expectedGeneration &&
            request.adoptionGeneration !== args.expectedGeneration)
    )
        throw executionError("request_unavailable");
    if (
        request.scheduledExecution &&
        (args.epoch === undefined ||
            !ownsScheduledEpoch(request, args.expectedGeneration, args.epoch))
    )
        return { kind: "refused", code: "stale_execution" };
    const retained = request.outcome ?? request.effect?.outcome;
    if (
        args.failure.diagnostic &&
        request.status !== "completed" &&
        request.status !== "unknown"
    )
        await recordEvent(
            ctx,
            request,
            "operation_execution_incident",
            args.failure.code,
            undefined,
            { diagnostic: args.failure.diagnostic },
        );
    if (retained)
        return recordResultInTx(ctx, {
            requestId: args.requestId,
            expectedGeneration: args.expectedGeneration,
            epoch: args.epoch,
            outcome: retained,
        });
    if (request.status === "unknown")
        return { kind: "unavailable", code: "operation_outcome_unknown" };
    if (
        request.status === "waiting" &&
        request.scheduledExecution?.phase === "waiting_provider" &&
        request.waitReference
    )
        return {
            kind: "waiting",
            reference: request.waitReference,
        };
    if (!["running", "waiting"].includes(request.status))
        throw executionError("operation_not_dispatched");
    if (args.failure.category === "uncertain_effect") {
        const mission = request.missionId
            ? await ctx.db.get(request.missionId)
            : null;
        const operation = operationFor(request.input, mission ?? undefined);
        if (
            operation.effectKind === "durable_effect" &&
            operation.scheduledAction &&
            operation.scheduledRecovery === "structured_model_v1"
        ) {
            const run = request.runId ? await ctx.db.get(request.runId) : null;
            const recovered = run?.researchPauseRequested
                ? null
                : await operation.recoverScheduledResult?.(
                      ctx,
                      request,
                      args.expectedGeneration,
                  );
            if (recovered)
                return recordResultInTx(ctx, {
                    requestId: args.requestId,
                    expectedGeneration: args.expectedGeneration,
                    epoch: args.epoch,
                    outcome: recovered,
                });
            const call = await ownedStructuredAttempt(ctx, request);
            if (
                call?.invocationId &&
                request.scheduledExecution?.phase === "running"
            )
                return recordResultInTx(ctx, {
                    requestId: args.requestId,
                    expectedGeneration: args.expectedGeneration,
                    epoch: args.epoch,
                    outcome: {
                        kind: "waiting",
                        reference: `operation:${request._id}`,
                    },
                });
        }
        await markOperationUnknown(ctx, request);
        return { kind: "unavailable", code: "operation_outcome_unknown" };
    }
    if (args.failure.category === "incident" && !args.failure.diagnostic)
        await recordEvent(
            ctx,
            request,
            "operation_execution_incident",
            "operation_execution_failed",
        );
    return recordResultInTx(ctx, {
        requestId: args.requestId,
        expectedGeneration: args.expectedGeneration,
        epoch: args.epoch,
        outcome:
            args.failure.category === "authority"
                ? { kind: "refused", code: args.failure.code }
                : {
                      kind: "unavailable",
                      code: "operation_execution_failed",
                  },
    });
}

export const settleDispatchFailure = internalMutation({
    args: settleDispatchFailureInTxArgs.fields,
    returns: operationOutcomeValidator,
    handler: (ctx, args) => settleDispatchFailureInTx(ctx, args),
});

/** Claims, executes and adopts an operation without an action or intermediate persisted dispatch. */
export const executeLocal = internalMutation({
    args: claimOperationInTxArgs.fields,
    returns: operationOutcomeValidator,
    handler: async (ctx, args): Promise<Outcome> => {
        const claimed = await claimOperationInTx(ctx, args, true);
        if (claimed.kind === "outcome") return claimed.outcome;
        const { piLease: _lease, ...scope } = args;
        if (claimed.kind === "adopt")
            return recordResultInTx(ctx, {
                ...scope,
                outcome: claimed.outcome,
            });
        const mission = claimed.missionId
            ? await ctx.db.get(claimed.missionId)
            : null;
        const operation = operationFor(claimed.input, mission ?? undefined);
        const input = { ...scope, ...claimed };
        const validateResult = (result: OperationExecutionResult) =>
            validateOperationExecutionResult(
                operation,
                result,
                claimed.input.kind,
            );
        if (
            operation.effectKind === "atomic_effect" &&
            operation.executeInTransaction
        ) {
            // Any exception rolls back the framing write and the request claim together.
            const result = validateResult(
                await operation.executeInTransaction(ctx, input),
            );
            return recordResultInTx(ctx, { ...scope, ...result });
        }
        if (operation.effectKind !== "read" || !operation.executeInTransaction)
            throw executionError("operation_not_allowed");
        let result: ReturnType<typeof validateOperationExecutionResult>;
        try {
            result = validateResult(
                await operation.executeInTransaction(
                    { runQuery: ctx.runQuery.bind(ctx) },
                    input,
                ),
            );
        } catch (error) {
            return settleDispatchFailureInTx(ctx, {
                ...scope,
                failure: classifyDispatchFailure(error, "read_callback"),
            });
        }
        return recordResultInTx(ctx, { ...scope, ...result });
    },
});

/** Settles an atomic operation after its transaction has rolled back. */
export const settleLocalRollback = internalMutation({
    args: {
        ...claimOperationInTxArgs.fields,
        failure: v.optional(dispatchFailureValidator),
    },
    returns: operationOutcomeValidator,
    handler: async (ctx, { failure, ...args }): Promise<Outcome> => {
        const request = await ctx.db.get(args.requestId);
        if (request?.status !== "pending" && request?.status !== "completed")
            throw executionError("operation_not_dispatched");
        const claimed = await claimOperationInTx(ctx, args, true);
        if (claimed.kind === "outcome") return claimed.outcome;
        if (claimed.kind !== "execute")
            throw executionError("operation_not_dispatched");
        await ctx.db.patch(args.requestId, { knownNotDispatched: true });
        return settleDispatchFailureInTx(ctx, {
            requestId: args.requestId,
            expectedGeneration: args.expectedGeneration,
            failure:
                failure?.category === "authority" ||
                failure?.category === "incident"
                    ? failure
                    : {
                          category: "incident",
                          code: "operation_execution_failed",
                      },
        });
    },
});

export const missionForDispatch = internalQuery({
    args: { missionId: v.id("agentMissions"), expectedGeneration: v.number() },
    returns: missionDocument,
    handler: async (ctx, args) =>
        (
            await requireMissionAuthority(
                ctx,
                args.missionId,
                args.expectedGeneration,
            )
        ).mission,
});

export const expire = internalMutation({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const request = await ctx.db.get(args.requestId);
        if (
            !request ||
            request.expectedGeneration !== args.expectedGeneration ||
            request.outcome ||
            !["running", "waiting"].includes(request.status)
        )
            return null;
        const mission = request.missionId
            ? await ctx.db.get(request.missionId)
            : null;
        const deadlineAt = mission?.deadlineAt ?? request.deadlineAt;
        if (deadlineAt === undefined || deadlineAt > Date.now()) return null;
        if (request.effect) {
            await ctx.db.patch(request._id, { expiryJobId: undefined });
            if (mission && !["cancelled", "completed"].includes(mission.status))
                await ctx.db.patch(mission._id, {
                    status: "blocked",
                    blockCode: "execution_deadline",
                });
            await ctx.runMutation(internal.execution.operations.recordResult, {
                ...args,
                outcome: request.effect.outcome,
            });
            return null;
        }
        await markOperationUnknown(ctx, request);
        return null;
    },
});

/** Retains immutable observation bytes under the same authority as their engaged durable operation. */
export const stageObservationText = internalMutation({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
        fragment: textFragmentValidator,
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const request = await ctx.db.get(args.requestId);
        if (!request || !operationHasStarted(request))
            throw executionError("operation_not_dispatched");
        const admitted = await authority(ctx, request, args.expectedGeneration);
        if (admitted.operation?.effectKind !== "durable_effect")
            throw executionError("operation_not_dispatched");
        await stageOperationObservation(ctx, request._id, args.fragment);
        return null;
    },
});

export const readScheduledInput = internalQuery({
    args: scheduledOperationArgs,
    returns: v.object({
        input: requestInputValidator,
        pin: operationPinValidator,
        binding: v.optional(
            v.object({ id: agentDefinitionIdValidator, version: v.number() }),
        ),
    }),
    handler: async (ctx, args) => {
        const request = await ctx.db.get(args.requestId);
        if (
            !request ||
            !operationHasStarted(request) ||
            !ownsScheduledEpoch(request, args.expectedGeneration, args.epoch) ||
            request.status === "completed"
        )
            throw executionError("operation_not_dispatched");
        const admitted = await authority(ctx, request, args.expectedGeneration);
        if (!admitted.operation?.scheduledAction || !request.pin)
            throw executionError("operation_not_dispatched");
        return {
            input: request.input,
            pin: request.pin,
            ...(admitted.mission
                ? {
                      binding: {
                          id: admitted.mission.definitionId,
                          version: admitted.mission.definitionVersion,
                      },
                  }
                : {}),
        };
    },
});
