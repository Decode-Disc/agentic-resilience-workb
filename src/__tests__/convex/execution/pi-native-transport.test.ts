import { api, internal } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { executionError } from "@convex/execution/errors";
import type { ModelRoute } from "@convex/integrations/modelRouting";
import { recoverPiInvocationBody } from "@convex/integrations/piInvocation";
import { runPiMission } from "@convex/integrations/piMission";
import { nodeActionGenerationDeadline } from "@convex/resourcePolicy";
import {
    type FunctionArgs,
    type FunctionReturnType,
    getFunctionName,
} from "convex/server";
import { afterEach, assert, expect, test, vi } from "vitest";
import { originalOperationArguments } from "@/__tests__/setup/agent-harness";
import { installModel } from "@/__tests__/setup/model-configuration";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import { readRetainedBody } from "@/__tests__/setup/retained-history";
import { readMessageBodies } from "@/__tests__/setup/retained-messages";
import {
    seedInspectedEvidence,
    startRetainedInspection,
} from "@/__tests__/setup/source-preparation";

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
    let verifiedStagedReceipt = false;
    if (!compaction) {
        await expect(
            f.t.action((ctx) =>
                runPiMission(
                    {
                        ...ctx,
                        runMutation: async (reference, ...args) => {
                            if (
                                getFunctionName(reference) ===
                                "execution/invocationLifecycle:recordModelReply"
                            ) {
                                const settlement = args[0] as FunctionArgs<
                                    typeof internal.execution.invocationLifecycle.recordModelReply
                                >;
                                const raw =
                                    settlement.prepared?.rawOutputTextId;
                                const envelope =
                                    settlement.observableReplyTextId;
                                assert(
                                    raw &&
                                        envelope &&
                                        settlement.attempt.invocationId,
                                );
                                expect(settlement.reply).toBeUndefined();
                                expect(
                                    settlement.observableReplyJson,
                                ).toBeUndefined();
                                const invocationId =
                                    settlement.attempt.invocationId;
                                const original = await f.t.run((db) =>
                                    db.db.get(invocationId),
                                );
                                assert(original?.providerCallId);
                                const providerCallId = original.providerCallId;
                                const wrong = {
                                    ...settlement,
                                    prepared: {
                                        ...settlement.prepared,
                                        rawOutputTextId: envelope,
                                    },
                                };
                                await expect(
                                    ctx.runMutation(
                                        internal.execution.invocationLifecycle
                                            .recordModelReply,
                                        wrong,
                                    ),
                                ).rejects.toThrow("invocation_result_invalid");
                                expect(
                                    await f.t.run((db) =>
                                        db.db.get(providerCallId),
                                    ),
                                ).toMatchObject({ status: "started" });
                                expect(
                                    await f.t.run((db) =>
                                        db.db.get(invocationId),
                                    ),
                                ).not.toHaveProperty("receivedOutputJson");
                                verifiedStagedReceipt = true;
                            }
                            return ctx.runMutation(reference, ...args);
                        },
                    },
                    { missionId: f.missionId, expectedGeneration: 4 },
                    "staged-receipt-test",
                    nodeActionGenerationDeadline(Date.now()),
                ),
            ),
        ).rejects.toMatchObject({ data: { code: "invalid_output" } });
        expect(verifiedStagedReceipt).toBe(true);
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
    const session = await f.t.run((ctx) =>
        ctx.db
            .query("piSessions")
            .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
            .unique(),
    );
    assert(session);
    const restored = await f.t.action((ctx) =>
        recoverPiInvocationBody(ctx, invocation, "raw", {
            expectedGeneration: 4,
            sessionId: session._id,
        }),
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

async function inspectReplies(
    fixture: Awaited<ReturnType<typeof seedInspectedEvidence>>,
    replies: Doc<"agentInvocationPayloads">[],
) {
    const { t, visitorId, userId } = fixture;
    await t.run((ctx) => ctx.db.patch(visitorId, { role: "admin" }));
    const admin = t.withIdentity({ subject: `${userId}|native-journal` });
    return Promise.all(
        replies.map(async ({ invocationId, runId }) => {
            const args = { invocationId, runId, part: "reply" as const };
            const detail = await admin.query(
                api.adminOperations.readInvocationJournalPayload,
                args,
            );
            assert(
                detail.kind === "recorded" &&
                    detail.payload.state === "complete",
            );
            if (detail.payload.json !== undefined) return detail.payload.json;
            const parts: string[] = [];
            let cursor: string | null = null;
            while (true) {
                const page: FunctionReturnType<
                    typeof api.adminOperations.listInvocationPayloadFragmentsPage
                > = await admin.query(
                    api.adminOperations.listInvocationPayloadFragmentsPage,
                    {
                        ...args,
                        paginationOpts: { numItems: 1, cursor },
                    },
                );
                parts.push(...page.page.map(({ content }) => content));
                if (page.isDone) return parts.join("");
                cursor = page.continueCursor;
            }
        }),
    );
}

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
    const missionId = await startRetainedInspection(f.t, {
        runId: f.args.runId,
        corpusRevisionId: f.args.corpusRevisionId,
        expectedGeneration: 4,
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
                bodies.length <= (repeat ? 5 : 1)
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
        status: "completed",
        noProgressTurns: repeat ? 5 : 1,
    });
    expect(observed.calls).toHaveLength(repeat ? 6 : 2);
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
    ).toBe(repeat ? 0.006 : 0.002);
    expect(observed.invocations).toHaveLength(repeat ? 6 : 2);
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
                bodies.length <= (repeat ? 5 : 3)
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
        status: "completed",
        deadlineAt: before?.deadlineAt,
        generation: before?.generation,
        progressKeys: before?.progressKeys,
        noProgressTurns: repeat ? 5 : 3,
        result: {
            kind: "saved_material_inspection_v1",
            captureIds: [f.captureId],
        },
    });
    expect(state.receipts).toHaveLength(repeat ? 6 : 4);
    expect(state.receipts.at(-1)?.status).toBe("succeeded");
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

test.each([
    "invalid JSON",
    "rebound call identity",
] as const)("a structured mission does not execute an untrusted call with %s", async (fault) => {
    let captureId: string;
    let original = '{"sourceId":';
    const network = vi.fn(async () => {
        if (network.mock.calls.length > 1)
            return reply({ kind: "complete", captureIds: [captureId] });
        const events = [
            {
                id: "invalid-tool",
                choices: [
                    {
                        index: 0,
                        delta: {
                            role: "assistant",
                            tool_calls: [
                                {
                                    index: 0,
                                    id: "bad-call",
                                    type: "function",
                                    function: {
                                        name: "read_in_context",
                                        arguments: original,
                                    },
                                },
                            ],
                        },
                        finish_reason: null,
                    },
                ],
            },
            ...(fault === "rebound call identity"
                ? [
                      {
                          id: "invalid-tool",
                          choices: [
                              {
                                  index: 0,
                                  delta: {
                                      tool_calls: [
                                          {
                                              index: 0,
                                              id: "rebound-call",
                                              function: { arguments: "" },
                                          },
                                      ],
                                  },
                                  finish_reason: null,
                              },
                          ],
                      },
                  ]
                : []),
            {
                id: "invalid-tool",
                choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
            },
        ];
        return new Response(
            `${events
                .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                .join("")}data: [DONE]\n\n`,
            { headers: { "content-type": "text/event-stream" } },
        );
    });
    vi.stubGlobal("fetch", network);
    const f = await fixture();
    captureId = f.captureId;
    if (fault === "rebound call identity")
        original = JSON.stringify({
            sourceId: f.args.sourceId,
            passageOrder: 0,
        });
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
    if (fault === "rebound call identity") {
        expect(result.mission).toMatchObject({
            status: "blocked",
            blockCode: "invalid_output",
        });
        expect(result.requests.filter((r) => !existing.has(r._id))).toEqual([]);
        expect(result.receipts).toEqual([
            expect.objectContaining({
                status: "failed",
                errorCode: "invalid_output",
            }),
        ]);
        expect(network).toHaveBeenCalledTimes(1);
    } else {
        expect(result.mission?.status).toBe("completed");
        expect(
            result.requests.filter((r) => r.input.kind === "invalid"),
        ).toEqual([
            expect.objectContaining({
                input: expect.objectContaining({
                    kind: "invalid",
                    inputReference: expect.objectContaining({
                        callId: "bad-call",
                    }),
                }),
                outcome: expect.objectContaining({ kind: "refused" }),
            }),
        ]);
        const refused = result.requests.find(
            (request) => request.input.kind === "invalid",
        );
        assert(refused);
        expect(await originalOperationArguments(f.t, refused)).toBe(original);
        expect(result.receipts).toHaveLength(2);
        expect(network).toHaveBeenCalledTimes(2);
    }
    expect(
        result.requests.some(
            (r) => !existing.has(r._id) && r.input.kind === "read_in_context",
        ),
    ).toBe(false);
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
                input: expect.objectContaining({
                    inputReference: expect.objectContaining({
                        callId: "repair-call",
                    }),
                }),
                outcome: expect.objectContaining({ kind: "refused" }),
            }),
        ],
    );
    const refused = observed.requests.find(
        (request) => request.input.kind === "invalid",
    );
    assert(refused);
    expect(await originalOperationArguments(current.t, refused)).toBe(original);
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
    assert(firstReply?.state === "complete");
    const [replyJson] = await inspectReplies(current, [firstReply]);
    assert(replyJson);
    expect(JSON.parse(replyJson).content).toEqual([
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
    await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        await ctx.db.patch(f.missionId, {
            modelLimits: { ...mission.modelLimits, work: 5 },
        });
    });
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
            blockCode: "work_budget_exhausted",
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
    { label: "short", original: '{"sourceId":' },
    {
        label: "large escaped",
        original: `{"sourceId":${"\\".repeat(150_000)}`,
    },
])("malformed original tool arguments remain inspectable through correction until the work budget is exhausted ($label)", async ({
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
    await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        await ctx.db.patch(f.missionId, {
            modelLimits: { ...mission.modelLimits, work: 5 },
        });
    });
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
    const completeReplies = observed.replies.filter(
        (reply) => reply.state === "complete",
    );
    expect(completeReplies).toHaveLength(observed.calls.length);
    expect(
        observed.replies
            .filter((reply) => reply.state !== "complete")
            .map(({ state, code, json }) => ({ state, code, json })),
    ).toEqual([
        { state: "incomplete", code: "not_dispatched", json: undefined },
    ]);
    const replies = await inspectReplies(f, completeReplies);
    expect(
        replies.map((json) => JSON.parse(json).content[0].rawArguments),
    ).toEqual(Array(completeReplies.length).fill(original));
    expect(replies.join("")).toContain("argumentsError");
    expect(replies.join("")).not.toContain("NON_OBSERVABLE_REASONING");

    expect(observed.calls.length).toBeGreaterThan(1);
    expect(observed.calls.every((call) => call.status === "succeeded")).toBe(
        true,
    );
    expect(
        observed.requests.some(
            (r) => r.input.kind === "invalid" && r.outcome?.kind === "refused",
        ),
    ).toBe(true);
    expect(observed.mission).toMatchObject({
        status: "blocked",
        blockCode: "work_budget_exhausted",
    });
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
                const retained = await readRetainedBody(f.t, textId);
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

test("a fresh native turn preserves the real stop over a historical time-limit explanation", async () => {
    const { seedResearchStateScenario } = await import(
        "@/__tests__/setup/research-state"
    );
    const { readResearchState } = await import("@convex/domain/researchState");
    vi.stubEnv("OPENROUTER_API_KEY", "offline-research-state-fixture");
    vi.stubEnv("WORKBENCH_AGENT_ENABLED", "true");
    const requests: Array<{
        messages: Array<{ role: string; content: unknown }>;
    }> = [];
    const network = vi.fn<typeof fetch>(async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        if (requests.length === 1)
            return new Response(
                `data: ${JSON.stringify({ id: "research-consultation", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "consult-current-state", type: "function", function: { name: "consult_run_state", arguments: "{}" } }] }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`,
                { headers: { "content-type": "text/event-stream" } },
            );
        if (requests.length > 2)
            throw new Error("Unexpected additional provider request");
        return reply(
            "Sources preparation ended with partial material. The Sources Agent's model response could not be used. Four retained documents are distinct from five consultable captures. The economic investigation remains unfinished.",
        );
    });
    vi.stubGlobal("fetch", network);
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
    const before = await f.t.run(async (ctx) => ({
        run: await ctx.db.get(f.runId),
        preparation: await ctx.db.get(f.preparationId),
        observation: await ctx.db.get(f.observationId),
        sourceMission: await ctx.db.get(f.missionId),
    }));
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(requests).toHaveLength(2);
    const system = requests[0]?.messages.find(
        (message) => message.role === "system",
    )?.content;
    expect(typeof system).toBe("string");
    const text = String(system);
    const state = JSON.parse(
        text.slice(text.indexOf("\n") + 1, text.indexOf("\n\n<instructions>")),
    );
    expect(state.domain.research).toMatchObject({
        status: "idle",
        sources: {
            outcome: "partial",
            executionStop: {
                blockCode: "invalid_output",
                missionId: f.missionId,
            },
            retainedDocuments: f.sourceIds.slice(0, 4).map((sourceId, i) => ({
                sourceId,
                title:
                    i === 0
                        ? "Workflow products"
                        : `Retained workflow document ${i + 1}`,
            })),
        },
        actions: {
            resume: { applicable: false },
            usePrepared: { applicable: false },
        },
    });
    expect(state.domain.availableMaterials).toHaveLength(5);
    const after = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        if (!run) throw new Error("Missing run");
        return {
            run,
            preparation: await ctx.db.get(f.preparationId),
            observation: await ctx.db.get(f.observationId),
            sourceMission: await ctx.db.get(f.missionId),
            research: await readResearchState(ctx, run),
            operations: await ctx.db
                .query("agentOperationRequests")
                .withIndex("by_mission", (q) =>
                    q.eq("missionId", f.workbenchMissionId),
                )
                .collect(),
            calls: await ctx.db.query("providerCalls").collect(),
            messages: await ctx.db
                .query("agentMessageDeliveries")
                .withIndex("by_run", (q) => q.eq("runId", f.runId))
                .collect(),
        };
    });
    const consultation = after.operations.find(
        (request) => request.input.kind === "consult_run_state",
    );
    expect(consultation).toMatchObject({
        operationVersion: 3,
        status: "completed",
        outcome: { kind: "success" },
    });
    if (consultation?.outcome?.kind !== "success")
        throw new Error("Missing retained consultation");
    expect(JSON.parse(consultation.outcome.valueJson).research).toEqual(
        after.research,
    );
    const {
        sourcePreparationBudget: beforeBudget,
        sourceQualificationAttemptCount: beforeAttempts,
        ...beforeAuthority
    } = before.run ?? {};
    const {
        sourcePreparationBudget: afterBudget,
        sourceQualificationAttemptCount: afterAttempts,
        ...afterAuthority
    } = after.run;
    expect(afterAuthority).toEqual(beforeAuthority);
    expect(afterBudget).toEqual({
        ...beforeBudget,
        dispatches: (beforeBudget?.dispatches ?? 0) + 2,
        work: (beforeBudget?.work ?? 0) + 2,
    });
    expect(afterAttempts).toBe((beforeAttempts ?? 0) + 2);
    expect(after.preparation).toEqual(before.preparation);
    expect(after.observation).toEqual(before.observation);
    expect(after.sourceMission).toEqual(before.sourceMission);
    expect(after.calls).toHaveLength(2);
    expect(after.calls.every((call) => call.status === "succeeded")).toBe(true);
    expect(
        after.messages.filter((message) => message.role === "assistant"),
    ).toHaveLength(1);
});

test("native Pi tool execution delivers >50 KiB and exact 64 KiB + wrapper history outcomes intact for both history tools without truncation", async () => {
    const { getAgentDefinition } = await import(
        "@convex/execution/agentCatalog"
    );
    const { modelOperationOutcome } = await import(
        "@convex/execution/agentDefinition"
    );
    const { PI_MISSION_EXTENSION, piToolMetadata } = await import(
        "@convex/integrations/modelInput"
    );
    const { MAX_OPERATION_RESULT_BYTES } = await import(
        "@convex/resourcePolicy"
    );
    const { BACKGROUND_CONTEXT } = await import(
        "@earendil-works/chord/context"
    );
    const { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } =
        await import("@earendil-works/pi-ai");
    const {
        createRegistry,
        defineExtension,
        defineTool,
        Harness,
        MemoryStorage,
    } = await import("@earendil-works/pi-durable");

    const definition = getAgentDefinition("workbench_v1");

    const runNativeToolOutcome = async (
        toolName: "consult_mission_state" | "consult_conversation",
        outcome: import("@convex/execution/agentDefinition").OperationOutcome,
    ) => {
        const operation = definition.operations[toolName];
        assert(operation);
        const faux = fauxProvider({
            models: [
                {
                    id: "native-output-check",
                    contextWindow: 128000,
                    maxTokens: 4096,
                },
            ],
        });
        let seenToolResultText: string | undefined;
        let seenToolResultError: boolean | undefined;
        faux.setResponses([
            () =>
                fauxAssistantMessage([fauxToolCall(toolName, {})], {
                    stopReason: "toolUse",
                }),
            (context) => {
                const toolMsg = context.messages.find(
                    (message) => message.role === "toolResult",
                );
                if (toolMsg && toolMsg.role === "toolResult") {
                    seenToolResultError = toolMsg.isError;
                    const first = toolMsg.content[0];
                    if (first && first.type === "text")
                        seenToolResultText = first.text;
                }
                return fauxAssistantMessage("Observed intact tool result.");
            },
        ]);
        const registry = createRegistry();
        registry.install(
            defineExtension({
                name: PI_MISSION_EXTENSION,
                tools: [
                    defineTool({
                        ...(await piToolMetadata(toolName, operation)),
                        async execute() {
                            const text = modelOperationOutcome(
                                definition,
                                outcome,
                            );
                            return {
                                output: [{ type: "text" as const, text }],
                                isError: outcome.kind !== "success",
                            };
                        },
                    }),
                ],
            }),
        );
        const models = createModels();
        models.setProvider(faux.provider);
        const harness = await Harness.open(
            new MemoryStorage(),
            { models, registry },
            BACKGROUND_CONTEXT,
        );
        try {
            const agent = {
                model: {
                    provider: faux.provider.id,
                    modelId: faux.getModel().id,
                },
                thinkingLevel: "off" as const,
                instructions: "Observe tool output.",
            };
            const root = await harness.root(BACKGROUND_CONTEXT, { agent });
            await root.configure(agent, BACKGROUND_CONTEXT);
            const submitted = await root.submit(
                {
                    type: "input",
                    content: "Check history",
                    requestId: toolName,
                },
                BACKGROUND_CONTEXT,
            );
            await submitted.wait(BACKGROUND_CONTEXT);
        } finally {
            await harness.close(BACKGROUND_CONTEXT);
        }
        return { text: seenToolResultText, isError: seenToolResultError };
    };

    for (const toolName of [
        "consult_mission_state",
        "consult_conversation",
    ] as const) {
        // Build an exact MAX_OPERATION_RESULT_BYTES (65,536 byte) canonical JSON payload with multiline content & continueCursor
        const cursor = "history:req_exact_boundary_12345";
        const baseObj =
            toolName === "consult_mission_state"
                ? {
                      kind: "consult_mission_state",
                      state: { version: 2 },
                      history: {
                          entries: [
                              {
                                  sequence: 1,
                                  offset: 0,
                                  totalCharacters: 90000,
                                  content: "",
                              },
                          ],
                          continueCursor: cursor,
                      },
                  }
                : {
                      entries: [
                          {
                              messageId: "msg_1",
                              role: "user",
                              offset: 0,
                              totalCharacters: 90000,
                              content: "",
                          },
                      ],
                      continueCursor: cursor,
                  };
        const baseBytes = Buffer.byteLength(JSON.stringify(baseObj));
        const multilinePrefix = "line1\nline2\n";
        const multilinePrefixEscapedBytes =
            Buffer.byteLength(JSON.stringify(multilinePrefix)) - 2;
        const padLen =
            MAX_OPERATION_RESULT_BYTES -
            baseBytes -
            multilinePrefixEscapedBytes;
        const exactContent = `${multilinePrefix}${"x".repeat(padLen)}`;
        const targetEntry =
            toolName === "consult_mission_state"
                ? (baseObj as { history: { entries: { content: string }[] } })
                      .history.entries[0]
                : (baseObj as { entries: { content: string }[] }).entries[0];
        assert(targetEntry);
        targetEntry.content = exactContent;
        const exactValueJson = JSON.stringify(baseObj);
        expect(Buffer.byteLength(exactValueJson)).toBe(
            MAX_OPERATION_RESULT_BYTES,
        );

        const expectedRendered = modelOperationOutcome(definition, {
            kind: "success",
            valueJson: exactValueJson,
        });
        expect(Buffer.byteLength(expectedRendered)).toBe(
            MAX_OPERATION_RESULT_BYTES + 27,
        );

        const delivered = await runNativeToolOutcome(toolName, {
            kind: "success",
            valueJson: exactValueJson,
        });
        expect(delivered.isError).toBe(false);
        expect(delivered.text).toBe(expectedRendered);
        const reparsed = JSON.parse(delivered.text ?? "");
        expect(reparsed).toEqual({ kind: "success", value: baseObj });

        // Noncanonical historical JSON (extra whitespace) is normalized to canonical JSON and delivered intact
        const noncanonical = `  ${exactValueJson.replace('"continueCursor":', '"continueCursor":   ')}  `;
        expect(Buffer.byteLength(noncanonical)).toBeGreaterThan(
            MAX_OPERATION_RESULT_BYTES,
        );
        const deliveredNoncanonical = await runNativeToolOutcome(toolName, {
            kind: "success",
            valueJson: noncanonical,
        });
        expect(deliveredNoncanonical.text).toBe(expectedRendered);

        // Refusal feedback renders cleanly through the same native tool boundary
        const refusalOutcome = {
            kind: "refused" as const,
            code: "history_cursor_invalid",
        };
        const deliveredRefusal = await runNativeToolOutcome(
            toolName,
            refusalOutcome,
        );
        expect(deliveredRefusal.isError).toBe(true);
        expect(deliveredRefusal.text).toBe(
            modelOperationOutcome(definition, refusalOutcome),
        );
    }

    // Oversized value that still exceeds capacity after canonical normalization is rejected explicitly
    expect(() =>
        modelOperationOutcome(definition, {
            kind: "success",
            valueJson: JSON.stringify({
                oversized: "z".repeat(MAX_OPERATION_RESULT_BYTES),
            }),
        }),
    ).toThrow(/operation_result_capacity/);
});

test("native_tool completion exposes submit_completion, accepts sole call with surrounding prose once, and settles session", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const f = await seedInspectedEvidence();
    await installModel(f.t, nativePiFixtureRoute, "saved_material_inspection");
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.args.runId,
        corpusRevisionId: f.args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "native-completion-sole-prose",
        expectedGeneration: 4,
    });
    await f.t.run((ctx) => ctx.db.patch(missionId, { definitionVersion: 4 }));
    const initialContext = await f.t.query(internal.execution.context.build, {
        missionId,
        expectedGeneration: 4,
    });
    assert(initialContext.kind === "ready");
    const parsedInitial = JSON.parse(initialContext.inputJson);
    expect(parsedInitial.constraints.completion).toEqual({
        format: "tool",
        tool: "submit_completion",
    });
    const captureId: string =
        parsedInitial.domain.availableMaterials[0].captureId;
    const readingReference: string =
        parsedInitial.domain.availableMaterials[0].readingReferences[0]
            .reference;
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId,
            expectedGeneration: 4,
            cause: "pre-read",
            input: {
                kind: "read_in_context",
                reference: readingReference,
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
    const seenBodies: Record<string, unknown>[] = [];
    const network = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
            seenBodies.push(JSON.parse(String(init?.body ?? "{}")));
            return new Response(
                [
                    `data: ${JSON.stringify({
                        id: "native-complete-1",
                        choices: [
                            {
                                index: 0,
                                delta: {
                                    role: "assistant",
                                    content:
                                        "I verified the capture and am submitting completion now.",
                                    tool_calls: [
                                        {
                                            index: 0,
                                            id: "call_complete_1",
                                            type: "function",
                                            function: {
                                                name: "submit_completion",
                                                arguments: JSON.stringify({
                                                    kind: "complete",
                                                    captureIds: [captureId],
                                                    workingNotes:
                                                        "Verified capture via native tool.",
                                                }),
                                            },
                                        },
                                    ],
                                },
                                finish_reason: null,
                            },
                        ],
                    })}`,
                    `data: ${JSON.stringify({
                        id: "native-complete-1",
                        choices: [
                            {
                                index: 0,
                                delta: {},
                                finish_reason: "tool_calls",
                            },
                        ],
                        usage: {
                            prompt_tokens: 15,
                            completion_tokens: 8,
                            total_tokens: 23,
                        },
                    })}`,
                    "data: [DONE]",
                    "",
                ].join("\n\n"),
                { headers: { "content-type": "text/event-stream" } },
            );
        },
    );
    vi.stubGlobal("fetch", network);
    await f.t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
        simulation: false,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const state = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(missionId),
        session: await ctx.db
            .query("piSessions")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .unique(),
        calls: await ctx.db.query("providerCalls").collect(),
        invocations: await ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .collect(),
    }));
    expect(network).toHaveBeenCalledOnce();
    const offeredTools = (
        seenBodies[0]?.tools as { function?: { name?: string } }[] | undefined
    )?.map((t) => t.function?.name);
    expect(offeredTools).toContain("submit_completion");
    expect(state.mission).toMatchObject({
        status: "completed",
        result: {
            kind: "saved_material_inspection_v1",
            captureIds: [captureId],
        },
        workingNotes: "Verified capture via native tool.",
    });
    expect(state.session?.settledSequence).toBe(state.session?.sequence);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]?.status).toBe("succeeded");
    expect(state.invocations).toHaveLength(1);
    expect(
        JSON.parse(state.invocations[0]?.receivedOutputJson ?? "null"),
    ).toMatchObject({
        kind: "completion_submission",
        call: { callId: "call_complete_1" },
    });
}, 30000);

function sseToolCalls(
    id: string,
    calls: { callId: string; name: string; rawArgs: string }[],
    content?: string,
) {
    return new Response(
        [
            `data: ${JSON.stringify({
                id,
                choices: [
                    {
                        index: 0,
                        delta: {
                            role: "assistant",
                            ...(content !== undefined ? { content } : {}),
                            tool_calls: calls.map((call, index) => ({
                                index,
                                id: call.callId,
                                type: "function",
                                function: {
                                    name: call.name,
                                    arguments: call.rawArgs,
                                },
                            })),
                        },
                        finish_reason: null,
                    },
                ],
            })}`,
            `data: ${JSON.stringify({
                id,
                choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
                usage: {
                    prompt_tokens: 12,
                    completion_tokens: 6,
                    total_tokens: 18,
                },
            })}`,
            "data: [DONE]",
            "",
        ].join("\n\n"),
        { headers: { "content-type": "text/event-stream" } },
    );
}

test("retained v3 does not expose submit_completion and refuses calling it without activating native_tool", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const f = await seedInspectedEvidence();
    await installModel(f.t, nativePiFixtureRoute, "saved_material_inspection");
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.args.runId,
        corpusRevisionId: f.args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "retained-v3-no-submit-completion",
        expectedGeneration: 4,
    });
    await f.t.run((ctx) => ctx.db.patch(missionId, { definitionVersion: 3 }));
    const initialContext = await f.t.query(internal.execution.context.build, {
        missionId,
        expectedGeneration: 4,
    });
    assert(initialContext.kind === "ready");
    const parsedInitial = JSON.parse(initialContext.inputJson);
    expect(parsedInitial.constraints.completion.format).toBe("json");
    const captureId: string =
        parsedInitial.domain.availableMaterials[0].captureId;
    const readingReference: string =
        parsedInitial.domain.availableMaterials[0].readingReferences[0]
            .reference;
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId,
            expectedGeneration: 4,
            cause: "pre-read-v3",
            input: { kind: "read_in_context", reference: readingReference },
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
    const seenBodies: Record<string, unknown>[] = [];
    let turn = 0;
    const network = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
            seenBodies.push(JSON.parse(String(init?.body ?? "{}")));
            turn++;
            if (turn === 1)
                return sseToolCalls("retained-v3-call", [
                    {
                        callId: "unknown_submit",
                        name: "submit_completion",
                        rawArgs: JSON.stringify({
                            kind: "complete",
                            captureIds: [captureId],
                        }),
                    },
                ]);
            return reply({ kind: "complete", captureIds: [captureId] });
        },
    );
    vi.stubGlobal("fetch", network);
    await f.t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
        simulation: false,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(network).toHaveBeenCalledTimes(2);
    const offeredTools = (
        seenBodies[0]?.tools as { function?: { name?: string } }[] | undefined
    )?.map((t) => t.function?.name);
    expect(offeredTools).not.toContain("submit_completion");
    const state = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(missionId),
        requests: await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .collect(),
        invocations: await ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .collect(),
    }));
    expect(state.mission?.status).toBe("completed");
    expect(
        state.requests.find(
            (r) =>
                r.input.kind === "invalid" &&
                r.input.name === "submit_completion",
        ),
    ).toMatchObject({
        outcome: { kind: "refused", code: "invalid_operation_input" },
    });
    expect(
        JSON.parse(state.invocations[0]?.receivedOutputJson ?? "null").kind,
    ).toBe("operations");
}, 30000);

test("definition binding refuses conflicting completion capabilities and reserved operation names", async () => {
    const { bindAgentDefinition, getAgentDefinition } = await import(
        "@convex/execution/agentCatalog"
    );
    const { SUBMIT_COMPLETION_TOOL } = await import(
        "@convex/execution/agentDefinition"
    );
    const textDefinition = getAgentDefinition("workbench_v1");
    const structuredDefinition = getAgentDefinition(
        "saved_material_inspection_v1",
        4,
    );
    expect(() =>
        bindAgentDefinition({
            ...textDefinition,
            textCompletion: (text) => ({ kind: "complete", text }),
            completionTransport: "native_tool",
        }),
    ).toThrow(/definition_contract_invalid/);
    const existingOp = Object.values(structuredDefinition.operations)[0];
    assert(existingOp);
    expect(() =>
        bindAgentDefinition({
            ...structuredDefinition,
            operations: {
                ...structuredDefinition.operations,
                [SUBMIT_COMPLETION_TOOL]: existingOp,
            },
        }),
    ).toThrow(/operation_definition_conflict/);
});

test("native completion refuses missing and oversized call identities", async () => {
    const { invocationStructureError } = await import(
        "@convex/execution/executionProtocol"
    );
    expect(
        invocationStructureError(
            {
                kind: "completion_submission",
                call: { callId: "", inputJson: "{}" },
            },
            true,
        ),
    ).toBe("invalid_tool_correlation");
    expect(
        invocationStructureError(
            {
                kind: "completion_submission",
                call: { callId: "x".repeat(161), inputJson: "{}" },
            },
            true,
        ),
    ).toBe("invalid_tool_correlation");
});

test("completion output remains bounded while accepted receipts stay intact", async () => {
    const { MAX_MODEL_OPERATION_OUTPUT_BYTES, renderCompletionToolOutcome } =
        await import("@convex/execution/agentDefinition");
    expect(() =>
        renderCompletionToolOutcome({
            kind: "refused",
            code: "completion_correction_required",
            diagnostic: "x".repeat(MAX_MODEL_OPERATION_OUTPUT_BYTES),
        }),
    ).toThrow(/operation_result_capacity/);
    expect(
        JSON.parse(renderCompletionToolOutcome({ kind: "accepted" })),
    ).toEqual({
        kind: "accepted",
    });
});

test("native completion corrects a missing call, malformed wire JSON and schema refusal before accepting one call", async () => {
    const { getAgentDefinition } = await import(
        "@convex/execution/agentCatalog"
    );
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const f = await seedInspectedEvidence();
    await installModel(f.t, nativePiFixtureRoute, "saved_material_inspection");
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.args.runId,
        corpusRevisionId: f.args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "native-completion-corrections",
        expectedGeneration: 4,
    });
    await f.t.run((ctx) => ctx.db.patch(missionId, { definitionVersion: 4 }));
    const initialContext = await f.t.query(internal.execution.context.build, {
        missionId,
        expectedGeneration: 4,
    });
    assert(initialContext.kind === "ready");
    const parsedInitial = JSON.parse(initialContext.inputJson);
    const captureId: string =
        parsedInitial.domain.availableMaterials[0].captureId;
    const readingReference: string =
        parsedInitial.domain.availableMaterials[0].readingReferences[0]
            .reference;
    const preRead = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 4,
        cause: "pre-read-v4",
        input: { kind: "read_in_context", reference: readingReference },
    });
    expect(
        (
            await f.t.action(internal.execution.operations.dispatch, {
                requestId: preRead,
                expectedGeneration: 4,
            })
        ).kind,
    ).toBe("success");

    const malformedRaw = `{"kind":"complete","captureIds":["${captureId}"],"workingNotes":"line1\nline2"}`;
    let turn = 0;
    const network = vi.fn(async () => {
        turn++;
        if (turn === 1)
            // Missing tool call (even though text looks like JSON, native_tool requires submit_completion).
            return reply({ kind: "complete", captureIds: [captureId] });
        if (turn === 2)
            // Malformed original wire JSON (unescaped literal newline repaired by SDK, rejected by original JSON parse).
            return sseToolCalls("native-malformed", [
                {
                    callId: "call_malformed",
                    name: "submit_completion",
                    rawArgs: malformedRaw,
                },
            ]);
        if (turn === 3)
            // Schema-invalid arguments (wrong field type).
            return sseToolCalls("native-schema-bad", [
                {
                    callId: "call_schema_bad",
                    name: "submit_completion",
                    rawArgs: JSON.stringify({
                        kind: "complete",
                        captureIds: ["not-a-capture-id"],
                    }),
                },
            ]);
        return sseToolCalls("native-valid", [
            {
                callId: "call_valid",
                name: "submit_completion",
                rawArgs: JSON.stringify({
                    kind: "complete",
                    captureIds: [captureId],
                }),
            },
        ]);
    });
    vi.stubGlobal("fetch", network);
    await f.t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
        simulation: false,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(network).toHaveBeenCalledTimes(4);
    const state = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(missionId),
        invocations: await ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .collect(),
        calls: await ctx.db.query("providerCalls").collect(),
    }));
    expect(state.mission).toMatchObject({
        status: "completed",
        result: {
            kind: "saved_material_inspection_v1",
            captureIds: [captureId],
        },
    });
    // Provider receipts remain status: "succeeded" independently of domain/schema refusals.
    expect(state.calls).toHaveLength(4);
    expect(state.calls.every((c) => c.status === "succeeded")).toBe(true);
    expect(
        JSON.parse(state.invocations[0]?.receivedOutputJson ?? "null"),
    ).toEqual({ kind: "completion_submission", call: null });
    expect(state.invocations[0]?.blockCode).toBe(
        "completion_correction_required",
    );
    // Original malformed wire JSON is retained unchanged (never SDK-repaired JSON).
    expect(
        JSON.parse(state.invocations[1]?.receivedOutputJson ?? "null"),
    ).toEqual({
        kind: "completion_submission",
        call: { callId: "call_malformed", inputJson: malformedRaw },
    });
    expect(state.invocations[1]?.blockCode).toBe(
        "completion_correction_required",
    );
    expect(state.invocations[2]?.blockCode).toBe(
        "completion_correction_required",
    );
    expect(state.invocations[3]?.blockCode).toBeUndefined();
    expect(
        getAgentDefinition("saved_material_inspection_v1", 4)
            .completionTransport,
    ).toBe("native_tool");
}, 30000);

test("native_tool completion handles mixed rounds (completion before and after operations) and duplicate completions while executing authorized work once", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const f = await seedInspectedEvidence();
    await installModel(f.t, nativePiFixtureRoute, "saved_material_inspection");
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.args.runId,
        corpusRevisionId: f.args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "native-completion-mixed-and-dup",
        expectedGeneration: 4,
    });
    await f.t.run((ctx) => ctx.db.patch(missionId, { definitionVersion: 4 }));
    const initialContext = await f.t.query(internal.execution.context.build, {
        missionId,
        expectedGeneration: 4,
    });
    assert(initialContext.kind === "ready");
    const parsedInitial = JSON.parse(initialContext.inputJson);
    const captureId: string =
        parsedInitial.domain.availableMaterials[0].captureId;
    const readingReference: string =
        parsedInitial.domain.availableMaterials[0].readingReferences[0]
            .reference;

    let turn = 0;
    const network = vi.fn(async () => {
        turn++;
        if (turn === 1)
            // Completion BEFORE authorized read_in_context.
            return sseToolCalls("mixed-before", [
                {
                    callId: "comp_before",
                    name: "submit_completion",
                    rawArgs: JSON.stringify({
                        kind: "complete",
                        captureIds: [captureId],
                    }),
                },
                {
                    callId: "read_1",
                    name: "read_in_context",
                    rawArgs: JSON.stringify({ reference: readingReference }),
                },
            ]);
        if (turn === 2)
            // Authorized search_available_material BEFORE completion.
            return sseToolCalls("mixed-after", [
                {
                    callId: "search_1",
                    name: "search_available_material",
                    rawArgs: JSON.stringify({
                        reference: readingReference,
                        query: "revenue",
                    }),
                },
                {
                    callId: "comp_after",
                    name: "submit_completion",
                    rawArgs: JSON.stringify({
                        kind: "complete",
                        captureIds: [captureId],
                    }),
                },
            ]);
        if (turn === 3)
            // Duplicate submit_completion calls in the same turn.
            return sseToolCalls("dup-comp", [
                {
                    callId: "dup_1",
                    name: "submit_completion",
                    rawArgs: JSON.stringify({
                        kind: "complete",
                        captureIds: [captureId],
                    }),
                },
                {
                    callId: "dup_2",
                    name: "submit_completion",
                    rawArgs: JSON.stringify({
                        kind: "complete",
                        captureIds: [captureId],
                    }),
                },
            ]);
        return sseToolCalls("sole-final", [
            {
                callId: "sole_final",
                name: "submit_completion",
                rawArgs: JSON.stringify({
                    kind: "complete",
                    captureIds: [captureId],
                }),
            },
        ]);
    });
    vi.stubGlobal("fetch", network);
    await f.t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
        simulation: false,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(network).toHaveBeenCalledTimes(4);
    const state = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(missionId),
        requests: await ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .collect(),
        session: await ctx.db
            .query("piSessions")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .unique(),
    }));
    expect(state.mission).toMatchObject({
        status: "completed",
        state: {
            kind: "saved_material_inspection_v1",
            inspectedCaptureIds: [captureId],
        },
        result: {
            kind: "saved_material_inspection_v1",
            captureIds: [captureId],
        },
    });
    expect(state.session?.settledSequence).toBe(state.session?.sequence);
    // Authorized read_in_context and search_available_material each executed once with real retained results.
    const reads = state.requests.filter(
        (r) => r.input.kind === "read_in_context",
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]?.outcome?.kind).toBe("success");
    const searches = state.requests.filter(
        (r) => r.input.kind === "search_available_material",
    );
    expect(searches).toHaveLength(1);
    expect(searches[0]?.outcome?.kind).toBe("success");
    // Mixed/duplicate submit_completion calls became ordinary retained invalid-request refusals.
    const refusedCompletions = state.requests.filter(
        (r) =>
            r.input.kind === "invalid" && r.input.name === "submit_completion",
    );
    expect(refusedCompletions.length).toBeGreaterThanOrEqual(1);
    expect(
        refusedCompletions.every(
            (r) =>
                r.outcome?.kind === "refused" &&
                r.outcome.code === "completion_must_be_sole_call",
        ),
    ).toBe(true);
}, 30000);

test("native_tool completion treats missing original wire arguments as a transport-integrity failure", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const f = await seedInspectedEvidence();
    await installModel(f.t, nativePiFixtureRoute, "saved_material_inspection");
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.args.runId,
        corpusRevisionId: f.args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "native-missing-wire-args",
        expectedGeneration: 4,
    });
    await f.t.run((ctx) => ctx.db.patch(missionId, { definitionVersion: 4 }));
    // Tool call arrives with empty arguments stream (missing original wire arguments) -> transport failure, never repaired.
    const network = vi.fn(
        async () =>
            new Response(
                [
                    `data: ${JSON.stringify({
                        id: "missing-wire",
                        choices: [
                            {
                                index: 0,
                                delta: {
                                    role: "assistant",
                                    tool_calls: [
                                        {
                                            index: 0,
                                            id: "call_no_args",
                                            type: "function",
                                            function: {
                                                name: "submit_completion",
                                            },
                                        },
                                    ],
                                },
                                finish_reason: null,
                            },
                        ],
                    })}`,
                    `data: ${JSON.stringify({
                        id: "missing-wire",
                        choices: [
                            {
                                index: 0,
                                delta: {},
                                finish_reason: "tool_calls",
                            },
                        ],
                        usage: { prompt_tokens: 10, completion_tokens: 4 },
                    })}`,
                    "data: [DONE]",
                    "",
                ].join("\n\n"),
                { headers: { "content-type": "text/event-stream" } },
            ),
    );
    vi.stubGlobal("fetch", network);
    await f.t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
        simulation: false,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(network).toHaveBeenCalledOnce();
    const state = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(missionId),
        calls: await ctx.db.query("providerCalls").collect(),
    }));
    expect(state.mission).toMatchObject({
        status: "blocked",
        blockCode: "invalid_output",
    });
    expect(state.calls[0]).toMatchObject({
        status: "failed",
        diagnostic: { reason: "tool_arguments_invalid" },
    });
}, 30000);

test("completion refusal capacity includes its diagnostic wrapper", async () => {
    const definition = await import("@convex/execution/agentDefinition");
    const feedback = {
        code: "invalid_completion",
        issues: [{ path: "needs", expected: "" }],
    };
    assert(feedback.issues[0]);
    feedback.issues[0].expected = "x".repeat(
        65400 - new TextEncoder().encode(JSON.stringify(feedback)).length,
    );
    expect(new TextEncoder().encode(JSON.stringify(feedback)).length).toBe(
        65400,
    );
    expect(() =>
        definition.renderCompletionToolRefusal(
            "completion_correction_required",
            feedback,
        ),
    ).toThrow("operation_result_capacity");
    expect(
        JSON.parse(
            definition.renderCompletionToolRefusal("stale_instructions"),
        ),
    ).toMatchObject({
        kind: "refused",
        code: "stale_instructions",
        diagnostic: expect.stringContaining("analyst"),
    });
});

test("nonterminal native tool turns avoid terminal invocation lookups", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const f = await seedInspectedEvidence();
    await installModel(f.t, nativePiFixtureRoute, "saved_material_inspection");
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        corpusRevisionId: f.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "nonterminal-lookup",
        expectedGeneration: 4,
    });
    const context = await f.t.query(internal.execution.context.build, {
        missionId,
        expectedGeneration: 4,
    });
    assert(context.kind === "ready");
    const material = JSON.parse(context.inputJson).domain.availableMaterials[0];
    let turn = 0;
    vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
            ++turn === 1
                ? sseToolCalls("read", [
                      {
                          callId: "read",
                          name: "read_in_context",
                          rawArgs: JSON.stringify({
                              reference:
                                  material.readingReferences[0].reference,
                          }),
                      },
                  ])
                : sseToolCalls("complete", [
                      {
                          callId: "done",
                          name: "submit_completion",
                          rawArgs: JSON.stringify({
                              kind: "complete",
                              captureIds: [material.captureId],
                          }),
                      },
                  ]),
        ),
    );
    await f.t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
        simulation: false,
    });
    let nonterminalLookups = 0;
    const adoptionInputs: unknown[] = [];
    const { nodeActionGenerationDeadline } = await import(
        "@convex/resourcePolicy"
    );
    await f.t.action((ctx) =>
        runPiMission(
            {
                ...ctx,
                runMutation: async (reference, ...args) => {
                    if (
                        getFunctionName(reference) ===
                        "execution/invocations:finish"
                    )
                        adoptionInputs.push(args[0]);
                    return ctx.runMutation(reference, ...args);
                },
                runQuery: async (reference, ...args) => {
                    if (
                        getFunctionName(reference) ===
                            "execution/piControl:nativeInvocation" &&
                        (await f.t.run((dbCtx) => dbCtx.db.get(missionId)))
                            ?.status !== "completed"
                    )
                        nonterminalLookups++;
                    return ctx.runQuery(reference, ...args);
                },
            },
            { missionId, expectedGeneration: 4 },
            "lookup-worker",
            nodeActionGenerationDeadline(Date.now()),
        ),
    );
    expect((await f.t.run((ctx) => ctx.db.get(missionId)))?.status).toBe(
        "completed",
    );
    expect(turn).toBe(2);
    expect(nonterminalLookups).toBe(0);
    expect(adoptionInputs).toHaveLength(2);
    for (const input of adoptionInputs)
        expect(input).not.toHaveProperty("rawOutputJson");
    const invocations = await f.t.run((ctx) =>
        ctx.db
            .query("agentInvocations")
            .filter((q) => q.eq(q.field("missionId"), missionId))
            .collect(),
    );
    const terminal = invocations.find(
        (invocation) => invocation.nativeCompletion,
    );
    assert(terminal?.rawOutputJson);
    expect(JSON.parse(terminal.rawOutputJson).backendOutputJson).toContain(
        '"done"',
    );
});

test.each([
    "stale_instructions",
    "invalid_arguments",
    "pending_operations",
] as const)("native conversation completion recovers from %s through the real tool loop", async (scenario) => {
    const { seedConversation } = await import(
        "@/__tests__/setup/agent-harness"
    );
    const { nodeActionGenerationDeadline } = await import(
        "@convex/resourcePolicy"
    );
    const { conversationValidationV3Definition } = await import(
        "@convex/domain/conversationValidation"
    );
    vi.useFakeTimers();
    const f = await seedConversation(true);
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "native-validation",
        text: "Validate the active request",
        delivery: "queue",
    });
    const turnId = await f.t.mutation(
        internal.execution.conversations.claimTurn,
        { runId: f.runId },
    );
    assert(turnId);
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        conversationTurnId: turnId,
        definitionId: "conversation_validation_v1",
        scope: { kind: "conversation_validation_v1" },
        requestKey: `native-validation:${scenario}`,
        expectedGeneration: 1,
    });
    await f.t.run((ctx) => ctx.db.patch(missionId, { definitionVersion: 3 }));
    await f.t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 1,
        simulation: true,
    });
    const replyText =
        scenario === "pending_operations"
            ? "Validated active request. ".repeat(3000).trim()
            : "Validated active request.";
    let turns = 0;
    let waitingId:
        | import("@convex/_generated/dataModel").Id<"agentOperationRequests">
        | undefined;
    const originalSimulation = conversationValidationV3Definition.simulate;
    // This scripted model replaces only generation; domain completion and all effects remain real.
    const observedInputs = new Map<string, number>();
    conversationValidationV3Definition.simulate = (input) => {
        const key = JSON.stringify(input);
        let turn = observedInputs.get(key);
        if (turn === undefined) {
            turn = ++turns;
            observedInputs.set(key, turn);
        }
        return {
            kind: "operations",
            requests: [
                {
                    callId: `complete:${turn}`,
                    name: "submit_completion",
                    inputJson: JSON.stringify({
                        kind: "complete",
                        text:
                            scenario === "invalid_arguments" && turn === 1
                                ? {}
                                : replyText,
                    }),
                },
            ],
        };
    };
    let injected = false;
    let stagedSimulation = false;
    let adoptedSimulationByReference = false;
    const run = () =>
        f.t.action((ctx) =>
            runPiMission(
                {
                    ...ctx,
                    runMutation: async (reference, ...args) => {
                        if (
                            scenario === "pending_operations" &&
                            getFunctionName(reference) ===
                                "execution/invocationLifecycle:retainOutput"
                        ) {
                            const observation = args[0] as FunctionArgs<
                                typeof internal.execution.invocationLifecycle.retainOutput
                            >;
                            if (
                                observation.responseTextId &&
                                observation.observableReplyTextId
                            ) {
                                expect(
                                    observation.responseJson,
                                ).toBeUndefined();
                                expect(
                                    observation.observableReplyJson,
                                ).toBeUndefined();
                                stagedSimulation = true;
                            }
                        }
                        if (
                            getFunctionName(reference) ===
                                "execution/invocations:finish" &&
                            !injected &&
                            scenario !== "invalid_arguments"
                        ) {
                            if (scenario === "pending_operations") {
                                const finish = args[0] as FunctionArgs<
                                    typeof internal.execution.invocations.finish
                                >;
                                expect(finish.response).toBeUndefined();
                                expect(finish.rawOutputJson).toBeUndefined();
                                expect(finish.preparedReply).toBeDefined();
                                adoptedSimulationByReference = true;
                            }
                            injected = true;
                            if (scenario === "stale_instructions")
                                await f.client.mutation(
                                    api.execution.conversations.submit,
                                    {
                                        runId: f.runId,
                                        requestKey: "steer-native-validation",
                                        text: "Use the updated request",
                                        delivery: "steer",
                                        turnId,
                                    },
                                );
                            else {
                                waitingId = await f.t.mutation(
                                    internal.execution.operations.enqueue,
                                    {
                                        missionId,
                                        expectedGeneration: 1,
                                        cause: "deferred-validation",
                                        input: {
                                            kind: "wait_fixture_result",
                                            value: 7,
                                        },
                                    },
                                );
                                expect(
                                    await f.t.action(
                                        internal.execution.operations.dispatch,
                                        {
                                            requestId: waitingId,
                                            expectedGeneration: 1,
                                        },
                                    ),
                                ).toMatchObject({ kind: "waiting" });
                            }
                        }
                        return ctx.runMutation(reference, ...args);
                    },
                },
                { missionId, expectedGeneration: 1 },
                "validation-worker",
                nodeActionGenerationDeadline(Date.now()),
            ),
        );
    try {
        await run();
        if (scenario === "pending_operations") {
            expect(
                (await f.t.run((ctx) => ctx.db.get(missionId)))?.status,
            ).not.toBe("completed");
            const deferredId = waitingId;
            assert(deferredId);
            expect(
                (await f.t.run((ctx) => ctx.db.get(deferredId)))?.status,
            ).toBe("waiting");
            await f.t.mutation(
                internal.domain.conversationValidation.completeDeferred,
                { requestId: deferredId, expectedGeneration: 1 },
            );
            await run();
            expect(turns).toBe(1);
            expect(stagedSimulation).toBe(true);
            expect(adoptedSimulationByReference).toBe(true);
            expect(
                await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
            ).toEqual([]);
            expect(
                (await f.t.run((ctx) => ctx.db.get(deferredId)))?.outcome,
            ).toEqual({ kind: "success", valueJson: '{"value":14}' });
        } else expect(turns).toBe(2);
        const state = await f.t.run(async (ctx) => ({
            mission: await ctx.db.get(missionId),
            events: await ctx.db
                .query("agentExecutionEvents")
                .withIndex("by_mission_and_sequence", (q) =>
                    q.eq("missionId", missionId),
                )
                .collect(),
            commits: await ctx.db.query("piCommits").collect(),
        }));
        expect(state.mission).toMatchObject({
            status: "completed",
            textualOutcome: { kind: "conversation_validation_v1" },
        });
        const history = await f.client.query(
            api.execution.conversations.listMessages,
            {
                runId: f.runId,
                paginationOpts: { numItems: 20, cursor: null },
            },
        );
        expect(
            (await readMessageBodies(f.client, history.page))
                .filter((entry) => entry.role === "assistant")
                .map((entry) => entry.text),
        ).toEqual([replyText]);
        if (scenario !== "invalid_arguments")
            expect(state.events.some((event) => event.code === scenario)).toBe(
                true,
            );
        else
            expect(
                state.commits.map((commit) => commit.payload).join("\n"),
            ).toContain("invalid_arguments");
    } finally {
        conversationValidationV3Definition.simulate = originalSimulation;
    }
});
