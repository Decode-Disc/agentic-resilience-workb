import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ActionCtx } from "@convex/_generated/server";
import { executionError } from "@convex/execution/errors";
import { recordContextObservation } from "@convex/execution/journal";
import { suspendInterruptedResearch } from "@convex/execution/researchControl";
import { readRetainedText } from "@convex/execution/retainedText";
import { runPiMission } from "@convex/integrations/piMission";
import { createNativeInputDelivery } from "@convex/integrations/piNativeInput";
import {
    openMissionPiStorage,
    type PiConvexStorage,
} from "@convex/integrations/piStorage";
import { nodeActionGenerationDeadline } from "@convex/resourcePolicy";
import { workflow } from "@convex/workflow";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
    createModels,
    fauxAssistantMessage,
    fauxProvider,
} from "@earendil-works/pi-ai";
import {
    type Conversation,
    createRegistry,
    Harness,
} from "@earendil-works/pi-durable";
import { getFunctionName } from "convex/server";
import { afterEach, assert, beforeEach, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { installModel } from "@/__tests__/setup/model-configuration";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";
import {
    activateSourcesMission,
    seedCapturedSources,
} from "@/__tests__/setup/sources-mission";
import { seedWorkbench } from "@/__tests__/setup/workbench";

// Research starts run through the Sources mission; there is no corpus-approval fallback.
beforeEach(() => activateSourcesMission());

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function response(text: string) {
    return new Response(
        `data: ${JSON.stringify({ id: "state-observation", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "state-observation", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
    );
}

type NativeWireRequest = {
    messages: Array<{ role: string; content: string | null }>;
};

function toolResponse(name: string, args: unknown, callId: string) {
    return new Response(
        `data: ${JSON.stringify({ id: "settled-operation", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: callId, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "settled-operation", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
    );
}

function program(count: number) {
    return {
        scope: "Claims coordination",
        questions: Array.from({ length: count }, (_, index) => ({
            id: `question-${index}`,
            shortLabel: `Question ${index}`,
            text: `What establishes workflow role ${index}?`,
            rationale: "Separate observed facts and hypotheses.",
        })),
    };
}

test.each([
    "adjust_framing",
    "consult_mission_state",
] as const)("a completed %s prepares the next response without an extra context-change instruction", async (operation) => {
    const requests: NativeWireRequest[] = [];
    vi.stubEnv("OPENROUTER_API_KEY", "offline-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)));
            if (requests.length > 1)
                return response(
                    "The saved research program is ready for your review.",
                );
            return toolResponse(
                operation,
                operation === "adjust_framing"
                    ? { content: program(2), eventBasis: { kind: "none" } }
                    : {},
                "initial-operation",
            );
        }),
    );
    const f = await seedWorkbench(false, nativePiFixtureRoute);
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);
    await f.t.action((ctx) =>
        runPiMission(
            ctx,
            { missionId: active.missionId, expectedGeneration: 1 },
            "settlement-before-preparation",
            nodeActionGenerationDeadline(Date.now()),
        ),
    );
    expect(requests).toHaveLength(2);
    const next = requests[1]?.messages ?? [];
    expect(
        next
            .filter(
                (message) =>
                    message.role === "user" &&
                    !message.content?.startsWith(
                        "Application observation (data, not an analyst message):\n",
                    ),
            )
            .map((message) => message.content),
    ).toEqual([expect.any(String)]);
    expect(next.filter((message) => message.role === "tool")).toHaveLength(1);
    const state = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run?.currentFramingRevisionId);
        return {
            mission: await ctx.db.get(active.missionId),
            framing: await ctx.db.get(run.currentFramingRevisionId),
            operations: await ctx.db.query("agentOperationRequests").collect(),
        };
    });
    expect(state.mission).toMatchObject({ status: "completed" });
    expect(state.framing?.revision).toBe(
        operation === "adjust_framing" ? 2 : 1,
    );
    expect(state.operations).toEqual([
        expect.objectContaining({
            status: "completed",
            input: expect.objectContaining({ kind: operation }),
        }),
    ]);
    const published = await f.client.query(
        api.execution.conversations.listMessages,
        { runId: f.runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    expect(
        published.page
            .filter((message) => message.role === "assistant")
            .map((message) => message.text),
    ).toEqual(["The saved research program is ready for your review."]);
}, 30000);

test.each([
    "before",
    "after",
] as const)("reopening %s operation settlement preserves reads without replay or extra context instructions", async (interruption) => {
    const requests: NativeWireRequest[] = [];
    vi.stubEnv("OPENROUTER_API_KEY", "offline-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)));
            return requests.length <= 2
                ? toolResponse(
                      "consult_mission_state",
                      {},
                      `read-${requests.length}`,
                  )
                : response(
                      "The saved research program is ready for your review.",
                  );
        }),
    );
    const f = await seedWorkbench(false, nativePiFixtureRoute);
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);
    let interrupted = false;
    await f.t.action((ctx) =>
        runPiMission(
            {
                ...ctx,
                runMutation: async (reference, ...args) => {
                    if (
                        !interrupted &&
                        getFunctionName(reference) ===
                            "execution/invocations:settle"
                    ) {
                        interrupted = true;
                        if (interruption === "after")
                            await ctx.runMutation(reference, ...args);
                        throw executionError("pi_slice_complete");
                    }
                    return ctx.runMutation(reference, ...args);
                },
            },
            { missionId: active.missionId, expectedGeneration: 1 },
            "interrupted-operation-settlement",
            nodeActionGenerationDeadline(Date.now()),
        ),
    );
    expect(interrupted).toBe(true);
    expect(requests).toHaveLength(1);
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(requests).toHaveLength(3);
    for (const request of requests) {
        expect(
            request.messages.filter(
                (message) =>
                    message.role === "user" &&
                    !message.content?.startsWith(
                        "Application observation (data, not an analyst message):\n",
                    ),
            ),
        ).toHaveLength(1);
    }
    const state = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(active.missionId),
        operations: await ctx.db.query("agentOperationRequests").collect(),
        calls: await ctx.db.query("providerCalls").collect(),
        events: await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_sequence", (q) =>
                q.eq("missionId", active.missionId),
            )
            .collect(),
    }));
    expect(state.mission).toMatchObject({ status: "completed" });
    expect(state.operations).toEqual([
        expect.objectContaining({
            status: "completed",
            input: { kind: "consult_mission_state" },
        }),
        expect.objectContaining({
            status: "completed",
            input: { kind: "consult_mission_state" },
        }),
    ]);
    expect(state.calls).toHaveLength(3);
    expect(
        state.events.filter((event) => event.kind === "continuation_ready"),
    ).toHaveLength(2);
    const published = await f.client.query(
        api.execution.conversations.listMessages,
        { runId: f.runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    expect(
        published.page
            .filter((message) => message.role === "assistant")
            .map((message) => message.text),
    ).toEqual(["The saved research program is ready for your review."]);
}, 30000);

test("repeated state reads still reach the existing non-progress stop without context-change instructions", async () => {
    const requests: NativeWireRequest[] = [];
    vi.stubEnv("OPENROUTER_API_KEY", "offline-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)));
            return toolResponse(
                "consult_mission_state",
                {},
                `repeated-read-${requests.length}`,
            );
        }),
    );
    const f = await seedWorkbench(false, nativePiFixtureRoute);
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(await f.t.run((ctx) => ctx.db.get(active.missionId))).toMatchObject({
        status: "blocked",
        blockCode: "repetition_stop",
        noProgressTurns: 3,
    });
    expect(requests.length).toBeGreaterThan(1);
    for (const request of requests) {
        expect(
            request.messages.filter(
                (message) =>
                    message.role === "user" &&
                    !message.content?.startsWith(
                        "Application observation (data, not an analyst message):\n",
                    ),
            ),
        ).toHaveLength(1);
    }
    const operations = await f.t.run((ctx) =>
        ctx.db.query("agentOperationRequests").collect(),
    );
    expect(operations).toHaveLength(requests.length);
    expect(
        operations.every((operation) => operation.status === "completed"),
    ).toBe(true);
}, 30000);

test("a reopened worker completes a retained read before preparing its first provider request", async () => {
    const f = await seedWorkbench(false, nativePiFixtureRoute);
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);
    await f.t.action(async (ctx) => {
        const storage = await openMissionPiStorage(
            ctx,
            active.missionId,
            1,
            "previous-read-worker",
            BACKGROUND_CONTEXT,
        );
        await storage.close(BACKGROUND_CONTEXT);
        await ctx.runMutation(internal.execution.piControl.closeWorker, {
            missionId: active.missionId,
            expectedGeneration: 1,
            writer: "previous-read-worker",
        });
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: active.missionId,
            expectedGeneration: 1,
            cause: "retained-read-before-reopen",
            input: { kind: "consult_mission_state" },
        },
    );
    const requests: NativeWireRequest[] = [];
    vi.stubEnv("OPENROUTER_API_KEY", "offline-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject(
                { status: "completed", outcome: { kind: "success" } },
            );
            requests.push(JSON.parse(String(init?.body)));
            return response(
                "The saved research program is ready for your review.",
            );
        }),
    );
    await f.t.action((ctx) =>
        runPiMission(
            ctx,
            { missionId: active.missionId, expectedGeneration: 1 },
            "reopened-read-worker",
            nodeActionGenerationDeadline(Date.now()),
        ),
    );
    expect(requests).toHaveLength(1);
    expect(
        requests[0]?.messages.filter(
            (message) =>
                message.role === "user" &&
                !message.content?.startsWith(
                    "Application observation (data, not an analyst message):\n",
                ),
        ),
    ).toHaveLength(1);
    expect(await f.t.run((ctx) => ctx.db.get(active.missionId))).toMatchObject({
        status: "completed",
    });
    expect(
        await f.t.run((ctx) =>
            ctx.db.query("agentOperationRequests").collect(),
        ),
    ).toHaveLength(1);
}, 30000);

test("an analyst edit during read continuation is delivered before the next provider request", async () => {
    const requests: NativeWireRequest[] = [];
    vi.stubEnv("OPENROUTER_API_KEY", "offline-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)));
            return requests.length === 1
                ? toolResponse("consult_mission_state", {}, "read-before-edit")
                : response("The saved research program reflects your update.");
        }),
    );
    const f = await seedWorkbench(false, nativePiFixtureRoute);
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);
    let edited = false;
    let rejectedPreparation = false;
    await f.t.action((ctx) =>
        runPiMission(
            {
                ...ctx,
                runMutation: async (reference, ...args) => {
                    const inject =
                        !edited &&
                        requests.length === 1 &&
                        getFunctionName(reference) ===
                            "execution/invocations:begin";
                    if (inject) {
                        edited = true;
                        await f.client.mutation(api.framing.save, {
                            runId: f.runId,
                            expectedRevision: 1,
                            requestKey: "edit-during-read-continuation",
                            content: program(2),
                        });
                    }
                    const result = await ctx.runMutation(reference, ...args);
                    if (inject) {
                        expect(result).toEqual({
                            kind: "blocked",
                            code: "native_input_changed",
                        });
                        rejectedPreparation = true;
                    }
                    return result;
                },
            },
            { missionId: active.missionId, expectedGeneration: 1 },
            "concurrent-edit-during-read",
            nodeActionGenerationDeadline(Date.now()),
        ),
    );
    expect(edited).toBe(true);
    expect(rejectedPreparation).toBe(true);
    expect(requests).toHaveLength(2);
    const messages = requests[1]?.messages ?? [];
    const section = messages.find(
        (message) => message.role === "system",
    )?.content;
    assert(
        typeof section === "string" &&
            section.startsWith("Required current mission state:\n"),
    );
    const state = JSON.parse(
        section
            .slice("Required current mission state:\n".length)
            .split("\n\n")[0] ?? "",
    );
    expect(state.domain.framing).toMatchObject({
        revision: 2,
        origin: "analyst",
        scope: "Claims coordination",
        questions: [{ id: "question-0" }, { id: "question-1" }],
    });
    expect(
        messages.some(
            (message) =>
                message.content?.startsWith("Application observation") &&
                message.content.includes('"topic":"framing"') &&
                message.content.includes('"type":"visitor"'),
        ),
    ).toBe(true);
    expect(await f.t.run((ctx) => ctx.db.get(active.missionId))).toMatchObject({
        status: "completed",
    });
}, 30000);

test("a saved framing change reaches native conversation after the old reply and before the next analyst message", async () => {
    const requests: Array<{
        messages: Array<{ role: string; content: string }>;
    }> = [];
    vi.stubEnv("OPENROUTER_API_KEY", "offline-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)));
            return response(
                requests.length === 1
                    ? "The saved program contains five questions."
                    : "The saved program now contains two questions.",
            );
        }),
    );
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    await client.mutation(api.framing.save, {
        runId,
        expectedRevision: 1,
        requestKey: "initial-five",
        content: program(5),
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    await client.mutation(api.framing.save, {
        runId,
        expectedRevision: 2,
        requestKey: "new-two",
        content: program(2),
    });
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "keep-current",
        text: "Keep the saved research program unchanged.",
        delivery: "queue",
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(requests).toHaveLength(2);
    const messages = requests[1]?.messages ?? [];
    const previous = messages.findIndex(
        (message) =>
            message.role === "assistant" &&
            message.content === "The saved program contains five questions.",
    );
    const observation = messages.findIndex(
        (message) =>
            message.content.startsWith(
                "Application observation (data, not an analyst message):",
            ) &&
            message.content.includes('"topic":"framing"') &&
            message.content.includes('"revision":3'),
    );
    const analyst = messages.findIndex(
        (message) =>
            message.role === "user" &&
            message.content === "Keep the saved research program unchanged.",
    );
    expect(observation).toBeGreaterThan(previous);
    expect(observation).toBeLessThan(analyst);
    const history = await client.query(
        api.execution.conversations.listMessages,
        { runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    expect(
        history.page.some((message) =>
            message.text.startsWith("Application observation"),
        ),
    ).toBe(false);
});

async function observations(
    t: Awaited<ReturnType<typeof seedWorkbench>>["t"],
    runId: import("@convex/_generated/dataModel").Id<"researchRuns">,
) {
    return t.run(async (ctx) => {
        const rows = await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_run_and_native_input_sequence", (q) =>
                q.eq("runId", runId).gt("nativeInputSequence", 0),
            )
            .collect();
        return Promise.all(
            rows.map(async (row) => ({
                ...row,
                value: row.contextObservation
                    ? JSON.parse(
                          await readRetainedText(
                              ctx,
                              row.contextObservation.textId,
                          ),
                      )
                    : null,
            })),
        );
    });
}

test.each([
    "started",
    "research_pause_requested",
    "research_pause_cancelled",
])("public research transition records its ordered observation: %s", async (event) => {
    const { t, client, runId } = await seedWorkbench(true);
    await client.mutation(api.framing.save, {
        runId,
        expectedRevision: 1,
        requestKey: "saved-program",
        content: program(2),
    });
    await client.mutation(api.framing.startResearch, {
        runId,
        expectedRevision: 2,
        requestKey: "explicit-start",
    });
    if (event !== "started")
        await client.mutation(api.execution.researchControl.pause, {
            runId,
            expectedGeneration: 1,
        });
    if (event === "research_pause_cancelled")
        await client.mutation(api.execution.researchControl.resume, {
            runId,
            expectedGeneration: 1,
        });
    const events = await observations(t, runId);
    expect(events.find((row) => row.value?.event === event)).toMatchObject({
        contextObservation: { topic: "research" },
        actor: { type: "visitor" },
    });
    expect(events.map((row) => row.nativeInputSequence)).toEqual(
        [...new Set(events.map((row) => row.nativeInputSequence))].sort(
            (a, b) => (a ?? 0) - (b ?? 0),
        ),
    );
});

test("a source exclusion retains the decision as an internal documentary observation", async () => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await f.t.withIdentity({ subject: f.userId }).mutation(api.sources.decide, {
        runId: f.runId,
        corpusRevisionId: f.corpusRevisionId,
        sourceId: f.sourceId,
        decision: "rejected",
        decisionKey: "exclude-from-analysis",
    });
    expect(
        (await observations(f.t, f.runId)).find(
            (row) => row.value?.decision === "rejected",
        ),
    ).toMatchObject({
        contextObservation: { topic: "documentary" },
        value: { sourceId: f.sourceId, corpusRevisionId: f.corpusRevisionId },
    });
});

test("an incomplete Sources handoff retains its outcome and unfinished obligations as an observation", async () => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await f.t.run((ctx) => ctx.db.patch(f.missionId, { status: "blocked" }));
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    assert(preparation?.deadlineAt);
    vi.setSystemTime(preparation.deadlineAt + 1);
    await f.t.mutation(internal.sourcesMission.finish, {
        preparationId: f.preparationId,
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    expect(
        (await observations(f.t, f.runId)).find(
            (row) => row.value?.event === "sources_prepared",
        ),
    ).toMatchObject({
        contextObservation: { topic: "documentary" },
        value: {
            outcome: "blocked",
            material: {
                outcome: "blocked",
                needs: expect.arrayContaining([
                    expect.objectContaining({
                        unfinished: expect.arrayContaining([
                            expect.any(String),
                        ]),
                    }),
                ]),
            },
        },
    });
});

test("a research interruption retains its system origin and reason for the next conversation", async () => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
        });
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        await suspendInterruptedResearch(ctx, mission);
    });
    expect(
        (await observations(f.t, f.runId)).find(
            (row) => row.value?.event === "research_interrupted",
        ),
    ).toMatchObject({
        actor: { type: "system" },
        contextObservation: { topic: "research" },
        value: { pauseReason: "execution_interrupted" },
    });
});

test("a deferred request records transmission and adds the same need to current Sources state", async () => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    const client = f.t.withIdentity({ subject: f.userId });
    const framingId = await f.t.run(async (ctx) => {
        const id = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: program(2),
            contentHash: "fixture",
            requestKey: "fixed-program",
            origin: "analyst",
            createdAt: Date.now(),
        });
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            fixedFramingRevisionId: id,
            currentFramingRevisionId: id,
        });
        return id;
    });
    const messageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId: f.runId,
            requestKey: "documentary-request",
            text: "Inspect contractual termination rights.",
            delivery: "queue",
        },
    );
    await f.t.run(async (ctx) => {
        const requestId = await ctx.db.insert("agentOperationRequests", {
            runId: f.runId,
            actor: "agent",
            cause: "retained-transmission",
            input: {
                kind: "transmit_source_request",
                messageId,
                interpretedNeed: "Inspect contractual termination rights.",
            },
            operationVersion: 1,
            expectedGeneration: 4,
            logicalKey: "retained-transmission",
            status: "completed",
            createdAt: Date.now(),
        });
        await ctx.db.insert("workbenchInstructions", {
            runId: f.runId,
            framingRevisionId: framingId,
            requestId,
            messageId,
            interpretedNeed: "Inspect contractual termination rights.",
            status: "waiting",
            outcome: "Waiting for transmission",
            createdAt: Date.now(),
        });
    });
    await f.t.mutation(internal.workbench.processInstructions, {
        runId: f.runId,
    });
    const state = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    assert(state.kind === "ready");
    expect(
        JSON.parse(state.inputJson).activeWork.needs.some(
            (need: { information: string }) =>
                need.information === "Inspect contractual termination rights.",
        ),
    ).toBe(true);
    expect(
        (await observations(f.t, f.runId)).find(
            (row) => row.value?.status === "transmitted",
        ),
    ).toMatchObject({
        contextObservation: { topic: "analyst_request" },
        value: {
            messageId,
            interpretedNeed: "Inspect contractual termination rights.",
        },
    });
});

test("a retained conversation receives one truthful current-state anchor without fabricated historical actions", async () => {
    const requests: Array<{
        messages: Array<{ role: string; content: string }>;
    }> = [];
    vi.stubEnv("OPENROUTER_API_KEY", "offline-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)));
            return response("The current scope remains a research question.");
        }),
    );
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    await client.mutation(api.framing.save, {
        runId,
        expectedRevision: 1,
        requestKey: "program",
        content: program(2),
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    await t.run(async (ctx) => {
        const session = await ctx.db.query("piSessions").first();
        assert(session);
        await ctx.db.patch(session._id, {
            observationSequence: undefined,
            observationEntry: undefined,
        });
    });
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "after-upgrade",
        text: "Explain what is saved now.",
        delivery: "queue",
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(requests).toHaveLength(2);
    const anchors = requests[1]?.messages.filter(
        (message) =>
            message.content.startsWith("Application observation") &&
            message.content.includes('"topic":"current_state"'),
    );
    expect(anchors).toHaveLength(1);
    expect(anchors?.[0]?.content).toContain('"historicalSequenceUnknown":true');
    expect(anchors?.[0]?.content).toContain('"revision":2');
});

test("an analyst sufficiency decision retains its actual decision and reason", async () => {
    const f = await seedWorkbench(true);
    await f.client.mutation(api.framing.save, {
        runId: f.runId,
        expectedRevision: 1,
        requestKey: "program",
        content: program(2),
    });
    await f.client.mutation(api.framing.startResearch, {
        runId: f.runId,
        expectedRevision: 2,
        requestKey: "start",
    });
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            lifecycleState: "awaiting_evidence_sufficiency_review",
            executionStatus: "paused",
            pauseReason: "evidence_sufficiency_review",
        }),
    );
    await f.client.mutation(api.evidenceSufficiency.decide, {
        runId: f.runId,
        decision: {
            kind: "complete_insufficient",
            decisionKey: "insufficient-decision",
            reason: "The available documents do not establish this claim.",
        },
    });
    expect(
        (await observations(f.t, f.runId)).find(
            (row) => row.value?.decision === "complete_insufficient",
        ),
    ).toMatchObject({
        actor: { type: "visitor" },
        contextObservation: { topic: "analyst_decision" },
        value: {
            reason: "The available documents do not establish this claim.",
        },
    });
});

test("corpus approval retains a decision observation and its frozen revision", async () => {
    vi.useFakeTimers();
    const f = await seedInspectedEvidence();
    workflowTest.register(f.t);
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.corpusRevisionId, {
            status: "draft",
            approvedAt: undefined,
            approvedByVisitorId: undefined,
        });
        const run = await ctx.db.get(f.runId);
        assert(run?.sourcePreparationId);
        await ctx.db.patch(run.sourcePreparationId, {
            status: "complete",
            completedAt: Date.now(),
            leaseExpiresAt: 0,
        });
        await ctx.db.patch(f.runId, {
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
        });
    });
    const proposal = await f.t.run(async (ctx) => {
        const rev = await ctx.db.get(f.corpusRevisionId);
        assert(rev?.sourceSelectionProposalId);
        return ctx.db.get(rev.sourceSelectionProposalId);
    });
    assert(proposal);
    await f.t
        .withIdentity({ subject: f.userId })
        .mutation(api.sourceSelectionProposals.approveProposedCorpus, {
            runId: f.runId,
            corpusRevisionId: f.corpusRevisionId,
            proposalId: proposal._id,
            proposalVersion: proposal.version,
            decisionKey: "approve-documented-corpus",
        });
    expect(
        (await observations(f.t, f.runId)).find(
            (row) => row.value?.event === "corpus_approved",
        ),
    ).toMatchObject({
        actor: { type: "visitor" },
        contextObservation: { topic: "analyst_decision" },
        value: { corpusRevisionId: f.corpusRevisionId, decision: "approved" },
    });
});

test("a native agent can recover an exact application observation by its immutable history reference", async () => {
    const f = await seedWorkbench(true);
    await f.client.mutation(api.framing.save, {
        runId: f.runId,
        expectedRevision: 1,
        requestKey: "changed-program",
        content: program(2),
    });
    const event = (await observations(f.t, f.runId)).find(
        (row) => row.contextObservation?.topic === "framing",
    );
    assert(event);
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(active);
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: active.missionId,
            expectedGeneration: 1,
            cause: "recover-saved-change",
            input: { kind: "consult_mission_state", reference: event._id },
        },
    );
    const result = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    expect(result.kind).toBe("success");
    assert(result.kind === "success");
    const restored = JSON.parse(result.valueJson)
        .history.entries.map((entry: { content: string }) => entry.content)
        .join("");
    expect(JSON.parse(restored)).toMatchObject({
        observation: {
            state: "complete",
            value: { revision: 2, origin: "analyst", content: program(2) },
        },
    });
});

test("a refused control is in the actual native request after the older admitted message before provider I/O", async () => {
    const requests: Array<{
        messages: Array<{ role: string; content: string }>;
    }> = [];
    vi.stubEnv("OPENROUTER_API_KEY", "offline-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)));
            return response("Research has not started.");
        }),
    );
    const f = await seedWorkbench(false, nativePiFixtureRoute);
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);
    const receipt = await f.client.mutation(api.workbench.command, {
        runId: f.runId,
        requestKey: "pause-before-first-request",
        command: "/pause",
        expectedGeneration: 1,
    });
    expect(receipt.outcome).toBe("refused");
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        turnId: active.turnId,
        requestKey: "steer-after-control",
        text: "Explain why this control was refused.",
        delivery: "steer",
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(requests).toHaveLength(1);
    const messages = requests[0]?.messages ?? [];
    const analyst = messages.findIndex(
        (message) => message.role === "user" && message.content !== "/pause",
    );
    const command = messages.findIndex(
        (message) => message.role === "user" && message.content === "/pause",
    );
    expect(command).toBeGreaterThan(analyst);
    expect(
        messages.findIndex(
            (message) =>
                message.role === "user" &&
                message.content === "Explain why this control was refused.",
        ),
    ).toBeGreaterThan(command);
    expect(
        messages.some(
            (message) =>
                message.role === "assistant" &&
                message.content === receipt.text,
        ),
    ).toBe(true);
});

test("public cancellation retains a confirmed terminal observation", async () => {
    const f = await seedWorkbench(true);
    await f.client.mutation(api.framing.save, {
        runId: f.runId,
        expectedRevision: 1,
        requestKey: "program",
        content: program(2),
    });
    await f.client.mutation(api.framing.startResearch, {
        runId: f.runId,
        expectedRevision: 2,
        requestKey: "start",
    });
    await f.client.mutation(api.workflowControls.cancel, { runId: f.runId });
    expect(
        (await observations(f.t, f.runId)).find(
            (row) => row.value?.event === "research_cancelled",
        ),
    ).toMatchObject({
        contextObservation: { topic: "research" },
        value: { status: "cancelled" },
    });
});

test("the retained source-review checkpoint records its analyst decision", async () => {
    const f = await seedWorkbench(true);
    await f.client.mutation(api.framing.save, {
        runId: f.runId,
        expectedRevision: 1,
        requestKey: "program",
        content: program(2),
    });
    await f.client.mutation(api.framing.startResearch, {
        runId: f.runId,
        expectedRevision: 2,
        requestKey: "start",
    });
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
        }),
    );
    await f.client.mutation(api.workflowControls.approveCheckpoint, {
        runId: f.runId,
        checkpoint: "source_review",
        decisionKey: "approve-retained-checkpoint",
    });
    expect(
        (await observations(f.t, f.runId)).find(
            (row) => row.value?.event === "checkpoint_approved",
        ),
    ).toMatchObject({
        actor: { type: "visitor" },
        contextObservation: { topic: "analyst_decision" },
        value: { checkpoint: "source_review", decision: "approved" },
    });
});

async function nativeSession<Result>(
    f: Awaited<ReturnType<typeof seedWorkbench>>,
    missionId: Id<"agentMissions">,
    run: (
        ctx: ActionCtx,
        root: Conversation,
        storage: PiConvexStorage,
    ) => Promise<Result>,
) {
    return f.t.action(async (ctx) => {
        const storage = await openMissionPiStorage(
            ctx,
            missionId,
            1,
            "state-observation-regression",
            BACKGROUND_CONTEXT,
        );
        const models = createModels();
        const provider = fauxProvider({
            tokensPerSecond: 1,
            tokenSize: { min: 1, max: 1 },
            models: [
                { id: "controlled", contextWindow: 32000, maxTokens: 6144 },
            ],
        });
        provider.setResponses([
            fauxAssistantMessage(
                "Waiting for the current generation. ".repeat(1000),
            ),
        ]);
        models.setProvider(provider.provider);
        const harness = await Harness.open(
            storage,
            { models, registry: createRegistry() },
            BACKGROUND_CONTEXT,
        );
        try {
            return await run(
                ctx,
                await harness.root(BACKGROUND_CONTEXT, {
                    agent: {
                        model: {
                            provider: provider.provider.id,
                            modelId: "controlled",
                        },
                    },
                }),
                storage,
            );
        } finally {
            const closing = harness.close(BACKGROUND_CONTEXT);
            await vi.advanceTimersByTimeAsync(1000);
            await closing;
        }
    });
}

test("an observation acknowledgement loss reopens the same durable entry without replaying the effect", async () => {
    const f = await seedWorkbench(true);
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(active);
    await nativeSession(f, active.missionId, async () => null);
    await f.client.mutation(api.framing.save, {
        runId: f.runId,
        expectedRevision: 1,
        requestKey: "saved-change",
        content: program(2),
    });
    await expect(
        nativeSession(f, active.missionId, async (ctx, root, storage) => {
            const lost: ActionCtx = {
                ...ctx,
                runMutation: async (reference, ...args) => {
                    if (
                        getFunctionName(reference) ===
                        "execution/piStore:recordObservationInput"
                    )
                        throw new Error("Observation acknowledgement lost");
                    return ctx.runMutation(reference, ...args);
                },
            };
            await createNativeInputDelivery(
                lost,
                { missionId: active.missionId, expectedGeneration: 1 },
                storage,
            ).synchronizeObservations(root, BACKGROUND_CONTEXT);
        }),
    ).rejects.toThrow("Observation acknowledgement lost");
    const entries = await nativeSession(
        f,
        active.missionId,
        async (ctx, root, storage) => {
            await createNativeInputDelivery(
                ctx,
                { missionId: active.missionId, expectedGeneration: 1 },
                storage,
            ).synchronizeObservations(root, BACKGROUND_CONTEXT);
            return (
                await root.entries(
                    { order: "ascending" },
                    100,
                    undefined,
                    BACKGROUND_CONTEXT,
                )
            ).items;
        },
    );
    expect(
        entries.filter((entry) => entry.kind === "application.observation"),
    ).toHaveLength(1);
    expect(
        (await observations(f.t, f.runId)).filter(
            (event) => event.contextObservation?.topic === "framing",
        ),
    ).toHaveLength(1);
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toHaveLength(0);
});

test("an observation queued behind an active Pi generation is not acknowledged or proven delivered", async () => {
    const f = await seedWorkbench(true);
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(active);
    await nativeSession(f, active.missionId, async (ctx, root, storage) => {
        const delivery = createNativeInputDelivery(
            ctx,
            { missionId: active.missionId, expectedGeneration: 1 },
            storage,
        );
        await delivery.synchronize(root, BACKGROUND_CONTEXT);
        const writerLease = storage.lease;
        assert(writerLease);
        const before = await ctx.runQuery(
            internal.execution.piStore.pendingObservations,
            writerLease,
        );
        const entries = (
            await root.entries(
                { order: "ascending" },
                100,
                undefined,
                BACKGROUND_CONTEXT,
            )
        ).items;
        await f.client.mutation(api.framing.save, {
            runId: f.runId,
            expectedRevision: 1,
            requestKey: "during-generation",
            content: program(2),
        });
        await delivery.synchronizeObservations(root, BACKGROUND_CONTEXT);
        const after = await ctx.runQuery(
            internal.execution.piStore.pendingObservations,
            writerLease,
        );
        expect(after.acknowledged).toBe(before.acknowledged);
        expect(after.throughSequence).toBeGreaterThan(after.acknowledged ?? -1);
        expect(
            await delivery.observationProof(root, BACKGROUND_CONTEXT, {
                cutoff: entries.at(-1)?.id ?? 0,
            }),
        ).toBe(before.acknowledged);
    });
});

test("native reopen and compaction preserve Sources assessment authorship and code-owned resource facts", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "offline-fixture-only");
    vi.stubEnv("WORKBENCH_AGENT_ENABLED", "true");
    const requests: NativeWireRequest[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)));
            if (requests.length > 3)
                throw new Error("Unexpected additional generation");
            return response(
                requests.length === 1
                    ? "The retained material is available for inspection."
                    : requests.length === 2
                      ? "Working note: distinguish Sources' unverified explanation from current execution facts."
                      : "Sources returned with unfinished work; the external discovery allowance is not exhausted.",
            );
        }),
    );
    const f = await seedCapturedSources();
    await installModel(f.t, nativePiFixtureRoute);
    await f.t.run(async (ctx) => {
        const framingId = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Workflow context", questions: [] },
            requestKey: "source-return-framing",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            currentFramingRevisionId: framingId,
            fixedFramingRevisionId: framingId,
        });
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                searches: 2,
                envelope: {
                    ...preparation.sourcesMission.envelope,
                    initialSearches: 6,
                },
            },
        });
    });
    const client = f.t.withIdentity({ subject: f.userId });
    await client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "before-source-return",
        text: "Inspect the existing material.",
        delivery: "queue",
    });
    const first = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(first);
    await f.t.action((ctx) =>
        runPiMission(
            ctx,
            {
                missionId: first.missionId,
                expectedGeneration: 1,
            },
            "before-source-return",
            nodeActionGenerationDeadline(Date.now()),
        ),
    );
    const source = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "returned-source-assessment",
        provenance: "simulation",
    });
    assert(source.kind === "ready");
    const complete = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: source.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "complete",
            needs: [
                {
                    needId: "common-context",
                    unfinished: [
                        "Search allowance for saved material was exhausted (6/6).",
                    ],
                    readRequestIds: [f.readRequestId],
                },
            ],
        },
    });
    expect(complete.kind).toBe("completed");
    await f.t.mutation(internal.sourcesMission.finish, {
        preparationId: f.preparationId,
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    await client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "after-source-return",
        text: "Explain what Sources returned and its limits.",
        delivery: "queue",
    });
    const next = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(next);
    const { seedPiHistory } = await import("@/__tests__/setup/pi-mission");
    await seedPiHistory(f.t, next.missionId, 1, 8, 56000);
    await f.t.action((ctx) =>
        runPiMission(
            ctx,
            {
                missionId: next.missionId,
                expectedGeneration: 1,
            },
            "after-source-return",
            nodeActionGenerationDeadline(Date.now()),
        ),
    );
    expect(requests).toHaveLength(3);
    const system = requests[2]?.messages[0]?.content;
    assert(system);
    const state = JSON.parse(
        system.slice(
            system.indexOf("\n") + 1,
            system.indexOf("\n\n<instructions>"),
        ),
    );
    expect(state.domain.documentaryPreparation).toMatchObject({
        executionStop: null,
        allowance: {
            searches: {
                used: 2,
                limit: 6,
                blockCode: null,
                operation: "discover_sources_for_need",
            },
        },
        documentaryAssessment: {
            author: {
                type: "agent",
                missionId: f.missionId,
                invocationId: source.invocationId,
            },
            verification: "not_semantically_reviewed",
        },
    });
    const calls = await f.t.run((ctx) =>
        ctx.db.query("providerCalls").collect(),
    );
    expect(
        calls.filter((call) => call.operation === "agent_compaction"),
    ).toHaveLength(1);
}, 30000);

test("a saved observation remains available after native compaction and conversation reopen", async () => {
    const requests: Array<{
        messages: Array<{ role: string; content: string }>;
    }> = [];
    vi.stubEnv("OPENROUTER_API_KEY", "offline-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)));
            if (requests.length > 4)
                throw new Error("Unexpected additional generation");
            return response(
                requests.length === 1
                    ? "The previous saved program has five questions."
                    : requests.length === 2
                      ? "Working summary: retain the analyst's hypotheses and distinguish the previous framing from the current saved state."
                      : "The saved program contains two questions. These remain research questions.",
            );
        }),
    );
    const f = await seedWorkbench(false, nativePiFixtureRoute);
    await f.client.mutation(api.framing.save, {
        runId: f.runId,
        expectedRevision: 1,
        requestKey: "initial-five",
        content: program(5),
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    await f.client.mutation(api.framing.save, {
        runId: f.runId,
        expectedRevision: 2,
        requestKey: "saved-two",
        content: program(2),
    });
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "after-change",
        text: "Keep the current saved program unchanged.",
        delivery: "queue",
    });
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);
    const { seedPiHistory } = await import("@/__tests__/setup/pi-mission");
    await seedPiHistory(f.t, active.missionId, 1, 8, 56000);
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: active.missionId,
        expectedGeneration: 1,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const calls = await f.t.run((ctx) =>
        ctx.db.query("providerCalls").collect(),
    );
    expect(
        calls.filter((call) => call.operation === "agent_compaction"),
    ).toHaveLength(1);
    expect(requests).toHaveLength(3);
    expect(requests[2]?.messages[0]?.content).toContain('"revision":3');
    expect(
        requests[2]?.messages.some(
            (message) =>
                JSON.stringify(message.content).includes(
                    "Application observation",
                ) &&
                JSON.stringify(message.content).includes("framing") &&
                JSON.stringify(message.content).includes("revision"),
        ),
    ).toBe(true);
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "reopen",
        text: "Explain the current questions.",
        delivery: "queue",
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(requests).toHaveLength(4);
    expect(requests[3]?.messages[0]?.content).toContain('"revision":3');
    expect(
        (await f.client.query(api.framing.get, { runId: f.runId }))?.revision,
    ).toBe(3);
}, 30000);

test("one observation synchronization freezes its frontier while later changes remain pending", async () => {
    const f = await seedWorkbench(true);
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(active);
    await nativeSession(f, active.missionId, async () => null);
    await f.client.mutation(api.framing.save, {
        runId: f.runId,
        expectedRevision: 1,
        requestKey: "first-change",
        content: program(2),
    });
    await nativeSession(f, active.missionId, async (ctx, root, storage) => {
        let changed = false;
        const concurrent: ActionCtx = {
            ...ctx,
            runQuery: async (reference, ...args) => {
                const result = await ctx.runQuery(reference, ...args);
                if (
                    !changed &&
                    getFunctionName(reference) ===
                        "execution/piStore:pendingObservations"
                ) {
                    changed = true;
                    await f.client.mutation(api.framing.save, {
                        runId: f.runId,
                        expectedRevision: 2,
                        requestKey: "concurrent-change",
                        content: program(3),
                    });
                }
                return result;
            },
        };
        const delivery = createNativeInputDelivery(
            concurrent,
            { missionId: active.missionId, expectedGeneration: 1 },
            storage,
        );
        await delivery.synchronizeObservations(root, BACKGROUND_CONTEXT);
        const entries = (
            await root.entries(
                { order: "ascending" },
                100,
                undefined,
                BACKGROUND_CONTEXT,
            )
        ).items;
        expect(
            entries.filter((entry) => entry.kind === "application.observation"),
        ).toHaveLength(1);
        expect(await delivery.hasPendingObservations()).toBe(true);
    });
});

test("a dossier observation reference cannot expose another dossier through mission consultation", async () => {
    const f = await seedWorkbench(true);
    const foreign = await f.t.run(async (ctx) => {
        const current = await ctx.db.get(f.runId);
        assert(current);
        const { _id, _creationTime, ...fields } = current;
        const runId = await ctx.db.insert("researchRuns", fields);
        return recordContextObservation(ctx, runId, {
            key: "private-change",
            topic: "framing",
            actor: { type: "system" },
            value: { private: "Another dossier's saved state" },
        });
    });
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(active);
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: active.missionId,
            expectedGeneration: 1,
            cause: "foreign-reference",
            input: { kind: "consult_mission_state", reference: foreign },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "refused", code: "history_reference_unavailable" });
});

test("a retained checkpoint retry records the confirmed recovery state", async () => {
    vi.spyOn(workflow, "restart").mockResolvedValue(undefined);
    const f = await seedWorkbench(true);
    await f.client.mutation(api.framing.save, {
        runId: f.runId,
        expectedRevision: 1,
        requestKey: "program",
        content: program(2),
    });
    await f.client.mutation(api.framing.startResearch, {
        runId: f.runId,
        expectedRevision: 2,
        requestKey: "start",
    });
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            executionStatus: "failed",
            pauseReason: "source_review",
            lifecycleState: "awaiting_source_review",
        }),
    );
    await f.client.mutation(api.workflowControls.retry, { runId: f.runId });
    expect(
        (await observations(f.t, f.runId)).find(
            (row) => row.value?.event === "research_retried",
        ),
    ).toMatchObject({
        contextObservation: { topic: "research" },
        actor: { type: "visitor" },
        value: { status: "paused", pauseReason: "source_review" },
    });
});

test("Sources receives the confirmed source decision in its actual native request with the model output cap", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "offline-fixture-only");
    const requests: Array<{
        max_completion_tokens: number;
        messages: unknown[];
    }> = [];
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)));
            return new Response(
                `data: ${JSON.stringify({ id: "incomplete-sources", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: "length" }], usage: { prompt_tokens: 10, completion_tokens: 8192 } })}\n\ndata: [DONE]\n\n`,
                { headers: { "content-type": "text/event-stream" } },
            );
        }),
    );
    const f = await seedCapturedSources();
    await installModel(f.t, nativePiFixtureRoute, "sources");
    await f.t.action(async (ctx) => {
        const storage = await openMissionPiStorage(
            ctx,
            f.missionId,
            4,
            "source-state-baseline",
            BACKGROUND_CONTEXT,
        );
        await storage.close(BACKGROUND_CONTEXT);
    });
    await f.t.mutation(internal.execution.piControl.closeWorker, {
        missionId: f.missionId,
        expectedGeneration: 4,
        writer: "source-state-baseline",
    });
    await f.t.withIdentity({ subject: f.userId }).mutation(api.sources.decide, {
        runId: f.runId,
        corpusRevisionId: f.corpusRevisionId,
        sourceId: f.sourceId,
        decision: "rejected",
        decisionKey: "source-exclusion-before-resume",
    });
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: 4,
        simulation: false,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        blockCode: "invalid_output",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.max_completion_tokens).toBe(8192);
    const history = JSON.stringify(requests[0]?.messages);
    expect(history).toContain("Application observation");
    expect(history).toContain("source_decided");
    expect(history).toContain(f.sourceId);
    expect(history).toContain("rejected");
    const receipts = await f.t.run((ctx) =>
        ctx.db.query("providerCalls").collect(),
    );
    expect(receipts).toEqual([
        expect.objectContaining({
            status: "failed",
            errorCode: "invalid_output",
        }),
    ]);
}, 30000);

test("a framing effect produced by a native tool is delivered and acknowledged before the next model request", async () => {
    const requests: Array<{ messages: unknown[] }> = [];
    vi.stubEnv("OPENROUTER_API_KEY", "offline-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)));
            if (requests.length > 1)
                return response(
                    "The saved research program contains two questions.",
                );
            return new Response(
                `data: ${JSON.stringify({ id: "save-through-native-tool", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "save-framing", type: "function", function: { name: "adjust_framing", arguments: JSON.stringify({ content: program(2), eventBasis: { kind: "none" } }) } }] }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "save-through-native-tool", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`,
                { headers: { "content-type": "text/event-stream" } },
            );
        }),
    );
    const f = await seedWorkbench(false, nativePiFixtureRoute);
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(
        (await f.client.query(api.framing.get, { runId: f.runId }))?.revision,
    ).toBe(2);
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.messages)).toContain(
        "Application observation",
    );
    const history = await f.client.query(
        api.execution.conversations.listMessages,
        { runId: f.runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    expect(
        history.page.some(
            (message) =>
                message.text ===
                "The saved research program contains two questions.",
        ),
    ).toBe(true);
}, 30000);

test.each([
    1, 3,
])("%i interleaved steers keep source order before later state changes while native generation is busy", async (count) => {
    const requests: Array<{
        messages: Array<{ role: string; content: string }>;
    }> = [];
    vi.stubEnv("OPENROUTER_API_KEY", "offline-fixture-only");
    const f = await seedWorkbench(false, nativePiFixtureRoute);
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)));
            if (requests.length === 1) {
                const conversation = await f.t.run((ctx) =>
                    ctx.db
                        .query("agentConversations")
                        .withIndex("by_run", (q) => q.eq("runId", f.runId))
                        .unique(),
                );
                assert(conversation?.activeTurnId);
                for (let index = 0; index < count; index++) {
                    await f.client.mutation(
                        api.execution.conversations.submit,
                        {
                            runId: f.runId,
                            turnId: conversation.activeTurnId,
                            requestKey: `earlier-steer-${index}`,
                            text: `Keep the saved scope unchanged (${index}).`,
                            delivery: "steer",
                        },
                    );
                    await f.client.mutation(api.framing.save, {
                        runId: f.runId,
                        expectedRevision: index + 1,
                        requestKey: `later-direct-edit-${index}`,
                        content: program(index + 1),
                    });
                }
                return response("The old draft needs reconsideration.");
            }
            return response(
                "The current saved program contains two questions.",
            );
        }),
    );
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(requests).toHaveLength(2);
    const messages = requests[1]?.messages ?? [];
    let priorObservation = -1;
    for (let index = 0; index < count; index++) {
        const steer = messages.findIndex(
            (message) =>
                message.content ===
                `Keep the saved scope unchanged (${index}).`,
        );
        const observation = messages.findIndex(
            (message) =>
                typeof message.content === "string" &&
                message.content.startsWith("Application observation") &&
                message.content.includes('"topic":"framing"') &&
                message.content.includes(`"revision":${index + 2}`),
        );
        expect(steer).toBeGreaterThan(priorObservation);
        expect(observation).toBeGreaterThan(steer);
        priorObservation = observation;
    }
}, 30000);

test("a native input batch excludes messages and effects admitted after its common snapshot", async () => {
    const requests: Array<{
        messages: Array<{ role: string; content: string }>;
    }> = [];
    vi.stubEnv("OPENROUTER_API_KEY", "offline-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)));
            return response("The saved program reflects the analyst's edits.");
        }),
    );
    const f = await seedWorkbench(false, nativePiFixtureRoute);
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);
    let injected = false;
    await f.t.action((ctx) =>
        runPiMission(
            {
                ...ctx,
                runMutation: async (reference, ...args) => {
                    const result = await ctx.runMutation(reference, ...args);
                    const name = getFunctionName(reference);
                    if (
                        !injected &&
                        [
                            "execution/piControl:admittedInputs",
                            "execution/piStore:inputSnapshot",
                        ].includes(name)
                    ) {
                        injected = true;
                        await f.client.mutation(
                            api.execution.conversations.submit,
                            {
                                runId: f.runId,
                                turnId: active.turnId,
                                requestKey: "snapshot-steer",
                                text: "Preserve my earlier research boundary.",
                                delivery: "steer",
                            },
                        );
                        await f.client.mutation(api.framing.save, {
                            runId: f.runId,
                            expectedRevision: 1,
                            requestKey: "snapshot-effect",
                            content: program(2),
                        });
                    }
                    return result;
                },
            },
            { missionId: active.missionId, expectedGeneration: 1 },
            "snapshot-race",
            nodeActionGenerationDeadline(Date.now()),
        ),
    );
    expect(injected).toBe(true);
    expect(requests).toHaveLength(1);
    const messages = requests[0]?.messages ?? [];
    const message = messages.findIndex(
        (m) => m.content === "Preserve my earlier research boundary.",
    );
    const observation = messages.findIndex(
        (m) =>
            typeof m.content === "string" &&
            m.content.startsWith("Application observation") &&
            m.content.includes('"topic":"framing"'),
    );
    expect(message).toBeGreaterThan(-1);
    expect(observation).toBeGreaterThan(message);
}, 30000);

test("a terminal legacy conversation settles before its current-state anchor is created by the next response", async () => {
    const f = await seedWorkbench(true);
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const before = await f.t.run(async (ctx) => {
        const session = await ctx.db.query("piSessions").first();
        assert(session);
        const mission = await ctx.db.get(session.missionId);
        assert(mission?.status === "completed");
        await ctx.db.patch(session._id, {
            observationSequence: undefined,
            observationEntry: undefined,
            settledSequence: undefined,
        });
        return {
            sessionId: session._id,
            missionId: mission._id,
            generation: mission.generation,
        };
    });
    await f.t.action((ctx) =>
        runPiMission(
            ctx,
            {
                missionId: before.missionId,
                expectedGeneration: before.generation,
            },
            "legacy-terminal-settlement",
            nodeActionGenerationDeadline(Date.now()),
        ),
    );
    const settled = await f.t.run((ctx) => ctx.db.get(before.sessionId));
    assert(settled);
    expect(settled.settledSequence).toBe(settled.sequence);
    expect(settled.observationSequence).toBeUndefined();
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "after-legacy-terminal",
        text: "Explain the current saved program.",
        delivery: "queue",
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const reopened = await f.t.run((ctx) => ctx.db.get(before.sessionId));
    assert(reopened);
    expect(reopened.observationSequence).toBeTypeOf("number");
    expect(reopened.observationEntry).toBeTypeOf("number");
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toHaveLength(0);
}, 30000);

test("new research observations retain structured stop facts without changing historical observations", async () => {
    const { seedResearchStateScenario } = await import(
        "@/__tests__/setup/research-state"
    );
    const { recordResearchObservation } = await import(
        "@convex/execution/researchControl"
    );
    const f = await seedResearchStateScenario({
        outcome: "partial",
        blockCode: "invalid_output",
        historicalTimeLimitNote: true,
        retainedDocumentCount: 1,
        capturedDocumentCount: 1,
    });
    const before = await f.t.run((ctx) => ctx.db.get(f.observationId));
    await f.t.run((ctx) =>
        recordResearchObservation(ctx, f.runId, "state_inspected"),
    );
    const observed = (await observations(f.t, f.runId)).find(
        (row) => row.value?.event === "state_inspected",
    );
    expect(observed).toMatchObject({
        value: {
            status: "idle",
            sources: {
                outcome: "partial",
                executionStop: { blockCode: "invalid_output" },
            },
            summary: expect.stringContaining(
                "model response could not be used",
            ),
        },
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.observationId))).toEqual(before);
});

test("native Workbench consultation preserves captured and retained sets through serialization", async () => {
    vi.stubEnv("WORKBENCH_AGENT_ENABLED", "true");
    const { seedResearchStateScenario } = await import(
        "@/__tests__/setup/research-state"
    );
    const requests: NativeWireRequest[] = [];
    let needId = "";
    vi.stubEnv("OPENROUTER_API_KEY", "offline-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)));
            return requests.length === 1
                ? toolResponse("consult_run_state", {}, "inspect-source-state")
                : requests.length === 2
                  ? toolResponse(
                        "consult_prepared_material",
                        { needId },
                        "inspect-handoff-note",
                    )
                  : response(
                        "The captured set and retained material remain distinct.",
                    );
        }),
    );
    const f = await seedResearchStateScenario(
        {
            outcome: "partial",
            blockCode: "invalid_output",
            historicalTimeLimitNote: true,
            retainedDocumentCount: 4,
            capturedDocumentCount: 5,
        },
        { route: nativePiFixtureRoute },
    );
    const retained = await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission?.result);
        const firstNeed = preparation.sourcesMission.needs[0];
        assert(firstNeed);
        const document = preparation?.sourcesMission?.result?.documents[0];
        assert(document);
        const qualification = await ctx.db.get(document.qualificationTaskId);
        assert(qualification?.output.kind === "documentary_qualification");
        const control = await ctx.db.get(qualification.output.controlTaskId);
        assert(control?.output.kind === "documentary_control");
        const contributions = [
            {
                id: "attribution",
                kind: "attributed_argument",
                use: "attributed_argument_only",
                conclusion: "supported",
            },
            {
                id: "context",
                kind: "context",
                use: "context_only",
                conclusion: "supported",
            },
            {
                id: "conflict",
                kind: "asserted_fact",
                use: "blocked",
                conclusion: "documentary_conflict",
            },
        ] as const;
        await ctx.db.patch(qualification._id, {
            output: {
                ...qualification.output,
                contributions: contributions.map((entry) => ({
                    id: entry.id,
                    version: 1,
                    needIds: [firstNeed.id],
                    statement: `Historical ${entry.id} contribution`,
                    kind: entry.kind,
                    period: "Historical fixture",
                    modality: "recorded",
                    attribution: "Fixture source",
                    evidence: [],
                })),
            },
        });
        await ctx.db.patch(control._id, {
            output: {
                ...control.output,
                control: {
                    ...control.output.control,
                    findings: contributions.map((entry) => ({
                        contributionId: entry.id,
                        conclusion: entry.conclusion,
                        permittedUse: entry.use,
                        diagnostic: `Recorded ${entry.id} limit`,
                    })),
                },
            },
        });
        await ctx.db.patch(preparation._id, {
            sourcesMission: {
                ...preparation.sourcesMission,
                result: {
                    ...preparation.sourcesMission.result,
                    documents: preparation.sourcesMission.result.documents.map(
                        (entry) =>
                            entry.sourceId === document.sourceId
                                ? {
                                      ...entry,
                                      contributions: contributions.map(
                                          ({ id }) => ({ id, version: 1 }),
                                      ),
                                  }
                                : entry,
                    ),
                    needs: preparation.sourcesMission.result.needs.map(
                        (entry) =>
                            entry.needId === firstNeed.id
                                ? {
                                      ...entry,
                                      contributions: contributions.map(
                                          ({ id }) => ({
                                              qualificationTaskId:
                                                  document.qualificationTaskId,
                                              contributionId: id,
                                              version: 1,
                                          }),
                                      ),
                                  }
                                : entry,
                    ),
                },
            },
        });
        return document;
    });
    const before = await f.t.run(async (ctx) => ({
        preparation: await ctx.db.get(f.preparationId),
        run: await ctx.db.get(f.runId),
        sourcesMission: await ctx.db.get(f.missionId),
        approvals: await ctx.db.query("approvalRequests").collect(),
        grants: await ctx.db.query("approvalGrants").collect(),
        captures: await ctx.db.query("sourceCaptures").collect(),
        observation: await ctx.db.get(f.observationId),
    }));
    const mission = await f.t.run((ctx) => ctx.db.get(f.workbenchMissionId));
    assert(mission);
    const need = before.preparation?.sourcesMission?.needs[0];
    assert(need);
    needId = need.id;
    await f.t.action((ctx) =>
        runPiMission(
            ctx,
            {
                missionId: f.workbenchMissionId,
                expectedGeneration: mission.generation,
            },
            "capture-scoped-consultation",
            nodeActionGenerationDeadline(Date.now()),
        ),
    );
    expect(requests).toHaveLength(3);
    const required = requests[0]?.messages.find((message) =>
        message.content?.startsWith("Required current mission state:\n"),
    )?.content;
    assert(required);
    const state = JSON.parse(
        required
            .slice("Required current mission state:\n".length)
            .split("\n\n")[0] ?? "",
    );
    expect(state.domain.availableMaterials).toHaveLength(5);
    const frozen = before.preparation?.sourcesMission?.result;
    assert(frozen);
    expect(frozen.documents).toHaveLength(4);
    for (const document of frozen.documents) {
        expect(state.domain.availableMaterials).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    sourceId: document.sourceId,
                    documentaryState: expect.objectContaining({
                        preparationId: f.preparationId,
                        membership: "retained",
                        capture: {
                            captureId: document.captureId,
                            contentHash: document.contentHash,
                        },
                        retainedSnapshot: {
                            needsRevision: frozen.needsRevision,
                            captureId: document.captureId,
                            contentHash: document.contentHash,
                            qualificationTaskId: document.qualificationTaskId,
                            qualificationVersion: document.qualificationVersion,
                        },
                        qualification: {
                            status: "recorded",
                            taskId: document.qualificationTaskId,
                            version: document.qualificationVersion,
                            captureId: document.captureId,
                            contentHash: document.contentHash,
                        },
                    }),
                }),
            ]),
        );
    }
    const unqualified = before.captures.find(
        (capture) => capture.sourceId === f.sourceIds[4],
    );
    assert(unqualified);
    expect(state.domain.availableMaterials).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                sourceId: retained.sourceId,
                documentaryState: expect.objectContaining({
                    contributions: expect.objectContaining({
                        total: 3,
                        supported: 2,
                        conflict: 1,
                        restricted: 0,
                        effectiveUses: {
                            documentary: 0,
                            attributed_argument_only: 1,
                            context_only: 1,
                            blocked: 1,
                        },
                    }),
                }),
            }),
            expect.objectContaining({
                sourceId: f.sourceIds[4],
                documentaryState: expect.objectContaining({
                    preparationId: f.preparationId,
                    membership: "not_retained",
                    capture: {
                        captureId: unqualified._id,
                        contentHash: unqualified.contentHash,
                    },
                    qualification: { status: "not_recorded" },
                    retainedSnapshot: null,
                    contributions: null,
                }),
            }),
        ]),
    );
    expect(state.domain.research).toMatchObject({
        sources: {
            settledAt: 2,
            executionStop: { blockCode: "invalid_output" },
        },
        summary: expect.stringContaining("model response could not be used"),
    });
    expect(state.domain.research.summary).toContain("Recorded stop:");
    expect(state.domain.research.summary).not.toContain("time window ended");
    const historicalReceipt = requests[2]?.messages.find(
        (message) =>
            message.role === "tool" &&
            message.content?.includes('"unfinished"'),
    );
    assert(historicalReceipt?.content);
    expect(JSON.parse(historicalReceipt.content)).toMatchObject({
        kind: "success",
        value: {
            preparationId: f.preparationId,
            needsRevision: before.preparation?.sourcesMission?.needsRevision,
            outcome: {
                needId,
                unfinished: [
                    "The Sources Agent stopped here because its time window ended.",
                ],
            },
        },
    });
    const tools = requests[1]?.messages.filter(
        (message) => message.role === "tool",
    );
    expect(tools).toHaveLength(1);
    const receipt = JSON.parse(tools?.[0]?.content ?? "null");
    expect(receipt).toMatchObject({
        kind: "success",
        value: {
            research: {
                sources: {
                    outcome: "partial",
                    settledAt: 2,
                    executionStop: { blockCode: "invalid_output" },
                },
            },
        },
    });
    expect(receipt.value.research.sources.retainedDocuments).toHaveLength(4);
    expect(
        receipt.value.research.sources.retainedDocuments.map(
            (item: { sourceId: string }) => item.sourceId,
        ),
    ).not.toContain(f.sourceIds[4]);
    const operations = await f.t.run((ctx) =>
        ctx.db.query("agentOperationRequests").collect(),
    );
    expect(
        operations.find((item) => item.input.kind === "consult_run_state"),
    ).toMatchObject({ operationVersion: 2, status: "completed" });
    const after = await f.t.run(async (ctx) => ({
        preparation: await ctx.db.get(f.preparationId),
        run: await ctx.db.get(f.runId),
        sourcesMission: await ctx.db.get(f.missionId),
        approvals: await ctx.db.query("approvalRequests").collect(),
        grants: await ctx.db.query("approvalGrants").collect(),
        workbenchMission: await ctx.db.get(f.workbenchMissionId),
        calls: await ctx.db.query("providerCalls").collect(),
        observation: await ctx.db.get(f.observationId),
    }));
    expect(after.preparation).toEqual(before.preparation);
    expect(after.sourcesMission).toEqual(before.sourcesMission);
    expect(after.approvals).toEqual(before.approvals);
    expect(after.grants).toEqual(before.grants);
    expect(after.observation).toEqual(before.observation);
    expect({
        executionGeneration: after.run?.executionGeneration,
        executionHarnessDeadlineAt: after.run?.executionHarnessDeadlineAt,
        researchControlRevision: after.run?.researchControlRevision,
        reservationStatus: after.run?.reservationStatus,
        automaticSupplementOperationId:
            after.run?.automaticSupplementOperationId,
    }).toEqual({
        executionGeneration: before.run?.executionGeneration,
        executionHarnessDeadlineAt: before.run?.executionHarnessDeadlineAt,
        researchControlRevision: before.run?.researchControlRevision,
        reservationStatus: before.run?.reservationStatus,
        automaticSupplementOperationId:
            before.run?.automaticSupplementOperationId,
    });
    expect(after.run?.sourcePreparationBudget).toEqual({
        ...before.run?.sourcePreparationBudget,
        dispatches: (before.run?.sourcePreparationBudget?.dispatches ?? 0) + 3,
        work: (before.run?.sourcePreparationBudget?.work ?? 0) + 3,
    });
    expect({
        generation: after.workbenchMission?.generation,
        deadlineAt: after.workbenchMission?.deadlineAt,
        resourcePolicy: after.workbenchMission?.resourcePolicy,
        modelLimits: after.workbenchMission?.modelLimits,
        executionScope: after.workbenchMission?.executionScope,
    }).toEqual({
        generation: mission.generation,
        deadlineAt: mission.deadlineAt,
        resourcePolicy: mission.resourcePolicy,
        modelLimits: mission.modelLimits,
        executionScope: mission.executionScope,
    });
    expect(after.calls).toHaveLength(3);
}, 30000);
