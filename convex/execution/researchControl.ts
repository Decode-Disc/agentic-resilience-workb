import { internal } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import {
    internalMutation,
    type MutationCtx,
    mutation,
} from "@convex/_generated/server";
import { requireWorkspaceRun } from "@convex/runWorkspace";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import {
    executionFailureCode,
    recordMissionEvent,
    requireDossierAuthority,
} from "./authority";
import { executionError } from "./errors";
import { isRecoverableInterruption } from "./missionData";

async function recordControl(
    ctx: MutationCtx,
    run: Doc<"researchRuns">,
    kind: string,
) {
    await ctx.db.insert("agentExecutionEvents", {
        actor: run.ownerVisitorId
            ? { type: "visitor", visitorId: run.ownerVisitorId }
            : { type: "system" },
        runId: run._id,
        kind,
        cause: "explicit_analyst_control",
        occurredAt: Date.now(),
    });
}

export const pause = mutation({
    args: { runId: v.id("researchRuns"), expectedGeneration: v.number() },
    returns: v.number(),
    handler: async (ctx, args) => {
        await requireWorkspaceRun(ctx, args.runId);
        const { run } = await requireDossierAuthority(ctx, args.runId);
        if (run.agentExecutionVersion !== 3)
            throw executionError("research_control_not_supported");
        if (
            run.executionStatus === "paused" &&
            run.pauseReason === "analyst" &&
            run.executionGeneration === args.expectedGeneration + 1
        )
            return run.executionGeneration;
        if (
            run.executionGeneration !== args.expectedGeneration ||
            run.executionStatus !== "running"
        )
            throw executionError("stale_execution");
        await ctx.db.patch(run._id, {
            executionStatus: "paused",
            pauseReason: "analyst",
            executionGeneration: run.executionGeneration + 1,
            updatedAt: Date.now(),
        });
        await recordControl(ctx, run, "research_paused");
        return run.executionGeneration + 1;
    },
});

export const resume = mutation({
    args: { runId: v.id("researchRuns"), expectedGeneration: v.number() },
    returns: v.number(),
    handler: async (ctx, args) => {
        await requireWorkspaceRun(ctx, args.runId);
        const { run, visitor } = await requireDossierAuthority(ctx, args.runId);
        if (run.agentExecutionVersion !== 3)
            throw executionError("research_control_not_supported");
        if (
            run.executionStatus === "running" &&
            run.executionGeneration === args.expectedGeneration + 1
        )
            return run.executionGeneration;
        if (
            run.executionGeneration !== args.expectedGeneration ||
            run.executionStatus !== "paused" ||
            run.pauseReason !== "analyst"
        )
            throw executionError("human_prerequisite_required");
        const active = await ctx.db
            .query("researchRuns")
            .withIndex("by_owner_and_execution_status", (q) =>
                q
                    .eq("ownerVisitorId", visitor._id)
                    .eq("executionStatus", "running"),
            )
            .first();
        if (active) throw executionError("execution_slot_unavailable");
        const generation = run.executionGeneration + 1;
        await ctx.db.patch(run._id, {
            executionStatus: "running",
            pauseReason: undefined,
            executionGeneration: generation,
            updatedAt: Date.now(),
        });
        await ctx.scheduler.runAfter(
            0,
            internal.execution.researchControl.resumeMissions,
            {
                runId: run._id,
                generation,
                paginationOpts: { numItems: 20, cursor: null },
            },
        );
        await recordControl(ctx, run, "research_resumed");
        return generation;
    },
});

export const resumeMissions = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        generation: v.number(),
        paginationOpts: paginationOptsValidator,
    },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        const { run } = await requireDossierAuthority(ctx, args.runId);
        if (
            run.executionGeneration !== args.generation ||
            run.executionStatus !== "running"
        )
            return null;
        const page = await ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_request_key", (q) => q.eq("runId", run._id))
            .paginate(args.paginationOpts);
        for (const mission of page.page) {
            if (
                mission.executionScope === "conversation" ||
                ["completed", "cancelled"].includes(mission.status) ||
                (mission.status === "blocked" &&
                    !isRecoverableInterruption(mission))
            )
                continue;
            try {
                await ctx.runMutation(internal.execution.missions.resume, {
                    missionId: mission._id,
                    expectedGeneration: args.generation,
                    simulation:
                        mission.provenance === "simulation" ||
                        run.purpose === "browser_test",
                });
            } catch (error) {
                const code = executionFailureCode(error);
                if (!code) throw error;
                await ctx.db.patch(mission._id, {
                    status: "blocked",
                    blockCode: code,
                });
                await recordMissionEvent(ctx, mission, {
                    kind: "mission_blocked",
                    cause: "research_resume",
                    code,
                });
            }
        }
        if (!page.isDone)
            await ctx.scheduler.runAfter(
                0,
                internal.execution.researchControl.resumeMissions,
                {
                    ...args,
                    paginationOpts: {
                        ...args.paginationOpts,
                        cursor: page.continueCursor,
                    },
                },
            );
        return null;
    },
});
