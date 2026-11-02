import { api } from "@convex/_generated/api";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedWorkbench } from "@/__tests__/setup/workbench";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";

afterEach(() => {
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
                              arguments: JSON.stringify(content),
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
                    { headers: { "content-type": "text/event-stream" } },
                );
            }
            if (count === 3)
                return response(
                    "The saved program is retained; this is a new response.",
                );
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
    expect(unknown.providerObservation).toMatchObject({
        generationId: "partial-generation-id",
    });
    expect(retained.calls.find((c) => c._id === unknown._id)).toEqual(unknown);
    expect(
        retained.calls.filter((c) => c.missionId === unknown.missionId),
    ).toHaveLength(2);
}, 30000);
