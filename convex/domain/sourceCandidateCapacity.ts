import type { DataModel, Id } from "@convex/_generated/dataModel";
import { sourceCandidateLimit } from "@convex/resourceLimits";
import type { GenericDatabaseReader } from "convex/server";

export type SourceCandidateCapacity = {
    limit: number;
    total: number;
    remaining: number;
};

export async function readSourceCandidateCapacity(
    db: GenericDatabaseReader<DataModel>,
    runId: Id<"researchRuns">,
): Promise<SourceCandidateCapacity> {
    const limit = sourceCandidateLimit();
    const sources = await db
        .query("sources")
        .withIndex("by_run_and_url", (query) => query.eq("runId", runId))
        .take(limit + 1);
    if (sources.length > limit) {
        throw new Error("Research dossier exceeds its source candidate limit");
    }
    return {
        limit,
        total: sources.length,
        remaining: Math.max(0, limit - sources.length),
    };
}

export function assertSourceCandidateRequestFits(
    requested: number,
    available: number,
): void {
    if (requested > available) {
        throw new Error(
            "This research dossier has reached its source candidate limit",
        );
    }
}
