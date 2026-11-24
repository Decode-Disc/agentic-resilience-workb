import { internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

afterEach(() => vi.unstubAllEnvs());

test("configuration checks are inspectable without inventing a provider attempt", async () => {
    const { t, runId, corpusRevisionId } = await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        {
            runId,
            corpusRevisionId,
            expectedExecutionGeneration: 3,
        },
    );
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(
        await t.action(internal.sourcePreparationActions.checkConfiguration, {
            preparationId,
        }),
    ).toBe(false);
    expect(await t.run((ctx) => ctx.db.get(preparationId))).toMatchObject({
        configurationCheck: { available: false },
    });
    expect(await t.run((ctx) => ctx.db.query("providerCalls").take(2))).toEqual(
        [],
    );
});
