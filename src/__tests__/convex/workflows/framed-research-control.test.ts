import { api, internal } from "@convex/_generated/api";
import schema from "@convex/schema";
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import rateLimiterTest from "@/__tests__/convex/integrations/rate-limiter-test-register.js";
import { createAdmittedPreflight } from "@/__tests__/setup/research-launch";
import { activateSourcesMission } from "@/__tests__/setup/sources-mission";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";
import workflowTest from "./workflow-test-register.js";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});
test("the durable framed workflow drains SEC revalidation, waits for Resume, then continues into Sources preparation", async () => {
    vi.useFakeTimers();
    vi.stubEnv("SEC_USER_AGENT", "Workbench test@example.com");
    activateSourcesMission();
    const t = convexTest(schema, modules);
    agentTest.register(t);
    workflowTest.register(t);
    rateLimiterTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t),
        client = t.withIdentity({ subject: userId });
    const { runId } = await client.mutation(api.framing.confirmCompany, {
        preflightId,
        idempotencyKey: "durable-pause",
        coveragePreset: "balanced",
    });
    await client.mutation(api.framing.save, {
        runId,
        expectedRevision: 1,
        requestKey: "program",
        content: {
            scope: "Claims",
            questions: [
                {
                    id: "q",
                    text: "Who controls coordination?",
                    shortLabel: "Control",
                    rationale: "Separate control from supply.",
                },
            ],
        },
    });
    const request = vi.fn(async () => {
        await client.mutation(api.execution.researchControl.pause, {
            runId,
            expectedGeneration: 1,
        });
        return new Response(
            JSON.stringify({
                cik: "0001818201",
                name: "CCC Intelligent Solutions Holdings Inc.",
                tickers: ["CCCS"],
                exchanges: ["Nasdaq"],
                filings: { recent: { accessionNumber: [] } },
            }),
            { status: 200 },
        );
    });
    vi.stubGlobal("fetch", request);
    await client.mutation(api.framing.startResearch, {
        runId,
        expectedRevision: 2,
        requestKey: "start",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "paused",
        pauseReason: "analyst",
        lifecycleState: "draft",
        executionGeneration: 2,
    });
    expect(request).toHaveBeenCalledOnce();
    await client.mutation(api.execution.researchControl.resume, {
        runId,
        expectedGeneration: 2,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // Resume continues into Sources preparation on the next generation; the earlier SEC response is not requested again.
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        sourcesProtocol: "sources_mission_v1",
        lifecycleState: "discovering_sources",
        executionGeneration: 3,
    });
    expect(request).toHaveBeenCalledOnce();
}, 20000);
const modules = import.meta.glob("/convex/**/*.ts");

test("pause and Resume retain documentary outcomes, allowance and the original preparation deadline", async () => {
    vi.useFakeTimers();
    const { t, runId, corpusRevisionId, sourceId, userId } =
        await seedSourcePreparation();
    workflowTest.register(t);
    await t.run((ctx) =>
        ctx.db.patch(runId, { startMode: "framed", agentExecutionVersion: 3 }),
    );
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId,
            result: {
                status: "unavailable",
                reasonCode: "content_not_available",
            },
        },
    });
    const before = await t.run((ctx) => ctx.db.get(preparationId));
    if (!before) throw new Error("Expected retained preparation");
    const client = t.withIdentity({ subject: userId });
    await client.mutation(api.execution.researchControl.pause, {
        runId,
        expectedGeneration: 3,
    });
    await t.mutation(internal.execution.researchControl.checkpoint, {
        runId,
        preparationId,
    });
    await client.mutation(api.execution.researchControl.resume, {
        runId,
        expectedGeneration: 4,
    });
    await t.mutation(internal.execution.researchControl.checkpoint, {
        runId,
        preparationId,
    });
    const after = await t.run((ctx) => ctx.db.get(preparationId));
    expect(after).toMatchObject({
        executionGeneration: 5,
        sourceOutcomes: before.sourceOutcomes,
        deadlineAt: before.deadlineAt,
        modelLimits: before.modelLimits,
    });
    expect(
        (
            await t.mutation(internal.sourcePreparation.nextBatch, {
                preparationId,
            })
        ).sourceIds,
    ).not.toContain(sourceId);
});
