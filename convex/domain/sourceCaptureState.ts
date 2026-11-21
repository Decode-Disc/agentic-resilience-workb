import type { Doc, Id } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import { type Infer, v } from "convex/values";

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

export const sourceCaptureAvailabilityValidator = v.union(
    v.literal("full"),
    v.literal("partial"),
    v.literal("unknown"),
    v.literal("capturing"),
    v.literal("unavailable"),
    v.literal("not_captured"),
);

export type SourceCaptureAvailability = Infer<
    typeof sourceCaptureAvailabilityValidator
>;

/** Availability describes the saved representation, not whether an agent consulted it. */
export function captureAvailability(
    state: Awaited<ReturnType<typeof sourceCaptureState>>,
): SourceCaptureAvailability {
    if (state.committed) {
        const completeness =
            state.committed.representationCompleteness ??
            state.committed.readingCompleteness ??
            "unknown";
        return completeness === "complete" ? "full" : completeness;
    }
    return state.capturing
        ? "capturing"
        : state.unavailable
          ? "unavailable"
          : "not_captured";
}
