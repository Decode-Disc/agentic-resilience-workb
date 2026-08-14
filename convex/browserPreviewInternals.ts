import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { purgePreviewCacheForSource } from "./domain/previewCache";
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

// ─── Public read path: fresh cached preview, or null on miss/expiry ──────────

export const getPreview = query({
    args: { sourceId: v.id("sources") },
    returns: v.union(v.object({ dataUrl: v.string() }), v.null()),
    handler: async (ctx, args) => {
        const entry = await ctx.db
            .query("previewCaches")
            .withIndex("by_source", (builder) =>
                builder.eq("sourceId", args.sourceId),
            )
            .first();
        if (!entry || entry.expiresAt <= Date.now()) {
            return null;
        }
        return { dataUrl: entry.dataUrl };
    },
});

// ─── Internal mutation: upsert a cache entry (delete-then-insert) ────────────

export const storePreview = internalMutation({
    args: {
        sourceId: v.id("sources"),
        dataUrl: v.string(),
        sizeBytes: v.number(),
        expiresAt: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("previewCaches")
            .withIndex("by_source", (builder) =>
                builder.eq("sourceId", args.sourceId),
            )
            .first();
        if (existing) {
            await ctx.db.delete(existing._id);
        }
        await ctx.db.insert("previewCaches", {
            sourceId: args.sourceId,
            dataUrl: args.dataUrl,
            sizeBytes: args.sizeBytes,
            createdAt: Date.now(),
            expiresAt: args.expiresAt,
        });
        return null;
    },
});

// ─── Internal mutation: purge a source's cached preview ──────────────────────

export const purgePreviewForSource = internalMutation({
    args: { sourceId: v.id("sources") },
    returns: v.null(),
    handler: async (ctx, args) => {
        await purgePreviewCacheForSource(ctx, args.sourceId);
        return null;
    },
});
