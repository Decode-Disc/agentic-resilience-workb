import { api, internal } from "@convex/_generated/api";
import { afterEach, assert, expect, test, vi } from "vitest";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import { readConversationPageWithBodies } from "@/__tests__/setup/retained-messages";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});
const encode = (value: unknown) =>
    new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
function response(content: string | Record<string, unknown>) {
    const call =
        typeof content === "string"
            ? { role: "assistant", content }
            : {
                  role: "assistant",
                  tool_calls: [
                      {
                          index: 0,
                          id: "saved-framing-call",
                          type: "function",
                          function: {
                              name: "adjust_framing",
                              arguments: JSON.stringify({
                                  ...content,
                                  eventBasis: { kind: "none" },
                              }),
                          },
                      },
                  ],
              };
    return new Response(
        new ReadableStream({
            start(controller) {
                controller.enqueue(
                    encode({
                        id: "diagnostic-reply",
                        choices: [
                            { index: 0, delta: call, finish_reason: null },
                        ],
                    }),
                );
                controller.enqueue(
                    encode({
                        choices: [
                            {
                                index: 0,
                                delta: {},
                                finish_reason:
                                    typeof content === "string"
                                        ? "stop"
                                        : "tool_calls",
                            },
                        ],
                        usage: {
                            prompt_tokens: 10,
                            completion_tokens: 5,
                            cost: 0.000001,
                        },
                    }),
                );
                controller.enqueue(
                    new TextEncoder().encode("data: [DONE]\n\n"),
                );
                controller.close();
            },
        }),
        { headers: { "content-type": "text/event-stream" } },
    );
}

test("a new analyst message preserves saved effects after an incomplete native SSE reply", async () => {
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    let count = 0;
    vi.stubEnv("OPENROUTER_API_KEY", "unpaid-diagnostic-fixture");
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
            if (init?.method === "GET")
                return Response.json({
                    data: {
                        id: "partial-generation-id",
                        total_cost: 0.0002137,
                    },
                });
            count++;
            if (count === 1)
                return response({
                    content: {
                        scope: "Saved insurer switching scope",
                        questions: [
                            {
                                id: "q1",
                                text: "What constrains an insurer switching claims platforms?",
                                shortLabel: "Switching",
                                rationale: "A hypothesis to investigate.",
                            },
                        ],
                    },
                });
            if (count === 2) {
                let emitted = false;
                return new Response(
                    new ReadableStream({
                        pull(controller) {
                            if (emitted) {
                                controller.error(
                                    new DOMException(
                                        "Simulated incomplete provider stream",
                                        "AbortError",
                                    ),
                                );
                                return;
                            }
                            emitted = true;
                            controller.enqueue(
                                encode({
                                    id: "partial-generation-id",
                                    choices: [
                                        {
                                            index: 0,
                                            delta: {
                                                role: "assistant",
                                                content:
                                                    "Partial unconfirmed answer",
                                            },
                                            finish_reason: null,
                                        },
                                    ],
                                }),
                            );
                        },
                    }),
                    {
                        headers: {
                            "content-type": "text/event-stream",
                            "x-request-id": "incomplete-stream-request",
                            "x-generation-id": "partial-generation-id",
                        },
                    },
                );
            }
            if (count === 3) {
                expect(String(init?.body)).not.toContain(
                    "Stream ended without finish_reason",
                );
                return response(
                    "The saved program is retained; this is a new response.",
                );
            }
            throw new Error("Unexpected diagnostic provider replay");
        }),
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    await vi.advanceTimersByTimeAsync(5000);
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const blocked = await client.query(api.execution.conversations.get, {
        runId,
    });
    expect(blocked.execution).toMatchObject({
        status: "blocked",
        code: "attempt_outcome_unknown",
    });
    assert(blocked.activeTurn);
    const saved = await client.query(api.framing.get, { runId });
    assert(saved);
    expect(saved.content.scope).toBe("Saved insurer switching scope");
    const before = await t.run(async (ctx) => ({
        calls: await ctx.db.query("providerCalls").collect(),
        session: await ctx.db.query("piSessions").first(),
        requests: await ctx.db.query("agentOperationRequests").collect(),
    }));
    assert(before.session);
    expect(count).toBe(2);
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "new-intent-after-unknown",
        delivery: "queue",
        text: "Keep the saved program unchanged and explain what is already saved.",
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const after = await client.query(api.execution.conversations.get, {
        runId,
    });
    const retained = await t.run(async (ctx) => ({
        calls: await ctx.db.query("providerCalls").collect(),
        sessions: await ctx.db.query("piSessions").collect(),
        requests: await ctx.db.query("agentOperationRequests").collect(),
    }));
    expect(after.activeTurn).toBeNull();
    expect(after.queuedCount).toBe(0);
    expect(count).toBe(3);
    expect(await client.query(api.framing.get, { runId })).toEqual(saved);
    expect(retained.requests).toEqual(before.requests);
    expect(retained.sessions).toHaveLength(1);
    expect(retained.sessions[0]?._id).toBe(before.session._id);
    expect(retained.sessions[0]?.settledSequence).toBe(
        retained.sessions[0]?.sequence,
    );
    const unknown = before.calls.find((c) => c.status === "started");
    assert(unknown);
    expect(unknown).toMatchObject({
        transportDiagnostic: {
            phase: "provider_transport",
            message: "Stream ended without finish_reason",
        },
    });
    expect(unknown.providerObservation).toMatchObject({
        generationId: "partial-generation-id",
        httpStatus: 200,
        requestId: "incomplete-stream-request",
    });
    expect(retained.calls.find((c) => c._id === unknown._id)).toEqual(unknown);
    expect(
        retained.calls.filter((c) => c.missionId === unknown.missionId),
    ).toHaveLength(2);
}, 30000);

test.each([
    ["incomplete stream", "Stream ended without finish_reason", 200],
    ["connection failure", "Connection error.", undefined],
] as const)("a native %s retains its cause without inventing a generation identity or replay", async (kind, message, status) => {
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    vi.stubEnv("OPENROUTER_API_KEY", "offline-native-diagnostic");
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
        expect(init?.method).not.toBe("GET");
        if (kind === "connection failure")
            throw new Error("Injected offline connection failure");
        return new Response(
            `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Unconfirmed fragment" }, finish_reason: null }] })}\n\n`,
            {
                headers: { "content-type": "text/event-stream" },
            },
        );
    });
    vi.stubGlobal("fetch", fetchMock);
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const state = await client.query(api.execution.conversations.get, {
        runId,
    });
    expect(state.execution).toMatchObject({
        status: "blocked",
        code: "attempt_outcome_unknown",
    });
    const calls = await t.run((ctx) => ctx.db.query("providerCalls").collect());
    expect(calls).toHaveLength(1);
    const call = calls[0];
    assert(call);
    expect(call.status).toBe("started");
    expect(call.transportDiagnostic).toMatchObject({
        phase: "provider_transport",
        message,
    });
    expect(call.providerObservation?.generationId).toBeUndefined();
    expect(call.providerObservation?.httpStatus).toBe(status);
    expect(call.reportedCost).toBeUndefined();
    expect(call.billing).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("a native deadline retains its TimeoutError and header-only identity for billing without replay", async () => {
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    vi.stubEnv("OPENROUTER_API_KEY", "offline-native-deadline");
    const deadline = new AbortController();
    const timeout = vi
        .spyOn(AbortSignal, "timeout")
        .mockReturnValue(deadline.signal);
    let generations = 0;
    let billingReads = 0;
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (url, init) => {
            if (init?.method === "GET") {
                expect(String(url)).toContain("id=header-only-generation");
                billingReads++;
                return Response.json({
                    data: {
                        id: "header-only-generation",
                        total_cost: 0.0002137,
                    },
                });
            }
            generations++;
            return new Response(
                new ReadableStream({
                    pull(controller) {
                        deadline.abort(
                            new DOMException(
                                "Native request deadline elapsed",
                                "TimeoutError",
                            ),
                        );
                        controller.error(deadline.signal.reason);
                    },
                }),
                {
                    headers: {
                        "content-type": "text/event-stream",
                        "x-generation-id": "header-only-generation",
                        "x-request-id": "header-only-request",
                    },
                },
            );
        }),
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const state = await client.query(api.execution.conversations.get, {
        runId,
    });
    expect(state.execution).toMatchObject({
        status: "blocked",
        code: "attempt_outcome_unknown",
    });
    const calls = await t.run((ctx) => ctx.db.query("providerCalls").collect());
    expect(calls).toHaveLength(1);
    const call = calls[0];
    assert(call);
    expect(call).toMatchObject({
        status: "started",
        providerObservation: {
            generationId: "header-only-generation",
            requestId: "header-only-request",
            httpStatus: 200,
        },
        transportDiagnostic: {
            phase: "provider_transport",
            name: "TimeoutError",
            message: expect.stringContaining("Native request deadline elapsed"),
        },
        billing: { state: "pending" },
    });
    expect(call.reportedCost).toBeUndefined();
    timeout.mockRestore();
    await vi.advanceTimersByTimeAsync(5000);
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(await t.run((ctx) => ctx.db.get(call._id))).toMatchObject({
        status: "started",
        billing: { state: "confirmed" },
        reportedCost: 0.0002137,
    });
    expect(generations).toBe(1);
    expect(billingReads).toBe(1);
});

test("native provider errors retain a bounded protected cause without exposing credentials to the analyst", async () => {
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    vi.stubEnv("OPENROUTER_API_KEY", "offline-error-redaction");
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async () =>
            Response.json(
                {
                    error: {
                        message: `Bearer fixture-private-token api_key=fixture-secret-value ${"extra details ".repeat(300)}`,
                    },
                },
                { status: 400 },
            ),
        ),
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const calls = await t.run((ctx) => ctx.db.query("providerCalls").collect());
    expect(calls).toHaveLength(1);
    const diagnostic = calls[0]?.transportDiagnostic;
    assert(diagnostic);
    expect(diagnostic.phase).toBe("provider_transport");
    expect(diagnostic.message.length).toBeLessThanOrEqual(512);
    expect(diagnostic.message).toContain("[redacted]");
    expect(JSON.stringify(calls)).not.toContain("fixture-private-token");
    expect(JSON.stringify(calls)).not.toContain("fixture-secret-value");
    const conversation = await client.query(api.execution.conversations.get, {
        runId,
    });
    expect(JSON.stringify(conversation)).not.toContain(diagnostic.message);
});

test("an admitted native reply exposes committed public text before EOF and publishes once after settlement", async () => {
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    vi.stubEnv("OPENROUTER_API_KEY", "offline-progress-fixture");
    let upstream: ReadableStreamDefaultController<Uint8Array> | undefined;
    let upstreamClosed = false;
    const partial = "I am examining the proposed workflow.";
    const continuation = "\n\nThe program remains a proposal.";
    let calls = 0;
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
            calls++;
            return new Response(
                new ReadableStream<Uint8Array>({
                    start(controller) {
                        upstream = controller;
                        controller.enqueue(
                            encode({
                                id: "public-progress-fixture",
                                choices: [
                                    {
                                        index: 0,
                                        delta: {
                                            role: "assistant",
                                            content: partial,
                                            reasoning:
                                                "Private reasoning must remain private.",
                                        },
                                        finish_reason: null,
                                    },
                                ],
                            }),
                        );
                    },
                    cancel() {
                        upstreamClosed = true;
                    },
                }),
                { headers: { "content-type": "text/event-stream" } },
            );
        }),
    );
    const execution = t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    try {
        await vi.waitFor(
            async () => {
                const snapshot = await client.query(api.workbench.snapshot, {
                    runId,
                });
                expect(snapshot.activeWork?.turn).toMatchObject({
                    status: "active",
                });
                expect(
                    await client.query(api.workbench.responsePreview, {
                        runId,
                    }),
                ).toMatchObject({ text: partial });
            },
            { timeout: 5000 },
        );
        const history = await readConversationPageWithBodies(client, {
            runId,
            paginationOpts: { numItems: 20, cursor: null },
        });
        expect(
            history.page.filter((message) => message.role === "assistant"),
        ).toEqual([]);
        expect(calls).toBe(1);
        const observed = await client.query(api.workbench.responsePreview, {
            runId,
        });
        assert(observed);
        const storage = await t.run(async (ctx) => ({
            session: await ctx.db.query("piSessions").first(),
            commits: await ctx.db.query("piCommits").collect(),
        }));
        assert(storage.session);
        const lease = {
            sessionId: storage.session._id,
            missionId: storage.session.missionId,
            writer: storage.session.writer,
            epoch: storage.session.epoch,
            generation: storage.session.generation,
        };
        await expect(
            t.mutation(internal.execution.piStore.publishPreview, {
                ...lease,
                writer: "superseded-writer",
                invocationId: observed.invocationId,
                sequence: observed.sequence,
                text: "Uncommitted replacement",
            }),
        ).rejects.toThrow("pi_writer_fenced");
        expect(
            await t.mutation(internal.execution.piStore.publishPreview, {
                ...lease,
                invocationId: observed.invocationId,
                sequence: storage.session.sequence + 1,
                text: "Uncommitted replacement",
            }),
        ).toBe(false);
        expect(
            await client.query(api.workbench.responsePreview, { runId }),
        ).toEqual(observed);
        expect(JSON.stringify(observed)).not.toContain("Private reasoning");
        upstream?.enqueue(
            encode({
                choices: [
                    {
                        index: 0,
                        delta: { content: continuation },
                        finish_reason: null,
                    },
                ],
            }),
        );
        await vi.waitFor(
            async () => {
                expect(
                    await client.query(api.workbench.responsePreview, {
                        runId,
                    }),
                ).toMatchObject({ text: partial + continuation });
            },
            { timeout: 5000 },
        );
    } finally {
        if (!upstreamClosed) {
            upstream?.enqueue(
                encode({
                    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                    usage: {
                        prompt_tokens: 10,
                        completion_tokens: 10,
                        cost: 0.000001,
                    },
                }),
            );
            upstream?.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            upstream?.close();
        }
        await execution;
    }
    const history = await readConversationPageWithBodies(client, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(
        history.page.filter((message) => message.role === "assistant"),
    ).toEqual([
        expect.objectContaining({
            text: partial + continuation,
            status: "processed",
        }),
    ]);
    expect(calls).toBe(1);
}, 15000);

test("the admitted local simulation respects the current Sources question capacity", async () => {
    const { activateSourcesMission } = await import(
        "@/__tests__/setup/sources-mission"
    );
    const { SOURCES_QUALIFICATION_ENVELOPE } = await import(
        "@convex/runWorkspace"
    );
    activateSourcesMission(SOURCES_QUALIFICATION_ENVELOPE);
    const { t, client, runId } = await seedWorkbench(true);
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const snapshot = await client.query(api.workbench.snapshot, { runId });
    expect(snapshot.researchStart.questionCapacity).toBe(3);
    expect(snapshot.framing?.content.questions).toHaveLength(3);
    const history = await readConversationPageWithBodies(client, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(
        history.page.filter((message) => message.role === "assistant"),
    ).toEqual([
        expect.objectContaining({
            text: expect.stringContaining(
                "Simulation: the research program is saved.",
            ),
        }),
    ]);
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});
