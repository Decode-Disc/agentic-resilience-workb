import { api, internal } from "@convex/_generated/api";
import { afterEach, assert, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

test.each([
    "live",
    "simulation",
] as const)("public Resume preserves an admitted browser mission's %s provenance through scheduled reconciliation", async (provenance) => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    const f = await seedCapturedSources();
    const { catalogId } = await installModel(
        f.t,
        { model: "openai/gpt-oss-20b", reasoningEffort: "low" },
        "sources",
    );
    await f.t.run((ctx) =>
        ctx.db.patch(f.invitationId, { slotKey: "analyst-4" }),
    );
    const contextId = await f.t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        {
            slotKey: "analyst-4",
            contextKey: "paid-sources-resume",
            durationMs: 60000,
        },
    );
    await f.t.run(async (ctx) => {
        const model = await ctx.db.get(catalogId);
        assert(model?.currentRevisionId);
        const frameId = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Fixed workflow", questions: [] },
            requestKey: "paid-resume",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(f.runId, {
            purpose: "browser_test",
            browserTestContextId: contextId,
            startMode: "framed",
            agentExecutionVersion: 3,
            fixedFramingRevisionId: frameId,
        });
        await ctx.db.patch(f.missionId, {
            provenance,
            modelRevisionId: model.currentRevisionId,
        });
        await ctx.db.patch(contextId, {
            paidQualification: {
                runId: f.runId,
                modelRevisionId: model.currentRevisionId,
                maximumRequests: 40,
                maximumCostUsd: 2,
                authorizedAt: Date.now(),
                sourcesLot: [f.runId],
            },
        });
    });
    const before = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    const client = f.t.withIdentity({ subject: f.userId });
    await client.mutation(api.execution.researchControl.pause, {
        runId: f.runId,
        expectedGeneration: 4,
    });
    const paused = await f.t.mutation(
        internal.execution.researchControl.checkpoint,
        {
            runId: f.runId,
            preparationId: f.preparationId,
        },
    );
    expect(paused).toMatchObject({ waiting: true, generation: 5 });
    const generation = await client.mutation(
        api.execution.researchControl.resume,
        {
            runId: f.runId,
            expectedGeneration: paused.generation,
        },
    );
    expect(generation).toBe(6);
    await f.t.mutation(internal.execution.researchControl.resumeMissions, {
        runId: f.runId,
        generation,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        provenance,
        generation,
        status: "ready",
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).not.toHaveProperty(
        "blockCode",
    );
    const after = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(after?.sourcesMission).toEqual(before?.sourcesMission);
    expect(after?.deadlineAt).toBe(before?.deadlineAt);
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});

test("a recoverable research worker interruption releases its slot and supports public Resume", async () => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const frameId = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Fixed workflow", questions: [] },
            requestKey: "fixed",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            fixedFramingRevisionId: frameId,
        });
        await ctx.db.patch(f.missionId, { piActiveWriter: "recovery-writer" });
    });
    await f.t.mutation(internal.execution.piStore.claim, {
        missionId: f.missionId,
        expectedGeneration: 4,
        writer: "recovery-writer",
    });
    const before = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    await f.t.mutation(internal.execution.piControl.closeWorker, {
        missionId: f.missionId,
        expectedGeneration: 4,
        writer: "recovery-writer",
        error: "execution_interrupted",
    });
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    expect(run).toMatchObject({
        executionStatus: "paused",
        pauseReason: "execution_interrupted",
        executionGeneration: 5,
    });
    assert(run);
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "blocked",
        blockCode: "execution_interrupted",
    });
    const generation = await f.t
        .withIdentity({ subject: f.userId })
        .mutation(api.execution.researchControl.resume, {
            runId: f.runId,
            expectedGeneration: run.executionGeneration,
        });
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: generation,
    });
    await f.t.mutation(internal.execution.piControl.rebind, {
        missionId: f.missionId,
        expectedGeneration: generation,
        stage: 0,
        cursor: null,
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "running",
        executionGeneration: generation,
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "ready",
        generation,
    });
    const after = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(after?.sourcesMission).toEqual(before?.sourcesMission);
    expect(after?.deadlineAt).toBe(before?.deadlineAt);
});
