import { api, internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import { seedConversation } from "@/__tests__/setup/agent-harness";
import { seedPiHistory, seedPiMission } from "@/__tests__/setup/pi-mission";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

test("Pi required context references its journal without duplicating the prior reply while retaining current results", async () => {
    const { t, missionId, args } = await seedPiMission();
    const first = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "prior-reply",
        provenance: "simulation",
    });
    if (first.kind !== "ready") throw new Error("Expected invocation");
    const original = "PRIOR_REPLY_ONLY_IN_COMPACTABLE_HISTORY";
    const rawOutputJson = JSON.stringify({
        assistantOutput: original,
        backendOutputJson: JSON.stringify({
            content: [{ type: "text", text: original }],
        }),
    });
    const returned = await t.mutation(internal.execution.invocations.finish, {
        invocationId: first.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "operations",
            requests: [
                {
                    callId: "read",
                    name: "read_in_context",
                    inputJson: JSON.stringify({
                        sourceId: args.sourceId,
                        passageOrder: 0,
                    }),
                },
            ],
        },
        rawOutputJson,
    });
    const requestId = returned.requestIds[0];
    if (!requestId) throw new Error("Expected reading");
    await t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 4,
    });
    const context = await t.query(internal.execution.context.build, {
        missionId,
        expectedGeneration: 4,
    });
    if (context.kind !== "ready") throw new Error("Expected context");
    const input = JSON.parse(context.inputJson);
    expect(input.lastObservableInvocation).toMatchObject({
        invocationId: first.invocationId,
    });
    expect(input.lastObservableInvocation).not.toHaveProperty("outputJson");
    expect(input.lastObservableInvocation).not.toHaveProperty("rawOutputJson");
    expect(context.inputJson).not.toContain(original);
    expect(input.triggeringRequestsAndResults).toContainEqual(
        expect.objectContaining({
            requestId,
            outcome: expect.objectContaining({ kind: "success" }),
        }),
    );
    expect(await t.run((ctx) => ctx.db.get(first.invocationId))).toMatchObject({
        rawOutputJson,
    });
});

test("native context pressure compacts working history while keeping the exact active instructions", async () => {
    vi.useFakeTimers();
    const f = await seedConversation(true);
    const text = `AUTHORITATIVE QUESTION: ${"a".repeat(60000)}`;
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "long-question",
        delivery: "queue",
        text,
    });
    const started = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "conversation_validation_v1",
            scope: { kind: "conversation_validation_v1" },
            simulation: true,
        },
    );
    if (!started) throw new Error("Expected turn");
    await seedPiHistory(f.t, started.missionId, 1, 8, 16250);
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: started.missionId,
        expectedGeneration: 1,
        simulation: true,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(await f.t.run((ctx) => ctx.db.get(started.missionId))).toMatchObject(
        { status: "completed" },
    );
    const invocations = await f.t.run((ctx) =>
        ctx.db.query("agentInvocations").collect(),
    );
    expect(invocations).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ purpose: "compaction" }),
        ]),
    );
    const reasoning = invocations.filter(
        (invocation) => !invocation.purpose && invocation.status === "returned",
    );
    expect(
        reasoning.some((invocation) => invocation.inputJson.includes(text)),
    ).toBe(true);
    const messages = await f.client.query(
        api.execution.conversations.listMessages,
        { runId: f.runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    expect(messages.page.find((message) => message.role === "user")?.text).toBe(
        text,
    );
}, 30000);
