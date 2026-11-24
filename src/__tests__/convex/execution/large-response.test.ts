import { api, internal } from "@convex/_generated/api";
import { getDocumentSize } from "convex/values";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedConversation } from "@/__tests__/setup/agent-harness";

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

async function activeReply() {
    const f = await seedConversation(true, true);
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "large-reply",
        text: "Explain the retained evidence",
        delivery: "queue",
    });
    const turnId = await f.t.mutation(
        internal.execution.conversations.claimTurn,
        { runId: f.runId },
    );
    assert(turnId);
    await f.t.run(async (ctx) => {
        const turn = await ctx.db.get(turnId);
        assert(turn);
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
        requestKey: "reply",
        expectedGeneration: 1,
    });
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 1,
        taskKey: "reply",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    return { ...f, missionId, turnId, invocationId: begun.invocationId };
}

test.each([
    65537, 1100001,
])("a %i-byte reply is retained, replayed and published intact exactly once", async (bytes) => {
    const f = await activeReply();
    // Multibyte content distinguishes UTF-8 bytes from JS string length.
    const text = `${"é".repeat((bytes - 1) / 2)}!`;
    expect(Buffer.byteLength(text)).toBe(bytes);
    const response = { kind: "complete" as const, text };
    const args = { invocationId: f.invocationId, expectedGeneration: 1 };
    await f.t.mutation(internal.execution.invocations.retainOutput, {
        ...args,
        responseJson: JSON.stringify(response),
    });
    const restored = await f.t.query(
        internal.execution.piControl.invocation,
        args,
    );
    expect(JSON.parse(restored.receivedOutputJson ?? "null")).toEqual(response);
    await expect(
        f.t.mutation(internal.execution.invocations.retainOutput, {
            ...args,
            responseJson: JSON.stringify({
                ...response,
                text: `${text}changed`,
            }),
        }),
    ).rejects.toThrow("invocation_result_conflict");
    for (let attempt = 0; attempt < 2; attempt++) {
        expect(
            await f.t.mutation(internal.execution.invocations.finish, {
                ...args,
                response,
            }),
        ).toMatchObject({ kind: "completed" });
    }
    const page = await f.client.query(
        api.execution.conversations.listMessages,
        { runId: f.runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    expect(
        page.page
            .filter((message) => message.role === "assistant")
            .map((message) => message.text),
    ).toEqual([text]);
    expect(
        await f.t.query(internal.execution.piControl.publicationState, {
            missionId: f.missionId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ completed: true, publishedText: text });
    await f.t.run(async (ctx) => {
        const invocation = await ctx.db.get(f.invocationId);
        const mission = await ctx.db.get(f.missionId);
        assert(invocation && mission);
        expect(getDocumentSize(invocation)).toBeLessThan(1048576);
        expect(getDocumentSize(mission)).toBeLessThan(1048576);
        expect((await ctx.db.get(f.turnId))?.status).toBe("published");
    });
});

test("an oversized preview remains a bounded prefix without refusing progress and stale writers cannot replace it", async () => {
    const f = await activeReply();
    const lease = await f.t.mutation(internal.execution.piStore.claim, {
        missionId: f.missionId,
        expectedGeneration: 1,
        writer: "large-preview",
    });
    const text = `\uFEFF${"é😀".repeat(12000)}`;
    expect(
        await f.t.mutation(internal.execution.piStore.publishPreview, {
            ...lease,
            invocationId: f.invocationId,
            sequence: 0,
            text,
        }),
    ).toBe(true);
    const session = await f.t.run((ctx) => ctx.db.get(lease.sessionId));
    assert(session?.publicPreview);
    expect(session.publicPreview.text.length).toBeGreaterThan(0);
    expect(text.startsWith(session.publicPreview.text)).toBe(true);
    expect(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
            new TextEncoder().encode(session.publicPreview.text),
        ),
    ).toBe(session.publicPreview.text);
    expect(Buffer.byteLength(session.publicPreview.text)).toBeLessThanOrEqual(
        65536,
    );
    await expect(
        f.t.mutation(internal.execution.piStore.publishPreview, {
            ...lease,
            epoch: lease.epoch + 1,
            invocationId: f.invocationId,
            sequence: 0,
            text: "stale",
        }),
    ).rejects.toThrow();
    expect(
        (await f.t.run((ctx) => ctx.db.get(lease.sessionId)))?.publicPreview,
    ).toEqual(session.publicPreview);
});

test("native Workbench publishes a large provider response without retrying generation or charging twice", async () => {
    const { seedWorkbench } = await import("@/__tests__/setup/workbench");
    const { nativePiFixtureRoute } = await import(
        "@/__tests__/setup/pi-native"
    );
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-key");
    const text = "An explanation with retained supporting detail. ".repeat(
        1600,
    );
    const network = vi.fn(
        async () =>
            new Response(
                `data: ${JSON.stringify({ id: "large-response", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "large-response", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 18000, total_tokens: 18010, cost: 0.125 } })}\n\ndata: [DONE]\n\n`,
                { headers: { "content-type": "text/event-stream" } },
            ),
    );
    vi.stubGlobal("fetch", network);
    // Retained Workbench 4 exercises the same production text-completion transport without requiring framing edits.
    const f = await seedWorkbench(
        false,
        nativePiFixtureRoute,
        undefined,
        undefined,
        undefined,
        4,
        "balanced",
        true,
    );
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const messages = await f.client.query(
        api.execution.conversations.listMessages,
        { runId: f.runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    expect(
        messages.page
            .filter((message) => message.role === "assistant")
            .map((message) => message.text),
    ).toEqual([text]);
    const receipts = await f.t.run((ctx) =>
        ctx.db.query("providerCalls").collect(),
    );
    expect(receipts).toEqual([
        expect.objectContaining({
            status: "succeeded",
            reportedCost: 0.125,
            dispatchOutcome: "response_received",
        }),
    ]);
    const mission = await f.t.run((ctx) =>
        ctx.db.query("agentMissions").first(),
    );
    assert(mission);
    expect(mission.status).toBe("completed");
    await f.t.action(internal.execution.piWorker.run, {
        missionId: mission._id,
        expectedGeneration: mission.generation,
        token: "stale-wake",
    });
    expect(network).toHaveBeenCalledOnce();
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual(receipts);
}, 30000);

test("a retained large response cannot publish after steering changes its instructions", async () => {
    const f = await activeReply();
    const response = { kind: "complete" as const, text: "é".repeat(40000) };
    const args = { invocationId: f.invocationId, expectedGeneration: 1 };
    await f.t.mutation(internal.execution.invocations.retainOutput, {
        ...args,
        responseJson: JSON.stringify(response),
    });
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "steer",
        text: "Explain the uncertainty first",
        delivery: "steer",
        turnId: f.turnId,
    });
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            ...args,
            response,
        }),
    ).toMatchObject({ kind: "blocked", code: "stale_instructions" });
    const messages = await f.client.query(
        api.execution.conversations.listMessages,
        { runId: f.runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    expect(
        messages.page.filter((message) => message.role === "assistant"),
    ).toEqual([]);
    const restored = await f.t.query(
        internal.execution.piControl.invocation,
        args,
    );
    expect(JSON.parse(restored.receivedOutputJson ?? "null")).toEqual(response);
});

test("purging a dossier removes fragmented responses and completed mission results", async () => {
    const f = await activeReply();
    const response = { kind: "complete" as const, text: "é".repeat(300000) };
    const args = { invocationId: f.invocationId, expectedGeneration: 1 };
    await f.t.mutation(internal.execution.invocations.retainOutput, {
        ...args,
        responseJson: JSON.stringify(response),
    });
    await f.t.mutation(internal.execution.invocations.finish, {
        ...args,
        response,
    });
    const owned = await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, { purpose: "research" });
        return (await ctx.db.query("retainedTexts").collect()).filter(
            (row) =>
                row.key.startsWith(`${f.invocationId}:`) ||
                row.key === `${f.missionId}:result`,
        );
    });
    expect(owned.length).toBeGreaterThan(0);
    await f.t.action(internal.dossierPurge.purgeResearchDossiers, {
        runIds: [f.runId],
        reason: "Fixture cleanup",
    });
    await f.t.run(async (ctx) => {
        for (const row of owned) {
            expect(await ctx.db.get(row._id)).toBeNull();
            expect(
                await ctx.db
                    .query("retainedTextFragments")
                    .withIndex("by_text_and_index", (q) =>
                        q.eq("textId", row._id),
                    )
                    .collect(),
            ).toEqual([]);
        }
    });
});

test("a corrupted response fragment is refused before recovery can use it", async () => {
    const f = await activeReply();
    const args = { invocationId: f.invocationId, expectedGeneration: 1 };
    await f.t.mutation(internal.execution.invocations.retainOutput, {
        ...args,
        responseJson: JSON.stringify({
            kind: "complete",
            text: "é".repeat(40000),
        }),
    });
    await f.t.run(async (ctx) => {
        const invocation = await ctx.db.get(f.invocationId);
        assert(invocation?.receivedOutputTextId);
        const textId = invocation.receivedOutputTextId;
        const fragment = await ctx.db
            .query("retainedTextFragments")
            .withIndex("by_text_and_index", (q) =>
                q.eq("textId", textId).eq("index", 0),
            )
            .unique();
        assert(fragment);
        await ctx.db.patch(fragment._id, { content: "corrupt" });
    });
    await expect(
        f.t.query(internal.execution.piControl.invocation, args),
    ).rejects.toThrow("retained_text_invalid");
    expect((await f.t.run((ctx) => ctx.db.get(f.turnId)))?.status).toBe(
        "active",
    );
});
