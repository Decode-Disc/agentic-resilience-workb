import { preparePiModelPayload } from "@convex/integrations/modelInput";
import { recommendedReasoningEffort } from "@convex/integrations/modelRouting";
import { invokeOneShot } from "@convex/integrations/modelTransport";
import { revisionRoute } from "@convex/modelConfiguration";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import { modelAttemptAuthority } from "@/__tests__/setup/model-configuration";
import { streamingModelFetch } from "@/__tests__/setup/model-stream";

test.each([
    false,
    true,
])("catalogue capabilities drive native and structured calls (temperature=%s)", async (temperature) => {
    const requests: Array<Record<string, unknown>> = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return Response.json({
            id: "capability-response",
            model: "example/catalogue-only",
            choices: [
                {
                    index: 0,
                    message: {
                        role: "assistant",
                        content: '{"value":"ready"}',
                    },
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
    const route = revisionRoute({
        model: "example/catalogue-only",
        provider: "example-provider",
        descriptor: {
            contextWindow: 32768,
            maxTokens: 2048,
            reasoning: false,
            inputPrice: 0.01,
            outputPrice: 0.02,
            cacheReadPrice: 0,
            structuredOutputs: true,
            supportedParameters: [
                "tools",
                "max_tokens",
                "structured_outputs",
                ...(temperature ? ["temperature"] : []),
            ],
        },
    });
    const dependencies = {
        authority: modelAttemptAuthority(),
        apiKey: "test-only-key",
        fetch: streamingModelFetch(fetch),
    };
    const native = JSON.parse(
        preparePiModelPayload(
            {
                model: route.model,
                messages: [],
                temperature: 0.8,
                max_completion_tokens: 6144,
                reasoning: { enabled: true },
            },
            route,
        ).json,
    ).input;
    const structured = await invokeOneShot({
        route,
        dependencies,
        instructions: "Reply.",
        prompt: "Continue.",
        schema: z.object({ value: z.string() }),
        schemaName: "Capabilities",
    });
    expect(structured.status).toBe("succeeded");
    expect(requests).toHaveLength(1);
    for (const request of [native, ...requests]) {
        expect(request).not.toHaveProperty("reasoning");
        if (temperature) expect(request).toHaveProperty("temperature", 0);
        else expect(request).not.toHaveProperty("temperature");
        expect(request.max_completion_tokens ?? request.max_tokens).toBe(2048);
        expect(request).toMatchObject({
            provider: {
                only: ["example-provider"],
                allow_fallbacks: false,
                require_parameters: true,
                max_price: { prompt: 0.15, completion: 0.6 },
            },
        });
    }
});

test("recommended reasoning follows advertised capability rather than a model name or low default", () => {
    const descriptor = {
        contextWindow: 32768,
        maxTokens: 8192,
        reasoning: true,
        inputPrice: 0,
        outputPrice: 0,
        cacheReadPrice: 0,
        structuredOutputs: true,
    };
    expect(
        recommendedReasoningEffort({
            ...descriptor,
            reasoningEfforts: ["high", "medium", "low"],
        }),
    ).toBe("medium");
    expect(
        recommendedReasoningEffort({
            ...descriptor,
            reasoningEfforts: ["max", "high", "low"],
        }),
    ).toBe("high");
    expect(
        recommendedReasoningEffort({
            ...descriptor,
            reasoningEfforts: ["none", "low"],
        }),
    ).toBe("low");
    expect(recommendedReasoningEffort(descriptor)).toBeUndefined();
    expect(
        recommendedReasoningEffort({
            ...descriptor,
            reasoning: false,
            reasoningEfforts: ["medium"],
        }),
    ).toBeUndefined();
});
