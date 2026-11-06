import { api, internal } from "@convex/_generated/api";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { executionError } from "@convex/execution/errors";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedConversation } from "@/__tests__/setup/agent-harness";
import {
    dispatchHistory,
    seedHistoryMission,
} from "@/__tests__/setup/execution-history";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

test.each([
    "consult_conversation",
    "consult_mission_state",
] as const)("%s refuses fabricated and empty continuations before pagination", async (kind) => {
    const f = await seedHistoryMission();
    for (const cursor of [
        "",
        "history:not-an-id",
        "1:0",
        JSON.stringify({ cursor: "not-a-database-cursor", offset: 0 }),
        JSON.stringify({ cursor: null, offset: 1 }),
    ]) {
        const result = await dispatchHistory(f, { kind, cursor });
        expect(result.outcome).toEqual({
            kind: "refused",
            code: "history_cursor_invalid",
        });
        expect(
            await f.t.run((ctx) => ctx.db.get(result.requestId)),
        ).toMatchObject({ status: "completed", outcome: result.outcome });
    }
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toHaveLength(0);
    expect((await dispatchHistory(f, { kind })).outcome).toMatchObject({
        kind: "success",
    });
});

test("invalid_inner_cursor_is_a_recorded_refusal", async () => {
    const f = await seedHistoryMission("Original analyst question");
    const result = await dispatchHistory(f, {
        kind: "consult_conversation",
        cursor: JSON.stringify({ cursor: "not-a-database-cursor", offset: 0 }),
    });
    expect(result.outcome).toEqual({
        kind: "refused",
        code: "history_cursor_invalid",
    });
    expect(await f.t.run((ctx) => ctx.db.get(result.requestId))).toMatchObject({
        status: "completed",
        outcome: result.outcome,
    });
    const corrected = await dispatchHistory(f, {
        kind: "consult_conversation",
    });
    assert(corrected.outcome.kind === "success");
    expect(corrected.outcome.valueJson).toContain("Original analyst question");
});

test("issued canonical conversation fragments preserve Unicode boundaries and cannot be re-offset", async () => {
    const text = `${"a".repeat(8191)}😀${"b".repeat(32)}`;
    const f = await seedHistoryMission(text);
    const first = await dispatchHistory(f, { kind: "consult_conversation" });
    assert(first.outcome.kind === "success");
    const page = JSON.parse(first.outcome.valueJson);
    expect(page.continueCursor).toMatch(/^history:/);
    expect(page.entries[0].content).not.toMatch(/[\uD800-\uDBFF]$/);
    const second = await dispatchHistory(f, {
        kind: "consult_conversation",
        cursor: page.continueCursor,
    });
    assert(second.outcome.kind === "success");
    const next = JSON.parse(second.outcome.valueJson);
    expect(next.entries[0].content).not.toMatch(/^[\uDC00-\uDFFF]/);
    expect(page.entries[0].content + next.entries[0].content).toBe(text);
    const before = (await f.t.run((ctx) => ctx.db.get(f.missionId)))
        ?.progressKeys;
    const rejected = await dispatchHistory(f, {
        kind: "consult_conversation",
        cursor: JSON.stringify({ cursor: null, offset: 1 }),
    });
    expect(rejected.outcome).toEqual({
        kind: "refused",
        code: "history_cursor_invalid",
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toEqual(before);
});

test("a research reader's existing snapshot excludes an older queued message published by a later response", async () => {
    const f = await seedInspectedEvidence();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run?.ownerVisitorId);
        const owner = await ctx.db.get(run.ownerVisitorId);
        assert(owner);
        await ctx.db.patch(owner.invitationId, { slotKey: "analyst-4" });
    });
    const contextId = await f.t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        {
            slotKey: "analyst-4",
            contextKey: "history-membership",
            durationMs: 60_000,
        },
    );
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            purpose: "browser_test",
            browserTestContextId: contextId,
        }),
    );
    const client = f.t.withIdentity({ subject: f.userId });
    await client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "first",
        delivery: "queue",
        text: "First analyst question",
    });
    const priorTurn = await f.t.mutation(
        internal.execution.conversations.claimTurn,
        { runId: f.runId },
    );
    assert(priorTurn);
    const priorMission = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        expectedGeneration: 1,
        conversationTurnId: priorTurn,
        definitionId: "conversation_validation_v1",
        scope: { kind: "conversation_validation_v1" },
        requestKey: "prior",
    });
    await client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "future",
        delivery: "queue",
        text: "LATER QUEUED INSTRUCTION",
    });
    async function finish(missionId: typeof priorMission, text: string) {
        const begun = await f.t.mutation(internal.execution.invocations.begin, {
            missionId,
            expectedGeneration: 1,
            taskKey: `finish:${missionId}`,
            provenance: "simulation",
        });
        assert(begun.kind === "ready");
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: begun.invocationId,
            expectedGeneration: 1,
            response: { kind: "complete", text },
        });
    }
    await finish(priorMission, "Original published answer");
    const readerMission = await f.t.mutation(
        internal.execution.missions.start,
        {
            runId: f.runId,
            expectedGeneration: 4,
            corpusRevisionId: f.corpusRevisionId,
            definitionId: "saved_material_inspection_v1",
            requestKey: "research-reader",
        },
    );
    async function read(cursor?: string) {
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId: readerMission,
                expectedGeneration: 4,
                cause: "snapshot-membership",
                input: { kind: "consult_conversation", cursor },
            },
        );
        const outcome = await f.t.action(
            internal.execution.operations.dispatch,
            { requestId, expectedGeneration: 4 },
        );
        expect(outcome).toMatchObject({ kind: "success" });
        assert(outcome.kind === "success");
        return JSON.parse(outcome.valueJson);
    }
    const first = await read();
    expect(first.entries[0].content).toBe("First analyst question");
    const pendingRoot = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: readerMission,
            expectedGeneration: 4,
            cause: "pending-snapshot",
            input: { kind: "consult_conversation" },
        },
    );
    const nextTurn = await f.t.mutation(
        internal.execution.conversations.claimTurn,
        { runId: f.runId },
    );
    assert(nextTurn);
    const nextMission = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        expectedGeneration: 1,
        conversationTurnId: nextTurn,
        definitionId: "conversation_validation_v1",
        scope: { kind: "conversation_validation_v1" },
        requestKey: "future",
    });
    await finish(nextMission, "Later response");
    const originalRoot = await f.t.action(
        internal.execution.operations.dispatch,
        { requestId: pendingRoot, expectedGeneration: 4 },
    );
    expect(originalRoot).toMatchObject({ kind: "success" });
    const next = await read(first.continueCursor);
    expect(next.entries[0].content).toBe("Original published answer");
    expect(JSON.stringify(next)).not.toContain("LATER QUEUED INSTRUCTION");
});

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
    expect(page.continueCursor).toMatch(/^history:/);
    const invalidId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: nextMission,
            expectedGeneration: 1,
            cause: "invalid-pagination",
            input: {
                kind: "consult_conversation",
                cursor: "not-a-database-cursor",
            },
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

test("issued continuations reject the wrong source, mission and superseded instructions", async () => {
    const f = await seedHistoryMission();
    const first = await dispatchHistory(f, { kind: "consult_conversation" });
    assert(first.outcome.kind === "success");
    const cursor = JSON.parse(first.outcome.valueJson).continueCursor;
    expect(
        (await dispatchHistory(f, { kind: "consult_mission_state", cursor }))
            .outcome,
    ).toEqual({ kind: "refused", code: "history_cursor_invalid" });
    const foreign = await f.t.run(async (ctx) => {
        const prior = await ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_request_key", (q) =>
                q.eq("runId", f.runId).eq("requestKey", "prior"),
            )
            .unique();
        const current = await ctx.db.get(first.requestId);
        assert(prior && current?.historyRead);
        const { _id, _creationTime, ...fields } = current;
        return ctx.db.insert("agentOperationRequests", {
            ...fields,
            missionId: prior._id,
            historyRead: { ...current.historyRead, missionId: prior._id },
        });
    });
    expect(
        (
            await dispatchHistory(f, {
                kind: "consult_conversation",
                cursor: `history:${foreign}`,
            })
        ).outcome,
    ).toEqual({ kind: "refused", code: "history_cursor_invalid" });
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        turnId: f.turnId,
        requestKey: "steer-cursor",
        delivery: "steer",
        text: "Preserve this newly admitted instruction.",
    });
    expect(
        (await dispatchHistory(f, { kind: "consult_conversation", cursor }))
            .outcome,
    ).toEqual({ kind: "refused", code: "history_cursor_invalid" });
});

test("corrupted retained receipts are incidents; completed legacy pages retain their exact bytes", async () => {
    const f = await seedHistoryMission();
    const first = await dispatchHistory(f, { kind: "consult_conversation" });
    assert(first.outcome.kind === "success");
    const cursor = JSON.parse(first.outcome.valueJson).continueCursor;
    await f.t.run((ctx) =>
        ctx.db.patch(first.requestId, { historyRead: undefined }),
    );
    const invalid = await dispatchHistory(f, {
        kind: "consult_conversation",
        cursor,
    });
    expect(invalid.outcome).toEqual({
        kind: "unavailable",
        code: "operation_execution_failed",
    });
    expect(await f.t.run((ctx) => ctx.db.get(invalid.requestId))).toMatchObject(
        { status: "completed" },
    );
    await f.t.run((ctx) =>
        ctx.db.patch(first.requestId, { operationVersion: 1 }),
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: first.requestId,
            expectedGeneration: 1,
        }),
    ).toEqual(first.outcome);
    expect(
        (await dispatchHistory(f, { kind: "consult_conversation", cursor }))
            .outcome,
    ).toEqual({ kind: "refused", code: "history_cursor_invalid" });
    const pending = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 1,
        cause: "legacy-pending",
        input: { kind: "consult_conversation" },
    });
    await f.t.run((ctx) => ctx.db.patch(pending, { operationVersion: 1 }));
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: pending,
            expectedGeneration: 1,
        }),
    ).toEqual({ kind: "refused", code: "operation_version_conflict" });
    expect(await f.t.run((ctx) => ctx.db.get(pending))).toMatchObject({
        status: "completed",
    });
});

test("conversation restoration requests one native paginated record with explicit storage bounds", async () => {
    const f = await seedHistoryMission();
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "bounded-reader",
            input: { kind: "consult_conversation" },
        },
    );
    await f.t.mutation(internal.execution.operations.claim, {
        requestId,
        expectedGeneration: 1,
    });
    const { readHistoryPage } = await import("@convex/execution/history");
    const calls: { method: string; args: unknown[] }[] = [];
    await f.t.run(async (ctx) => {
        const observe = <T extends object>(object: T, track = false): T =>
            new Proxy(object, {
                get(target, key, receiver) {
                    const value = Reflect.get(target, key, receiver);
                    if (typeof value !== "function") return value;
                    return (...args: unknown[]) => {
                        if (track && (key === "take" || key === "paginate"))
                            calls.push({ method: String(key), args });
                        const result = Reflect.apply(value, target, args);
                        return result &&
                            typeof result === "object" &&
                            !(result instanceof Promise)
                            ? observe(
                                  result,
                                  track ||
                                      (key === "query" &&
                                          args[0] === "agentMessageDeliveries"),
                              )
                            : result;
                    };
                },
            });
        const result = await readHistoryPage(
            { ...ctx, db: observe(ctx.db) },
            { requestId, expectedGeneration: 1 },
        );
        expect(result.outcome.kind).toBe("success");
    });
    expect(calls).toEqual([
        {
            method: "paginate",
            args: [
                expect.objectContaining({
                    numItems: 1,
                    maximumRowsRead: 4096,
                    maximumBytesRead: 512 * 1024,
                }),
            ],
        },
    ]);
});

test("an empty conversation adds no facts and oversized required state cannot consume a fragment", async () => {
    const f = await seedHistoryMission();
    await f.t.run(async (ctx) => {
        const messages = await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", f.runId).eq("status", "processed"),
            )
            .take(20);
        for (const message of messages) await ctx.db.delete(message._id);
    });
    const empty = await dispatchHistory(f, { kind: "consult_conversation" });
    assert(empty.outcome.kind === "success");
    expect(JSON.parse(empty.outcome.valueJson)).toEqual({
        entries: [],
        continueCursor: null,
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toEqual([]);
    const { initializeFraming } = await import("@convex/framing");
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            lifecycleState: "framing",
        });
        await initializeFraming(ctx, f.runId);
        await ctx.db.patch(f.missionId, {
            definitionId: "workbench_v1",
            definitionVersion: getAgentDefinition("workbench_v1").version,
            scope: { kind: "workbench_v1" },
            state: { kind: "workbench_v1" },
        });
    });
    await f.client.mutation(api.framing.save, {
        runId: f.runId,
        expectedRevision: 1,
        requestKey: "large-required-state",
        content: {
            scope: "Retain this exact material. ".repeat(1900),
            questions: [],
        },
    });
    const result = await dispatchHistory(f, { kind: "consult_mission_state" });
    expect(result.outcome).toEqual({
        kind: "unavailable",
        code: "history_result_capacity",
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toEqual([]);
    vi.useFakeTimers();
    await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
});
