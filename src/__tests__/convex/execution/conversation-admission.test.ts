import { api, internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import { seedConversation } from "@/__tests__/setup/agent-harness";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

test.each([
    63800, 65456,
])("admission includes instructions and tool schemas before activating a near-limit message (%i)", async (secondLength) => {
    vi.useFakeTimers();
    const network = vi.fn(() => {
        throw new Error("Unexpected external I/O");
    });
    vi.stubGlobal("fetch", network);
    const f = await seedConversation(true);
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "first",
        delivery: "queue",
        text: "a".repeat(64000),
    });
    const secondId = await f.client.mutation(
        api.execution.conversations.submit,
        {
            runId: f.runId,
            requestKey: "second",
            delivery: "queue",
            text: "b".repeat(secondLength),
        },
    );
    const started = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "conversation_validation_v1",
            scope: { kind: "conversation_validation_v1" },
            simulation: true,
        },
    );
    if (!started) throw new Error("Expected active turn");
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const mission = await f.t.run((ctx) => ctx.db.get(started.missionId));
    expect(mission?.blockCode).toBeUndefined();
    expect(mission).toMatchObject({ status: "completed" });
    const second = await f.t.run((ctx) => ctx.db.get(secondId));
    if (secondLength === 65456)
        expect(second).toMatchObject({ status: "queued" });
    else expect(["queued", "processed"]).toContain(second?.status);
    expect(
        await f.client.query(api.execution.conversations.get, {
            runId: f.runId,
        }),
    ).toMatchObject({ queuedCount: second?.status === "queued" ? 1 : 0 });
    expect(network).not.toHaveBeenCalled();
}, 30000);

test("retrying turn admission preserves instructions explicitly queued for the next turn", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
        "fetch",
        vi.fn(() => {
            throw new Error("Unexpected external I/O");
        }),
    );
    const f = await seedConversation(true);
    const start = {
        runId: f.runId,
        definitionId: "conversation_validation_v1" as const,
        scope: { kind: "conversation_validation_v1" as const },
        simulation: true,
    };
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "first",
        delivery: "queue",
        text: "First instruction",
    });
    const first = await f.t.mutation(
        internal.execution.conversations.startTurn,
        start,
    );
    if (!first) throw new Error("Expected active turn");
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: first.missionId,
        expectedGeneration: 1,
        taskKey: "before-queued-message",
        provenance: "simulation",
    });
    if (begun.kind !== "ready") throw new Error("Expected invocation");
    const queuedId = await f.client.mutation(
        api.execution.conversations.submit,
        {
            runId: f.runId,
            requestKey: "later",
            delivery: "queue",
            text: "Only for the next turn",
        },
    );
    expect(
        await f.t.mutation(internal.execution.conversations.startTurn, start),
    ).toEqual(first);
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: begun.invocationId,
            expectedGeneration: 1,
            response: {
                kind: "complete",
                text: "Answer to the first instruction",
            },
        }),
    ).toMatchObject({ kind: "completed" });
    expect(await f.t.run((ctx) => ctx.db.get(queuedId))).toMatchObject({
        status: "queued",
    });
    expect(
        await f.client.query(api.execution.conversations.get, {
            runId: f.runId,
        }),
    ).toMatchObject({ queuedCount: 1 });
});

test("native Pi admits a multi-message lot above128KiB when its model context fits", async () => {
    vi.useFakeTimers();
    const f = await seedConversation(true);
    for (let index = 0; index < 7; index++)
        await f.client.mutation(api.execution.conversations.submit, {
            runId: f.runId,
            requestKey: `unicode-lot-${index}`,
            delivery: "queue",
            text: "界".repeat(6500),
        });
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "conversation_validation_v1",
            scope: { kind: "conversation_validation_v1" },
            simulation: true,
        },
    );
    if (!active) throw new Error("Expected native turn");
    const context = await f.t.query(internal.execution.context.build, {
        missionId: active.missionId,
        expectedGeneration: 1,
    });
    if (context.kind !== "ready") throw new Error(context.code);
    expect(Buffer.byteLength(context.inputJson)).toBeGreaterThan(128 * 1024);
    expect(
        JSON.parse(context.inputJson).conversationInstructions.messages,
    ).toHaveLength(7);
    expect(
        await f.client.query(api.execution.conversations.get, {
            runId: f.runId,
        }),
    ).toMatchObject({ queuedCount: 0 });
});
