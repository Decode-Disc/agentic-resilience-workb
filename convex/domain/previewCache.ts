import type { Id } from "@convex/_generated/dataModel";
import type { MutationCtx } from "@convex/_generated/server";

/**
 * Deletes a source's cached preview screenshot if one exists. Used whenever a
 * source's decision leaves `pending` (accepted or rejected), since a decided
 * source is no longer previewable and its rendered image must not linger as a
 * stale candidate screenshot.
 *
 * This is a plain shared helper, not a Convex function: Convex mutations cannot
 * call other mutations, so both decision sites (explicit `decide` and bulk
 * `approveProposedCorpus`) import and invoke it inline.
 */
export async function purgePreviewCacheForSource(
    ctx: MutationCtx,
    sourceId: Id<"sources">,
): Promise<void> {
    const existing = await ctx.db
        .query("previewCaches")
        .withIndex("by_source", (builder) => builder.eq("sourceId", sourceId))
        .first();
    if (existing) {
        await ctx.db.delete(existing._id);
    }
}
