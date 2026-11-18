import { api, internal } from "@convex/_generated/api";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { agentToolSchemas } from "@convex/execution/agentDefinition";
import type { FunctionArgs } from "convex/server";
import { validate } from "convex-helpers/validators";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    nativePiFixtureRoute,
    nativeTextReply,
} from "@/__tests__/setup/pi-native";
import {
    seedWorkbench,
    workbenchAdmissionInput,
} from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

async function activeWorkbench(text: string, version: 4 | 5 = 4, local = true) {
    const fixture = await seedWorkbench(
        local,
        local ? undefined : nativePiFixtureRoute,
        60000,
        undefined,
        undefined,
        version,
    );
    const { t, client, runId } = fixture;
    const queued = await t.run((ctx) =>
        ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", runId).eq("status", "queued"),
            )
            .first(),
    );
    assert(queued);
    await client.mutation(api.execution.conversations.removeQueued, {
        runId,
        messageId: queued._id,
    });
    const messageId = await client.mutation(
        api.execution.conversations.submit,
        { runId, requestKey: "current-request", text, delivery: "queue" },
    );
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: local,
        },
    );
    assert(active);
    return { ...fixture, ...active, messageId };
}

test.each([
    "What did I ask you to change in my previous message? Keep the saved program unchanged.",
    "Start research now",
    "Pause research",
    "Resume research",
])("a preservation or control-only command removes framing writes (%s)", (text) => {
    const tools = agentToolSchemas(getAgentDefinition("workbench_v1"), {
        framing: { revision: 1, fixed: false },
        conversationInstructions: {
            messages: [
                {
                    messageId: "current",
                    text,
                },
            ],
        },
    });
    expect(tools).not.toHaveProperty("adjust_framing");
    expect(tools).toHaveProperty("consult_conversation");
});

test("an incomplete French preservation phrase does not turn the response read-only", () => {
    const tools = agentToolSchemas(getAgentDefinition("workbench_v1"), {
        framing: { revision: 1, fixed: false },
        conversationInstructions: {
            messages: [{ messageId: "current", text: "Garde le programme." }],
        },
    });
    expect(tools).toHaveProperty("adjust_framing");
});

test.each([
    "Explain the earlier question. Keep the saved program unchanged.",
    "Start research now",
    "Pause research",
    "Resume research",
])("the server refuses a forced framing write under preservation or control-only authority (%s)", async (text) => {
    const { t, client, runId, missionId, messageId } =
        await activeWorkbench(text);
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 1,
        cause: "forced-write",
        input: {
            kind: "adjust_framing",
            messageId,
            expectedRevision: 1,
            content: { scope: "Unauthorized replacement", questions: [] },
        },
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "refused", code: "framing_read_only" });
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 1,
        content: { scope: "", questions: [] },
    });
});

test.each([
    "{",
    JSON.stringify({ content: { scope: "Incomplete" } }),
])("a final promise after a rejected framing proposal includes the recorded failure and no pending edit: %s", async (inputJson) => {
    const { t, client, runId, missionId } = await activeWorkbench(
        "Rewrite the switching question.",
    );
    const invocation = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 1,
        taskKey: "invalid-edit",
        provenance: "simulation",
        nativeInput: await workbenchAdmissionInput(t, missionId),
    });
    assert(invocation.kind === "ready");
    const finish = await t.mutation(internal.execution.invocations.finish, {
        invocationId: invocation.invocationId,
        expectedGeneration: 1,
        response: {
            kind: "operations",
            requests: [
                { name: "adjust_framing", callId: "bad-edit", inputJson },
            ],
        },
    });
    const requestId = finish.requestIds[0];
    assert(requestId);
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "refused", code: "invalid_operation_input" });
    const final = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 1,
        taskKey: "final-promise",
        provenance: "simulation",
        nativeInput: await workbenchAdmissionInput(t, missionId),
    });
    assert(final.kind === "ready");
    await t.mutation(internal.execution.invocations.finish, {
        invocationId: final.invocationId,
        expectedGeneration: 1,
        response: {
            kind: "complete",
            text: "I will correct the proposal and resubmit it.",
        },
    });
    const history = await client.query(
        api.execution.conversations.listMessages,
        { runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    const reply = history.page.find(
        (message) => message.role === "assistant",
    )?.text;
    expect(reply).toContain(
        "The proposed framing change was not saved. No framing change from this response is waiting to run.",
    );
    expect(reply).toContain("I will correct the proposal and resubmit it.");
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 1,
        content: { scope: "", questions: [] },
    });
});

async function respond(
    fixture: Awaited<ReturnType<typeof activeWorkbench>>,
    taskKey: string,
    response: FunctionArgs<
        typeof internal.execution.invocations.finish
    >["response"],
) {
    const { t, missionId } = fixture;
    const invocation = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 1,
        taskKey,
        provenance: "simulation",
        nativeInput: await workbenchAdmissionInput(t, missionId),
    });
    assert(invocation.kind === "ready");
    return t.mutation(internal.execution.invocations.finish, {
        invocationId: invocation.invocationId,
        expectedGeneration: 1,
        response,
    });
}

const incompleteEdit = JSON.stringify({ content: { scope: "Incomplete" } });
const correctedEdit = JSON.stringify({
    eventBasis: { kind: "none" },
    content: {
        scope: "Claims coordination",
        questions: [
            {
                id: "switching",
                shortLabel: "Switching",
                text: "What constrains provider switching?",
                rationale: "Inspect dependencies.",
            },
        ],
    },
});
const failureReceipt =
    "The proposed framing change was not saved. No framing change from this response is waiting to run.";

test.each([
    false,
    true,
])("the latest admission determines the receipt even when an old failed request is reused: %s", async (reuseFailure) => {
    const fixture = await activeWorkbench("Rewrite the switching question.");
    const { t, client, runId } = fixture;
    const failed = await respond(fixture, "first-failure", {
        kind: "operations",
        requests: [
            {
                callId: "first-failure",
                name: "adjust_framing",
                inputJson: incompleteEdit,
            },
        ],
    });
    const failedId = failed.requestIds[0];
    assert(failedId);
    const failedRequest = await t.run((ctx) => ctx.db.get(failedId));
    const admissionEventId = failedRequest?.admissionEventId;
    assert(admissionEventId);
    expect(await t.run((ctx) => ctx.db.get(admissionEventId))).toMatchObject({
        requestId: failedId,
        kind: "operation_refused",
    });
    const corrected = await respond(fixture, "corrected", {
        kind: "operations",
        requests: [
            {
                callId: "corrected",
                name: "adjust_framing",
                inputJson: correctedEdit,
            },
        ],
    });
    const correctedId = corrected.requestIds[0];
    assert(correctedId);
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId: correctedId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "success" });
    if (reuseFailure) {
        const replay = await respond(fixture, "reused-failure", {
            kind: "operations",
            requests: [
                {
                    callId: "reused-failure",
                    name: "adjust_framing",
                    inputJson: incompleteEdit,
                },
            ],
        });
        expect(replay.requestIds).toEqual([failedId]);
    }
    await respond(fixture, "final", {
        kind: "complete",
        text: "The current program remains available.",
    });
    const history = await client.query(
        api.execution.conversations.listMessages,
        { runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    const text = history.page.find(
        (message) => message.role === "assistant",
    )?.text;
    expect(text?.includes(failureReceipt)).toBe(reuseFailure);
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 2,
        content: { scope: "Claims coordination" },
    });
});

test.each([
    "Please do not modify the research plan.",
    "Ne modifie pas le programme de recherche.",
    "Conserve le cadrage inchangé.",
])("an explicit preservation command keeps consultation available: %s", (text) => {
    const tools = agentToolSchemas(getAgentDefinition("workbench_v1"), {
        framing: { revision: 1, fixed: false },
        conversationInstructions: {
            messages: [{ messageId: "current", text }],
        },
    });
    expect(tools).not.toHaveProperty("adjust_framing");
    expect(tools).toHaveProperty("consult_conversation");
});

test.each([
    "Keep our scope and all other questions unchanged. Rewrite the switching question.",
    '"Keep the saved program unchanged." was an earlier message. Rewrite the switching question.',
    "Keep the program unchanged if the evidence is stale.",
])("partial, quoted or conditional text does not assert an unconditional preservation command: %s", (text) => {
    expect(
        agentToolSchemas(getAgentDefinition("workbench_v1"), {
            framing: { revision: 1, fixed: false },
            conversationInstructions: {
                messages: [{ messageId: "current", text }],
            },
        }),
    ).toHaveProperty("adjust_framing");
});

test.each([
    "queue",
    "steer",
] as const)("only admitted preservation commands restrict an active framing write: %s", async (delivery) => {
    const { t, client, runId, missionId, turnId, messageId } =
        await activeWorkbench("Rewrite the switching question.");
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "preserve",
        text: "Keep the saved program unchanged.",
        delivery,
        ...(delivery === "steer" ? { turnId } : {}),
    });
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 1,
        cause: "fresh-write",
        input: {
            kind: "adjust_framing",
            expectedRevision: 1,
            messageId,
            content: { scope: "Claims", questions: [] },
        },
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject(
        delivery === "steer"
            ? { kind: "refused", code: "framing_read_only" }
            : { kind: "success" },
    );
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: delivery === "steer" ? 1 : 2,
    });
});

test("a preservation command expires with its response and does not block a later edit request", async () => {
    const first = await activeWorkbench("Keep the saved program unchanged.");
    await respond(first, "read-only-answer", {
        kind: "complete",
        text: "The saved program is unchanged.",
    });
    const { t, client, runId } = first;
    const messageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId,
            requestKey: "later-edit",
            text: "Rewrite the switching question.",
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
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "later-edit",
        input: {
            kind: "adjust_framing",
            expectedRevision: 1,
            messageId,
            content: { scope: "Later authorized scope", questions: [] },
        },
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "success" });
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 2,
        content: { scope: "Later authorized scope" },
    });
});

test.each([
    "outcome",
    "cause",
] as const)("an incomplete framing receipt cannot publish an assertion that nothing was saved: %s", async (missing) => {
    const fixture = await activeWorkbench("Rewrite the switching question.");
    const { t, client, runId } = fixture;
    const result = await respond(fixture, "refused", {
        kind: "operations",
        requests: [
            {
                callId: "refused",
                name: "adjust_framing",
                inputJson: incompleteEdit,
            },
        ],
    });
    const requestId = result.requestIds[0];
    assert(requestId);
    await t.run((ctx) =>
        ctx.db.patch(
            requestId,
            missing === "outcome"
                ? { outcome: undefined }
                : { admissionEventId: undefined },
        ),
    );
    await expect(
        respond(fixture, "cannot-confirm", {
            kind: "complete",
            text: "The edit was rejected.",
        }),
    ).rejects.toThrow("framing_receipt_unavailable");
    const history = await client.query(
        api.execution.conversations.listMessages,
        { runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    expect(
        history.page.filter((message) => message.role === "assistant"),
    ).toEqual([]);
});

test("a control message cannot cause a framing write while a separate active edit request retains authority", async () => {
    const { t, client, runId, missionId, messageId } =
        await activeWorkbench("Start research now");
    const state = await client.query(api.execution.conversations.get, {
        runId,
    });
    assert(state.activeTurn);
    const editMessageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId,
            requestKey: "independent-edit",
            text: "Update the research scope to insurer-repairer coordination.",
            delivery: "steer",
            turnId: state.activeTurn._id,
        },
    );
    const tools = agentToolSchemas(getAgentDefinition("workbench_v1"), {
        framing: { revision: 1, fixed: false },
        conversationInstructions: {
            messages: [
                { messageId, text: "Start research now" },
                {
                    messageId: editMessageId,
                    text: "Update the research scope to insurer-repairer coordination.",
                },
            ],
        },
    });
    expect(tools).toHaveProperty("adjust_framing");
    for (const cause of [messageId, editMessageId]) {
        const requestId = await t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId,
                expectedGeneration: 1,
                cause: `mixed-authority-${cause}`,
                input: {
                    kind: "adjust_framing",
                    messageId: cause,
                    expectedRevision: 1,
                    content: {
                        scope: "Insurer-repairer coordination",
                        questions: [],
                    },
                },
            },
        );
        expect(
            await t.action(internal.execution.operations.dispatch, {
                requestId,
                expectedGeneration: 1,
            }),
        ).toMatchObject(
            cause === messageId
                ? { kind: "refused", code: "framing_read_only" }
                : { kind: "success" },
        );
    }
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 2,
        content: { scope: "Insurer-repairer coordination", questions: [] },
    });
});

test.each([
    4, 5,
] as const)("framing v%s refuses the other version's public basis at both offered and forced-write boundaries", async (version) => {
    const { t, client, runId, missionId, messageId } = await activeWorkbench(
        "Investigate the public event.",
        version,
    );
    const referenceId = await t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId,
            expectedGeneration: 1,
            cause: "reference-for-shape-test",
            input: { kind: "consult_mission_state" },
        },
    );
    const basis =
        version === 4
            ? {
                  kind: "public" as const,
                  label: "Event",
                  readIds: [referenceId],
              }
            : {
                  kind: "public" as const,
                  label: "Event",
                  lookupRequestId: referenceId,
                  referenceIndexes: [0],
              };
    const input = {
        content: { scope: "Public event", questions: [] },
        eventBasis: basis,
    };
    const context = await t.query(internal.execution.context.build, {
        missionId,
        expectedGeneration: 1,
    });
    assert(context.kind === "ready");
    const offered = agentToolSchemas(
        getAgentDefinition("workbench_v1", version),
        JSON.parse(context.inputJson),
    );
    assert(offered.adjust_framing);
    expect(validate(offered.adjust_framing.inputValidator, input)).toBe(false);
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 1,
        cause: "forced-cross-version-basis",
        input: {
            kind: "adjust_framing",
            expectedRevision: 1,
            messageId,
            ...input,
        },
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "refused", code: "framing_event_basis_invalid" });
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 1,
        content: { scope: "", questions: [] },
    });
});

test("retained v4 refuses a forced structured open proposal rather than saving unmatched condition metadata", async () => {
    const { t, client, runId, missionId, messageId } = await activeWorkbench(
        "Investigate estimate review.",
        4,
    );
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 1,
        cause: "v5-open-on-v4",
        input: {
            kind: "adjust_framing",
            expectedRevision: 1,
            messageId,
            content: {
                scope: "Investigate estimate review",
                questions: [
                    {
                        id: "rights",
                        shortLabel: "Rights",
                        text: "who controls review?",
                        rationale: "Inspect control.",
                    },
                ],
            },
            eventBasis: {
                kind: "open",
                activityExcerpt: "estimate review",
                conditions: [
                    {
                        questionId: "rights",
                        hypothesis: "review rights change",
                        basis: { kind: "analyst", excerpt: "estimate review" },
                    },
                ],
            },
        },
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "refused", code: "framing_event_basis_invalid" });
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 1,
        content: { scope: "", questions: [] },
    });
});

test.each([
    "invented activity",
    "invented analyst basis",
    "missing question",
    "duplicate condition",
    "unavailable read",
    "empty read basis",
    "unanchored scope change",
] as const)("provisional framing refuses %s and preserves a nonempty analyst draft", async (failure) => {
    const { t, client, runId, missionId, messageId } = await activeWorkbench(
        "Investigate estimate review.",
        5,
    );
    const retained = {
        id: "keep",
        shortLabel: "Analyst question",
        text: "Which workflow decisions does the insurer control?",
        rationale: "The analyst's existing question.",
    };
    await client.mutation(api.framing.save, {
        runId,
        expectedRevision: 1,
        requestKey: "analyst-baseline",
        content: {
            scope: "Investigate estimate review",
            questions: [retained],
        },
    });
    const before = await client.query(api.framing.get, { runId });
    const referenceId = await t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId,
            expectedGeneration: 1,
            cause: "non-reading-reference",
            input: { kind: "consult_mission_state" },
        },
    );
    const basis: Extract<
        FunctionArgs<typeof internal.execution.operations.enqueue>["input"],
        { kind: "adjust_framing" }
    >["eventBasis"] = {
        kind: "open",
        activityExcerpt: "estimate review",
        conditions: [
            {
                questionId: "check",
                hypothesis: "validation rights change",
                basis: { kind: "analyst", excerpt: "estimate review" },
            },
        ],
    };
    assert(basis.conditions?.[0]);
    let scope = "Investigate estimate review";
    if (failure === "invented activity") {
        scope = "Investigate claims processing";
        basis.activityExcerpt = "claims processing";
    }
    if (failure === "invented analyst basis")
        basis.conditions[0].basis = {
            kind: "analyst",
            excerpt: "H20 licensing",
        };
    if (failure === "missing question")
        basis.conditions[0].questionId = "missing";
    if (failure === "duplicate condition")
        basis.conditions.push({ ...basis.conditions[0] });
    if (failure === "unavailable read")
        basis.conditions[0].basis = { kind: "public", readIds: [referenceId] };
    if (failure === "empty read basis")
        basis.conditions[0].basis = { kind: "public", readIds: [] };
    if (failure === "unanchored scope change") {
        scope = "Investigate a different workflow";
        delete basis.activityExcerpt;
        basis.conditions = [];
    }
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 1,
        cause: "invalid-provisional-draft",
        input: {
            kind: "adjust_framing",
            expectedRevision: 2,
            messageId,
            eventBasis: basis,
            content: {
                scope,
                questions: [
                    retained,
                    {
                        id: "check",
                        shortLabel: "Conditional check",
                        text: "can the insurer use another workflow?",
                        rationale: "Test the condition.",
                    },
                ],
            },
        },
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({
        kind: "refused",
        code:
            failure === "unavailable read"
                ? "framing_public_lookup_invalid"
                : "framing_event_basis_invalid",
    });
    expect(await client.query(api.framing.get, { runId })).toEqual(before);
});

test.each([
    "replace",
    "remove",
] as const)("changing a saved conditional hypothesis removes its old generated prefix before Start (%s)", async (change) => {
    const { activateSourcesMission } = await import(
        "@/__tests__/setup/sources-mission"
    );
    activateSourcesMission();
    vi.stubEnv("SEC_USER_AGENT", "Workbench fixture evidence@example.test");
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url, init) => {
            if (!String(url).includes("data.sec.gov/submissions/")) {
                const request = JSON.parse(String(init?.body));
                const section = request.messages.find(
                    (message: { content?: string }) =>
                        message.content?.includes(
                            "Required current mission state:",
                        ),
                );
                const state = JSON.parse(
                    section.content
                        .split("Required current mission state:\n")[1]
                        .split("\n")[0],
                );
                return state.definition.id === "sources_v1"
                    ? nativeTextReply(
                          JSON.stringify({
                              kind: "complete",
                              needs: state.activeWork.needs.map(
                                  (need: { id: string }) => ({
                                      needId: need.id,
                                      unfinished: [
                                          "Fixture ends before documentary collection.",
                                      ],
                                  }),
                              ),
                          }),
                      )
                    : nativeTextReply(
                          "The saved program is available for review.",
                      );
            }
            return Response.json({
                cik: "1818201",
                name: "CCC Intelligent Solutions Holdings Inc.",
                tickers: ["CCCS"],
                exchanges: ["NASDAQ"],
                filings: {
                    recent: {
                        accessionNumber: [],
                        filingDate: [],
                        form: [],
                        primaryDocument: [],
                    },
                },
            });
        }),
    );
    const a = "validation rights stay local";
    const b = "validation rights become portable";
    const f = await activeWorkbench(
        `Investigate estimate review. Compare whether ${a} or ${b}.`,
        5,
        false,
    );
    const rateLimiter = await import(
        "@/__tests__/convex/integrations/rate-limiter-test-register.js"
    );
    rateLimiter.default.register(f.t);
    const configured = await f.t.run(async (ctx) => {
        const catalog = (await ctx.db.query("modelCatalog").collect()).find(
            (entry) => entry.model === nativePiFixtureRoute.model,
        );
        const invitation = await ctx.db
            .query("invitations")
            .withIndex("by_slot_key", (q) => q.eq("slotKey", "admin"))
            .unique();
        const visitor = invitation?.claimedByVisitorId
            ? await ctx.db.get(invitation.claimedByVisitorId)
            : null;
        const assignment = await ctx.db
            .query("agentModelSettings")
            .withIndex("by_agent", (q) => q.eq("agent", "sources"))
            .unique();
        assert(catalog && visitor);
        return {
            catalogId: catalog._id,
            subject: visitor.authUserId,
            revision: assignment?.revision ?? 0,
        };
    });
    await f.t
        .withIdentity({ subject: configured.subject })
        .mutation(api.modelConfiguration.assign, {
            agent: "sources",
            catalogId: configured.catalogId,
            expectedRevision: configured.revision,
            requestKey: "replacement-source-model",
        });
    const question = {
        id: "validation",
        shortLabel: "Validation",
        text: "can insurers bypass the platform?",
        rationale: "Test workflow control.",
    };
    let revision = 1;
    for (const hypothesis of [a, b]) {
        const before = await f.client.query(api.framing.get, {
            runId: f.runId,
        });
        assert(before);
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId: f.missionId,
                expectedGeneration: 1,
                cause: `condition-${revision}`,
                input: {
                    kind: "adjust_framing",
                    messageId: f.messageId,
                    expectedRevision: revision,
                    content: {
                        scope: "Investigate estimate review.",
                        questions:
                            revision === 1
                                ? [question]
                                : before.content.questions,
                    },
                    eventBasis: {
                        kind: "open",
                        activityExcerpt: "estimate review",
                        conditions:
                            revision === 2 && change === "remove"
                                ? []
                                : [
                                      {
                                          questionId: question.id,
                                          hypothesis,
                                          basis: {
                                              kind: "analyst",
                                              excerpt: hypothesis,
                                          },
                                      },
                                  ],
                    },
                },
            },
        );
        expect(
            await f.t.action(internal.execution.operations.dispatch, {
                requestId,
                expectedGeneration: 1,
            }),
        ).toMatchObject({ kind: "success" });
        revision++;
    }
    const saved = await f.client.query(api.framing.get, { runId: f.runId });
    const expectedText =
        change === "replace" ? `If ${b}, ${question.text}` : question.text;
    expect(saved).toMatchObject({
        revision: 3,
        content: { questions: [{ ...question, text: expectedText }] },
        eventBasis: {
            conditions:
                change === "replace"
                    ? [
                          {
                              hypothesis: b,
                              basis: { kind: "analyst", excerpt: b },
                          },
                      ]
                    : [],
        },
    });
    assert(saved);
    const minimalId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "minimal-open-roundtrip",
            input: {
                kind: "adjust_framing",
                messageId: f.messageId,
                expectedRevision: 3,
                content: saved.content,
                eventBasis: { kind: "open" },
            },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: minimalId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "success" });
    const roundtrip = await f.client.query(api.framing.get, { runId: f.runId });
    expect(roundtrip?.content).toEqual(saved.content);
    expect(roundtrip?.eventBasis).toEqual(saved.eventBasis);
    const insufficientId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "insufficient-open-edit",
            input: {
                kind: "adjust_framing",
                messageId: f.messageId,
                expectedRevision: 4,
                content: {
                    ...saved.content,
                    questions: saved.content.questions.map((question) => ({
                        ...question,
                        text: "A different proposed inquiry?",
                    })),
                },
                eventBasis: { kind: "open" },
            },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: insufficientId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "refused", code: "framing_open_preserve_program" });
    expect(await f.client.query(api.framing.get, { runId: f.runId })).toEqual(
        roundtrip,
    );
    await f.client.mutation(api.framing.startResearch, {
        runId: f.runId,
        expectedRevision: 4,
        requestKey: "replacement-start",
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        1000,
    );
    const handoff = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run?.fixedFramingRevisionId && run.sourcePreparationId);
        return {
            fixed: await ctx.db.get(run.fixedFramingRevisionId),
            preparation: await ctx.db.get(run.sourcePreparationId),
        };
    });
    expect(handoff.fixed?.content).toEqual(saved?.content);
    expect(
        handoff.preparation?.sourcesMission?.needs.find((need) =>
            need.questionIds.includes(question.id),
        )?.information,
    ).toBe(expectedText);
}, 30000);
