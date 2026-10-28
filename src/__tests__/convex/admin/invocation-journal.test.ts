import { api, internal } from "@convex/_generated/api";
import { expect, test } from "vitest";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

async function journalFixture() {
    const fixture = await seedInspectedEvidence();
    const { t, args } = fixture;
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        expectedGeneration: 4,
        definitionId: "saved_material_inspection_v1",
        requestKey: "admin-journal",
    });
    const invocation = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "first",
        provenance: "simulation",
    });
    if (invocation.kind !== "ready") throw new Error("Expected invocation");
    await t.mutation(internal.execution.invocations.retainRequest, {
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
