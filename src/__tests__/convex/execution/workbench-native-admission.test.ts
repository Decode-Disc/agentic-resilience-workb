import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { runPiMission } from "@convex/integrations/piMission";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import { getFunctionName } from "convex/server";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

async function savedProgram() {
    const fixture = await seedWorkbench(true);
    const { t, runId } = fixture;
    await t.run(async (ctx) => {
        const run = await ctx.db.get(runId);
        assert(run?.currentFramingRevisionId);
        const framing = await ctx.db.get(run.currentFramingRevisionId);
        assert(framing);
        await ctx.db.patch(framing._id, {
            content: {
                ...framing.content,
                questions: [
                    {
                        id: "control",
                        shortLabel: "Control",
                        text: "Who controls this workflow?",
                        rationale: "Inspect rule-setting authority.",
                    },
                ],
            },
        });
    });
    return fixture;
}

test("native conversation instructions can exceed the old 128 KiB transport ceiling without omission", async () => {
    const { t, client, runId } = await savedProgram();
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
    const expected = Array.from(
        { length: 6 },
        (_, index) => `Instruction ${index}: ${"界".repeat(7400)}`,
    );
    for (let index = 0; index < 6; index++)
        await client.mutation(api.execution.conversations.submit, {
            runId,
            requestKey: `large-steer-${index}`,
            text: expected[index] ?? "",
            delivery: "steer",
            turnId: active.turnId,
        });
    const context = await t.query(internal.execution.context.build, {
        missionId: active.missionId,
        expectedGeneration: 1,
    });
    assert(context.kind === "ready");
    expect(Buffer.byteLength(context.inputJson)).toBeGreaterThan(128 * 1024);
    expect(
        JSON.parse(context.inputJson)
            .conversationInstructions.messages.filter(
                (message: { text: string }) =>
                    message.text.startsWith("Instruction "),
            )
            .map((message: { text: string }) => message.text),
    ).toEqual(expected);
});

test("a steer between Pi preparation and invocation admission is retained as a native user input before publication", async () => {
    const { t, client, runId } = await savedProgram();
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
    let messageId: Id<"agentMessageDeliveries"> | undefined;
    await t.action((ctx) =>
        runPiMission(
            {
                ...ctx,
                runMutation: async (reference, args) => {
                    if (
                        !messageId &&
                        getFunctionName(reference) ===
                            "execution/invocations:begin"
                    )
                        messageId = await client.mutation(
                            api.execution.conversations.submit,
                            {
                                runId,
                                requestKey: "steer-at-admission",
                                text: "Keep this new analyst direction in the native conversation.",
                                delivery: "steer",
                                turnId: active.turnId,
                            },
                        );
                    return ctx.runMutation(reference, args);
                },
            },
            { missionId: active.missionId, expectedGeneration: 1 },
            "steer-at-admission",
        ),
    );
    assert(messageId);
    expect(await t.run((ctx) => ctx.db.get(active.missionId))).toMatchObject({
        status: "completed",
    });
    const commits = await t.run((ctx) => ctx.db.query("piCommits").collect());
    const admittedIds = commits
        .flatMap((commit) => {
            if (commit.payload === undefined)
                throw new Error("Expected inline fixture commit");
            return JSON.parse(commit.payload);
        })
        .filter(
            (write) =>
                write.type === "entry" &&
                write.value.kind === "workbench.analyst-input",
        )
        .flatMap((write) => write.value.data.messageIds);
    expect(admittedIds).toContain(messageId);
    const page = await client.query(api.execution.conversations.listMessages, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(
        page.page.filter((message) => message.role === "assistant"),
    ).toHaveLength(1);
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
}, 30000);

test("a domain change before admission rebuilds the offered tools from the admitted state", async () => {
    const { t, client, runId } = await savedProgram();
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
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "explicit-control",
        text: "Resume research.",
        delivery: "queue",
    });
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
    let changed = false;
    await t.action((ctx) =>
        runPiMission(
            {
                ...ctx,
                runMutation: async (reference, args) => {
                    if (
                        !changed &&
                        getFunctionName(reference) ===
                            "execution/invocations:begin"
                    ) {
                        changed = true;
                        await t.run(async (c) => {
                            const run = await c.db.get(runId);
                            assert(run?.currentFramingRevisionId);
                            await c.db.patch(runId, {
                                fixedFramingRevisionId:
                                    run.currentFramingRevisionId,
                                lifecycleState: "awaiting_source_review",
                                agentExecutionVersion: 3,
                                executionStatus: "paused",
                                pauseReason: "source_review",
                            });
                        });
                    }
                    return ctx.runMutation(reference, args);
                },
            },
            { missionId: active.missionId, expectedGeneration: 1 },
            "state-at-admission",
        ),
    );
    expect(await t.run((ctx) => ctx.db.get(active.missionId))).toMatchObject({
        status: "completed",
    });
    const requests = await t.run((ctx) =>
        ctx.db.query("agentInvocationPayloads").collect(),
    );
    const inputs = requests.flatMap((payload) =>
        payload.part === "request" && payload.json
            ? [JSON.parse(payload.json)]
            : [],
    );
    expect(inputs).toHaveLength(1);
    const tools = getCurrentTools(
        inputs[0].messages as TranscriptContext["messages"],
    ).map((tool) => tool.name);
    expect(tools).not.toContain("adjust_framing");
    expect(tools).toContain("control_research");
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
}, 30000);

test("a direct edit after invocation admission is reconsidered before dispatch", async () => {
    const { t, client, runId } = await savedProgram();
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
    let edited = false;
    await t.action((ctx) =>
        runPiMission(
            {
                ...ctx,
                runMutation: async (reference, args) => {
                    const result = await ctx.runMutation(reference, args);
                    if (
                        !edited &&
                        getFunctionName(reference) ===
                            "execution/invocations:begin" &&
                        result.kind === "ready"
                    ) {
                        edited = true;
                        const frame = await client.query(api.framing.get, {
                            runId,
                        });
                        assert(frame);
                        await client.mutation(api.framing.save, {
                            runId,
                            expectedRevision: frame.revision,
                            requestKey: "edit-after-begin",
                            content: {
                                ...frame.content,
                                scope: "Analyst's new workflow boundary",
                            },
                        });
                    }
                    return result;
                },
            },
            { missionId: active.missionId, expectedGeneration: 1 },
            "edit-after-begin",
        ),
    );
    expect(await t.run((ctx) => ctx.db.get(active.missionId))).toMatchObject({
        status: "completed",
    });
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        content: { scope: "Analyst's new workflow boundary" },
    });
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
}, 30000);

test("unchanged native preparation cannot reschedule indefinitely without an admitted invocation", async () => {
    const { t, runId } = await savedProgram();
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
    let attempts = 0;
    await expect(
        t.action((ctx) =>
            runPiMission(
                {
                    ...ctx,
                    runMutation: async (reference, args) => {
                        if (
                            getFunctionName(reference) ===
                            "execution/invocations:begin"
                        ) {
                            attempts++;
                            return {
                                kind: "blocked",
                                code: "native_input_changed",
                            };
                        }
                        return ctx.runMutation(reference, args);
                    },
                },
                { missionId: active.missionId, expectedGeneration: 1 },
                "stalled-preparation",
            ),
        ),
    ).rejects.toMatchObject({ data: { code: "native_preparation_stalled" } });
    expect(attempts).toBe(3);
    expect(await t.run((ctx) => ctx.db.get(active.missionId))).toMatchObject({
        status: "blocked",
        blockCode: "native_preparation_stalled",
    });
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
}, 30000);
