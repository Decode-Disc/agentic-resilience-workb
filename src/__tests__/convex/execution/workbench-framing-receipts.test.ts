import { api, internal } from "@convex/_generated/api";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { agentToolSchemas } from "@convex/execution/agentDefinition";
import type { FunctionArgs } from "convex/server";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    seedWorkbench,
    workbenchAdmissionInput,
} from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

async function activeWorkbench(text: string) {
    const fixture = await seedWorkbench(true);
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
            simulation: true,
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
    const tools = agentToolSchemas(getAgentDefinition("workbench_v1", 2), {
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
    const tools = agentToolSchemas(getAgentDefinition("workbench_v1", 2), {
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
    ).toMatchObject({ kind: "refused", code: "operation_not_allowed" });
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
    const tools = agentToolSchemas(getAgentDefinition("workbench_v1", 2), {
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
        agentToolSchemas(getAgentDefinition("workbench_v1", 2), {
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
    const tools = agentToolSchemas(getAgentDefinition("workbench_v1", 2), {
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
