import {
    pauseResearch,
    pauseResearchAtBoundary,
    readResearchControlReadiness,
    resumeResearch,
    suspendInterruptedResearch,
} from "./researchControlCore";

export {
    applyRequestedResearchPause,
    awaitResearchControl,
    notifyResearchControlWaits,
    pauseResearch,
    pauseResearchAtBoundary,
    raiseSourcesTimeLimitDecision,
    readResearchControlReadiness,
    recordResearchObservation,
    researchControlConfirmation,
    resumeResearch,
    suspendInterruptedResearch,
    suspendResearchAtTimeLimit,
} from "./researchControlCore";

import { internal } from "@convex/_generated/api";
import { internalMutation, mutation } from "@convex/_generated/server";
import { sourcesContinuationAvailable } from "@convex/domain/sources";
import {
    isResumableResearchPause,
    isSourcesSettlementPause,
} from "@convex/domain/transitions";
import { requireWorkspaceRun } from "@convex/runWorkspace";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import {
    executionFailureCode,
    recordMissionEvent,
    requireDossierAuthority,
} from "./authority";
import { executionError } from "./errors";
import { missionStatusValidator } from "./executionProtocol";
import { isRecoverableInterruption } from "./missionData";

export const pause = mutation({
    args: { runId: v.id("researchRuns"), expectedGeneration: v.number() },
    returns: v.number(),
    handler: async (ctx, args) => {
        await requireWorkspaceRun(ctx, args.runId);
        return pauseResearch(ctx, args);
    },
});

export const resume = mutation({
    args: { runId: v.id("researchRuns"), expectedGeneration: v.number() },
    returns: v.number(),
    handler: async (ctx, args) => {
        const { run } = await requireWorkspaceRun(ctx, args.runId);
        // At its time limit, preparation continues or hands over only through the decision's approval request.
        if (
            run.executionStatus === "paused" &&
            run.pauseReason === "sources_time_limit"
        )
            throw executionError(
                (await readResearchControlReadiness(ctx, run, "resume"))
                    .block ?? "sources_time_limit_decision",
            );
        return resumeResearch(ctx, args);
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
                    !isRecoverableInterruption(mission, run))
            )
                continue;
            try {
                await ctx.runMutation(internal.execution.missions.resume, {
                    missionId: mission._id,
                    expectedGeneration: args.generation,
                    simulation:
                        mission.provenance === "simulation" ||
                        (mission.provenance === undefined &&
                            run.purpose === "browser_test"),
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
                // A mission that cannot resume is terminal; its waiting owner settles what it retained.
                if (mission.parentRequestId || mission.completionEventId)
                    await ctx.runMutation(
                        internal.execution.handoffs.finishChild,
                        { missionId: mission._id },
                    );
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

/** Applies a requested pause only after the caller's admitted operations have settled. */
export const checkpoint = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        preparationId: v.optional(v.id("sourceSelectionProposalRebuilds")),
        workflowId: v.optional(v.string()),
    },
    returns: v.object({ waiting: v.boolean(), generation: v.number() }),
    handler: async (ctx, args) => {
        const { run } = await requireDossierAuthority(ctx, args.runId);
        if (run.startMode !== "framed" || run.agentExecutionVersion !== 3)
            throw executionError("research_control_not_supported");
        const preparation = args.preparationId
            ? await ctx.db.get(args.preparationId)
            : null;
        if (
            args.preparationId &&
            (!preparation ||
                preparation.runId !== run._id ||
                run.sourcePreparationId !== preparation._id)
        )
            throw executionError("stale_execution");
        if (args.workflowId) {
            if (preparation) {
                if (
                    preparation.workflowId &&
                    preparation.workflowId !== args.workflowId
                )
                    throw executionError("stale_execution");
                if (!preparation.workflowId)
                    await ctx.db.patch(preparation._id, {
                        workflowId: args.workflowId,
                    });
            } else if (run.workflowId !== args.workflowId)
                throw executionError("stale_execution");
        }
        if (isSourcesSettlementPause(run) && run.sourcePreparationId) {
            const currentPreparation =
                preparation ?? (await ctx.db.get(run.sourcePreparationId));
            if (
                currentPreparation &&
                (currentPreparation.settlementRequestedAt !== undefined ||
                    !(await sourcesContinuationAvailable(
                        ctx,
                        run,
                        currentPreparation,
                    )))
            )
                return { waiting: false, generation: run.executionGeneration };
        }
        if (isResumableResearchPause(run))
            return { waiting: true, generation: run.executionGeneration };
        if (run.executionStatus !== "running")
            throw executionError("human_prerequisite_required");
        if (run.researchPauseRequested)
            await pauseResearchAtBoundary(ctx, run._id);
        const settledRun = (await ctx.db.get(run._id)) ?? run;
        if (settledRun.executionStatus === "paused")
            return {
                waiting: true,
                generation: settledRun.executionGeneration,
            };
        if (
            preparation?.status === "started" &&
            preparation.executionGeneration !== run.executionGeneration
        )
            await ctx.db.patch(preparation._id, {
                executionGeneration: run.executionGeneration,
            });
        return { waiting: false, generation: run.executionGeneration };
    },
});

export const suspendInterrupted = internalMutation({
    args: {
        missionId: v.id("agentMissions"),
        previousBlockCode: v.optional(v.string()),
        previousStatus: missionStatusValidator,
    },
    returns: v.boolean(),
    handler: async (ctx, { missionId, previousBlockCode, previousStatus }) => {
        const mission = await ctx.db.get(missionId);
        return mission
            ? suspendInterruptedResearch(ctx, {
                  ...mission,
                  status: previousStatus,
                  blockCode: previousBlockCode,
              })
            : false;
    },
});
