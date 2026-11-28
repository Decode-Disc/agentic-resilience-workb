import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { stageObservedBody } from "@convex/execution/observedReply";
import { appendRetainedText } from "@convex/execution/retainedText";
import schema from "@convex/schema";
import type { FunctionReturnType } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import {
    beginFixtureInvocation,
    retainFixtureRequest,
    stageFixtureRequest,
} from "@/__tests__/setup/pi-mission";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

async function journalFixture(
    existing?: Parameters<typeof seedInspectedEvidence>[1],
) {
    const fixture = await seedInspectedEvidence({}, existing);
    const { t, args } = fixture;
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        expectedGeneration: 4,
        definitionId: "saved_material_inspection_v1",
        requestKey: "admin-journal",
    });
    const invocation = await beginFixtureInvocation(t, {
        missionId,
        expectedGeneration: 4,
        taskKey: "first",
        provenance: "simulation",
    });
    if (invocation.kind !== "ready") throw new Error("Expected invocation");
    await retainFixtureRequest(t, {
        invocationId: invocation.invocationId,
        expectedGeneration: 4,
        requestJson: JSON.stringify({
            version: 1,
            input: {
                prompt: "Private prompt retained as text <script>bad()</script>",
            },
        }),
    });
    return { ...fixture, missionId, invocationId: invocation.invocationId };
}

test("only an active administrator can read paginated journal events and lazily inspect their payload", async () => {
    const { t, args, userId, visitorId, invocationId } = await journalFixture();
    const identity = t.withIdentity({ subject: `${userId}|journal-test` });
    await expect(
        identity.query(api.adminOperations.listRunJournalEventsPage, {
            runId: args.runId,
            paginationOpts: { numItems: 20, cursor: null },
        }),
    ).rejects.toThrow("Unauthorized");
    await t.run((ctx) => ctx.db.patch(visitorId, { role: "admin" }));
    const first = await identity.query(
        api.adminOperations.listRunJournalEventsPage,
        {
            runId: args.runId,
            paginationOpts: { numItems: 2, cursor: null },
        },
    );
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);
    const second = await identity.query(
        api.adminOperations.listRunJournalEventsPage,
        {
            runId: args.runId,
            paginationOpts: { numItems: 20, cursor: first.continueCursor },
        },
    );
    const event = second.page.find(
        (item) => item.kind === "invocation_request_recorded",
    );
    expect(event).toBeDefined();
    expect(JSON.stringify([...first.page, ...second.page])).not.toContain(
        "Private prompt",
    );
    if (!event) throw new Error("Expected request event");
    await t.run((ctx) =>
        ctx.db.patch(args.runId, {
            executionStatus: "cancelled",
            withdrawnAt: 10,
        }),
    );
    await t.run((ctx) =>
        ctx.db.patch(invocationId, {
            receivedOutputJson: '{"kind":"blocked","code":"retained"}',
        }),
    );
    const detail = await identity.query(
        api.adminOperations.inspectJournalEvent,
        { runId: args.runId, eventId: event._id },
    );
    expect(detail.invocation).toMatchObject({
        generationBackend: { id: "pi-durable", version: 1 },
        journalVersion: 1,
        provenance: "simulation",
        receivedOutputJson: '{"kind":"blocked","code":"retained"}',
    });
    const payload = await identity.query(
        api.adminOperations.readInvocationJournalPayload,
        { runId: args.runId, invocationId, part: "request" },
    );
    expect(payload.kind).toBe("recorded");
    if (payload.kind !== "recorded") throw new Error("Expected payload");
    expect(payload.payload.json).toContain("Private prompt");
    expect(
        (await t.run((ctx) => ctx.db.get(args.runId)))?.executionStatus,
    ).toBe("cancelled");
    await t.run((ctx) => ctx.db.patch(visitorId, { status: "revoked" }));
    await expect(
        identity.query(api.adminOperations.inspectJournalEvent, {
            runId: args.runId,
            eventId: event._id,
        }),
    ).rejects.toThrow("Unauthorized");
});

test("historical inputs are not presented as reconstructed request snapshots", async () => {
    const { t, args, userId, visitorId, invocationId } = await journalFixture();
    await t.run(async (ctx) => {
        await ctx.db.patch(visitorId, { role: "admin" });
        await ctx.db.patch(invocationId, { journalVersion: undefined });
        const payloads = await ctx.db
            .query("agentInvocationPayloads")
            .withIndex("by_invocation_and_part", (q) =>
                q.eq("invocationId", invocationId),
            )
            .collect();
        for (const payload of payloads) await ctx.db.delete(payload._id);
    });
    const admin = t.withIdentity({ subject: `${userId}|journal-test` });
    expect(
        await admin.query(api.adminOperations.readInvocationJournalPayload, {
            runId: args.runId,
            invocationId,
            part: "request",
        }),
    ).toEqual({ kind: "unavailable", code: "historical_trace" });
    await expect(
        t.query(api.adminOperations.readInvocationJournalPayload, {
            runId: args.runId,
            invocationId,
            part: "request",
        }),
    ).rejects.toThrow("Not authenticated");
});

test.each([
    { id: "ai-sdk", version: 1 },
    { id: "convex-agent", version: 2 },
])("an administrator can inspect a retained $id journal without restarting its retired executor", async (generationBackend) => {
    const { t, args, userId, visitorId, missionId, invocationId } =
        await journalFixture();
    const reply = stableStringify({
        version: 1,
        provenance: "simulation",
        content: "Historical reply, preserved exactly.",
    });
    await t.mutation(internal.execution.invocations.retainOutput, {
        invocationId,
        expectedGeneration: 4,
        responseJson: '{"kind":"blocked","code":"historical_record"}',
        observableReplyJson: reply,
    });
    await t.run(async (ctx) => {
        await ctx.db.patch(visitorId, { role: "admin" });
        await ctx.db.patch(missionId, {
            generationBackend,
            executionRuntime: undefined,
            status: "blocked",
            blockCode: "historical_record",
        });
        await ctx.db.patch(invocationId, {
            generationBackend,
            status: "returned",
        });
    });
    const snapshot = () =>
        t.run(async (ctx) => ({
            mission: await ctx.db.get(missionId),
            invocation: await ctx.db.get(invocationId),
            calls: await ctx.db.query("providerCalls").collect(),
            scheduled: await ctx.db.system
                .query("_scheduled_functions")
                .collect(),
        }));
    const before = await snapshot();
    const admin = t.withIdentity({ subject: `${userId}|historical-journal` });
    const page = await admin.query(
        api.adminOperations.listRunJournalEventsPage,
        {
            runId: args.runId,
            paginationOpts: { numItems: 20, cursor: null },
        },
    );
    const event = page.page.find(
        (item) => item.kind === "invocation_request_recorded",
    );
    if (!event) throw new Error("Expected request event");
    const detail = await admin.query(api.adminOperations.inspectJournalEvent, {
        runId: args.runId,
        eventId: event._id,
    });
    expect(detail.invocation).toMatchObject({
        generationBackend,
        status: "returned",
        provenance: "simulation",
    });
    const request = await admin.query(
        api.adminOperations.readInvocationJournalPayload,
        { runId: args.runId, invocationId, part: "request" },
    );
    expect(request.kind).toBe("recorded");
    if (request.kind !== "recorded" || request.payload.json === undefined)
        throw new Error("Expected retained request");
    expect(JSON.parse(request.payload.json)).toEqual({
        version: 1,
        input: {
            prompt: "Private prompt retained as text <script>bad()</script>",
        },
    });
    const observed = await admin.query(
        api.adminOperations.readInvocationJournalPayload,
        { runId: args.runId, invocationId, part: "reply" },
    );
    expect(observed.kind).toBe("recorded");
    if (observed.kind !== "recorded")
        throw new Error("Expected retained reply");
    expect(observed.payload.json).toBe(reply);
    expect(await snapshot()).toEqual(before);
    await t.run((ctx) => ctx.db.patch(visitorId, { status: "revoked" }));
    await expect(
        admin.query(api.adminOperations.readInvocationJournalPayload, {
            runId: args.runId,
            invocationId,
            part: "request",
        }),
    ).rejects.toThrow("Unauthorized");
});

test("inspection refuses cross-dossier event, payload and mission correlations", async () => {
    const { t, args, userId, visitorId, missionId, invocationId } =
        await journalFixture();
    const otherRunId = await t.run(async (ctx) => {
        await ctx.db.patch(visitorId, { role: "admin" });
        const original = await ctx.db.get(args.runId);
        if (!original) throw new Error("Missing fixture run");
        const { _id, _creationTime, ...fields } = original;
        return ctx.db.insert("researchRuns", {
            ...fields,
            executionStatus: "idle",
        });
    });
    const admin = t.withIdentity({ subject: `${userId}|journal-test` });
    const events = await admin.query(
        api.adminOperations.listRunJournalEventsPage,
        { runId: args.runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    const event = events.page.find(
        (item) => item.invocationId === invocationId,
    );
    if (!event) throw new Error("Missing fixture event");
    await expect(
        admin.query(api.adminOperations.inspectJournalEvent, {
            runId: otherRunId,
            eventId: event._id,
        }),
    ).rejects.toThrow("Journal entry not found");
    await expect(
        admin.query(api.adminOperations.readInvocationJournalPayload, {
            runId: otherRunId,
            invocationId,
            part: "request",
        }),
    ).rejects.toThrow("Journal entry not found");
    await t.run((ctx) => ctx.db.patch(missionId, { runId: otherRunId }));
    await expect(
        admin.query(api.adminOperations.inspectJournalEvent, {
            runId: args.runId,
            eventId: event._id,
        }),
    ).rejects.toThrow("Journal correlation mismatch");
});

test("earlier versioned local refusals remain known non-dispatches when snapshots are absent", async () => {
    const { t, args, userId, visitorId, invocationId } = await journalFixture();
    await t.run(async (ctx) => {
        await ctx.db.patch(visitorId, { role: "admin" });
        await ctx.db.patch(invocationId, {
            provenance: "live",
            receivedOutputJson:
                '{"kind":"blocked","code":"missing_authorized_route"}',
        });
        const payloads = await ctx.db
            .query("agentInvocationPayloads")
            .withIndex("by_invocation_and_part", (q) =>
                q.eq("invocationId", invocationId),
            )
            .collect();
        for (const payload of payloads) await ctx.db.delete(payload._id);
    });
    const admin = t.withIdentity({ subject: `${userId}|journal-test` });
    for (const part of ["request", "reply"] as const)
        expect(
            await admin.query(
                api.adminOperations.readInvocationJournalPayload,
                { runId: args.runId, invocationId, part },
            ),
        ).toEqual({ kind: "unavailable", code: "not_dispatched" });
});

test("inspection preserves the adoption fence of an observation received after cancellation", async () => {
    const { t, args, userId, visitorId, invocationId } = await journalFixture();
    const owner = t.withIdentity({
        subject: `${userId}|late-journal-observation`,
    });
    await owner.mutation(api.workflowControls.cancel, { runId: args.runId });
    await t.mutation(internal.execution.invocations.retainOutput, {
        invocationId,
        expectedGeneration: 4,
        responseJson: '{"kind":"blocked","code":"late_response"}',
    });
    await t.run((ctx) => ctx.db.patch(visitorId, { role: "admin" }));
    const events = await owner.query(
        api.adminOperations.listRunJournalEventsPage,
        { runId: args.runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    const event = events.page.find(
        (item) =>
            item.invocationId === invocationId &&
            item.kind === "invocation_output_observed",
    );
    if (!event) throw new Error("Missing observation event");
    const detail = await owner.query(api.adminOperations.inspectJournalEvent, {
        runId: args.runId,
        eventId: event._id,
    });
    expect(detail.invocation).toMatchObject({
        status: "started",
        receivedWhileAuthorized: false,
    });
});

test("journal inspection rejects a conversation reference belonging to another dossier", async () => {
    const f = await journalFixture();
    await f.t.run((ctx) => ctx.db.patch(f.visitorId, { role: "admin" }));
    const eventId = await f.t.run(async (ctx) => {
        const otherRun = await ctx.db.insert("researchRuns", {
            purpose: "research",
            lifecycleState: "draft",
            executionStatus: "idle",
            executionGeneration: 0,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 1,
        });
        const conversationId = await ctx.db.insert("agentConversations", {
            runId: otherRun,

            queuedCount: 0,
            createdAt: 1,
        });
        const turnId = await ctx.db.insert("agentConversationTurns", {
            runId: otherRun,
            conversationId,
            status: "active",
            instructionVersion: 1,
            generation: 1,
            messageCount: 0,
            createdAt: 1,
        });
        return ctx.db.insert("agentExecutionEvents", {
            runId: f.args.runId,
            conversationTurnId: turnId,
            kind: "turn_started",
            cause: "invalid-correlation",
            occurredAt: 1,
        });
    });
    await expect(
        f.t
            .withIdentity({ subject: f.userId })
            .query(api.adminOperations.inspectJournalEvent, {
                runId: f.args.runId,
                eventId,
            }),
    ).rejects.toThrow("Journal correlation mismatch");
});

test("administrator pages the exact complete fragmented request with the same authorization and correlation checks", async () => {
    const { retainedTextParts } = await import(
        "@convex/execution/retainedText"
    );
    const f = await seedInspectedEvidence();
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.args.runId,
        corpusRevisionId: f.args.corpusRevisionId,
        expectedGeneration: 4,
        definitionId: "saved_material_inspection_v1",
        requestKey: "fragmented-admin",
    });
    await f.t.run((ctx) => ctx.db.patch(f.visitorId, { role: "admin" }));
    const identity = f.t.withIdentity({ subject: `${f.userId}|journal-test` });
    const begun = await beginFixtureInvocation(f.t, {
        missionId,
        expectedGeneration: 4,
        taskKey: "fragmented-admin",
        provenance: "simulation",
    });
    if (begun.kind !== "ready") throw new Error("Expected invocation");
    const json = JSON.stringify({
        text: "Exact immutable content 🧭".repeat(26000),
    });
    const { manifest, parts } = retainedTextParts(json);
    let textId: Id<"retainedTexts"> | undefined;
    for (const [index, content] of parts.entries())
        textId = await stageFixtureRequest(f.t, {
            invocationId: begun.invocationId,
            expectedGeneration: 4,
            fragment: { ...manifest, index, content },
        });
    await retainFixtureRequest(f.t, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        textId,
    });
    let cursor: string | null = null;
    let actual = "";
    do {
        const page: FunctionReturnType<
            typeof api.adminOperations.listInvocationPayloadFragmentsPage
        > = await identity.query(
            api.adminOperations.listInvocationPayloadFragmentsPage,
            {
                runId: f.args.runId,
                invocationId: begun.invocationId,
                part: "request",
                paginationOpts: { numItems: 1, cursor },
            },
        );
        actual += page.page.map((fragment) => fragment.content).join("");
        cursor = page.isDone ? null : page.continueCursor;
    } while (cursor);
    expect(actual).toBe(json);
    await expect(
        f.t.query(api.adminOperations.listInvocationPayloadFragmentsPage, {
            runId: f.args.runId,
            invocationId: begun.invocationId,
            part: "request",
            paginationOpts: { numItems: 1, cursor: null },
        }),
    ).rejects.toThrow();
});

test("only an active administrator can read a committed open diagnostic prefix after worker loss", async () => {
    const f = await journalFixture();
    await f.t.run(async (ctx) => {
        const textId = await appendRetainedText(
            ctx,
            `${f.invocationId}:visible`,
            0,
            "committed before crash",
        );
        await ctx.db.patch(f.invocationId, {
            visibleOutput: { textId, complete: false },
        });
    });
    const args = {
        runId: f.runId,
        invocationId: f.invocationId,
        paginationOpts: { cursor: null, numItems: 1 },
    };
    const client = f.t.withIdentity({ subject: `${f.userId}|journal-test` });
    await expect(
        client.query(api.adminOperations.readInvocationVisibleOutput, args),
    ).rejects.toThrow("Unauthorized");
    await f.t.run((ctx) => ctx.db.patch(f.visitorId, { role: "admin" }));
    const output = await client.query(
        api.adminOperations.readInvocationVisibleOutput,
        args,
    );
    expect(output?.capture).toMatchObject({ complete: false });
    expect(output?.fragments.page).toEqual([
        { index: 0, content: "committed before crash" },
    ]);
});

test.each([
    70_000, 175_000,
])("administrator inspects retained output of %i characters and recovers exact fragments", async (size) => {
    const { t, args, userId, visitorId, invocationId } = await journalFixture(
        convexTest({
            schema,
            modules: import.meta.glob("/convex/**/*.ts"),
            transactionLimits: { bytesRead: 128 * 1024 },
        }),
    );
    const responseJson = stableStringify({
        kind: "blocked",
        code: `${"x".repeat(size)} 🧭`,
    });
    const authority = { invocationId, expectedGeneration: 4 };
    const responseTextId = await t.action((ctx) =>
        stageObservedBody(ctx, authority, "response", responseJson),
    );
    const observableReplyTextId = await t.action((ctx) =>
        stageObservedBody(
            ctx,
            authority,
            "reply",
            stableStringify({
                version: 1,
                provenance: "simulation",
                response: JSON.parse(responseJson),
            }),
        ),
    );
    if (!responseTextId || !observableReplyTextId)
        throw new Error("Missing staged fixture output");
    await t.mutation(internal.execution.invocations.retainOutput, {
        invocationId,
        expectedGeneration: 4,
        responseTextId,
        observableReplyTextId,
    });
    await t.run((ctx) => ctx.db.patch(visitorId, { role: "admin" }));
    const admin = t.withIdentity({ subject: `${userId}|large-result` });
    const event = await t.run((ctx) =>
        ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_invocation_and_kind", (q) =>
                q
                    .eq("invocationId", invocationId)
                    .eq("kind", "invocation_output_observed"),
            )
            .first(),
    );
    if (!event) throw new Error("Missing observation event");
    const runId = args.runId;
    const detail = await admin.query(api.adminOperations.inspectJournalEvent, {
        runId,
        eventId: event._id,
    });
    expect(detail.invocation).toMatchObject({
        receivedOutput: {
            contentHash: sha256Hex(responseJson),
            sizeBytes: Buffer.byteLength(responseJson),
        },
    });
    expect(detail.invocation).not.toHaveProperty("receivedOutputJson");
    const separate = await admin.query(
        api.adminOperations.inspectJournalEvent,
        {
            runId,
            eventId: event._id,
            bodyAccess: "separate",
        },
    );
    const contentHash = sha256Hex(responseJson);
    expect(separate.invocation).toMatchObject({
        receivedOutput: {
            contentHash,
            sizeBytes: Buffer.byteLength(responseJson),
        },
    });
    expect(separate.invocation).not.toHaveProperty("receivedOutputJson");
    const read = api.adminOperations.listInvocationPayloadFragmentsPage;
    const scope = {
        runId,
        invocationId,
        part: "received" as const,
        contentHash,
    };
    await expect(
        t.query(read, {
            ...scope,
            paginationOpts: { numItems: 1, cursor: null },
        }),
    ).rejects.toThrow("Not authenticated");
    await expect(
        admin.query(read, {
            ...scope,
            contentHash: "wrong-content",
            paginationOpts: { numItems: 1, cursor: null },
        }),
    ).rejects.toThrow("Journal correlation mismatch");
    let cursor: string | null = null;
    let actual = "";
    for (;;) {
        const page: FunctionReturnType<typeof read> = await admin.query(read, {
            ...scope,
            paginationOpts: { numItems: 1, cursor },
        });
        actual += page.page.map((item) => item.content).join("");
        if (page.isDone) break;
        cursor = page.continueCursor;
    }
    expect(actual).toBe(responseJson);
});
