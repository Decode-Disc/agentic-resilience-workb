import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    internalQuery,
    type MutationCtx,
} from "@convex/_generated/server";
import schema from "@convex/schema";
import { v } from "convex/values";
import {
    executionError,
    executionFailureCode,
    recordMissionEvent,
    requireDossierAuthority,
    requireMissionAuthority,
} from "./authority";

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
        ["completed", "cancelled", "blocked"].includes(mission.status)
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
        if (["completed", "cancelled", "blocked"].includes(mission.status))
            return false;
        try {
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
        const session = await ctx.db
            .query("piSessions")
            .withIndex("by_mission", (q) => q.eq("missionId", mission._id))
            .unique();
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
    handler: async (ctx, args) =>
        (
            await requireMissionAuthority(
                ctx,
                args.missionId,
                args.expectedGeneration,
            )
        ).mission,
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
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const mission = await ctx.db.get(args.missionId);
        const session = await ctx.db
            .query("piSessions")
            .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
            .unique();
        if (
            !mission ||
            (mission.piActiveWriter !== undefined
                ? mission.piActiveWriter !== args.writer
                : session?.writer !== args.writer) ||
            (session &&
                (session.generation !== args.expectedGeneration ||
                    session.writer !== args.writer))
        )
            return null;
        if (session)
            await ctx.db.patch(session._id, { leaseUntil: Date.now() });
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
        if (mission.piWakeId) await cancelPiWake(ctx, mission.piWakeId);
        await ctx.db.patch(mission._id, {
            piWakeId: undefined,
            piWakeAt: undefined,
            piWakeToken: undefined,
            piActiveWriter: undefined,
        });
        const nextAt = mission.piResultWakePending ? Date.now() : args.at;
        if (!args.error && nextAt !== undefined)
            await schedulePiMission(
                ctx,
                mission._id,
                args.expectedGeneration,
                Math.min(nextAt, mission.piWakeAt ?? nextAt),
            );
        if (mission.parentRequestId)
            await ctx.runMutation(internal.execution.handoffs.finishChild, {
                missionId: mission._id,
            });
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
