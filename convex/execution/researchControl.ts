import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    type MutationCtx,
    mutation,
} from "@convex/_generated/server";
import { supportsResearchControl } from "@convex/domain/transitions";
import { requireWorkspaceRun } from "@convex/runWorkspace";
import { researchResumed, workflow } from "@convex/workflow";
import type { WorkflowId } from "@convex-dev/workflow";
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

/** Settles an admitted analyst pause in the transaction that reaches a durable stopping point. */
export async function applyRequestedResearchPause(
    ctx: MutationCtx,
    run: Doc<"researchRuns">,
): Promise<Doc<"researchRuns">> {
    if (!run.researchPauseRequested) return run;
    await requireDossierAuthority(ctx, run._id);
    if (run.startMode !== "framed" || !supportsResearchControl(run))
        throw executionError("research_control_not_supported");
    if (run.executionStatus !== "running")
        throw executionError("human_prerequisite_required");
    const patch = {
        executionStatus: "paused" as const,
        pauseReason: "analyst" as const,
        researchPauseRequested: false,
        executionGeneration: run.executionGeneration + 1,
        updatedAt: Date.now(),
    };
    await ctx.db.patch(run._id, patch);
    await recordControl(ctx, run, "research_paused");
    return { ...run, ...patch };
}

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
        await requireWorkspaceRun(ctx, args.runId);
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
        if (run.executionStatus === "paused" && run.pauseReason === "analyst")
            return { waiting: true, generation: run.executionGeneration };
        if (run.executionStatus !== "running")
            throw executionError("human_prerequisite_required");
        const settledRun = await applyRequestedResearchPause(ctx, run);
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

/** Registers the durable wait before suspension, so an early Resume is retained by the Workflow component. */
export async function awaitResearchControl(
    step: import("@convex-dev/workflow").WorkflowCtx,
    runId: import("@convex/_generated/dataModel").Id<"researchRuns">,
    preparationId?: import("@convex/_generated/dataModel").Id<"sourceSelectionProposalRebuilds">,
): Promise<number> {
    let state = await step.runMutation(
        internal.execution.researchControl.checkpoint,
        {
            runId,
            preparationId,
            workflowId: step.workflowId,
        },
    );
    while (state.waiting) {
        await step.awaitEvent(researchResumed);
        state = await step.runMutation(
            internal.execution.researchControl.checkpoint,
            {
                runId,
                preparationId,
                workflowId: step.workflowId,
            },
        );
    }
    return state.generation;
}

export async function pauseResearch(
    ctx: MutationCtx,
    args: { runId: Id<"researchRuns">; expectedGeneration: number },
): Promise<number> {
    const { run } = await requireDossierAuthority(ctx, args.runId);
    if (!supportsResearchControl(run))
        throw executionError("research_control_not_supported");
    if (
        run.executionStatus === "paused" &&
        run.pauseReason === "analyst" &&
        run.executionGeneration === args.expectedGeneration + 1
    )
        return run.executionGeneration;
    if (run.executionGeneration !== args.expectedGeneration)
        throw executionError("stale_execution");
    if (run.executionStatus !== "running")
        throw executionError("human_prerequisite_required");
    if (run.startMode === "framed") {
        await ctx.db.patch(run._id, {
            researchPauseRequested: true,
            researchControlRevision: (run.researchControlRevision ?? 0) + 1,
            updatedAt: Date.now(),
        });
        await recordControl(ctx, run, "research_pause_requested");
        return run.executionGeneration;
    }
    await ctx.db.patch(run._id, {
        executionStatus: "paused",
        researchControlRevision: (run.researchControlRevision ?? 0) + 1,
        pauseReason: "analyst",
        executionGeneration: run.executionGeneration + 1,
        updatedAt: Date.now(),
    });
    await recordControl(ctx, run, "research_paused");
    return run.executionGeneration + 1;
}

export async function resumeResearch(
    ctx: MutationCtx,
    args: { runId: Id<"researchRuns">; expectedGeneration: number },
): Promise<number> {
    const { run, visitor } = await requireDossierAuthority(ctx, args.runId);
    if (!supportsResearchControl(run))
        throw executionError("research_control_not_supported");
    if (
        run.startMode === "framed" &&
        run.researchPauseRequested &&
        run.executionStatus === "running" &&
        run.executionGeneration === args.expectedGeneration
    ) {
        await ctx.db.patch(run._id, {
            researchPauseRequested: false,
            researchControlRevision: (run.researchControlRevision ?? 0) + 1,
            updatedAt: Date.now(),
        });
        await recordControl(ctx, run, "research_pause_cancelled");
        return run.executionGeneration;
    }
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
    if (
        run.startMode === "framed" &&
        run.lifecycleState === "awaiting_source_review"
    ) {
        const preparation = run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
        if (run.sourcePreparationId && !preparation)
            throw executionError("stale_execution");
        if (preparation?.status !== "started") {
            const generation = run.executionGeneration + 1;
            await ctx.db.patch(run._id, {
                executionGeneration: generation,
                researchControlRevision: (run.researchControlRevision ?? 0) + 1,
                pauseReason: "source_review",
                researchPauseRequested: false,
                updatedAt: Date.now(),
            });
            await ctx.scheduler.runAfter(
                0,
                internal.workbench.processInstructions,
                { runId: run._id },
            );
            await recordControl(ctx, run, "research_resumed");
            return generation;
        }
    }
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
        researchControlRevision: (run.researchControlRevision ?? 0) + 1,
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
    if (run.startMode === "framed") {
        const preparation = run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
        const ids = new Set(
            [
                run.workflowId,
                preparation?.status === "started"
                    ? preparation.workflowId
                    : undefined,
            ].filter((id): id is string => !!id),
        );
        for (const workflowId of ids)
            await workflow.sendEvent(ctx, {
                ...researchResumed,
                workflowId: workflowId as WorkflowId,
                value: { generation },
            });
    }
    if (run.startMode === "framed")
        await ctx.scheduler.runAfter(
            0,
            internal.workbench.processInstructions,
            { runId: run._id },
        );
    await recordControl(ctx, run, "research_resumed");
    return generation;
}

/** Canonical wording for observed research state, independent of any requested action. */
export function researchStateSummary(
    run: Pick<
        Doc<"researchRuns">,
        | "lifecycleState"
        | "executionStatus"
        | "pauseReason"
        | "researchPauseRequested"
    >,
): string {
    if (run.lifecycleState === "framing") return "Research has not started.";
    if (run.executionStatus === "completed") return "Research is complete.";
    if (run.executionStatus === "cancelled")
        return "Research has been cancelled.";
    if (run.executionStatus === "failed")
        return "Research has stopped because a problem needs attention.";
    if (
        run.pauseReason === "source_review" ||
        (run.lifecycleState === "awaiting_source_review" &&
            run.executionStatus !== "running")
    )
        return "Research is waiting for source review. Review the proposed sources to continue.";
    if (run.pauseReason && run.pauseReason !== "analyst")
        return "Research is waiting for an analyst decision. Complete the pending review to continue.";
    if (run.executionStatus === "paused") return "Research is paused.";
    if (run.executionStatus === "running")
        return run.researchPauseRequested
            ? "Pause requested. Research will pause after the work already in progress finishes."
            : "Research is running.";
    return "Research is not running.";
}

/** Confirms only persisted research state and an observed control effect. */
export function researchControlConfirmation(
    action: "start" | "pause" | "resume",
    executed: boolean,
    run: Doc<"researchRuns">,
): string {
    if (run.lifecycleState === "framing")
        return `${researchStateSummary(run)} Review the research program and choose Start research when ready.`;
    if (
        run.pauseReason === "source_review" ||
        (run.lifecycleState === "awaiting_source_review" &&
            run.executionStatus !== "running")
    )
        return researchStateSummary(run);
    if (run.pauseReason && run.pauseReason !== "analyst")
        return researchStateSummary(run);
    if (action === "start")
        return run.executionStatus === "running"
            ? "Research has already started. Inspect the current research progress."
            : "Research has already started. Check the current research state and use Resume when the prerequisites are satisfied.";
    if (
        action === "pause" &&
        executed &&
        run.executionStatus === "running" &&
        run.researchPauseRequested
    )
        return researchStateSummary(run);
    if (
        action === "pause" &&
        executed &&
        run.executionStatus === "paused" &&
        run.pauseReason === "analyst"
    )
        return researchStateSummary(run);
    if (
        action === "resume" &&
        executed &&
        run.executionStatus === "running" &&
        !run.researchPauseRequested
    )
        return "Research has resumed.";
    if (executed && action === "pause" && run.executionStatus !== "paused")
        return "The pause request was recorded. Research is not currently paused.";
    if (executed)
        return action === "pause"
            ? "The pause request was recorded. Inspect the current research state."
            : "The resume request was recorded. Inspect the current research state.";
    return action === "pause"
        ? "No pause was executed. Check the current research state and use the research controls to pause it."
        : "No resume was executed. Check the current research state and complete any pending review before resuming.";
}

/** Checks explicit current-status clauses from the closed application vocabulary; historical quotations stay intact. */
export function conflictsWithResearchStatus(
    text: string,
    run: Parameters<typeof researchStateSummary>[0],
): boolean {
    const expected = researchStateSummary(run).toLowerCase();
    let fenced = false;
    for (const line of text.split("\n")) {
        if (/^\s*```/.test(line)) {
            fenced = !fenced;
            continue;
        }
        if (fenced || /^\s*>/.test(line)) continue;
        const claim =
            /^\s*(?:(?:current status|status):\s*)?(research (?:has not started|is running|is paused|is complete|has been cancelled))\b/i.exec(
                line.replaceAll("**", ""),
            );
        if (claim?.[1] && !expected.startsWith(claim[1].toLowerCase()))
            return true;
    }
    return false;
}
