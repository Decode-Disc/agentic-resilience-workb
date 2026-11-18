import { api, internal } from "@convex/_generated/api";
import { runPiMission } from "@convex/integrations/piMission";
import { nodeActionGenerationDeadline } from "@convex/resourcePolicy";
import { afterEach, assert, expect, test, vi } from "vitest";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import { seedWorkbench } from "@/__tests__/setup/workbench";
import { seedWorkbenchMaterials } from "@/__tests__/setup/workbench-materials";

vi.mock("node:dns/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:dns/promises")>();
    return {
        ...actual,
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    };
});

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
                    eventBasis: { kind: "none" },
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
    expect(published).toBe("Research has not started.");
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
            nodeActionGenerationDeadline(Date.now()),
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

test("native Workbench retains its active question and recorded document dates through a real saved read", async () => {
    const f = await seedWorkbenchMaterials(1, 0, nativePiFixtureRoute);
    const instruction =
        "Keep migration costs distinct from continuity of insurer-repairer relationships. Explain the retained material without changing the saved program.";
    await f.t.run((ctx) =>
        ctx.db.patch(f.sourceId, {
            origin: "sec",
            title: "Annual filing",
            secForm: "10-K",
            publishedAt: 1771891200000,
        }),
    );
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "conversational-answer",
        text: instruction,
        delivery: "queue",
    });
    const active = await f.start();
    assert(active);
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    let calls = 0;
    const requests: string[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
            requests.push(init.body);
            calls++;
            if (calls === 1)
                return toolReply("search_available_material", {
                    sourceId: f.sourceId,
                    query: "workflow",
                });
            if (calls === 2) {
                return reply(
                    "The filing describes workflow software; those passages do not establish the effects of changing platforms.",
                );
            }
            throw new Error("Unexpected generation beyond the saved read");
        }),
    );
    await f.t.action((ctx) =>
        runPiMission(
            ctx,
            { missionId: active.missionId, expectedGeneration: 1 },
            "documentary-answer-input",
            nodeActionGenerationDeadline(Date.now()),
        ),
    );
    expect(calls).toBe(2);
    for (const request of requests) {
        const payload = JSON.parse(request);
        expect(payload.messages).toContainEqual(
            expect.objectContaining({ role: "user", content: instruction }),
        );
    }
    const payload = JSON.parse(requests[1] ?? "{}");
    const result = payload.messages
        .filter((message: { role: string }) => message.role === "tool")
        .at(-1);
    const value = JSON.parse(result.content).value;
    expect(value.document).toEqual({
        title: "Annual filing",
        publishedAt: 1771891200000,
        date: "2026-02-24T00:00:00.000Z",
        dateKind: "filing",
        form: "10-K",
    });
    expect(value.passages.length).toBeGreaterThan(0);
    const turn = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(active.missionId);
        assert(mission?.conversationTurnId);
        return ctx.db.get(mission.conversationTurnId);
    });
    expect(turn?.responseControl).toMatchObject({
        policy: { enabled: false },
        checks: [],
    });
});

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
                ? toolReply("adjust_framing", {
                      content,
                      eventBasis: { kind: "none" },
                  })
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
        tools.find((tool) => tool.name.includes("verify_public_context"))
            ?.parameters.properties,
    ).toEqual({ query: expect.any(Object) });
    expect(
        tools.find((tool) => tool.name.includes("adjust_framing"))?.parameters
            .properties,
    ).not.toHaveProperty("expectedRevision");
    expect(
        tools.some((tool) => tool.name.includes("consult_prepared_material")),
    ).toBe(false);
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
                    eventBasis: { kind: "none" },
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
                    eventBasis: { kind: "none" },
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
                eventBasis: { kind: "none" },
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
            nodeActionGenerationDeadline(Date.now()),
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

const nvidia = {
    cik: "1045810",
    legalName: "NVIDIA Corporation",
    ticker: "NVDA",
    exchange: "NASDAQ",
};
const h20Program = {
    scope: "Examine the resilience of NVIDIA's data-center business around the April 2025 H20 export-licensing episode.",
    questions: [
        {
            id: "exposure",
            shortLabel: "China value at stake",
            text: "How large is the revenue and profit pool exposed to the China licensing regime?",
            rationale:
                "Measure how concentrated value capture is in the licensed China transaction.",
        },
    ],
};

test("an unresolved crisis saves a neutral program and a later analyst confirmation can scope it to H20", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
        undefined,
        "will it survive after the recent crisis ?",
        nvidia,
    );
    const before = await client.query(api.framing.get, { runId });
    assert(before);
    const confirmation = "Yes, I mean the April 2025 H20 licensing episode.";
    const revisions: (typeof before._id | undefined)[] = [];
    let call = 0;
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
            if (call++)
                revisions.push(
                    (await client.query(api.framing.get, { runId }))?._id,
                );
            if (call === 1)
                return toolReply("adjust_framing", { content: h20Program });
            if (call === 2)
                return toolReply("adjust_framing", {
                    content: h20Program,
                    eventBasis: {
                        kind: "analyst",
                        excerpt: "a $5.5B charge",
                    },
                });
            if (call === 3)
                return toolReply("adjust_framing", {
                    content: h20Program,
                    eventBasis: { kind: "open" },
                });
            if (call === 4)
                return reply("Did you mean the H20 licensing episode?");
            if (call === 5)
                return toolReply("adjust_framing", {
                    content: h20Program,
                    eventBasis: { kind: "analyst", excerpt: confirmation },
                });
            return reply(
                "The proposed program now studies the H20 licensing episode.",
            );
        }),
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(revisions.slice(0, 2)).toEqual([before._id, before._id]);
    const open = await client.query(api.framing.get, { runId });
    expect(open).toMatchObject({
        revision: before.revision + 1,
        eventBasis: { kind: "open" },
    });
    expect
        .soft(open?.content.scope)
        .toMatch(/NVIDIA.*resilience|resilience.*NVIDIA/i);
    expect.soft(open?.content.questions.length).toBeGreaterThan(0);
    expect.soft(JSON.stringify(open?.content)).not.toMatch(/H20|China|licens/i);
    const messageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId,
            requestKey: "confirm-h20",
            text: confirmation,
            delivery: "queue",
        },
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: before.revision + 2,
        content: h20Program,
        eventBasis: { kind: "analyst", excerpt: confirmation, messageId },
    });
    const history = await client.query(
        api.execution.conversations.listMessages,
        {
            runId,
            paginationOpts: { numItems: 20, cursor: null },
        },
    );
    expect(
        history.page
            .filter(({ role }) => role === "assistant")
            .map(({ text }) => text),
    ).toEqual(
        expect.arrayContaining([
            "Did you mean the H20 licensing episode?",
            "The proposed program now studies the H20 licensing episode.",
        ]),
    );
}, 30000);

test.each([
    "undated",
    "wrong lookup",
] as const)("the archived H20 proposal can recover from a %s refusal using its existing lookup", async (refusal) => {
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubEnv("EXA_API_KEY", "local-fixture-only");
    vi.stubEnv(
        "WORKBENCH_PUBLIC_CONTEXT_ALLOWANCE",
        '{"searches":1,"readings":1}',
    );
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
        undefined,
        "How should I investigate the resilience of NVIDIA’s data-center business after the April 2025 H20 licensing episode?",
        nvidia,
    );
    // Relevant excerpts and order from the archived NVIDIA lot's request 6.
    const documents = [
        {
            id: "filing",
            url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581025000082/nvda-20250409.htm",
            text: "## WASHINGTON, DC 20549\n\n______________ FORM 8-K CURRENT REPORT PURSUANT TO SECTION 13 OR 15(d) OF THE SECURITIES EXCHANGE ACT OF 1934 Date of Report (Date of earliest event reported): April 9, 2025 NVIDIA CORPORATION",
        },
        {
            id: "news",
            url: "https://www.reuters.com/technology/nvidia-expects-up-55-billion-charge-first-quarter-2025-04-15/?amp=",
            publishedDate: "2025-04-15T22:53:36Z",
            text: "Nvidia says it faces $5.5 billion charge as US restricts chip exports to China.",
        },
        {
            id: "release",
            url: "https://investor.nvidia.com/news/press-release-details/2025/NVIDIA-Announces-Financial-Results-for-First-Quarter-Fiscal-2026/default.aspx",
            text: "### NVIDIA Announces Financial Results for First Quarter Fiscal 2026\n\n May 28, 2025 \n\nSANTA CLARA, Calif., May 28, 2025 (GLOBE NEWSWIRE) -- NVIDIA (NASDAQ: NVDA) today reported revenue for the first quarter ended April 27, 2025.\n\nOn April 9, 2025, NVIDIA was informed by the U.S. government that a license is required for exports of its H20 products into the China market.",
        },
        {
            id: "letter",
            url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581025000192/filename1.htm",
            text: "Document\n\nJuly 31, 2025\n\n100 F Street, N.E.\n\nWashington, D.C. 20549",
        },
    ];
    let searched = false;
    let consulted = false;
    let proposed = false;
    let corrected = false;
    const finalText =
        "The program examines NVIDIA’s resilience after the April 9 H20 notification using the SEC report and NVIDIA’s May 28 release.";
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input, init) => {
            const url = String(input);
            if (url === "https://api.exa.ai/search")
                return Response.json({
                    results: documents.map(({ id, url, publishedDate }) => ({
                        id,
                        url,
                        title: id,
                        publishedDate,
                    })),
                    costDollars: { total: 0.01 },
                });
            if (url === "https://api.exa.ai/contents")
                return Response.json({
                    results: documents.map(({ id, url, text }) => ({
                        id,
                        url,
                        text,
                    })),
                    costDollars: { total: 0.01 },
                });
            expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
            if (!searched) {
                searched = true;
                return toolReply("verify_public_context", {
                    query: "NVIDIA H20 April 2025 licensing episode",
                });
            }
            if (refusal === "wrong lookup" && !consulted) {
                consulted = true;
                return toolReply("consult_mission_state", {});
            }
            const operations = await t.run((ctx) =>
                ctx.db.query("agentOperationRequests").collect(),
            );
            const lookup = operations.find(
                ({ input }) => input.kind === "verify_public_context",
            );
            assert(lookup?.outcome?.kind === "success");
            const basis = {
                kind: "public",
                label: "April 2025 H20 export-license requirement",
                lookupRequestId: lookup._id,
                referenceIndexes: [0, 2],
            };
            if (!proposed) {
                proposed = true;
                const { references } = JSON.parse(lookup.outcome.valueJson);
                expect
                    .soft(references[0])
                    .toMatchObject({ eventAt: Date.UTC(2025, 3, 9) });
                expect.soft(references[0]).not.toHaveProperty("publishedAt");
                expect
                    .soft(references[2])
                    .toMatchObject({ publishedAt: Date.UTC(2025, 4, 28) });
                expect.soft(references[2]).not.toHaveProperty("eventAt");
                const other = operations.find(
                    ({ input }) => input.kind === "consult_mission_state",
                );
                if (refusal === "wrong lookup") assert(other);
                return toolReply("adjust_framing", {
                    content: h20Program,
                    eventBasis:
                        refusal === "undated"
                            ? { ...basis, referenceIndexes: [3] }
                            : { ...basis, lookupRequestId: other?._id },
                });
            }
            if (!corrected) {
                corrected = true;
                const messages = JSON.parse(init?.body as string).messages as {
                    role: string;
                    content?: string;
                }[];
                const diagnostic = JSON.parse(
                    messages.filter(({ role }) => role === "tool").at(-1)
                        ?.content ?? "{}",
                );
                expect.soft(diagnostic).toMatchObject({
                    kind: "refused",
                    code:
                        refusal === "undated"
                            ? "framing_public_reference_undated"
                            : "framing_public_lookup_invalid",
                    validation: {
                        path:
                            refusal === "undated"
                                ? "eventBasis.referenceIndexes"
                                : "eventBasis.lookupRequestId",
                    },
                });
                expect
                    .soft(diagnostic.diagnostic)
                    .toMatch(
                        refusal === "undated"
                            ? /keep.*lookupRequestId/i
                            : /verify_public_context/i,
                    );
                if (refusal === "undated")
                    expect
                        .soft(diagnostic.validation?.expected ?? "")
                        .toContain(lookup._id);
                expect(
                    await client.query(api.framing.get, { runId }),
                ).toMatchObject({
                    revision: 1,
                    content: { scope: "", questions: [] },
                });
                return toolReply("adjust_framing", {
                    content: h20Program,
                    eventBasis: basis,
                });
            }
            return reply(finalText);
        }),
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 2,
        content: h20Program,
        eventBasis: { kind: "public", referenceIndexes: [0, 2] },
    });
    const history = await client.query(
        api.execution.conversations.listMessages,
        {
            runId,
            paginationOpts: { numItems: 20, cursor: null },
        },
    );
    expect(history.page.find(({ role }) => role === "assistant")?.text).toBe(
        finalText,
    );
    const receipts = await t.run((ctx) =>
        ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .collect(),
    );
    expect(
        receipts
            .filter(({ service }) => service === "exa")
            .map(({ operation, status }) => [operation, status]),
    ).toEqual([
        ["framing_context_search", "succeeded"],
        ["framing_context_read", "succeeded"],
    ]);
}, 30000);

test("Workbench reads public context before Start and pins a dated passage to the saved scope", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubEnv("EXA_API_KEY", "local-fixture-only");
    vi.stubEnv(
        "WORKBENCH_PUBLIC_CONTEXT_ALLOWANCE",
        JSON.stringify({ searches: 1, readings: 1 }),
    );
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
        undefined,
        "Will it survive after the recent crisis?",
    );
    const url = "https://93.184.216.34/report";
    const excerpt = "Supply restrictions took effect in April 2025.";
    const publishedDate = "2025-04-16T00:00:00Z";
    const dispatches: string[] = [];
    let modelCalls = 0;
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input, init) => {
            const endpoint = String(input);
            if (endpoint === "https://api.exa.ai/search") {
                dispatches.push(endpoint);
                return Response.json({
                    results: [
                        {
                            id: "read",
                            url,
                            title: "Dated report",
                            publishedDate,
                        },
                        {
                            id: "unread",
                            url: "https://93.184.216.34/unread",
                            title: "Unread lead",
                            publishedDate,
                        },
                        {
                            id: "private",
                            url: "https://127.0.0.1/private",
                            title: "Private lead",
                            publishedDate,
                        },
                    ],
                    costDollars: { total: 0.01 },
                });
            }
            if (endpoint === "https://api.exa.ai/contents") {
                expect(JSON.stringify(init?.body)).not.toContain("127.0.0.1");
                dispatches.push(endpoint);
                return Response.json({
                    results: [{ id: "read", url, text: excerpt }],
                    costDollars: { total: 0.01 },
                });
            }
            if (modelCalls++ === 0)
                return toolReply("verify_public_context", {
                    query: "recent supply restriction event",
                });
            if (modelCalls === 2) {
                const observations = await t.run((ctx) =>
                    ctx.db.query("agentOperationRequests").collect(),
                );
                const observed = observations.find(
                    (item) => item.input.kind === "verify_public_context",
                );
                assert(
                    observed?.outcome?.kind === "success",
                    JSON.stringify(observed),
                );
                expect(
                    await t.action(internal.execution.operations.dispatch, {
                        requestId: observed._id,
                        expectedGeneration: 1,
                    }),
                ).toEqual(observed.outcome);
                expect(JSON.parse(observed.outcome.valueJson)).toEqual({
                    status: "observed",
                    references: [
                        {
                            url,
                            excerpt,
                            publisher: "93.184.216.34",
                            publishedAt: Date.parse(publishedDate),
                        },
                    ],
                });
                return toolReply("adjust_framing", {
                    content: {
                        scope: "April 2025 supply restrictions",
                        questions: [
                            {
                                id: "supply",
                                text: "What constrained supply?",
                                shortLabel: "Supply",
                                rationale: "Identify exposed dependencies.",
                            },
                        ],
                    },
                    eventBasis: {
                        kind: "public",
                        label: "April 2025 supply restrictions",
                        lookupRequestId: observed._id,
                        referenceIndexes: [0],
                    },
                });
            }
            return reply(
                "The proposed program examines supply constraints after the April restrictions.",
            );
        }),
    );
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(dispatches).toEqual([
        "https://api.exa.ai/search",
        "https://api.exa.ai/contents",
    ]);
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run?.researchStartedAt).toBeUndefined();
    expect(run?.sourcePreparationId).toBeUndefined();
    const saved = await client.query(api.framing.get, { runId });
    assert(saved?.eventBasis?.kind === "public");
    await client.mutation(api.framing.save, {
        runId,
        expectedRevision: saved.revision,
        requestKey: "question-refinement",
        content: {
            ...saved.content,
            questions: saved.content.questions.map((question) => ({
                ...question,
                text: "Which dependencies constrained supply?",
            })),
        },
    });
    expect(
        (await client.query(api.framing.get, { runId }))?.eventBasis,
    ).toEqual(saved.eventBasis);
    const receipts = await t.run((ctx) =>
        ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .collect(),
    );
    expect(
        receipts.filter(({ operation }) =>
            operation.startsWith("framing_context_"),
        ),
    ).toEqual([
        expect.objectContaining({
            operation: "framing_context_search",
            status: "succeeded",
        }),
        expect.objectContaining({
            operation: "framing_context_read",
            status: "succeeded",
        }),
    ]);
}, 30000);

test.each([
    "search",
    "contents",
] as const)("an edit during framing %s fences stale adoption and retains known work", async (editedDuring) => {
    vi.stubEnv("OPENROUTER_API_KEY", "local-fixture-only");
    vi.stubEnv("EXA_API_KEY", "local-fixture-only");
    vi.stubEnv(
        "WORKBENCH_PUBLIC_CONTEXT_ALLOWANCE",
        JSON.stringify({ searches: 1, readings: 1 }),
    );
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    const analystScope = { scope: "Analyst-selected workflow", questions: [] };
    let modelCalls = 0;
    const providerEndpoints: string[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input) => {
            const url = String(input);
            if (url.startsWith("https://api.exa.ai/")) {
                providerEndpoints.push(url);
                if (url.endsWith(editedDuring)) {
                    const before = await client.query(api.framing.get, {
                        runId,
                    });
                    assert(before);
                    await client.mutation(api.framing.save, {
                        runId,
                        expectedRevision: before.revision,
                        requestKey: "edit-during-lookup",
                        content: analystScope,
                    });
                }
                if (url.endsWith("/contents"))
                    return Response.json({
                        results: [
                            {
                                id: "lead",
                                url: "https://93.184.216.34/report",
                                text: "The exact observed passage.",
                            },
                        ],
                        costDollars: { total: 0.01 },
                    });
                return Response.json({
                    results: [
                        {
                            id: "lead",
                            url: "https://93.184.216.34/report",
                            title: "Dated report",
                            publishedDate: "2025-04-16",
                        },
                    ],
                    costDollars: { total: 0.01 },
                });
            }
            if (modelCalls++ === 0)
                return toolReply("verify_public_context", {
                    query: "recent supply restrictions",
                });
            return reply("The analyst-selected workflow is in the program.");
        }),
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(providerEndpoints).toEqual([
        "https://api.exa.ai/search",
        ...(editedDuring === "contents" ? ["https://api.exa.ai/contents"] : []),
    ]);
    expect((await client.query(api.framing.get, { runId }))?.content).toEqual(
        analystScope,
    );
    const [operations, receipts] = await t.run((ctx) =>
        Promise.all([
            ctx.db.query("agentOperationRequests").collect(),
            ctx.db
                .query("providerCalls")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .collect(),
        ]),
    );
    const lookup = operations.find(
        ({ input }) => input.kind === "verify_public_context",
    );
    if (editedDuring === "contents") {
        assert(lookup?.outcome?.kind === "success");
        expect(JSON.parse(lookup.outcome.valueJson)).toMatchObject({
            references: [{ excerpt: "The exact observed passage." }],
        });
        expect(lookup.adoptionRefusalCode).toBe("stale_instructions");
    } else {
        expect(lookup).toMatchObject({
            outcome: { kind: "unavailable", code: "stale_instructions" },
        });
    }
    expect(
        receipts.find(
            ({ operation }) => operation === "framing_context_search",
        ),
    ).toMatchObject({
        status: "succeeded",
        dispatchOutcome: "response_received",
        reportedCost: 0.01,
    });
}, 30000);
