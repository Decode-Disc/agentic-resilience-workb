import { api, internal } from "@convex/_generated/api";
import type { ModelRoute } from "@convex/integrations/modelRouting";
import { afterEach, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

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
        max_completion_tokens: 6144,
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

test("SDK-repaired malformed raw JSON is retained separately and refused before operation admission", async () => {
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
    original = `{ "sourceId": "${current.args.sourceId}", "query": "line\nline" }`;
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
    expect(observed.calls).toEqual([
        expect.objectContaining({
            status: "failed",
            errorCode: "invalid_output",
            dispatchOutcome: "response_received",
            diagnostic: expect.objectContaining({
                reason: "tool_arguments_invalid",
            }),
        }),
    ]);
    const payload = observed.replies[0];
    if (payload?.state !== "complete" || payload.json === undefined)
        throw new Error("Expected complete observable reply");
    const content = JSON.parse(payload.json).content;
    expect(content).toEqual([
        expect.objectContaining({
            id: "repair-call",
            rawArguments: original,
            arguments: { sourceId: current.args.sourceId, query: "line\nline" },
            argumentsError: expect.any(String),
        }),
    ]);
    expect(payload.json).not.toContain("NON_OBSERVABLE_REASONING");
    expect(observed.requests).toHaveLength(1);
    expect(observed.mission).toMatchObject({
        status: "blocked",
        blockCode: "invalid_output",
    });
    expect(network).toHaveBeenCalledOnce();
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
    const payload = observed.replies[0];
    expect(payload?.state).toBe(complete ? "complete" : "incomplete");
    if (complete && payload?.json !== undefined)
        expect(JSON.parse(payload.json).content[0].rawArguments).toBe("");
    if (!complete) expect(payload?.json).toBeUndefined();
    expect(network).toHaveBeenCalledOnce();
}, 30000);

test.each([
    { label: "short", original: '{"sourceId":' },
    { label: "large escaped", original: `{"sourceId":${"\\".repeat(150_000)}` },
])("malformed original tool arguments remain inspectable and settle a confirmed invalid-output incident ($label)", async ({
    original,
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
    ).toEqual([original]);
    expect(JSON.stringify(observed.replies)).toContain("argumentsError");
    expect(JSON.stringify(observed.replies)).not.toContain(
        "NON_OBSERVABLE_REASONING",
    );
    expect(observed.calls).toEqual([
        expect.objectContaining({
            status: "failed",
            errorCode: "invalid_output",
            dispatchOutcome: "response_received",
            diagnostic: expect.objectContaining({
                reason: "tool_arguments_invalid",
            }),
        }),
    ]);
    expect(observed.requests).toHaveLength(1);
    expect(observed.mission).toMatchObject({
        status: "blocked",
        blockCode: "invalid_output",
    });
    expect(network).toHaveBeenCalledOnce();
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
    await seedPiHistory(f.t, f.missionId, 4, 8, 16250);
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
            commit.payload.includes("EXACT-ORIGINAL-0"),
        ),
    ).toBe(true);
    expect(network).toHaveBeenCalledTimes(2);
}, 30000);

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
        ).toEqual([
            expect.objectContaining({
                status: "failed",
                errorCode: "pi_writer_fenced",
                dispatchOutcome: "not_dispatched",
            }),
        ]);
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
    await seedPiHistory(f.t, f.missionId, 4, 8, 16250);
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
    await seedPiHistory(f.t, f.missionId, 4, 8, 16250);
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
