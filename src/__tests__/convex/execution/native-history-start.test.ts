import { api } from "@convex/_generated/api";
import { afterEach, assert, expect, test, vi } from "vitest";
import { nativePiFixtureRoute } from "@/__tests__/setup/pi-native";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});
test.each([
    "consult_conversation",
    "consult_mission_state",
] as const)("%s accepts the documented empty first-page marker through the native invocation boundary", async (name) => {
    let count = 0;
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
            count++;
            if (count > 2) throw new Error("History restart did not settle");
            const delta =
                count === 1
                    ? {
                          role: "assistant",
                          tool_calls: [
                              {
                                  index: 0,
                                  id: "history-start",
                                  type: "function",
                                  function: {
                                      name,
                                      arguments: JSON.stringify({ cursor: "" }),
                                  },
                              },
                          ],
                      }
                    : {
                          role: "assistant",
                          content: "The retained conversation is available.",
                      };
            return new Response(
                `data: ${JSON.stringify({ id: "history-wire", choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: count === 1 ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`,
                { headers: { "content-type": "text/event-stream" } },
            );
        }),
    );
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const requests = await t.run((ctx) =>
        ctx.db.query("agentOperationRequests").collect(),
    );
    assert(requests[0]);
    expect(requests[0].input).toEqual({ kind: name });
    expect(requests[0].outcome?.kind).toBe("success");
    const page = await client.query(api.execution.conversations.listMessages, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(page.page.find((m) => m.role === "assistant")?.text).toBe(
        "The retained conversation is available.",
    );
});
