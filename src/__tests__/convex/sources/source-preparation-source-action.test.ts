import { internal } from "@convex/_generated/api";
import "@convex/sourcePreparationActions";
import { afterEach, expect, test, vi } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

const prepareSource = internal.sourcePreparationActions.prepareSource;

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test("source preparation retains an unavailable capture without starting qualification", async () => {
    vi.stubEnv("EXA_API_KEY", "");
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    const { t, runId, corpusRevisionId, sourceId } =
        await seedSourcePreparation({ models: true });
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );

    const outcome = await t.action(prepareSource, { preparationId, sourceId });

    expect(outcome).toMatchObject({
        sourceId,
        result: {
            status: "unavailable",
            sourceCaptureId: expect.any(String),
            reasonCode: "missing_configuration",
        },
    });
    const state = await t.run(async (ctx) => ({
        capture: outcome.result.sourceCaptureId
            ? await ctx.db.get(outcome.result.sourceCaptureId)
            : null,
        tasks: await ctx.db.query("aiTaskResults").take(1),
        calls: await ctx.db.query("providerCalls").take(1),
    }));
    expect(state.capture).toMatchObject({ status: "unavailable" });
    expect(state.tasks).toEqual([]);
    expect(state.calls).toEqual([]);
    expect(request).not.toHaveBeenCalled();
});
