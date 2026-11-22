import type { DataModel, Doc, Id } from "@convex/_generated/dataModel";
import type { GenericDatabaseReader } from "convex/server";
import { type Infer, v } from "convex/values";

/** The latest committed capture wins; otherwise capture progress and unavailability stay distinct. */
export async function sourceCaptureState(
    ctx: { db: GenericDatabaseReader<DataModel> },
    sourceId: Id<"sources">,
    options?: {
        admittedCaptureIds?: ReadonlySet<Id<"sourceCaptures">>;
        /** A transaction-local reader can reuse raw lookups across different admission views. */
        read?: (
            status: "latest" | Doc<"sourceCaptures">["status"],
            load: () => Promise<Doc<"sourceCaptures"> | null>,
        ) => Promise<Doc<"sourceCaptures"> | null>;
    },
) {
    const lookup = (status: "latest" | Doc<"sourceCaptures">["status"]) => {
        const load = async () => {
            const query = ctx.db.query("sourceCaptures");
            const row = await (status === "latest"
                ? query.withIndex("by_source_and_updated_at", (q) =>
                      q.eq("sourceId", sourceId),
                  )
                : query.withIndex("by_source_and_status_and_updated_at", (q) =>
                      q.eq("sourceId", sourceId).eq("status", status),
                  )
            )
                .order("desc")
                .first();
            return row;
        };
        return options?.read ? options.read(status, load) : load();
    };
    const latest = await lookup("latest");
    if (!latest)
        return { committed: null, capturing: false, unavailable: false };
    const committed =
        latest.status === "committed" ? latest : await lookup("committed");
    if (
        committed &&
        (!options?.admittedCaptureIds ||
            options.admittedCaptureIds.has(committed._id))
    )
        return { committed, capturing: false, unavailable: false };
    const capturing =
        latest.status === "reserved" ||
        latest.status === "uploaded" ||
        !!(await lookup("reserved")) ||
        !!(await lookup("uploaded"));
    const unavailable =
        latest.status === "unavailable" || !!(await lookup("unavailable"));
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
