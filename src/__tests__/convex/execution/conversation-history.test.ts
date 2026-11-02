import { api, internal } from "@convex/_generated/api";
import { executionError } from "@convex/execution/errors";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedConversation } from "@/__tests__/setup/agent-harness";

afterEach(() => vi.unstubAllEnvs());

test("common conversation reading retrieves prior published turns and excludes queued instructions", async () => {
    const f = await seedConversation(true);
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "prior",
        delivery: "queue",
        text: "Original prior question",
    });
    const turnId = await f.t.mutation(
        internal.execution.conversations.claimTurn,
        { runId: f.runId },
    );
    if (!turnId) throw new Error("Expected turn");
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        expectedGeneration: 1,
        conversationTurnId: turnId,
        definitionId: "conversation_validation_v1",
        scope: { kind: "conversation_validation_v1" },
        requestKey: "prior",
    });
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 1,
        taskKey: "reply",
        provenance: "simulation",
    });
    if (begun.kind !== "ready") throw new Error("Expected invocation");
    await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
        response: { kind: "complete", text: "Retained prior answer" },
    });
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "current",
        delivery: "queue",
        text: "Current question",
    });
    const nextTurn = await f.t.mutation(
        internal.execution.conversations.claimTurn,
        { runId: f.runId },
    );
    if (!nextTurn) throw new Error("Expected turn");
    const nextMission = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        expectedGeneration: 1,
        conversationTurnId: nextTurn,
        definitionId: "conversation_validation_v1",
        scope: { kind: "conversation_validation_v1" },
        requestKey: "current",
    });
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "queued",
        delivery: "queue",
        text: "DO NOT DELIVER YET",
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: nextMission,
            expectedGeneration: 1,
            cause: "earlier-turns",
            input: { kind: "consult_conversation" },
        },
    );
    const outcome = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    expect(outcome.kind).toBe("success");
    if (outcome.kind !== "success") throw new Error("Expected exact history");
    expect(outcome.valueJson).toContain("Original prior question");
    expect(outcome.valueJson).not.toContain("DO NOT DELIVER YET");
    expect(
        (await f.t.run((ctx) => ctx.db.get(nextMission)))?.progressKeys,
    ).toHaveLength(1);
    const page = JSON.parse(outcome.valueJson);
    assert(typeof page.continueCursor === "string");
    const inner = JSON.parse(page.continueCursor);
    assert(typeof inner.cursor === "string");
    const invalidId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: nextMission,
            expectedGeneration: 1,
            cause: "invalid-pagination",
            input: { kind: "consult_conversation", cursor: inner.cursor },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: invalidId,
            expectedGeneration: 1,
        }),
    ).toEqual({ kind: "refused", code: "history_cursor_invalid" });
    expect(await f.t.run((ctx) => ctx.db.get(invalidId))).toMatchObject({
        status: "completed",
        outcome: { kind: "refused", code: "history_cursor_invalid" },
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(nextMission)))?.progressKeys,
    ).toHaveLength(1);
    const correctedId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: nextMission,
            expectedGeneration: 1,
            cause: "corrected-pagination",
            input: {
                kind: "consult_conversation",
                cursor: page.continueCursor,
            },
        },
    );
    const corrected = await f.t.action(internal.execution.operations.dispatch, {
        requestId: correctedId,
        expectedGeneration: 1,
    });
    assert(corrected.kind === "success");
    expect(JSON.parse(corrected.valueJson).entries).toEqual([
        expect.objectContaining({
            role: "assistant",
            content: "Retained prior answer",
        }),
    ]);
    expect(
        (await f.t.run((ctx) => ctx.db.get(nextMission)))?.progressKeys,
    ).toHaveLength(2);
    const { commonOperations } = await import(
        "@convex/execution/commonOperations"
    );
    for (const error of [
        new Error("History backend unavailable"),
        executionError("not_authorized"),
    ]) {
        await expect(
            f.t.action((ctx) =>
                commonOperations.consult_conversation.execute(
                    {
                        ...ctx,
                        runQuery: async () => {
                            throw error;
                        },
                    },
                    {
                        requestId: correctedId,
                        missionId: nextMission,
                        expectedGeneration: 1,
                        input: { kind: "consult_conversation" },
                    },
                ),
            ),
        ).rejects.toThrow(error);
    }
    for (let index = 0; index < 3; index++) {
        const invocation = await f.t.mutation(
            internal.execution.invocations.begin,
            {
                missionId: nextMission,
                expectedGeneration: 1,
                taskKey: `repeat-history-${index}`,
                provenance: "simulation",
            },
        );
        assert(invocation.kind === "ready");
        const result = await f.t.mutation(
            internal.execution.invocations.finish,
            {
                invocationId: invocation.invocationId,
                expectedGeneration: 1,
                response: {
                    kind: "operations",
                    requests: [
                        {
                            callId: `repeat-${index}`,
                            name: "consult_conversation",
                            inputJson: "{}",
                        },
                    ],
                },
            },
        );
        assert(result.requestIds[0]);
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: result.requestIds[0],
            expectedGeneration: 1,
        });
        expect(
            (await f.t.run((ctx) => ctx.db.get(nextMission)))?.progressKeys,
        ).toHaveLength(2);
        expect(
            await f.t.mutation(internal.execution.invocationLifecycle.settle, {
                invocationId: invocation.invocationId,
                expectedGeneration: 1,
            }),
        ).toMatchObject(
            index < 2
                ? { kind: "ready" }
                : { kind: "blocked", code: "repetition_stop" },
        );
    }
});
