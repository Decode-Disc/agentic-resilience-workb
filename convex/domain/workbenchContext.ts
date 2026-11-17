import { internal } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import type { AgentDefinition } from "@convex/execution/agentDefinition";
import { readApprovalFacts } from "@convex/execution/approvals";
import { executionFailureCode } from "@convex/execution/errors";
import {
    readResearchControlReadiness,
    researchStateSummary,
} from "@convex/execution/researchControl";
import {
    researchQuestionCapacity,
    researchStartBlock,
} from "./framingEditAuthority";
import { requireSavedMaterialScope } from "./savedMaterialInspection";
import { sha256Hex, stableStringify } from "./sourcePassages";
import { sourceDocumentMetadata } from "./sourceRetrievalPolicy";
import {
    controlledSourcesContributions,
    readSourcesMission,
    summarizeSourcesPreparation,
} from "./sources";
import { supportsResearchControl } from "./transitions";
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
    const visitor = run.ownerVisitorId
        ? await ctx.db.get(run.ownerVisitorId)
        : null;
    const startBlock = visitor
        ? await researchStartBlock(ctx, run, framing, visitor)
        : "not_authorized";
    const { block: pauseBlock } = await readResearchControlReadiness(
        ctx,
        run,
        "pause",
    );
    const { block: resumeBlock } = await readResearchControlReadiness(
        ctx,
        run,
        "resume",
    );
    const actions = {
        start: {
            actor: "analyst_only",
            applicable: startBlock === null,
            reason: startBlock,
        },
        pause: {
            actor: "analyst_or_authorized_workbench",
            applicable: pauseBlock === null,
            reason: pauseBlock,
        },
        resume: {
            actor: "analyst_or_authorized_workbench",
            applicable: resumeBlock === null,
            reason: resumeBlock,
        },
    };
    const instructions = await readWorkbenchInstructions(ctx, run._id);
    const preparation =
        run.sourcesProtocol === "sources_mission_v1" && run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
    const sourcesMission = preparation
        ? await readSourcesMission(ctx, run)
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
                  questionCapacity: await researchQuestionCapacity(ctx, run),
              }
            : null,
        research: {
            summary: researchStateSummary(run),
            started: !!(
                run.researchStartRequestKey ||
                run.researchStartedAt ||
                run.fixedFramingRevisionId
            ),
            actions,
            approvals: await readApprovalFacts(ctx, run),
            phase: run.lifecycleState,
            controlAvailable: supportsResearchControl(run),
            status: run.executionStatus,
            pauseReason: run.pauseReason ?? null,
            pauseRequested: run.researchPauseRequested ?? false,
        },
        availableMaterials: availableMaterials.map((material) => ({
            ...material,
            capture:
                captureMetadata.find(
                    (capture) => capture.sourceId === material.sourceId,
                ) ?? null,
        })),
        analystRequests: await projectWorkbenchInstructions(ctx, instructions),
        ...(preparation?.sourcesMission
            ? {
                  documentaryPreparation: {
                      ...summarizeSourcesPreparation(
                          preparation,
                          sourcesMission?.status,
                      ),
                      controlledContributions:
                          await controlledSourcesContributions(
                              ctx,
                              preparation,
                          ),
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
