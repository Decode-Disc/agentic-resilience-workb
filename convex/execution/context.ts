import type { Id } from "@convex/_generated/dataModel";
import { internalQuery, type QueryCtx } from "@convex/_generated/server";
import { readPreparationSourceDecision } from "@convex/domain/sourcePreparationAuthority";
import { v } from "convex/values";
import { requireMissionAuthority } from "./authority";
import { MAX_CONTEXT_BYTES } from "./contracts";
import { savedMaterialInspectionDefinition } from "./definitions";

/** Required context is assembled from retained authority and work, never from an optional memory-saving tool. */
export async function buildMissionContext(
    ctx: QueryCtx,
    missionId: Id<"agentMissions">,
    expectedGeneration: number,
) {
    const { mission, run, revision } = await requireMissionAuthority(
        ctx,
        missionId,
        expectedGeneration,
    );
    const heads = await ctx.db
        .query("sourceReviewItems")
        .withIndex("by_revision_decision_and_order", (q) =>
            q.eq("corpusRevisionId", revision._id).eq("decision", "accepted"),
        )
        .take(65);
    if (heads.length > 64)
        return { kind: "blocked" as const, code: "context_capacity" };
    const availableMaterials = [];
    for (const head of heads) {
        if (
            (await readPreparationSourceDecision(ctx.db, {
                runId: run._id,
                corpusRevisionId: revision._id,
                sourceId: head.sourceId,
            })) !== "accepted"
        )
            continue;
        const source = await ctx.db.get(head.sourceId);
        const decision = await ctx.db.get(head.latestDecisionId);
        if (source)
            availableMaterials.push({
                sourceId: source._id,
                title: source.title,
                canonicalUrl: source.canonicalUrl,
                humanDecision: {
                    decisionId: head.latestDecisionId,
                    reason: decision?.reason ?? null,
                },
            });
    }
    const latest = await ctx.db
        .query("agentOperationRequests")
        .withIndex("by_mission", (q) => q.eq("missionId", missionId))
        .order("desc")
        .take(4);
    const pending = await ctx.db
        .query("agentOperationRequests")
        .withIndex("by_mission_and_status", (q) =>
            q.eq("missionId", missionId).eq("status", "pending"),
        )
        .take(5);
    const previousInvocation = mission.lastInvocationId
        ? await ctx.db.get(mission.lastInvocationId)
        : null;
    const inputJson = JSON.stringify({
        version: mission.definitionVersion,
        definition: {
            id: savedMaterialInspectionDefinition.id,
            version: savedMaterialInspectionDefinition.version,
            instructions: savedMaterialInspectionDefinition.instructions,
            operationNames: Object.keys(
                savedMaterialInspectionDefinition.tools,
            ),
        },
        mission: {
            id: mission._id,
            status: mission.status,
            definition: mission.definitionId,
            objective: mission.objectiveKey,
            runId: run._id,
            corpusRevisionId: revision._id,
        },
        humanInstructions: { researchAngle: run.researchAngle ?? null },
        decisions: {
            approvedCorpusRevision: revision.revision,
            approvedBy: revision.approvedByVisitorId ?? null,
            approvedAt: revision.approvedAt ?? null,
        },
        constraints: {
            generation: mission.generation,
            deadlineAt: mission.deadlineAt,
            operations: Object.keys(savedMaterialInspectionDefinition.tools),
            authority: "inspect_approved_saved_material_only",
        },
        workingNotes: {
            status: "working_notes_not_established_facts",
            text: mission.workingNotes,
        },
        lastObservableInvocation:
            previousInvocation?.status === "returned"
                ? {
                      invocationId: previousInvocation._id,
                      status: "observable_reply_not_established_facts",
                      outputJson: previousInvocation.outputJson ?? null,
                      rawOutputJson: previousInvocation.rawOutputJson ?? null,
                  }
                : null,
        activeWork: {
            inspectedCaptureIds: mission.inspectedCaptureIds,
            unfinishedObligations: mission.obligations,
            noProgressTurns: mission.noProgressTurns,
        },
        availableMaterials,
        triggeringRequestsAndResults: latest.reverse().map((request) => ({
            requestId: request._id,
            input: request.input,
            status: request.status,
            outcome: request.outcome ?? null,
        })),
        pendingRequests: pending.map((request) => ({
            requestId: request._id,
            input: request.input,
        })),
        history: {
            operation: "consult_mission_state",
            cursor: null,
            description:
                "Exact prior observable inputs, outputs, requests and results are retained and can be read in pages.",
        },
    });
    if (new TextEncoder().encode(inputJson).length > MAX_CONTEXT_BYTES)
        return { kind: "blocked" as const, code: "context_capacity" };
    return { kind: "ready" as const, inputJson };
}

export const build = internalQuery({
    args: { missionId: v.id("agentMissions"), expectedGeneration: v.number() },
    returns: v.union(
        v.object({ kind: v.literal("ready"), inputJson: v.string() }),
        v.object({ kind: v.literal("blocked"), code: v.string() }),
    ),
    handler: (ctx, args) =>
        buildMissionContext(ctx, args.missionId, args.expectedGeneration),
});
