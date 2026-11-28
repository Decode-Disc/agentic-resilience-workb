import { api, internal } from "@convex/_generated/api";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { stageObservedBody } from "@convex/execution/observedReply";
import {
    retainedTextParts,
    stageRetainedText,
} from "@convex/execution/retainedText";
import {
    preparePiReply,
    preparePiSubmission,
    recoverPiInvocationBody,
    recoverPiPublication,
} from "@convex/integrations/piInvocation";
import type { FunctionReturnType } from "convex/server";
import { getDocumentSize } from "convex/values";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedConversation } from "@/__tests__/setup/agent-harness";
import { beginFixtureInvocation } from "@/__tests__/setup/pi-mission";
import { readMessageBodies } from "@/__tests__/setup/retained-messages";

const responseProbeBytes = Number(
    process.env.LARGE_RESPONSE_PROBE_BYTES ?? 175_000,
);
assert(Number.isSafeInteger(responseProbeBytes) && responseProbeBytes > 0);

async function retainOriginalResponse(
    f: Awaited<ReturnType<typeof activeReply>>,
    responseJson: string,
) {
    const args = { invocationId: f.invocationId, expectedGeneration: 1 };
    const responseTextId = await f.t.action((ctx) =>
        stageObservedBody(ctx, args, "response", responseJson),
    );
    const observableReplyJson = stableStringify({
        version: 1,
        provenance: "simulation",
        response: JSON.parse(responseJson),
    });
    const observableReplyTextId = await f.t.action((ctx) =>
        stageObservedBody(ctx, args, "reply", observableReplyJson),
    );
    await f.t.mutation(internal.execution.invocations.retainOutput, {
        ...args,
        ...(responseTextId ? { responseTextId } : { responseJson }),
        ...(observableReplyTextId
            ? { observableReplyTextId }
            : { observableReplyJson }),
    });
}

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

async function activeReply(
    limits: Parameters<typeof seedConversation>[1] = true,
    definitionVersion = 2,
) {
    return beginReply(
        await seedConversation(true, limits),
        "large-reply",
        definitionVersion,
    );
}

test("an oversized invalid operation retains its original arguments and returns a correctable refusal", async () => {
    const f = await activeReply();
    const response = {
        kind: "operations" as const,
        requests: [
            {
                callId: "invalid-large",
                name: "wait_fixture_result",
                inputJson: `{${"x".repeat(Math.max(1_100_000, responseProbeBytes))}`,
            },
        ],
    };
    const args = { invocationId: f.invocationId, expectedGeneration: 1 };
    await retainOriginalResponse(f, stableStringify(response));
    const preparedSubmission = preparePiSubmission(
        response,
        stableStringify(response),
        getAgentDefinition("conversation_validation_v1", 2),
    );
    assert(preparedSubmission);
    expect(getDocumentSize(preparedSubmission)).toBeLessThan(1024);
    const adopted = await f.t.mutation(internal.execution.invocations.finish, {
        ...args,
        preparedSubmission,
    });
    expect(adopted.kind).toBe("waiting");
    const requests = await f.t.run(async (ctx) =>
        Promise.all(adopted.requestIds.map((id) => ctx.db.get(id))),
    );
    for (const request of requests) {
        assert(request);
        expect(getDocumentSize(request)).toBeLessThan(1_048_576);
    }
    expect(requests).toEqual([
        expect.objectContaining({
            status: "completed",
            outcome: expect.objectContaining({
                kind: "refused",
                code: "invalid_operation_input",
            }),
        }),
    ]);
    expect(requests[0]?.input).toMatchObject({
        kind: "invalid",
        inputReference: {
            invocationId: f.invocationId,
            responseHash: sha256Hex(stableStringify(response)),
            callId: "invalid-large",
        },
    });
    expect(JSON.parse((await recoverReceivedResponse(f)) ?? "null")).toEqual(
        response,
    );
});

test.each([
    "malformed",
    "schema",
] as const)("a large %s completion returns bounded feedback without rewriting its receipt", async (variant) => {
    const f = await activeReply({ bytesRead: 128 * 1024 }, 3);
    const inputJson =
        variant === "malformed"
            ? `{${"x".repeat(responseProbeBytes)}`
            : JSON.stringify({
                  kind: "complete",
                  text: 42,
                  unexpected: "x".repeat(responseProbeBytes),
              });
    const response = {
        kind: "completion_submission" as const,
        call: { callId: "completion-large", inputJson },
    };
    const args = { invocationId: f.invocationId, expectedGeneration: 1 };
    const responseJson = stableStringify(response);
    await retainOriginalResponse(f, responseJson);
    const preparedSubmission = preparePiSubmission(
        response,
        responseJson,
        getAgentDefinition("conversation_validation_v1", 3),
    );
    assert(preparedSubmission);
    expect(getDocumentSize(preparedSubmission)).toBeLessThan(1024);
    await expect(
        f.t.mutation(internal.execution.invocations.finish, {
            ...args,
            preparedSubmission: {
                ...preparedSubmission,
                responseHash: "0".repeat(64),
            },
        }),
    ).rejects.toThrow("invocation_result_conflict");
    const result = await f.t.mutation(internal.execution.invocations.finish, {
        ...args,
        preparedSubmission,
    });
    expect(result).toMatchObject({
        kind: "blocked",
        code: "completion_correction_required",
        correction: { code: "invalid_completion" },
    });
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            ...args,
            preparedSubmission,
        }),
    ).toEqual(result);
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "ready",
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.invocationId))).toMatchObject({
        nativeCompletion: {
            callId: "completion-large",
            responseHash: sha256Hex(responseJson),
        },
    });
    expect(await recoverReceivedResponse(f)).toBe(responseJson);
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
    await f.t.run((ctx) => ctx.db.patch(f.runId, { withdrawnAt: Date.now() }));
    await expect(
        f.t.mutation(internal.execution.invocations.finish, {
            ...args,
            preparedSubmission,
        }),
    ).rejects.toThrow("not_authorized");
});

test.each([
    false,
    true,
])("blank textual completion remains a bounded refusal (native: %s)", async (native) => {
    const version = native ? 3 : 2;
    const f = await activeReply(true, version);
    const proposal = {
        kind: "complete" as const,
        text: " ".repeat(responseProbeBytes),
    };
    const response = native
        ? {
              kind: "completion_submission" as const,
              call: {
                  callId: "blank-completion",
                  inputJson: stableStringify(proposal),
              },
          }
        : proposal;
    const responseJson = stableStringify(response);
    await retainOriginalResponse(f, responseJson);
    const preparedSubmission = preparePiSubmission(
        response,
        responseJson,
        getAgentDefinition("conversation_validation_v1", version),
    );
    assert(preparedSubmission);
    expect(getDocumentSize(preparedSubmission)).toBeLessThan(1024);
    const args = {
        invocationId: f.invocationId,
        expectedGeneration: 1,
        preparedSubmission,
    };
    const outcome = await f.t.mutation(
        internal.execution.invocations.finish,
        args,
    );
    expect(outcome).toMatchObject({
        kind: "blocked",
        code: "invalid_completion",
    });
    expect(
        await f.t.mutation(internal.execution.invocations.finish, args),
    ).toEqual(outcome);
    expect(await recoverReceivedResponse(f)).toBe(responseJson);
    const invocation = await f.t.run((ctx) => ctx.db.get(f.invocationId));
    if (native)
        expect(invocation?.nativeCompletion).toEqual({
            callId: "blank-completion",
            responseHash: sha256Hex(responseJson),
        });
    else expect(invocation?.nativeCompletion).toBeUndefined();
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.turnId)))?.publishedMessageId,
    ).toBeUndefined();
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});

test("oversized completion notes retain native correlation without crossing the mutation boundary", async () => {
    const f = await activeReply({ bytesRead: 128 * 1024 }, 3);
    const response = {
        kind: "completion_submission" as const,
        call: {
            callId: "notes-capacity",
            inputJson: JSON.stringify({
                kind: "complete",
                text: "Answer",
                workingNotes: "x".repeat(responseProbeBytes),
            }),
        },
    };
    const responseJson = stableStringify(response);
    await retainOriginalResponse(f, responseJson);
    expect(await recoverReceivedResponse(f)).toBe(responseJson);
    const received = await f.t.run((ctx) => ctx.db.get(f.invocationId));
    const preparedSubmission = preparePiSubmission(
        response,
        responseJson,
        getAgentDefinition("conversation_validation_v1", 3),
    );
    assert(preparedSubmission);
    expect(getDocumentSize(preparedSubmission)).toBeLessThan(1024);
    const outcome = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: f.invocationId,
        expectedGeneration: 1,
        preparedSubmission,
    });
    expect(outcome).toMatchObject({
        kind: "blocked",
        code: "working_memory_capacity",
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.invocationId))).toMatchObject({
        receivedOutputTextId: received?.receivedOutputTextId,
        nativeCompletion: {
            callId: "notes-capacity",
            responseHash: sha256Hex(responseJson),
        },
    });
    await expect(recoverReceivedResponse(f)).rejects.toThrow(
        "working_memory_capacity",
    );
});

test("a schema-valid operation beyond document capacity retains its arguments and receives an explicit refusal", async () => {
    const f = await activeReply();
    const response = {
        kind: "operations" as const,
        requests: [
            {
                callId: "over-capacity",
                name: "consult_mission_state",
                inputJson: JSON.stringify({
                    cursor: "x".repeat(Math.max(1_048_577, responseProbeBytes)),
                }),
            },
        ],
    };
    const responseJson = stableStringify(response);
    await retainOriginalResponse(f, responseJson);
    const preparedSubmission = preparePiSubmission(
        response,
        responseJson,
        getAgentDefinition("conversation_validation_v1", 2),
    );
    assert(preparedSubmission);
    expect(getDocumentSize(preparedSubmission)).toBeLessThan(1024);
    const outcome = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: f.invocationId,
        expectedGeneration: 1,
        preparedSubmission,
    });
    expect(outcome.kind).toBe("waiting");
    const requestId = outcome.requestIds[0];
    assert(requestId);
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "completed",
        outcome: { kind: "refused", code: "operation_input_capacity" },
    });
    expect(await recoverReceivedResponse(f)).toBe(responseJson);
});

test("large original JSON formatting does not enlarge canonical operation adoption or replay", async () => {
    const f = await activeReply({ bytesRead: 128 * 1024 });
    const response = {
        kind: "operations" as const,
        requests: [
            {
                callId: "canonical",
                name: "wait_fixture_result",
                inputJson: `${" ".repeat(responseProbeBytes)}{"value":7}`,
            },
        ],
    };
    const responseJson = stableStringify(response);
    const args = { invocationId: f.invocationId, expectedGeneration: 1 };
    await retainOriginalResponse(f, responseJson);
    const preparedSubmission = preparePiSubmission(
        response,
        responseJson,
        getAgentDefinition("conversation_validation_v1", 2),
    );
    assert(preparedSubmission);
    expect(getDocumentSize(preparedSubmission)).toBeLessThan(1024);
    const result = await f.t.mutation(internal.execution.invocations.finish, {
        ...args,
        preparedSubmission,
    });
    expect(result.kind).toBe("waiting");
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            ...args,
            preparedSubmission,
        }),
    ).toEqual(result);
    expect(result.requestIds).toHaveLength(1);
    const requestId = result.requestIds[0];
    assert(requestId);
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        input: { kind: "wait_fixture_result", value: 7 },
        status: "pending",
    });
    expect(await recoverReceivedResponse(f)).toBe(responseJson);
});

async function beginReply(
    f: Awaited<ReturnType<typeof seedConversation>>,
    requestKey: string,
    definitionVersion = 2,
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
            definitionVersion,
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
    const begun = await beginFixtureInvocation(f.t, {
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
            internal.execution.piControlReads.invocation,
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
    // The platform-size probe includes large manifests; the ordinary regression keeps its tighter budget.
    const f = await activeReply(
        process.env.LARGE_RESPONSE_PROBE_BYTES
            ? true
            : { bytesRead: 128 * 1024 },
    );
    await retainOversizedInput(f);
    const response = {
        kind: "complete" as const,
        text: `${"x".repeat(Math.max(70_000, responseProbeBytes - 90_005))}${"界".repeat(30_000)} 😀`,
    };
    const args = { invocationId: f.invocationId, expectedGeneration: 1 };
    await retainOriginalResponse(f, stableStringify(response));
    await retainOriginalResponse(f, stableStringify(response));
    const retained = await f.t.query(
        internal.execution.piControlReads.invocation,
        args,
    );
    assert(retained.receivedOutputTextId);
    await expect(
        f.t.query(internal.execution.piControlReads.invocationFragment, {
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
                preparedReply,
            }),
        ).resolves.toMatchObject({ kind: "completed" });
    const published = await f.t.run(async (ctx) => {
        const turn = await ctx.db.get(f.turnId);
        assert(turn?.publishedMessageId);
        return ctx.db.get(turn.publishedMessageId);
    });
    expect(published?.bodyTextId).toBe(preparedReply.textId);
    expect(published).not.toHaveProperty("storageMessageRef");
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
    const secondResponse = { ...response, text: secondText };
    const secondJson = stableStringify(secondResponse);
    await retainOriginalResponse(second, secondJson);
    const secondPrepared = await f.t.action((ctx) =>
        preparePiReply(
            ctx,
            { invocationId: second.invocationId, expectedGeneration: 1 },
            secondResponse,
            secondJson,
            getAgentDefinition("conversation_validation_v1", 2),
        ),
    );
    assert(secondPrepared && "textId" in secondPrepared);
    await expect(
        f.t.mutation(internal.execution.invocations.finish, {
            invocationId: second.invocationId,
            expectedGeneration: 1,
            preparedReply: secondPrepared,
        }),
    ).resolves.toMatchObject({ kind: "completed" });
    for (const reader of [
        api.execution.conversations.listMessages,
        api.workbench.history,
    ]) {
        const page = await f.client.run((ctx) =>
            ctx.runQuery(
                reader,
                {
                    runId: f.runId,
                    paginationOpts: { numItems: 20, cursor: null },
                },
                { transactionLimits: { bytesRead: 128 * 1024 } },
            ),
        );
        expect(getDocumentSize({ page: page.page })).toBeLessThan(16 * 1024);
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
            index: secondText.length,
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
    await retainOriginalResponse(f, stableStringify(response));
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
    const preparedReply = await f.t.action((ctx) =>
        preparePiReply(
            ctx,
            args,
            response,
            stableStringify(response),
            getAgentDefinition("conversation_validation_v1", 2),
        ),
    );
    assert(preparedReply && "textId" in preparedReply);
    for (let attempt = 0; attempt < 2; attempt++) {
        expect(
            await f.t.mutation(internal.execution.invocations.finish, {
                ...args,
                preparedReply,
            }),
        ).toMatchObject({ kind: "completed" });
    }
    const page = await f.client.query(
        api.execution.conversations.listMessages,
        { runId: f.runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    expect(
        (await readMessageBodies(f.client, page.page))
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
    const invocation = await beginFixtureInvocation(f.t, {
        missionId: active.missionId,
        expectedGeneration: 1,
        taskKey: "large-workbench-context",
        provenance: "simulation",
        nativeInput: await workbenchAdmissionInput(f.t, active.missionId),
    });
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
        (await readMessageBodies(f.client, history.page))
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
        (await readMessageBodies(f.client, messages.page))
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
    await retainOriginalResponse(f, stableStringify(response));
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
    await retainOriginalResponse(f, stableStringify(response));
    const preparedReply = await f.t.action((ctx) =>
        preparePiReply(
            ctx,
            args,
            response,
            stableStringify(response),
            getAgentDefinition("conversation_validation_v1", 2),
        ),
    );
    assert(preparedReply && "textId" in preparedReply);
    await f.t.mutation(internal.execution.invocations.finish, {
        ...args,
        preparedReply,
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
    if (step === "agentMissions") {
        while (
            await f.t.run(async (ctx) => {
                const mission = await ctx.db.get(f.missionId);
                return (
                    mission &&
                    "protocolVersion" in mission &&
                    Boolean(mission.textualOutcome)
                );
            })
        ) {
            expect(
                await f.t.mutation(internal.dossierPurge.purgeStep, {
                    runId: f.runId,
                    step,
                }),
            ).toBe(true);
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
    await retainOriginalResponse(
        f,
        stableStringify({ kind: "complete", text: "é".repeat(40000) }),
    );
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
