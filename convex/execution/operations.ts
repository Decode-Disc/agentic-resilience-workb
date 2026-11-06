import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalAction,
    internalMutation,
    internalQuery,
    type MutationCtx,
} from "@convex/_generated/server";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import schema from "@convex/schema";
import { workflow } from "@convex/workflow";
import type { EventId, WorkflowId } from "@convex-dev/workflow";
import { type Infer, v } from "convex/values";
import { validate } from "convex-helpers/validators";
import { getAgentDefinition, getRegisteredOperation } from "./agentCatalog";
import type { AgentProgress } from "./agentDefinition";
import {
    executionError,
    executionFailureCode,
    readOperationCause,
    recordMissionEvent,
    requireDossierAuthority,
    requireMissionAuthority,
    requireRunAuthority,
} from "./authority";
import { requireInstructionVersion } from "./conversations";
import { classifyDispatchFailure, protectedDiagnostic } from "./errors";
import {
    type AgentOperationDefinition,
    EXECUTION_WINDOW_MS,
    MAX_OPERATION_RESULT_BYTES,
    operationInputValidator,
    operationOutcomeValidator,
    type operationRefusalValidator,
    type requestInputValidator,
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
    dispatchFailureValidator,
    historyReadReceiptValidator,
    historySourceFor,
    isCommonConsultation,
    runStateResultValidator,
} from "./operationContracts";
import { validateOperationValue } from "./operationResults";
import { schedulePiMission } from "./piControl";
import { adoptProgress, agentProgressValidator } from "./progress";
import { pauseResearchAtBoundary } from "./researchControl";

type Outcome = Infer<typeof operationOutcomeValidator>;
type Input = Infer<typeof requestInputValidator>;

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

function operationFor(
    input: Input,
    mission?: Doc<"agentMissions">,
): AgentOperationDefinition {
    const operation =
        input.kind === "invalid"
            ? undefined
            : mission
              ? getAgentDefinition(
                    mission.definitionId,
                    mission.definitionVersion,
                ).operations[input.kind]
              : getRegisteredOperation(input.kind);
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
    ctx: MutationCtx,
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
    ctx: MutationCtx,
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
            request.outcome.code !== "invalid_operation_input"
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
    if (
        request.status === "completed" &&
        isCommonConsultation(request.input.kind) &&
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
            isCommonConsultation(request.input.kind) &&
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

/** Persists a native effect's receipt atomically with its domain write, without replacing its admission pin. */
export async function retainOperationEffect(
    ctx: MutationCtx,
    request: Doc<"agentOperationRequests">,
    pin: import("./agentDefinition").OperationPin,
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
    const outcome = operation.validateOutcome(
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
    const effect = { pin, outcome };
    if (request.effect) {
        if (stableStringify(request.effect) !== stableStringify(effect))
            throw executionError("operation_result_conflict");
        return valueJson;
    }
    if (request.status !== "running")
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
            throw executionError("invalid_operation_input");
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
        const operation = getRegisteredOperation(args.input.kind);
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
    returns: runStateResultValidator,
    handler: async (ctx, args) => {
        const { run } = args.missionId
            ? await requireMissionAuthority(
                  ctx,
                  args.missionId,
                  args.expectedGeneration,
              )
            : await requireDossierAuthority(ctx, args.runId);
        if (run._id !== args.runId) throw executionError("not_authorized");
        return {
            lifecycleState: run.lifecycleState,
            executionStatus: run.executionStatus,
            executionGeneration: run.executionGeneration,
        };
    },
});

export const claim = internalMutation({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
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
    handler: async (ctx, args) => {
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
            const unavailable = unknownObservationOutcome(request);
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
            (state.mission ||
                state.operation?.nativeAuthority === "research") &&
            (await pauseResearchAtBoundary(ctx, state.runId, state.mission))
        )
            return {
                kind: "outcome" as const,
                outcome: {
                    kind: "unavailable" as const,
                    code: "research_paused",
                },
            };
        if (state.mission) {
            const missionId = state.mission._id;
            const active = await ctx.db
                .query("agentOperationRequests")
                .withIndex("by_mission_and_status", (q) =>
                    q.eq("missionId", missionId).eq("status", "running"),
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
        const waitEventId =
            request.waitEventId ??
            (state.mission?.workflowId &&
            "protocolVersion" in state.mission &&
            state.mission.protocolVersion === 3
                ? await workflow.createEvent(ctx, {
                      name: `operation:${request._id}`,
                      workflowId: state.mission.workflowId as WorkflowId,
                  })
                : undefined);
        const deadlineAt = state.mission?.deadlineAt ?? request.deadlineAt;
        const expiryJobId =
            deadlineAt === undefined
                ? undefined
                : await ctx.scheduler.runAt(
                      deadlineAt,
                      internal.execution.operations.expire,
                      {
                          requestId: request._id,
                          expectedGeneration: request.expectedGeneration,
                      },
                  );
        await ctx.db.patch(request._id, {
            status: "running",
            waitEventId,
            expiryJobId,
        });
        await recordEvent(ctx, request, "operation_dispatched");
        if (request.input.kind === "invalid")
            throw executionError("invalid_operation_input");
        return {
            kind: "execute" as const,
            missionId: state.mission?._id,
            runId: state.runId,
            input: request.input,
        };
    },
});

export const recordResult = internalMutation({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
        outcome: operationOutcomeValidator,
        historyRead: v.optional(historyReadReceiptValidator),
    },
    returns: operationOutcomeValidator,
    handler: async (ctx, args): Promise<Outcome> => {
        const request = await ctx.db.get(args.requestId);
        if (
            !request ||
            (request.status !== "completed" &&
                request.expectedGeneration !== args.expectedGeneration &&
                request.adoptionGeneration !== args.expectedGeneration)
        )
            throw executionError("request_unavailable");
        if (
            request.outcome &&
            stableStringify(request.outcome) !==
                stableStringify(args.outcome) &&
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
                const validated = operation.validateOutcome(
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
            stableStringify(historyRead) !==
                stableStringify(request.historyRead)
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
            await ctx.db.patch(request._id, {
                status: "waiting",
                waitReference: outcome.reference,
            });
            await recordEvent(ctx, request, "operation_waiting");
            return outcome;
        }
        if (
            !["running", "waiting", "observed", "unknown"].includes(
                request.status,
            )
        )
            throw executionError("operation_not_dispatched");
        if (!request.outcome) {
            if (request.expiryJobId)
                await ctx.scheduler.cancel(request.expiryJobId);
            await ctx.db.patch(request._id, {
                outcome,
                historyRead,
                status: "observed",
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
                if (canContinue)
                    await ctx.db.patch(request._id, {
                        status: "completed",
                        adoptionRefusalCode: code,
                    });
            }
            await recordEvent(
                ctx,
                request,
                "late_operation_result_refused",
                code,
            );
            return { kind: "refused", code };
        }
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
                            !validate(
                                definition.stateValidator,
                                progress.state,
                                { db: ctx.db },
                            ))
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
                !isCommonConsultation(request.input.kind) &&
                accounting.added > 0;
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
        if (
            mission?.executionRuntime === "pi-durable" &&
            request.status === "waiting" &&
            !request.outcome
        ) {
            await ctx.db.patch(mission._id, { piResultWakePending: true });
            await schedulePiMission(ctx, mission._id, args.expectedGeneration);
        }
        const runId = mission?.runId ?? request.runId;
        if (runId && (mission || operation.nativeAuthority === "research"))
            await pauseResearchAtBoundary(ctx, runId, mission ?? undefined);
        return outcome;
    },
});
export const dispatch = internalAction({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: operationOutcomeValidator,
    handler: async (ctx, args): Promise<Outcome> => {
        const claimed = await ctx.runMutation(
            internal.execution.operations.claim,
            args,
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
            const executeArgs = {
                ...args,
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

function unknownObservationOutcome(request: Doc<"agentOperationRequests">) {
    if (request.input.kind === "invalid") return undefined;
    const operation = getRegisteredOperation(request.input.kind);
    return operation?.effectKind === "durable_effect"
        ? operation.unknownOutcome
        : undefined;
}

async function markOperationUnknown(
    ctx: MutationCtx,
    request: Doc<"agentOperationRequests">,
) {
    const unavailable = unknownObservationOutcome(request);
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
    const mission = request.missionId
        ? await ctx.db.get(request.missionId)
        : null;
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
export const settleDispatchFailure = internalMutation({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
        failure: dispatchFailureValidator,
    },
    returns: operationOutcomeValidator,
    handler: async (ctx, args): Promise<Outcome> => {
        const request = await ctx.db.get(args.requestId);
        if (
            !request ||
            (request.expectedGeneration !== args.expectedGeneration &&
                request.adoptionGeneration !== args.expectedGeneration)
        )
            throw executionError("request_unavailable");
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
            return ctx.runMutation(internal.execution.operations.recordResult, {
                requestId: args.requestId,
                expectedGeneration: args.expectedGeneration,
                outcome: retained,
            });
        if (request.status === "unknown")
            return { kind: "unavailable", code: "operation_outcome_unknown" };
        if (!["running", "waiting"].includes(request.status))
            throw executionError("operation_not_dispatched");
        if (args.failure.category === "uncertain_effect") {
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
        return ctx.runMutation(internal.execution.operations.recordResult, {
            requestId: args.requestId,
            expectedGeneration: args.expectedGeneration,
            outcome:
                args.failure.category === "authority"
                    ? { kind: "refused", code: args.failure.code }
                    : {
                          kind: "unavailable",
                          code: "operation_execution_failed",
                      },
        });
    },
});

export const missionForDispatch = internalQuery({
    args: { missionId: v.id("agentMissions"), expectedGeneration: v.number() },
    returns: schema.doc("agentMissions"),
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
