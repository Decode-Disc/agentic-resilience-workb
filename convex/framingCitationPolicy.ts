import {
    readFramingCitationPolicy,
    storedPolicy,
} from "./framingCitationPolicyCore";

export {
    readFramingCitationPolicy,
    storedPolicy,
    turnFramingCitationPolicy,
} from "./framingCitationPolicyCore";

import { mutation, query } from "@convex/_generated/server";
import { requireAdmin } from "@convex/administrationAuthority";
import {
    DEFAULT_FRAMING_CITATION_POLICY,
    framingCitationPolicy,
} from "@convex/domain/framingContracts";
import { executionError } from "@convex/execution/errors";
import { v } from "convex/values";

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
