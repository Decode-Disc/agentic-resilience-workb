import { internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

afterEach(() => vi.unstubAllEnvs());

test.each([
    undefined,
    "",
    "  ",
])("defaults an unset or empty concurrency to two", async (value) => {
    vi.stubEnv("SOURCE_PREPARATION_MAX_CONCURRENCY", value);
    const { t, runId, corpusRevisionId } = await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    expect(await t.run((ctx) => ctx.db.get(preparationId))).toMatchObject({
        maxConcurrentSources: 2,
        executionPlanVersion: "source_actions_v4",
    });
});

test("historical preparations keep two when deployment concurrency changes", async () => {
    const { t, runId, corpusRevisionId } = await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    await t.run(async (ctx) => {
        await ctx.db.patch(preparationId, {
            maxConcurrentSources: undefined,
            executionPlanVersion: "collect_then_compare_v1",
        });
        for (let i = 0; i < 3; i++)
            await ctx.db.insert("sources", {
                runId,
                canonicalUrl: `https://example.com/legacy-${i}`,
                title: "Legacy",
                origin: "exa",
                category: "official_product",
                createdAt: i + 2,
            });
    });
    vi.stubEnv("SOURCE_PREPARATION_MAX_CONCURRENCY", "invalid");
    const batch = await t.mutation(internal.sourcePreparation.nextBatch, {
        preparationId,
    });
    expect(batch.sourceIds).toHaveLength(2);
    expect(batch.maxConcurrentSources).toBe(2);
});

test.each([
    "4",
    "8",
    "100",
])("snapshots concurrency %s and bounds reading by available sources", async (value) => {
    vi.stubEnv("SOURCE_PREPARATION_MAX_CONCURRENCY", value);
    const { t, runId, corpusRevisionId } = await seedSourcePreparation();
    await t.run(async (ctx) => {
        for (let i = 1; i < 10; i++)
            await ctx.db.insert("sources", {
                runId,
                canonicalUrl: `https://example.com/source-${i}`,
                title: `Candidate ${i}`,
                origin: "exa",
                category: "official_product",
                createdAt: i + 1,
            });
    });
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    vi.stubEnv("SOURCE_PREPARATION_MAX_CONCURRENCY", "1");
    const batch = await t.mutation(internal.sourcePreparation.nextBatch, {
        preparationId,
    });
    expect(batch.sourceIds).toHaveLength(Math.min(Number(value), 10));
    expect(await t.run((ctx) => ctx.db.get(preparationId))).toMatchObject({
        maxConcurrentSources: Number(value),
    });
});

test.each([
    "0",
    "-1",
    "1.5",
    "NaN",
    "9007199254740992",
])("rejects invalid concurrency %s before claiming a preparation", async (value) => {
    vi.stubEnv("SOURCE_PREPARATION_MAX_CONCURRENCY", value);
    const { t, runId, corpusRevisionId } = await seedSourcePreparation();
    await expect(
        t.mutation(internal.sourcePreparation.claimForDiscovery, {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        }),
    ).rejects.toThrow("preparation_configuration_invalid");
    expect(
        await t.run((ctx) =>
            ctx.db.query("sourceSelectionProposalRebuilds").take(1),
        ),
    ).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("providerCalls").take(1))).toEqual(
        [],
    );
});
