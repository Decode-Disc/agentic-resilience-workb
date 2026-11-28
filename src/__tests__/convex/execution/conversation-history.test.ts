import { api, internal } from "@convex/_generated/api";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { executionError } from "@convex/execution/errors";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    dispatchHistory,
    runHistoryTurn,
    seedHistoryMission,
} from "@/__tests__/setup/execution-history";
import {
    beginFixtureInvocation,
    claimFixtureOperation,
    dispatchFixtureOperation,
} from "@/__tests__/setup/pi-mission";
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
    const originalQuestion = "Original analyst question";
    const f = await seedHistoryMission(originalQuestion);
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
    const corrected = await dispatchHistory(f, { kind });
    assert(corrected.outcome.kind === "success");
    if (kind === "consult_conversation")
        expect(JSON.parse(corrected.outcome.valueJson).entries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ content: originalQuestion }),
            ]),
        );
});

test("issued canonical conversation fragments preserve Unicode boundaries and cannot be re-offset", async () => {
    // Raw message stays under the 64 KiB submission cap while JSON escaping pushes its serialized page across 64 KiB right in the emoji run.
    const text = `${'"'.repeat(32_550)}${"😀".repeat(120)}${"b".repeat(32)}`;
    const f2 = await seedHistoryMission(text);
    const first = await dispatchHistory(f2, { kind: "consult_conversation" });
    assert(first.outcome.kind === "success");
    const page = JSON.parse(first.outcome.valueJson);
    expect(page.continueCursor).toMatch(/^history:conversation:/);
    expect(
        (
            await dispatchHistory(f2, {
                kind: "consult_conversation",
                cursor: page.continueCursor.replace("conversation:", ""),
            })
        ).outcome,
    ).toMatchObject({ kind: "refused", code: "history_cursor_invalid" });
    for (const cursor of [
        page.continueCursor,
        page.continueCursor.replace("conversation:", "mission:"),
    ]) {
        expect(
            (
                await dispatchHistory(f2, {
                    kind: "consult_mission_state",
                    cursor,
                })
            ).outcome,
        ).toMatchObject({ kind: "refused", code: "history_cursor_invalid" });
    }
    expect(page.entries[0].content).not.toMatch(/[\uD800-\uDBFF]$/);
    expect(page.entries[0].content.length).toBeLessThan(text.length);
    const second = await dispatchHistory(f2, {
        kind: "consult_conversation",
        cursor: page.continueCursor,
    });
    assert(second.outcome.kind === "success");
    const next = JSON.parse(second.outcome.valueJson);
    expect(next.entries[0].content).not.toMatch(/^[\uDC00-\uDFFF]/);
    expect(page.entries[0].content + next.entries[0].content).toBe(text);
    const before = (await f2.t.run((ctx) => ctx.db.get(f2.missionId)))
        ?.progressKeys;
    const rejected = await dispatchHistory(f2, {
        kind: "consult_conversation",
        cursor: JSON.stringify({ cursor: null, offset: 1 }),
    });
    expect(rejected.outcome).toEqual({
        kind: "refused",
        code: "history_cursor_invalid",
    });
    expect(
        (await f2.t.run((ctx) => ctx.db.get(f2.missionId)))?.progressKeys,
    ).toEqual(before);
});

test("consultation pages a retained reply larger than the transaction read budget", async () => {
    const reply = `${'"'.repeat(32_550)}${"😀".repeat(160)}${"m".repeat(300_000)}`;
    const f = await seedHistoryMission("Prior question", {
        reply,
        transactionLimits: { bytesRead: 256 * 1024 },
    });
    const chunks: string[] = [];
    let cursor: string | undefined;
    let consumed = 0;
    do {
        const { outcome } = await dispatchHistory(f, {
            kind: "consult_conversation",
            ...(cursor ? { cursor } : {}),
        });
        expect(outcome).toMatchObject({ kind: "success" });
        assert(outcome.kind === "success");
        const page = JSON.parse(outcome.valueJson);
        for (const entry of page.entries) {
            if (entry.role !== "assistant") continue;
            expect(entry.offset).toBe(consumed);
            expect(entry.totalCharacters).toBe(reply.length);
            expect(entry.content).toEqual(expect.any(String));
            expect(entry.content).not.toMatch(/[\uD800-\uDBFF]$/);
            expect(entry.content).not.toMatch(/^[\uDC00-\uDFFF]/);
            chunks.push(entry.content);
            consumed += entry.content.length;
        }
        if (page.continueCursor) expect(page.continueCursor).not.toBe(cursor);
        cursor = page.continueCursor ?? undefined;
    } while (cursor);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(reply);
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
        const begun = await beginFixtureInvocation(f.t, {
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
        const outcome = await dispatchFixtureOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        });
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
    const originalRoot = await dispatchFixtureOperation(f.t, {
        requestId: pendingRoot,
        expectedGeneration: 4,
    });
    expect(originalRoot).toMatchObject({ kind: "success" });
    const next = await read(first.continueCursor);
    expect(next.entries[0].content).toBe("Original published answer");
    expect(JSON.stringify(next)).not.toContain("LATER QUEUED INSTRUCTION");
});

test("conversation reading excludes queued instructions and recovers the exact next page after a refused cursor", async () => {
    const f = await seedHistoryMission("Original prior question");
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "queued",
        delivery: "queue",
        text: "DO NOT DELIVER YET",
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "earlier-turns",
            input: { kind: "consult_conversation" },
        },
    );
    const outcome = await dispatchFixtureOperation(f.t, {
        requestId,
        expectedGeneration: 1,
    });
    expect(outcome.kind).toBe("success");
    if (outcome.kind !== "success") throw new Error("Expected exact history");
    expect(outcome.valueJson).toContain("Original prior question");
    expect(outcome.valueJson).not.toContain("DO NOT DELIVER YET");
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toHaveLength(1);
    const page = JSON.parse(outcome.valueJson);
    assert(typeof page.continueCursor === "string");
    expect(page.continueCursor).toMatch(/^history:conversation:/);
    const invalidId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "invalid-pagination",
            input: {
                kind: "consult_conversation",
                cursor: "not-a-database-cursor",
            },
        },
    );
    expect(
        await dispatchFixtureOperation(f.t, {
            requestId: invalidId,
            expectedGeneration: 1,
        }),
    ).toEqual({ kind: "refused", code: "history_cursor_invalid" });
    expect(await f.t.run((ctx) => ctx.db.get(invalidId))).toMatchObject({
        status: "completed",
        outcome: { kind: "refused", code: "history_cursor_invalid" },
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toHaveLength(1);
    const correctedId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "corrected-pagination",
            input: {
                kind: "consult_conversation",
                cursor: page.continueCursor,
            },
        },
    );
    const corrected = await dispatchFixtureOperation(f.t, {
        requestId: correctedId,
        expectedGeneration: 1,
    });
    assert(corrected.kind === "success");
    expect(JSON.parse(corrected.valueJson).entries).toEqual([
        expect.objectContaining({
            role: "assistant",
            content: "Original assistant answer",
        }),
    ]);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toHaveLength(2);
});

test.each([
    { failure: "storage", error: new Error("History backend unavailable") },
    { failure: "authorization", error: executionError("not_authorized") },
])("conversation reading preserves $failure failures instead of recasting them as invalid cursors", async ({
    error,
}) => {
    const f = await seedHistoryMission();
    const read = await dispatchHistory(f, { kind: "consult_conversation" });
    assert(read.outcome.kind === "success");
    const { commonOperations } = await import(
        "@convex/execution/commonOperations"
    );
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
                    requestId: read.requestId,
                    missionId: f.missionId,
                    expectedGeneration: 1,
                    input: { kind: "consult_conversation" },
                },
            ),
        ),
    ).rejects.toThrow(error);
});

test("repeated exact conversation reads neither invent progress nor trigger repetition stops", async () => {
    const f = await seedHistoryMission();
    const first = await dispatchHistory(f, { kind: "consult_conversation" });
    assert(first.outcome.kind === "success");
    const cursor = JSON.parse(first.outcome.valueJson).continueCursor;
    assert(typeof cursor === "string");
    const next = await dispatchHistory(f, {
        kind: "consult_conversation",
        cursor,
    });
    assert(next.outcome.kind === "success");
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toHaveLength(2);
    for (let index = 0; index < 5; index++) {
        const repeated = await runHistoryTurn(f, {
            kind: "consult_conversation",
        });
        expect(repeated.outcome).toMatchObject({
            kind: "success",
            valueJson: expect.stringContaining("Original analyst question"),
        });
        expect(
            (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
        ).toHaveLength(2);
        expect(repeated.settlement).toMatchObject({ kind: "ready" });
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
        await dispatchFixtureOperation(f.t, {
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
        await dispatchFixtureOperation(f.t, {
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
    await claimFixtureOperation(f.t, {
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

test("empty conversation adds no facts and a large native state does not block exact history", async () => {
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
    const { readFramingCitationPolicy } = await import(
        "@convex/framingCitationPolicy"
    );
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            lifecycleState: "framing",
        });
        await initializeFraming(ctx, f.runId);
        const mission = await ctx.db.get(f.missionId);
        assert(mission?.conversationTurnId);
        await ctx.db.patch(mission.conversationTurnId, {
            framingCitationPolicy: await readFramingCitationPolicy(ctx),
        });
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
    assert(result.outcome.kind === "success");
    const value = JSON.parse(result.outcome.valueJson);
    expect(value.state.requiredState).toMatchObject({
        section: "workbench_current_state",
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(value.history.entries.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(result.outcome.valueJson)).toBeLessThan(48 * 1024);
    const progress = (await f.t.run((ctx) => ctx.db.get(f.missionId)))
        ?.progressKeys;
    await dispatchHistory(f, { kind: "consult_mission_state" });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.progressKeys,
    ).toEqual(progress);
    vi.useFakeTimers();
    await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
});

test.each([
    4, 5,
])("historical analyst fragments preserve their receipt date only for Workbench v%s", async (version) => {
    const text = "Dated analyst request. ".repeat(600);
    const f = await seedHistoryMission(text);
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.missionId, {
            definitionId: "workbench_v1",
            definitionVersion: version,
            scope: { kind: "workbench_v1" },
            state: { kind: "workbench_v1" },
        });
        await ctx.db.patch(f.runId, { startMode: "framed" });
        const deliveries = await ctx.db
            .query("agentMessageDeliveries")
            .collect();
        for (const delivery of deliveries) {
            if (
                delivery.runId === f.runId &&
                delivery.role === "user" &&
                delivery.status === "processed"
            ) {
                await ctx.db.patch(delivery._id, {
                    createdAt: Date.UTC(2026, 10, 18),
                });
            }
        }
    });
    let cursor: string | undefined;
    let reconstructed = "";
    do {
        const result = await dispatchHistory(f, {
            kind: "consult_conversation",
            ...(cursor ? { cursor } : {}),
        });
        assert(result.outcome.kind === "success");
        const page = JSON.parse(result.outcome.valueJson);
        for (const entry of page.entries) {
            if (entry.role !== "user") continue;
            expect(entry.receivedAt).toBe(
                version === 5 ? "2026-11-18T00:00:00.000Z" : undefined,
            );
            reconstructed += entry.content;
        }
        cursor = page.continueCursor ?? undefined;
    } while (cursor);
    expect(reconstructed).toBe(text);
});

test("conversation history fills 64 KiB pages without the 8,192-unit split and preserves old 8,192-width cursors", async () => {
    const longText = `Line1\n${"🧭".repeat(4_000)}${"c".repeat(42_000)}\nEnd`;
    const f = await seedHistoryMission(longText);
    const first = await dispatchHistory(f, { kind: "consult_conversation" });
    assert(first.outcome.kind === "success", JSON.stringify(first.outcome));
    const parsed = JSON.parse(first.outcome.valueJson) as {
        entries: {
            messageId: string;
            offset: number;
            totalCharacters: number;
            content: string;
        }[];
        continueCursor: string | null;
    };
    // Fits the entire >50 KiB user message in a single page within 64 KiB
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.content).toBe(longText);
    expect(Buffer.byteLength(first.outcome.valueJson)).toBeGreaterThan(
        50 * 1024,
    );
    expect(Buffer.byteLength(first.outcome.valueJson)).toBeLessThanOrEqual(
        64 * 1024,
    );
    // Second page returns the assistant reply and ends cleanly
    assert(parsed.continueCursor);
    const second = await dispatchHistory(f, {
        kind: "consult_conversation",
        cursor: parsed.continueCursor,
    });
    assert(second.outcome.kind === "success");
    const secondParsed = JSON.parse(second.outcome.valueJson);
    expect(secondParsed.entries[0]?.role).toBe("assistant");
    expect(secondParsed.continueCursor).toBeNull();

    // Old 8,192-width conversation cursor resumes cleanly under new 64 KiB sizing
    const legacyCursorId = await f.t.run(async (ctx) => {
        const req1 = await ctx.db.get(first.requestId);
        assert(req1?.historyRead && req1.outcome?.kind === "success");
        const firstEntry = parsed.entries[0];
        assert(firstEntry);
        const legacyPrefix = longText.slice(0, 8192);
        const id = await ctx.db.insert("agentOperationRequests", {
            runId: f.runId,
            missionId: f.missionId,
            logicalKey: "legacy-conv-8192",
            operationVersion: 2,
            actor: "agent",
            cause: "legacy-conv",
            expectedGeneration: 1,
            instructionVersion: req1.instructionVersion,
            input: { kind: "consult_conversation" },
            pin: req1.pin,
            status: "completed",
            adoptedAt: 200,
            createdAt: 200,
            completedAt: 200,
        });
        await ctx.db.patch(id, {
            outcome: {
                kind: "success",
                valueJson: JSON.stringify({
                    entries: [
                        {
                            ...firstEntry,
                            offset: 0,
                            totalCharacters: longText.length,
                            content: legacyPrefix,
                        },
                    ],
                    continueCursor: `history:${id}`,
                }),
            },
            historyRead: {
                ...req1.historyRead,
                next: {
                    source: "conversation",
                    cursor: null,
                    offset: legacyPrefix.length,
                },
            },
        });
        return id;
    });
    const resumed = await dispatchHistory(f, {
        kind: "consult_conversation",
        cursor: `history:${legacyCursorId}`,
    });
    assert(resumed.outcome.kind === "success", JSON.stringify(resumed.outcome));
    const resumedParsed = JSON.parse(resumed.outcome.valueJson);
    expect(resumedParsed.entries[0]?.offset).toBe(8192);
    expect(longText.slice(0, 8192) + resumedParsed.entries[0]?.content).toBe(
        longText,
    );
});
