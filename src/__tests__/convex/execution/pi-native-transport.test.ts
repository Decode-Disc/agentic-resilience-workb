import { api, internal } from "@convex/_generated/api";
import { executionError } from "@convex/execution/errors";
import type { ModelRoute } from "@convex/integrations/modelRouting";
import { runPiMission } from "@convex/integrations/piMission";
import { nodeActionGenerationDeadline } from "@convex/resourcePolicy";
import { getFunctionName } from "convex/server";
import { afterEach, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test("the compaction adoption owner refuses a retained blocked response", async () => {
    const f = await fixture();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "refused-compaction",
        purpose: "compaction",
        provenance: "live",
    });
    if (begun.kind !== "ready")
        throw new Error("Expected compaction invocation");
    const args = { invocationId: begun.invocationId, expectedGeneration: 4 };
    await f.t.mutation(internal.execution.invocations.retainOutput, {
        ...args,
        responseJson: JSON.stringify({
            kind: "blocked",
            code: "invalid_output",
        }),
    });
    await expect(
        f.t.mutation(internal.execution.piControl.finishAuxiliary, args),
    ).rejects.toMatchObject({ data: { code: "invalid_output" } });
    expect(
        await f.t.run((ctx) => ctx.db.get(begun.invocationId)),
    ).not.toMatchObject({ status: "returned" });
});

test.each([
    false,
    true,
])("a large incomplete native reply retains its receipt and exact recovery bytes (compaction=%s)", async (compaction) => {
    const text = "Incomplete observed summary. ".repeat(21000);
    const network = vi.fn(async () =>
        reply(text, "length", {
            prompt_tokens: 10,
            completion_tokens: 6144,
            total_tokens: 6154,
            cost: 0.01,
        }),
    );
    vi.stubGlobal("fetch", network);
    const f = await fixture();
    if (compaction) {
        const { seedPiHistory } = await import("@/__tests__/setup/pi-mission");
        await seedPiHistory(f.t, f.missionId, 4, 8, 56000);
        await f.t.mutation(internal.execution.missions.resume, {
            missionId: f.missionId,
            expectedGeneration: 4,
            simulation: false,
        });
    }
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const state = await f.t.run(async (ctx) => ({
        receipts: await ctx.db.query("providerCalls").collect(),
        invocations: await ctx.db.query("agentInvocations").collect(),
        payloads: await ctx.db.query("agentInvocationPayloads").collect(),
    }));
    expect(network).toHaveBeenCalledOnce();
    expect(state.receipts).toEqual([
        expect.objectContaining({
            status: "failed",
            reportedCost: 0.01,
            dispatchOutcome: "response_received",
        }),
    ]);
    expect(
        state.payloads.some(
            (payload) =>
                payload.part === "reply" && payload.state === "complete",
        ),
    ).toBe(true);
    const invocation = state.invocations.find(
        (item) => item.providerCallId === state.receipts[0]?._id,
    );
    if (!invocation) throw new Error("Expected observed invocation");
    if (compaction) expect(invocation.status).not.toBe("returned");
    const { invocationRawOutputJson } = await import(
        "@convex/execution/journal"
    );
    const restored = await f.t.run((ctx) =>
        invocationRawOutputJson(ctx, invocation),
    );
    expect(restored?.includes(text)).toBe(true);
    expect(invocation.rawOutputJson).toBeUndefined();
    await f.t.action(internal.execution.piWorker.run, {
        missionId: f.missionId,
        expectedGeneration: 4,
        token: "expired-wake",
    });
    expect(network).toHaveBeenCalledOnce();
}, 30000);

function reply(
    completion: object | string,
    finishReason = "stop",
    usage: Record<string, unknown> = {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
    },
    metadata: Record<string, unknown> = {},
) {
    return new Response(
        `data: ${JSON.stringify({ ...metadata, id: "fixture-native", choices: [{ index: 0, delta: { role: "assistant", content: typeof completion === "string" ? completion : JSON.stringify(completion) }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ ...metadata, id: "fixture-native", choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
    );
}

test("native receipts distinguish requested identity from resolved model, upstream provider and reported cost", async () => {
    let captureId: string;
    const network = vi.fn(async () =>
        reply(
            { kind: "complete", captureIds: [captureId] },
            "stop",
            {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
                cost: 0.1234,
            },
            { model: "resolved/model-revision", provider: "resolved-upstream" },
        ),
    );
    vi.stubGlobal("fetch", network);
    const f = await fixture();
    captureId = f.captureId;
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const { nativePiFixtureRoute } = await import(
        "@/__tests__/setup/pi-native"
    );
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([
        expect.objectContaining({
            status: "succeeded",
            reportedCost: 0.1234,
            usage: expect.objectContaining({
                model: nativePiFixtureRoute.model,
                resolvedModel: "resolved/model-revision",
                provider: "resolved-upstream",
            }),
        }),
    ]);
    expect(network).toHaveBeenCalledOnce();
}, 30000);

test.each([
    "low",
    "high",
    "max",
    "none",
] as const)("native Pi dispatch preserves the pinned %s effort in its HTTP request", async (reasoningEffort) => {
    let captureId: string;
    let body: Record<string, unknown> | undefined;
    const network = vi.fn<typeof fetch>(async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return reply({ kind: "complete", captureIds: [captureId] });
    });
    vi.stubGlobal("fetch", network);
    const f = await fixture(reasoningEffort);
    captureId = f.captureId;
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(body).toMatchObject({
        reasoning: {
            enabled: reasoningEffort !== "none",
            effort: reasoningEffort,
            exclude: true,
        },
        max_completion_tokens: 8192,
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "completed",
        reasoningEffort,
    });
    expect(network).toHaveBeenCalledOnce();
}, 30000);

async function fixture(reasoningEffort?: ModelRoute["reasoningEffort"]) {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const f = await seedInspectedEvidence();
    await installModel(
        f.t,
        { ...nativePiFixtureRoute, reasoningEffort },
        "saved_material_inspection",
        reasoningEffort
            ? {
                  reasoningEfforts: [reasoningEffort],
                  reasoningDefault: reasoningEffort,
              }
            : {},
    );
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.args.runId,
        corpusRevisionId: f.args.corpusRevisionId,
        expectedGeneration: 4,
        definitionId: "saved_material_inspection_v1",
        requestKey: "native-transport",
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId,
            expectedGeneration: 4,
            cause: "retained-reading",
            input: {
                kind: "read_in_context",
                sourceId: f.args.sourceId,
                passageOrder: 0,
            },
        },
    );
    expect(
        (
            await f.t.action(internal.execution.operations.dispatch, {
                requestId,
                expectedGeneration: 4,
            })
        ).kind,
    ).toBe("success");
    await f.t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
        simulation: false,
    });
    return { ...f, missionId };
}

test.each([
    { repeat: false, format: "malformed" },
    { repeat: true, format: "malformed" },
    { repeat: false, format: "wrong_schema" },
    { repeat: true, format: "wrong_schema" },
])("native Pi corrects received completions ($format, repeated=$repeat)", async ({
    repeat,
    format,
}) => {
    const malformed =
        'Preparation is finished.\n```json\n{"kind":"complete","captureIds":[]}\n```';
    const invalid =
        format === "malformed"
            ? malformed
            : JSON.stringify({ kind: "complete", text: "Finished." });
    const code =
        format === "malformed" ? "invalid_output" : "invalid_completion";
    let f: Awaited<ReturnType<typeof fixture>>;
    const bodies: { messages: { content: unknown }[] }[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            bodies.push(JSON.parse(String(init?.body)));
            return reply(
                repeat || bodies.length === 1
                    ? invalid
                    : { kind: "complete", captureIds: [f.captureId] },
                "stop",
                {
                    prompt_tokens: 10,
                    completion_tokens: 5,
                    total_tokens: 15,
                    cost: 0.001,
                },
            );
        }),
    );
    f = await fixture();
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const observed = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(f.missionId),
        calls: await ctx.db.query("providerCalls").collect(),
        invocations: await ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
            .collect(),
        requests: await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
            .collect(),
    }));
    expect(observed.mission).toMatchObject({
        status: repeat ? "blocked" : "completed",
        ...(repeat ? { blockCode: "repetition_stop", noProgressTurns: 3 } : {}),
    });
    expect(observed.calls).toHaveLength(repeat ? 3 : 2);
    expect(observed.calls[0]).toMatchObject({
        status: format === "malformed" ? "failed" : "succeeded",
        dispatchOutcome: "response_received",
        reportedCost: 0.001,
        ...(format === "malformed"
            ? { errorCode: code, diagnostic: { output: invalid } }
            : {}),
    });
    expect(
        observed.calls.reduce((sum, call) => sum + (call.reportedCost ?? 0), 0),
    ).toBe(repeat ? 0.003 : 0.002);
    expect(observed.invocations).toHaveLength(repeat ? 3 : 2);
    expect(observed.invocations[0]).toMatchObject({
        correction: { code },
        blockCode: "completion_correction_required",
    });
    expect(JSON.stringify(bodies[1]?.messages)).toContain(
        format === "malformed" ? "Preparation is finished." : "Finished.",
    );
    expect(JSON.stringify(bodies[1]?.messages)).toContain(code);
    expect(JSON.stringify(bodies[1]?.messages)).toContain(f.captureId);
    expect(observed.requests).toHaveLength(1);
    expect(observed.requests[0]?.input.kind).toBe("read_in_context");
}, 30000);

test.each([
    false,
    true,
])("native Pi delivers first completion feedback after two non-progress consultations (repeat=%s)", async (repeat) => {
    const malformed =
        'Preparation is finished.\n```json\n{"kind":"complete","captureIds":[]}\n```';
    let f: Awaited<ReturnType<typeof fixture>>;
    const bodies: { messages: { content: unknown }[]; tools: unknown[] }[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            bodies.push(JSON.parse(String(init?.body)));
            const usage = {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
                cost: 0.001,
            };
            if (bodies.length <= 2) {
                const name = "consult_run_state";
                return new Response(
                    `data: ${JSON.stringify({ id: name, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: `consult-${bodies.length}`, type: "function", function: { name, arguments: "{}" } }] }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: name, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage })}\n\ndata: [DONE]\n\n`,
                    { headers: { "content-type": "text/event-stream" } },
                );
            }
            if (bodies.length === 3) {
                expect(
                    (await f.t.run((ctx) => ctx.db.get(f.missionId)))
                        ?.noProgressTurns,
                ).toBe(2);
            }
            return reply(
                repeat || bodies.length === 3
                    ? malformed
                    : { kind: "complete", captureIds: [f.captureId] },
                "stop",
                usage,
            );
        }),
    );
    f = await fixture();
    const before = await f.t.run((ctx) => ctx.db.get(f.missionId));
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const state = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(f.missionId),
        receipts: await ctx.db.query("providerCalls").collect(),
        invocations: await ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
            .collect(),
    }));
    const rejected = state.invocations.find((i) => i.correction);
    expect(rejected?.blockCode).toBe("completion_correction_required");
    expect(state.mission).toMatchObject({
        status: repeat ? "blocked" : "completed",
        deadlineAt: before?.deadlineAt,
        generation: before?.generation,
        progressKeys: before?.progressKeys,
        noProgressTurns: repeat ? 3 : 2,
        ...(repeat
            ? { blockCode: "repetition_stop" }
            : {
                  result: {
                      kind: "saved_material_inspection_v1",
                      captureIds: [f.captureId],
                  },
              }),
    });
    expect(state.receipts).toHaveLength(4);
    expect(state.receipts[2]).toMatchObject({
        status: "failed",
        errorCode: "invalid_output",
        dispatchOutcome: "response_received",
        reportedCost: 0.001,
        diagnostic: { output: malformed },
    });
    expect(state.receipts[3]).toMatchObject({
        status: repeat ? "failed" : "succeeded",
        reportedCost: 0.001,
    });
    expect(rejected).toMatchObject({ correction: { code: "invalid_output" } });
    expect(JSON.stringify(bodies[3]?.messages)).toContain(
        "Preparation is finished.",
    );
    expect(JSON.stringify(bodies[3]?.messages)).toContain(
        "without surrounding prose or Markdown fences",
    );
    expect(JSON.stringify(bodies[3]?.messages)).toContain(f.captureId);
    expect(bodies[3]?.tools).toEqual(bodies[2]?.tools);
}, 30000);

test("a structured mission receives an original-argument refusal and corrects without executing repaired JSON", async () => {
    let captureId: string;
    const original = '{"sourceId":';
    const network = vi.fn(async () =>
        network.mock.calls.length === 1
            ? new Response(
                  `data: ${JSON.stringify({ id: "invalid-tool", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "bad-call", type: "function", function: { name: "read_in_context", arguments: original } }] }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "invalid-tool", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
                  { headers: { "content-type": "text/event-stream" } },
              )
            : reply({ kind: "complete", captureIds: [captureId] }),
    );
    vi.stubGlobal("fetch", network);
    const f = await fixture();
    captureId = f.captureId;
    const existing = new Set(
        (
            await f.t.run((ctx) =>
                ctx.db
                    .query("agentOperationRequests")
                    .withIndex("by_mission", (q) =>
                        q.eq("missionId", f.missionId),
                    )
                    .collect(),
            )
        ).map((r) => r._id),
    );
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const result = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(f.missionId),
        requests: await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
            .collect(),
        receipts: await ctx.db.query("providerCalls").collect(),
    }));
    expect(result.mission?.status).toBe("completed");
    expect(result.requests.filter((r) => r.input.kind === "invalid")).toEqual([
        expect.objectContaining({
            input: expect.objectContaining({
                kind: "invalid",
                inputJson: original,
            }),
            outcome: expect.objectContaining({ kind: "refused" }),
        }),
    ]);
    expect(
        result.requests.some(
            (r) => !existing.has(r._id) && r.input.kind === "read_in_context",
        ),
    ).toBe(false);
    expect(result.receipts).toHaveLength(2);
    expect(network).toHaveBeenCalledTimes(2);
}, 30000);

test.each([
    "literal newline",
    "non-JSON whitespace",
])("SDK-repaired %s JSON is refused before effect adoption and corrected through the native loop", async (malformation) => {
    let original = "";
    let current: Awaited<ReturnType<typeof fixture>>;
    const network = vi.fn(
        async (): Promise<Response> =>
            network.mock.calls.length === 1
                ? new Response(
                      [
                          `data: ${JSON.stringify({ id: "repaired-tool", choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "NON_OBSERVABLE_REASONING", tool_calls: [{ index: 0, id: "repair-call", type: "function", function: { name: "search_available_material", arguments: original } }] }, finish_reason: null }] })}`,
                          `data: ${JSON.stringify({ id: "repaired-tool", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}`,
                          "data: [DONE]",
                          "",
                      ].join("\n\n"),
                      { headers: { "content-type": "text/event-stream" } },
                  )
                : reply({ kind: "complete", captureIds: [current.captureId] }),
    );
    vi.stubGlobal("fetch", network);
    current = await fixture();
    original =
        malformation === "literal newline"
            ? `{ "sourceId": "${current.args.sourceId}", "query": "line\nline" }`
            : `\u00a0${JSON.stringify({ sourceId: current.args.sourceId, query: "line" })}\u00a0`;
    await current.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const observed = await current.t.run(async (ctx) => ({
        calls: await ctx.db.query("providerCalls").collect(),
        replies: (
            await ctx.db.query("agentInvocationPayloads").collect()
        ).filter((p) => p.part === "reply"),
        requests: await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) =>
                q.eq("missionId", current.missionId),
            )
            .collect(),
        mission: await ctx.db.get(current.missionId),
    }));
    expect(observed.calls.map((call) => call.status)).toEqual([
        "succeeded",
        "succeeded",
    ]);
    const payload = observed.replies[0];
    if (payload?.state !== "complete" || payload.json === undefined)
        throw new Error("Expected complete observable reply");
    const content = JSON.parse(payload.json).content;
    expect(content).toEqual([
        expect.objectContaining({
            id: "repair-call",
            rawArguments: original,
            arguments:
                malformation === "literal newline"
                    ? { sourceId: current.args.sourceId, query: "line\nline" }
                    : {},
            argumentsError: expect.any(String),
        }),
    ]);
    expect(payload.json).not.toContain("NON_OBSERVABLE_REASONING");
    expect(observed.requests.filter((r) => r.input.kind === "invalid")).toEqual(
        [
            expect.objectContaining({
                input: expect.objectContaining({ inputJson: original }),
                outcome: expect.objectContaining({ kind: "refused" }),
            }),
        ],
    );
    expect(observed.mission).toMatchObject({
        status: "completed",
    });
    expect(network).toHaveBeenCalledTimes(2);
}, 30000);

test.each([
    0, 70_000,
])("valid interleaved argument fragments retain their exact JSON and complete through the native tool loop (%i leading space bytes)", async (leadingSpaces) => {
    let current: Awaited<ReturnType<typeof fixture>>;
    let originals: string[] = [];
    const chunks = (tool_calls: object[]) => ({
        id: "fragmented-native",
        choices: [{ index: 0, delta: { tool_calls }, finish_reason: null }],
    });
    const network = vi.fn(async (): Promise<Response> => {
        if (network.mock.calls.length > 1)
            return reply({ kind: "complete", captureIds: [current.captureId] });
        const first = originals[0];
        const second = originals[1];
        if (first === undefined || second === undefined)
            throw new Error("Expected original argument text");
        const events = [
            chunks([
                {
                    index: 4,
                    type: "function",
                    function: {
                        name: "search_available_material",
                        arguments: first.slice(0, 10),
                    },
                },
            ]),
            chunks([
                {
                    index: 2,
                    id: "second-call",
                    type: "function",
                    function: {
                        name: "search_available_material",
                        arguments: second.slice(0, 20),
                    },
                },
            ]),
            chunks([
                {
                    index: 4,
                    id: "first-call",
                    function: { arguments: first.slice(10, 25) },
                },
                { index: 2, function: { arguments: second.slice(20) } },
            ]),
            chunks([
                { id: "first-call", function: { arguments: first.slice(25) } },
            ]),
            {
                id: "fragmented-native",
                choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
            },
        ];
        return new Response(
            [
                ...events.map((event) => `data: ${JSON.stringify(event)}`),
                "data: [DONE]",
                "",
            ].join("\n\n"),
            { headers: { "content-type": "text/event-stream" } },
        );
    });
    vi.stubGlobal("fetch", network);
    current = await fixture();
    originals = [
        `${" ".repeat(leadingSpaces)}\r\n { "query": "line\\nline", "sourceId": "${current.args.sourceId}" } \t`,
        `{ "sourceId": "${current.args.sourceId}", "query": "résilience" }`,
    ];
    await current.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const observed = await current.t.run(async (ctx) => ({
        calls: await ctx.db.query("providerCalls").collect(),
        replies: (
            await ctx.db.query("agentInvocationPayloads").collect()
        ).filter((p) => p.part === "reply"),
        requests: await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) =>
                q.eq("missionId", current.missionId),
            )
            .collect(),
        mission: await ctx.db.get(current.missionId),
    }));
    const firstReply = observed.replies[0];
    if (firstReply?.state !== "complete" || firstReply.json === undefined)
        throw new Error("Expected complete observable reply");
    expect(JSON.parse(firstReply.json).content).toEqual([
        {
            type: "toolCall",
            id: "first-call",
            name: "search_available_material",
            rawArguments: originals[0],
            arguments: { sourceId: current.args.sourceId, query: "line\nline" },
        },
        {
            type: "toolCall",
            id: "second-call",
            name: "search_available_material",
            rawArguments: originals[1],
            arguments: { sourceId: current.args.sourceId, query: "résilience" },
        },
    ]);
    expect(observed.calls.map((c) => c.status)).toEqual([
        "succeeded",
        "succeeded",
    ]);
    expect(
        observed.requests.filter(
            (r) => r.input.kind === "search_available_material",
        ),
    ).toEqual([
        expect.objectContaining({
            status: "completed",
            outcome: expect.objectContaining({ kind: "success" }),
        }),
        expect.objectContaining({
            status: "completed",
            outcome: expect.objectContaining({ kind: "success" }),
        }),
    ]);
    expect(observed.mission).toMatchObject({ status: "completed" });
    expect(network).toHaveBeenCalledTimes(2);
}, 30000);

test.each([
    { label: "empty", arguments: "", complete: true },
    { label: "missing", arguments: undefined, complete: false },
])("native arguments must have an observable valid JSON object ($label)", async ({
    arguments: argumentText,
    complete,
}) => {
    const network = vi.fn(
        async () =>
            new Response(
                [
                    `data: ${JSON.stringify({ id: "missing-native", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "missing-call", type: "function", function: { name: "consult_mission_state", arguments: argumentText } }] }, finish_reason: null }] })}`,
                    `data: ${JSON.stringify({ id: "missing-native", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}`,
                    "data: [DONE]",
                    "",
                ].join("\n\n"),
                { headers: { "content-type": "text/event-stream" } },
            ),
    );
    vi.stubGlobal("fetch", network);
    const f = await fixture();
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const observed = await f.t.run(async (ctx) => ({
        calls: await ctx.db.query("providerCalls").collect(),
        replies: (
            await ctx.db.query("agentInvocationPayloads").collect()
        ).filter((p) => p.part === "reply"),
        requests: await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
            .collect(),
    }));
    if (complete) {
        expect(observed.calls.length).toBeGreaterThan(1);
        expect(
            observed.calls.every((call) => call.status === "succeeded"),
        ).toBe(true);
        expect(
            observed.requests.some(
                (r) =>
                    r.input.kind === "invalid" && r.outcome?.kind === "refused",
            ),
        ).toBe(true);
        expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
            status: "blocked",
            blockCode: "repetition_stop",
        });
    } else {
        expect(observed.calls).toEqual([
            expect.objectContaining({
                status: "failed",
                errorCode: "invalid_output",
                diagnostic: expect.objectContaining({
                    reason: "tool_arguments_invalid",
                }),
            }),
        ]);
        expect(observed.requests).toHaveLength(1);
        expect(network).toHaveBeenCalledOnce();
    }
    const payload = observed.replies[0];
    expect(payload?.state).toBe(complete ? "complete" : "incomplete");
    if (complete && payload?.json !== undefined)
        expect(JSON.parse(payload.json).content[0].rawArguments).toBe("");
    if (!complete) expect(payload?.json).toBeUndefined();
}, 30000);

test.each([
    { label: "short", original: '{"sourceId":', exceedsCapacity: false },
    {
        label: "large escaped",
        original: `{"sourceId":${"\\".repeat(150_000)}`,
        exceedsCapacity: true,
    },
])("malformed original tool arguments remain inspectable through correction or capacity refusal ($label)", async ({
    original,
    exceedsCapacity,
}) => {
    const network = vi.fn(
        async () =>
            new Response(
                [
                    `data: ${JSON.stringify({ id: "malformed-tool", choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "NON_OBSERVABLE_REASONING", tool_calls: [{ index: 0, id: "malformed-call", type: "function", function: { name: "read_in_context", arguments: original } }] }, finish_reason: null }] })}`,
                    `data: ${JSON.stringify({ id: "malformed-tool", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}`,
                    "data: [DONE]",
                    "",
                ].join("\n\n"),
                { headers: { "content-type": "text/event-stream" } },
            ),
    );
    vi.stubGlobal("fetch", network);
    const f = await fixture();
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const observed = await f.t.run(async (ctx) => ({
        calls: await ctx.db.query("providerCalls").collect(),
        replies: (
            await ctx.db.query("agentInvocationPayloads").collect()
        ).filter((payload) => payload.part === "reply"),
        requests: await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission_and_status", (q) =>
                q.eq("missionId", f.missionId),
            )
            .collect(),
        mission: await ctx.db.get(f.missionId),
    }));
    expect(
        observed.replies.map((p) => {
            if (p.state !== "complete" || p.json === undefined)
                throw new Error("Expected a complete observable reply");
            return JSON.parse(p.json).content[0].rawArguments;
        }),
    ).toEqual(Array(observed.replies.length).fill(original));
    expect(JSON.stringify(observed.replies)).toContain("argumentsError");
    expect(JSON.stringify(observed.replies)).not.toContain(
        "NON_OBSERVABLE_REASONING",
    );
    if (exceedsCapacity) {
        expect(
            observed.calls.map((call) => ({
                status: call.status,
                code: call.errorCode,
                reason: call.diagnostic?.reason,
            })),
        ).toEqual([
            {
                status: "failed",
                code: "response_capacity",
                reason: "response_capacity",
            },
        ]);
        expect(observed.requests).toHaveLength(1);
        expect(observed.mission).toMatchObject({
            status: "blocked",
            blockCode: "response_capacity",
        });
        expect(network).toHaveBeenCalledOnce();
    } else {
        expect(observed.calls.length).toBeGreaterThan(1);
        expect(
            observed.calls.every((call) => call.status === "succeeded"),
        ).toBe(true);
        expect(
            observed.requests.some(
                (r) =>
                    r.input.kind === "invalid" && r.outcome?.kind === "refused",
            ),
        ).toBe(true);
        expect(observed.mission).toMatchObject({
            status: "blocked",
            blockCode: "repetition_stop",
        });
    }
}, 30000);

test.each([
    { status: 429, errorCode: "transport_unavailable", retryable: true },
    { status: 401, errorCode: "access_unavailable", retryable: false },
])("native HTTP $status uses the shared confirmed-failure policy", async ({
    status,
    errorCode,
    retryable,
}) => {
    const network = vi.fn(
        async () =>
            new Response(
                JSON.stringify({
                    error: { message: "Fixture provider refusal" },
                }),
                {
                    status,
                    headers: { "content-type": "application/json" },
                },
            ),
    );
    vi.stubGlobal("fetch", network);
    const f = await fixture();
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([
        expect.objectContaining({
            status: "failed",
            errorCode,
            retryable,
            dispatchOutcome: "response_received",
            httpStatus: status,
        }),
    ]);
    expect(network).toHaveBeenCalledOnce();
}, 30000);

test.each([
    "length",
    "content_filter",
])("native %s termination settles a confirmed invalid-output incident", async (finishReason) => {
    let completion: object = {};
    const network = vi.fn(async () => reply(completion, finishReason));
    vi.stubGlobal("fetch", network);
    const f = await fixture();
    completion = { kind: "complete", captureIds: [f.captureId] };
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([
        expect.objectContaining({
            status: "failed",
            errorCode: "invalid_output",
            dispatchOutcome: "response_received",
        }),
    ]);
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "blocked",
    });
    expect(network).toHaveBeenCalledOnce();
}, 30000);

test("native Pi transport journals the complete request and reply and accounts its admitted provider call", async () => {
    let completion: object = {};
    const network = vi.fn(async () => reply(completion));
    vi.stubGlobal("fetch", network);
    const f = await fixture();
    completion = { kind: "complete", captureIds: [f.captureId] };
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const final = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        return {
            mission,
            invocation: mission?.lastInvocationId
                ? await ctx.db.get(mission.lastInvocationId)
                : null,
        };
    });
    expect(final.invocation?.receivedOutputJson).not.toContain("blocked");
    expect(final.mission).toMatchObject({ status: "completed" });
    expect(network).toHaveBeenCalledOnce();
    const observed = await f.t.run(async (ctx) => ({
        calls: await ctx.db.query("providerCalls").collect(),
        payloads: await ctx.db.query("agentInvocationPayloads").collect(),
    }));
    expect(observed.calls).toEqual([
        expect.objectContaining({
            status: "succeeded",
            dispatchOutcome: "response_received",
            operation: "agent_reasoning",
        }),
    ]);
    expect(observed.payloads).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ part: "request", state: "complete" }),
            expect.objectContaining({ part: "reply", state: "complete" }),
        ]),
    );
    expect(JSON.stringify(observed.payloads)).not.toContain("test-only-key");
}, 30000);

test("an interrupted dispatched native request blocks without redispatch on Resume", async () => {
    const network = vi.fn(async () => {
        throw new TypeError("Simulated connection loss");
    });
    vi.stubGlobal("fetch", network);
    const f = await fixture();
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const before = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(f.missionId),
        calls: await ctx.db.query("providerCalls").collect(),
    }));
    expect(before.mission).toMatchObject({
        status: "blocked",
        blockCode: "attempt_outcome_unknown",
    });
    expect(before.calls).toEqual([
        expect.objectContaining({ status: "started" }),
    ]);
    await expect(
        f.t.mutation(internal.execution.missions.resume, {
            missionId: f.missionId,
            expectedGeneration: 4,
            simulation: false,
        }),
    ).rejects.toThrow("attempt_outcome_unknown");
    expect(network).toHaveBeenCalledOnce();
}, 30000);

test("disabled paid work prevents native Pi dispatch and preserves an explicit non-dispatch outcome", async () => {
    const network = vi.fn(async () => {
        throw new Error("Unexpected provider dispatch");
    });
    vi.stubGlobal("fetch", network);
    const f = await fixture();
    await f.t.run((ctx) =>
        ctx.db.insert("paidWorkControls", {
            key: "global",
            enabled: false,
            updatedAt: Date.now(),
        }),
    );
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "blocked",
        blockCode: "paid_work_disabled",
    });
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
    expect(network).not.toHaveBeenCalled();
}, 30000);

for (const stop of ["cancel", "revoke"] as const) {
    test(`a native reply arriving after ${stop} retains its receipt without adopting the result`, async () => {
        let entered!: () => void;
        const dispatched = new Promise<void>((resolve) => {
            entered = resolve;
        });
        let release!: () => void;
        const response = new Promise<void>((resolve) => {
            release = resolve;
        });
        let completion: object = {};
        const network = vi.fn(async () => {
            entered();
            await response;
            return reply(completion);
        });
        vi.stubGlobal("fetch", network);
        const f = await fixture();
        completion = { kind: "complete", captureIds: [f.captureId] };
        const running = f.t.finishAllScheduledFunctions(
            () => vi.advanceTimersByTime(10),
            500,
        );
        try {
            await dispatched;
            if (stop === "cancel") {
                const { api } = await import("@convex/_generated/api");
                await f.t
                    .withIdentity({ subject: f.userId })
                    .mutation(api.workflowControls.cancel, {
                        runId: f.args.runId,
                    });
            } else
                await f.t.run((ctx) =>
                    ctx.db.patch(f.visitorId, { status: "revoked" }),
                );
        } finally {
            release();
        }
        await running;
        const observed = await f.t.run(async (ctx) => ({
            mission: await ctx.db.get(f.missionId),
            invocations: await ctx.db.query("agentInvocations").collect(),
            calls: await ctx.db.query("providerCalls").collect(),
        }));
        expect(observed.mission).not.toHaveProperty("result");
        expect(observed.calls).toEqual([
            expect.objectContaining({
                status: "succeeded",
                dispatchOutcome: "response_received",
            }),
        ]);
        expect(observed.invocations).toEqual([
            expect.objectContaining({ receivedWhileAuthorized: false }),
        ]);
        expect(network).toHaveBeenCalledOnce();
    }, 30000);
}

test("native compaction shares the provider ledger and leaves original history and the required state available", async () => {
    let calls = 0;
    let completion: object = {};
    const network = vi.fn(async () =>
        reply(
            ++calls === 1
                ? { summary: "Working aid; exact originals remain retained." }
                : completion,
        ),
    );
    vi.stubGlobal("fetch", network);
    const f = await fixture();
    completion = { kind: "complete", captureIds: [f.captureId] };
    const { seedPiHistory } = await import("@/__tests__/setup/pi-mission");
    await seedPiHistory(f.t, f.missionId, 4, 8, 56000);
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: 4,
        simulation: false,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const retained = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(f.missionId),
        calls: await ctx.db.query("providerCalls").collect(),
        invocations: await ctx.db.query("agentInvocations").collect(),
        commits: await ctx.db.query("piCommits").collect(),
    }));
    expect(retained.mission).toMatchObject({
        status: "completed",
        result: { captureIds: [f.captureId] },
    });
    expect(retained.calls).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                operation: "agent_compaction",
                status: "succeeded",
                dispatchOutcome: "response_received",
            }),
        ]),
    );
    expect(retained.invocations).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                purpose: "compaction",
                status: "returned",
            }),
        ]),
    );
    expect(
        retained.commits.some((commit) =>
            commit.payload?.includes("EXACT-ORIGINAL-0"),
        ),
    ).toBe(true);
    expect(network).toHaveBeenCalledTimes(2);
}, 30000);

const nodeGenerationWindowMs = nodeActionGenerationDeadline(0);
test.each([
    75_000,
    nodeGenerationWindowMs + 1,
])("responsive native generation after %s ms respects mission authority and the Node host boundary", async (elapsedMs) => {
    let entered!: () => void;
    let release!: () => void;
    const dispatched = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const response = new Promise<void>((resolve) => {
        release = resolve;
    });
    let signal: AbortSignal | null | undefined;
    let completion: object = {};
    const network = vi.fn(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
            signal = init?.signal;
            entered();
            const aborted = new Promise<never>((_resolve, reject) => {
                signal?.addEventListener(
                    "abort",
                    () => reject(signal?.reason),
                    { once: true },
                );
            });
            await Promise.race([response, aborted]);
            return reply(completion);
        },
    );
    vi.stubGlobal("fetch", network);
    const f = await fixture();
    completion = { kind: "complete", captureIds: [f.captureId] };
    const timers: ReturnType<typeof setTimeout>[] = [];
    const clock = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
        const controller = new AbortController();
        timers.push(
            setTimeout(
                () =>
                    controller.abort(
                        new DOMException("Authority expired", "TimeoutError"),
                    ),
                ms,
            ),
        );
        return controller.signal;
    });
    const running = f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    try {
        await dispatched;
        // Virtual timer callbacks need the Convex action context used by the storage heartbeat.
        await f.t.action(async () => {
            await vi.advanceTimersByTimeAsync(elapsedMs);
        });
        expect(signal?.aborted, String(signal?.reason)).toBe(
            elapsedMs > nodeGenerationWindowMs,
        );
        const call = await f.t.run((ctx) =>
            ctx.db.query("providerCalls").first(),
        );
        const mission = await f.t.run((ctx) => ctx.db.get(f.missionId));
        if (!call || !mission)
            throw new Error("Missing admitted native attempt");
        expect(call.leaseExpiresAt).toBe(mission.deadlineAt + 10000);
        const duplicate = f.t.mutation(internal.providerCalls.recordAttempt, {
            missionId: call.missionId,
            invocationId: call.invocationId,
            inputHash: call.inputHash,
            runId: call.runId,
            corpusRevisionId: call.corpusRevisionId,
            executionGeneration: call.executionGeneration,
            workflowVersion: call.workflowVersion,
            stepKey: call.stepKey,
            service: "model",
            operation: call.operation,
            operationKey: call.operationKey,
            attempt: call.attempt,
            status: "started",
        });
        if (elapsedMs > nodeGenerationWindowMs)
            await expect(duplicate).rejects.toThrow("execution_interrupted");
        else
            expect(await duplicate).toMatchObject({
                providerCallId: call._id,
                shouldExecute: false,
                status: "started",
            });
    } finally {
        release();
        try {
            await running;
        } finally {
            clock.mockRestore();
            for (const timer of timers) clearTimeout(timer);
        }
    }
    const result = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(f.missionId),
        calls: await ctx.db.query("providerCalls").collect(),
        invocations: await ctx.db.query("agentInvocations").collect(),
    }));
    if (elapsedMs > nodeGenerationWindowMs) {
        expect(result.mission).toMatchObject({
            status: "blocked",
            blockCode: "execution_interrupted",
        });
        expect(
            await f.t.run((ctx) =>
                ctx.db.query("agentExecutionEvents").collect(),
            ),
        ).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    missionId: f.missionId,
                    kind: "mission_blocked",
                    code: "node_action_deadline",
                }),
            ]),
        );
        expect(result.calls).toHaveLength(1);
        expect(result.calls[0]?.status).not.toBe("succeeded");
        expect(result.calls[0]?.reportedCost).toBeUndefined();
        expect(result.mission).not.toHaveProperty("result");
        await f.t.action(internal.execution.piWorker.run, {
            missionId: f.missionId,
            expectedGeneration: 4,
            token: "expired-wake",
        });
    } else {
        expect(result.mission).toMatchObject({ status: "completed" });
        expect(result.calls).toEqual([
            expect.objectContaining({
                status: "succeeded",
                dispatchOutcome: "response_received",
            }),
        ]);
    }
    expect(result.invocations).toHaveLength(1);
    expect(network).toHaveBeenCalledOnce();
});

test("the native HTTP request observes the shared mission-deadline abort signal", async () => {
    let entered!: () => void;
    const dispatched = new Promise<void>((resolve) => {
        entered = resolve;
    });
    let release!: () => void;
    const response = new Promise<void>((resolve) => {
        release = resolve;
    });
    let signal: AbortSignal | null | undefined;
    const deadline = new AbortController();
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const clock = vi
        .spyOn(AbortSignal, "timeout")
        .mockImplementation((ms) =>
            ms < 60_000 ? deadline.signal : timeout(ms),
        );
    let completion: object = {};
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
            signal = init?.signal;
            entered();
            await response;
            return reply(completion);
        }),
    );
    const f = await fixture();
    await f.t.run((ctx) =>
        ctx.db.patch(f.missionId, { deadlineAt: Date.now() + 30_000 }),
    );
    completion = { kind: "complete", captureIds: [f.captureId] };
    const running = f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    try {
        await dispatched;
        deadline.abort();
        expect(signal?.aborted).toBe(true);
    } finally {
        release();
        await running;
        clock.mockRestore();
    }
}, 30000);

test("a refused writer lease prevents native provider dispatch and retains explicit non-dispatch", async () => {
    const { PiConvexStorage } = await import("@convex/integrations/piStorage");
    const { executionError } = await import("@convex/execution/errors");
    const lease = vi
        .spyOn(PiConvexStorage.prototype, "renewLease")
        .mockRejectedValue(executionError("pi_writer_fenced"));
    let completion: object = {};
    const network = vi.fn(async () => reply(completion));
    vi.stubGlobal("fetch", network);
    try {
        const f = await fixture();
        completion = { kind: "complete", captureIds: [f.captureId] };
        await f.t.finishAllScheduledFunctions(
            () => vi.advanceTimersByTime(10),
            500,
        );
        expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
            status: "blocked",
            blockCode: "pi_writer_fenced",
        });
        expect(network).not.toHaveBeenCalled();
        expect(
            await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
        ).toEqual([]);
        expect(
            await f.t.run((ctx) =>
                ctx.db.query("agentInvocationPayloads").collect(),
            ),
        ).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    part: "reply",
                    state: "incomplete",
                    code: "not_dispatched",
                }),
            ]),
        );
    } finally {
        lease.mockRestore();
    }
}, 30000);

test("an interrupted native compaction retains an unknown attempt and cannot redispatch on Resume", async () => {
    const network = vi.fn(async () => {
        throw new TypeError("Simulated compaction connection loss");
    });
    vi.stubGlobal("fetch", network);
    const f = await fixture();
    const { seedPiHistory } = await import("@/__tests__/setup/pi-mission");
    await seedPiHistory(f.t, f.missionId, 4, 8, 56000);
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
        status: "blocked",
        blockCode: "attempt_outcome_unknown",
    });
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                operation: "agent_compaction",
                status: "started",
            }),
        ]),
    );
    await expect(
        f.t.mutation(internal.execution.missions.resume, {
            missionId: f.missionId,
            expectedGeneration: 4,
            simulation: false,
        }),
    ).rejects.toThrow("attempt_outcome_unknown");
    expect(network).toHaveBeenCalledOnce();
}, 30000);

test("native receipts retain total input, cached input and reasoning usage", async () => {
    let completion: object = {};
    vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
            reply(completion, "stop", {
                prompt_tokens: 100,
                prompt_tokens_details: { cached_tokens: 80 },
                completion_tokens: 5,
                completion_tokens_details: { reasoning_tokens: 3 },
                total_tokens: 105,
            }),
        ),
    );
    const f = await fixture();
    completion = { kind: "complete", captureIds: [f.captureId] };
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "completed",
    });
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([
        expect.objectContaining({
            status: "succeeded",
            usage: expect.objectContaining({
                inputTokens: 100,
                cachedInputTokens: 80,
                outputTokens: 5,
                reasoningTokens: 3,
            }),
        }),
    ]);
}, 30000);

test("an admitted compaction response is retained after public Pause and Resume changes its generation", async () => {
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
        enter = resolve;
    });
    const released = new Promise<void>((resolve) => {
        release = resolve;
    });
    const network = vi.fn(async () => {
        enter();
        await released;
        return reply({ summary: "Confirmed compaction summary" });
    });
    vi.stubGlobal("fetch", network);
    const f = await fixture();
    await f.t.run((ctx) =>
        ctx.db.patch(f.args.runId, { agentExecutionVersion: 3 }),
    );
    const { seedPiHistory } = await import("@/__tests__/setup/pi-mission");
    await seedPiHistory(f.t, f.missionId, 4, 8, 56000);
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: 4,
        simulation: false,
    });
    const scheduled = await f.t.run((ctx) => ctx.db.get(f.missionId));
    if (!scheduled?.piWakeToken) throw new Error("Expected worker wake");
    const running = f.t.action(internal.execution.piWorker.run, {
        missionId: f.missionId,
        expectedGeneration: 4,
        token: scheduled.piWakeToken,
    });
    try {
        await entered;
        const client = f.t.withIdentity({ subject: f.userId });
        await client.mutation(api.execution.researchControl.pause, {
            runId: f.args.runId,
            expectedGeneration: 4,
        });
        const generation = await client.mutation(
            api.execution.researchControl.resume,
            { runId: f.args.runId, expectedGeneration: 5 },
        );
        await f.t.mutation(internal.execution.researchControl.resumeMissions, {
            runId: f.args.runId,
            generation,
            paginationOpts: { numItems: 20, cursor: null },
        });
        expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
            generation: 6,
        });
    } finally {
        release();
    }
    await running;
    const observed = await f.t.run(async (ctx) => ({
        calls: await ctx.db.query("providerCalls").collect(),
        invocations: await ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
            .collect(),
        mission: await ctx.db.get(f.missionId),
    }));
    expect(network).toHaveBeenCalledOnce();
    expect(
        observed.calls.filter((c) => c.operation === "agent_compaction"),
    ).toEqual([
        expect.objectContaining({
            status: "succeeded",
            dispatchOutcome: "response_received",
        }),
    ]);
    expect(
        observed.invocations.filter((i) => i.purpose === "compaction"),
    ).toEqual([
        expect.objectContaining({
            receivedOutputJson: expect.any(String),
            receivedWhileAuthorized: false,
        }),
    ]);
    expect(observed.mission).not.toMatchObject({ status: "completed" });
}, 30000);

test("native model capacity admits a request above 128 KiB and preserves its complete journal", async () => {
    let completion: object = {};
    let body = "";
    const network = vi.fn<typeof fetch>(async (_url, init) => {
        body = String(init?.body);
        return reply(completion);
    });
    vi.stubGlobal("fetch", network);
    const f = await fixture();
    completion = { kind: "complete", captureIds: [f.captureId] };
    const { seedPiHistory } = await import("@/__tests__/setup/pi-mission");
    await seedPiHistory(f.t, f.missionId, 4, 3, 48000);
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: 4,
        simulation: false,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(network).toHaveBeenCalledOnce();
    expect(new TextEncoder().encode(body).length).toBeGreaterThan(128 * 1024);
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "completed",
    });
    const payload = await f.t.run((ctx) =>
        ctx.db
            .query("agentInvocationPayloads")
            .filter((q) => q.eq(q.field("part"), "request"))
            .first(),
    );
    expect(payload).toMatchObject({ state: "complete" });
    expect(payload?.json).toContain("EXACT-ORIGINAL-0");
}, 30000);

test("native compaction retains its own output budget through final HTTP serialization", async () => {
    const budgets: number[] = [];
    let completion: object = {};
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            budgets.push(body.max_completion_tokens ?? body.max_tokens);
            return reply(
                budgets.length === 1
                    ? "A complete qualitative summary with its caveats."
                    : completion,
            );
        }),
    );
    const f = await fixture();
    completion = { kind: "complete", captureIds: [f.captureId] };
    const { seedPiHistory } = await import("@/__tests__/setup/pi-mission");
    await seedPiHistory(f.t, f.missionId, 4, 8, 56000);
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: 4,
        simulation: false,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(budgets).toHaveLength(2);
    expect(budgets[0]).toBe(8192);
}, 30000);

test("a context-reduced native output cap and a fragmented request are retained before provider I/O", async () => {
    const { readRetainedText } = await import("@convex/execution/retainedText");
    let f: Awaited<ReturnType<typeof fixture>>;
    let count = 0;
    const budgets: number[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            budgets.push(body.max_completion_tokens ?? body.max_tokens);
            if (++count === 1) {
                const request = await f.t.run((ctx) =>
                    ctx.db
                        .query("agentInvocationPayloads")
                        .filter((q) => q.eq(q.field("part"), "request"))
                        .first(),
                );
                expect(request).toMatchObject({
                    state: "complete",
                    effectiveMaxOutputTokens: 1,
                });
                if (!request?.textId)
                    throw new Error(
                        "Expected complete fragmented request before I/O",
                    );
                const textId = request.textId;
                const retained = await f.t.run((ctx) =>
                    readRetainedText(ctx, textId),
                );
                expect(JSON.parse(retained).input).toEqual(body);
                return reply("Context.", "stop", {
                    prompt_tokens: 100,
                    completion_tokens: 1,
                    total_tokens: 101,
                });
            }
            return reply({ kind: "complete", captureIds: [f.captureId] });
        }),
    );
    f = await fixture();
    const { seedPiHistory } = await import("@/__tests__/setup/pi-mission");
    await seedPiHistory(f.t, f.missionId, 4, 16, 48000);
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: 4,
        simulation: false,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(budgets).toEqual([1, 8192]);
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "completed",
    });
}, 30000);

test("a confirmed native provider context overflow returns to native compaction with its original receipt retained", async () => {
    let count = 0;
    let completion: object = {};
    const network = vi.fn(async () => {
        if (++count === 1)
            return new Response(
                JSON.stringify({
                    error: { message: "maximum context length exceeded" },
                }),
                {
                    status: 400,
                    headers: { "content-type": "application/json" },
                },
            );
        return reply(
            count === 2
                ? "A complete qualitative summary with its limitations."
                : completion,
        );
    });
    vi.stubGlobal("fetch", network);
    const f = await fixture();
    completion = { kind: "complete", captureIds: [f.captureId] };
    const { seedPiHistory } = await import("@/__tests__/setup/pi-mission");
    await seedPiHistory(f.t, f.missionId, 4, 3, 48000);
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
        status: "completed",
    });
    expect(network).toHaveBeenCalledTimes(3);
    const receipts = await f.t.run((ctx) =>
        ctx.db.query("providerCalls").collect(),
    );
    expect(receipts[0]).toMatchObject({
        status: "failed",
        errorCode: "context_capacity",
        dispatchOutcome: "response_received",
    });
    expect(receipts[1]).toMatchObject({
        operation: "agent_compaction",
        status: "succeeded",
    });
}, 30000);

test("ordinary native generation uses the model context budget instead of the one-shot ceiling", async () => {
    let f: Awaited<ReturnType<typeof fixture>>;
    let effectiveLimit: number | undefined;
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            effectiveLimit = body.max_completion_tokens ?? body.max_tokens;
            const request = await f.t.run((ctx) =>
                ctx.db
                    .query("agentInvocationPayloads")
                    .filter((q) => q.eq(q.field("part"), "request"))
                    .first(),
            );
            expect(request?.effectiveMaxOutputTokens).toBe(effectiveLimit);
            return reply({ kind: "complete", captureIds: [f.captureId] });
        }),
    );
    f = await fixture("high");
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(effectiveLimit).toBeGreaterThan(6144);
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "completed",
    });
}, 30000);

test.each([
    false,
    true,
])("a complete long native compaction is successful and its exact summary reaches the following request (reopen=%s)", async (reopen) => {
    const summary = "Validated context. ".repeat(2400);
    const requests: Array<{ messages: unknown[] }> = [];
    let completion: object = {};
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)));
            return reply(requests.length === 1 ? summary : completion, "stop", {
                prompt_tokens: 10,
                completion_tokens: requests.length === 1 ? 5000 : 5,
                cost: 0.001,
            });
        }),
    );
    const f = await fixture();
    completion = { kind: "complete", captureIds: [f.captureId] };
    const { seedPiHistory } = await import("@/__tests__/setup/pi-mission");
    await seedPiHistory(f.t, f.missionId, 4, 8, 56000);
    if (reopen) {
        let lostWrites = 0;
        await expect(
            f.t.action((ctx) =>
                runPiMission(
                    {
                        ...ctx,
                        runMutation: async (reference, ...args) => {
                            const name = getFunctionName(reference);
                            if (
                                [
                                    "execution/piStore:append",
                                    "execution/piStore:publishCommit",
                                ].includes(name)
                            ) {
                                const retained = await f.t.run(async (dbCtx) =>
                                    (
                                        await dbCtx.db
                                            .query("agentInvocations")
                                            .collect()
                                    ).some(
                                        (i) =>
                                            i.purpose === "compaction" &&
                                            i.receivedOutputJson,
                                    ),
                                );
                                if (retained) {
                                    lostWrites++;
                                    throw executionError(
                                        "execution_interrupted",
                                    );
                                }
                            }
                            return ctx.runMutation(reference, ...args);
                        },
                    },
                    { missionId: f.missionId, expectedGeneration: 4 },
                    "lost-compaction-commit",
                    nodeActionGenerationDeadline(Date.now()),
                ),
            ),
        ).rejects.toMatchObject({ data: { code: "execution_interrupted" } });
        expect(lostWrites).toBeGreaterThan(0);
        expect(requests).toHaveLength(1);
    }
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: 4,
        simulation: false,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const state = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(f.missionId),
        calls: await ctx.db.query("providerCalls").collect(),
        invocations: await ctx.db.query("agentInvocations").collect(),
    }));
    const compaction = state.invocations.find(
        (i) => i.purpose === "compaction",
    );
    expect(
        state.calls.find((c) => c.operation === "agent_compaction"),
    ).toMatchObject({ status: "succeeded", reportedCost: 0.001 });
    expect(
        state.calls.filter((c) => c.operation === "agent_compaction"),
    ).toHaveLength(1);
    expect(compaction).toMatchObject({ status: "returned" });
    expect(JSON.parse(compaction?.receivedOutputJson ?? "null")).toEqual({
        kind: "operations",
        requests: [],
    });
    expect(state.mission).toMatchObject({
        status: "completed",
        result: { captureIds: [f.captureId] },
    });
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.messages)).toContain(summary.trim());
}, 30000);
