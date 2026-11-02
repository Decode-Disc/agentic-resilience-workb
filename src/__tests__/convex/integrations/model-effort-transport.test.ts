import { invokeDeferredAgentTurn } from "@convex/integrations/modelTransport";
import { expect, test, vi } from "vitest";

test.each([
    "low",
    "high",
    "max",
    "none",
] as const)("the actual SDK HTTP request preserves %s effort", async (reasoningEffort) => {
    let request: Record<string, unknown> | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
        request = JSON.parse(String(init?.body));
        return Response.json({
            id: "fixture-completion",
            model: "example/model",
            choices: [
                {
                    index: 0,
                    message: { role: "assistant", content: "Acknowledged." },
                    finish_reason: "stop",
                },
            ],
            usage: {
                prompt_tokens: 10,
                completion_tokens: 4,
                total_tokens: 14,
            },
        });
    });
    const result = await invokeDeferredAgentTurn({
        route: {
            model: "example/model",
            provider: "test",
            authorizedForAgent: true,
            reasoningEffort,
        },
        dependencies: { apiKey: "test-only-key", fetch },
        instructions: "Reply briefly.",
        prompt: "Continue.",
        operations: {},
    });
    expect(result).toMatchObject({
        status: "succeeded",
        assistantOutput: "Acknowledged.",
        dispatchOutcome: "response_received",
    });
    expect(request).toMatchObject({
        model: "example/model",
        reasoning: {
            enabled: reasoningEffort !== "none",
            effort: reasoningEffort,
            exclude: true,
        },
        provider: { only: ["test"], allow_fallbacks: false },
        max_tokens: 6144,
    });
    expect(fetch).toHaveBeenCalledOnce();
});
