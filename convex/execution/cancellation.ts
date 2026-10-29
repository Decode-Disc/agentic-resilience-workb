import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { internalMutation, type MutationCtx } from "@convex/_generated/server";
import { recordMissionEvent } from "@convex/execution/authority";
import { workflow } from "@convex/workflow";
import type { WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";

const CANCELLATION_MISSION_BATCH = 4;
const CANCELLATION_REQUEST_BATCH = 4;

const continuationArgs = {
    runId: v.id("researchRuns"),
    cancelledAt: v.number(),
    cancelledGeneration: v.optional(v.number()),
    cursor: v.optional(v.string()),
};

/** Schedules bounded mission cleanup after the run cancellation fence commits. */
export async function cancelAgentMissionsForRun(
    ctx: MutationCtx,
    runId: Id<"researchRuns">,
    cancelledAt: number,
    cancelledGeneration: number,
) {
    await ctx.scheduler.runAfter(
        0,
        internal.execution.cancellation.continueRunCancellation,
        { runId, cancelledAt, cancelledGeneration },
    );
}

export const continueRunCancellation = internalMutation({
    args: continuationArgs,
    returns: v.null(),
    handler: async (ctx, args) => {
        let cancelledGeneration = args.cancelledGeneration;
        if (cancelledGeneration === undefined) {
            // Jobs queued by the previous deployment have no generation; only the unchanged cancellation can identify it.
            const run = await ctx.db.get(args.runId);
            if (
                run?.executionStatus !== "cancelled" ||
                run.updatedAt !== args.cancelledAt
            )
                return null;
            cancelledGeneration = run.executionGeneration - 1;
        }
        await ctx.runMutation(internal.execution.conversations.cancelPending, {
            runId: args.runId,
            cancelledAt: args.cancelledAt,
        });
        await cancelMissionPage(ctx, { ...args, cancelledGeneration });
        return null;
    },
});

async function cancelMissionPage(
    ctx: MutationCtx,
    args: {
        runId: Id<"researchRuns">;
        cancelledAt: number;
        cancelledGeneration: number;
        cursor?: string;
    },
) {
    const page = await ctx.db
        .query("agentMissions")
        .withIndex("by_run_and_request_key", (q) => q.eq("runId", args.runId))
        .order("asc")
        .paginate({
            numItems: CANCELLATION_MISSION_BATCH,
            cursor: args.cursor ?? null,
        });
    let requestsRemainInPage = false;

    for (const mission of page.page) {
        if (mission.executionScope === "conversation") {
            const run = await ctx.db.get(args.runId);
            if (
                run?.executionStatus !== "cancelled" ||
                run.updatedAt !== args.cancelledAt
            )
                continue;
        } else if (mission.generation > args.cancelledGeneration) continue;
        requestsRemainInPage =
            (await cancelMission(
                ctx,
                mission,
                args.cancelledAt,
                args.cancelledGeneration,
            )) || requestsRemainInPage;
    }

    if (requestsRemainInPage) {
        await ctx.scheduler.runAfter(
            0,
            internal.execution.cancellation.continueRunCancellation,
            {
                runId: args.runId,
                cancelledAt: args.cancelledAt,
                cancelledGeneration: args.cancelledGeneration,
                ...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
            },
        );
    } else if (!page.isDone) {
        await ctx.scheduler.runAfter(
            0,
            internal.execution.cancellation.continueRunCancellation,
            {
                runId: args.runId,
                cancelledAt: args.cancelledAt,
                cancelledGeneration: args.cancelledGeneration,
                cursor: page.continueCursor,
            },
        );
    }
}

async function cancelMission(
    ctx: MutationCtx,
    mission: Doc<"agentMissions">,
    cancelledAt: number,
    cancelledGeneration: number,
) {
    const pending = await ctx.db
        .query("agentOperationRequests")
        .withIndex("by_mission_and_status", (q) =>
            q.eq("missionId", mission._id).eq("status", "pending"),
        )
        .take(CANCELLATION_REQUEST_BATCH + 1);
    const running = await ctx.db
        .query("agentOperationRequests")
        .withIndex("by_mission_and_status", (q) =>
            q.eq("missionId", mission._id).eq("status", "running"),
        )
        .take(CANCELLATION_REQUEST_BATCH + 1);
    const waiting = await ctx.db
        .query("agentOperationRequests")
        .withIndex("by_mission_and_status", (q) =>
            q.eq("missionId", mission._id).eq("status", "waiting"),
        )
        .take(CANCELLATION_REQUEST_BATCH + 1);
    const outstanding = [...running, ...pending, ...waiting].filter(
        (request) =>
            mission.executionScope === "conversation" ||
            request.expectedGeneration <= cancelledGeneration,
    );
    const requestsToRefuse = outstanding.slice(0, CANCELLATION_REQUEST_BATCH);
    const cancelling =
        mission.status !== "completed" && mission.status !== "cancelled";
    if (cancelling || mission.workflowId) {
        await ctx.db.patch(mission._id, {
            ...(cancelling
                ? { status: "cancelled" as const, blockCode: "run_cancelled" }
                : {}),
            workflowId: undefined,
            updatedAt: cancelledAt,
        });
    }
    if (cancelling) {
        await recordMissionEvent(ctx, mission, {
            kind: "mission_cancelled",
            cause: "run_cancellation",
            code: "run_cancelled",
        });
    }

    for (const request of requestsToRefuse) {
        if (request.expiryJobId)
            await ctx.scheduler.cancel(request.expiryJobId);
        await ctx.db.patch(
            request._id,
            request.protocolVersion === 3 && request.status !== "pending"
                ? { status: "unknown" }
                : {
                      status: "completed",
                      outcome: { kind: "refused", code: "run_cancelled" },
                      completedAt: cancelledAt,
                  },
        );
        await recordMissionEvent(ctx, mission, {
            kind: "operation_refused",
            cause: "run_cancellation",
            requestId: request._id,
            code: "run_cancelled",
        });
    }

    if (mission.workflowId)
        await workflow.cancel(ctx, mission.workflowId as WorkflowId);
    return outstanding.length > requestsToRefuse.length;
}
