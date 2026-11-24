import { api, internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import { seedConversation } from "@/__tests__/setup/agent-harness";

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

async function mission() {
    const f = await seedConversation(true);
    const messageId = await f.client.mutation(
        (await import("@convex/_generated/api")).api.execution.conversations
            .submit,
        {
            runId: f.runId,
            requestKey: "defer",
            text: "Compute through a deterministic operation",
            delivery: "queue",
        },
    );
    const turnId = await f.t.mutation(
        internal.execution.conversations.claimTurn,
        { runId: f.runId },
    );
    if (!turnId) throw new Error("Expected active turn");
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        definitionId: "conversation_validation_v1",
        scope: { kind: "conversation_validation_v1" },
        conversationTurnId: turnId,
        requestKey: "deferred",
        expectedGeneration: 1,
    });
    return { ...f, missionId, messageId };
}

test.each([
    false,
    true,
])("native reuse keeps its own actor, instruction and continuation without repeating an agent effect (Steer=%s)", async (steer) => {
    const f = await mission();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 1,
        taskKey: "original-agent-use",
        provenance: "simulation",
    });
    if (begun.kind !== "ready") throw new Error("Expected initial invocation");
    const returned = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
        response: {
            kind: "operations",
            requests: [
                {
                    callId: "original-tool",
                    name: "wait_fixture_result",
                    inputJson: '{"value":7}',
                },
            ],
        },
    });
    const requestId = returned.requestIds[0];
    if (!requestId) throw new Error("Expected tool request");
    await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    await f.t.mutation(
        internal.domain.conversationValidation.completeDeferred,
        { requestId, expectedGeneration: 1 },
    );
    await f.t.mutation(internal.execution.invocations.settle, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
    });
    let messageId = f.messageId;
    const originalText = steer
        ? "Use the retained result for this narrower question"
        : "Compute through a deterministic operation";
    if (steer) {
        const conversation = await f.client.query(
            api.execution.conversations.get,
            { runId: f.runId },
        );
        if (!conversation.activeTurn) throw new Error("Expected active turn");
        messageId = await f.client.mutation(
            api.execution.conversations.submit,
            {
                runId: f.runId,
                requestKey: "reuse-steer",
                text: originalText,
                delivery: "steer",
                turnId: conversation.activeTurn._id,
            },
        );
    }
    expect(
        await f.t.mutation(internal.execution.operations.enqueue, {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "current-native-use",
            input: { kind: "wait_fixture_result", value: 7 },
            sourceMessageId: messageId,
            interpretedNeed: "Explain the confirmed result for this request",
        }),
    ).toBe(requestId);
    const events = await f.t.run((ctx) =>
        ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_sequence", (q) =>
                q.eq("missionId", f.missionId),
            )
            .collect(),
    );
    expect(
        events.find(
            (event) =>
                event.kind === "operation_reused" &&
                event.cause === "current-native-use",
        ),
    ).toMatchObject({
        actor: { type: "system" },
        messageId,
        interpretedNeed: "Explain the confirmed result for this request",
    });
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toEqual({ kind: "success", valueJson: '{"value":14}' });
    const continued = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 1,
        taskKey: "current-use-context",
        provenance: "simulation",
    });
    if (continued.kind !== "ready") throw new Error("Expected continuation");
    const uses = JSON.parse(continued.inputJson).triggeringRequestsAndResults;
    expect(uses).toHaveLength(2);
    expect(uses).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                requestId,
                analystInstruction: {
                    messageId,
                    originalText,
                    interpretedNeed:
                        "Explain the confirmed result for this request",
                },
            }),
        ]),
    );
    expect(
        events.filter((event) => event.kind === "operation_dispatched"),
    ).toHaveLength(1);
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        actor: "agent",
        expectedGeneration: 1,
        instructionVersion: 1,
    });
}, 30_000);

test("agent reuse of native work does not inherit the original caller's instruction association", async () => {
    const f = await mission();
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "original-native-use",
            input: { kind: "wait_fixture_result", value: 7 },
            sourceMessageId: f.messageId,
            interpretedNeed: "Initial system interpretation",
        },
    );
    await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    await f.t.mutation(
        internal.domain.conversationValidation.completeDeferred,
        { requestId, expectedGeneration: 1 },
    );
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 1,
        taskKey: "agent-reuses-native",
        provenance: "simulation",
    });
    if (begun.kind !== "ready") throw new Error("Expected invocation");
    const returned = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
        response: {
            kind: "operations",
            requests: [
                {
                    callId: "agent-reuse",
                    name: "wait_fixture_result",
                    inputJson: '{"value":7}',
                },
            ],
        },
    });
    expect(returned.requestIds).toEqual([requestId]);
    await f.t.mutation(internal.execution.invocations.settle, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
    });
    const next = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 1,
        taskKey: "after-agent-reuse",
        provenance: "simulation",
    });
    if (next.kind !== "ready") throw new Error("Expected continuation");
    const uses = JSON.parse(next.inputJson).triggeringRequestsAndResults;
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatchObject({
        requestId,
        callId: "agent-reuse",
        outcome: { kind: "success" },
        historyReference: expect.any(String),
    });
    expect(uses[0]).not.toHaveProperty("analystInstruction");
    const events = await f.t.run((ctx) =>
        ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_sequence", (q) =>
                q.eq("missionId", f.missionId),
            )
            .collect(),
    );
    expect(
        events.find(
            (event) =>
                event.kind === "operation_reused" &&
                event.cause === "agent-reuse",
        ),
    ).toMatchObject({
        actor: { type: "agent", missionId: f.missionId },
        invocationId: begun.invocationId,
    });
    expect(
        events.filter((event) => event.kind === "operation_dispatched"),
    ).toHaveLength(1);
}, 30_000);

test("a fresh instruction can admit known undispatched work once while retaining the earlier refusal", async () => {
    const f = await mission();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 1,
        taskKey: "before-rejected-dispatch",
        provenance: "simulation",
    });
    if (begun.kind !== "ready") throw new Error("Expected invocation");
    const returned = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
        response: {
            kind: "operations",
            requests: [
                {
                    callId: "old-request",
                    name: "wait_fixture_result",
                    inputJson: '{"value":7}',
                },
            ],
        },
    });
    const requestId = returned.requestIds[0];
    if (!requestId) throw new Error("Expected operation");
    const turn = await f.client.query(api.execution.conversations.get, {
        runId: f.runId,
    });
    if (!turn.activeTurn) throw new Error("Expected turn");
    const messageId = await f.client.mutation(
        api.execution.conversations.submit,
        {
            runId: f.runId,
            requestKey: "before-dispatch-steer",
            text: "Use this deterministic operation for the current request",
            delivery: "steer",
            turnId: turn.activeTurn._id,
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toEqual({ kind: "refused", code: "stale_instructions" });
    const current = {
        missionId: f.missionId,
        expectedGeneration: 1,
        cause: "current-authorized-request",
        input: { kind: "wait_fixture_result" as const, value: 7 },
        sourceMessageId: messageId,
        interpretedNeed: "Run only the current deterministic request",
    };
    expect(
        await f.t.mutation(internal.execution.operations.enqueue, current),
    ).toBe(requestId);
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "waiting" });
    await f.t.mutation(
        internal.domain.conversationValidation.completeDeferred,
        { requestId, expectedGeneration: 1 },
    );
    expect(
        await f.t.mutation(internal.execution.operations.enqueue, current),
    ).toBe(requestId);
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toEqual({ kind: "success", valueJson: '{"value":14}' });
    const events = await f.t.run((ctx) =>
        ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_sequence", (q) =>
                q.eq("missionId", f.missionId),
            )
            .collect(),
    );
    expect(
        events.filter((event) => event.kind === "operation_dispatched"),
    ).toEqual([
        expect.objectContaining({
            actor: { type: "system" },
            cause: current.cause,
            messageId,
        }),
    ]);
    expect(
        events.find((event) => event.kind === "dispatch_refused"),
    ).toMatchObject({
        actor: { type: "agent", missionId: f.missionId },
        admissionOutcome: { kind: "refused", code: "stale_instructions" },
    });
}, 30_000);

test("deferred operations retain their outcome before continuation and duplicate completion adds no progress", async () => {
    const f = await mission();
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "deterministic-service",
            input: { kind: "wait_fixture_result", value: 7 },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "waiting" });
    expect(
        await f.t.mutation(internal.execution.invocations.begin, {
            missionId: f.missionId,
            expectedGeneration: 1,
            taskKey: "too-early",
            provenance: "simulation",
        }),
    ).toEqual({ kind: "blocked", code: "pending_operations" });
    const completed = {
        requestId,
        expectedGeneration: 1,
        outcome: { kind: "success" as const, valueJson: '{"value":14}' },
    };
    expect(
        await f.t.mutation(
            internal.execution.operations.recordResult,
            completed,
        ),
    ).toEqual(completed.outcome);
    expect(
        await f.t.mutation(
            internal.execution.operations.recordResult,
            completed,
        ),
    ).toEqual(completed.outcome);
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 1,
        taskKey: "returned",
        provenance: "simulation",
    });
    if (begun.kind !== "ready") throw new Error("Expected continuation");
    expect(JSON.parse(begun.inputJson)).toMatchObject({
        triggeringRequestsAndResults: [
            {
                requestId,
                outcome: { kind: "success" },
                historyReference: expect.any(String),
            },
        ],
    });
    await expect(
        f.t.mutation(internal.execution.operations.recordResult, {
            ...completed,
            outcome: { kind: "success", valueJson: '{"value":15}' },
        }),
    ).rejects.toThrow("operation_result_conflict");
});

test("a business request starts a bounded Pi child and resumes with a result reference", async () => {
    vi.useFakeTimers();
    const f = await mission();
    const workflowTest = (
        await import("@/__tests__/convex/workflows/workflow-test-register.js")
    ).default;
    workflowTest.register(f.t);
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { executionStatus: "running" }),
    );
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: 1,
        simulation: true,
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "authorized-child",
            input: { kind: "request_fixture_validation", values: [3, 7] },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "waiting" });
    const waiting = await f.t.run((ctx) => ctx.db.get(requestId));
    const childId = waiting?.childMissionId;
    if (!childId) throw new Error("Expected child mission");
    const childWake = await f.t.run((ctx) => ctx.db.get(childId));
    if (!childWake?.piWakeToken) throw new Error("Expected child worker wake");
    await f.t.action(internal.execution.piWorker.run, {
        missionId: childId,
        expectedGeneration: childWake.generation,
        token: childWake.piWakeToken,
    });
    const request = await f.t.run((ctx) => ctx.db.get(requestId));
    expect(request).toMatchObject({
        status: "completed",
        outcome: { kind: "success" },
    });
    const child = await f.t.run((ctx) => ctx.db.get(childId));
    expect(child).toMatchObject({
        status: "completed",
        result: { kind: "execution_validation_v1", total: 10 },
    });
    const next = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 1,
        cause: "another-child",
        input: { kind: "request_fixture_validation", values: [9] },
    });
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: next,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "refused", code: "mission_return_limit" });
    expect(await f.t.run((ctx) => ctx.db.get(next))).toMatchObject({
        status: "completed",
        outcome: { kind: "refused", code: "mission_return_limit" },
    });
}, 30_000);

test("an explicit research pause retains an engaged operation while the conversation stays authorized", async () => {
    const f = await mission();
    const { api } = await import("@convex/_generated/api");
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            executionStatus: "running",
            agentExecutionVersion: 3,
        }),
    );
    const researchId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        definitionId: "execution_validation_v1",
        scope: { kind: "execution_validation_v1", values: [7] },
        requestKey: "research",
        expectedGeneration: 3,
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: researchId,
            expectedGeneration: 3,
            cause: "before-pause",
            input: { kind: "check_fixture_value", index: 0 },
        },
    );
    await f.t.mutation(internal.execution.operations.claim, {
        requestId,
        expectedGeneration: 3,
    });
    expect(
        await f.client.mutation(api.execution.researchControl.pause, {
            runId: f.runId,
            expectedGeneration: 3,
        }),
    ).toBe(4);
    expect(
        await f.client.query(api.evidenceMatrix.getSummary, { runId: f.runId }),
    ).toMatchObject({ pauseReason: "analyst" });
    expect(
        await f.t.mutation(internal.execution.operations.recordResult, {
            requestId,
            expectedGeneration: 3,
            outcome: {
                kind: "success",
                valueJson: '{"index":0,"value":7}',
                progressKey: "checked:0",
            },
        }),
    ).toMatchObject({ kind: "refused" });
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "observed",
        outcome: { kind: "success" },
    });
    expect(await f.t.run((ctx) => ctx.db.get(researchId))).toMatchObject({
        state: { checkedIndices: [] },
    });
    expect(
        await f.t.mutation(internal.execution.invocations.begin, {
            missionId: f.missionId,
            expectedGeneration: 1,
            taskKey: "conversation-during-pause",
            provenance: "simulation",
        }),
    ).toMatchObject({ kind: "ready" });
});

test.each([
    false,
    true,
])("Pi continuation consumes a retained deferred result (completed before wait: %s)", async (early) => {
    vi.useFakeTimers();
    const f = await mission();
    const workflowTest = (
        await import("@/__tests__/convex/workflows/workflow-test-register.js")
    ).default;
    workflowTest.register(f.t);
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "wait-event",
            input: { kind: "wait_fixture_result", value: 7 },
        },
    );
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: 1,
        simulation: true,
    });
    if (early)
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        });
    else {
        for (let i = 0; i < 100; i++) {
            if (
                (await f.t.run((ctx) => ctx.db.get(requestId)))?.status ===
                "waiting"
            )
                break;
            await vi.advanceTimersByTimeAsync(10);
            await f.t.finishInProgressScheduledFunctions();
        }
    }
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "waiting",
    });
    await f.t.mutation(
        internal.domain.conversationValidation.completeDeferred,
        { requestId, expectedGeneration: 1 },
    );
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "completed",
    });
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
}, 30_000);

test("an unanswered operation expires explicitly and a late observation cannot revive its mission", async () => {
    vi.useFakeTimers();
    const f = await mission();
    await f.t.run((ctx) =>
        ctx.db.patch(f.missionId, { deadlineAt: Date.now() + 10 }),
    );
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "deadline",
            input: { kind: "wait_fixture_result", value: 7 },
        },
    );
    await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    await vi.advanceTimersByTimeAsync(20);
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        100,
    );
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "unknown",
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "blocked",
        blockCode: "operation_outcome_unknown",
    });
    await f.t.mutation(
        internal.domain.conversationValidation.completeDeferred,
        { requestId, expectedGeneration: 1 },
    );
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "observed",
        outcome: { kind: "success", valueJson: '{"value":14}' },
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "blocked",
    });
});

test("explicit resume reclaims the research slot and adopts retained work without resetting consumption", async () => {
    vi.useFakeTimers();
    const f = await mission();
    const { api } = await import("@convex/_generated/api");
    const workflowTest = (
        await import("@/__tests__/convex/workflows/workflow-test-register.js")
    ).default;
    workflowTest.register(f.t);
    const budget = {
        version: 1 as const,
        work: 5,
        incidents: 1,
        reserved: 2,
        dispatches: 8,
    };
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            executionStatus: "running",
            agentExecutionVersion: 3,
            sourcePreparationBudget: budget,
        }),
    );
    const researchId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        definitionId: "execution_validation_v1",
        scope: { kind: "execution_validation_v1", values: [7] },
        requestKey: "resume-research",
        expectedGeneration: 3,
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: researchId,
            expectedGeneration: 3,
            cause: "engaged",
            input: { kind: "check_fixture_value", index: 0 },
        },
    );
    await f.t.mutation(internal.execution.operations.claim, {
        requestId,
        expectedGeneration: 3,
    });
    await f.client.mutation(api.execution.researchControl.pause, {
        runId: f.runId,
        expectedGeneration: 3,
    });
    await f.t.mutation(internal.execution.operations.recordResult, {
        requestId,
        expectedGeneration: 3,
        outcome: {
            kind: "success",
            valueJson: '{"index":0,"value":7}',
            progressKey: "checked:0",
        },
    });
    expect(
        await f.client.mutation(api.execution.researchControl.resume, {
            runId: f.runId,
            expectedGeneration: 4,
        }),
    ).toBe(5);
    expect(
        await f.client.mutation(api.execution.researchControl.resume, {
            runId: f.runId,
            expectedGeneration: 4,
        }),
    ).toBe(5);
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(await f.t.run((ctx) => ctx.db.get(researchId))).toMatchObject({
        generation: 5,
        status: "completed",
        state: { checkedIndices: [0] },
        result: { total: 7 },
    });
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        expectedGeneration: 3,
        adoptionGeneration: 5,
        status: "completed",
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        sourcePreparationBudget: budget,
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        generation: 1,
        status: "ready",
    });
}, 30_000);

test("invalid delegated scope is a retained refusal with no child or renewed allowance", async () => {
    const f = await mission();
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { executionStatus: "running" }),
    );
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "invalid-delegation",
            input: {
                kind: "request_fixture_validation",
                values: [1, 2, 3, 4, 5, 6, 7, 8, 9],
            },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "refused", code: "validation_scope_invalid" });
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "completed",
        outcome: { kind: "refused" },
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).not.toHaveProperty(
        "childMissionRequests",
    );
});

test("delegation cannot take over an unfinished mission assigned to another business request", async () => {
    vi.useFakeTimers();
    const f = await mission();
    const workflowTest = (
        await import("@/__tests__/convex/workflows/workflow-test-register.js")
    ).default;
    workflowTest.register(f.t);
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { executionStatus: "running" }),
    );
    const existing = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        definitionId: "execution_validation_v1",
        scope: { kind: "execution_validation_v1", values: [3, 7] },
        requestKey: "other-business-work",
        expectedGeneration: 3,
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "cannot-reassign",
            input: { kind: "request_fixture_validation", values: [3, 7] },
        },
    );
    const outcome = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(outcome).toMatchObject({
        kind: "refused",
        code: "mission_already_assigned",
    });
    expect(await f.t.run((ctx) => ctx.db.get(existing))).not.toHaveProperty(
        "parentRequestId",
    );
}, 30_000);

test("continuation includes native results and original instructions even after a model tool batch", async () => {
    const f = await mission();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 1,
        taskKey: "agent-batch",
        provenance: "simulation",
    });
    if (begun.kind !== "ready") throw new Error("Expected invocation");
    const returned = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
        response: {
            kind: "operations",
            requests: [
                {
                    callId: "consult",
                    name: "consult_run_state",
                    inputJson: "{}",
                },
            ],
        },
    });
    const agentRequestId = returned.requestIds[0];
    if (!agentRequestId) throw new Error("Expected tool request");
    await f.t.action(internal.execution.operations.dispatch, {
        requestId: agentRequestId,
        expectedGeneration: 1,
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            sourceMessageId: f.messageId,
            interpretedNeed: "Return the deterministic result",
            cause: "system-return",
            input: { kind: "wait_fixture_result", value: 7 },
        },
    );
    await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    await f.t.mutation(
        internal.domain.conversationValidation.completeDeferred,
        { requestId, expectedGeneration: 1 },
    );
    await f.t.mutation(internal.execution.invocations.settle, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
    });
    const continued = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 1,
        taskKey: "after-native-return",
        provenance: "simulation",
    });
    if (continued.kind !== "ready") throw new Error("Expected continuation");
    expect(
        JSON.parse(continued.inputJson).triggeringRequestsAndResults,
    ).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                requestId,
                outcome: { kind: "success" },
                historyReference: expect.any(String),
                analystInstruction: {
                    messageId: f.messageId,
                    originalText: "Compute through a deterministic operation",
                    interpretedNeed: "Return the deterministic result",
                },
            }),
        ]),
    );
});
