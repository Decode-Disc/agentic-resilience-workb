import type { Doc } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import { DEFAULT_FRAMING_CITATION_POLICY } from "@convex/domain/framingContracts";
import { savedMaterialBinding } from "@convex/domain/savedMaterialOperations";
import { executionError } from "@convex/execution/errors";
export function storedPolicy(ctx: QueryCtx) {
    return ctx.db
        .query("framingCitationSettings")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .unique();
}

export async function readFramingCitationPolicy(ctx: QueryCtx) {
    const row = await storedPolicy(ctx);
    return row
        ? { revision: row.revision, requireContextRead: row.requireContextRead }
        : DEFAULT_FRAMING_CITATION_POLICY;
}

/** Historical bindings keep their pinned citation contract. New ones require the claimed snapshot. */
export async function turnFramingCitationPolicy(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
) {
    if (
        mission.definitionId !== "workbench_v1" ||
        savedMaterialBinding(
            mission.definitionId,
            mission.definitionVersion,
        ) !== "referenced"
    )
        return undefined;
    const turn = mission.conversationTurnId
        ? await ctx.db.get(mission.conversationTurnId)
        : null;
    if (turn?.missionId !== mission._id || !turn.framingCitationPolicy)
        throw executionError("framing_citation_policy_unavailable");
    return turn.framingCitationPolicy;
}
