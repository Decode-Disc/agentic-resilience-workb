import type { DataModel, Id } from "@convex/_generated/dataModel";
import {
    sourceCandidateLimit,
    sourceDossierCandidateLimit,
} from "@convex/resourceLimits";
import {
    MAX_HISTORICAL_SOURCE_CANDIDATES,
    MAX_INITIAL_SOURCE_CANDIDATES,
} from "@convex/resourcePolicy";
import type { GenericDatabaseReader } from "convex/server";

export type SourceCandidateCapacity = {
    limit: number;
    total: number;
    remaining: number;
};

export async function readSourceCandidateCapacity(
    db: GenericDatabaseReader<DataModel>,
    runId: Id<"researchRuns">,
    scope: "dossier" | "initial_discovery" | "before_sources" = "dossier",
): Promise<SourceCandidateCapacity> {
    const run = await db.get(runId);
    const historicalLimit =
        scope === "before_sources"
            ? MAX_HISTORICAL_SOURCE_CANDIDATES
            : sourceDossierCandidateLimit(run?.sourcePreparationId);
    const limit =
        scope === "initial_discovery"
            ? Math.min(
                  sourceCandidateLimit(),
                  MAX_INITIAL_SOURCE_CANDIDATES,
                  historicalLimit,
              )
            : historicalLimit;
    const sources = await db
        .query("sources")
        .withIndex("by_run_and_url", (query) => query.eq("runId", runId))
        .take(historicalLimit + 1);
    if (sources.length > historicalLimit && scope !== "before_sources") {
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
