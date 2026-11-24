import { internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

afterEach(() => vi.unstubAllEnvs());

test("historical preparation study inspection keeps the stored identity and local gate", async () => {
    const { t, runId } = await seedInspectedEvidence();
    const preparationId = (await t.run((ctx) => ctx.db.get(runId)))
        ?.sourcePreparationId;
    if (!preparationId) throw new Error("Expected retained preparation");
    const study = {
        phase: "replay" as const,
        manifestSha256: "a".repeat(64),
        sourceRunId: runId,
    };
    await t.run(async (ctx) => {
        await ctx.db.patch(runId, { purpose: "evaluation" });
        await ctx.db.patch(preparationId, { preparationStudy: study });
    });
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "https://example.com");
    await expect(
        t.query(internal.sourcePreparationEvaluation.inspect, {
            preparationId,
        }),
    ).rejects.toThrow();
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    await expect(
        t.query(internal.sourcePreparationEvaluation.inspect, {
            preparationId,
        }),
    ).resolves.toMatchObject({
        preparation: { _id: preparationId, preparationStudy: study },
        run: { _id: runId, purpose: "evaluation" },
        steps: [],
    });
});
