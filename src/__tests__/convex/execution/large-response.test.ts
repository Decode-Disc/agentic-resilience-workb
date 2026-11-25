import { api, internal } from "@convex/_generated/api";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import {
    retainedTextParts,
    stageRetainedText,
} from "@convex/execution/retainedText";
import {
    preparePiReply,
    recoverPiInvocationBody,
    recoverPiPublication,
} from "@convex/integrations/piInvocation";
import type { FunctionReturnType } from "convex/server";
import { getDocumentSize } from "convex/values";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedConversation } from "@/__tests__/setup/agent-harness";

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

async function activeReply(
    limits: Parameters<typeof seedConversation>[1] = true,
) {
    return beginReply(await seedConversation(true, limits), "large-reply");
}

async function beginReply(
    f: Awaited<ReturnType<typeof seedConversation>>,
    requestKey: string,
) {
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey,
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
        requestKey,
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

function recoverReceivedResponse(f: Awaited<ReturnType<typeof activeReply>>) {
    const args = { invocationId: f.invocationId, expectedGeneration: 1 };
    return f.t.action(async (ctx) => {
        const invocation = await ctx.runQuery(
            internal.execution.piControl.invocation,
            args,
        );
        return recoverPiInvocationBody(ctx, invocation, "received", args);
    });
}

async function retainOversizedInput(
    f: Pick<Awaited<ReturnType<typeof activeReply>>, "t" | "invocationId">,
) {
    await f.t.run(async (ctx) => {
        const invocation = await ctx.db.get(f.invocationId);
        assert(invocation);
        const { parts, manifest } = retainedTextParts(
            stableStringify({
                ...JSON.parse(invocation.inputJson),
                diagnostic: "x".repeat(160_000),
            }),
        );
        let inputTextId: typeof invocation.inputTextId;
        for (const [index, content] of parts.entries())
            inputTextId = await stageRetainedText(
                ctx,
                `${invocation._id}:input`,
                {
                    ...manifest,
                    index,
                    content,
                },
            );
        await ctx.db.patch(invocation._id, {
            inputJson: "",
            inputTextId,
            inputContentHash: manifest.contentHash,
        });
    });
}

test("recovers the exact retained invocation response beyond one read transaction", async () => {
    const f = await activeReply({ bytesRead: 128 * 1024 });
    await retainOversizedInput(f);
    const response = {
        kind: "complete" as const,
        text: `${"x".repeat(70_000)}${"界".repeat(30_000)} 😀`,
    };
    const args = { invocationId: f.invocationId, expectedGeneration: 1 };
    await f.t.mutation(internal.execution.invocations.retainOutput, {
        ...args,
        responseJson: JSON.stringify(response),
    });
    await expect(
        f.t.mutation(internal.execution.invocations.retainOutput, {
            ...args,
            responseJson: JSON.stringify(response),
        }),
    ).resolves.toBeNull();
    const retained = await f.t.query(
        internal.execution.piControl.invocation,
        args,
    );
    assert(retained.receivedOutputTextId);
    await expect(
        f.t.query(internal.execution.piControl.invocationFragment, {
            ...args,
            part: "raw",
            textId: retained.receivedOutputTextId,
            index: 0,
        }),
    ).rejects.toThrow("invocation_result_conflict");
    const restored = await recoverReceivedResponse(f);
    expect(JSON.parse(restored ?? "null")).toEqual(response);
    assert(restored);
    const preparedReply = await f.t.action((ctx) =>
        preparePiReply(
            ctx,
            args,
            response,
            restored,
            getAgentDefinition("conversation_validation_v1", 2),
        ),
    );
    assert(preparedReply && "textId" in preparedReply);
    const staged = await f.t.run((ctx) => ctx.db.get(preparedReply.textId));
    expect(staged?.key).toContain(`${f.invocationId}:prepared_reply:`);
    const alternativeBasis = "a".repeat(64);
    const { manifest, parts } = retainedTextParts(response.text);
    let alternativeId: typeof preparedReply.textId | undefined;
    for (const [index, content] of parts.entries()) {
        alternativeId = await f.t.mutation(
            internal.execution.invocationLifecycle.stagePreparedReply,
            {
                ...args,
                basisHash: alternativeBasis,
                fragment: { ...manifest, index, content },
            },
        );
    }
    assert(alternativeId);
    await expect(
        f.t.mutation(internal.execution.invocations.finish, {
            ...args,
            response,
            preparedReply: { ...preparedReply, textId: alternativeId },
        }),
    ).rejects.toThrow("invocation_result_invalid");
    expect((await f.t.run((ctx) => ctx.db.get(f.invocationId)))?.status).toBe(
        "started",
    );
    for (let attempt = 0; attempt < 2; attempt++)
        await expect(
            f.t.mutation(internal.execution.invocations.finish, {
                ...args,
                response,
                preparedReply,
            }),
        ).resolves.toMatchObject({ kind: "completed" });
    const published = await f.t.run(async (ctx) => {
        const turn = await ctx.db.get(f.turnId);
        assert(turn?.publishedMessageId);
        return ctx.db.get(turn.publishedMessageId);
    });
    expect(published?.bodyTextId).toBe(preparedReply.textId);
    expect(published?.storageMessageRef).toBeUndefined();
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        textualOutcome: {
            kind: "conversation_validation_v1",
            textId: published?.bodyTextId,
        },
    });

    await f.t.action(async (ctx) => {
        const authority = { missionId: f.missionId, expectedGeneration: 1 };
        const publication = await ctx.runQuery(
            internal.execution.piControl.publicationState,
            authority,
        );
        assert(publication.completed && publication.publishedReply);
        expect(publication.publishedReply.messageId).toBe(published?._id);
        expect(
            await recoverPiPublication(ctx, {
                ...authority,
                ...publication.publishedReply,
            }),
        ).toBe(response.text);
        await expect(
            recoverPiPublication(ctx, {
                ...authority,
                ...publication.publishedReply,
                contentHash: "wrong-reply",
            }),
        ).rejects.toThrow("publication_context_unavailable");
    });
    assert(published);
    const second = await beginReply(f, "second-reply");
    const secondText = response.text.replace(/^x/, "z");
    await expect(
        f.t.mutation(internal.execution.invocations.finish, {
            invocationId: second.invocationId,
            expectedGeneration: 1,
            response: { ...response, text: secondText },
        }),
    ).resolves.toMatchObject({ kind: "completed" });
    for (const reader of [
        api.execution.conversations.listMessages,
        api.workbench.history,
    ]) {
        const page = await f.client.query(reader, {
            runId: f.runId,
            bodyAccess: "separate",
            paginationOpts: { numItems: 20, cursor: null },
        });
        expect(page.page.filter((message) => message.body)).toHaveLength(4);
        expect(
            page.page.find((message) => message._id === published._id),
        ).toMatchObject({
            body: { contentHash: published.contentHash },
            text: "",
        });
        expect(
            page.page.find((message) => message.role === "user"),
        ).toMatchObject({
            text: "",
            body: { contentHash: sha256Hex("Explain the retained evidence") },
        });
    }
    const bodyReader = api.execution.conversations.readMessageBody;
    const firstPage = await f.client.query(api.workbench.history, {
        runId: f.runId,
        bodyAccess: "separate",
        paginationOpts: { numItems: 1, cursor: null },
    });
    const firstDelivery = firstPage.page[0];
    assert(firstDelivery?.body);
    const bodyArgs = {
        runId: f.runId,
        messageId: firstDelivery._id,
        contentHash: firstDelivery.body.contentHash,
    };
    const firstChunk = await f.client.query(bodyReader, {
        ...bodyArgs,
        index: 0,
    });
    expect(firstChunk.nextIndex).not.toBeNull();
    const nextPage = await f.client.query(api.workbench.history, {
        runId: f.runId,
        bodyAccess: "separate",
        paginationOpts: { numItems: 1, cursor: firstPage.continueCursor },
    });
    expect(nextPage.page[0]?._id).not.toBe(firstDelivery._id);
    let index = firstChunk.nextIndex;
    let reconstructed = firstChunk.content;
    while (index !== null) {
        const chunk: FunctionReturnType<typeof bodyReader> =
            await f.client.query(bodyReader, {
                ...bodyArgs,
                index,
            });
        expect(chunk.offset).toBe(reconstructed.length);
        expect(chunk.totalCharacters).toBe(secondText.length);
        reconstructed += chunk.content;
        index = chunk.nextIndex;
    }
    expect(reconstructed).toBe(secondText);
    await expect(
        f.client.query(bodyReader, {
            ...bodyArgs,
            contentHash: "wrong-body",
            index: 0,
        }),
    ).rejects.toThrow("conversation_message_unavailable");
    await expect(
        f.client.query(bodyReader, {
            ...bodyArgs,
            index: 100,
        }),
    ).rejects.toThrow("retained_text_range");
    await expect(
        f.t.query(bodyReader, { ...bodyArgs, index: 0 }),
    ).rejects.toThrow("Not authenticated");
    await f.t.run((ctx) => ctx.db.patch(f.runId, { withdrawnAt: Date.now() }));
    await expect(
        f.client.query(bodyReader, { ...bodyArgs, index: 0 }),
    ).rejects.toThrow("not_authorized");
    for (const reader of [
        api.execution.conversations.listMessages,
        api.workbench.history,
    ])
        await expect(
            f.client.query(reader, {
                runId: f.runId,
                bodyAccess: "separate",
                paginationOpts: { numItems: 1, cursor: null },
            }),
        ).rejects.toThrow("not_authorized");
});

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
    const restored = await recoverReceivedResponse(f);
    expect(JSON.parse(restored ?? "null")).toEqual(response);
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
    await f.t.action(async (ctx) => {
        const authority = { missionId: f.missionId, expectedGeneration: 1 };
        const publication = await ctx.runQuery(
            internal.execution.piControl.publicationState,
            authority,
        );
        assert(publication.completed && publication.publishedReply);
        expect(
            await recoverPiPublication(ctx, {
                ...authority,
                ...publication.publishedReply,
            }),
        ).toBe(text);
    });
    await f.t.run(async (ctx) => {
        const invocation = await ctx.db.get(f.invocationId);
        const mission = await ctx.db.get(f.missionId);
        assert(invocation && mission);
        expect(invocation.outputTextId).toBe(invocation.receivedOutputTextId);
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

test("Workbench completes with its admitted policy and facts when the original context exceeds the transaction budget", async () => {
    const { seedWorkbench, workbenchAdmissionInput } = await import(
        "@/__tests__/setup/workbench"
    );
    const f = await seedWorkbench(
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        5,
        "balanced",
        { bytesRead: 128 * 1024 },
    );
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(active);
    const invocation = await f.t.mutation(
        internal.execution.invocations.begin,
        {
            missionId: active.missionId,
            expectedGeneration: 1,
            taskKey: "large-workbench-context",
            provenance: "simulation",
            nativeInput: await workbenchAdmissionInput(f.t, active.missionId),
        },
    );
    assert(invocation.kind === "ready");
    const stored = await f.t.run((ctx) => ctx.db.get(invocation.invocationId));
    assert(stored?.workbenchCompletionAdmission?.factsRevisionHash);
    await retainOversizedInput({
        t: f.t,
        invocationId: invocation.invocationId,
    });
    await expect(
        f.t.mutation(internal.execution.invocations.finish, {
            invocationId: invocation.invocationId,
            expectedGeneration: 1,
            response: { kind: "complete", text: "Your dossier is available." },
        }),
    ).resolves.toMatchObject({ kind: "completed" });
    const conversation = await f.t.run((ctx) =>
        ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .unique(),
    );
    expect(conversation?.responseFactsRevisionHash).toBe(
        stored.workbenchCompletionAdmission.factsRevisionHash,
    );
    const history = await f.client.query(
        api.execution.conversations.listMessages,
        {
            runId: f.runId,
            paginationOpts: { numItems: 20, cursor: null },
        },
    );
    expect(
        history.page
            .filter((entry) => entry.role === "assistant")
            .map((entry) => entry.text),
    ).toEqual(["Your dossier is available."]);
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
    await f.t.run(async (ctx) => {
        const event = await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_sequence", (q) =>
                q.eq("missionId", mission._id),
            )
            .filter((q) => q.eq(q.field("kind"), "mission_completed"))
            .unique();
        assert(
            event?.invocationId &&
                event.payload?.state === "complete" &&
                event.payload.json,
        );
        const invocation = await ctx.db.get(event.invocationId);
        assert(invocation?.receivedOutputTextId);
        expect(invocation.outputTextId).toBe(invocation.receivedOutputTextId);
        const retained = await ctx.db.get(invocation.receivedOutputTextId);
        expect(retained?.contentHash).toBe(
            sha256Hex(stableStringify({ kind: "complete", text })),
        );
        const responseReference = JSON.parse(event.payload.json).response;
        expect(responseReference.kind).toBe("retained_invocation_response");
        expect(responseReference).toEqual({
            invocationId: invocation._id,
            kind: "retained_invocation_response",
            contentHash: retained?.contentHash,
        });
    });

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
    const restored = await recoverReceivedResponse(f);
    expect(JSON.parse(restored ?? "null")).toEqual(response);
});

test.each([
    "agentMessageDeliveries",
    "agentMissions",
] as const)("purge preserves shared reply text when %s releases it first", async (step) => {
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
    const { owned, textId, messageId } = await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, { purpose: "research" });
        const turn = await ctx.db.get(f.turnId);
        assert(turn?.publishedMessageId);
        const delivery = await ctx.db.get(turn.publishedMessageId);
        assert(delivery?.bodyTextId);
        const rows = await ctx.db.query("retainedTexts").collect();
        return {
            owned: rows.filter(
                (row) =>
                    row.key.startsWith(`${f.invocationId}:`) ||
                    row._id === delivery.bodyTextId,
            ),
            textId: delivery.bodyTextId,
            messageId: delivery._id,
        };
    });
    expect(owned.length).toBeGreaterThan(1);
    const reason = "Remove shared reply ownership";
    await f.t.mutation(internal.dossierPurge.beginPurge, {
        runId: f.runId,
        reason,
    });
    expect(
        await f.t.mutation(internal.dossierPurge.purgeStep, {
            runId: f.runId,
            step,
        }),
    ).toBe(true);
    if (step === "agentMessageDeliveries") {
        while (
            await f.t.mutation(internal.dossierPurge.purgeStep, {
                runId: f.runId,
                step,
            })
        ) {
            // Release every delivery body before inspecting the retained mission reference.
        }
    }
    await f.t.run(async (ctx) => {
        expect(await ctx.db.get(textId)).not.toBeNull();
        const fragment = await ctx.db
            .query("retainedTextFragments")
            .withIndex("by_text_and_index", (q) => q.eq("textId", textId))
            .first();
        expect(fragment).not.toBeNull();
        if (step === "agentMessageDeliveries") {
            expect(await ctx.db.get(messageId)).toBeNull();
            expect(await ctx.db.get(f.missionId)).toMatchObject({
                textualOutcome: { textId },
            });
        } else {
            expect(await ctx.db.get(messageId)).toMatchObject({
                bodyTextId: textId,
            });
            expect(await ctx.db.get(f.missionId)).not.toHaveProperty(
                "textualOutcome",
            );
        }
    });
    await f.t.action(internal.dossierPurge.purgeResearchDossiers, {
        runIds: [f.runId],
        reason,
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
    await expect(recoverReceivedResponse(f)).rejects.toThrow(
        "retained_text_invalid",
    );
    expect((await f.t.run((ctx) => ctx.db.get(f.turnId)))?.status).toBe(
        "active",
    );
});
