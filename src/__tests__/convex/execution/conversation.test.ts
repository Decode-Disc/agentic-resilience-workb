import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { afterEach, expect, test, vi } from "vitest";
import { seedConversation as fixture } from "@/__tests__/setup/agent-harness";

afterEach(() => {
    vi.unstubAllEnvs();
});

async function observeSimulation(
    t: Awaited<ReturnType<typeof fixture>>["t"],
    invocationId: Id<"agentInvocations">,
) {
    const args = { invocationId, expectedGeneration: 1 };
    const response = await t.query(internal.execution.simulation.invoke, args);
    await t.mutation(internal.execution.invocationLifecycle.retainOutput, {
        ...args,
        responseJson: JSON.stringify(response),
    });
    return { response };
}

test("message reading returns application delivery data without component storage metadata", async () => {
    const f = await fixture();
    const messageId = await f.client.mutation(
        api.execution.conversations.submit,
        {
            runId: f.runId,
            requestKey: "application-message",
            text: "Inspect retained material",
            delivery: "queue",
        },
    );
    const page = await f.client.query(
        api.execution.conversations.listMessages,
        { runId: f.runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    expect(page.page).toEqual([
        {
            _id: messageId,
            runId: f.runId,
            text: "Inspect retained material",
            role: "user",
            delivery: "queue",
            status: "queued",
            createdAt: expect.any(Number),
        },
    ]);
});

test("public history preserves the analyst request identity while admission is pending", async () => {
    const f = await fixture();
    const messageId = await f.client.mutation(
        api.execution.conversations.submit,
        {
            runId: f.runId,
            requestKey: "immediate-message",
            text: "Inspect the retained material",
            delivery: "queue",
        },
    );
    const history = await f.client.query(api.workbench.history, {
        runId: f.runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(history.page).toEqual([
        expect.objectContaining({
            _id: messageId,
            requestKey: "immediate-message",
            text: "Inspect the retained material",
            status: "queued",
        }),
    ]);
    expect(history.page[0]).not.toHaveProperty("storageMessageRef");
});

test("an admitted dossier keeps one conversation and idempotent queued messages without a research slot", async () => {
    const f = await fixture();
    const input = {
        runId: f.runId,
        requestKey: "first",
        text: "Inspect the existing context",
        delivery: "queue" as const,
    };
    const first = await f.client.mutation(
        api.execution.conversations.submit,
        input,
    );
    expect(
        await f.client.mutation(api.execution.conversations.submit, input),
    ).toEqual(first);
    const state = await f.client.query(api.execution.conversations.get, {
        runId: f.runId,
    });
    expect(state).toMatchObject({ queuedCount: 1, activeTurn: null });
    const page = await f.client.query(
        api.execution.conversations.listMessages,
        { runId: f.runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    expect(page.page).toEqual([
        expect.objectContaining({
            text: input.text,
            delivery: "queue",
            status: "queued",
        }),
    ]);
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "idle",
        lifecycleState: "draft",
    });
    await expect(
        f.client.mutation(api.execution.conversations.submit, {
            ...input,
            text: "Changed under the same identity",
        }),
    ).rejects.toThrow("message_identity_conflict");
    await expect(
        f.t.query(api.execution.conversations.get, { runId: f.runId }),
    ).rejects.toThrow();
});

test("steering targets a live turn while ordinary messages wait for the next turn", async () => {
    const f = await fixture();
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "one",
        text: "First",
        delivery: "queue",
    });
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "two",
        text: "Second",
        delivery: "queue",
    });
    const turnId = await f.t.mutation(
        internal.execution.conversations.claimTurn,
        { runId: f.runId },
    );
    if (!turnId) throw new Error("Expected active turn");
    expect(turnId).not.toBeNull();
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "three",
        text: "Next turn",
        delivery: "queue",
    });
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "steer",
        text: "Use a narrower scope",
        delivery: "steer",
        turnId: turnId,
    });
    const state = await f.client.query(api.execution.conversations.get, {
        runId: f.runId,
    });
    expect(state).toMatchObject({
        queuedCount: 1,
        activeTurn: { instructionVersion: 2, messageCount: 3 },
    });
    expect(
        await f.t.mutation(internal.execution.conversations.claimTurn, {
            runId: f.runId,
        }),
    ).toBe(turnId);
    await expect(
        f.client.mutation(api.execution.conversations.submit, {
            runId: f.runId,
            requestKey: "bad-steer",
            text: "No target",
            delivery: "steer",
        }),
    ).rejects.toThrow("active_turn_required");
});

test("a conversational mission survives research generation changes and publishes exactly once", async () => {
    const f = await fixture(true);
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "question",
        text: "Explain retained work",
        delivery: "queue",
    });
    const turnId = await f.t.mutation(
        internal.execution.conversations.claimTurn,
        { runId: f.runId },
    );
    if (!turnId) throw new Error("Expected active turn");
    await f.t.run(async (ctx) => {
        const turn = await ctx.db.get(turnId);
        if (!turn) throw new Error("Expected active turn");
        await ctx.db.patch(turn.conversationId, {
            definitionId: "conversation_validation_v1",
            definitionVersion: 2,
        });
    });
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        definitionId: "conversation_validation_v1",
        scope: { kind: "conversation_validation_v1" },
        conversationTurnId: turnId,
        requestKey: "conversation",
        expectedGeneration: 1,
    });
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            executionGeneration: 99,
            executionStatus: "paused",
            pauseReason: "source_review",
        }),
    );
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 1,
        taskKey: "reply",
        provenance: "simulation",
    });
    if (begun.kind !== "ready") throw new Error("Expected invocation");
    expect(JSON.parse(begun.inputJson)).toMatchObject({
        conversationInstructions: {
            instructionVersion: 1,
            messages: [{ text: "Explain retained work" }],
        },
    });
    const reply = await observeSimulation(f.t, begun.invocationId);
    for (let i = 0; i < 2; i++)
        expect(
            await f.t.mutation(internal.execution.invocations.finish, {
                invocationId: begun.invocationId,
                expectedGeneration: 1,
                ...reply,
            }),
        ).toMatchObject({ kind: "completed" });
    const page = await f.client.query(
        api.execution.conversations.listMessages,
        { runId: f.runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    expect(page.page.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(page.page.every((m) => m.status === "processed")).toBe(true);
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "paused",
        executionGeneration: 99,
    });
});

test("steering between observation and adoption prevents stale publication and retains the useful observation", async () => {
    const f = await fixture(true);
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "start",
        text: "First scope",
        delivery: "queue",
    });
    const turnId = await f.t.mutation(
        internal.execution.conversations.claimTurn,
        { runId: f.runId },
    );
    if (!turnId) throw new Error("Expected active turn");
    await f.t.run(async (ctx) => {
        const turn = await ctx.db.get(turnId);
        if (!turn) throw new Error("Expected active turn");
        await ctx.db.patch(turn.conversationId, {
            definitionId: "conversation_validation_v1",
            definitionVersion: 2,
        });
    });
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        definitionId: "conversation_validation_v1",
        scope: { kind: "conversation_validation_v1" },
        conversationTurnId: turnId,
        requestKey: "steering",
        expectedGeneration: 1,
    });
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 1,
        taskKey: "old",
        provenance: "simulation",
    });
    if (begun.kind !== "ready") throw new Error("Expected invocation");
    const reply = await observeSimulation(f.t, begun.invocationId);
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "steer-now",
        text: "Correct the scope",
        delivery: "steer",
        turnId,
    });
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: begun.invocationId,
            expectedGeneration: 1,
            ...reply,
        }),
    ).toMatchObject({ kind: "blocked", code: "stale_instructions" });
    expect(
        await f.t.run((ctx) => ctx.db.get(begun.invocationId)),
    ).toHaveProperty("receivedOutputJson");
    expect(
        (
            await f.client.query(api.execution.conversations.listMessages, {
                runId: f.runId,
                paginationOpts: { numItems: 20, cursor: null },
            })
        ).page.every((m) => m.role === "user"),
    ).toBe(true);
});

test("cancellation closes the turn and gives queued and active messages an interrupted outcome", async () => {
    vi.useFakeTimers();
    try {
        const f = await fixture();
        await f.client.mutation(api.execution.conversations.submit, {
            runId: f.runId,
            requestKey: "active",
            text: "In progress",
            delivery: "queue",
        });
        await f.t.mutation(internal.execution.conversations.claimTurn, {
            runId: f.runId,
        });
        await f.client.mutation(api.execution.conversations.submit, {
            runId: f.runId,
            requestKey: "queued",
            text: "Waiting",
            delivery: "queue",
        });
        await f.client.mutation(api.workflowControls.cancel, {
            runId: f.runId,
        });
        await f.t.finishAllScheduledFunctions(
            () => vi.advanceTimersByTime(10),
            100,
        );
        expect(
            await f.client.query(api.execution.conversations.get, {
                runId: f.runId,
            }),
        ).toMatchObject({ activeTurn: null, queuedCount: 0 });
        const page = await f.client.query(
            api.execution.conversations.listMessages,
            { runId: f.runId, paginationOpts: { numItems: 20, cursor: null } },
        );
        expect(page.page.map((message) => message.status)).toEqual([
            "interrupted",
            "interrupted",
        ]);
    } finally {
        vi.useRealTimers();
    }
});

test("one server call claims and executes a queued turn without exposing lifecycle ordering", async () => {
    vi.useFakeTimers();
    try {
        const f = await fixture(true);
        const workflowTest = (
            await import(
                "@/__tests__/convex/workflows/workflow-test-register.js"
            )
        ).default;
        workflowTest.register(f.t);
        await f.client.mutation(api.execution.conversations.submit, {
            runId: f.runId,
            requestKey: "atomic-start",
            text: "Handle this request",
            delivery: "queue",
        });
        const result = await f.t.mutation(
            internal.execution.conversations.startTurn,
            {
                runId: f.runId,
                definitionId: "conversation_validation_v1",
                scope: { kind: "conversation_validation_v1" },
                simulation: true,
            },
        );
        expect(result).not.toBeNull();
        await f.t.finishAllScheduledFunctions(
            () => vi.advanceTimersByTime(10),
            500,
        );
        expect(
            (
                await f.client.query(api.execution.conversations.listMessages, {
                    runId: f.runId,
                    paginationOpts: { numItems: 20, cursor: null },
                })
            ).page.filter((message) => message.role === "assistant"),
        ).toHaveLength(1);
    } finally {
        vi.useRealTimers();
    }
}, 30_000);

test("conversation follow-up exposes a blocked mission without presenting it as ongoing generation", async () => {
    vi.useFakeTimers();
    try {
        const f = await fixture(true);
        const workflowTest = (
            await import(
                "@/__tests__/convex/workflows/workflow-test-register.js"
            )
        ).default;
        workflowTest.register(f.t);
        await f.client.mutation(api.execution.conversations.submit, {
            runId: f.runId,
            requestKey: "blocked-turn",
            text: "Explain the available state",
            delivery: "queue",
        });
        await f.t.mutation(internal.execution.conversations.startTurn, {
            runId: f.runId,
            definitionId: "conversation_validation_v1",
            scope: { kind: "conversation_validation_v1" },
            simulation: false,
        });
        await f.t.finishAllScheduledFunctions(
            () => vi.advanceTimersByTime(10),
            500,
        );
        expect(
            await f.client.query(api.execution.conversations.get, {
                runId: f.runId,
            }),
        ).toMatchObject({
            execution: { status: "blocked", code: "missing_authorized_route" },
        });
        expect(
            await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
        ).toEqual([]);
    } finally {
        vi.useRealTimers();
    }
}, 30_000);

test("steering beyond one history page preserves every instruction and completes the turn", async () => {
    const f = await fixture(true);
    for (let index = 0; index < 20; index++)
        await f.client.mutation(api.execution.conversations.submit, {
            runId: f.runId,
            requestKey: `page-${index}`,
            text: `Question ${index}`,
            delivery: "queue",
        });
    const turnId = await f.t.mutation(
        internal.execution.conversations.claimTurn,
        { runId: f.runId },
    );
    if (!turnId) throw new Error("Expected active turn");
    await f.t.run(async (ctx) => {
        const turn = await ctx.db.get(turnId);
        if (!turn) throw new Error("Expected active turn");
        await ctx.db.patch(turn.conversationId, {
            definitionId: "conversation_validation_v1",
            definitionVersion: 2,
        });
    });
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        definitionId: "conversation_validation_v1",
        scope: { kind: "conversation_validation_v1" },
        conversationTurnId: turnId,
        requestKey: "multi-page-steering",
        expectedGeneration: 1,
    });
    for (let index = 0; index < 5; index++)
        await f.client.mutation(api.execution.conversations.submit, {
            runId: f.runId,
            requestKey: `steer-page-${index}`,
            text: `Refinement ${index}`,
            delivery: "steer",
            turnId,
        });
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 1,
        taskKey: "after-steering",
        provenance: "simulation",
    });
    expect(begun.kind).toBe("ready");
    if (begun.kind !== "ready") throw new Error("Expected usable continuation");
    const instructions = JSON.parse(begun.inputJson).conversationInstructions;
    expect(
        instructions.messages.map((message: { text: string }) => message.text),
    ).toEqual([
        ...Array.from({ length: 20 }, (_, index) => `Question ${index}`),
        ...Array.from({ length: 5 }, (_, index) => `Refinement ${index}`),
    ]);
    expect(instructions.instructionVersion).toBe(6);
    const queued = await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "following-turn",
        text: "Next request",
        delivery: "queue",
    });
    const reply = await observeSimulation(f.t, begun.invocationId);
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: begun.invocationId,
            expectedGeneration: 1,
            ...reply,
        }),
    ).toMatchObject({ kind: "completed" });
    const messages = await f.t.run((ctx) =>
        ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_turn", (q) => q.eq("turnId", turnId))
            .collect(),
    );
    expect(messages).toHaveLength(26);
    expect(messages.every((message) => message.status === "processed")).toBe(
        true,
    );
    expect(await f.t.run((ctx) => ctx.db.get(queued))).toMatchObject({
        status: "queued",
    });
    expect(
        await f.client.query(api.execution.conversations.get, {
            runId: f.runId,
        }),
    ).toMatchObject({ activeTurn: null, queuedCount: 1 });
    expect(
        await f.t.mutation(internal.execution.conversations.claimTurn, {
            runId: f.runId,
        }),
    ).not.toBe(turnId);
}, 30_000);

test("a steer exceeding the assembled context rolls back without stranding the active turn", async () => {
    const f = await fixture(true);
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "initial",
        text: "Original instruction",
        delivery: "queue",
    });
    const turnId = await f.t.mutation(
        internal.execution.conversations.claimTurn,
        { runId: f.runId },
    );
    if (!turnId) throw new Error("Expected active turn");
    const largeText = "x".repeat(64 * 1024 - 1);
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "fits",
        text: largeText,
        delivery: "steer",
        turnId,
    });
    const before = await f.client.query(api.execution.conversations.get, {
        runId: f.runId,
    });
    const tooLarge = {
        runId: f.runId,
        requestKey: "too-large",
        text: largeText,
        delivery: "steer" as const,
        turnId,
    };
    await expect(
        f.client.mutation(api.execution.conversations.submit, tooLarge),
    ).rejects.toThrow("context_capacity");
    expect(
        await f.client.query(api.execution.conversations.get, {
            runId: f.runId,
        }),
    ).toEqual(before);
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("agentMessageDeliveries")
                .withIndex("by_run_and_key", (q) =>
                    q.eq("runId", f.runId).eq("requestKey", "too-large"),
                )
                .unique(),
        ),
    ).toBeNull();
    expect(
        await f.t
            .run((ctx) =>
                ctx.db
                    .query("agentExecutionEvents")
                    .withIndex("by_run", (q) => q.eq("runId", f.runId))
                    .collect(),
            )
            .then((events) =>
                events.filter((event) => event.kind === "turn_steered"),
            ),
    ).toHaveLength(1);
    await f.client.mutation(api.execution.conversations.submit, {
        ...tooLarge,
        text: "A smaller refinement",
    });
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        definitionId: "conversation_validation_v1",
        scope: { kind: "conversation_validation_v1" },
        conversationTurnId: turnId,
        requestKey: "byte-budget",
        expectedGeneration: 1,
    });
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 1,
        taskKey: "after-refusal",
        provenance: "simulation",
    });
    expect(begun.kind).toBe("ready");
    if (begun.kind !== "ready")
        throw new Error("Expected unchanged usable turn");
    const instructions = JSON.parse(begun.inputJson).conversationInstructions;
    expect(
        instructions.messages.map((message: { text: string }) => message.text),
    ).toEqual(["Original instruction", largeText, "A smaller refinement"]);
    expect(instructions.instructionVersion).toBe(3);
}, 30_000);
