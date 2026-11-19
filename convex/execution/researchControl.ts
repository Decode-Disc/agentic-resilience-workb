import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    type MutationCtx,
    mutation,
    type QueryCtx,
} from "@convex/_generated/server";
import {
    formatResearchSummary,
    readResearchState,
} from "@convex/domain/researchState";
import type { ResearchState } from "@convex/domain/researchStateContracts";
import {
    readSourcesMission,
    sourcesContinuationAvailable,
} from "@convex/domain/sources";
import {
    isResumableResearchPause,
    isSourcesSettlementPause,
    supportsResearchControl,
} from "@convex/domain/transitions";
import { sourcePreparationWindowMs } from "@convex/resourceLimits";
import { PERSISTENCE_PAGE_SIZE } from "@convex/resourcePolicy";
import { requireWorkspaceRun } from "@convex/runWorkspace";
import { researchResumed, workflow } from "@convex/workflow";
import type { WorkflowId } from "@convex-dev/workflow";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { getAgentDefinition, getRegisteredOperation } from "./agentCatalog";
import { raiseSystemApproval } from "./approvals";
import {
    executionFailureCode,
    recordMissionEvent,
    requireDossierAuthority,
    researchSlotBlock,
} from "./authority";
import { executionError } from "./errors";
import { recordContextObservation } from "./journal";
import {
    generationInterruption,
    isRecoverableInterruption,
} from "./missionData";

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
    await recordResearchObservation(
        ctx,
        run._id,
        kind,
        run.ownerVisitorId
            ? { type: "visitor", visitorId: run.ownerVisitorId }
            : { type: "system" },
    );
}

/** One state projection owns the meaning of research transitions for native observation delivery. */
export async function recordResearchObservation(
    ctx: MutationCtx,
    runId: Id<"researchRuns">,
    event: string,
    actor: NonNullable<Doc<"agentExecutionEvents">["actor"]> = {
        type: "system",
    },
) {
    const current = await ctx.db.get(runId);
    if (!current) throw executionError("run_unavailable");
    const state = await readResearchState(ctx, current);
    await recordContextObservation(ctx, runId, {
        key: `research:${event}:${current.executionGeneration}:${current.researchControlRevision ?? 0}:${current.nextEventSequence}:${current.lifecycleState}:${current.executionStatus}`,
        topic: "research",
        actor,
        value: {
            event,
            ...state,
            summary: formatResearchSummary(state),
            framingRevisionId: current.fixedFramingRevisionId ?? null,
        },
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

/** Suspends new research admission immediately and settles the pause after engaged operations drain. */
export async function pauseResearchAtBoundary(
    ctx: MutationCtx,
    runId: Id<"researchRuns">,
    mission?: Doc<"agentMissions">,
) {
    if (
        mission &&
        getAgentDefinition(mission.definitionId, mission.definitionVersion)
            .executionScope === "conversation"
    )
        return false;
    const run = await ctx.db.get(runId);
    if (
        !run?.researchPauseRequested ||
        run.startMode !== "framed" ||
        !supportsResearchControl(run)
    )
        return false;
    for (const status of ["running", "waiting"] as const) {
        const engaged = await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", runId).eq("status", status),
            )
            .take(9);
        if (engaged.length > 8) return true;
        for (const request of engaged) {
            const owner = request.missionId
                ? await ctx.db.get(request.missionId)
                : null;
            const scope = owner
                ? getAgentDefinition(
                      owner.definitionId,
                      owner.definitionVersion,
                  ).executionScope
                : request.input.kind === "invalid"
                  ? undefined
                  : getRegisteredOperation(request.input.kind)?.nativeAuthority;
            if (scope === "research") return true;
        }
    }
    if (
        mission &&
        (await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission_and_status", (q) =>
                q.eq("missionId", mission._id).eq("status", "running"),
            )
            .first())
    )
        return true;
    return (
        (await applyRequestedResearchPause(ctx, run)).executionStatus ===
        "paused"
    );
}

/** Keeps an interrupted research owner waiting while authorized work remains; otherwise its domain may settle the retained result. */
export async function suspendInterruptedResearch(
    ctx: MutationCtx,
    mission: Doc<"agentMissions">,
) {
    const run = await ctx.db.get(mission.runId);
    const definition = getAgentDefinition(
        mission.definitionId,
        mission.definitionVersion,
    );
    if (
        !run ||
        mission.blockCode === "operation_outcome_unknown" ||
        definition.executionScope !== "research" ||
        run.startMode !== "framed" ||
        !supportsResearchControl(run)
    )
        return false;
    if (
        definition.continuationAfterDeadline &&
        !(await definition.continuationAfterDeadline(ctx, mission))
    )
        return false;
    if (isResumableResearchPause(run)) return true;
    if (
        run.executionStatus !== "running" ||
        run.executionGeneration !== mission.generation
    )
        return false;
    try {
        await requireDossierAuthority(ctx, run._id);
    } catch (error) {
        const code = executionFailureCode(error);
        if (!code) throw error;
        await recordMissionEvent(ctx, mission, {
            kind: "research_recovery_refused",
            cause: "execution_interrupted",
            code,
        });
        return false;
    }
    if (run.researchPauseRequested) {
        await applyRequestedResearchPause(ctx, run);
        return true;
    }
    await ctx.db.patch(run._id, {
        executionStatus: "paused",
        pauseReason: "execution_interrupted",
        executionGeneration: run.executionGeneration + 1,
        researchPauseRequested: false,
        researchControlRevision: (run.researchControlRevision ?? 0) + 1,
        updatedAt: Date.now(),
    });
    await ctx.db.insert("agentExecutionEvents", {
        actor: { type: "system" },
        runId: run._id,
        missionId: mission._id,
        kind: "research_interrupted",
        cause: "execution_interrupted",
        occurredAt: Date.now(),
    });
    await recordResearchObservation(ctx, run._id, "research_interrupted");
    if (!isRecoverableInterruption(mission, run)) {
        const paused = await ctx.db.get(run._id);
        if (!paused) throw executionError("run_unavailable");
        await raiseSystemApproval(ctx, {
            run: paused,
            action: "settle_sources_preparation",
        });
    }
    return true;
}

/** A research mission stopped by its deadline while its domain still admits work waits for the analyst to continue or settle; it is never handed off as complete. */
export async function suspendResearchAtTimeLimit(
    ctx: MutationCtx,
    mission: Doc<"agentMissions">,
) {
    const definition = getAgentDefinition(
        mission.definitionId,
        mission.definitionVersion,
    );
    if (
        mission.status !== "blocked" ||
        (mission.blockCode !== "execution_deadline" &&
            mission.blockCode !== "operation_outcome_unknown" &&
            generationInterruption(mission.blockCode) === undefined) ||
        mission.deadlineAt > Date.now() ||
        definition.executionScope !== "research" ||
        !definition.continuationAfterDeadline
    )
        return false;
    const run = await ctx.db.get(mission.runId);
    if (
        !run ||
        run.withdrawnAt ||
        run.startMode !== "framed" ||
        !supportsResearchControl(run)
    )
        return false;
    const active =
        run.executionStatus === "running" &&
        run.executionGeneration === mission.generation;
    if (!active && !isResumableResearchPause(run)) return false;
    try {
        await requireDossierAuthority(ctx, run._id);
    } catch (error) {
        if (!executionFailureCode(error)) throw error;
        return false;
    }
    if (!(await definition.continuationAfterDeadline(ctx, mission)))
        return false;
    if (!active && run.pauseReason !== "execution_interrupted") {
        await ctx.db.patch(mission._id, { blockCode: "execution_time_limit" });
        await recordMissionEvent(ctx, mission, {
            kind: "mission_blocked",
            cause: "execution_deadline",
            code: "execution_time_limit",
        });
        return true;
    }
    if (run.researchPauseRequested) {
        await ctx.db.patch(mission._id, { blockCode: "execution_time_limit" });
        await recordMissionEvent(ctx, mission, {
            kind: "mission_blocked",
            cause: "execution_deadline",
            code: "execution_time_limit",
        });
        await applyRequestedResearchPause(ctx, run);
        return true;
    }
    await ctx.db.patch(mission._id, { blockCode: "execution_time_limit" });
    await recordMissionEvent(ctx, mission, {
        kind: "mission_blocked",
        cause: "execution_deadline",
        code: "execution_time_limit",
    });
    const executionGeneration = run.executionGeneration + (active ? 1 : 0);
    await ctx.db.patch(run._id, {
        executionStatus: "paused",
        pauseReason: "sources_time_limit",
        executionGeneration,
        researchPauseRequested: false,
        researchControlRevision: (run.researchControlRevision ?? 0) + 1,
        updatedAt: Date.now(),
    });
    await ctx.db.insert("agentExecutionEvents", {
        actor: { type: "system" },
        runId: run._id,
        missionId: mission._id,
        kind: "research_time_limit",
        cause: "execution_deadline",
        occurredAt: Date.now(),
    });
    await recordResearchObservation(ctx, run._id, "research_time_limit");
    const pausedRun = await ctx.db.get(run._id);
    if (!pausedRun) throw executionError("run_unavailable");
    await raiseSourcesTimeLimitDecision(ctx, pausedRun);
    return true;
}

/** Raises the time-limit decision for a run paused at its Sources time limit; a standing permission may apply it at once. */
export async function raiseSourcesTimeLimitDecision(
    ctx: MutationCtx,
    run: Doc<"researchRuns">,
) {
    return raiseSystemApproval(ctx, {
        run,
        action: "continue_sources_preparation",
        alternative: "settle_sources_preparation",
    });
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
            if (
                mission.blockCode === "execution_time_limit" &&
                run.executionHarnessDeadlineAt !== undefined &&
                mission.deadlineAt < run.executionHarnessDeadlineAt
            )
                await ctx.db.patch(mission._id, {
                    deadlineAt: run.executionHarnessDeadlineAt,
                });
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

/** Reports the actual control transition without performing it; commands recheck in their transaction. */
export async function readResearchControlReadiness(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
    action: "pause" | "resume",
) {
    if (!supportsResearchControl(run))
        return { block: "research_control_not_supported", transition: null };
    if (action === "pause")
        return {
            block:
                run.executionStatus === "running"
                    ? null
                    : "human_prerequisite_required",
            transition: null,
        };
    if (
        run.startMode === "framed" &&
        run.executionStatus === "running" &&
        run.researchPauseRequested
    )
        return { block: null, transition: "cancel_pause" };
    if (!isResumableResearchPause(run))
        return { block: "human_prerequisite_required", transition: null };
    if (
        run.startMode === "framed" &&
        run.lifecycleState === "awaiting_source_review"
    ) {
        const preparation = run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
        if (run.sourcePreparationId && !preparation)
            return { block: "stale_execution", transition: null };
        if (preparation?.status !== "started")
            return { block: null, transition: "human_review" };
    }
    const slotBlock = run.ownerVisitorId
        ? await researchSlotBlock(ctx, run.ownerVisitorId)
        : "not_authorized";
    const preparation =
        run.startMode === "framed" &&
        run.sourcesProtocol === "sources_mission_v1" &&
        run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
    if (preparation?.status === "started") {
        if (preparation.settlementRequestedAt !== undefined)
            return { block: "sources_settlement_requested", transition: null };
        const mission = await readSourcesMission(ctx, run);
        if (
            mission?.status === "blocked" &&
            !isRecoverableInterruption(mission, run) &&
            mission.blockCode !== "execution_deadline" &&
            (await sourcesContinuationAvailable(ctx, run, preparation))
        )
            return { block: "human_prerequisite_required", transition: null };
    }
    if (
        run.pauseReason === "execution_interrupted" &&
        preparation?.status === "started" &&
        (preparation.deadlineAt ?? 0) <= Date.now()
    )
        return { block: slotBlock, transition: "time_limit" };
    // An analyst pause may explicitly renew its window; a technical interruption uses the existing time-limit decision.
    if (
        preparation?.status === "started" &&
        (run.pauseReason === "sources_time_limit" ||
            (preparation.deadlineAt ?? 0) <= Date.now())
    ) {
        if (preparation.settlementRequestedAt !== undefined)
            return {
                block: "sources_settlement_requested",
                transition: null,
            };
        const paidWork = await ctx.db
            .query("paidWorkControls")
            .withIndex("by_key", (q) => q.eq("key", "global"))
            .unique();
        let windowBlock: string | null = null;
        try {
            sourcePreparationWindowMs();
        } catch (error) {
            if (
                executionFailureCode(error) !==
                "sources_configuration_unavailable"
            )
                throw error;
            windowBlock = "sources_configuration_unavailable";
        }
        return {
            block:
                slotBlock ??
                (paidWork?.enabled === false
                    ? "paid_work_disabled"
                    : windowBlock),
            transition: "renew_window",
        };
    }
    return { block: slotBlock, transition: "execute" };
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
    const { block } = await readResearchControlReadiness(ctx, run, "pause");
    if (block) throw executionError(block);
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
    const { run } = await requireDossierAuthority(ctx, args.runId);
    if (!supportsResearchControl(run))
        throw executionError("research_control_not_supported");
    if (
        run.executionStatus === "running" &&
        run.executionGeneration === args.expectedGeneration + 1
    )
        return run.executionGeneration;
    if (run.executionGeneration !== args.expectedGeneration)
        throw executionError("human_prerequisite_required");
    const readiness = await readResearchControlReadiness(ctx, run, "resume");
    if (readiness.block) throw executionError(readiness.block);
    if (readiness.transition === "cancel_pause") {
        await ctx.db.patch(run._id, {
            researchPauseRequested: false,
            researchControlRevision: (run.researchControlRevision ?? 0) + 1,
            updatedAt: Date.now(),
        });
        await recordControl(ctx, run, "research_pause_cancelled");
        return run.executionGeneration;
    }
    if (readiness.transition === "human_review") {
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
    if (readiness.transition === "time_limit") {
        const mission = await readSourcesMission(ctx, run);
        if (!mission || !(await suspendResearchAtTimeLimit(ctx, mission)))
            throw executionError("sources_time_limit_decision");
        const current = await ctx.db.get(run._id);
        if (!current) throw executionError("run_unavailable");
        return current.executionGeneration;
    }
    const generation = run.executionGeneration + 1;
    const renewedDeadlineAt =
        readiness.transition === "renew_window"
            ? Date.now() + sourcePreparationWindowMs()
            : undefined;
    if (renewedDeadlineAt !== undefined && run.sourcePreparationId)
        await ctx.db.patch(run.sourcePreparationId, {
            deadlineAt: renewedDeadlineAt,
            leaseExpiresAt: renewedDeadlineAt,
        });
    await ctx.db.patch(run._id, {
        executionStatus: "running",
        researchControlRevision: (run.researchControlRevision ?? 0) + 1,
        pauseReason: undefined,
        executionGeneration: generation,
        ...(renewedDeadlineAt !== undefined
            ? { executionHarnessDeadlineAt: renewedDeadlineAt }
            : {}),
        updatedAt: Date.now(),
    });
    if (run.startMode === "framed" && run.sourcePreparationId)
        await ctx.runMutation(internal.execution.researchControl.checkpoint, {
            runId: run._id,
            preparationId: run.sourcePreparationId,
        });
    await ctx.scheduler.runAfter(
        0,
        internal.execution.researchControl.resumeMissions,
        {
            runId: run._id,
            generation,
            paginationOpts: {
                numItems: PERSISTENCE_PAGE_SIZE.researchResumeRequests,
                cursor: null,
            },
        },
    );
    await notifyResearchControlWaits(ctx, run._id);
    if (run.startMode === "framed")
        await ctx.scheduler.runAfter(
            0,
            internal.workbench.processInstructions,
            { runId: run._id },
        );
    await recordControl(ctx, run, "research_resumed");
    return generation;
}

/** Wakes durable control checkpoints; each waiter rechecks persisted authority before advancing. */
export async function notifyResearchControlWaits(
    ctx: MutationCtx,
    runId: Id<"researchRuns">,
): Promise<void> {
    const run = await ctx.db.get(runId);
    if (run?.startMode !== "framed") return;
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
            value: { generation: run.executionGeneration },
        });
}

/** Confirms only persisted research state and an observed control effect. */
export function researchControlConfirmation(
    action: "start" | "pause" | "resume",
    executed: boolean,
    state: ResearchState,
): string {
    const summary = formatResearchSummary(state);
    if (
        state.phase === "framing" ||
        state.status === "completed" ||
        state.status === "cancelled" ||
        state.status === "failed" ||
        (state.pauseReason && state.pauseReason !== "analyst")
    )
        return summary;
    if (action === "start")
        return state.status === "running"
            ? "Research has already started. Inspect the current research progress."
            : summary;
    if (
        executed &&
        action === "resume" &&
        state.status === "running" &&
        !state.pauseRequested
    )
        return "Research has resumed.";
    if (
        executed &&
        action === "pause" &&
        state.status !== "paused" &&
        !state.pauseRequested
    )
        return "The pause request was recorded. Research is not currently paused.";
    if (executed) return summary;
    return `${action === "pause" ? "No pause was executed." : "No resume was executed."} ${summary}`;
}
