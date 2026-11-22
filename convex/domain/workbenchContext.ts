import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import type { AgentDefinition } from "@convex/execution/agentDefinition";
import { executionError, executionFailureCode } from "@convex/execution/errors";
import { turnFramingCitationPolicy } from "@convex/framingCitationPolicy";
import { SOURCES_HANDOFF_READ_CAPACITY } from "@convex/resourcePolicy";
import { requireSavedMaterialScope } from "./documentaryAccess";
import { researchQuestionCapacity } from "./framingEditAuthority";
import {
    framingConditionalReferences,
    framingPublicReferences,
    savedFramingReceipt,
} from "./framingProvenance";
import { formatResearchSummary, readResearchState } from "./researchState";
import { documentaryInventory as documentaryInventoryForMission } from "./savedMaterial";
import { savedMaterialBinding } from "./savedMaterialOperations";
import { sha256Hex, stableStringify } from "./sourcePassages";
import { sourceDocumentMetadata } from "./sourceRetrievalPolicy";
import { SourceReviewReads } from "./sourceReviewReads";
import {
    controlledSourcesContributions,
    coveragePresetGuidance,
    projectSourceDocumentState,
    readSourcesCoverage,
    summarizeSourcesPreparation,
} from "./sources";
import { supportsFramingWriteReceipt } from "./workbenchContracts";
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
    const preparation =
        run.sourcesProtocol === "sources_mission_v1" && run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
    if (preparation && preparation.runId !== run._id)
        throw executionError("not_authorized");
    const reads = preparation?.sourcesMission
        ? new SourceReviewReads(ctx.db, run._id, SOURCES_HANDOFF_READ_CAPACITY)
        : undefined;
    const documentaryInventory =
        mission &&
        savedMaterialBinding(
            mission.definitionId,
            mission.definitionVersion,
        ) === "referenced"
            ? await documentaryInventoryForMission(ctx, mission, reads)
            : null;
    const framingCitationPolicy = mission
        ? await turnFramingCitationPolicy(ctx, mission)
        : undefined;
    const sources = documentaryInventory
        ? []
        : await ctx.db
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
    if (mission && !documentaryInventory) {
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
    const instructions = await readWorkbenchInstructions(ctx, run._id);
    const controlled =
        preparation?.sourcesMission && reads
            ? await controlledSourcesContributions(ctx, preparation, reads)
            : [];
    const research = await readResearchState(ctx, run, {
        framing,
        preparation,
        reads,
        controlled,
    });
    const eventBasis = framing?.eventBasis;
    const eventReferences =
        eventBasis?.kind === "public"
            ? await framingPublicReferences(ctx, eventBasis)
            : undefined;
    const conditionReferences =
        eventBasis?.kind === "open"
            ? await framingConditionalReferences(ctx, eventBasis)
            : undefined;
    function documentaryState(
        sourceId: Id<"sources">,
        capture: {
            captureId: Id<"sourceCaptures">;
            contentHash: string | null;
        } | null,
    ) {
        if (!preparation?.sourcesMission) return null;
        return projectSourceDocumentState({
            preparationId: preparation._id,
            sourceId,
            capture,
            result: preparation.sourcesMission.result,
            decision:
                controlled.find((item) => item.sourceId === sourceId)
                    ?.sourceDecision ?? null,
            qualifications: controlled,
        });
    }
    const context = {
        company: run.companySnapshot ?? null,
        originalRequest: run.researchAngle ?? null,
        coveragePreset: run.coveragePreset ?? null,
        coverageGuidance: coveragePresetGuidance(run.coveragePreset),
        ...(framingCitationPolicy ? { framingCitationPolicy } : {}),
        modernSources: run.sourcesProtocol === "sources_mission_v1",
        framing: framing
            ? {
                  revision: framing.revision,
                  ...framing.content,
                  ...(supportsFramingWriteReceipt(mission?.definitionVersion)
                      ? {
                            publicCitations:
                                savedFramingReceipt(framing).publicCitations,
                        }
                      : {}),
                  ...(eventBasis ? { eventBasis } : {}),
                  ...(eventReferences ? { eventReferences } : {}),
                  ...(conditionReferences ? { conditionReferences } : {}),
                  origin: framing.origin,
                  fixed: !!run.fixedFramingRevisionId,
                  questionCapacity: await researchQuestionCapacity(ctx, run),
              }
            : null,
        research: { ...research, summary: formatResearchSummary(research) },
        ...(documentaryInventory
            ? { analystDocumentReferences: documentaryInventory.analystUrls }
            : {}),
        ...(documentaryInventory?.unavailableMaterials.length
            ? {
                  unavailableDocumentaryMaterials:
                      documentaryInventory.unavailableMaterials,
              }
            : {}),
        availableMaterials:
            documentaryInventory?.materials.map((material) => ({
                ...material,
                documentaryState:
                    material.captureId && material.sourceId
                        ? documentaryState(material.sourceId, {
                              captureId: material.captureId,
                              contentHash: material.contentHash,
                          })
                        : null,
            })) ??
            availableMaterials.map((material) => {
                const capture =
                    captureMetadata.find(
                        (item) => item.sourceId === material.sourceId,
                    ) ?? null;
                return {
                    ...material,
                    capture,
                    documentaryState: documentaryState(
                        material.sourceId,
                        capture
                            ? {
                                  captureId: capture.captureId,
                                  contentHash: capture.contentHash ?? null,
                              }
                            : null,
                    ),
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
                      coverage: await readSourcesCoverage(
                          ctx,
                          preparation,
                          reads,
                      ),
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
                    coveragePreset: context.coveragePreset,
                    analystRequests: context.analystRequests,
                    framing: context.framing,
                    research: context.research,
                    materials: context.availableMaterials,
                    ...(context.unavailableDocumentaryMaterials
                        ? {
                              unavailableDocumentaryMaterials:
                                  context.unavailableDocumentaryMaterials,
                          }
                        : {}),
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
