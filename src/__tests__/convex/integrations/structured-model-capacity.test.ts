import { invokeOneShot } from "@convex/integrations/modelTransport";
import { expect, test } from "vitest";
import { z } from "zod";

const route = {
    model: "example/structured",
    executionPlanVersion: "source_actions_v4" as const,
    descriptor: {
        contextWindow: 64000,
        maxTokens: 20000,
        reasoning: false,
        inputPrice: 0.01,
        outputPrice: 0.02,
        cacheReadPrice: 0,
        structuredOutputs: true,
    },
};

test("new structured calls without pinned capabilities refuse before HTTP", async () => {
    let calls = 0;
    const result = await invokeOneShot({
        route: {
            model: route.model,
            executionPlanVersion: "source_actions_v4",
        },
        instructions: "Examine.",
        prompt: "Evidence.",
        schema: z.object({ value: z.string() }),
        schemaName: "MissingCapacity",
        dependencies: {
            apiKey: "offline-only",
            fetch: async () => {
                calls++;
                throw new Error("HTTP must not run");
            },
        },
    });
    expect(result).toMatchObject({
        status: "failed",
        errorCode: "invalid_model_output_limit",
        dispatchOutcome: "not_dispatched",
    });
    expect(calls).toBe(0);
});

test("structured output is reduced to the remaining context while retaining all evidence", async () => {
    const prompt = "Evidence.".repeat(60);
    let limit = 0;
    const result = await invokeOneShot({
        route: {
            ...route,
            descriptor: { ...route.descriptor, contextWindow: 1000 },
        },
        instructions: "Examine.",
        prompt,
        schema: z.object({ value: z.string() }),
        schemaName: "ReducedCapacity",
        dependencies: {
            apiKey: "offline-only",
            fetch: async (_url, init) => {
                const wire = JSON.parse(String(init?.body));
                limit = wire.max_tokens ?? wire.max_completion_tokens;
                expect(JSON.stringify(wire.messages)).toContain(prompt);
                return Response.json({
                    id: "offline-context",
                    model: route.model,
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: "assistant",
                                content: '{"value":"examined"}',
                            },
                            finish_reason: "stop",
                        },
                    ],
                    usage: {
                        prompt_tokens: 10,
                        completion_tokens: 10,
                        total_tokens: 20,
                    },
                });
            },
        },
    });
    expect(result.status).toBe("succeeded");
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThan(1000);
});

test("new structured calls refuse exhausted model context without trimming evidence", async () => {
    let calls = 0;
    const result = await invokeOneShot({
        route: {
            ...route,
            descriptor: { ...route.descriptor, contextWindow: 32 },
        },
        instructions: "Examine all the supplied evidence.",
        prompt: "Evidence.".repeat(100),
        schema: z.object({ value: z.string() }),
        schemaName: "ContextCapacity",
        dependencies: {
            apiKey: "offline-only",
            fetch: async () => {
                calls++;
                throw new Error("HTTP must not run");
            },
        },
    });
    expect(result).toMatchObject({
        status: "failed",
        errorCode: "context_capacity",
        dispatchOutcome: "not_dispatched",
    });
    expect(calls).toBe(0);
});

test("new structured calls retain the effective model output limit before dispatch", async () => {
    let retained: unknown;
    let outputLimit: unknown;
    const result = await invokeOneShot({
        route,
        instructions: "Examine the supplied document.",
        prompt: "Evidence.",
        schema: z.object({ value: z.string() }),
        schemaName: "StructuredCapacity",
        dependencies: {
            apiKey: "offline-only",
            beforeDispatch: async (
                _request: string,
                metadata?: { effectiveMaxOutputTokens?: number },
            ) => {
                retained = metadata;
            },
            fetch: async (_url, init) => {
                expect(retained).toEqual({ effectiveMaxOutputTokens: 20000 });
                const wire = JSON.parse(String(init?.body));
                outputLimit = wire.max_tokens ?? wire.max_completion_tokens;
                return Response.json({
                    id: "offline",
                    model: route.model,
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: "assistant",
                                content: '{"value":"examined"}',
                            },
                            finish_reason: "stop",
                        },
                    ],
                    usage: {
                        prompt_tokens: 10,
                        completion_tokens: 10,
                        total_tokens: 20,
                    },
                });
            },
        },
    });
    expect(result).toMatchObject({
        status: "succeeded",
        value: { value: "examined" },
    });
    expect(outputLimit).toBe(20000);
});
