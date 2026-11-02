import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    internalQuery,
    type MutationCtx,
    type QueryCtx,
} from "@convex/_generated/server";
import schema from "@convex/schema";
import { v } from "convex/values";
import { getAgentDefinition } from "./agentCatalog";
import {
    executionError,
    executionFailureCode,
    recordMissionEvent,
    requireDossierAuthority,
    requireMissionAuthority,
} from "./authority";
import { readTurnInstructions } from "./conversations";
import { needsNativeSettlement, sessionForMission } from "./piStore";

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
            .take(17);
        if (marked.length > 16)
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
    returns: v.array(
        v.object({
            requestId: v.string(),
            instructionVersion: v.number(),
            messages: v.array(
                v.object({
                    messageId: v.id("agentMessageDeliveries"),
                    text: v.string(),
                }),
            ),
        }),
    ),
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
        const instructions = await readTurnInstructions(ctx, turn);
        const analystMessages = instructions.messages.map(
            ({ messageId, text }) => ({ messageId, text }),
        );
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
                instructionVersion: initialVersion,
                messages: analystMessages.filter((m) =>
                    initialIds.includes(m.messageId),
                ),
            },
            ...analystMessages
                .filter((m) => !initialIds.includes(m.messageId))
                .map((m) => ({
                    requestId: `message:${m.messageId}`,
                    instructionVersion: turn.instructionVersion,
                    messages: [m],
                })),
        ];
    },
});

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
        const mission = await ctx.db.get(args.missionId);
        const session = await ctx.db.get(args.sessionId);
        if (
            !mission ||
            session?.missionId !== mission._id ||
            session.generation !== args.expectedGeneration ||
            mission.generation !== args.expectedGeneration
        )
            throw executionError("pi_writer_fenced");
        await requireDossierAuthority(ctx, mission.runId);
        const invocation = await ctx.db
            .query("agentInvocations")
            .withIndex("by_run_and_task_key", (q) =>
                q
                    .eq("runId", mission.runId)
                    .eq("taskKey", `${session._id}:${args.taskKey}`),
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

async function recordWorkerFailure(
    ctx: MutationCtx,
    mission: Doc<"agentMissions">,
    code: string,
) {
    if (["completed", "cancelled", "blocked"].includes(mission.status)) return;
    const run = await ctx.db.get(mission.runId);
    const paused =
        mission.executionScope !== "conversation" &&
        run?.executionStatus === "paused";
    await ctx.db.patch(mission._id, {
        status: paused ? "waiting" : "blocked",
        blockCode: paused ? undefined : code,
    });
    await recordMissionEvent(ctx, mission, {
        kind: paused ? "mission_waiting" : "mission_blocked",
        cause: "pi_worker",
        code,
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
                Date.now() + 5000,
            );
            return false;
        }
        const session = await sessionForMission(ctx, mission);
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
        } catch (error) {
            const code = executionFailureCode(error);
            if (!code) throw error;
            await recordWorkerFailure(ctx, mission, code);
            if (mission.parentRequestId)
                await ctx.runMutation(internal.execution.handoffs.finishChild, {
                    missionId: mission._id,
                });
            return false;
        }
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
        await ctx.runMutation(internal.execution.piStore.claim, {
            missionId: mission._id,
            expectedGeneration: args.expectedGeneration,
            writer: args.writer,
        });
        await ctx.db.patch(mission._id, {
            piActiveWriter: args.writer,
            piResultWakePending: undefined,
        });
        await schedulePiMission(
            ctx,
            mission._id,
            args.expectedGeneration,
            Date.now() + 90_000,
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

export const operation = internalQuery({
    args: {
        missionId: v.id("agentMissions"),
        expectedGeneration: v.number(),
        callId: v.string(),
    },
    returns: v.union(schema.doc("agentOperationRequests"), v.null()),
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
        // Correlation is retained in invocation order; request.cause may be represented by an event instead.
        const response = invocation.outputJson
            ? JSON.parse(invocation.outputJson)
            : null;
        const index =
            response?.kind === "operations"
                ? response.requests.findIndex(
                      (r: { callId: string }) => r.callId === args.callId,
                  )
                : -1;
        const id = index >= 0 ? invocation.requestIds?.[index] : undefined;
        if (id) return ctx.db.get(id);
        for (const id of invocation.requestIds ?? []) {
            const request = await ctx.db.get(id);
            if (request?.cause === args.callId) return request;
        }
        return null;
    },
});

export const finishAuxiliary = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
        if (
            !invocation?.missionId ||
            invocation.purpose !== "compaction" ||
            !invocation.receivedOutputJson
        )
            throw executionError("invocation_unavailable");
        await requireMissionAuthority(
            ctx,
            invocation.missionId,
            args.expectedGeneration,
        );
        await ctx.db.patch(invocation._id, {
            status: "returned",
            outputJson: invocation.receivedOutputJson,
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
        if (session)
            await ctx.db.patch(session._id, {
                leaseUntil: Date.now(),
                ...(session.conversationId && args.nativeSettled && !args.error
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
            code = last?.receivedOutputJson
                ? "execution_interrupted"
                : last?.providerCallId
                  ? "attempt_outcome_unknown"
                  : "execution_interrupted";
        }
        if (code) await recordWorkerFailure(ctx, mission, code);
        const storageExhausted =
            code === "pi_storage_capacity" || code === "pi_commit_capacity";
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
            session?.conversationId &&
            !args.nativeSettled &&
            ["completed", "cancelled"].includes(mission.status);
        if (!settlingTerminal && !args.error && nextAt !== undefined)
            await schedulePiMission(
                ctx,
                mission._id,
                args.expectedGeneration,
                Math.min(nextAt, mission.piWakeAt ?? nextAt),
            );
        if (settlingTerminal && session?.conversationId) {
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
                    ].includes(code));
            const failure = permanent
                ? code
                : attempts >= 3
                  ? "native_settlement_incomplete"
                  : undefined;
            await ctx.db.patch(session._id, {
                settlementAttempts: attempts,
                settlementEpoch: session.epoch,
                ...(failure ? { settlementFailureCode: failure } : {}),
            });
            if (failure) {
                await ctx.db.patch(session.conversationId, {
                    queuePaused: true,
                    admissionFailure: { code: "native_settlement_incomplete" },
                });
                await recordMissionEvent(ctx, mission, {
                    kind: "native_settlement_blocked",
                    cause: "pi_worker",
                    code: failure,
                });
            } else
                await schedulePiMission(
                    ctx,
                    mission._id,
                    args.expectedGeneration,
                    Date.now() + 1000 * 2 ** (attempts - 1),
                );
        }
        if (mission.parentRequestId)
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

export const invocation = internalQuery({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
    },
    returns: schema.doc("agentInvocations"),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
        if (
            !invocation?.missionId ||
            (invocation.adoptionGeneration ?? invocation.generation) !==
                args.expectedGeneration
        )
            throw executionError("invocation_unavailable");
        await requireMissionAuthority(
            ctx,
            invocation.missionId,
            args.expectedGeneration,
        );
        return invocation;
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
            .paginate({ numItems: 20, cursor: args.cursor });
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

export const publicationState = internalQuery({
    args: { missionId: v.id("agentMissions"), expectedGeneration: v.number() },
    returns: v.object({
        completed: v.boolean(),
        staleInstructions: v.boolean(),
        publishedText: v.optional(v.string()),
    }),
    handler: async (ctx, args) => {
        const mission = await ctx.db.get(args.missionId);
        if (!mission || mission.generation !== args.expectedGeneration)
            throw executionError("stale_execution");
        await requireDossierAuthority(ctx, mission.runId);
        const turn = mission.conversationTurnId
            ? await ctx.db.get(mission.conversationTurnId)
            : null;
        const last = mission.lastInvocationId
            ? await ctx.db.get(mission.lastInvocationId)
            : null;
        return {
            completed: mission.status === "completed",
            ...(mission.status === "completed" &&
            "result" in mission &&
            mission.result
                ? {
                      publishedText: getAgentDefinition(
                          mission.definitionId,
                          mission.definitionVersion,
                      ).conversationReply?.(mission.result),
                  }
                : {}),
            staleInstructions:
                !!turn &&
                turn.status === "active" &&
                turn.instructionVersion !== last?.instructionVersion,
        };
    },
});

export const retireCapacity = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const invocation = await ctx.db.get(args.invocationId);
        if (!invocation?.missionId || !invocation.receivedOutputJson)
            throw executionError("invocation_unavailable");
        await requireMissionAuthority(
            ctx,
            invocation.missionId,
            args.expectedGeneration,
        );
        const result = JSON.parse(invocation.receivedOutputJson);
        const receipt = invocation.providerCallId
            ? await ctx.db.get(invocation.providerCallId)
            : null;
        if (
            result.kind !== "blocked" ||
            result.code !== "context_capacity" ||
            (invocation.provenance !== "simulation" &&
                receipt?.dispatchOutcome !== "not_dispatched")
        )
            throw executionError("attempt_outcome_unknown");
        await ctx.db.patch(invocation._id, {
            status: "returned",
            blockCode: "context_capacity",
            outputJson: invocation.receivedOutputJson,
            completedAt: Date.now(),
        });
        return null;
    },
});
