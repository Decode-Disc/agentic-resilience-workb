import { internal } from "@convex/_generated/api";
import schema from "@convex/schema";
import type { EventId } from "@convex-dev/workflow";
import { anyApi, type ApiFromModules } from "convex/server";
import { v } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, assert, expect, test, vi } from "vitest";
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
        resourcePolicy: "authority_native_v1",
        generation: 4,
        status: "ready",
        noProgressTurns: 0,
    });
    await t.run((ctx) => ctx.db.patch(visitorId, { status: "revoked" }));
    await expect(
        t.mutation(internal.execution.missions.start, input),
    ).rejects.toThrow("not_authorized");
});

test.each([
    undefined,
    "unsupported_policy",
])("historical mission policy %s cannot admit another invocation or change accounting", async (resourcePolicy) => {
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "unsupported-resource-policy",
        expectedGeneration: args.executionGeneration,
    });
    await t.run((ctx) => ctx.db.patch(missionId, { resourcePolicy }));
    const before = await t.run((ctx) => ctx.db.get(missionId));
    await expect(
        t.mutation(internal.execution.invocations.begin, {
            missionId,
            expectedGeneration: args.executionGeneration,
            taskKey: "must-not-dispatch",
            provenance: "simulation",
        }),
    ).rejects.toThrow("resource_policy_unsupported");
    expect(await t.run((ctx) => ctx.db.get(missionId))).toEqual(before);
    expect(
        await t.run((ctx) => ctx.db.query("agentInvocations").collect()),
    ).toEqual([]);
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
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
    const terminal = v.object({ missionId: v.id("agentMissions") });
    const consumer = workflow.define({
        args: {},
        returns: terminal,
        handler: (step) =>
            step.awaitEvent({ name: "terminal", validator: terminal }),
    });
    const consumerRef = anyApi.terminalConsumer?.run as ApiFromModules<{
        terminalConsumer: { run: typeof consumer };
    }>["terminalConsumer"]["run"];
    const t = convexTest(schema, {
        ...import.meta.glob("/convex/**/*.ts"),
        "/convex/terminalConsumer.ts": async () => ({ run: consumer }),
    });
    const f = await seedInspectedEvidence({}, t);
    workflowTest.register(f.t);
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        corpusRevisionId: f.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "notify-pause",
        expectedGeneration: 4,
    });
    const workflowId = await f.t.run(async (ctx) => {
        const id = await workflow.start(ctx, consumerRef, {});
        const waiting = await workflow.status(ctx, id);
        assert(waiting.type === "inProgress");
        expect(waiting.running).toHaveLength(1);
        const event = waiting.running[0];
        assert(event?.kind === "event" && event.eventId);
        await ctx.db.patch(missionId, {
            status: "completed",
            completionEventId: event.eventId as EventId,
        });
        await ctx.db.patch(f.runId, {
            executionStatus: "paused",
            pauseReason: "analyst",
            executionGeneration: 5,
        });
        return id;
    });
    await f.t.mutation(internal.execution.handoffs.finishChild, { missionId });
    expect(await f.t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        completionNotified: true,
    });
    await f.t.mutation(internal.execution.handoffs.finishChild, { missionId });
    await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await f.t.run((ctx) => workflow.status(ctx, workflowId))).toEqual({
        type: "completed",
        result: { missionId },
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "paused",
        executionGeneration: 5,
    });
});
