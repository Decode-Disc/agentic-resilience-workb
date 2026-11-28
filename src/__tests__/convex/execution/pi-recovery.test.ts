import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { agentToolSchemas } from "@convex/execution/agentDefinition";
import { invokeControlledGeneration } from "@convex/execution/invokeAgentModel";
import { contextObservationSequence } from "@convex/execution/journal";
import { stageObservedBody } from "@convex/execution/observedReply";
import {
    retainedTextParts,
    stageRetainedText,
} from "@convex/execution/retainedText";
import {
    agentToolSetKey,
    piInstructionSection,
} from "@convex/integrations/modelInput";
import { NATIVE_MODEL_SERIALIZER } from "@convex/integrations/modelRouting";
import {
    lookupPiOperation,
    recoverHistoricalCompletion,
} from "@convex/integrations/piInvocation";
import { openMissionPiStorage } from "@convex/integrations/piStorage";
import { PI_SESSION_MAX_BYTES } from "@convex/resourcePolicy";
import schema from "@convex/schema";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import { convexTest } from "convex-test";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    claimFixturePiLease,
    dispatchFixtureOperation,
    retainFixtureOutput,
    seedPiMission,
} from "@/__tests__/setup/pi-mission";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test("native operation lookup skips a large historical completion that has no requests", async () => {
    const { t, missionId } = await seedPiMission(
        convexTest({
            schema,
            modules: import.meta.glob("/convex/**/*.ts"),
            transactionLimits: { bytesRead: 128 * 1024 },
        }),
    );
    const scope = { missionId, expectedGeneration: 4 };
    const begun = await t.mutation(internal.execution.invocations.begin, {
        ...scope,
        piLease: await claimFixturePiLease(t, missionId, 4),
        taskKey: "historical-no-requests",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const { manifest, parts } = retainedTextParts(
        JSON.stringify({
            kind: "complete",
            text: "a".repeat(175_000),
        }),
    );
    let textId: Id<"retainedTexts"> | undefined;
    for (const [index, content] of parts.entries())
        textId = await t.run((ctx) =>
            stageRetainedText(
                ctx,
                `${begun.invocationId}:response:${manifest.contentHash}`,
                { ...manifest, index, content },
            ),
        );
    assert(textId);
    await t.run((ctx) =>
        ctx.db.patch(begun.invocationId, {
            status: "returned",
            requestIds: [],
            outputTextId: textId,
        }),
    );
    await expect(
        t.query(internal.execution.piControlReads.operation, {
            ...scope,
            callId: "no-associated-operation",
        }),
    ).resolves.toBeNull();
});

test("compaction settlement preserves an oversized historical refusal through its recovered digest", async () => {
    const { t, missionId } = await seedPiMission(
        convexTest({
            schema,
            modules: import.meta.glob("/convex/**/*.ts"),
            transactionLimits: { bytesRead: 128 * 1024 },
        }),
    );
    const begun = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        piLease: await claimFixturePiLease(t, missionId, 4),
        taskKey: "historical-compaction",
        purpose: "compaction",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const response = `{"kind":"blocked",${" ".repeat(175_000)}"code":"invalid_output"}`;
    const { manifest, parts } = retainedTextParts(response);
    let textId: Id<"retainedTexts"> | undefined;
    for (const [index, content] of parts.entries())
        textId = await t.run((ctx) =>
            stageRetainedText(
                ctx,
                `${begun.invocationId}:response:${manifest.contentHash}`,
                { ...manifest, index, content },
            ),
        );
    assert(textId);
    await t.run((ctx) =>
        ctx.db.patch(begun.invocationId, { receivedOutputTextId: textId }),
    );
    const finish = internal.execution.piControl.finishAuxiliary;
    const args = { invocationId: begun.invocationId, expectedGeneration: 4 };
    await expect(t.mutation(finish, args)).rejects.toMatchObject({
        data: { code: "retained_response_invalid" },
    });
    await expect(
        t.mutation(finish, {
            ...args,
            recovered: { responseHash: "wrong-response" },
        }),
    ).rejects.toMatchObject({ data: { code: "invocation_result_conflict" } });
    await expect(
        t.mutation(finish, {
            ...args,
            recovered: {
                responseHash: manifest.contentHash,
                refusalCode: "invalid_output",
            },
        }),
    ).rejects.toMatchObject({ data: { code: "invalid_output" } });
    expect(await t.run((ctx) => ctx.db.get(begun.invocationId))).toMatchObject({
        status: "started",
    });
});

test("a late wake closes an expired mission explicitly without provider work", async () => {
    const { t, missionId } = await seedPiMission();
    await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
        simulation: true,
    });
    const scheduled = await t.run((ctx) => ctx.db.get(missionId));
    if (!scheduled?.piWakeToken) throw new Error("Expected worker wake");
    vi.setSystemTime(scheduled.deadlineAt + 1);
    await t.action(internal.execution.piWorker.run, {
        missionId,
        expectedGeneration: 4,
        token: scheduled.piWakeToken,
    });
    const observed = await t.run(async (ctx) => ({
        mission: await ctx.db.get(missionId),
        events: await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_sequence", (q) =>
                q.eq("missionId", missionId),
            )
            .collect(),
        calls: await ctx.db.query("providerCalls").collect(),
    }));
    expect(observed.mission).toMatchObject({
        status: "blocked",
        blockCode: "execution_deadline",
    });
    expect(observed.mission?.piWakeId).toBeUndefined();
    expect(observed.events).toContainEqual(
        expect.objectContaining({
            kind: "mission_blocked",
            code: "execution_deadline",
        }),
    );
    expect(observed.calls).toEqual([]);
});

test("a session beyond cumulative retained capacity blocks permanently before replay or provider work", async () => {
    const { t, missionId } = await seedPiMission();
    const lease = await t.mutation(internal.execution.piStore.claim, {
        missionId,
        expectedGeneration: 4,
        writer: "retained-history",
    });
    // An unsupported retained log must stop explicitly when opened, without rewriting its originals.
    const payload = "[]";
    await t.run(async (ctx) => {
        await ctx.db.insert("piCommits", {
            sessionId: lease.sessionId,
            sequence: 1,
            key: "oversized-original",
            payload,
        });
        await ctx.db.patch(lease.sessionId, {
            sequence: 1,
            retainedBytes: PI_SESSION_MAX_BYTES + 1,
            leaseUntil: Date.now() - 1,
        });
    });
    await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
        simulation: true,
    });
    const mission = await t.run((ctx) => ctx.db.get(missionId));
    if (!mission?.piWakeToken) throw new Error("Expected worker wake");
    await expect(
        t.action(internal.execution.piWorker.run, {
            missionId,
            expectedGeneration: 4,
            token: mission.piWakeToken,
        }),
    ).resolves.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        status: "blocked",
        blockCode: "pi_storage_capacity",
    });
    await expect(
        t.mutation(internal.execution.missions.resume, {
            missionId,
            expectedGeneration: 4,
            simulation: true,
        }),
    ).rejects.toThrow("pi_storage_capacity");
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("piCommits")
                .withIndex("by_session_and_sequence", (q) =>
                    q.eq("sessionId", lease.sessionId),
                )
                .collect(),
        ),
    ).toEqual([expect.objectContaining({ sequence: 1, payload })]);
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
}, 30000);

test("replay renews its fenced writer lease while loading multiple pages", async () => {
    vi.useFakeTimers();
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "slow-replay",
        expectedGeneration: 4,
    });
    const writer = "slow-replay";
    const lease = await t.mutation(internal.execution.piStore.claim, {
        missionId,
        expectedGeneration: 4,
        writer,
    });
    for (let sequence = 1; sequence <= 96; sequence++)
        await t.mutation(internal.execution.piStore.append, {
            ...lease,
            sequence,
            key: `commit-${sequence}`,
            payload: JSON.stringify([
                sequence === 1
                    ? {
                          type: "conversation",
                          value: { id: ROOT_CONVERSATION_ID },
                      }
                    : {
                          type: "entry",
                          value: {
                              id: sequence + 1,
                              conversationId: ROOT_CONVERSATION_ID,
                              kind: "workbench.original",
                              data: { text: "x".repeat(128 * 1024) },
                          },
                      },
            ]),
        });
    await t.action(async (ctx) => {
        let pages = 0;
        const delayed: typeof ctx = {
            ...ctx,
            runQuery: async (...call) => {
                pages++;
                vi.setSystemTime(Date.now() + 20000);
                return ctx.runQuery(...call);
            },
        };
        const startedAt = Date.now();
        const storage = await openMissionPiStorage(
            delayed,
            missionId,
            4,
            writer,
            BACKGROUND_CONTEXT,
        );
        try {
            expect(pages).toBeGreaterThan(4);
            expect(Date.now() - startedAt).toBe(pages * 20000);
            expect(
                await storage.conversation(
                    ROOT_CONVERSATION_ID,
                    BACKGROUND_CONTEXT,
                ),
            ).toMatchObject({ id: ROOT_CONVERSATION_ID });
            await expect(storage.mintId()).resolves.toBe(98);
            await expect(storage.renewLease()).resolves.toBeUndefined();
        } finally {
            await storage.close(BACKGROUND_CONTEXT);
        }
    });
}, 30000);

test("permanent native-tail failure preserves published work without scheduling another writer", async () => {
    const { t, runId, client } = await seedWorkbench(true);
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
    const lease = await t.mutation(internal.execution.piStore.claim, {
        missionId: active.missionId,
        expectedGeneration: 1,
        writer: "probe-0",
    });
    await t.run(async (ctx) => {
        await ctx.db.patch(active.missionId, {
            status: "completed",
            piActiveWriter: "probe-0",
            deadlineAt: Date.now() - 1,
        });
        await ctx.db.patch(lease.sessionId, {
            sequence: 1,
            settledSequence: 0,
        });
    });
    await t.mutation(internal.execution.piControl.closeWorker, {
        missionId: active.missionId,
        expectedGeneration: 1,
        writer: "probe-0",
        error: "publication_context_unavailable",
    });
    const failed = await t.run((ctx) => ctx.db.get(active.missionId));
    expect(failed?.status).toBe("completed");
    expect(failed?.piWakeToken).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get(lease.sessionId))).toMatchObject({
        settlementFailureCode: "publication_context_unavailable",
    });
    expect(
        await client.query(api.execution.conversations.get, { runId }),
    ).toMatchObject({
        queuePaused: true,
        admissionFailure: { code: "native_settlement_incomplete" },
    });
    await expect(
        client.mutation(api.execution.conversations.resumeQueue, { runId }),
    ).rejects.toThrow("native_settlement_incomplete");
});

test("native settlement retries are bounded and back off without losing a completed result", async () => {
    const { t, runId } = await seedWorkbench(true);
    const turn = await t.mutation(internal.execution.conversations.startTurn, {
        runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        simulation: true,
    });
    assert(turn);
    const lease = await t.mutation(internal.execution.piStore.claim, {
        missionId: turn.missionId,
        expectedGeneration: 1,
        writer: "tail-retry",
    });
    await t.run(async (ctx) => {
        await ctx.db.patch(turn.missionId, {
            status: "completed",
            piActiveWriter: "tail-retry",
        });
        await ctx.db.patch(lease.sessionId, {
            sequence: 1,
            settledSequence: 0,
        });
    });
    for (let attempt = 1; attempt <= 3; attempt++) {
        const writer = attempt === 1 ? "tail-retry" : `tail-retry-${attempt}`;
        await t.mutation(internal.execution.piStore.claim, {
            missionId: turn.missionId,
            expectedGeneration: 1,
            writer,
        });
        await t.run((ctx) =>
            ctx.db.patch(turn.missionId, { piActiveWriter: writer }),
        );
        await t.mutation(internal.execution.piControl.closeWorker, {
            missionId: turn.missionId,
            expectedGeneration: 1,
            writer,
            error: "execution_interrupted",
        });
        const mission = await t.run((ctx) => ctx.db.get(turn.missionId));
        expect(mission?.status).toBe("completed");
        if (attempt < 3)
            expect(mission?.piWakeAt).toBe(
                Date.now() + 1000 * 2 ** (attempt - 1),
            );
        else expect(mission?.piWakeToken).toBeUndefined();
    }
    expect(await t.run((ctx) => ctx.db.get(lease.sessionId))).toMatchObject({
        settlementFailureCode: "native_settlement_incomplete",
        settlementAttempts: 3,
    });
});

test("successful native settlement clears the retry count for the next response", async () => {
    const { t, runId } = await seedWorkbench(true);
    const turn = await t.mutation(internal.execution.conversations.startTurn, {
        runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        simulation: true,
    });
    assert(turn);
    const lease = await t.mutation(internal.execution.piStore.claim, {
        missionId: turn.missionId,
        expectedGeneration: 1,
        writer: "tail-success",
    });
    await t.run(async (ctx) => {
        await ctx.db.patch(turn.missionId, {
            status: "completed",
            piActiveWriter: "tail-success",
        });
        await ctx.db.patch(lease.sessionId, {
            sequence: 2,
            settledSequence: 1,
            settlementAttempts: 2,
        });
    });
    await t.mutation(internal.execution.piControl.closeWorker, {
        missionId: turn.missionId,
        expectedGeneration: 1,
        writer: "tail-success",
        nativeSettled: true,
    });
    expect(await t.run((ctx) => ctx.db.get(lease.sessionId))).toMatchObject({
        settledSequence: 2,
    });
    expect(
        (await t.run((ctx) => ctx.db.get(lease.sessionId)))?.settlementAttempts,
    ).toBeUndefined();
});

test("replaying a worker closure does not consume another native settlement attempt", async () => {
    const { t, runId } = await seedWorkbench(true);
    const turn = await t.mutation(internal.execution.conversations.startTurn, {
        runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        simulation: true,
    });
    assert(turn);
    const lease = await t.mutation(internal.execution.piStore.claim, {
        missionId: turn.missionId,
        expectedGeneration: 1,
        writer: "closure-replay",
    });
    await t.run(async (ctx) => {
        await ctx.db.patch(turn.missionId, {
            status: "completed",
            piActiveWriter: "closure-replay",
        });
        await ctx.db.patch(lease.sessionId, {
            sequence: 1,
            settledSequence: 0,
        });
    });
    const args = {
        missionId: turn.missionId,
        expectedGeneration: 1,
        writer: "closure-replay",
        error: "execution_interrupted",
    };
    await t.mutation(internal.execution.piControl.closeWorker, args);
    const first = await t.run((ctx) => ctx.db.get(turn.missionId));
    await t.mutation(internal.execution.piControl.closeWorker, args);
    expect(await t.run((ctx) => ctx.db.get(lease.sessionId))).toMatchObject({
        settlementAttempts: 1,
    });
    expect(await t.run((ctx) => ctx.db.get(turn.missionId))).toEqual(first);
});

test("an acknowledged read receipt survives an expired Pi writer and replays exact retained bytes", async () => {
    const f = await seedPiMission();
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "receipt-reopen",
            input: { kind: "consult_mission_state" },
        },
    );
    const original = await dispatchFixtureOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    assert(original.kind === "success");
    const before = await f.t.run((ctx) => ctx.db.get(requestId));
    assert(before?.historyRead);
    // The first host disappears without closing; replacement acquires a later epoch after expiry.
    await f.t.action((ctx) =>
        openMissionPiStorage(
            ctx,
            f.missionId,
            4,
            "crashed-reader",
            BACKGROUND_CONTEXT,
        ).then(() => null),
    );
    vi.advanceTimersByTime(91_000);
    await f.t.action(async (ctx) => {
        const reopened = await openMissionPiStorage(
            ctx,
            f.missionId,
            4,
            "reopened-reader",
            BACKGROUND_CONTEXT,
        );
        await reopened.close(BACKGROUND_CONTEXT);
    });
    expect(
        await dispatchFixtureOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toEqual(original);
    expect(
        (await f.t.run((ctx) => ctx.db.get(requestId)))?.historyRead,
    ).toEqual(before.historyRead);
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});

test("a retained continuation is refused after a new execution generation", async () => {
    const f = await seedPiMission();
    const { recordMissionEvent } = await import("@convex/execution/authority");
    await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        await recordMissionEvent(ctx, mission, {
            kind: "retained_evidence",
            cause: "generation",
            historySource: "material",
            observation: { text: "Original evidence. ".repeat(4000) },
        });
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "before-rebind",
            input: { kind: "consult_mission_state" },
        },
    );
    const first = await dispatchFixtureOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    assert(first.kind === "success");
    const cursor = JSON.parse(first.valueJson).history.continueCursor;
    assert(typeof cursor === "string");
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, { executionGeneration: 5 });
        await ctx.db.patch(f.missionId, { generation: 5 });
    });
    const next = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 5,
        cause: "after-rebind",
        input: { kind: "consult_mission_state", cursor },
    });
    expect(
        await dispatchFixtureOperation(f.t, {
            requestId: next,
            expectedGeneration: 5,
        }),
    ).toEqual({ kind: "refused", code: "history_cursor_invalid" });
});

test.each([
    "generation_return",
    "completion_tool_execution",
    "tool_acknowledgement",
    "worker_close",
] as const)("native_tool completion recovers without provider redispatch or duplicate domain result after crash at %s", async (boundary) => {
    const { runPiMission } = await import("@convex/integrations/piMission");
    const { nodeActionGenerationDeadline } = await import(
        "@convex/resourcePolicy"
    );
    const { getFunctionName } = await import("convex/server");
    const { installModel } = await import(
        "@/__tests__/setup/model-configuration"
    );
    const { nativePiFixtureRoute } = await import(
        "@/__tests__/setup/pi-native"
    );

    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const f = await seedInspectedEvidence();
    await installModel(f.t, nativePiFixtureRoute, "saved_material_inspection");
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.args.runId,
        corpusRevisionId: f.args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: `crash-boundary-${boundary}`,
        expectedGeneration: 4,
    });
    const initial = await f.t.query(internal.execution.context.build, {
        missionId,
        expectedGeneration: 4,
    });
    assert(initial.kind === "ready");
    const parsed = JSON.parse(initial.inputJson);
    const captureId: string = parsed.domain.availableMaterials[0].captureId;
    const readingReference: string =
        parsed.domain.availableMaterials[0].readingReferences[0].reference;
    const preRead = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 4,
        cause: "pre-read-crash",
        input: { kind: "read_in_context", reference: readingReference },
    });
    expect(
        (
            await dispatchFixtureOperation(f.t, {
                requestId: preRead,
                expectedGeneration: 4,
            })
        ).kind,
    ).toBe("success");

    const network = vi.fn(
        async () =>
            new Response(
                [
                    `data: ${JSON.stringify({
                        id: `crash-${boundary}`,
                        choices: [
                            {
                                index: 0,
                                delta: {
                                    role: "assistant",
                                    content: "Submitting verified capture.",
                                    tool_calls: [
                                        {
                                            index: 0,
                                            id: `call_${boundary}`,
                                            type: "function",
                                            function: {
                                                name: "submit_completion",
                                                arguments: JSON.stringify({
                                                    kind: "complete",
                                                    captureIds: [captureId],
                                                }),
                                            },
                                        },
                                    ],
                                },
                                finish_reason: null,
                            },
                        ],
                    })}`,
                    `data: ${JSON.stringify({
                        id: `crash-${boundary}`,
                        choices: [
                            {
                                index: 0,
                                delta: {},
                                finish_reason: "tool_calls",
                            },
                        ],
                        usage: {
                            prompt_tokens: 14,
                            completion_tokens: 7,
                            total_tokens: 21,
                        },
                    })}`,
                    "data: [DONE]",
                    "",
                ].join("\n\n"),
                { headers: { "content-type": "text/event-stream" } },
            ),
    );
    vi.stubGlobal("fetch", network);

    const finishName = getFunctionName(internal.execution.invocations.finish);
    const appendName = getFunctionName(internal.execution.piStore.append);
    const dispositionName = getFunctionName(
        internal.execution.piControlReads.completionDisposition,
    );
    const terminalAcceptedName = getFunctionName(
        internal.execution.piControlReads.terminalCompletionAccepted,
    );
    const closeWorkerName = getFunctionName(
        internal.execution.piControl.closeWorker,
    );

    await f.t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
        simulation: false,
    });
    let finishCommitted = false;
    let crashed = false;
    const writer1 = `crash-writer-1-${boundary}`;
    await f.t.mutation(internal.execution.piStore.claim, {
        missionId,
        expectedGeneration: 4,
        writer: writer1,
    });
    await f.t.run((ctx) =>
        ctx.db.patch(missionId, { piActiveWriter: writer1 }),
    );
    await expect(
        f.t.action(async (ctx) => {
            const crashingCtx: typeof ctx = {
                ...ctx,
                runQuery: async (ref, ...rest) => {
                    const name = getFunctionName(ref);
                    if (
                        boundary === "completion_tool_execution" &&
                        name === dispositionName &&
                        !crashed
                    ) {
                        crashed = true;
                        throw new Error(`injected_crash:${boundary}`);
                    }
                    if (
                        boundary === "tool_acknowledgement" &&
                        name === terminalAcceptedName &&
                        !crashed
                    ) {
                        crashed = true;
                        throw new Error(`injected_crash:${boundary}`);
                    }
                    return ctx.runQuery(ref, ...rest);
                },
                runMutation: async (ref, ...rest) => {
                    const name = getFunctionName(ref);
                    if (
                        boundary === "generation_return" &&
                        finishCommitted &&
                        name === appendName
                    ) {
                        crashed = true;
                        throw new Error(`injected_crash:${boundary}`);
                    }
                    if (
                        boundary === "worker_close" &&
                        name === closeWorkerName &&
                        !crashed
                    ) {
                        crashed = true;
                        throw new Error(`injected_crash:${boundary}`);
                    }
                    const result = await ctx.runMutation(ref, ...rest);
                    if (name === finishName) finishCommitted = true;
                    return result;
                },
            };
            await runPiMission(
                crashingCtx,
                { missionId, expectedGeneration: 4 },
                writer1,
                nodeActionGenerationDeadline(Date.now()),
            );
        }),
    ).rejects.toThrow(`injected_crash:${boundary}`);

    expect(crashed).toBe(true);
    expect(network).toHaveBeenCalledOnce();
    const mid = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(missionId),
        session: await ctx.db
            .query("piSessions")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .unique(),
    }));
    expect(mid.mission).toMatchObject({
        status: "completed",
        result: {
            kind: "saved_material_inspection_v1",
            captureIds: [captureId],
        },
    });
    expect(mid.session?.settledSequence).toBeUndefined();

    // Advance past lease expiry and reopen a fresh recovery worker with network forbidden.
    vi.advanceTimersByTime(91_000);
    const noRedispatch = vi.fn(async () => {
        throw new Error("provider_redispatch_forbidden");
    });
    vi.stubGlobal("fetch", noRedispatch);
    const writer2 = `recovery-writer-2-${boundary}`;
    await f.t.mutation(internal.execution.piStore.claim, {
        missionId,
        expectedGeneration: 4,
        writer: writer2,
    });
    await f.t.run((ctx) =>
        ctx.db.patch(missionId, { piActiveWriter: writer2 }),
    );
    await f.t.action((ctx) =>
        runPiMission(
            ctx,
            { missionId, expectedGeneration: 4 },
            writer2,
            nodeActionGenerationDeadline(Date.now()),
        ),
    );

    expect(noRedispatch).not.toHaveBeenCalled();
    const after = await f.t.run(async (ctx) => {
        const session = await ctx.db
            .query("piSessions")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .unique();
        return {
            mission: await ctx.db.get(missionId),
            session,
            calls: await ctx.db.query("providerCalls").collect(),
            invocations: await ctx.db
                .query("agentInvocations")
                .withIndex("by_mission", (q) => q.eq("missionId", missionId))
                .collect(),
            completedEvents: await ctx.db
                .query("agentExecutionEvents")
                .withIndex("by_mission_and_kind", (q) =>
                    q
                        .eq("missionId", missionId)
                        .eq("kind", "mission_completed"),
                )
                .collect(),
            commits: session
                ? await ctx.db
                      .query("piCommits")
                      .withIndex("by_session_and_sequence", (q) =>
                          q.eq("sessionId", session._id),
                      )
                      .collect()
                : [],
        };
    });
    expect(after.mission).toMatchObject({
        status: "completed",
        result: {
            kind: "saved_material_inspection_v1",
            captureIds: [captureId],
        },
    });
    expect(after.session?.settledSequence).toBe(after.session?.sequence);
    expect(after.session?.settlementFailureCode).toBeUndefined();
    expect(after.calls).toHaveLength(1);
    expect(after.calls[0]?.status).toBe("succeeded");
    expect(after.invocations).toHaveLength(1);
    expect(after.completedEvents).toHaveLength(1);
    const allCommitPayloads = after.commits.map((c) => c.payload).join("\n");
    expect(allCommitPayloads).toContain(`call_${boundary}`);
    expect(allCommitPayloads).toContain('{\\"kind\\":\\"accepted\\"}');
}, 30000);

test("cancelled structured settlement fences inspection and cannot settle or schedule a wake", async () => {
    const { needsNativeSettlement } = await import(
        "@convex/execution/piSession"
    );
    vi.useFakeTimers();

    const cancelledFixture = await seedInspectedEvidence();
    const cancelledMissionId = await cancelledFixture.t.mutation(
        internal.execution.missions.start,
        {
            runId: cancelledFixture.args.runId,
            corpusRevisionId: cancelledFixture.args.corpusRevisionId,
            definitionId: "saved_material_inspection_v1",
            requestKey: "cancelled-structured-fence",
            expectedGeneration: 4,
        },
    );
    await cancelledFixture.t.run((ctx) =>
        ctx.db.patch(cancelledMissionId, { definitionVersion: 5 }),
    );
    const cancelledLease = await cancelledFixture.t.mutation(
        internal.execution.piStore.claim,
        {
            missionId: cancelledMissionId,
            expectedGeneration: 4,
            writer: "cancelled-writer",
        },
    );
    await cancelledFixture.t.run(async (ctx) => {
        await ctx.db.patch(cancelledMissionId, {
            status: "cancelled",
            piActiveWriter: "cancelled-writer",
        });
        await ctx.db.patch(cancelledLease.sessionId, { sequence: 2 });
    });
    const cancelledCheck = await cancelledFixture.t.run(async (ctx) => {
        const mission = await ctx.db.get(cancelledMissionId);
        const session = await ctx.db.get(cancelledLease.sessionId);
        assert(mission && session);
        return needsNativeSettlement(mission, session);
    });
    expect(cancelledCheck).toBe(false);
    await expect(
        cancelledFixture.t.query(
            internal.execution.piControlReads.completionDisposition,
            { ...cancelledLease, callId: "any" },
        ),
    ).rejects.toThrow("pi_writer_fenced");
    await expect(
        cancelledFixture.t.query(
            internal.execution.piControlReads.terminalCompletionAccepted,
            cancelledLease,
        ),
    ).rejects.toThrow("pi_writer_fenced");
    await expect(
        cancelledFixture.t.query(
            internal.execution.piControlReads.nativeInvocation,
            {
                missionId: cancelledMissionId,
                expectedGeneration: 4,
                sessionId: cancelledLease.sessionId,
                taskKey: "pi:1:1:summary",
            },
        ),
    ).rejects.toThrow("pi_writer_fenced");
    await cancelledFixture.t.mutation(
        internal.execution.piControl.closeWorker,
        {
            missionId: cancelledMissionId,
            expectedGeneration: 4,
            writer: "cancelled-writer",
            nativeSettled: true,
        },
    );
    const cancelledSessionAfter = await cancelledFixture.t.run((ctx) =>
        ctx.db.get(cancelledLease.sessionId),
    );
    expect(cancelledSessionAfter?.settledSequence).toBeUndefined();
    expect(
        (await cancelledFixture.t.run((ctx) => ctx.db.get(cancelledMissionId)))
            ?.piWakeToken,
    ).toBeUndefined();
});

test("native recovery correlates mixed calls when original operation arguments exceed one read budget", async () => {
    const t = convexTest({
        schema,
        modules: import.meta.glob("/convex/**/*.ts"),
        transactionLimits: { bytesRead: 128 * 1024 },
    });
    const f = await seedInspectedEvidence({}, t);
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: f.args.runId,
        corpusRevisionId: f.args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "large-native-operations",
        expectedGeneration: 4,
    });
    const scope = { missionId, expectedGeneration: 4 };
    const context = await t.query(internal.execution.context.build, scope);
    assert(context.kind === "ready");
    const material = JSON.parse(context.inputJson).domain.availableMaterials[0];
    const reference = material.readingReferences[0].reference;
    const lease = await t.mutation(internal.execution.piStore.claim, {
        ...scope,
        writer: "native-operations",
    });
    const begun = await t.mutation(internal.execution.invocations.begin, {
        ...scope,
        piLease: {
            sessionId: lease.sessionId,
            writer: lease.writer,
            epoch: lease.epoch,
        },
        piSessionId: lease.sessionId,
        taskKey: "large-native-operations",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const response = {
        kind: "operations" as const,
        requests: [
            {
                callId: "read",
                name: "read_in_context",
                inputJson: `${" ".repeat(160_000)}${JSON.stringify({ reference })}`,
            },
            { callId: "mixed", name: "submit_completion", inputJson: "{}" },
        ],
    };
    const observedScope = {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
    };
    const responseTextId = await t.action((ctx) =>
        stageObservedBody(
            ctx,
            observedScope,
            "response",
            stableStringify(response),
        ),
    );
    assert(responseTextId);
    const observableReplyTextId = await t.action((ctx) =>
        stageObservedBody(
            ctx,
            observedScope,
            "reply",
            stableStringify({ version: 1, provenance: "simulation", response }),
        ),
    );
    assert(observableReplyTextId);
    await retainFixtureOutput(t, {
        ...observedScope,
        responseTextId,
        observableReplyTextId,
    });
    const finished = await t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        response,
    });
    expect(finished.kind).toBe("waiting");
    await expect(
        t.query(internal.execution.piControlReads.operation, {
            ...scope,
            callId: "read",
        }),
    ).resolves.toMatchObject({
        _id: finished.requestIds[0],
        input: { kind: "read_in_context", reference },
    });
    await expect(
        t.query(internal.execution.piControlReads.completionDisposition, {
            ...lease,
            callId: "mixed",
        }),
    ).resolves.toEqual({
        kind: "operation",
        requestId: finished.requestIds[1],
    });
    await expect(
        t.query(internal.execution.piControlReads.completionDisposition, {
            ...lease,
            callId: "read",
        }),
    ).rejects.toThrow("completion_correlation_invalid");
    await expect(
        t.mutation(internal.execution.piControl.retireForRepreparation, {
            invocationId: begun.invocationId,
            expectedGeneration: 4,
        }),
    ).rejects.toThrow("attempt_outcome_unknown");
    const next = await t.query(internal.execution.context.build, scope);
    assert(next.kind === "ready");
    const retainedContext = JSON.parse(next.inputJson);
    expect(retainedContext.triggeringRequestsAndResults).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                callId: "read",
                requestId: finished.requestIds[0],
            }),
            expect.objectContaining({
                callId: "mixed",
                requestId: finished.requestIds[1],
            }),
        ]),
    );
    const historyReference =
        retainedContext.lastObservableInvocation?.historyReference;
    expect(historyReference).toBeDefined();
    await t.run(async (ctx) => {
        const event = await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_invocation_and_kind", (q) =>
                q
                    .eq("invocationId", begun.invocationId)
                    .eq("kind", "invocation_returned"),
            )
            .unique();
        assert(event?.payload?.json);
        expect(historyReference).toBe(event._id);
        expect(JSON.parse(event.payload.json).response).toEqual({
            kind: "retained_invocation_response",
            invocationId: begun.invocationId,
            contentHash: sha256Hex(stableStringify(response)),
        });
    });
    await t.run(async (ctx) => {
        const invocation = await ctx.db.get(begun.invocationId);
        assert(invocation?.nativeOperations);
        await ctx.db.patch(invocation._id, {
            nativeOperations: {
                ...invocation.nativeOperations,
                responseHash: "wrong-response",
            },
        });
    });
    await expect(
        t.query(internal.execution.piControlReads.operation, {
            ...scope,
            callId: "read",
        }),
    ).rejects.toThrow("invocation_result_conflict");
    // Re-create the earlier storage shape with a separate adopted operation response.
    await t.run(async (ctx) => {
        const invocation = await ctx.db.get(begun.invocationId);
        assert(invocation?.receivedOutputTextId);
        await ctx.db.patch(invocation._id, {
            nativeOperations: undefined,
            outputTextId: undefined,
            outputJson: JSON.stringify({
                ...response,
                requests: response.requests.map((request) => ({
                    ...request,
                    inputJson: request.inputJson.trim(),
                })),
            }),
        });
    });
    await expect(
        t.query(internal.execution.piControlReads.operation, {
            ...scope,
            callId: "read",
        }),
    ).resolves.toMatchObject({
        _id: finished.requestIds[0],
        input: { kind: "read_in_context", reference },
    });
    await expect(
        t.query(internal.execution.piControlReads.completionDisposition, {
            ...lease,
            callId: "mixed",
        }),
    ).rejects.toThrow("completion_correlation_invalid");
    const historicalContext = await t.query(
        internal.execution.context.build,
        scope,
    );
    assert(historicalContext.kind === "ready");
    expect(
        JSON.parse(historicalContext.inputJson).triggeringRequestsAndResults,
    ).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                callId: "read",
                requestId: finished.requestIds[0],
            }),
        ]),
    );
    await t.run(async (ctx) => {
        const invocation = await ctx.db.get(begun.invocationId);
        assert(invocation?.receivedOutputTextId);
        await ctx.db.patch(invocation._id, {
            outputTextId: invocation.receivedOutputTextId,
            outputJson: undefined,
        });
        await ctx.db.patch(missionId, { status: "completed" });
    });
    await expect(
        t.query(
            internal.execution.piControlReads.terminalCompletionAccepted,
            lease,
        ),
    ).resolves.toBe(false);
    await t.run((ctx) => ctx.db.patch(missionId, { status: "waiting" }));
    const fragmentedContext = await t.query(
        internal.execution.context.build,
        scope,
    );
    assert(fragmentedContext.kind === "ready");
    expect(
        JSON.parse(
            fragmentedContext.inputJson,
        ).triggeringRequestsAndResults.map((r: { callId: string }) => r.callId),
    ).toEqual(["read", "mixed"]);
    await expect(
        t.query(internal.execution.piControlReads.operation, {
            ...scope,
            callId: "read",
        }),
    ).resolves.toMatchObject({
        kind: "historical",
        invocation: { _id: begun.invocationId },
    });

    await expect(
        t.action((ctx) =>
            lookupPiOperation(ctx, {
                ...scope,
                callId: "read",
            }),
        ),
    ).resolves.toMatchObject({
        _id: finished.requestIds[0],
        input: { kind: "read_in_context", reference },
    });
    await expect(
        t.query(internal.execution.piControlReads.operation, {
            ...scope,
            callId: "read",
            historical: {
                invocationId: begun.invocationId,
                responseHash: "wrong-response",
                index: 0,
            },
        }),
    ).rejects.toThrow("invocation_result_conflict");
    const candidate = await t.query(
        internal.execution.piControlReads.completionDisposition,
        {
            ...lease,
            callId: "mixed",
        },
    );
    assert(candidate.kind === "historical");
    await t.action((ctx) =>
        recoverHistoricalCompletion(ctx, lease, candidate.invocation),
    );
    await expect(
        t.query(internal.execution.piControlReads.completionDisposition, {
            ...lease,
            callId: "mixed",
        }),
    ).resolves.toEqual({
        kind: "operation",
        requestId: finished.requestIds[1],
    });
});

test("settles a native completion whose original arguments exceed the read transaction budget", async () => {
    vi.useFakeTimers();
    const t = convexTest({
        schema,
        modules: import.meta.glob("/convex/**/*.ts"),
        transactionLimits: { bytesRead: 128 * 1024 },
    });
    const f = await seedInspectedEvidence({}, t);
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: f.args.runId,
        corpusRevisionId: f.args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "retained-completion-correlation",
        expectedGeneration: 4,
    });
    const context = await t.query(internal.execution.context.build, {
        missionId,
        expectedGeneration: 4,
    });
    assert(context.kind === "ready");
    const material = JSON.parse(context.inputJson).domain.availableMaterials[0];
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 4,
        cause: "read-for-large-completion",
        input: {
            kind: "read_in_context",
            reference: material.readingReferences[0].reference,
        },
    });
    expect(
        (
            await dispatchFixtureOperation(t, {
                requestId,
                expectedGeneration: 4,
            })
        ).kind,
    ).toBe("success");
    const lease = await t.mutation(internal.execution.piStore.claim, {
        missionId,
        expectedGeneration: 4,
        writer: "completion-correlation",
    });
    const begun = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        piLease: {
            sessionId: lease.sessionId,
            writer: lease.writer,
            epoch: lease.epoch,
        },
        piSessionId: lease.sessionId,
        taskKey: "large-completion",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const response = {
        kind: "completion_submission" as const,
        call: {
            callId: "completion",
            inputJson: `${" ".repeat(160_000)}${JSON.stringify({ kind: "complete", captureIds: [material.captureId] })}`,
        },
    };
    const args = { invocationId: begun.invocationId, expectedGeneration: 4 };
    const responseTextId = await t.action((ctx) =>
        stageObservedBody(ctx, args, "response", stableStringify(response)),
    );
    assert(responseTextId);
    const observableReplyTextId = await t.action((ctx) =>
        stageObservedBody(
            ctx,
            args,
            "reply",
            stableStringify({ version: 1, provenance: "simulation", response }),
        ),
    );
    assert(observableReplyTextId);
    await retainFixtureOutput(t, {
        ...args,
        responseTextId,
        observableReplyTextId,
    });
    await expect(
        t.mutation(internal.execution.invocations.finish, {
            ...args,
            response,
        }),
    ).resolves.toMatchObject({ kind: "completed" });
    await expect(
        t.query(internal.execution.piControlReads.completionDisposition, {
            ...lease,
            callId: "completion",
        }),
    ).resolves.toEqual({ kind: "accepted" });
    await expect(
        t.query(internal.execution.piControlReads.terminalCompletionAccepted, {
            ...lease,
        }),
    ).resolves.toBe(true);
    await expect(
        t.query(internal.execution.piControlReads.completionDisposition, {
            ...lease,
            callId: "unrelated",
        }),
    ).rejects.toThrow("completion_correlation_invalid");
    await t.run((ctx) =>
        ctx.db.patch(begun.invocationId, { nativeCompletion: undefined }),
    );
    const bounded = await t.query(
        internal.execution.piControlReads.terminalCompletionAccepted,
        {
            ...lease,
        },
    );
    expect(bounded).toMatchObject({
        kind: "historical",
        invocation: { _id: begun.invocationId },
    });
    assert(typeof bounded === "object");
    await t.action((ctx) =>
        recoverHistoricalCompletion(ctx, lease, bounded.invocation),
    );
    await expect(
        t.query(
            internal.execution.piControlReads.terminalCompletionAccepted,
            lease,
        ),
    ).resolves.toBe(true);
    expect(await t.run((ctx) => ctx.db.get(begun.invocationId))).toMatchObject({
        nativeCompletion: {
            callId: "completion",
            responseHash: sha256Hex(stableStringify(response)),
        },
    });
    const mission = await t.run((ctx) => ctx.db.get(missionId));
    assert(mission && "protocolVersion" in mission && mission.result);
    const legacyResult = retainedTextParts(
        `${" ".repeat(175_000)}${JSON.stringify(mission.result)}`,
    );
    let resultTextId: Id<"retainedTexts"> | undefined;
    for (const [index, content] of legacyResult.parts.entries())
        resultTextId = await t.run((ctx) =>
            stageRetainedText(ctx, `${missionId}:result`, {
                ...legacyResult.manifest,
                index,
                content,
            }),
        );
    assert(resultTextId);
    await t.run((ctx) =>
        ctx.db.patch(missionId, { result: undefined, resultTextId }),
    );
    await expect(
        t.query(internal.execution.piControl.publicationState, {
            missionId,
            expectedGeneration: 4,
        }),
    ).resolves.toEqual({ completed: true, staleInstructions: false });
    await t.run((ctx) =>
        ctx.db.patch(begun.invocationId, {
            nativeCompletion: {
                callId: "completion",
                responseHash: "wrong-response",
            },
        }),
    );
    await expect(
        t.query(
            internal.execution.piControlReads.terminalCompletionAccepted,
            lease,
        ),
    ).resolves.toBe(false);
});

async function completedStructuredSettlement() {
    vi.useFakeTimers();
    const f = await seedInspectedEvidence();
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.args.runId,
        corpusRevisionId: f.args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "structured-settlement-retries",
        expectedGeneration: 4,
    });
    const lease1 = await f.t.mutation(internal.execution.piStore.claim, {
        missionId,
        expectedGeneration: 4,
        writer: "writer-a",
    });
    await f.t.run(async (ctx) => {
        await ctx.db.patch(missionId, {
            status: "completed",
            result: {
                kind: "saved_material_inspection_v1",
                captureIds: [],
            },
            piActiveWriter: "writer-a",
        });
        await ctx.db.patch(lease1.sessionId, { sequence: 3 });
    });

    return { f, missionId, lease1 };
}

test("completed structured settlement refuses stale epochs and foreign writers", async () => {
    const { f, lease1 } = await completedStructuredSettlement();
    await expect(
        f.t.query(internal.execution.piControlReads.completionDisposition, {
            ...lease1,
            epoch: lease1.epoch + 9,
            callId: "c1",
        }),
    ).rejects.toThrow("pi_writer_fenced");
    await expect(
        f.t.query(
            internal.execution.piControlReads.terminalCompletionAccepted,
            {
                ...lease1,
                writer: "wrong-writer",
            },
        ),
    ).rejects.toThrow("pi_writer_fenced");
});

test("completed structured settlement exhausts transient retries without losing its result or scheduling another wake", async () => {
    const { NATIVE_WORKER_POLICY } = await import("@convex/resourcePolicy");
    const { f, missionId, lease1 } = await completedStructuredSettlement();
    for (
        let attempt = 1;
        attempt <= NATIVE_WORKER_POLICY.settlementMaxAttempts;
        attempt++
    ) {
        const writer = `retry-writer-${attempt}`;
        vi.advanceTimersByTime(91_000);
        await f.t.mutation(internal.execution.piStore.claim, {
            missionId,
            expectedGeneration: 4,
            writer,
        });
        await f.t.run((ctx) =>
            ctx.db.patch(missionId, { piActiveWriter: writer }),
        );
        await f.t.mutation(internal.execution.piControl.closeWorker, {
            missionId,
            expectedGeneration: 4,
            writer,
            error: "execution_interrupted",
        });
    }
    const exhausted = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(missionId),
        session: await ctx.db.get(lease1.sessionId),
        events: await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_kind", (q) =>
                q
                    .eq("missionId", missionId)
                    .eq("kind", "native_settlement_blocked"),
            )
            .collect(),
    }));
    expect(exhausted.mission).toMatchObject({
        status: "completed",
        result: { kind: "saved_material_inspection_v1", captureIds: [] },
    });
    expect(exhausted.mission?.piWakeToken).toBeUndefined();
    expect(exhausted.session).toMatchObject({
        settlementAttempts: NATIVE_WORKER_POLICY.settlementMaxAttempts,
        settlementFailureCode: "native_settlement_incomplete",
    });
    expect(exhausted.session?.settledSequence).toBeUndefined();
    expect(exhausted.events).toHaveLength(1);
    expect(exhausted.events[0]?.code).toBe("native_settlement_incomplete");
});

test("withdrawn dossiers refuse completed structured settlement inspection", async () => {
    const { f, lease1 } = await completedStructuredSettlement();
    await f.t.run((ctx) =>
        ctx.db.patch(f.args.runId, { withdrawnAt: Date.now() }),
    );
    await expect(
        f.t.query(
            internal.execution.piControlReads.terminalCompletionAccepted,
            lease1,
        ),
    ).rejects.toThrow("not_authorized");
});

test("permanent structured settlement failure stops at the first attempt on an authorized dossier", async () => {
    const { f, missionId, lease1 } = await completedStructuredSettlement();
    await f.t.mutation(internal.execution.piControl.closeWorker, {
        missionId,
        expectedGeneration: 4,
        writer: "writer-a",
        error: "completion_correlation_invalid",
    });
    expect(await f.t.run((ctx) => ctx.db.get(lease1.sessionId))).toMatchObject({
        settlementAttempts: 1,
        settlementFailureCode: "completion_correlation_invalid",
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(missionId)))?.piWakeToken,
    ).toBeUndefined();
});

test.each([
    "crash",
    "close_exhausted",
    "close_success",
    "admission_storage",
] as const)("structured settlement preserves child notification until settlement resolves (%s)", async (mode) => {
    const { workflow } = await import("@convex/workflow");
    const { default: workflowTest } = await import(
        "@/__tests__/convex/workflows/workflow-test-register.js"
    );
    const { NATIVE_WORKER_POLICY } = await import("@convex/resourcePolicy");
    vi.useFakeTimers();
    const f = await seedInspectedEvidence();
    workflowTest.register(f.t);
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        corpusRevisionId: f.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: `settlement-notify:${mode}`,
        expectedGeneration: 4,
    });
    const lease = await f.t.mutation(internal.execution.piStore.claim, {
        missionId,
        expectedGeneration: 4,
        writer: "initial",
    });
    await f.t.run(async (ctx) => {
        const workflowId = await workflow.start(
            ctx,
            internal.researchWorkflow.run,
            { runId: f.runId, executionGeneration: 4 },
        );
        const eventId = await workflow.createEvent(ctx, {
            name: "terminal",
            workflowId,
        });
        await ctx.db.patch(missionId, {
            status: "completed",
            result: { kind: "saved_material_inspection_v1", captureIds: [] },
            completionEventId: eventId,
            piActiveWriter: "initial",
        });
        await ctx.db.patch(lease.sessionId, {
            sequence: 3,
            ...(mode === "admission_storage"
                ? { retainedBytes: PI_SESSION_MAX_BYTES + 1 }
                : {}),
        });
    });
    if (mode !== "crash" && mode !== "admission_storage") {
        await f.t.mutation(internal.execution.piControl.closeWorker, {
            missionId,
            expectedGeneration: 4,
            writer: "initial",
            nativeSettled: false,
        });
        expect(
            (await f.t.run((ctx) => ctx.db.get(missionId)))?.completionNotified,
        ).not.toBe(true);
    }
    const remaining =
        mode === "admission_storage"
            ? 1
            : mode === "crash"
              ? NATIVE_WORKER_POLICY.settlementMaxAttempts
              : mode === "close_success"
                ? 1
                : NATIVE_WORKER_POLICY.settlementMaxAttempts - 1;
    for (let i = 0; i < remaining; i++) {
        vi.advanceTimersByTime(91_000);
        const token = `settlement:${i}`;
        await f.t.run((ctx) => ctx.db.patch(missionId, { piWakeToken: token }));
        const admitted = await f.t.mutation(
            internal.execution.piControl.prepare,
            { missionId, expectedGeneration: 4, token, writer: `writer:${i}` },
        );
        if (mode === "admission_storage") {
            expect(admitted).toBe(false);
        } else if (mode === "crash") {
            expect(admitted).toBe(i < remaining - 1);
        } else {
            expect(admitted).toBe(true);
            await f.t.mutation(internal.execution.piControl.closeWorker, {
                missionId,
                expectedGeneration: 4,
                writer: `writer:${i}`,
                nativeSettled: mode === "close_success",
            });
        }
    }
    const observed = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(missionId),
        session: await ctx.db.get(lease.sessionId),
        events: await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_kind", (q) =>
                q
                    .eq("missionId", missionId)
                    .eq("kind", "native_settlement_blocked"),
            )
            .collect(),
    }));
    expect(observed.mission?.completionNotified).toBe(true);
    expect(observed.mission?.status).toBe("completed");
    if (mode === "close_success") {
        expect(observed.session?.settlementAttempts).toBeUndefined();
        expect(observed.session?.settledSequence).toBe(3);
    } else {
        expect(observed.session).toMatchObject({
            settlementAttempts:
                mode === "admission_storage"
                    ? 1
                    : NATIVE_WORKER_POLICY.settlementMaxAttempts,
            settlementFailureCode:
                mode === "admission_storage"
                    ? "pi_storage_capacity"
                    : "native_settlement_incomplete",
        });
        expect(observed.events).toHaveLength(1);
    }
});

test.each([
    true,
    false,
])("storage exhaustion during admission preserves the terminal settlement contract (terminal=%s)", async (terminal) => {
    const { t, runId, client } = await seedWorkbench(true);
    const turn = await t.mutation(internal.execution.conversations.startTurn, {
        runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        simulation: true,
    });
    assert(turn);
    const lease = await t.mutation(internal.execution.piStore.claim, {
        missionId: turn.missionId,
        expectedGeneration: 1,
        writer: "original",
    });
    await t.run(async (ctx) => {
        await ctx.db.patch(turn.missionId, {
            ...(terminal ? { status: "completed" as const } : {}),
            piActiveWriter: undefined,
            piWakeToken: "capacity-wake",
        });
        await ctx.db.patch(lease.sessionId, {
            sequence: 1,
            settledSequence: 0,
            leaseUntil: Date.now() - 1,
            retainedBytes: PI_SESSION_MAX_BYTES + 1,
        });
    });
    expect(
        await t.mutation(internal.execution.piControl.prepare, {
            missionId: turn.missionId,
            expectedGeneration: 1,
            token: "capacity-wake",
            writer: "next",
        }),
    ).toBe(false);
    const observed = await t.run(async (ctx) => ({
        mission: await ctx.db.get(turn.missionId),
        session: await ctx.db.get(lease.sessionId),
        events: await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_kind", (q) =>
                q
                    .eq("missionId", turn.missionId)
                    .eq("kind", "native_settlement_blocked"),
            )
            .collect(),
        calls: await ctx.db.query("providerCalls").collect(),
    }));
    expect(observed.calls).toEqual([]);
    expect(observed.mission?.status).toBe(terminal ? "completed" : "blocked");
    expect(observed.events).toHaveLength(terminal ? 1 : 0);
    if (terminal) {
        expect(observed.session?.settlementFailureCode).toBe(
            "pi_storage_capacity",
        );
        expect(
            await client.query(api.execution.conversations.get, { runId }),
        ).toMatchObject({
            queuePaused: true,
            admissionFailure: { code: "native_settlement_incomplete" },
        });
        await expect(
            client.mutation(api.execution.conversations.resumeQueue, { runId }),
        ).rejects.toThrow("native_settlement_incomplete");
        await t.run((ctx) =>
            ctx.db.patch(turn.missionId, { piWakeToken: "replay" }),
        );
        expect(
            await t.mutation(internal.execution.piControl.prepare, {
                missionId: turn.missionId,
                expectedGeneration: 1,
                token: "replay",
                writer: "another",
            }),
        ).toBe(false);
        expect(
            await t.run((ctx) =>
                ctx.db
                    .query("agentExecutionEvents")
                    .withIndex("by_mission_and_kind", (q) =>
                        q
                            .eq("missionId", turn.missionId)
                            .eq("kind", "native_settlement_blocked"),
                    )
                    .collect(),
            ),
        ).toHaveLength(1);
    } else expect(observed.session?.settlementFailureCode).toBeUndefined();
});

test("simulation executes an admitted snapshot above the transaction read limit", async () => {
    const t = convexTest({
        schema,
        modules: import.meta.glob("/convex/**/*.ts"),
        transactionLimits: { bytesRead: 128 * 1024 },
    });
    const { missionId } = await seedPiMission(t);
    const begun = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        piLease: await claimFixturePiLease(t, missionId, 4),
        taskKey: "large-simulation-input",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const args = { invocationId: begun.invocationId, expectedGeneration: 4 };
    const expected = await t.action(internal.execution.simulation.invoke, args);
    const { parts, manifest } = retainedTextParts(
        JSON.stringify({
            ...JSON.parse(begun.inputJson),
            fixturePadding: "x".repeat(175_000),
        }),
    );
    let inputTextId: Id<"retainedTexts"> | undefined;
    for (const [index, content] of parts.entries())
        inputTextId = await t.run((ctx) =>
            stageRetainedText(ctx, `${begun.invocationId}:input`, {
                ...manifest,
                index,
                content,
            }),
        );
    assert(inputTextId);
    await t.run(async (ctx) => {
        const mission = await ctx.db.get(missionId);
        assert(mission);
        const definition = getAgentDefinition(
            mission.definitionId,
            mission.definitionVersion,
        );
        await ctx.db.patch(begun.invocationId, {
            inputTextId,
            inputJson: "",
            inputContentHash: manifest.contentHash,
            nativePreparation: {
                inputHash: manifest.contentHash,
                observationSequence: await contextObservationSequence(
                    ctx,
                    mission.runId,
                ),
                instructionsHash: sha256Hex(
                    piInstructionSection(definition.instructions),
                ),
                toolSetKey: await agentToolSetKey(
                    agentToolSchemas(definition, JSON.parse(begun.inputJson)),
                ),
                serializer: NATIVE_MODEL_SERIALIZER,
            },
        });
    });
    const load = internal.execution.invocationLifecycle.forExecution;
    await expect(t.query(load, args)).resolves.toMatchObject({
        invocation: { inputTextId, inputJson: "" },
    });
    const read = internal.execution.invocationLifecycle.executionInputFragment;
    for (const [index, content] of parts.entries()) {
        await expect(
            t.query(read, {
                ...args,
                index,
                inputHash: manifest.contentHash,
            }),
        ).resolves.toMatchObject({
            content,
            contentHash: manifest.contentHash,
        });
    }
    await expect(
        t.action(internal.execution.simulation.invoke, args),
    ).resolves.toEqual(expected);
    let observedPrompt: string | undefined;
    const piLease = await claimFixturePiLease(t, missionId, 4);
    const reply = await t.action((ctx) =>
        invokeControlledGeneration(
            ctx,
            args,
            Date.now() + 10_000,
            {
                id: "pi-durable",
                version: 1,
                async generate(input, lifecycle) {
                    observedPrompt = input.prompt;
                    await lifecycle.beforeDispatch('{"messages":[]}', {
                        effectiveMaxOutputTokens: 32,
                    });
                    return {
                        status: "blocked",
                        reason: "generation_backend_unknown",
                    };
                },
            },
            piLease,
        ),
    );
    expect(observedPrompt).toBe(parts.join(""));
    expect(reply.response).toEqual({
        kind: "blocked",
        code: "generation_backend_unknown",
    });
    const retained = await t.run(async (ctx) => ({
        invocation: await ctx.db.get(begun.invocationId),
        calls: await ctx.db.query("providerCalls").collect(),
    }));
    expect(retained.invocation).toMatchObject({
        receivedOutputJson: stableStringify(reply.response),
    });
    expect(retained.calls).toHaveLength(0);
    const retried = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        piLease: await claimFixturePiLease(t, missionId, 4),
        taskKey: "large-simulation-input",
        provenance: "simulation",
        returnInputReference: true,
    });
    expect(retried).toEqual({
        kind: "ready_reference",
        invocationId: begun.invocationId,
        inputHash: manifest.contentHash,
    });
});

test("local simulation inspection finds an exact quotation in a request above the transaction read limit", async () => {
    const t = convexTest({
        schema,
        modules: import.meta.glob("/convex/**/*.ts"),
        transactionLimits: { bytesRead: 128 * 1024 },
    });
    const { missionId } = await seedPiMission(t);
    await t.run((ctx) =>
        ctx.db.patch(missionId, {
            requestKey: "local-simulation",
            definitionVersion: 5,
        }),
    );
    const scope = { missionId, expectedGeneration: 4 };
    const context = await t.query(internal.execution.context.build, scope);
    assert(context.kind === "ready");
    const [material] = JSON.parse(context.inputJson).domain.availableMaterials;
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        ...scope,
        cause: "inspect-retained-quotation",
        input: {
            kind: "read_in_context",
            reference: material.readingReferences[0].reference,
        },
    });
    const outcome = await dispatchFixtureOperation(t, {
        requestId,
        expectedGeneration: 4,
    });
    assert(outcome.kind === "success");
    const result = JSON.parse(outcome.valueJson);
    const quotation = result.passage?.exactQuote ?? result.text;
    assert(typeof quotation === "string" && quotation.length > 0);
    const begun = await t.mutation(internal.execution.invocations.begin, {
        ...scope,
        piLease: await claimFixturePiLease(t, missionId, 4),
        taskKey: "inspect-fragmented-request",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const receipt = {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        piLease: await claimFixturePiLease(t, missionId, 4),
    };
    const { parts, manifest } = retainedTextParts(
        JSON.stringify({
            messages: [
                { text: "x".repeat(175_000) },
                { text: JSON.stringify({ quotation }) },
            ],
        }),
    );
    let textId:
        | import("@convex/_generated/dataModel").Id<"retainedTexts">
        | undefined;
    for (const [index, content] of parts.entries())
        textId = await t.mutation(
            internal.execution.invocationLifecycle.stageRequest,
            {
                ...receipt,
                fragment: { ...manifest, index, content },
            },
        );
    await t.mutation(internal.execution.invocationLifecycle.retainRequest, {
        ...receipt,
        textId,
    });
    const completion = retainedTextParts(
        `${" ".repeat(175_000)}${JSON.stringify({
            kind: "saved_material_inspection_v1",
            captureIds: [material.captureId],
        })}`,
    );
    let resultTextId: Id<"retainedTexts"> | undefined;
    for (const [index, content] of completion.parts.entries())
        resultTextId = await t.run((ctx) =>
            stageRetainedText(ctx, `${missionId}:result`, {
                ...completion.manifest,
                index,
                content,
            }),
        );
    assert(resultTextId);
    await t.run((ctx) => ctx.db.patch(missionId, { resultTextId }));
    const resultView = await t.action(internal.execution.fixtures.inspect, {
        missionId,
    });
    expect(resultView).toMatchObject({
        contextIncludesReturnedQuotation: true,
        invocationCount: 1,
        completionCount: 1,
        providerCallCount: 0,
    });
});
