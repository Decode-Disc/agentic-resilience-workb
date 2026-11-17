import type { Doc, Id } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";

/** The latest committed capture wins; otherwise capture progress and unavailability stay distinct. */
export async function sourceCaptureState(
    ctx: QueryCtx,
    sourceId: Id<"sources">,
) {
    const latest = await ctx.db
        .query("sourceCaptures")
        .withIndex("by_source_and_updated_at", (q) =>
            q.eq("sourceId", sourceId),
        )
        .order("desc")
        .first();
    if (!latest)
        return { committed: null, capturing: false, unavailable: false };
    const byStatus = (status: Doc<"sourceCaptures">["status"]) =>
        ctx.db
            .query("sourceCaptures")
            .withIndex("by_source_and_status_and_updated_at", (q) =>
                q.eq("sourceId", sourceId).eq("status", status),
            )
            .order("desc")
            .first();
    const committed =
        latest.status === "committed" ? latest : await byStatus("committed");
    if (committed) return { committed, capturing: false, unavailable: false };
    const capturing =
        latest.status === "reserved" ||
        latest.status === "uploaded" ||
        !!(await byStatus("reserved")) ||
        !!(await byStatus("uploaded"));
    const unavailable =
        latest.status === "unavailable" || !!(await byStatus("unavailable"));
    return { committed: null, capturing, unavailable };
}
