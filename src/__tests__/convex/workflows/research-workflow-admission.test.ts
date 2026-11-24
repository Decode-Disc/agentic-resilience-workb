import schema from "@convex/schema";
import { workflow } from "@convex/workflow";
import { convexTest } from "convex-test";
import { afterEach, assert, expect, test, vi } from "vitest";
import rateLimiterTest from "@/__tests__/convex/integrations/rate-limiter-test-register.js";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import {
    createAdmittedPreflight,
    seedHistoricalResearch,
} from "@/__tests__/setup/research-launch";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test("a no-envelope research workflow refuses before company or source I/O", async () => {
    vi.useFakeTimers();
    vi.stubEnv("SEC_USER_AGENT", "Workbench test test@example.com");
    const network = vi.fn(() => {
        throw new Error("Unexpected network dispatch");
    });
    vi.stubGlobal("fetch", network);
    const t = convexTest(schema, import.meta.glob("/convex/**/*.ts"));
    workflowTest.register(t);
    rateLimiterTest.register(t);
    const { preflightId } = await createAdmittedPreflight(t);
    const { runId } = await seedHistoricalResearch(t, {
        preflightId,
        idempotencyKey: "no-sources-envelope",
        coveragePreset: "balanced",
    });
    const workflowId = await t.run(
        async (ctx) => (await ctx.db.get(runId))?.workflowId,
    );
    assert(workflowId);
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100), 100);
    expect(
        await t.run((ctx) =>
            workflow.status(
                ctx,
                workflowId as Parameters<typeof workflow.status>[1],
            ),
        ),
    ).toEqual({
        type: "failed",
        error: expect.stringContaining("sources_configuration_unavailable"),
    });
    expect(network).not.toHaveBeenCalled();
    expect(
        await t.run(async (ctx) => ({
            run: await ctx.db.get(runId),
            reservations: await ctx.db.query("visitors").collect(),
            receipts: await ctx.db.query("providerCalls").collect(),
            preparations: await ctx.db
                .query("sourceSelectionProposalRebuilds")
                .collect(),
            missions: await ctx.db.query("agentMissions").collect(),
        })),
    ).toMatchObject({
        run: {
            workflowId,
            lifecycleState: "draft",
            executionStatus: "failed",
            executionGeneration: 1,
        },
        reservations: [expect.objectContaining({ analysesReserved: 1 })],
        receipts: [],
        preparations: [],
        missions: [],
    });
});
