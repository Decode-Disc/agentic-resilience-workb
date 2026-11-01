import { internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";
import workflowTest from "./workflow-test-register.js";

afterEach(() => vi.useRealTimers());

test("a superseded research workflow cannot acquire the current generation at a pause checkpoint", async () => {
    vi.useFakeTimers();
    const { t, runId } = await seedSourcePreparation();
    workflowTest.register(t);
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            workflowId: "current-workflow",
            researchPauseRequested: true,
        }),
    );
    await expect(
        t.mutation(internal.execution.researchControl.checkpoint, {
            runId,
            workflowId: "superseded-workflow",
        }),
    ).rejects.toThrow("stale_execution");
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "running",
        executionGeneration: 3,
        researchPauseRequested: true,
    });
});

test("a documentary workflow cannot replace another active preparation handle", async () => {
    vi.useFakeTimers();
    const { t, runId, corpusRevisionId } = await seedSourcePreparation();
    workflowTest.register(t);
    await t.run((ctx) =>
        ctx.db.patch(runId, { startMode: "framed", agentExecutionVersion: 3 }),
    );
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    await t.run((ctx) =>
        ctx.db.patch(preparationId, { workflowId: "current-preparation" }),
    );
    await expect(
        t.mutation(internal.execution.researchControl.checkpoint, {
            runId,
            preparationId,
            workflowId: "superseded-preparation",
        }),
    ).rejects.toThrow("stale_execution");
    expect(await t.run((ctx) => ctx.db.get(preparationId))).toMatchObject({
        workflowId: "current-preparation",
    });
});
