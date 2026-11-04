import { internal } from "@convex/_generated/api";
import { SOURCE_RETRIEVAL_VERSION } from "@convex/domain/sourceRetrievalPolicy";
import { initializeSources } from "@convex/domain/sources";
import { seedInspectedEvidence } from "./source-preparation";

export const sourcesTestEnvelope = {
    version: 1 as const,
    maxNeeds: 12,
    initialSearches: 4,
    complementSearches: 3,
    acquisitions: 10,
    controls: 20,
};

/** Real mission/capture fixtures share the public operation path; no provider is called. */
export async function seedCapturedSources() {
    const f = await seedInspectedEvidence();
    const preparationId = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        if (!run?.sourcePreparationId)
            throw new Error("Missing preparation fixture");
        await ctx.db.patch(f.runId, {
            sourcesProtocol: "sources_mission_v1",
            lifecycleState: "discovering_sources",
        });
        await ctx.db.patch(f.corpusRevisionId, { status: "draft" });
        await ctx.db.patch(run.sourcePreparationId, {
            status: "started",
            executionGeneration: 4,
            deadlineAt: Date.now() + 60_000,
            leaseExpiresAt: Date.now() + 60_000,
        });
        const data = await initializeSources(
            ctx,
            run.sourcePreparationId,
            sourcesTestEnvelope,
        );
        await ctx.db.patch(run.sourcePreparationId, {
            sourcesMission: { ...data, captureIds: [f.captureId] },
        });
        return run.sourcePreparationId;
    });
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        expectedGeneration: 4,
        definitionId: "sources_v1",
        scope: { kind: "sources_v1", preparationId },
        requestKey: "sources-fixture",
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId,
            expectedGeneration: 4,
            cause: "fixture-read",
            input: {
                kind: "search_available_material",
                sourceId: f.sourceId,
                query: "workflow",
            },
        },
    );
    const outcome = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 4,
    });
    if (outcome.kind !== "success")
        throw new Error(`Fixture read failed: ${JSON.stringify(outcome)}`);
    const passage = await f.t.run((ctx) =>
        ctx.db
            .query("sourceSearchPassages")
            .withIndex("by_scope_capture_order", (q) =>
                q
                    .eq(
                        "scopeKey",
                        `${f.runId}:${f.corpusRevisionId}:${SOURCE_RETRIEVAL_VERSION}`,
                    )
                    .eq("captureId", f.captureId),
            )
            .first(),
    );
    if (!passage) throw new Error("Fixture capture was not indexed");
    return { ...f, preparationId, missionId, passage };
}
