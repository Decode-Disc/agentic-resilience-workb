import { api } from "@convex/_generated/api";
import { runPiMission } from "@convex/integrations/piMission";
import { afterEach, assert, expect, test, vi } from "vitest";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import { seedWorkbench } from "@/__tests__/setup/workbench";
import { seedWorkbenchMaterials } from "@/__tests__/setup/workbench-materials";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

function reply(text: string) {
    return new Response(
        [
            `data: ${JSON.stringify({ id: "native-workbench", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] })}`,
            `data: ${JSON.stringify({ id: "native-workbench", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}`,
            "data: [DONE]",
            "",
        ].join("\n\n"),
        { headers: { "content-type": "text/event-stream" } },
    );
}

test("a direct analyst edit survives stale output and a fresh conflicting tool proposal in the same native conversation", async () => {
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    const payloads: string[] = [];
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
            payloads.push(init.body);
            if (payloads.length > 3)
                throw new Error("Recovery repeated without progress");
            if (payloads.length === 1) {
                const framing = await client.query(api.framing.get, { runId });
                assert(framing);
                await client.mutation(api.framing.save, {
                    runId,
                    expectedRevision: framing.revision,
                    requestKey: "concurrent-direct-edit",
                    content: {
                        scope: "Analyst-defined repairer intake",
                        questions: [
                            {
                                id: "switching",
                                shortLabel: "Switching",
                                text: "Which insurer relationships constrain repairer switching?",
                                rationale:
                                    "Distinguish contractual dependencies.",
                            },
                        ],
                    },
                });
                return reply("The superseded broad program is ready.");
            }
            if (payloads.length === 2) {
                const framing = await client.query(api.framing.get, { runId });
                assert(framing);
                return toolReply("adjust_framing", {
                    content: {
                        ...framing.content,
                        questions: framing.content.questions.map(
                            (question) => ({
                                ...question,
                                text: "Which repairer-specific relationships constrain repairer switching?",
                            }),
                        ),
                    },
                });
            }
            return reply(
                "The insurer-specific switching question is preserved.",
            );
        }),
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 120);
    const messages = await client.query(
        api.execution.conversations.listMessages,
        { runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    expect(
        messages.page
            .filter((message) => message.role === "assistant")
            .map((message) => message.text),
    ).toEqual([
        "The insurer-specific switching question is preserved.\n\nThe proposed framing change was not saved. No framing change from this response is waiting to run.",
    ]);
    expect(payloads).toHaveLength(3);
    expect(payloads[1]).toContain("Analyst-defined repairer intake");
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 2,
        content: {
            scope: "Analyst-defined repairer intake",
            questions: [
                expect.objectContaining({
                    text: "Which insurer relationships constrain repairer switching?",
                }),
            ],
        },
    });
    expect(payloads[2]).toContain("analyst directly edited");
    const operations = await t.run((ctx) =>
        ctx.db.query("agentOperationRequests").collect(),
    );
    expect(operations).toEqual([
        expect.objectContaining({
            outcome: { kind: "refused", code: "framing_analyst_conflict" },
        }),
    ]);
    const sessions = await t.run((ctx) => ctx.db.query("piSessions").collect());
    expect(sessions).toHaveLength(1);
}, 30000);

test("new Workbench publishes native prose and the next response receives the original conversation", async () => {
    const payloads: Array<{
        messages: Array<{ role: string; content: unknown }>;
    }> = [];
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
            payloads.push(JSON.parse(init.body));
            return reply(
                payloads.length === 1
                    ? "The workflow owner sets the rules."
                    : "The earlier distinction still applies.",
            );
        }),
    );
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const messages = () =>
        client.query(api.execution.conversations.listMessages, {
            runId,
            paginationOpts: { numItems: 20, cursor: null },
        });
    expect(
        (await messages()).page.find((m) => m.role === "assistant")?.text,
    ).toBe("The workflow owner sets the rules.");
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "second",
        text: "Explain that distinction.",
        delivery: "queue",
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(payloads).toHaveLength(2);
    assert(payloads[1]);
    expect(payloads[1].messages).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                role: "assistant",
                content: expect.stringContaining(
                    "The workflow owner sets the rules.",
                ),
            }),
            expect.objectContaining({ role: "user" }),
        ]),
    );
    expect(JSON.stringify(payloads[1])).toContain("Explain that distinction.");
}, 30000);

test.each([
    "Pause research.",
    "Start research now",
    "Please start the research.",
])("control-only confirmation follows actual state and replaces the model view while retaining the raw claim: %s", async (command) => {
    const payloads: Array<{
        messages: Array<{ role: string; content: unknown }>;
    }> = [];
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
            payloads.push(JSON.parse(init.body));
            return reply(
                payloads.length === 1
                    ? "Research is now paused."
                    : "We still need to start research.",
            );
        }),
    );
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    const original = await t.run((ctx) =>
        ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", runId).eq("status", "queued"),
            )
            .first(),
    );
    assert(original);
    await client.mutation(api.execution.conversations.removeQueued, {
        runId,
        messageId: original._id,
    });
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "pause-only",
        text: command,
        delivery: "queue",
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const page = await client.query(api.execution.conversations.listMessages, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    const published = page.page.find((m) => m.role === "assistant")?.text;
    expect(published).toBe(
        "Research has not started. Review the research program and choose Start research when ready.",
    );
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "follow-up",
        text: "What happens next?",
        delivery: "queue",
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    assert(payloads[1]);
    const prior = payloads[1].messages.filter((m) => m.role === "assistant");
    expect(JSON.stringify(prior)).toContain(published);
    expect(JSON.stringify(prior)).not.toContain("Research is now paused.");
    const commits = await t.run((ctx) => ctx.db.query("piCommits").collect());
    expect(
        commits.some((c) => c.payload?.includes("Research is now paused.")),
    ).toBe(true);
}, 30000);

function toolReply(name: string, input: object | string | undefined) {
    return new Response(
        [
            `data: ${JSON.stringify({ id: "native-tool", choices: [{ index: 0, delta: { role: "assistant", content: "I am updating the proposal.", tool_calls: [{ index: 0, id: "native-adjust", type: "function", function: { name, arguments: typeof input === "string" ? input : JSON.stringify(input) } }] }, finish_reason: null }] })}`,
            `data: ${JSON.stringify({ id: "native-tool", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}`,
            "data: [DONE]",
            "",
        ].join("\n\n"),
        { headers: { "content-type": "text/event-stream" } },
    );
}

test("an unavailable passage gives a recovery instruction and a searched passage can then be read", async () => {
    const { t, sourceId, start } = await seedWorkbenchMaterials(
        1,
        1,
        nativePiFixtureRoute,
    );
    const active = await start();
    assert(active);
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    let calls = 0;
    let recovery = "";
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
            calls++;
            if (calls === 1)
                return toolReply("read_in_context", {
                    sourceId,
                    passageOrder: 999,
                });
            if (calls === 2) {
                const payload = JSON.parse(init.body);
                const result = payload.messages
                    .filter((m: { role: string }) => m.role === "tool")
                    .at(-1);
                recovery = JSON.stringify(result.content);
                return toolReply("search_available_material", {
                    sourceId,
                    query: "workflow",
                });
            }
            if (calls === 3)
                return toolReply("read_in_context", {
                    sourceId,
                    passageOrder: 0,
                });
            if (calls === 4)
                return reply(
                    "The retained passage describes workflow software.",
                );
            throw new Error("Unexpected reading continuation");
        }),
    );
    await t.action((ctx) =>
        runPiMission(
            ctx,
            { missionId: active.missionId, expectedGeneration: 1 },
            "passage-recovery",
        ),
    );
    expect(calls).toBe(4);
    expect(recovery).toContain("search_available_material");
    const requests = await t.run((ctx) =>
        ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission_and_status", (q) =>
                q.eq("missionId", active.missionId),
            )
            .collect(),
    );
    expect(requests.map((request) => request.outcome?.kind)).toEqual([
        "unavailable",
        "success",
        "success",
    ]);
    const read = requests.at(-1)?.outcome;
    assert(read?.kind === "success");
    expect(JSON.parse(read.valueJson).passage).toMatchObject({
        passageOrder: 0,
        exactQuote: expect.stringContaining("workflow"),
    });
}, 30000);

test("native tools omit mechanical revisions, persist canonical arguments and return readable results before final prose", async () => {
    const payloads: Array<{
        tools: Array<{
            function: {
                name: string;
                parameters: { properties: Record<string, unknown> };
            };
        }>;
        messages: Array<{ role: string; content: unknown }>;
    }> = [];
    const content = {
        scope: "Workflow coordination",
        questions: [
            {
                id: "control",
                shortLabel: "Control",
                text: "Who controls coordination?",
                rationale: "Inspect rule-setting authority.",
            },
        ],
    };
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
            payloads.push(JSON.parse(init.body));
            return payloads.length === 1
                ? toolReply("adjust_framing", { content })
                : reply("The research program is saved.");
        }),
    );
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect((await client.query(api.framing.get, { runId }))?.content).toEqual(
        content,
    );
    assert(payloads[0]);
    assert(payloads[1]);
    const tools = payloads[0].tools.map((tool) => tool.function);
    expect(
        tools.find((tool) => tool.name.includes("adjust_framing"))?.parameters
            .properties,
    ).not.toHaveProperty("expectedRevision");
    expect(tools.some((tool) => tool.name.includes("control_research"))).toBe(
        false,
    );
    const requests = await t.run((ctx) =>
        ctx.db.query("agentOperationRequests").collect(),
    );
    expect(
        requests.find((request) => request.input.kind === "adjust_framing")
            ?.input,
    ).toMatchObject({ expectedRevision: 1, content });
    const page = await client.query(api.execution.conversations.listMessages, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(
        page.page
            .filter((message) => message.role === "assistant")
            .map((message) => message.text),
    ).toEqual(["The research program is saved."]);
    const toolOutput = JSON.stringify(
        payloads[1].messages.filter((message) => message.role === "tool"),
    );
    expect(toolOutput).not.toContain("valueJson");
    expect(toolOutput).toContain("revision");
}, 30000);

test("a native steer during generation prevents stale publication while queued text waits for its own response", async () => {
    const payloads: unknown[] = [];
    let entered!: () => void;
    const dispatched = new Promise<void>((resolve) => {
        entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
            payloads.push(JSON.parse(init.body));
            if (payloads.length === 1) {
                entered();
                await gate;
                return reply("Stale scope.");
            }
            return reply(
                payloads.length === 2
                    ? "The new direction is included."
                    : "The queued question is now active.",
            );
        }),
    );
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    const running = t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    try {
        await dispatched;
        const active = await client.query(api.execution.conversations.get, {
            runId,
        });
        assert(active.activeTurn);
        await client.mutation(api.execution.conversations.submit, {
            runId,
            requestKey: "native-steer",
            text: "NEW DIRECTION: inspect pricing authority.",
            delivery: "steer",
            turnId: active.activeTurn._id,
        });
        await client.mutation(api.execution.conversations.submit, {
            runId,
            requestKey: "native-queued",
            text: "WAIT FOR NEXT RESPONSE",
            delivery: "queue",
        });
    } finally {
        release();
    }
    await running;
    expect(payloads).toHaveLength(3);
    expect(JSON.stringify(payloads[1])).toContain("NEW DIRECTION");
    expect(JSON.stringify(payloads[1])).not.toContain("WAIT FOR NEXT RESPONSE");
    const page = await client.query(api.execution.conversations.listMessages, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(
        page.page
            .filter((message) => message.role === "assistant")
            .map((message) => message.text),
    ).toEqual([
        "The new direction is included.",
        "The queued question is now active.",
    ]);
}, 30000);

test("stopping a native response settles its cancelled tasks and reuses the conversation after an explicit queue resume", async () => {
    let entered!: () => void;
    const dispatched = new Promise<void>((resolve) => {
        entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let count = 0;
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
            count++;
            if (count === 1) {
                entered();
                await gate;
                return reply("Cancelled answer.");
            }
            return reply("The requested continuation is ready.");
        }),
    );
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    const running = t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    try {
        await dispatched;
        const active = await client.query(api.execution.conversations.get, {
            runId,
        });
        await client.mutation(api.execution.conversations.submit, {
            runId,
            requestKey: "after-stop",
            text: "Continue from the retained conversation.",
            delivery: "queue",
        });
        assert(active.activeTurn);
        await client.mutation(api.execution.conversations.stopResponse, {
            runId,
            turnId: active.activeTurn._id,
        });
    } finally {
        release();
    }
    await running;
    expect(count).toBe(1);
    expect(
        (await t.run((ctx) => ctx.db.query("piSessions").first()))
            ?.settlementFailureCode,
    ).toBeUndefined();
    await client.mutation(api.execution.conversations.resumeQueue, { runId });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(count).toBe(2);
    const page = await client.query(api.execution.conversations.listMessages, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(
        page.page
            .filter((message) => message.role === "assistant")
            .map((message) => message.text),
    ).toEqual(["The requested continuation is ready."]);
    const sessions = await t.run((ctx) => ctx.db.query("piSessions").collect());
    expect(sessions).toHaveLength(1);
    assert(sessions[0]);
    expect(sessions[0].settledSequence).toBe(sessions[0].sequence);
}, 30000);

test("superseded conversations retain readable history but cannot generate through the current definition", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
            reply('{"kind":"complete","text":"Legacy response."}'),
        ),
    );
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    await t.run(async (ctx) => {
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .unique();
        assert(conversation);
        await ctx.db.patch(conversation._id, {
            definitionId: undefined,
            definitionVersion: undefined,
        });
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "legacy-second",
        text: "Continue this historical conversation.",
        delivery: "queue",
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const sessions = await t.run((ctx) => ctx.db.query("piSessions").collect());
    expect(sessions).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    const page = await client.query(api.execution.conversations.listMessages, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(
        page.page
            .filter((message) => message.role === "assistant")
            .map((message) => message.text),
    ).toEqual([]);
    expect(
        page.page.filter((message) => message.role === "user").length,
    ).toBeGreaterThan(0);
}, 30000);

test("successive steers retain their native submission identity across instruction versions", async () => {
    const arrivals: Array<() => void> = [];
    const entered = [0, 1].map(
        (index) =>
            new Promise<void>((resolve) => {
                arrivals[index] = resolve;
            }),
    );
    const releases: Array<() => void> = [];
    const gates = [0, 1].map(
        (index) =>
            new Promise<void>((resolve) => {
                releases[index] = resolve;
            }),
    );
    let count = 0;
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
            const index = count++;
            if (index < 2) {
                arrivals[index]?.();
                await gates[index];
            }
            return reply(
                index < 2
                    ? "Outdated response."
                    : "Both refinements are included.",
            );
        }),
    );
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    const running = t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    try {
        for (const index of [0, 1]) {
            await entered[index];
            const active = await client.query(api.execution.conversations.get, {
                runId,
            });
            assert(active.activeTurn);
            await client.mutation(api.execution.conversations.submit, {
                runId,
                requestKey: `steer-${index}`,
                text: `Additional direction ${index}.`,
                delivery: "steer",
                turnId: active.activeTurn._id,
            });
            releases[index]?.();
        }
    } finally {
        for (const release of releases) release();
    }
    await running;
    const page = await client.query(api.execution.conversations.listMessages, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(
        page.page
            .filter((message) => message.role === "assistant")
            .map((message) => message.text),
    ).toEqual(["Both refinements are included."]);
    expect(count).toBe(3);
}, 30000);

test("rejected framing receipts survive native handover and a later preservation command fences a forced write", async () => {
    const payloads: Array<{
        tools: Array<{ function: { name: string } }>;
        messages: unknown[];
    }> = [];
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
            payloads.push(JSON.parse(init.body));
            if (payloads.length > 4)
                throw new Error("Unexpected native recovery loop");
            if (payloads.length === 1)
                return toolReply("adjust_framing", {
                    content: {
                        scope: "Incomplete proposal",
                        questions: [
                            {
                                id: "switching",
                                text: "What constrains switching?",
                            },
                        ],
                    },
                });
            if (payloads.length === 2)
                return reply("I will correct the proposal and resubmit it.");
            if (payloads.length === 3)
                return toolReply("adjust_framing", {
                    content: {
                        scope: "Unauthorized replacement",
                        questions: [
                            {
                                id: "switching",
                                shortLabel: "Switching",
                                text: "What constrains switching?",
                                rationale: "Inspect dependencies.",
                            },
                        ],
                    },
                });
            return reply(
                "I remember the earlier request. No changes are needed.",
            );
        }),
    );
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const messages = () =>
        client.query(api.execution.conversations.listMessages, {
            runId,
            paginationOpts: { numItems: 20, cursor: null },
        });
    expect(
        (await messages()).page.find((message) => message.role === "assistant")
            ?.text,
    ).toContain(
        "The proposed framing change was not saved. No framing change from this response is waiting to run.",
    );
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "recall-only",
        text: "What did I ask you to change? Keep the saved program unchanged.",
        delivery: "queue",
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(payloads).toHaveLength(4);
    expect(
        payloads[2]?.tools.some((tool) =>
            tool.function.name.includes("adjust_framing"),
        ),
    ).toBe(false);
    expect(JSON.stringify(payloads[2]?.messages)).toContain(
        "No framing change from this response is waiting to run.",
    );
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 1,
        content: { scope: "", questions: [] },
    });
    const requests = await t.run((ctx) =>
        ctx.db.query("agentOperationRequests").collect(),
    );
    expect(requests).toHaveLength(2);
    expect(
        requests.every(
            (request) =>
                request.outcome?.kind === "refused" &&
                request.effect === undefined,
        ),
    ).toBe(true);
    expect(
        (await messages()).page.filter(
            (message) => message.role === "assistant",
        ),
    ).toHaveLength(2);
    expect(
        await t.run((ctx) => ctx.db.query("piSessions").collect()),
    ).toHaveLength(1);
    expect(
        (await client.query(api.execution.conversations.get, { runId }))
            .activeTurn,
    ).toBeNull();
}, 30000);

test("a malformed conversation continuation returns a refusal and the same response completes after a corrected read", async () => {
    const payloads: string[] = [];
    const providerErrors: unknown[] = [];
    let continuation: string | undefined;
    const initialReply = "I acknowledged the initial request.";
    const finalReply =
        "The original exchange is retained. The saved program is unchanged.";
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            try {
                const body = String(init?.body);
                payloads.push(body);
                if (payloads.length === 1) return reply(initialReply);
                if (payloads.length === 2)
                    return toolReply("consult_conversation", {});
                const payload = JSON.parse(body);
                const lastTool = payload.messages
                    .filter(
                        (message: { role: string }) => message.role === "tool",
                    )
                    .at(-1);
                assert(lastTool && typeof lastTool.content === "string");
                const result = JSON.parse(lastTool.content);
                if (payloads.length === 3) {
                    expect(result.kind).toBe("success");
                    continuation = result.value.continueCursor;
                    assert(typeof continuation === "string");
                    expect(continuation).toMatch(/^history:/);
                    return toolReply("consult_conversation", {
                        cursor: JSON.stringify({
                            cursor: "not-a-database-cursor",
                            offset: 0,
                        }),
                    });
                }
                if (payloads.length === 4) {
                    expect(result).toMatchObject({
                        kind: "refused",
                        code: "history_cursor_invalid",
                        diagnostic: expect.stringContaining(
                            "copy only continueCursor returned by the same history operation",
                        ),
                    });
                    return toolReply("consult_conversation", {
                        cursor: continuation,
                    });
                }
                if (payloads.length === 5) {
                    expect(result).toMatchObject({
                        kind: "success",
                        value: {
                            entries: [
                                expect.objectContaining({
                                    role: "assistant",
                                    content: initialReply,
                                }),
                            ],
                        },
                    });
                    return reply(finalReply);
                }
                throw new Error("Unexpected conversation recovery loop");
            } catch (error) {
                providerErrors.push(error);
                throw error;
            }
        }),
    );
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const framing = await client.query(api.framing.get, { runId });
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "conversation-pagination-recovery",
        text: "Read our original exchange. Keep the saved program unchanged.",
        delivery: "queue",
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    if (providerErrors.length) throw providerErrors[0];
    const messages = await client.query(
        api.execution.conversations.listMessages,
        { runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    const requests = await t.run((ctx) =>
        ctx.db.query("agentOperationRequests").collect(),
    );
    expect(
        await t.run((ctx) => ctx.db.query("agentMissions").collect()),
    ).toEqual([
        expect.objectContaining({ status: "completed" }),
        expect.objectContaining({ status: "completed" }),
    ]);
    expect(requests.map((request) => request.outcome?.kind)).toEqual([
        "success",
        "refused",
        "success",
    ]);
    expect(
        messages.page.filter((m) => m.role === "assistant").map((m) => m.text),
    ).toEqual([initialReply, finalReply]);
    expect(payloads).toHaveLength(5);
    expect(requests.every((request) => request.status === "completed")).toBe(
        true,
    );
    expect(
        (await client.query(api.execution.conversations.get, { runId }))
            .activeTurn,
    ).toBeNull();
    expect(await client.query(api.framing.get, { runId })).toEqual(framing);
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        lifecycleState: "framing",
        executionStatus: "idle",
    });
    expect(
        await t.run((ctx) => ctx.db.query("piSessions").collect()),
    ).toHaveLength(1);
});

test("an invalid history cursor gives exact recovery guidance and permits reading prior conversation", async () => {
    const payloads: string[] = [];
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
            payloads.push(init.body);
            if (payloads.length === 1)
                return reply("The requested boundary is retained.");
            if (payloads.length === 2)
                return toolReply("consult_mission_state", {
                    cursor: "invented-turn-id",
                });
            if (payloads.length === 3)
                return toolReply("consult_conversation", {});
            if (payloads.length === 4)
                return reply(
                    "I can read our earlier exchange without changing the program.",
                );
            throw new Error("Unexpected history recovery loop");
        }),
    );
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const history = await client.query(
        api.execution.conversations.listMessages,
        { runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    const original = history.page.find((message) => message.role === "user");
    assert(original);
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "history-recovery",
        text: "Recall my previous request. Keep the saved program unchanged.",
        delivery: "queue",
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(payloads).toHaveLength(4);
    expect(payloads[2]).toContain("Omit cursor to start at the first page");
    expect(payloads[2]).toContain(
        "Use consult_conversation for prior analyst exchanges",
    );
    const finalPayload = JSON.parse(payloads[3] ?? "{}");
    const toolResults = finalPayload.messages
        .filter((message: { role: string }) => message.role === "tool")
        .flatMap(
            (message: {
                content: string | Array<{ type: string; text: string }>;
            }) =>
                typeof message.content === "string"
                    ? [message.content]
                    : message.content
                          .filter((part) => part.type === "text")
                          .map((part) => part.text),
        )
        .map((content: string) => JSON.parse(content));
    expect(toolResults).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                kind: "refused",
                code: "history_cursor_invalid",
            }),
            expect.objectContaining({
                kind: "success",
                value: expect.objectContaining({
                    entries: expect.arrayContaining([
                        expect.objectContaining({
                            role: "user",
                            content: original.text,
                        }),
                    ]),
                }),
            }),
        ]),
    );
    const requests = await t.run((ctx) =>
        ctx.db.query("agentOperationRequests").collect(),
    );
    expect(requests.map((request) => request.outcome?.kind)).toEqual([
        "refused",
        "success",
    ]);
    expect(
        (await client.query(api.execution.conversations.get, { runId }))
            .activeTurn,
    ).toBeNull();
    expect(
        await t.run((ctx) => ctx.db.query("piSessions").collect()),
    ).toHaveLength(1);
}, 30000);

test.each([
    "{",
    "[]",
    "",
])("a complete native tool reply with invalid original arguments becomes an operation refusal and completes the conversation (%j)", async (original) => {
    const network = vi.fn(async () => {
        if (network.mock.calls.length === 1)
            return toolReply("adjust_framing", original);
        if (network.mock.calls.length === 2)
            return reply("I will correct the proposed change.");
        throw new Error("Unexpected native malformed-argument loop");
    });
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubGlobal("fetch", network);
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const requests = await t.run((ctx) =>
        ctx.db.query("agentOperationRequests").collect(),
    );
    expect(requests).toEqual([
        expect.objectContaining({
            input: {
                kind: "invalid",
                name: "adjust_framing",
                inputJson: original,
                validation: { path: "", expected: "object" },
            },
            status: "completed",
            outcome: expect.objectContaining({ kind: "refused" }),
        }),
    ]);
    const messages = await client.query(
        api.execution.conversations.listMessages,
        { runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    expect(
        messages.page.filter((m) => m.role === "assistant").map((m) => m.text),
    ).toEqual([
        "I will correct the proposed change.\n\nThe proposed framing change was not saved. No framing change from this response is waiting to run.",
    ]);
    expect(
        (await client.query(api.execution.conversations.get, { runId }))
            .activeTurn,
    ).toBeNull();
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 1,
        content: { scope: "", questions: [] },
    });
    const payloads = await t.run((ctx) =>
        ctx.db.query("agentInvocationPayloads").collect(),
    );
    expect(
        payloads
            .filter((p) => p.part === "reply")
            .some(
                (p) =>
                    p.json?.includes(
                        `"rawArguments":${JSON.stringify(original)}`,
                    ) && p.json.includes('"argumentsError"'),
            ),
    ).toBe(true);
    expect(network).toHaveBeenCalledTimes(2);
}, 30000);

test("missing native argument evidence blocks generation and a fresh analyst request can continue safely", async () => {
    const network = vi.fn(async () => {
        if (network.mock.calls.length === 1)
            return toolReply("adjust_framing", undefined);
        if (network.mock.calls.length === 2)
            return reply("The saved program is unchanged.");
        throw new Error("Unexpected missing-argument retry");
    });
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubGlobal("fetch", network);
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(
        await t.run((ctx) => ctx.db.query("agentMissions").collect()),
    ).toEqual([
        expect.objectContaining({
            status: "blocked",
            blockCode: "invalid_output",
        }),
    ]);
    expect(
        await t.run((ctx) => ctx.db.query("agentOperationRequests").collect()),
    ).toEqual([]);
    expect(network).toHaveBeenCalledTimes(1);
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "continue-after-missing-arguments",
        text: "Continue our conversation. Keep the saved program unchanged.",
        delivery: "queue",
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(
        (await client.query(api.execution.conversations.get, { runId }))
            .activeTurn,
    ).toBeNull();
    expect(
        (
            await client.query(api.execution.conversations.listMessages, {
                runId,
                paginationOpts: { numItems: 20, cursor: null },
            })
        ).page
            .filter((m) => m.role === "assistant")
            .map((m) => m.text),
    ).toEqual(["The saved program is unchanged."]);
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 1,
        content: { scope: "", questions: [] },
    });
    expect(network).toHaveBeenCalledTimes(2);
}, 30000);

test("a corrected native framing operation succeeds after malformed original JSON without a stale failure receipt", async () => {
    const network = vi.fn(async () => {
        if (network.mock.calls.length === 1)
            return toolReply("adjust_framing", "{");
        if (network.mock.calls.length === 2)
            return toolReply("adjust_framing", {
                content: {
                    scope: "Photo-led claims coordination",
                    questions: [
                        {
                            id: "switching",
                            shortLabel: "Switching",
                            text: "What constrains repairer switching?",
                            rationale: "Examine dependencies.",
                        },
                    ],
                },
            });
        if (network.mock.calls.length === 3)
            return reply("The corrected question is saved.");
        throw new Error("Unexpected corrected-argument loop");
    });
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubGlobal("fetch", network);
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 2,
        content: {
            scope: "Photo-led claims coordination",
            questions: [
                expect.objectContaining({
                    text: "What constrains repairer switching?",
                }),
            ],
        },
    });
    expect(
        (
            await client.query(api.execution.conversations.listMessages, {
                runId,
                paginationOpts: { numItems: 20, cursor: null },
            })
        ).page
            .filter((m) => m.role === "assistant")
            .map((m) => m.text),
    ).toEqual(["The corrected question is saved."]);
    expect(
        await t.run((ctx) => ctx.db.query("agentOperationRequests").collect()),
    ).toEqual([
        expect.objectContaining({
            input: {
                kind: "invalid",
                name: "adjust_framing",
                inputJson: "{",
                validation: { path: "", expected: "object" },
            },
            outcome: expect.objectContaining({ kind: "refused" }),
        }),
        expect.objectContaining({
            input: expect.objectContaining({ kind: "adjust_framing" }),
            outcome: expect.objectContaining({ kind: "success" }),
        }),
    ]);
    expect(
        (await client.query(api.execution.conversations.get, { runId }))
            .activeTurn,
    ).toBeNull();
    expect(network).toHaveBeenCalledTimes(3);
}, 30000);

test("a slash command's exact receipt enters the next native request once, without its own generation", async () => {
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    const payloads: Array<{
        messages: Array<{ role: string; content: unknown }>;
    }> = [];
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
            payloads.push(JSON.parse(init.body));
            return reply("The current research state is available.");
        }),
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const originalSession = await t.run((ctx) =>
        ctx.db.query("piSessions").first(),
    );
    const command = await client.mutation(api.workbench.command, {
        runId,
        requestKey: "native-command",
        command: "/pause",
        expectedGeneration: 1,
    });
    expect(payloads).toHaveLength(1);
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "after-command",
        text: "Explain the current research control state.",
        delivery: "queue",
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(payloads).toHaveLength(2);
    expect(
        payloads[1]?.messages.filter(
            (m) => m.role === "user" && m.content === "/pause",
        ),
    ).toHaveLength(1);
    expect(
        payloads[1]?.messages.filter(
            (m) => m.role === "assistant" && m.content === command.text,
        ),
    ).toHaveLength(1);
    expect(
        await t.run((ctx) => ctx.db.query("piSessions").first()),
    ).toMatchObject({ _id: originalSession?._id });
    expect(await t.run((ctx) => ctx.db.get(command.messageId))).toMatchObject({
        nativeControlStatus: "recorded",
    });
    expect(
        await t.run((ctx) => ctx.db.query("agentInvocations").collect()),
    ).toHaveLength(2);
});

test("a command received during a tool reply does not deadlock the native response or trigger another generation", async () => {
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    let calls = 0;
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
            calls++;
            if (calls === 1) {
                await client.mutation(api.workbench.command, {
                    runId,
                    requestKey: "during-tool",
                    command: "/pause",
                    expectedGeneration: 1,
                });
                return toolReply("consult_run_state", {});
            }
            return reply("Research has not started.");
        }),
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(calls).toBe(2);
    const messages = await client.query(
        api.execution.conversations.listMessages,
        { runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    expect(
        messages.page.filter((m) => m.role === "assistant").map((m) => m.text),
    ).toContain("Research has not started.");
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("agentMessageDeliveries")
                .withIndex("by_run_and_native_control", (q) =>
                    q.eq("runId", runId).eq("nativeControlStatus", "pending"),
                )
                .collect(),
        ),
    ).toEqual([]);
}, 5000);

test("terminal recovery preserves a code-owned receipt instead of rewriting it as the previous model answer", async () => {
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    const payloads: Array<{
        messages: Array<{ role: string; content: unknown }>;
    }> = [];
    let controlText = "";
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
            payloads.push(JSON.parse(init.body));
            if (payloads.length === 1)
                controlText = (
                    await client.mutation(api.workbench.command, {
                        runId,
                        requestKey: "during-final",
                        command: "/pause",
                        expectedGeneration: 1,
                    })
                ).text;
            return reply(
                "A model explanation, separate from the control receipt.",
            );
        }),
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const session = await t.run((ctx) => ctx.db.query("piSessions").first());
    assert(session);
    await t.run((ctx) =>
        ctx.db.patch(session._id, {
            settledSequence: undefined,
            leaseUntil: 0,
        }),
    );
    await t.action((ctx) =>
        runPiMission(
            ctx,
            { missionId: session.missionId, expectedGeneration: 1 },
            "recover-after-control",
        ),
    );
    expect(payloads).toHaveLength(1);
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "after-control-recovery",
        text: "Recall the command outcome.",
        delivery: "queue",
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(payloads).toHaveLength(2);
    expect(
        payloads[1]?.messages.filter(
            (m) => m.role === "assistant" && m.content === controlText,
        ),
    ).toHaveLength(1);
}, 30000);

test("native restoration repairs a refusal and reads several exact fragments before publishing", async () => {
    const original =
        "Analyst boundary: switching cost remains a question, never a finding. ".repeat(
            110,
        );
    const restored: string[] = [];
    const errors: unknown[] = [];
    let stage = "initial";
    let cursor: string | undefined;
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            try {
                if (stage === "initial")
                    return reply("Ready to discuss the question.");
                if (stage === "retain")
                    return reply(
                        "Your original boundary is retained. ".repeat(260),
                    );
                if (stage === "invalid") {
                    stage = "repair";
                    return toolReply("consult_conversation", {
                        cursor: JSON.stringify({
                            cursor: "invalid",
                            offset: 1,
                        }),
                    });
                }
                const payload = JSON.parse(String(init?.body));
                const tool = payload.messages
                    .filter(
                        (message: { role: string }) => message.role === "tool",
                    )
                    .at(-1);
                assert(tool);
                const result = JSON.parse(tool.content);
                if (stage === "repair") {
                    expect(result.kind).toBe("refused");
                    stage = "read";
                    return toolReply("consult_conversation", {});
                }
                expect(result.kind).toBe("success");
                for (const entry of result.value.entries)
                    restored.push(entry.content);
                cursor = result.value.continueCursor;
                if (cursor)
                    return toolReply("consult_conversation", { cursor });
                stage = "done";
                return reply(
                    "Switching cost remains your research question. The saved program is unchanged.",
                );
            } catch (error) {
                errors.push(error);
                throw error;
            }
        }),
    );
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    stage = "retain";
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "original-material",
        delivery: "queue",
        text: original,
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const framing = await client.query(api.framing.get, { runId });
    stage = "invalid";
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "restore-original",
        delivery: "queue",
        text: "Read the original exchange without changing the program.",
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 1000);
    if (errors.length) throw errors[0];
    expect(stage).toBe("done");
    expect(restored.join("")).toContain(original);
    expect(restored.length).toBeGreaterThanOrEqual(3);
    expect(await client.query(api.framing.get, { runId })).toEqual(framing);
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "idle",
        lifecycleState: "framing",
    });
    expect(
        await t.run((ctx) => ctx.db.query("piSessions").collect()),
    ).toHaveLength(1);
    const messages = await client.query(
        api.execution.conversations.listMessages,
        { runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    const final = messages.page
        .filter((message) => message.role === "assistant")
        .at(-1)?.text;
    expect(final).toBe(
        "Switching cost remains your research question. The saved program is unchanged.",
    );
    expect(final).not.toContain("history_cursor_invalid");
});
