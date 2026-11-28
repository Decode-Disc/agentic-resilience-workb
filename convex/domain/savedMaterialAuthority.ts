import type { Doc } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import { executionError } from "@convex/execution/errors";
import { missionScope } from "@convex/execution/missionData";

/** The approved-corpus prerequisite belongs to inspection, never to every kind of agent. */
export async function requireSavedMaterialScope(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
    run?: Doc<"researchRuns">,
) {
    const scope = missionScope(mission);
    if (
        scope.kind !== "saved_material_inspection_v1" &&
        scope.kind !== "workbench_v1" &&
        scope.kind !== "sources_v1"
    )
        throw executionError("operation_not_allowed");
    const owner = run ?? (await ctx.db.get(mission.runId));
    const corpusRevisionId =
        scope.kind === "saved_material_inspection_v1"
            ? scope.corpusRevisionId
            : owner?.activeCorpusRevisionId;
    const revision = corpusRevisionId
        ? await ctx.db.get(corpusRevisionId)
        : null;
    if (
        revision?.runId !== mission.runId ||
        (revision.status !== "approved" &&
            !(
                owner?.sourcesProtocol === "sources_mission_v1" &&
                scope.kind !== "saved_material_inspection_v1"
            )) ||
        owner?.activeCorpusRevisionId !== revision._id
    )
        throw executionError("corpus_not_approved");
    return revision;
}
