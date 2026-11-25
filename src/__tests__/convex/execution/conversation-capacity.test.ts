import { api, internal } from "@convex/_generated/api";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { readWorkbenchFacts } from "@convex/domain/workbenchContext";
import { DEFAULT_RESPONSE_CONTROL_POLICY } from "@convex/domain/workbenchResponseControlContracts";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { agentToolSchemas } from "@convex/execution/agentDefinition";
import { recordMissionEvent } from "@convex/execution/authority";
import {
    retainedTextParts,
    stageRetainedText,
} from "@convex/execution/retainedText";
import { agentToolSetKey } from "@convex/integrations/modelInput";
import { preparePiReply } from "@convex/integrations/piInvocation";
import { projectWorkbenchCompletionAdmission } from "@convex/responseControl";
import { afterEach, assert, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { seedConversation } from "@/__tests__/setup/agent-harness";

import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

test("turn admission leaves valid later messages queued when their combined required context cannot fit", async () => {
    vi.useFakeTimers();
    const f = await seedConversation(true);
    workflowTest.register(f.t);
    for (const key of ["first", "second"])
        await f.client.mutation(api.execution.conversations.submit, {
            runId: f.runId,
            requestKey: key,
            delivery: "queue",
            text: key.charAt(0).repeat(64 * 1024),
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
    expect(
        await f.client.query(api.execution.conversations.get, {
            runId: f.runId,
        }),
    ).toMatchObject({ queuedCount: 1, activeTurn: { messageCount: 1 } });
    expect(
        await f.t.query(internal.execution.context.build, {
            missionId: started.missionId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "ready" });
});

test("native admission freezes the accepted delivery IDs within the context read budget", async () => {
    const { t, runId, client } = await seedWorkbench(
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        12,
        "balanced",
        { bytesRead: 137 * 1024 },
    );
    const queued = await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "large-queued",
        text: "a".repeat(24_000),
        delivery: "queue",
    });
    const started = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(started);
    const state = await t.run(async (ctx) => ({
        turn: await ctx.db.get(started.turnId),
        first: await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_turn", (q) => q.eq("turnId", started.turnId))
            .first(),
    }));
    assert(state.first);
    expect(state.turn).toMatchObject({
        nativeInitialInstructionVersion: 1,
        nativeInitialMessageIds: [state.first._id, queued],
    });
});

test("native invocation admission reuses the instruction identity from the checked context", async () => {
    const { t, runId } = await seedWorkbench(
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        12,
        "balanced",
        { bytesRead: 137 * 1024 },
    );
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(active);
    const delivery = await t.run((ctx) =>
        ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_turn", (q) => q.eq("turnId", active.turnId))
            .first(),
    );
    assert(delivery?.bodyTextId);
    const originalId = delivery.bodyTextId;
    const { manifest, parts } = retainedTextParts("d".repeat(48_000));
    const [content] = parts;
    assert(content && parts.length === 1);
    await t.run(async (ctx) => {
        const textId = await stageRetainedText(ctx, "large-admission-input", {
            index: 0,
            content,
            ...manifest,
        });
        const original = await ctx.db.get(originalId);
        assert(original);
        await ctx.db.patch(originalId, { key: "superseded-admission-fixture" });
        await ctx.db.patch(textId, { key: original.key });
        await ctx.db.patch(delivery._id, {
            bodyTextId: textId,
            bodyContentHash: manifest.contentHash,
        });
    });
    const scope = { missionId: active.missionId, expectedGeneration: 1 };
    const context = await t.query(internal.execution.context.build, scope);
    assert(context.kind === "ready");
    const toolSetKey = await agentToolSetKey(
        agentToolSchemas(
            getAgentDefinition("workbench_v1", 12),
            JSON.parse(context.inputJson),
        ),
    );
    const begin = internal.execution.invocations.begin;
    const args = {
        ...scope,
        taskKey: "bounded-native-admission",
        provenance: "simulation" as const,
        returnInputReference: true as const,
    };
    await expect(
        t.mutation(begin, {
            ...args,
            nativeInput: { messageIds: [], toolSetKey },
        }),
    ).resolves.toMatchObject({ kind: "blocked", code: "native_input_changed" });
    await expect(
        t.mutation(begin, {
            ...args,
            nativeInput: { messageIds: [delivery._id], toolSetKey },
        }),
    ).resolves.toMatchObject({ kind: "ready_reference" });
});

test.each([
    false,
    true,
])("native reply preparation and adoption fit a transaction budget smaller than the analyst body (framing correction: %s)", async (framingCorrection) => {
    const { t, runId, client } = await seedWorkbench(
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        12,
    );
    const messageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId,
            requestKey: "retained-analysis-question",
            text: "w".repeat(40_000),
            delivery: "queue",
        },
    );
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(active);
    const response = {
        kind: "complete",
        text: "Evidence is limited.",
    } as const;
    const responseJson = stableStringify(response);
    const invocationId = await t.run(async (ctx) => {
        const turn = await ctx.db.get(active.turnId);
        assert(turn);
        for await (const delivery of ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_turn", (q) => q.eq("turnId", active.turnId))) {
            if (delivery._id !== messageId && !framingCorrection)
                await ctx.db.patch(delivery._id, {
                    requestKey: "prior-analysis-question",
                });
        }
        if (framingCorrection)
            await ctx.db.patch(runId, {
                currentFramingRevisionId: undefined,
                fixedFramingRevisionId: undefined,
            });
        const frame = await ctx.db.insert("framingRevisions", {
            runId,
            revision: 1,
            content: { scope: "Workflow", questions: [] },
            requestKey: "retained-wording-frame",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        const previousWording = "p".repeat(42_000);
        const previousId = await ctx.db.insert("agentMessageDeliveries", {
            runId,
            conversationId: turn.conversationId,
            requestKey: "prior-transmitted-wording",
            contentHash: sha256Hex(previousWording),
            role: "user",
            delivery: "queue",
            status: "processed",
            createdAt: 1,
        });
        const { manifest, parts } = retainedTextParts(previousWording);
        assert(parts[0] && parts.length === 1);
        const bodyTextId = await stageRetainedText(
            ctx,
            `delivery:${previousId}`,
            {
                ...manifest,
                index: 0,
                content: parts[0],
            },
        );
        await ctx.db.patch(previousId, {
            bodyTextId,
            bodyContentHash: manifest.contentHash,
        });
        for (const originalId of [messageId, previousId]) {
            const requestId = await ctx.db.insert("agentOperationRequests", {
                runId,
                actor: "agent",
                missionId: active.missionId,
                cause: "transmitted-wording",
                input: {
                    kind: "transmit_source_request",
                    messageId: originalId,
                    interpretedNeed: "Supplier evidence",
                    coverageRole: null,
                },
                operationVersion: 1,
                expectedGeneration: 1,
                logicalKey: `transmitted-wording:${originalId}`,
                status: "completed",
                createdAt: 1,
            });
            await ctx.db.insert("workbenchInstructions", {
                runId,
                requestId,
                messageId: originalId,
                framingRevisionId: frame,
                interpretedNeed: "Supplier evidence",
                status: "waiting",
                outcome: "Waiting",
                createdAt: 1,
            });
        }
        await ctx.db.patch(turn._id, {
            responseControl: {
                policy: { ...DEFAULT_RESPONSE_CONTROL_POLICY, enabled: true },
                checks: [],
            },
        });
        return ctx.db.insert("agentInvocations", {
            runId,
            missionId: active.missionId,
            generation: 1,
            definitionVersion: 12,
            taskKey: "reply-with-retained-wording",
            provenance: "simulation",
            status: "started",
            inputJson: "{}",
            instructionVersion: turn.instructionVersion,
            receivedOutputJson: responseJson,
            receivedWhileAuthorized: true,
            scopeKey: sha256Hex(stableStringify({ kind: "workbench_v1" })),
            workbenchCompletionAdmission: projectWorkbenchCompletionAdmission(
                {},
            ),
            createdAt: 1,
        });
    });
    const replyScope = {
        invocationId,
        expectedGeneration: 1,
        responseHash: sha256Hex(responseJson),
    };
    const getInstructions =
        internal.execution.invocationLifecycle.replyInstructionPage;
    const firstPage = await t.run((ctx) =>
        ctx.runQuery(
            getInstructions,
            { ...replyScope, paginationOpts: { cursor: null, numItems: 1 } },
            { transactionLimits: { bytesRead: 16 * 1024 } },
        ),
    );
    expect(firstPage?.page).toHaveLength(1);
    assert(firstPage && !firstPage.isDone);
    const secondPage = await t.run((ctx) =>
        ctx.runQuery(
            getInstructions,
            {
                ...replyScope,
                paginationOpts: {
                    cursor: firstPage.continueCursor,
                    numItems: 1,
                },
            },
            { transactionLimits: { bytesRead: 16 * 1024 } },
        ),
    );
    const wording = "w".repeat(40_000);
    expect(secondPage?.page).toEqual([
        { messageId, contentHash: sha256Hex(wording) },
    ]);
    const fragment =
        internal.execution.invocationLifecycle.replyInstructionFragment;
    await expect(
        t.query(fragment, {
            ...replyScope,
            messageId,
            contentHash: sha256Hex(wording),
            index: 0,
        }),
    ).resolves.toMatchObject({
        content: wording,
        characters: wording.length,
        fragmentCount: 1,
    });
    await expect(
        t.query(fragment, {
            ...replyScope,
            messageId,
            contentHash: sha256Hex("different"),
            index: 0,
        }),
    ).rejects.toThrow("conversation_message_unavailable");
    await expect(
        t.query(getInstructions, {
            ...replyScope,
            responseHash: sha256Hex("different"),
            paginationOpts: { cursor: null, numItems: 1 },
        }),
    ).resolves.toBeNull();
    const exactRevision = await t.run(async (ctx) => {
        const run = await ctx.db.get(runId);
        const mission = await ctx.db.get(active.missionId);
        assert(run && mission);
        const facts = await readWorkbenchFacts(ctx, run, mission);
        assert(facts.kind === "ready");
        return facts.context.factsRevisionHash;
    });
    const preparedReply = await t.action((ctx) =>
        preparePiReply(
            ctx,
            { invocationId, expectedGeneration: 1 },
            response,
            responseJson,
            getAgentDefinition("workbench_v1", 12),
        ),
    );
    if (framingCorrection) {
        assert(preparedReply && "correctionWording" in preparedReply);
        const corrected = await t.run((ctx) =>
            ctx.runMutation(
                internal.execution.invocations.finish,
                {
                    invocationId,
                    expectedGeneration: 1,
                    response,
                    correctionWording: preparedReply.correctionWording,
                },
                { transactionLimits: { bytesRead: 38 * 1024 } },
            ),
        );
        expect(corrected).toMatchObject({
            kind: "blocked",
            code: "completion_correction_required",
            correction: { code: "framing_program_required" },
        });
        expect(await t.run((ctx) => ctx.db.get(active.turnId))).toMatchObject({
            status: "active",
        });
        return;
    }
    assert(preparedReply && "textId" in preparedReply && preparedReply.wording);
    expect(preparedReply.wording).toContainEqual(
        expect.objectContaining({
            messageId,
            contentHash: sha256Hex(wording),
        }),
    );
    expect(
        preparedReply.wording.every((message) => message.text === undefined),
    ).toBe(true);
    await expect(
        t.query(internal.execution.invocationLifecycle.replyPreparation, {
            ...replyScope,
            wording: preparedReply.wording.map((message) =>
                message.messageId === messageId
                    ? { ...message, contentHash: sha256Hex("different") }
                    : message,
            ),
        }),
    ).resolves.toBeNull();
    const basis = await t.run((ctx) =>
        ctx.runQuery(
            internal.execution.invocationLifecycle.replyPreparation,
            { ...replyScope, wording: preparedReply.wording },
            { transactionLimits: { bytesRead: 38 * 1024 } },
        ),
    );
    expect(basis).toMatchObject({
        basisHash: preparedReply.basisHash,
        confirmationOnly: false,
    });
    const finished = await t.run((ctx) =>
        ctx.runMutation(
            internal.execution.invocations.finish,
            { invocationId, expectedGeneration: 1, preparedReply },
            { transactionLimits: { bytesRead: 38 * 1024 } },
        ),
    );
    expect(finished).toMatchObject({ kind: "completed" });
    const turn = await t.run((ctx) => ctx.db.get(active.turnId));
    expect(turn?.responseControl).toMatchObject({
        factsRevisionHash: exactRevision,
        checks: [],
    });
    const history = await client.query(
        api.execution.conversations.listMessages,
        {
            runId,
            paginationOpts: { cursor: null, numItems: 5 },
        },
    );
    expect(history.page).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ _id: messageId, text: wording }),
            expect.objectContaining({ role: "assistant", text: response.text }),
        ]),
    );
});

test("Workbench context reuses exact wording for a retained request from the active turn", async () => {
    const { t, runId, client } = await seedWorkbench(true);
    const wording = "a".repeat(25_000);
    const messageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId,
            requestKey: "overlapping-original",
            text: wording,
            delivery: "queue",
        },
    );
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(active);
    await t.run(async (ctx) => {
        const frame = await ctx.db.insert("framingRevisions", {
            runId,
            revision: 1,
            content: { scope: "Workflow", questions: [] },
            requestKey: "overlap-frame",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        const requestId = await ctx.db.insert("agentOperationRequests", {
            runId,
            actor: "agent",
            missionId: active.missionId,
            cause: "overlap-request",
            input: {
                kind: "transmit_source_request",
                messageId,
                interpretedNeed: "Supplier evidence",
                coverageRole: null,
            },
            operationVersion: 1,
            expectedGeneration: 1,
            logicalKey: "overlap-request",
            status: "completed",
            createdAt: 1,
        });
        const mission = await ctx.db.get(active.missionId);
        assert(mission);
        await recordMissionEvent(ctx, mission, {
            kind: "operation_requested",
            cause: "overlap-request",
            requestId,
            messageId,
            interpretedNeed: "Supplier evidence",
        });
        await ctx.db.insert("workbenchInstructions", {
            runId,
            requestId,
            messageId,
            framingRevisionId: frame,
            interpretedNeed: "Supplier evidence",
            status: "waiting",
            outcome: "Waiting",
            createdAt: 1,
        });
    });
    const result = await t.run((ctx) =>
        ctx.runQuery(
            internal.execution.context.build,
            { missionId: active.missionId, expectedGeneration: 1 },
            { transactionLimits: { bytesRead: 45 * 1024 } },
        ),
    );
    assert(result.kind === "ready");
    const context = JSON.parse(result.inputJson);
    expect(context.domain.analystRequests).toMatchObject([
        {
            messageId,
            originalText: wording,
            interpretedNeed: "Supplier evidence",
            status: "waiting",
        },
    ]);
    expect(context.triggeringRequestsAndResults).toContainEqual(
        expect.objectContaining({
            analystInstruction: {
                messageId,
                originalText: wording,
                interpretedNeed: "Supplier evidence",
            },
        }),
    );
    expect(context.conversationInstructions.messages).toContainEqual(
        expect.objectContaining({
            messageId,
            text: wording,
        }),
    );
});
