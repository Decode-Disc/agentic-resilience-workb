import { internal } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import type { AgentDefinition } from "@convex/execution/agentDefinition";
import { executionFailureCode } from "@convex/execution/errors";
import { researchQuestionCapacity } from "./framingEditAuthority";
import { formatResearchSummary, readResearchState } from "./researchState";
import { requireSavedMaterialScope } from "./savedMaterialInspection";
import { sha256Hex, stableStringify } from "./sourcePassages";
import { sourceDocumentMetadata } from "./sourceRetrievalPolicy";
import {
    controlledSourcesContributions,
    projectSourceDocumentState,
    readSourcesCoverage,
    summarizeSourcesPreparation,
} from "./sources";
import { observedPublicContext } from "./workbenchContracts";
import {
    projectWorkbenchInstructions,
    readWorkbenchInstructions,
} from "./workbenchInstructions";

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
        ...sourceDocumentMetadata(s),
        url: s.canonicalUrl,
    }));
    let captureMetadata: Awaited<
        ReturnType<
            typeof ctx.runQuery<
                typeof internal.sourceRetrieval.availableCaptureMetadataForMission
            >
        >
    > = [];
    if (mission) {
        try {
            await requireSavedMaterialScope(ctx, mission, run);
            captureMetadata = await ctx.runQuery(
                internal.sourceRetrieval.availableCaptureMetadataForMission,
                {
                    missionId: mission._id,
                    expectedGeneration: mission.generation,
                    sourceIds: availableMaterials.map((m) => m.sourceId),
                },
            );
            const available = new Set(
                captureMetadata.map((capture) => capture.sourceId),
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
    const research = await readResearchState(ctx, run);
    const instructions = await readWorkbenchInstructions(ctx, run._id);
    const preparation =
        run.sourcesProtocol === "sources_mission_v1" && run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
    const controlled = preparation?.sourcesMission
        ? await controlledSourcesContributions(ctx, preparation)
        : [];
    const eventBasis = framing?.eventBasis;
    const eventContext =
        eventBasis?.kind === "public"
            ? observedPublicContext(
                  await ctx.db.get(eventBasis.lookupRequestId),
              )
            : undefined;
    const context = {
        company: run.companySnapshot ?? null,
        originalRequest: run.researchAngle ?? null,
        modernSources: run.sourcesProtocol === "sources_mission_v1",
        framing: framing
            ? {
                  revision: framing.revision,
                  ...framing.content,
                  ...(eventBasis ? { eventBasis } : {}),
                  ...(eventBasis?.kind === "public" && eventContext
                      ? {
                            eventReferences:
                                eventBasis.referenceIndexes.flatMap((index) => {
                                    const reference =
                                        eventContext.references[index];
                                    return reference ? [reference] : [];
                                }),
                        }
                      : {}),
                  origin: framing.origin,
                  fixed: !!run.fixedFramingRevisionId,
                  questionCapacity: await researchQuestionCapacity(ctx, run),
              }
            : null,
        research: { ...research, summary: formatResearchSummary(research) },
        availableMaterials: availableMaterials.map((material) => {
            const capture =
                captureMetadata.find(
                    (item) => item.sourceId === material.sourceId,
                ) ?? null;
            return {
                ...material,
                capture,
                documentaryState: preparation?.sourcesMission
                    ? projectSourceDocumentState({
                          preparationId: preparation._id,
                          sourceId: material.sourceId,
                          capture: capture
                              ? {
                                    captureId: capture.captureId,
                                    contentHash: capture.contentHash ?? null,
                                }
                              : null,
                          result: preparation.sourcesMission.result,
                          decision:
                              controlled.find(
                                  (item) => item.sourceId === material.sourceId,
                              )?.sourceDecision ?? null,
                          qualifications: controlled,
                      })
                    : null,
            };
        }),
        analystRequests: await projectWorkbenchInstructions(ctx, instructions),
        ...(preparation?.sourcesMission
            ? {
                  documentaryPreparation: {
                      ...summarizeSourcesPreparation(
                          preparation,
                          research.sources,
                      ),
                      coverage: await readSourcesCoverage(ctx, preparation),
                      controlledContributions: controlled,
                  },
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
