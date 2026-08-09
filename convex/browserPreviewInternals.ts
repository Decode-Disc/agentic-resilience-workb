import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { rateLimiter } from "./rateLimiter";

// ─── Internal query: validate source ownership and return decision ────────────

export const getSourceForPreview = internalQuery({
    args: {
        sourceId: v.id("sources"),
        runId: v.id("researchRuns"),
        visitorId: v.id("visitors"),
    },
    returns: v.union(
        v.object({
            canonicalUrl: v.string(),
            title: v.string(),
            decision: v.union(
                v.literal("accepted"),
                v.literal("rejected"),
                v.literal("pending"),
            ),
        }),
        v.null(),
    ),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run || run.ownerVisitorId !== args.visitorId) {
            return null;
        }
        const source = await ctx.db.get(args.sourceId);
        if (!source || source.runId !== args.runId) {
            return null;
        }
        const decision = await readSourceDecision(
            ctx,
            args.runId,
            args.sourceId,
        );
        return {
            canonicalUrl: source.canonicalUrl,
            title: source.title,
            decision,
        };
    },
});

async function readSourceDecision(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
    sourceId: Id<"sources">,
): Promise<"accepted" | "rejected" | "pending"> {
    const run = await ctx.db.get(runId);
    const revisionId = run?.activeCorpusRevisionId;
    if (!revisionId) return "pending";

    const reviewItem = await ctx.db
        .query("sourceReviewItems")
        .withIndex("by_revision_and_source", (builder) =>
            builder.eq("corpusRevisionId", revisionId).eq("sourceId", sourceId),
        )
        .unique();

    return reviewItem?.decision ?? "pending";
}

// ─── Internal mutation: rate-limit check ──────────────────────────────────────

export const checkRateLimit = internalMutation({
    args: { key: v.string() },
    returns: v.object({
        allowed: v.boolean(),
        retryAfterMs: v.optional(v.number()),
    }),
    handler: async (ctx, args) => {
        const result = await rateLimiter.limit(ctx, "previewRender", {
            key: args.key,
        });
        return {
            allowed: result.ok,
            retryAfterMs: result.retryAfter
                ? result.retryAfter * 1000
                : undefined,
        };
    },
});
