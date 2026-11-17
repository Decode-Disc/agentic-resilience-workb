import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { recordMissionEvent } from "@convex/execution/authority";
import {
    projectMissionHistoryEvent,
    readMissionHistoryEventFragment,
    retainExecutionEventPayload,
    retainInvocationPayload,
} from "@convex/execution/journal";
import { MAX_OPERATION_RESULT_BYTES } from "@convex/resourcePolicy";
import { makeFunctionReference } from "convex/server";
import { getDocumentSize } from "convex/values";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedHistoryMission } from "@/__tests__/setup/execution-history";
import {
    seedInspectedEvidence,
    seedSourcePreparation,
} from "@/__tests__/setup/source-preparation";

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

test.each([
    "returned",
    "refused",
] as const)("fragmented %s history preserves its normalized application observation", async (outcome) => {
    const f = await seedHistoryMission();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 1,
        taskKey: "fragmented-observation",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const response =
        outcome === "returned"
            ? { kind: "operations" as const, requests: [] }
            : { kind: "complete" as const, captureIds: [] };
    await f.t.mutation(internal.execution.invocations.retainOutput, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
        responseJson: JSON.stringify(response),
        observableReplyJson: JSON.stringify({
            original: "Exact retained reply. ".repeat(30000),
        }),
    });
    await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
        response,
    });
    const event = await f.t.run((ctx) =>
        ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_invocation_and_kind", (q) =>
                q
                    .eq("invocationId", begun.invocationId)
                    .eq(
                        "kind",
                        outcome === "returned"
                            ? "invocation_returned"
                            : "invocation_refused",
                    ),
            )
            .first(),
    );
    assert(event?.invocationPayloadId && event.payload);
    const full = await f.t.run((ctx) => projectMissionHistoryEvent(ctx, event));
    let actual = "";
    let offset = 0;
    let total = Infinity;
    do {
        const page = await f.t.run((ctx) =>
            readMissionHistoryEventFragment(ctx, event, offset, 60000),
        );
        actual += page.content;
        offset = page.end;
        total = page.totalCharacters;
    } while (offset < total);
    expect(JSON.parse(actual).observation).toEqual(
        JSON.parse(full.json).observation,
    );
});

test("older_event_never_acquires_a_later_reply", async () => {
    const f = await seedHistoryMission();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 1,
        taskKey: "immutable-parts",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    await f.t.run(async (ctx) => {
        const invocation = await ctx.db.get(begun.invocationId);
        assert(invocation);
        await retainInvocationPayload(
            ctx,
            invocation,
            "request",
            JSON.stringify({ prompt: "Exact original request" }),
        );
    });
    const event = await f.t.run((ctx) =>
        ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_kind", (q) =>
                q
                    .eq("missionId", f.missionId)
                    .eq("kind", "invocation_request_recorded"),
            )
            .unique(),
    );
    assert(event);
    const before = await f.t.run((ctx) =>
        projectMissionHistoryEvent(ctx, event),
    );
    await f.t.run(async (ctx) => {
        await ctx.db.patch(begun.invocationId, {
            outputJson: "Later reply",
            status: "returned",
        });
        const invocation = await ctx.db.get(begun.invocationId);
        assert(invocation);
        await retainInvocationPayload(
            ctx,
            invocation,
            "reply",
            JSON.stringify({ text: "Later reply" }),
        );
    });
    expect(
        await f.t.run((ctx) => projectMissionHistoryEvent(ctx, event)),
    ).toEqual(before);
    expect(before.json).toContain("Exact original request");
    expect(before.json).not.toContain("Later reply");
});

test("terminal metadata cannot acquire a reply retained after its event", async () => {
    const f = await seedHistoryMission();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 1,
        taskKey: "terminal-metadata",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const event = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        return ctx.db.get(
            await recordMissionEvent(ctx, mission, {
                kind: "mission_completed",
                cause: "earlier-terminal-metadata",
                invocationId: begun.invocationId,
            }),
        );
    });
    assert(event);
    const before = await f.t.run((ctx) =>
        projectMissionHistoryEvent(ctx, event),
    );
    await f.t.run(async (ctx) => {
        const invocation = await ctx.db.get(begun.invocationId);
        assert(invocation);
        await retainInvocationPayload(
            ctx,
            invocation,
            "reply",
            JSON.stringify({ text: "Reply retained afterwards" }),
        );
    });
    expect(
        await f.t.run((ctx) => projectMissionHistoryEvent(ctx, event)),
    ).toEqual(before);
});

test("a recorded invocation part without its immutable payload is an integrity failure", async () => {
    const f = await seedHistoryMission();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 1,
        taskKey: "missing-recorded-part",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const event = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        return ctx.db.get(
            await recordMissionEvent(ctx, mission, {
                kind: "invocation_request_recorded",
                cause: "inconsistent-record",
                invocationId: begun.invocationId,
            }),
        );
    });
    assert(event);
    await expect(
        f.t.run((ctx) => projectMissionHistoryEvent(ctx, event)),
    ).rejects.toThrow("journal_payload_unavailable");
});

test("operation observations are canonical immutable snapshots with explicit capacity gaps", async () => {
    const f = await seedHistoryMission();
    const eventId = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        return recordMissionEvent(ctx, mission, {
            kind: "operation_observed",
            cause: "immutable-observation",
        });
    });
    await f.t.run((ctx) =>
        retainExecutionEventPayload(ctx, eventId, { b: 2, a: 1 }),
    );
    await f.t.run((ctx) =>
        retainExecutionEventPayload(ctx, eventId, { a: 1, b: 2 }),
    );
    expect(
        (await f.t.run((ctx) => ctx.db.get(eventId)))?.payload,
    ).toMatchObject({ state: "complete", json: '{"a":1,"b":2}' });
    await expect(
        f.t.run((ctx) => retainExecutionEventPayload(ctx, eventId, { a: 3 })),
    ).rejects.toThrow("journal_payload_conflict");
    const largeId = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        return recordMissionEvent(ctx, mission, {
            kind: "operation_observed",
            cause: "oversized-observation",
        });
    });
    await f.t.run((ctx) =>
        retainExecutionEventPayload(ctx, largeId, {
            text: "a".repeat(513 * 1024),
        }),
    );
    const large = await f.t.run((ctx) => ctx.db.get(largeId));
    expect(large?.payload).toMatchObject({
        state: "incomplete",
        code: "journal_operation_capacity",
    });
    expect(large?.payload?.json).toBeUndefined();
    expect(large?.payload?.sizeBytes).toBeGreaterThan(512 * 1024);
});

test("retained history indexing is bounded, idempotent and preserves a frozen pre-upgrade cutoff", async () => {
    const f = await seedHistoryMission();
    const { original, throughSequence } = await f.t.run(async (ctx) => {
        await ctx.db.patch(f.missionId, { historyProjection: undefined });
        for (let i = 0; i < 25; i++) {
            const mission = await ctx.db.get(f.missionId);
            assert(mission);
            await recordMissionEvent(ctx, mission, {
                kind: "legacy_record",
                cause: `legacy:${i}`,
                interpretedNeed: `Original retained detail ${i}`,
            });
        }
        const rows = await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_sequence", (q) =>
                q.eq("missionId", f.missionId),
            )
            .take(100);
        for (const row of rows)
            await ctx.db.patch(row._id, { historySourceSequence: undefined });
        const original = await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_sequence", (q) =>
                q.eq("missionId", f.missionId),
            )
            .take(100);
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        return { original, throughSequence: mission.nextEventSequence - 1 };
    });
    const args = {
        missionId: f.missionId,
        expectedGeneration: 1,
        throughSequence,
    };
    const first = await f.t.mutation(
        internal.execution.journal.indexRetainedHistory,
        args,
    );
    expect(first.done).toBe(false);
    assert(first.cursor);
    const indexed = () =>
        f.t.run((ctx) =>
            ctx.db
                .query("agentExecutionEvents")
                .withIndex("by_mission_and_history_source", (q) =>
                    q
                        .eq("missionId", f.missionId)
                        .gt("historySourceSequence", 0),
                )
                .take(100),
        );
    expect(await indexed()).toHaveLength(20);
    expect(
        await f.t.mutation(
            internal.execution.journal.indexRetainedHistory,
            args,
        ),
    ).toEqual(first);
    expect(await indexed()).toHaveLength(20);
    const concurrentId = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        return recordMissionEvent(ctx, mission, {
            kind: "invocation_started",
            cause: "concurrent-technical-record",
        });
    });
    expect(
        await f.t.mutation(internal.execution.journal.indexRetainedHistory, {
            ...args,
            cursor: first.cursor,
        }),
    ).toEqual({ done: true, cursor: null });
    expect(
        await f.t.mutation(
            internal.execution.journal.indexRetainedHistory,
            args,
        ),
    ).toEqual({ done: true, cursor: null });
    expect(
        (await f.t.run((ctx) => ctx.db.get(concurrentId)))
            ?.historySourceSequence,
    ).toBeUndefined();
    for (const before of original) {
        const after = await f.t.run((ctx) => ctx.db.get(before._id));
        assert(after);
        expect(after.historySourceSequence).toBe(before.sequence);
        delete after.historySourceSequence;
        expect(after).toEqual(before);
    }
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.historyProjection,
    ).toMatchObject({ ready: true, throughSequence });
});

test("new invocations identify their journal version without expanding continuation context", async () => {
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        expectedGeneration: 4,
        definitionId: "saved_material_inspection_v1",
        requestKey: "journal-version",
    });
    const begun = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "first",
        provenance: "simulation",
    });
    if (begun.kind !== "ready") throw new Error("Expected invocation");
    const invocation = await t.run((ctx) => ctx.db.get(begun.invocationId));
    expect(invocation?.journalVersion).toBe(1);
    expect(begun.inputJson).not.toContain("requestSnapshot");
});

async function oneShotFixture(logicalInputHash?: string) {
    const fixture = await seedSourcePreparation({ models: true });
    const { t, runId, corpusRevisionId, sourceId } = fixture;
    await t.mutation(internal.researchPlanning.createForRun, {
        runId,
        expectedExecutionGeneration: 3,
    });
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    await t.mutation(internal.modelConfiguration.forPreparation, {
        preparationId,
        expectedGeneration: 3,
    });
    const preparation = await t.run((ctx) => ctx.db.get(preparationId));
    if (!preparation) throw new Error("Expected preparation");
    await t.run((ctx) =>
        ctx.db.patch(preparationId, {
            executionPlanVersion: "source_actions_v3",
        }),
    );
    const inputJson = JSON.stringify({ instructions: "Read.", sourceId });
    const inputHash = logicalInputHash ?? sha256Hex(inputJson);
    const attempt = {
        runId,
        corpusRevisionId,
        sourceId,
        preparationId,
        inputHash,
        executionGeneration: 3,
        workflowVersion: preparation.workflowVersion,
        stepKey: "source_preparation",
        service: "model" as const,
        operation: "source_qualification",
        operationKey: `${preparation.operationKey}:step:source_preparation:input:${inputHash}:attempt:1`,
        attempt: 1,
    };
    const receipt = await t.mutation(internal.providerCalls.recordAttempt, {
        ...attempt,
        status: "started",
    });
    const invocationId = await t.mutation(
        internal.execution.invocations.beginOneShot,
        { providerCallId: receipt.providerCallId, inputJson },
    );
    return {
        ...fixture,
        invocationId,
        attempt,
        providerCallId: receipt.providerCallId,
    };
}

test("one-shot settlement commits the original reply, receipt and normalized result atomically", async () => {
    const { t, invocationId, attempt, providerCallId } = await oneShotFixture();
    const observableReplyJson = JSON.stringify({
        version: 1,
        content: [{ type: "text", text: ' { "finding": "original" } ' }],
    });
    await t.mutation(internal.execution.invocations.finishOneShot, {
        invocationId,
        outputJson: '{"finding":"normalized"}',
        observableReplyJson,
        attempt: {
            ...attempt,
            status: "succeeded",
            dispatchOutcome: "response_received",
        },
    });
    expect(await t.run((ctx) => ctx.db.get(providerCallId))).toMatchObject({
        status: "succeeded",
        invocationId,
    });
    expect(await t.run((ctx) => ctx.db.get(invocationId))).toMatchObject({
        status: "returned",
        outputJson: '{"finding":"normalized"}',
    });
    const payload = await t.run((ctx) =>
        ctx.db
            .query("agentInvocationPayloads")
            .withIndex("by_invocation_and_part", (q) =>
                q.eq("invocationId", invocationId).eq("part", "reply"),
            )
            .unique(),
    );
    expect(JSON.parse(payload?.json ?? "null")).toEqual(
        JSON.parse(observableReplyJson),
    );
});

test("one-shot admission is inspectable before a request can be dispatched", async () => {
    const { t, runId, invocationId } = await oneShotFixture();
    const events = await t.run((ctx) =>
        ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .collect(),
    );
    expect(events).toContainEqual(
        expect.objectContaining({ kind: "invocation_started", invocationId }),
    );
});

test("an invalid one-shot finalization rolls back its receipt and reply snapshot", async () => {
    const { t, invocationId, attempt, providerCallId } = await oneShotFixture();
    await expect(
        t.mutation(internal.execution.invocations.finishOneShot, {
            invocationId,
            outputJson: "x".repeat(702 * 1024),
            observableReplyJson: JSON.stringify({ version: 1, content: [] }),
            attempt: {
                ...attempt,
                status: "succeeded",
                dispatchOutcome: "response_received",
            },
        }),
    ).rejects.toThrow("response_capacity");
    expect(await t.run((ctx) => ctx.db.get(providerCallId))).toMatchObject({
        status: "started",
    });
    expect(
        await t.run((ctx) => ctx.db.query("agentInvocationPayloads").collect()),
    ).toHaveLength(0);
});

const retainRequest = makeFunctionReference<
    "mutation",
    {
        invocationId: Id<"agentInvocations">;
        expectedGeneration: number;
        requestJson: string;
    },
    { kind: "ready" | "blocked"; code?: string }
>("execution/invocations:retainRequest");

test("prepared requests persist once with immutable content and a dossier event", async () => {
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        expectedGeneration: 4,
        definitionId: "saved_material_inspection_v1",
        requestKey: "immutable-journal",
    });
    const begun = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "first",
        provenance: "simulation",
    });
    if (begun.kind !== "ready") throw new Error("Expected invocation");
    const input = {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        requestJson: JSON.stringify({
            version: 1,
            input: { prompt: "Exact input" },
        }),
    };
    expect(await t.mutation(retainRequest, input)).toEqual({ kind: "ready" });
    expect(await t.mutation(retainRequest, input)).toEqual({ kind: "ready" });
    const payloads = await t.run((ctx) =>
        ctx.db.query("agentInvocationPayloads").collect(),
    );
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
        part: "request",
        state: "complete",
        invocationId: begun.invocationId,
        runId: args.runId,
    });
    expect(JSON.parse(payloads[0]?.json ?? "null")).toEqual({
        version: 1,
        input: { prompt: "Exact input" },
    });
    await expect(
        t.mutation(retainRequest, {
            ...input,
            requestJson: JSON.stringify({
                version: 1,
                input: { prompt: "Changed input" },
            }),
        }),
    ).rejects.toThrow("journal_payload_conflict");
    expect(
        (
            await t.run((ctx) =>
                ctx.db
                    .query("agentExecutionEvents")
                    .withIndex("by_run", (q) => q.eq("runId", args.runId))
                    .collect(),
            )
        ).filter((event) => event.kind === "invocation_request_recorded"),
    ).toHaveLength(1);
});

test("oversized request snapshots retain an explicit incomplete marker without an excerpt", async () => {
    const { t, invocationId } = await oneShotFixture();
    const result = await t.mutation(
        internal.execution.invocations.retainRequest,
        {
            invocationId,
            expectedGeneration: 3,
            requestJson: JSON.stringify({
                version: 1,
                text: "x".repeat(512 * 1024),
            }),
        },
    );
    expect(result).toEqual({
        kind: "blocked",
        code: "journal_request_capacity",
    });
    const payload = await t.run((ctx) =>
        ctx.db.query("agentInvocationPayloads").unique(),
    );
    expect(payload).toMatchObject({
        state: "incomplete",
        code: "journal_request_capacity",
    });
    expect(payload?.json).toBeUndefined();
    expect(payload?.contentHash).toHaveLength(64);
});

test("an oversized observable reply does not discard the normalized result or pretend an excerpt is complete", async () => {
    const { t, invocationId, attempt } = await oneShotFixture();
    await t.mutation(internal.execution.invocations.finishOneShot, {
        invocationId,
        outputJson: '{"status":"succeeded"}',
        observableReplyJson: JSON.stringify({
            version: 1,
            text: "x".repeat(512 * 1024),
        }),
        attempt: {
            ...attempt,
            status: "succeeded",
            dispatchOutcome: "response_received",
        },
    });
    const payload = await t.run((ctx) =>
        ctx.db.query("agentInvocationPayloads").unique(),
    );
    expect(payload).toMatchObject({
        state: "incomplete",
        code: "journal_reply_capacity",
    });
    expect(payload?.json).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get(invocationId))).toMatchObject({
        status: "returned",
        outputJson: '{"status":"succeeded"}',
    });
});

test("dispatch authority is checked again after request persistence", async () => {
    const { t, runId, invocationId } = await oneShotFixture();
    await t.mutation(internal.execution.invocations.retainRequest, {
        invocationId,
        expectedGeneration: 3,
        requestJson: '{"version":1,"input":{}}',
        effectiveMaxOutputTokens: 8192,
    });
    expect(
        await t.query(internal.execution.invocations.authorizeDispatch, {
            invocationId,
            expectedGeneration: 3,
        }),
    ).toBeNull();
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            executionStatus: "cancelled",
            executionGeneration: 4,
        }),
    );
    await expect(
        t.query(internal.execution.invocations.authorizeDispatch, {
            invocationId,
            expectedGeneration: 3,
        }),
    ).rejects.toThrow();
    const payload = await t.run((ctx) =>
        ctx.db.query("agentInvocationPayloads").unique(),
    );
    expect(payload?.state).toBe("complete");
});

test("fragmented requests publish only after all exact fragments and refuse conflicting retries", async () => {
    const { retainedTextParts } = await import(
        "@convex/execution/retainedText"
    );
    const { t, missionId } = await seedHistoryMission();
    const begun = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 1,
        taskKey: "large-request",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const args = { invocationId: begun.invocationId, expectedGeneration: 1 };
    const json = JSON.stringify({
        message: "Documentary nuance — 🧭".repeat(40000),
    });
    const { manifest, parts } = retainedTextParts(json);
    const first = {
        ...args,
        fragment: { ...manifest, index: 0, content: parts[0] ?? "" },
    };
    const textId = await t.mutation(
        internal.execution.invocationLifecycle.stageRequest,
        first,
    );
    expect(
        await t.mutation(
            internal.execution.invocationLifecycle.stageRequest,
            first,
        ),
    ).toBe(textId);
    await expect(
        t.mutation(internal.execution.invocations.retainRequest, {
            ...args,
            textId,
        }),
    ).rejects.toThrow("retained_text_incomplete");
    for (let index = 1; index < parts.length; index++)
        await t.mutation(internal.execution.invocationLifecycle.stageRequest, {
            ...args,
            fragment: { ...manifest, index, content: parts[index] ?? "" },
        });
    expect(
        await t.mutation(internal.execution.invocations.retainRequest, {
            ...args,
            textId,
        }),
    ).toEqual({ kind: "ready" });
    const event = await t.run((ctx) =>
        ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_invocation_and_kind", (q) =>
                q
                    .eq("invocationId", begun.invocationId)
                    .eq("kind", "invocation_request_recorded"),
            )
            .unique(),
    );
    assert(event);
    const observed = await t.run((ctx) =>
        projectMissionHistoryEvent(ctx, event),
    );
    expect(JSON.parse(observed.json).invocation.value).toEqual(
        JSON.parse(json),
    );
    let offset = 0;
    let recovered = "";
    let totalCharacters = Infinity;
    do {
        const fragment = await t.run((ctx) =>
            readMissionHistoryEventFragment(
                ctx,
                event,
                offset,
                offset < 8000 ? 4000 : 60000,
            ),
        );
        recovered += fragment.content;
        offset = fragment.end;
        totalCharacters = fragment.totalCharacters;
    } while (offset < totalCharacters);
    expect(JSON.parse(recovered).invocation.value).toEqual(JSON.parse(json));
    await expect(
        t.mutation(internal.execution.invocationLifecycle.stageRequest, {
            ...first,
            fragment: { ...first.fragment, content: "Changed" },
        }),
    ).rejects.toThrow("retained_text_invalid");
});

test("a false complete-content hash cannot publish even when individual fragment hashes match", async () => {
    const { retainedTextParts } = await import(
        "@convex/execution/retainedText"
    );
    const f = await seedHistoryMission();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 1,
        taskKey: "false-hash",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const { manifest, parts } = retainedTextParts("{}");
    await expect(
        f.t.mutation(internal.execution.invocationLifecycle.stageRequest, {
            invocationId: begun.invocationId,
            expectedGeneration: 1,
            fragment: {
                ...manifest,
                contentHash: "0".repeat(64),
                index: 0,
                content: parts[0] ?? "",
            },
        }),
    ).rejects.toThrow("retained_text_invalid");
});

test("a confirmed native observable reply retains complete large content before adoption", async () => {
    const f = await seedHistoryMission();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 1,
        taskKey: "large-reply",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const replyJson = JSON.stringify({
        version: 1,
        content: "Exact provider observation 🧭".repeat(28000),
    });
    await f.t.mutation(internal.execution.invocations.retainOutput, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
        responseJson: JSON.stringify({ kind: "operations", requests: [] }),
        observableReplyJson: replyJson,
    });
    const payload = await f.t.run((ctx) =>
        ctx.db
            .query("agentInvocationPayloads")
            .withIndex("by_invocation_and_part", (q) =>
                q.eq("invocationId", begun.invocationId).eq("part", "reply"),
            )
            .unique(),
    );
    expect(payload?.state).toBe("complete");
    const event = await f.t.run((ctx) =>
        ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_invocation_and_kind", (q) =>
                q
                    .eq("invocationId", begun.invocationId)
                    .eq("kind", "invocation_reply_recorded"),
            )
            .unique(),
    );
    assert(event);
    const history = await f.t.run((ctx) =>
        projectMissionHistoryEvent(ctx, event),
    );
    expect(JSON.parse(history.json).invocation.value).toEqual(
        JSON.parse(replyJson),
    );
});

test("recovery retention leaves document capacity for bounded lifecycle results", async () => {
    const f = await seedHistoryMission();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 1,
        taskKey: "recovery-headroom",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    await f.t.run((ctx) =>
        ctx.db.patch(begun.invocationId, {
            inputJson: JSON.stringify({ fixture: "i".repeat(450 * 1024) }),
        }),
    );
    const rawOutputJson = JSON.stringify({ original: "r".repeat(400 * 1024) });
    await f.t.mutation(internal.execution.invocations.retainOutput, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
        responseJson: JSON.stringify({ kind: "operations", requests: [] }),
        rawOutputJson,
    });
    const invocation = await f.t.run((ctx) => ctx.db.get(begun.invocationId));
    assert(invocation);
    const boundedResult = "r".repeat(MAX_OPERATION_RESULT_BYTES);
    expect(
        getDocumentSize({
            ...invocation,
            receivedOutputJson: boundedResult,
            outputJson: boundedResult,
            correction: {
                code: "correction",
                issues: [{ path: "field", expected: boundedResult }],
            },
        }),
    ).toBeLessThan(1024 * 1024);
    const { invocationRawOutputJson } = await import(
        "@convex/execution/journal"
    );
    expect(
        await f.t.run((ctx) => invocationRawOutputJson(ctx, invocation)),
    ).toBe(rawOutputJson);
});

test("one-shot provider observations use the admitted preparation hash and reject a changed receipt identity", async () => {
    const f = await oneShotFixture(sha256Hex("domain-logical-input"));
    await f.t.mutation(internal.execution.invocations.retainRequest, {
        invocationId: f.invocationId,
        expectedGeneration: 3,
        requestJson: '{"input":{"model":"test"}}',
        effectiveMaxOutputTokens: 1024,
    });
    await f.t.mutation(internal.providerCalls.observeGeneration, {
        invocationId: f.invocationId,
        generationId: "one-shot-generation",
        httpStatus: 200,
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.providerCallId))).toMatchObject({
        status: "started",
        providerObservation: { generationId: "one-shot-generation" },
    });
    await f.t.run((ctx) =>
        ctx.db.patch(f.providerCallId, {
            inputHash: sha256Hex("another-logical-input"),
        }),
    );
    await expect(
        f.t.mutation(internal.providerCalls.observeGeneration, {
            invocationId: f.invocationId,
            requestId: "foreign-receipt-observation",
        }),
    ).rejects.toThrow("Invalid provider observation");
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.providerCallId)))
            ?.providerObservation?.requestId,
    ).toBeUndefined();
});
