import { writeFileSync } from "node:fs";
import { internal } from "@convex/_generated/api";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test("current Sources 7 exposes running work beside an inapplicable human-prerequisite action", async () => {
    vi.stubGlobal("fetch", () => { throw new Error("No network in research probe"); });
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const framingId = await ctx.db.insert("framingRevisions", { runId: f.runId, revision: 1, content: { scope: "Workflow", questions: [] }, requestKey: "sources-efficiency-research", contentHash: "fixture", origin: "analyst", createdAt: 1 });
        await ctx.db.patch(f.missionId, { definitionVersion: 7 });
        await ctx.db.patch(f.runId, { startMode: "framed", fixedFramingRevisionId: framingId, agentExecutionVersion: 3, executionStatus: "running" });
    });
    const context = () => f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        const mission = await ctx.db.get(f.missionId);
        assert(run && mission);
        return getAgentDefinition("sources_v1", 7).context(ctx, mission, run);
    });
    const consult = async () => {
        const requestId = await f.t.mutation(internal.execution.operations.enqueue, {
            missionId: f.missionId, expectedGeneration: 4,
            cause: "sources-efficiency-research", input: { kind: "consult_run_state" },
        });
        const outcome = await f.t.action(internal.execution.operations.dispatch, { requestId, expectedGeneration: 4 });
        assert(outcome.kind === "success");
        return { requestId, value: JSON.parse(outcome.valueJson) };
    };
    const before = await context();
    assert(before.kind === "ready");
    const first = await consult();
    expect(first.value.research).toMatchObject({
        status: "running",
        actions: { continuePreparation: { applicable: false, reason: "human_prerequisite_required" } },
        sources: { retainedDocuments: [], executionStop: null }, nextCapability: null,
    });
    expect(before.context.activeWork).toMatchObject({ captureIds: [f.captureId], candidates: expect.arrayContaining([expect.objectContaining({ sourceId: f.sourceId })]) });
    await f.t.run((ctx) => ctx.db.patch(f.sourceId, { title: "Changed current candidate metadata" }));
    const after = await context();
    assert(after.kind === "ready");
    expect(after.context.activeWork).not.toEqual(before.context.activeWork);
    const second = await consult();
    expect(second.requestId).toBe(first.requestId);
    expect(second.value).toEqual(first.value);
    writeFileSync(".agents/artifacts/sources-workflow-no-legacy/validation/sources-efficiency-research/state-probe.json", JSON.stringify({ definitionVersion: 7, research: first.value.research, currentCapturePresent: true, currentCandidateChangeVisible: true, unchangedDossierProjectionReusesRequest: true }, null, 2));
});
