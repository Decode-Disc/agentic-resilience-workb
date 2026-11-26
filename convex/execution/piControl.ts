import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    internalQuery,
    type MutationCtx,
    type QueryCtx,
} from "@convex/_generated/server";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import {
    deliveryBodyHash,
    nativeInputBody,
    retainedDeliveryBody,
} from "@convex/execution/conversationBodies";
import {
    NATIVE_WORKER_POLICY,
    PERSISTENCE_PAGE_SIZE,
    PI_OPERATION_WAIT_POLL_MS,
    PI_SESSION_LEASE_MS,
} from "@convex/resourcePolicy";
import schema from "@convex/schema";
import { type Infer, v } from "convex/values";
import { getAgentDefinition } from "./agentCatalog";
import {
    executionError,
    executionFailureCode,
    recordMissionEvent,
    requireDossierAuthority,
    requireMissionAuthority,
} from "./authority";
import { analystTurnDeliveries } from "./conversations";
import { successfulAuxiliaryResponse } from "./executionProtocol";
import {
    contextObservationSequence,
    hasReceivedResponse,
    invocationResponseManifest,
    matchInvocationResponse,
    receivedResponseDigest,
    retainedNativeCalls,
} from "./journal";
import { retainedTextualOutcome } from "./missionData";
import { completionFeedbackValidator } from "./operationContracts";
import {
    needsNativeSettlement,
    piLeaseValidator,
    requirePiWriter,
    sessionForMission,
    tracksNativeSettlement,
} from "./piStore";
import { suspendInterruptedResearch } from "./researchControl";
import { retainedTextFragment } from "./retainedText";
import { nativeInputsValidator } from "./schema";

async function publicationControl(ctx: QueryCtx) {
    return ctx.db
        .query("piPublication")
        .withIndex("by_key", (q) => q.eq("key", "workers"))
        .unique();
}

async function publicationStatusValue(ctx: QueryCtx) {
    const control = await publicationControl(ctx);
    const active = await ctx.db
        .query("agentMissions")
        .withIndex("by_pi_active_writer", (q) =>
            q.gt("piActiveWriter", undefined),
        )
        .first();
    const lease = await ctx.db
        .query("piSessions")
        .withIndex("by_lease_until", (q) => q.gt("leaseUntil", Date.now()))
        .first();
    return {
        held: control?.held ?? false,
        hasActiveWorkers: !!active || !!lease,
    };
}

/** Administrative publication control shares the worker admission transaction; it never pauses domain research. */
export const holdPublication = internalMutation({
    args: { held: v.boolean() },
    returns: v.null(),
    handler: async (ctx, args) => {
        if (!args.held && (await publicationStatusValue(ctx)).hasActiveWorkers)
            throw executionError("publication_workers_active");
        const current = await publicationControl(ctx);
        if (current) await ctx.db.patch(current._id, { held: args.held });
        else
            await ctx.db.insert("piPublication", {
                key: "workers",
                held: args.held,
            });
        return null;
    },
});

/** Explicitly fences expired admitted writers while publication is held. */
export const recoverPublicationWorkers = internalMutation({
    args: {},
    returns: v.null(),
    handler: async (ctx) => {
        if (!(await publicationControl(ctx))?.held)
            throw executionError("publication_hold_required");
        const marked = await ctx.db
            .query("agentMissions")
            .withIndex("by_pi_active_writer", (q) =>
                q.gt("piActiveWriter", undefined),
            )
            .take(NATIVE_WORKER_POLICY.publicationRecoveryMaxWorkers + 1);
        if (marked.length > NATIVE_WORKER_POLICY.publicationRecoveryMaxWorkers)
            throw executionError("publication_recovery_capacity");
        for (const mission of marked) {
            const session = await sessionForMission(ctx, mission);
            if (
                !session ||
                session.missionId !== mission._id ||
                session.generation !== mission.generation ||
                session.writer !== mission.piActiveWriter ||
                session.leaseUntil > Date.now()
            )
                throw executionError("publication_workers_active");
            await ctx.db.patch(session._id, {
                epoch: session.epoch + 1,
                writer: `publication-recovery:${session.epoch + 1}`,
                leaseUntil: Date.now(),
            });
            await ctx.db.patch(mission._id, { piActiveWriter: undefined });
            await recordMissionEvent(ctx, mission, {
                kind: "publication_worker_recovered",
                cause: "publication_recovery",
            });
        }
        return null;
    },
});

export const publicationStatus = internalQuery({
    args: {},
    returns: v.object({ held: v.boolean(), hasActiveWorkers: v.boolean() }),
    handler: publicationStatusValue,
});

/** Freezes the initial admission lot; later admitted messages keep individual native steering identities. */
export const admittedInputs = internalMutation({
    args: { missionId: v.id("agentMissions"), expectedGeneration: v.number() },
    returns: nativeInputsValidator,
    handler: async (ctx, args) => {
        const mission = await ctx.db.get(args.missionId);
        if (!mission || mission.generation !== args.expectedGeneration)
            throw executionError("stale_execution");
        if (mission.status === "completed")
            await requireDossierAuthority(ctx, mission.runId);
        else
            await requireMissionAuthority(
                ctx,
                mission._id,
                args.expectedGeneration,
            );
        const turn = mission.conversationTurnId
            ? await ctx.db.get(mission.conversationTurnId)
            : null;
        if (!turn || turn.missionId !== mission._id)
            throw executionError("active_turn_required");
        const conversation = await ctx.db.get(turn.conversationId);
        if (!conversation) throw executionError("conversation_unavailable");
        const analystMessages: Infer<
            typeof nativeInputsValidator
        >[number]["messages"] = [];
        const messageOrder = new Map<Id<"agentMessageDeliveries">, number>();
        for await (const message of analystTurnDeliveries(ctx, turn._id)) {
            const messageId = message._id;
            messageOrder.set(messageId, message.nativeInputSequence ?? 0);
            analystMessages.push(await nativeInputBody(message));
        }
        const initialIds =
            turn.nativeInitialMessageIds ??
            analystMessages.map((m) => m.messageId);
        const initialVersion =
            turn.nativeInitialInstructionVersion ?? turn.instructionVersion;
        if (!turn.nativeInitialMessageIds)
            await ctx.db.patch(turn._id, {
                nativeInitialMessageIds: initialIds,
                nativeInitialInstructionVersion: initialVersion,
            });
        return [
            {
                requestId: `turn:${turn._id}:initial`,
                nativeInputSequence: Math.min(
                    ...analystMessages
                        .filter((m) => initialIds.includes(m.messageId))
                        .map((m) => messageOrder.get(m.messageId) ?? 0),
                ),
                instructionVersion: initialVersion,
                messages: analystMessages.filter((m) =>
                    initialIds.includes(m.messageId),
                ),
            },
            ...analystMessages
                .filter((m) => !initialIds.includes(m.messageId))
                .map((m) => ({
                    requestId: `message:${m.messageId}`,
                    nativeInputSequence: messageOrder.get(m.messageId) ?? 0,
                    instructionVersion: turn.instructionVersion,
                    messages: [m],
                })),
        ];
    },
});

async function requireNativeSession(
    ctx: QueryCtx,
    missionId: Id<"agentMissions">,
    sessionId: Id<"piSessions">,
    expectedGeneration: number,
) {
    const mission = await ctx.db.get(missionId);
    const session = await ctx.db.get(sessionId);
    if (
        !mission ||
        session?.missionId !== mission._id ||
        session.generation !== expectedGeneration ||
        mission.generation !== expectedGeneration ||
        (mission.status === "cancelled" && !session.conversationId)
    )
        throw executionError("pi_writer_fenced");
    await requireDossierAuthority(ctx, mission.runId);
    return mission;
}

/** Original task identity survives worker restart; reading a terminal tail grants no progression authority. */
export const nativeInvocation = internalQuery({
    args: {
        missionId: v.id("agentMissions"),
        expectedGeneration: v.number(),
        sessionId: v.id("piSessions"),
        taskKey: v.string(),
    },
    returns: v.union(schema.doc("agentInvocations"), v.null()),
    handler: async (ctx, args) => {
        const mission = await requireNativeSession(
            ctx,
            args.missionId,
            args.sessionId,
            args.expectedGeneration,
        );
        const invocation = await ctx.db
            .query("agentInvocations")
            .withIndex("by_run_and_task_key", (q) =>
                q
                    .eq("runId", mission.runId)
                    .eq("taskKey", `${args.sessionId}:${args.taskKey}`),
            )
            .unique();
        if (invocation && invocation.missionId !== mission._id)
            throw executionError("pi_task_mission_conflict");
        return invocation;
    },
});

/** A generation fence retires an already running wake; only pending jobs need cancellation. */
export async function cancelPiWake(
    ctx: MutationCtx,
    id: Id<"_scheduled_functions">,
) {
    const job = await ctx.db.system.get(id);
    if (job?.state.kind === "pending") await ctx.scheduler.cancel(id);
}

/** An early wake is harmless; always commit its recovery successor before starting a worker. */
export async function schedulePiMission(
    ctx: MutationCtx,
    missionId: Id<"agentMissions">,
    generation: number,
    at = Date.now(),
) {
    const mission = await ctx.db.get(missionId);
    if (
        !mission ||
        mission.piRebinding ||
        mission.generation !== generation ||
        (["completed", "cancelled", "blocked"].includes(mission.status) &&
            !(
                ["completed", "cancelled"].includes(mission.status) &&
                needsNativeSettlement(
                    mission,
                    await sessionForMission(ctx, mission),
                )
            ))
    )
        return;
    if (
        mission.piWakeId &&
        mission.piWakeAt !== undefined &&
        mission.piWakeAt <= at
    )
        return;
    if (mission.piWakeId) await cancelPiWake(ctx, mission.piWakeId);
    const token = `${generation}:${at}:${Math.random()}`;
    const id = await ctx.scheduler.runAt(at, internal.execution.piWorker.run, {
        missionId,
        expectedGeneration: generation,
        token,
    });
    await ctx.db.patch(missionId, {
        piWakeId: id,
        piWakeAt: at,
        piWakeToken: token,
    });
}

function storageCapacityFailure(code: string | undefined) {
    return code === "pi_storage_capacity" || code === "pi_commit_capacity";
}

async function recordWorkerFailure(
    ctx: MutationCtx,
    mission: Doc<"agentMissions">,
    code: string,
) {
    if (["completed", "cancelled", "blocked"].includes(mission.status)) return;
    const run = await ctx.db.get(mission.runId);
    const paused =
        mission.executionScope !== "conversation" &&
        (run?.executionStatus === "paused" ||
            (run?.researchPauseRequested && code === "research_paused"));
    const blockCode =
        code === "node_action_deadline" ? "execution_interrupted" : code;
    await ctx.db.patch(mission._id, {
        status: paused ? "waiting" : "blocked",
        blockCode: paused ? undefined : blockCode,
    });
    await recordMissionEvent(ctx, mission, {
        kind: paused ? "mission_waiting" : "mission_blocked",
        cause: "pi_worker",
        code,
    });
    if (blockCode === "execution_interrupted" && !paused)
        await suspendInterruptedResearch(ctx, mission);
}

/** Research-only scheduled waits have no conversational steering queue; uncertainty takes normal replay. */
async function unchangedScheduledWait(
    ctx: MutationCtx,
    mission: Doc<"agentMissions">,
    session: Doc<"piSessions"> | null,
) {
    if (
        mission.executionScope !== "research" ||
        mission.conversationTurnId ||
        mission.piActiveWriter ||
        mission.piRebinding ||
        mission.piResultWakePending ||
        !session ||
        session.conversationId ||
        session.missionId !== mission._id ||
        session.generation !== mission.generation ||
        session.sequence === 0 ||
        session.observationSequence === undefined ||
        session.observationSequence !==
            (await contextObservationSequence(ctx, mission.runId))
    )
        return false;
    for (const status of ["pending", "running", "observed", "unknown"] as const)
        if (
            await ctx.db
                .query("agentOperationRequests")
                .withIndex("by_mission_and_status", (q) =>
                    q.eq("missionId", mission._id).eq("status", status),
                )
                .first()
        )
            return false;
    const waiting = await ctx.db
        .query("agentOperationRequests")
        .withIndex("by_mission_and_status", (q) =>
            q.eq("missionId", mission._id).eq("status", "waiting"),
        )
        .take(2);
    const request = waiting[0];
    if (
        waiting.length !== 1 ||
        !request?.scheduledJobId ||
        request.expectedGeneration !== mission.generation ||
        request.outcome ||
        request.effect
    )
        return false;
    const job = await ctx.db.system.get(request.scheduledJobId);
    return job?.state.kind === "pending" || job?.state.kind === "inProgress";
}

async function blockNativeSettlement(
    ctx: MutationCtx,
    mission: Doc<"agentMissions">,
    session: Doc<"piSessions">,
    failure: string,
) {
    await ctx.db.patch(session._id, { settlementFailureCode: failure });
    if (session.conversationId)
        await ctx.db.patch(session.conversationId, {
            queuePaused: true,
            admissionFailure: { code: "native_settlement_incomplete" },
        });
    await recordMissionEvent(ctx, mission, {
        kind: "native_settlement_blocked",
        cause: "pi_worker",
        code: failure,
    });
    if (mission.parentRequestId || mission.completionEventId)
        await ctx.runMutation(internal.execution.handoffs.finishChild, {
            missionId: mission._id,
        });
}

export const prepare = internalMutation({
    args: {
        missionId: v.id("agentMissions"),
        expectedGeneration: v.number(),
        token: v.string(),
        writer: v.string(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        const mission = await ctx.db.get(args.missionId);
        if (
            !mission ||
            mission.piWakeToken !== args.token ||
            mission.generation !== args.expectedGeneration
        )
            return false;
        const session = await sessionForMission(ctx, mission);
        await ctx.db.patch(mission._id, {
            piWakeId: undefined,
            piWakeAt: undefined,
            piWakeToken: undefined,
        });
        if ((await publicationControl(ctx))?.held) {
            await schedulePiMission(
                ctx,
                mission._id,
                args.expectedGeneration,
                Date.now() + NATIVE_WORKER_POLICY.publicationHoldPollMs,
            );
            return false;
        }
        if (session?.settlementFailureCode) return false;
        const settling =
            ["completed", "cancelled"].includes(mission.status) &&
            needsNativeSettlement(mission, session);
        if (
            ["completed", "cancelled", "blocked"].includes(mission.status) &&
            !settling
        )
            return false;
        try {
            if (settling) await requireDossierAuthority(ctx, mission.runId);
            else
                await requireMissionAuthority(
                    ctx,
                    mission._id,
                    args.expectedGeneration,
                );
            // A second scheduled action must wait for the admitted writer's lease to expire.
            if (
                session &&
                session.generation === args.expectedGeneration &&
                session.writer !== args.writer &&
                session.leaseUntil > Date.now()
            ) {
                await schedulePiMission(
                    ctx,
                    mission._id,
                    args.expectedGeneration,
                    session.leaseUntil,
                );
                return false;
            }
            if (
                !settling &&
                (await unchangedScheduledWait(ctx, mission, session))
            ) {
                await schedulePiMission(
                    ctx,
                    mission._id,
                    args.expectedGeneration,
                    Date.now() + PI_OPERATION_WAIT_POLL_MS,
                );
                return false;
            }
            if (
                settling &&
                session &&
                mission.piActiveWriter !== undefined &&
                session.settlementEpoch !== session.epoch
            ) {
                const attempts = (session.settlementAttempts ?? 0) + 1;
                await ctx.db.patch(session._id, {
                    settlementAttempts: attempts,
                    settlementEpoch: session.epoch,
                });
                if (attempts >= NATIVE_WORKER_POLICY.settlementMaxAttempts) {
                    await ctx.db.patch(mission._id, {
                        piActiveWriter: undefined,
                    });
                    await blockNativeSettlement(
                        ctx,
                        mission,
                        session,
                        "native_settlement_incomplete",
                    );
                    return false;
                }
            }
            await ctx.runMutation(internal.execution.piStore.claim, {
                missionId: mission._id,
                expectedGeneration: args.expectedGeneration,
                writer: args.writer,
            });
        } catch (error) {
            const code = executionFailureCode(error);
            if (!code) throw error;
            await recordWorkerFailure(ctx, mission, code);
            if (settling && session && storageCapacityFailure(code))
                await blockNativeSettlement(ctx, mission, session, code);
            else if (mission.parentRequestId || mission.completionEventId)
                await ctx.runMutation(internal.execution.handoffs.finishChild, {
                    missionId: mission._id,
                });
            return false;
        }
        await ctx.db.patch(mission._id, {
            piActiveWriter: args.writer,
            piResultWakePending: undefined,
        });
        await schedulePiMission(
            ctx,
            mission._id,
            args.expectedGeneration,
            Date.now() + PI_SESSION_LEASE_MS,
        );
        return true;
    },
});

export const state = internalQuery({
    args: { missionId: v.id("agentMissions"), expectedGeneration: v.number() },
    returns: schema.doc("agentMissions"),
    handler: async (ctx, args) => {
        const mission = await ctx.db.get(args.missionId);
        if (
            mission &&
            mission.generation === args.expectedGeneration &&
            ["completed", "cancelled"].includes(mission.status) &&
            needsNativeSettlement(
                mission,
                await sessionForMission(ctx, mission),
            )
        ) {
            await requireDossierAuthority(ctx, mission.runId);
            return mission;
        }
        return (
            await requireMissionAuthority(
                ctx,
                args.missionId,
                args.expectedGeneration,
            )
        ).mission;
    },
});

const historicalCorrelation = v.object({
    kind: v.literal("historical"),
    invocation: schema.doc("agentInvocations"),
});

export const operation = internalQuery({
    args: {
        missionId: v.id("agentMissions"),
        expectedGeneration: v.number(),
        callId: v.string(),
        historical: v.optional(
            v.object({
                invocationId: v.id("agentInvocations"),
                responseHash: v.string(),
                index: v.number(),
            }),
        ),
    },
    returns: v.union(
        schema.doc("agentOperationRequests"),
        historicalCorrelation,
        v.null(),
    ),
    handler: async (ctx, args) => {
        const { mission } = await requireMissionAuthority(
            ctx,
            args.missionId,
            args.expectedGeneration,
        );
        const invocation = mission.lastInvocationId
            ? await ctx.db.get(mission.lastInvocationId)
            : null;
        if (!invocation) throw executionError("invocation_unavailable");
        if (invocation.missionId !== mission._id)
            throw executionError("operation_correlation_invalid");
        const recovered = args.historical;
        if (
            recovered &&
            (recovered.invocationId !== invocation._id ||
                !(await matchInvocationResponse(
                    ctx,
                    invocation,
                    "adopted",
                    recovered,
                )))
        )
            throw executionError("operation_correlation_invalid");
        const calls = await retainedNativeCalls(ctx, invocation);
        if (calls) {
            const index = calls.findIndex(
                (call) => call.callId === args.callId,
            );
            const requestId = invocation.requestIds?.[index];
            const request = requestId ? await ctx.db.get(requestId) : null;
            if (request && request.missionId !== mission._id)
                throw executionError("operation_correlation_invalid");
            return request;
        }
        if (!invocation.requestIds?.length) return null;
        // Retained historical responses must be reconstructed outside this transaction.
        if (!recovered && invocation.outputTextId)
            return { kind: "historical" as const, invocation };
        const response =
            !recovered && invocation.outputJson
                ? JSON.parse(invocation.outputJson)
                : null;
        const index =
            recovered?.index ??
            (response?.kind === "operations"
                ? response.requests.findIndex(
                      (r: { callId: string }) => r.callId === args.callId,
                  )
                : -1);
        if (!Number.isSafeInteger(index) || index < -1)
            throw executionError("operation_correlation_invalid");
        const id = invocation.requestIds[index];
        if (id) {
            const request = await ctx.db.get(id);
            if (request && request.missionId !== mission._id)
                throw executionError("operation_correlation_invalid");
            return request;
        }
        for (const requestId of invocation.requestIds) {
            const request = await ctx.db.get(requestId);
            if (
                request?.cause === args.callId &&
                request.missionId === mission._id
            )
                return request;
        }
        return null;
    },
});

const completionDispositionValidator = v.union(
    v.object({ kind: v.literal("accepted") }),
    v.object({
        kind: v.literal("operation"),
        requestId: v.id("agentOperationRequests"),
    }),
    v.object({ kind: v.literal("pending") }),
    v.object({
        kind: v.literal("refused"),
        code: v.string(),
        correction: v.optional(completionFeedbackValidator),
    }),
);

async function nativeCompletionInvocation(
    ctx: QueryCtx,
    lease: Infer<typeof piLeaseValidator>,
    options: { requireCompleted?: boolean; requireNoBlock?: boolean } = {},
) {
    const session = await requirePiWriter(ctx, lease, Date.now());
    const invalid = (code: string) => {
        if (options.requireCompleted) return null;
        throw executionError(code);
    };
    const mission = await ctx.db.get(lease.missionId);
    if (!mission) return invalid("mission_unavailable");
    if (options.requireCompleted && mission.status !== "completed") return null;
    if (
        getAgentDefinition(mission.definitionId, mission.definitionVersion)
            .completionTransport !== "native_tool"
    )
        return invalid("completion_correlation_invalid");
    const invocation = mission.lastInvocationId
        ? await ctx.db.get(mission.lastInvocationId)
        : null;
    if (
        !invocation ||
        invocation.missionId !== mission._id ||
        (invocation.adoptionGeneration ?? invocation.generation) !==
            lease.generation ||
        !invocation.taskKey.startsWith(`${session._id}:`) ||
        invocation.status !== "returned" ||
        (options.requireNoBlock && invocation.blockCode !== undefined)
    )
        return invalid("completion_correlation_invalid");
    return { mission, invocation };
}

/** Records call correlation verified from the historical fragments by the leased worker. */
export const retainHistoricalCompletion = internalMutation({
    args: {
        ...piLeaseValidator.fields,
        invocationId: v.id("agentInvocations"),
        correlation: v.union(
            v.object({ kind: v.literal("completion"), callId: v.string() }),
            v.object({
                kind: v.literal("operations"),
                calls: v.array(
                    v.object({
                        callId: v.string(),
                        completion: v.optional(v.literal(true)),
                    }),
                ),
            }),
        ),
        responseHash: v.string(),
    },
    returns: v.null(),
    handler: async (
        ctx,
        { invocationId, correlation, responseHash, ...lease },
    ) => {
        const current = await nativeCompletionInvocation(ctx, lease);
        const invocation = current?.invocation;
        if (
            invocation?._id !== invocationId ||
            (correlation.kind === "completion"
                ? !!invocation.requestIds?.length ||
                  !!invocation.nativeOperations
                : correlation.calls.length !== invocation.requestIds?.length ||
                  !!invocation.nativeCompletion)
        )
            throw executionError("completion_correlation_invalid");
        const expected = { responseHash };
        const patch =
            correlation.kind === "completion"
                ? {
                      nativeCompletion: {
                          ...expected,
                          callId: correlation.callId,
                      },
                  }
                : {
                      nativeOperations: {
                          ...expected,
                          calls: correlation.calls,
                      },
                  };
        const existing =
            correlation.kind === "completion"
                ? invocation.nativeCompletion
                : invocation.nativeOperations;
        const recovered =
            "nativeCompletion" in patch
                ? patch.nativeCompletion
                : patch.nativeOperations;
        if (existing) {
            if (stableStringify(existing) !== stableStringify(recovered))
                throw executionError("completion_correlation_invalid");
            return null;
        }
        if (
            !(await matchInvocationResponse(
                ctx,
                invocation,
                "adopted",
                expected,
            ))
        )
            throw executionError("completion_correlation_invalid");
        await matchInvocationResponse(ctx, invocation, "received", expected);
        await ctx.db.patch(invocation._id, patch);
        return null;
    },
});

async function loadVerifiedNativeCompletionInvocation(
    ctx: QueryCtx,
    lease: Infer<typeof piLeaseValidator>,
    options: {
        requireCompleted?: boolean;
        requireNoBlock?: boolean;
    } = {},
) {
    const current = await nativeCompletionInvocation(ctx, lease, options);
    if (!current) return null;
    const { mission, invocation } = current;
    const invalid = (code: string) => {
        if (options.requireCompleted) return null;
        throw executionError(code);
    };
    // An invocation with operation requests cannot be an accepted sole completion.
    if (options.requireCompleted && invocation.requestIds?.length) return null;
    const completion = invocation.nativeCompletion;
    if (completion) {
        if (!invocation.outputTextId && invocation.outputJson === undefined)
            return invalid("completion_correlation_invalid");
        for (const textId of new Set([
            invocation.outputTextId,
            invocation.receivedOutputTextId,
        ])) {
            if (!textId) continue;
            const text = await invocationResponseManifest(
                ctx,
                invocation,
                textId,
                "response",
            );
            if (text.contentHash !== completion.responseHash)
                return invalid("completion_correlation_invalid");
        }
        for (const inline of [
            invocation.outputJson,
            invocation.receivedOutputJson,
        ]) {
            if (
                inline !== undefined &&
                sha256Hex(inline) !== completion.responseHash
            )
                return invalid("completion_correlation_invalid");
        }
        return {
            mission,
            invocation,
            callId: completion.callId,
            requests: undefined,
        };
    }
    if (invocation.nativeOperations) {
        if (options.requireCompleted) return null;
        const calls = await retainedNativeCalls(ctx, invocation);
        return { mission, invocation, callId: undefined, requests: calls };
    }
    if (hasReceivedResponse(invocation)) {
        const receivedHash = await receivedResponseDigest(ctx, invocation);
        const adoptedHash = invocation.outputTextId
            ? (
                  await invocationResponseManifest(
                      ctx,
                      invocation,
                      invocation.outputTextId,
                      "response",
                  )
              ).contentHash
            : invocation.outputJson === undefined
              ? undefined
              : sha256Hex(invocation.outputJson);
        if (receivedHash !== adoptedHash)
            return invalid("completion_correlation_invalid");
    }
    return { kind: "historical" as const, invocation };
}

/** Resolves the retained disposition of a submit_completion tool call without re-running domain completion. */
export const completionDisposition = internalQuery({
    args: {
        ...piLeaseValidator.fields,
        callId: v.string(),
    },
    returns: v.union(completionDispositionValidator, historicalCorrelation),
    handler: async (ctx, args) => {
        const { callId, ...lease } = args;
        const verified = await loadVerifiedNativeCompletionInvocation(
            ctx,
            lease,
        );
        if (!verified) throw executionError("completion_correlation_invalid");
        if (verified.kind === "historical") return verified;
        const { mission, invocation, requests } = verified;
        if (requests) {
            await requireMissionAuthority(ctx, mission._id, lease.generation);
            const index = requests.findIndex(
                (request) => request.callId === callId && request.completion,
            );
            const requestId =
                index >= 0 ? invocation.requestIds?.[index] : undefined;
            const request = requestId ? await ctx.db.get(requestId) : null;
            if (!request || request.missionId !== mission._id)
                throw executionError("completion_correlation_invalid");
            return { kind: "operation" as const, requestId: request._id };
        }
        if (verified.callId === undefined || verified.callId !== callId)
            throw executionError("completion_correlation_invalid");
        if (mission.status === "completed" && !invocation.blockCode)
            return { kind: "accepted" as const };
        if (invocation.blockCode === "pending_operations")
            return { kind: "pending" as const };
        await requireMissionAuthority(ctx, mission._id, lease.generation);
        if (
            invocation.blockCode === "completion_correction_required" ||
            invocation.blockCode === "mission_context_changed" ||
            invocation.blockCode === "stale_instructions"
        )
            return {
                kind: "refused" as const,
                code: invocation.blockCode,
                ...(invocation.correction
                    ? { correction: invocation.correction }
                    : {}),
            };
        throw executionError(
            invocation.blockCode ?? "completion_correlation_invalid",
        );
    },
});

/** Confirms an accepted sole native completion from retained state for afterTools tail settlement. */
export const terminalCompletionAccepted = internalQuery({
    args: piLeaseValidator.fields,
    returns: v.union(v.boolean(), historicalCorrelation),
    handler: async (ctx, lease) => {
        const verified = await loadVerifiedNativeCompletionInvocation(
            ctx,
            lease,
            { requireCompleted: true, requireNoBlock: true },
        );
        if (verified?.kind === "historical") return verified;
        return verified?.callId !== undefined;
    },
});

export const finishAuxiliary = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
        recovered: v.optional(
            v.object({
                responseHash: v.string(),
                refusalCode: v.optional(v.string()),
            }),
        ),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
        if (
            !invocation?.missionId ||
            invocation.purpose !== "compaction" ||
            !hasReceivedResponse(invocation)
        )
            throw executionError("invocation_unavailable");
        await requireMissionAuthority(
            ctx,
            invocation.missionId,
            args.expectedGeneration,
        );
        const digest = await receivedResponseDigest(ctx, invocation);
        if (args.recovered && args.recovered.responseHash !== digest)
            throw executionError("invocation_result_conflict");
        if (
            digest !== sha256Hex(stableStringify(successfulAuxiliaryResponse()))
        ) {
            const inline = invocation.receivedOutputJson;
            if (inline !== undefined) {
                const response = JSON.parse(inline);
                if (response.kind === "blocked")
                    throw executionError(response.code);
            } else {
                if (!args.recovered)
                    throw executionError("retained_response_invalid");
                if (args.recovered.refusalCode !== undefined)
                    throw executionError(args.recovered.refusalCode);
            }
        }
        await ctx.db.patch(invocation._id, {
            status: "returned",
            outputJson: invocation.receivedOutputJson,
            outputTextId: invocation.receivedOutputTextId,
            completedAt: Date.now(),
        });
        return null;
    },
});

export const closeWorker = internalMutation({
    args: {
        missionId: v.id("agentMissions"),
        expectedGeneration: v.number(),
        writer: v.string(),
        at: v.optional(v.number()),
        error: v.optional(v.string()),
        nativeSettled: v.optional(v.boolean()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const mission = await ctx.db.get(args.missionId);
        const session = mission ? await sessionForMission(ctx, mission) : null;
        if (
            !mission ||
            (mission.piActiveWriter !== undefined
                ? mission.piActiveWriter !== args.writer
                : session?.writer !== args.writer) ||
            (session &&
                (session.missionId !== args.missionId ||
                    session.generation !== args.expectedGeneration ||
                    session.writer !== args.writer))
        )
            return null;
        if (
            !args.nativeSettled &&
            session?.settlementEpoch === session?.epoch &&
            session?.settlementEpoch !== undefined
        )
            return null;
        const settlesSession = tracksNativeSettlement(mission, session);
        const settledSuccess =
            settlesSession &&
            args.nativeSettled &&
            !args.error &&
            (session?.conversationId ? true : mission.status === "completed");
        if (session)
            await ctx.db.patch(session._id, {
                leaseUntil: Date.now(),
                ...(settledSuccess
                    ? {
                          settledSequence: session.sequence,
                          settlementAttempts: undefined,
                          settlementEpoch: undefined,
                          settlementFailureCode: undefined,
                      }
                    : {}),
            });
        if (mission.generation !== args.expectedGeneration) return null;
        let code = args.error;
        if (code === "generation_backend_interrupted") {
            const last = mission.lastInvocationId
                ? await ctx.db.get(mission.lastInvocationId)
                : null;
            code =
                last && hasReceivedResponse(last)
                    ? "execution_interrupted"
                    : last?.providerCallId
                      ? "attempt_outcome_unknown"
                      : "execution_interrupted";
        }
        if (code) await recordWorkerFailure(ctx, mission, code);
        const storageExhausted = storageCapacityFailure(code);
        if (session?.conversationId && code && storageExhausted)
            await ctx.db.patch(session.conversationId, {
                queuePaused: true,
                admissionFailure: { code },
            });
        if (mission.piWakeId) await cancelPiWake(ctx, mission.piWakeId);
        await ctx.db.patch(mission._id, {
            piWakeId: undefined,
            piWakeAt: undefined,
            piWakeToken: undefined,
            piActiveWriter: undefined,
        });
        const nextAt = mission.piResultWakePending ? Date.now() : args.at;
        const settlingTerminal =
            !args.nativeSettled && needsNativeSettlement(mission, session);
        if (!settlingTerminal && !args.error && nextAt !== undefined)
            await schedulePiMission(
                ctx,
                mission._id,
                args.expectedGeneration,
                Math.min(nextAt, mission.piWakeAt ?? nextAt),
            );
        if (settlingTerminal && session) {
            const attempts = (session.settlementAttempts ?? 0) + 1;
            const permanent =
                code &&
                (storageExhausted ||
                    [
                        "publication_context_unavailable",
                        "pi_commit_invalid",
                        "pi_commit_conflict",
                        "pi_log_sequence_conflict",
                        "pi_terminal_dispatch_forbidden",
                        "retained_response_invalid",
                        "completion_correlation_invalid",
                        "not_authorized",
                    ].includes(code));
            const failure = permanent
                ? code
                : attempts >= NATIVE_WORKER_POLICY.settlementMaxAttempts
                  ? "native_settlement_incomplete"
                  : undefined;
            await ctx.db.patch(session._id, {
                settlementAttempts: attempts,
                settlementEpoch: session.epoch,
                ...(failure ? { settlementFailureCode: failure } : {}),
            });
            if (failure) {
                await blockNativeSettlement(ctx, mission, session, failure);
            } else
                await schedulePiMission(
                    ctx,
                    mission._id,
                    args.expectedGeneration,
                    Date.now() +
                        NATIVE_WORKER_POLICY.settlementRetryBaseMs *
                            2 ** (attempts - 1),
                );
        }
        if (
            !settlingTerminal &&
            (mission.parentRequestId || mission.completionEventId)
        )
            await ctx.runMutation(internal.execution.handoffs.finishChild, {
                missionId: mission._id,
            });
        if (session?.conversationId && args.nativeSettled && !args.error)
            await ctx.scheduler.runAfter(
                0,
                internal.execution.conversations.pumpWorkbench,
                { runId: mission.runId },
            );
        return null;
    },
});

const recoveryInvocationValidator = v.object({
    invocationId: v.id("agentInvocations"),
    expectedGeneration: v.number(),
});

async function requireRecoveryInvocation(
    ctx: QueryCtx,
    {
        invocationId,
        expectedGeneration,
    }: Infer<typeof recoveryInvocationValidator>,
    sessionId?: Id<"piSessions">,
) {
    const invocation = await ctx.db.get(invocationId);
    if (!invocation?.missionId) throw executionError("invocation_unavailable");
    if (sessionId)
        await requireNativeSession(
            ctx,
            invocation.missionId,
            sessionId,
            expectedGeneration,
        );
    else {
        if (
            (invocation.adoptionGeneration ?? invocation.generation) !==
            expectedGeneration
        )
            throw executionError("invocation_unavailable");
        await requireMissionAuthority(
            ctx,
            invocation.missionId,
            expectedGeneration,
        );
    }
    return invocation;
}

export const invocation = internalQuery({
    args: recoveryInvocationValidator.fields,
    returns: schema.doc("agentInvocations"),
    handler: (ctx, args) => requireRecoveryInvocation(ctx, args),
});

/** Reads one fragment of the response pinned by the invocation and recovery authority. */
export const invocationFragment = internalQuery({
    args: {
        ...recoveryInvocationValidator.fields,
        sessionId: v.optional(v.id("piSessions")),
        part: v.union(
            v.literal("received"),
            v.literal("adopted"),
            v.literal("raw"),
        ),
        textId: v.id("retainedTexts"),
        index: v.number(),
    },
    returns: v.object({
        content: v.string(),
        fragmentCount: v.number(),
        contentHash: v.string(),
        characters: v.number(),
        sizeBytes: v.number(),
    }),
    handler: async (ctx, args) => {
        const invocation = await requireRecoveryInvocation(
            ctx,
            args,
            args.sessionId,
        );
        const expected =
            args.part === "raw"
                ? invocation.rawOutputTextId
                : args.part === "adopted"
                  ? invocation.outputTextId
                  : invocation.receivedOutputTextId;
        if (expected !== args.textId)
            throw executionError("invocation_result_conflict");
        const text = await invocationResponseManifest(
            ctx,
            invocation,
            args.textId,
            args.part === "raw" ? "raw" : "response",
        );
        return {
            content: await retainedTextFragment(ctx, text, args.index),
            fragmentCount: text.fragmentHashes.length,
            contentHash: text.contentHash,
            characters: text.characters,
            sizeBytes: text.sizeBytes,
        };
    },
});

export const nextOperation = internalQuery({
    args: { missionId: v.id("agentMissions"), expectedGeneration: v.number() },
    returns: v.union(schema.doc("agentOperationRequests"), v.null()),
    handler: async (ctx, args) => {
        await requireMissionAuthority(
            ctx,
            args.missionId,
            args.expectedGeneration,
        );
        for (const status of [
            "observed",
            "waiting",
            "running",
            "pending",
            "unknown",
        ] as const) {
            const request = await ctx.db
                .query("agentOperationRequests")
                .withIndex("by_mission_and_status", (q) =>
                    q.eq("missionId", args.missionId).eq("status", status),
                )
                .first();
            if (request) return request;
        }
        return null;
    },
});

export const rebind = internalMutation({
    args: {
        missionId: v.id("agentMissions"),
        expectedGeneration: v.number(),
        stage: v.number(),
        cursor: v.union(v.string(), v.null()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const { mission } = await requireMissionAuthority(
            ctx,
            args.missionId,
            args.expectedGeneration,
        );
        const statuses = ["pending", "running", "observed", "waiting"] as const;
        const status = statuses[args.stage];
        if (!status) throw executionError("pi_rebind_invalid");
        const page = await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission_and_status", (q) =>
                q.eq("missionId", mission._id).eq("status", status),
            )
            .paginate({
                numItems: PERSISTENCE_PAGE_SIZE.nativeRebind,
                cursor: args.cursor,
            });
        for (const request of page.page)
            await ctx.db.patch(
                request._id,
                request.status === "pending"
                    ? { expectedGeneration: args.expectedGeneration }
                    : { adoptionGeneration: args.expectedGeneration },
            );
        if (!page.isDone || args.stage < statuses.length - 1)
            await ctx.scheduler.runAfter(
                0,
                internal.execution.piControl.rebind,
                {
                    ...args,
                    stage: page.isDone ? args.stage + 1 : args.stage,
                    cursor: page.isDone ? null : page.continueCursor,
                },
            );
        else {
            await ctx.db.patch(mission._id, { piRebinding: undefined });
            await schedulePiMission(ctx, mission._id, args.expectedGeneration);
        }
        return null;
    },
});

const publicationArgs = v.object({
    missionId: v.id("agentMissions"),
    expectedGeneration: v.number(),
});

async function loadPublication(
    ctx: QueryCtx,
    args: Infer<typeof publicationArgs>,
) {
    const mission = await ctx.db.get(args.missionId);
    if (!mission || mission.generation !== args.expectedGeneration)
        throw executionError("stale_execution");
    await requireDossierAuthority(ctx, mission.runId);
    const turn = mission.conversationTurnId
        ? await ctx.db.get(mission.conversationTurnId)
        : null;
    const completed = mission.status === "completed";
    const delivery =
        completed && turn?.publishedMessageId
            ? await ctx.db.get(turn.publishedMessageId)
            : null;
    if (
        turn?.publishedMessageId &&
        completed &&
        (!delivery ||
            delivery.runId !== mission.runId ||
            delivery.turnId !== turn._id ||
            delivery.conversationId !== turn.conversationId ||
            (delivery.bodyTextId && turn.missionId !== mission._id) ||
            ((turn.publicationHash !== undefined ||
                (delivery.bodyTextId && !delivery.bodyContentHash)) &&
                deliveryBodyHash(delivery) !== turn.publicationHash))
    )
        throw executionError("publication_context_unavailable");
    return { mission, turn, delivery, completed };
}

const publicationStateValidator = v.object({
    completed: v.boolean(),
    staleInstructions: v.boolean(),
    publishedReply: v.optional(
        v.object({
            messageId: v.optional(v.id("agentMessageDeliveries")),
            contentHash: v.string(),
        }),
    ),
});

export const publicationState = internalQuery({
    args: publicationArgs.fields,
    returns: publicationStateValidator,
    handler: async (
        ctx,
        args,
    ): Promise<Infer<typeof publicationStateValidator>> => {
        const { mission, turn, delivery, completed } = await loadPublication(
            ctx,
            args,
        );
        const last =
            turn?.status === "active" && mission.lastInvocationId
                ? await ctx.db.get(mission.lastInvocationId)
                : null;
        const staleInstructions =
            !!turn &&
            turn.status === "active" &&
            turn.instructionVersion !== last?.instructionVersion;
        if (delivery?.bodyTextId) {
            const text = await retainedDeliveryBody(ctx, delivery);
            return {
                completed,
                staleInstructions,
                publishedReply: {
                    messageId: delivery._id,
                    contentHash: text.contentHash,
                },
            };
        }
        if (
            completed &&
            !delivery &&
            "protocolVersion" in mission &&
            mission.textualOutcome?.ownership === "mission"
        ) {
            const outcome = await retainedTextualOutcome(ctx, mission);
            if (!outcome)
                throw executionError("publication_context_unavailable");
            return {
                completed,
                staleInstructions,
                publishedReply: { contentHash: outcome.contentHash },
            };
        }
        if (
            !completed ||
            !getAgentDefinition(mission.definitionId, mission.definitionVersion)
                .conversationReply
        )
            return { completed, staleInstructions };
        throw executionError("publication_context_unavailable");
    },
});

export const publicationFragment = internalQuery({
    args: {
        ...publicationArgs.fields,
        messageId: v.optional(v.id("agentMessageDeliveries")),
        contentHash: v.string(),
        index: v.number(),
    },
    returns: v.object({
        content: v.string(),
        fragmentCount: v.number(),
        contentHash: v.string(),
        characters: v.number(),
        sizeBytes: v.number(),
    }),
    handler: async (ctx, args) => {
        const { mission, delivery, completed } = await loadPublication(
            ctx,
            args,
        );
        const text =
            delivery &&
            delivery._id === args.messageId &&
            deliveryBodyHash(delivery) === args.contentHash
                ? await retainedDeliveryBody(ctx, delivery)
                : completed &&
                    !delivery &&
                    args.messageId === undefined &&
                    "protocolVersion" in mission &&
                    mission.textualOutcome?.ownership === "mission"
                  ? await retainedTextualOutcome(ctx, mission)
                  : undefined;
        if (!text || text.contentHash !== args.contentHash)
            throw executionError("publication_context_unavailable");
        return {
            content: await retainedTextFragment(ctx, text, args.index),
            fragmentCount: text.fragmentHashes.length,
            contentHash: text.contentHash,
            characters: text.characters,
            sizeBytes: text.sizeBytes,
        };
    },
});

export const retireForRepreparation = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
        if (!invocation?.missionId || !hasReceivedResponse(invocation))
            throw executionError("invocation_unavailable");
        await requireMissionAuthority(
            ctx,
            invocation.missionId,
            args.expectedGeneration,
        );
        const digest = await receivedResponseDigest(ctx, invocation);
        const code = (
            ["context_capacity", "native_input_changed"] as const
        ).find(
            (candidate) =>
                digest ===
                sha256Hex(
                    stableStringify({ kind: "blocked", code: candidate }),
                ),
        );
        const receipt = invocation.providerCallId
            ? await ctx.db.get(invocation.providerCallId)
            : null;
        if (
            !code ||
            (invocation.provenance !== "simulation" &&
                receipt &&
                receipt.dispatchOutcome !== "not_dispatched" &&
                !(
                    code === "context_capacity" &&
                    receipt.dispatchOutcome === "response_received"
                ))
        )
            throw executionError("attempt_outcome_unknown");
        if (invocation.status === "returned" && invocation.blockCode === code)
            return null;
        await ctx.db.patch(invocation._id, {
            status: "returned",
            blockCode: code,
            outputJson: invocation.receivedOutputJson,
            outputTextId: invocation.receivedOutputTextId,
            completedAt: Date.now(),
        });
        return null;
    },
});

// Retained function path for older native continuations.
export const retireCapacity = retireForRepreparation;
