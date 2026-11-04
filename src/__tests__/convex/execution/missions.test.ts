import { internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

test("an active authorized run retains one mission for repeated start requests", async () => {
    const { t, args, visitorId } = await seedInspectedEvidence();
    const input = {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1" as const,
        requestKey: "inspect-retained-evidence",
        expectedGeneration: args.executionGeneration,
    };
    const id = await t.mutation(internal.execution.missions.start, input);
    expect(await t.mutation(internal.execution.missions.start, input)).toBe(id);
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
        ownerVisitorId: visitorId,
        generation: 4,
        status: "ready",
        noProgressTurns: 0,
    });
    await t.run((ctx) => ctx.db.patch(visitorId, { status: "revoked" }));
    await expect(
        t.mutation(internal.execution.missions.start, input),
    ).rejects.toThrow("not_authorized");
});

test("mission creation cannot cross an unapproved corpus or an inactive generation", async () => {
    const { t, args } = await seedInspectedEvidence();
    const input = {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1" as const,
        requestKey: "inspect-retained-evidence",
        expectedGeneration: args.executionGeneration,
    };
    await expect(
        t.mutation(internal.execution.missions.start, {
            ...input,
            expectedGeneration: 3,
        }),
    ).rejects.toThrow("stale_execution");
    await t.run((ctx) =>
        ctx.db.patch(args.corpusRevisionId, { status: "draft" }),
    );
    await expect(
        t.mutation(internal.execution.missions.start, input),
    ).rejects.toThrow("corpus_not_approved");
});

import { workflow } from "@convex/workflow";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";

afterEach(() => vi.useRealTimers());

test("terminal notifications survive an analyst pause, and are sent once without resuming research", async () => {
    vi.useFakeTimers();
    const f = await seedInspectedEvidence();
    workflowTest.register(f.t);
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        corpusRevisionId: f.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "notify-pause",
        expectedGeneration: 4,
    });
    await f.t.run(async (ctx) => {
        const workflowId = await workflow.start(
            ctx,
            internal.researchWorkflow.run,
            { runId: f.runId, executionGeneration: 4 },
        );
        const eventId = await workflow.createEvent(ctx, {
            name: "terminal",
            workflowId,
        });
        await ctx.db.patch(missionId, {
            status: "completed",
            completionEventId: eventId,
        });
        await ctx.db.patch(f.runId, {
            executionStatus: "paused",
            pauseReason: "analyst",
            executionGeneration: 5,
        });
    });
    await f.t.mutation(internal.execution.handoffs.finishChild, { missionId });
    expect(await f.t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        completionNotified: true,
    });
    await f.t.mutation(internal.execution.handoffs.finishChild, { missionId });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "paused",
        executionGeneration: 5,
    });
});
