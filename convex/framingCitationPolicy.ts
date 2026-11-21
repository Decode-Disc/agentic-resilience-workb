import type { Doc } from "@convex/_generated/dataModel";
import { mutation, type QueryCtx, query } from "@convex/_generated/server";
import { requireAdmin } from "@convex/administrationAuthority";
import {
    DEFAULT_FRAMING_CITATION_POLICY,
    framingCitationPolicy,
} from "@convex/domain/framingContracts";
import { savedMaterialBinding } from "@convex/domain/savedMaterialOperations";
import { executionError } from "@convex/execution/errors";
import { v } from "convex/values";

function storedPolicy(ctx: QueryCtx) {
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

export const get = query({
    args: {},
    returns: framingCitationPolicy,
    async handler(ctx) {
        await requireAdmin(ctx);
        return readFramingCitationPolicy(ctx);
    },
});

export const set = mutation({
    args: {
        expectedRevision: v.number(),
        requireContextRead: framingCitationPolicy.fields.requireContextRead,
    },
    returns: framingCitationPolicy,
    async handler(ctx, { expectedRevision, requireContextRead }) {
        await requireAdmin(ctx);
        const row = await storedPolicy(ctx);
        if (
            (row?.revision ?? DEFAULT_FRAMING_CITATION_POLICY.revision) !==
            expectedRevision
        )
            throw executionError("version_conflict");
        const policy = { revision: expectedRevision + 1, requireContextRead };
        const value = {
            ...policy,
            key: "global" as const,
            updatedAt: Date.now(),
        };
        if (row) await ctx.db.replace(row._id, value);
        else await ctx.db.insert("framingCitationSettings", value);
        return policy;
    },
});
