import { internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import { seedConversation } from "@/__tests__/setup/agent-harness";
import {
    seedInspectedEvidence,
    seedSourcePreparation,
} from "@/__tests__/setup/source-preparation";

test("native dossier consultation uses the persisted dispatcher without creating a mission or claiming research", async () => {
    const f = await seedSourcePreparation();
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            executionStatus: "idle",
            lifecycleState: "draft",
        }),
    );
    const input = {
        runId: f.runId,
        expectedGeneration: 3,
        cause: "system-inspection",
        input: { kind: "consult_run_state" as const },
    };
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        input,
    );
    const outcome = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 3,
    });
    expect(outcome.kind).toBe("success");
    if (outcome.kind !== "success") throw new Error("Expected state");
    expect(JSON.parse(outcome.valueJson)).toMatchObject({
        lifecycleState: "draft",
        executionStatus: "idle",
    });
    expect(
        await f.t.mutation(internal.execution.operations.enqueueNative, input),
    ).toBe(requestId);
    const request = await f.t.run((ctx) => ctx.db.get(requestId));
    expect(request).toMatchObject({
        actor: "system",
        status: "completed",
        runId: f.runId,
    });
    expect(request).not.toHaveProperty("missionId");
    expect(
        await f.t.run((ctx) => ctx.db.query("agentMissions").collect()),
    ).toEqual([]);
    const refusedId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        { ...input, input: { kind: "check_fixture_value", index: 0 } },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: refusedId,
            expectedGeneration: 3,
        }),
    ).toMatchObject({ kind: "refused", code: "operation_not_allowed" });
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("agentExecutionEvents")
                .withIndex("by_run", (q) => q.eq("runId", f.runId))
                .collect(),
        ),
    ).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                kind: "operation_refused",
                requestId: refusedId,
            }),
        ]),
    );
});

test("reused operations keep the new caller's causal reference", async () => {
    const f = await seedSourcePreparation();
    const input = {
        runId: f.runId,
        expectedGeneration: 3,
        cause: "first-native-action",
        input: { kind: "consult_run_state" as const },
    };
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        input,
    );
    await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 3,
    });
    expect(
        await f.t.mutation(internal.execution.operations.enqueueNative, {
            ...input,
            cause: "second-native-action",
        }),
    ).toBe(requestId);
    const events = await f.t.run((ctx) =>
        ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .collect(),
    );
    expect(
        events.find((event) => event.kind === "operation_reused"),
    ).toMatchObject({ cause: "second-native-action" });
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

test("confirmed native results survive an authorized generation resume without another dispatch", async () => {
    vi.useFakeTimers();
    const { t, args, sourceId } = await seedInspectedEvidence();
    const workflowTest = (
        await import("@/__tests__/convex/workflows/workflow-test-register.js")
    ).default;
    workflowTest.register(t);
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "retained-native-result",
        expectedGeneration: 4,
    });
    const input = {
        kind: "read_in_context" as const,
        sourceId,
        passageOrder: 0,
    };
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 4,
        cause: "initial",
        input,
    });
    const initial = await t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 4,
    });
    expect(initial.kind).toBe("success");
    await t.run((ctx) => ctx.db.patch(args.runId, { executionGeneration: 5 }));
    await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 5,
    });
    expect(
        await t.mutation(internal.execution.operations.enqueue, {
            missionId,
            expectedGeneration: 5,
            cause: "resumed",
            input,
        }),
    ).toBe(requestId);
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 5,
        }),
    ).toEqual(initial);
    expect(
        await t.mutation(internal.execution.operations.recordResult, {
            requestId,
            expectedGeneration: 5,
            outcome: initial,
        }),
    ).toEqual(initial);
    const events = await t.run((ctx) =>
        ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_sequence", (q) =>
                q.eq("missionId", missionId),
            )
            .collect(),
    );
    expect(
        events.filter((event) => event.kind === "operation_dispatched"),
    ).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        expectedGeneration: 4,
        status: "completed",
        outcome: initial,
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "refused", code: "stale_execution" });
}, 30_000);
test("a registered domain operation runs natively through its same policy and retained result without a mission", async () => {
    vi.useFakeTimers();
    const f = await seedConversation(true);
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 3,
            cause: "native-domain-service",
            input: { kind: "wait_fixture_result", value: 7 },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 3,
        }),
    ).toMatchObject({ kind: "waiting" });
    await f.t.mutation(
        internal.domain.conversationValidation.completeDeferred,
        { requestId, expectedGeneration: 3 },
    );
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "completed",
        outcome: { kind: "success", valueJson: '{"value":14}' },
    });
    expect(
        await f.t.run((ctx) => ctx.db.query("agentMissions").collect()),
    ).toEqual([]);
    const denied = await seedSourcePreparation();
    const deniedId = await denied.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: denied.runId,
            expectedGeneration: 3,
            cause: "fixture-denied",
            input: { kind: "wait_fixture_result", value: 7 },
        },
    );
    expect(await denied.t.run((ctx) => ctx.db.get(deniedId))).toMatchObject({
        status: "completed",
        outcome: { kind: "refused", code: "simulation_not_authorized" },
    });
});

test("a native deferred operation expires without requiring an artificial durable mission", async () => {
    vi.useFakeTimers();
    const f = await seedConversation(true);
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 3,
            cause: "native-deadline",
            input: { kind: "wait_fixture_result", value: 7 },
        },
    );
    await f.t.run((ctx) =>
        ctx.db.patch(requestId, { deadlineAt: Date.now() + 10 }),
    );
    await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 3,
    });
    await vi.advanceTimersByTimeAsync(20);
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        100,
    );
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "unknown",
    });
    await f.t.mutation(
        internal.domain.conversationValidation.completeDeferred,
        { requestId, expectedGeneration: 3 },
    );
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "observed",
        outcome: { kind: "success" },
    });
    expect(
        await f.t.run((ctx) => ctx.db.query("agentMissions").collect()),
    ).toEqual([]);
});
