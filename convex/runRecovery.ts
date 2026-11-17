import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    type MutationCtx,
    type QueryCtx,
} from "@convex/_generated/server";
import {
    readSourcesMission,
    sourcesContinuationAvailable,
} from "@convex/domain/sources";
import { isDocumentaryResearchPhase } from "@convex/domain/transitions";
import type { AuditActor } from "@convex/execution/approvalContracts";
import { readSourcesDecisionRequestId } from "@convex/execution/approvals";
import { recordMissionEvent } from "@convex/execution/authority";
import { executionError } from "@convex/execution/errors";
import {
    raiseSourcesTimeLimitDecision,
    recordResearchObservation,
} from "@convex/execution/researchControl";
import {
    MAX_AUDIT_REASON_CHARS,
    MIN_AUDIT_REASON_CHARS,
} from "@convex/resourcePolicy";
import { workflow } from "@convex/workflow";
import { v } from "convex/values";

/** Why a failed run cannot be reopened at its Sources time limit, or null when it can. */
export async function readReopenBlock(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
): Promise<
    | "run_not_eligible"
    | "preparation_not_eligible"
    | "mission_not_eligible"
    | null
> {
    const latestRunEvent = await ctx.db
        .query("runEvents")
        .withIndex("by_run_and_sequence", (q) => q.eq("runId", run._id))
        .order("desc")
        .first();
    if (
        run.purpose !== "research" ||
        run.withdrawnAt !== undefined ||
        run.executionStatus !== "failed" ||
        !isDocumentaryResearchPhase(run.lifecycleState) ||
        latestRunEvent?.type !== "run_failed"
    ) {
        return "run_not_eligible";
    }

    const preparation = run.sourcePreparationId
        ? await ctx.db.get(run.sourcePreparationId)
        : null;
    if (
        !preparation ||
        preparation.runId !== run._id ||
        preparation.status !== "started" ||
        !preparation.sourcesMission ||
        preparation.sourcesMission.result !== undefined ||
        preparation.settlementRequestedAt !== undefined
    ) {
        return "preparation_not_eligible";
    }

    const mission = await readSourcesMission(ctx, run);
    if (
        mission?.status !== "blocked" ||
        (mission.blockCode !== "execution_deadline" &&
            mission.blockCode !== "operation_outcome_unknown") ||
        mission.deadlineAt > Date.now()
    ) {
        return "mission_not_eligible";
    }
    return null;
}

/** Reopens a run that failed at its Sources deadline into the time-limit decision; a repeated reopen changes nothing. */
export async function reopenAtTimeLimit(
    ctx: MutationCtx,
    args: { runId: Id<"researchRuns">; reason: string; actor: AuditActor },
): Promise<{ reopened: boolean; workflowId: string | null }> {
    const reason = args.reason.trim();
    if (
        reason.length < MIN_AUDIT_REASON_CHARS ||
        reason.length > MAX_AUDIT_REASON_CHARS
    ) {
        throw executionError("invalid_reason");
    }
    const run = await ctx.db.get(args.runId);
    if (!run) throw executionError("run_not_eligible");

    const audits = await ctx.db
        .query("auditEvents")
        .withIndex("by_target", (q) =>
            q.eq("targetType", "research_run").eq("targetId", run._id),
        )
        .collect();
    if (audits.some((event) => event.action === "run_reopened_at_time_limit")) {
        return { reopened: false, workflowId: run.workflowId ?? null };
    }

    const block = await readReopenBlock(ctx, run);
    if (block) throw executionError(block);
    const preparation = run.sourcePreparationId
        ? await ctx.db.get(run.sourcePreparationId)
        : null;
    const mission = await readSourcesMission(ctx, run);
    if (!preparation || !mission) throw executionError("run_not_eligible");
    const now = Date.now();

    const executionGeneration = run.executionGeneration + 1;
    const continuationAvailable = await sourcesContinuationAvailable(
        ctx,
        run,
        preparation,
    );
    const workflowId = await workflow.start(
        ctx,
        internal.researchWorkflow.run,
        {
            runId: run._id,
            executionGeneration,
            controlled: true,
            reattachSources: { preparationId: preparation._id },
        },
        {
            onComplete: internal.researchWorkflow.onComplete,
            context: { runId: run._id },
        },
    );

    await ctx.db.patch(run._id, {
        executionGeneration,
        executionStatus: "paused",
        pauseReason: "sources_time_limit",
        researchPauseRequested: false,
        researchControlRevision: (run.researchControlRevision ?? 0) + 1,
        workflowId,
        updatedAt: now,
    });
    // Like a live time-limit pause, the paused run is one generation ahead of its preparation: the settlement and paused-observation fences admit exactly that offset, and the running checkpoint re-aligns them after Continue.
    await ctx.db.patch(preparation._id, {
        workflowId,
        executionGeneration: run.executionGeneration,
    });

    const blockCode = continuationAvailable
        ? "execution_time_limit"
        : "execution_deadline";
    await ctx.db.patch(mission._id, { blockCode });
    await recordMissionEvent(ctx, mission, {
        kind: "mission_blocked",
        cause: "run_reopened_at_time_limit",
        code: blockCode,
    });

    await ctx.db.insert("auditEvents", {
        actor: args.actor,
        action: "run_reopened_at_time_limit",
        targetType: "research_run",
        targetId: run._id,
        reason,
        occurredAt: now,
    });

    await recordResearchObservation(ctx, run._id, "research_time_limit");

    if (continuationAvailable) {
        const pausedRun = await ctx.db.get(run._id);
        if (!pausedRun) throw executionError("run_unavailable");
        await raiseSourcesTimeLimitDecision(ctx, pausedRun);
    }

    return { reopened: true, workflowId };
}

export const reopenAtSourcesTimeLimit = internalMutation({
    args: { runId: v.id("researchRuns"), reason: v.string() },
    returns: v.object({
        reopened: v.boolean(),
        workflowId: v.union(v.string(), v.null()),
    }),
    handler: (ctx, args) =>
        reopenAtTimeLimit(ctx, { ...args, actor: { type: "system" } }),
});

/** Raises the missing decision for dossiers paused at their Sources time limit before approval requests existed; idempotent. */
export const raiseMissingSourcesDecisions = internalMutation({
    args: {},
    returns: v.object({ raised: v.number() }),
    handler: async (ctx): Promise<{ raised: number }> => {
        // The Sources mission runs during source discovery, the only phase that can pause at its time limit.
        const paused = await ctx.db
            .query("researchRuns")
            .withIndex(
                "by_purpose_lifecycle_execution_reservation_created_at",
                (q) =>
                    q
                        .eq("purpose", "research")
                        .eq("lifecycleState", "discovering_sources")
                        .eq("executionStatus", "paused"),
            )
            .collect();
        let raised = 0;
        for (const run of paused) {
            if (
                run.pauseReason !== "sources_time_limit" ||
                run.withdrawnAt !== undefined ||
                (await readSourcesDecisionRequestId(ctx, run)) !== null
            )
                continue;
            await raiseSourcesTimeLimitDecision(ctx, run);
            raised += 1;
        }
        return { raised };
    },
});
