import { preparePiModelPayload } from "@convex/integrations/modelInput";
import {
    invokeDeferredAgentTurn,
    invokeOneShot,
} from "@convex/integrations/modelTransport";
import { revisionRoute } from "@convex/modelConfiguration";
import { expect, test, vi } from "vitest";
import { z } from "zod";

test.each([
    false,
    true,
])("catalogue capabilities drive native, conversational and structured calls (temperature=%s)", async (temperature) => {
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
    const dependencies = { apiKey: "test-only-key", fetch };
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
    const conversation = await invokeDeferredAgentTurn({
        route,
        dependencies,
        instructions: "Reply.",
        prompt: "Continue.",
        operations: {},
    });
    const structured = await invokeOneShot({
        route,
        dependencies,
        instructions: "Reply.",
        prompt: "Continue.",
        schema: z.object({ value: z.string() }),
        schemaName: "Capabilities",
    });
    expect(conversation.status).toBe("succeeded");
    expect(structured.status).toBe("succeeded");
    expect(requests).toHaveLength(2);
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

test.each([
    undefined,
    "none",
] as const)("a non-reasoning model receives no reasoning parameter through either transport (effort=%s)", async (reasoningEffort) => {
    let request: Record<string, unknown> | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
        request = JSON.parse(String(init?.body));
        return Response.json({
            id: "fixture-non-reasoning",
            model: "mistralai/mistral-nemo",
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
    const route = {
        model: "mistralai/mistral-nemo",
        provider: "deepinfra/fp8",
        reasoningEnabled: false,
        reasoningEffort,
        authorizedForAgent: true as const,
    };
    const result = await invokeDeferredAgentTurn({
        route,
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
    expect(request).not.toHaveProperty("reasoning");
    expect(request).toMatchObject({
        model: "mistralai/mistral-nemo",
        provider: {
            only: ["deepinfra/fp8"],
            allow_fallbacks: false,
            require_parameters: true,
        },
    });
    const native = preparePiModelPayload(
        { model: route.model, messages: [], reasoning: { enabled: false } },
        route,
    );
    expect(JSON.parse(native.json).input).not.toHaveProperty("reasoning");
    expect(fetch).toHaveBeenCalledOnce();
});

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
