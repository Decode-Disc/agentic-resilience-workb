import type { Doc } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import { approvalCatalog } from "@convex/execution/approvalCatalog";
import { readApprovalFacts } from "@convex/execution/approvals";
import { executionError } from "@convex/execution/errors";
import { generationInterruption } from "@convex/execution/missionData";
import { SOURCES_HANDOFF_READ_CAPACITY } from "@convex/resourcePolicy";
import { agentName } from "./agentIdentities";
import { researchStartBlock } from "./framingEditAuthority";
import { type ResearchState, researchStatus } from "./researchStateContracts";
import { SourceReviewReads } from "./sourceReviewReads";
import {
    type controlledSourcesContributions,
    projectPreparedMaterial,
    projectSourcesPreparationProgress,
    readSourcesMission,
    sourcesInstructionTreatment,
    sourcesPreparationPhase,
} from "./sources";
import type { SourcesPreparationProgress } from "./sourcesContracts";
import { supportsResearchControl } from "./transitions";

export { researchStatus } from "./researchStateContracts";

export type LoadedResearchStateFacts = {
    framing?: Doc<"framingRevisions"> | null;
    preparation?: Doc<"sourceSelectionProposalRebuilds"> | null;
    mission?: Doc<"agentMissions"> | null;
    reads?: SourceReviewReads;
    controlled?: Awaited<ReturnType<typeof controlledSourcesContributions>>;
    readings?: SourcesPreparationProgress["readings"];
};

/** Control transitions read authority and lifecycle facts without depending on evidence availability. */
export async function readResearchControlState(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
): Promise<ResearchState> {
    return readState(ctx, run, "control");
}

/** Compact current dossier facts, including verified evidence progress; reads never advance execution. */
export async function readResearchState(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
    loaded?: LoadedResearchStateFacts,
): Promise<ResearchState> {
    return readState(ctx, run, "evidence", loaded);
}

async function readState(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
    purpose: "control" | "evidence",
    loaded?: LoadedResearchStateFacts,
): Promise<ResearchState> {
    const framing =
        loaded && "framing" in loaded
            ? (loaded.framing ?? null)
            : run.currentFramingRevisionId
              ? await ctx.db.get(run.currentFramingRevisionId)
              : null;
    const visitor = run.ownerVisitorId
        ? await ctx.db.get(run.ownerVisitorId)
        : null;
    const availability = (
        reason: string | null,
        actor:
            | "analyst_only"
            | "analyst_or_authorized_workbench" = "analyst_or_authorized_workbench",
    ) => ({ actor, applicable: reason === null, reason });
    const preparation =
        run.sourcesProtocol !== "sources_mission_v1"
            ? null
            : loaded && "preparation" in loaded
              ? (loaded.preparation ?? null)
              : run.sourcePreparationId
                ? await ctx.db.get(run.sourcePreparationId)
                : null;
    if (preparation && preparation.runId !== run._id)
        throw executionError("not_authorized");
    const mission =
        loaded && "mission" in loaded
            ? (loaded.mission ?? null)
            : preparation
              ? await readSourcesMission(ctx, run)
              : null;
    const reads =
        loaded?.reads ??
        (preparation?.sourcesMission
            ? new SourceReviewReads(
                  ctx.db,
                  run._id,
                  SOURCES_HANDOFF_READ_CAPACITY,
              )
            : undefined);
    const retainedStop =
        mission?.status === "cancelled"
            ? await ctx.db
                  .query("agentExecutionEvents")
                  .withIndex("by_mission_and_kind", (q) =>
                      q
                          .eq("missionId", mission._id)
                          .eq("kind", "mission_stop_retained"),
                  )
                  .order("desc")
                  .first()
            : null;
    const executionStop =
        mission?.status === "blocked"
            ? {
                  missionId: mission._id,
                  blockCode: mission.blockCode ?? null,
                  invocationId: mission.lastInvocationId ?? null,
              }
            : retainedStop && mission
              ? {
                    missionId: mission._id,
                    blockCode: retainedStop.code ?? null,
                    invocationId: retainedStop.invocationId ?? null,
                }
              : null;
    const retainedDocuments = [];
    for (const document of preparation?.sourcesMission?.result?.documents ??
        []) {
        const source =
            purpose === "control"
                ? null
                : reads
                  ? await reads.source(document.sourceId)
                  : await ctx.db.get(document.sourceId);
        if (source && source.runId !== run._id)
            throw executionError("not_authorized");
        retainedDocuments.push({
            sourceId: document.sourceId,
            title: source?.title ?? null,
        });
    }
    const progress =
        purpose === "evidence" && preparation?.sourcesMission
            ? await projectSourcesPreparationProgress(ctx, {
                  preparation,
                  mission,
                  reads,
                  controlled: loaded?.controlled,
                  readings: loaded?.readings,
              })
            : undefined;
    return {
        phase: run.lifecycleState,
        status: run.executionStatus,
        executionGeneration: run.executionGeneration,
        started: !!(
            run.researchStartRequestKey ||
            run.researchStartedAt ||
            run.fixedFramingRevisionId
        ),
        controlAvailable: supportsResearchControl(run),
        pauseReason: run.pauseReason ?? null,
        pauseRequested: run.researchPauseRequested ?? false,
        approvals: await readApprovalFacts(ctx, run),
        actions: {
            start: availability(
                visitor
                    ? await researchStartBlock(ctx, run, framing, visitor)
                    : "not_authorized",
                "analyst_only",
            ),
            pause: availability(
                await approvalCatalog.pause_research.availability(ctx, run),
            ),
            resume: availability(
                await approvalCatalog.resume_research.availability(ctx, run),
            ),
            continuePreparation: availability(
                await approvalCatalog.continue_sources_preparation.availability(
                    ctx,
                    run,
                ),
            ),
            usePrepared: availability(
                await approvalCatalog.settle_sources_preparation.availability(
                    ctx,
                    run,
                ),
            ),
        },
        sources: preparation
            ? {
                  preparationId: preparation._id,
                  phase: sourcesPreparationPhase(run, preparation, mission),
                  outcome: preparation.sourcesMission?.result?.outcome ?? null,
                  settledAt: preparation.completedAt ?? null,
                  executionStop,
                  retainedDocuments,
                  instructionTreatment:
                      sourcesInstructionTreatment(preparation),
                  ...(progress ? { progress } : {}),
              }
            : null,
        nextCapability: preparation?.sourcesMission?.result
            ? (projectPreparedMaterial(preparation)?.nextCapability ?? null)
            : null,
    };
}

/** The single analyst-facing sentence for the Sources mission's recorded stop; every surface reuses it rather than translating block codes again. */
export function sourcesCurrentStop(state: ResearchState): string | null {
    const stop = state.sources?.executionStop;
    if (!stop) return null;
    const actor = `The ${agentName("sources")}`;
    const generation = generationInterruption(stop.blockCode ?? undefined);
    return generation === "invalid_response"
        ? `${actor} stopped because its model response could not be used.`
        : generation === "repeated_failure"
          ? `${actor} stopped after repeated attempts made no progress.`
          : stop.blockCode === "execution_time_limit" ||
              stop.blockCode === "execution_deadline"
            ? `${actor} stopped because its time window ended.`
            : stop.blockCode === "resource_limit"
              ? `${actor} stopped at a technical limit. The recorded reason does not identify which resource was exhausted.`
              : stop.blockCode === null
                ? `The reason for the ${agentName("sources")}'s stop was not recorded.`
                : `${actor} stopped before it could finish. Retained work remains available for inspection.`;
}

/** Renders observed outcomes and permitted next actions; it never grants execution authority. */
export function formatResearchSummary(state: ResearchState): string {
    const status = researchStatus({
        lifecycleState: state.phase,
        executionStatus: state.status,
    });
    const sourcesActor = `The ${agentName("sources")}`;
    const terminal =
        status === "completed" || status === "cancelled" || status === "failed";
    let summary: string;
    if (status === "completed") summary = "Research is complete.";
    else if (status === "cancelled") summary = "Research has been cancelled.";
    else if (status === "failed")
        summary =
            "Research stopped before it could finish. Retained work remains available for inspection.";
    else if (status === "not_started") summary = "Research has not started.";
    else if (status === "running")
        summary = state.pauseRequested
            ? "Pause requested. Research will pause after the work already in progress finishes."
            : "Research is running.";
    else if (state.actions.resume.reason === "sources_settlement_requested")
        summary =
            "You chose to use what's prepared. Preparation is finishing with the retained material and its limits.";
    else if (state.pauseReason === "sources_time_limit")
        summary = `${sourcesActor} reached its time limit. Material read so far remains inspectable.`;
    else if (state.pauseReason === "execution_interrupted")
        summary = "Research was interrupted. Retained work remains available.";
    else if (
        state.pauseReason === "source_review" ||
        state.phase === "awaiting_source_review"
    )
        summary =
            "Research is waiting for source review. Review the proposed sources to continue.";
    else if (state.pauseReason && state.pauseReason !== "analyst")
        summary =
            "Research is waiting for an analyst decision. Complete the pending review to continue.";
    else if (status === "paused") summary = "Research is paused.";
    else summary = "Research is not running.";

    const sourcePhase = state.sources?.phase;
    if (
        state.sources?.outcome &&
        (sourcePhase === "completed" ||
            sourcePhase === "completed_with_limits" ||
            sourcePhase === "ended_without_material")
    ) {
        const outcome =
            sourcePhase === "ended_without_material"
                ? "Sources preparation ended without usable material."
                : sourcePhase === "completed_with_limits"
                  ? "Sources preparation ended with partial material."
                  : "Sources preparation is complete.";
        summary =
            terminal || status === "running" || status === "paused"
                ? `${summary} ${outcome}`
                : outcome;
        summary +=
            sourcePhase === "ended_without_material"
                ? " Inspect available captures and leads in Sources."
                : " Inspect the retained material and its limits.";
    } else if (
        !terminal &&
        status === "idle" &&
        state.phase === "sources_prepared"
    ) {
        summary =
            "Sources preparation has ended. Inspect the retained material and its limits.";
    }
    const stop = sourcesCurrentStop(state);
    if (stop) summary += ` Recorded stop: ${stop}`;
    if (
        state.nextCapability === "investigation_unavailable" ||
        (!terminal && state.phase === "sources_prepared")
    )
        summary += " Question-led Investigation is not available yet.";
    if (!terminal) {
        if (state.actions.start.applicable)
            summary +=
                " Review the research program and choose Start research when ready.";
        if (state.actions.resume.applicable && status !== "running")
            summary += " Resume research to continue.";
        if (state.actions.continuePreparation.applicable)
            summary += " Continue preparation to use the remaining capacity.";
        if (state.actions.usePrepared.applicable)
            summary += " Use what's prepared to hand it off with its limits.";
    }
    return summary;
}
