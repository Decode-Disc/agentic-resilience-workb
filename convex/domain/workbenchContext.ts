import { internal } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import type { AgentDefinition } from "@convex/execution/agentDefinition";
import { executionFailureCode } from "@convex/execution/errors";
import { researchStateSummary } from "@convex/execution/researchControl";
import { requireSavedMaterialScope } from "./savedMaterialInspection";
import { sha256Hex, stableStringify } from "./sourcePassages";
import { summarizeSourcesPreparation } from "./sources";
import { supportsResearchControl } from "./transitions";
import { readWorkbenchInstructions } from "./workbenchInstructions";

export async function readWorkbenchFacts(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
    mission?: Doc<"agentMissions">,
): ReturnType<AgentDefinition["context"]> {
    const framing = run.currentFramingRevisionId
        ? await ctx.db.get(run.currentFramingRevisionId)
        : null;
    const sources = await ctx.db
        .query("sources")
        .withIndex("by_run_and_url", (q) => q.eq("runId", run._id))
        .take(61);
    if (sources.length > 60)
        return { kind: "blocked", code: "context_capacity" };
    let availableMaterials = sources.map((s) => ({
        sourceId: s._id,
        title: s.title,
        url: s.canonicalUrl,
    }));
    if (mission && mission.definitionVersion >= 2) {
        try {
            await requireSavedMaterialScope(ctx, mission, run);
            const available = new Set(
                await ctx.runQuery(
                    internal.sourceRetrieval.availableCapturesForMission,
                    {
                        missionId: mission._id,
                        expectedGeneration: mission.generation,
                        sourceIds: availableMaterials.map((m) => m.sourceId),
                    },
                ),
            );
            availableMaterials = availableMaterials.filter((m) =>
                available.has(m.sourceId),
            );
        } catch (error) {
            if (executionFailureCode(error) !== "corpus_not_approved")
                throw error;
            availableMaterials = [];
        }
    }
    const instructions = await readWorkbenchInstructions(ctx, run._id);
    const preparation =
        run.sourcesProtocol === "sources_mission_v1" && run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
    const context = {
        company: run.companySnapshot ?? null,
        originalRequest: run.researchAngle ?? null,
        framing: framing
            ? {
                  revision: framing.revision,
                  ...framing.content,
                  origin: framing.origin,
                  fixed: !!run.fixedFramingRevisionId,
              }
            : null,
        research: {
            summary: researchStateSummary(run),
            phase: run.lifecycleState,
            controlAvailable: supportsResearchControl(run),
            status: run.executionStatus,
            pauseReason: run.pauseReason ?? null,
            pauseRequested: run.researchPauseRequested ?? false,
        },
        availableMaterials,
        analystRequests: instructions,
        ...(preparation?.sourcesMission
            ? {
                  documentaryPreparation:
                      summarizeSourcesPreparation(preparation),
              }
            : {}),
        activeWork: {},
    };
    return {
        kind: "ready",
        context: {
            ...context,
            factsRevisionHash: sha256Hex(
                stableStringify({
                    company: context.company,
                    originalRequest: context.originalRequest,
                    analystRequests: context.analystRequests,
                    framing: context.framing,
                    research: context.research,
                    materials: context.availableMaterials,
                    preparation: context.documentaryPreparation ?? null,
                    corpusRevisionId: run.activeCorpusRevisionId ?? null,
                    captureIds: preparation?.sourcesMission?.captureIds ?? [],
                    qualifications:
                        preparation?.sourcesMission?.qualifications ?? [],
                    restrictions:
                        preparation?.sourcesMission?.restrictedContributions ??
                        [],
                }),
            ),
        },
    };
}
