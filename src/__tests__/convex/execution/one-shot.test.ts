import { internal } from "@convex/_generated/api";
import { expect, test } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

test("claiming a recovery preserves the existing preparation protocol and engaged model", async () => {
    const { t, runId, corpusRevisionId } = await seedSourcePreparation({
        models: true,
    });
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    const model = await t.mutation(internal.modelConfiguration.forPreparation, {
        preparationId,
        expectedGeneration: 3,
    });
    await t.run(async (ctx) => {
        await ctx.db.patch(preparationId, {
            executionPlanVersion: "source_actions_v3",
        });
        await ctx.db.patch(runId, { executionGeneration: 4 });
    });
    const resumedId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 4 },
    );
    expect(resumedId).not.toBe(preparationId);
    expect(await t.run((ctx) => ctx.db.get(resumedId))).toMatchObject({
        executionPlanVersion: "source_actions_v3",
        modelRevisionId: model._id,
    });
});
