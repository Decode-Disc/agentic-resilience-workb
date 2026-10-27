import { savedMaterialInspectionDefinition } from "@convex/execution/definitions";
import { invokeDeferredAgentTurn } from "@convex/integrations/modelInvocation";
import { asSchema, tool } from "ai";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

test("blocks a deferred agent turn when no authorized route exists", async () => {
    const request = vi.fn<typeof fetch>();
    const result = await invokeDeferredAgentTurn({
        route: undefined,
        dependencies: { apiKey: "", fetch: request },
        instructions: "Inspect the approved material.",
        prompt: "Continue the investigation.",
        tools: {},
    });

    expect(result).toEqual({
        status: "blocked",
        reason: "missing_authorized_route",
    });
    expect(request).not.toHaveBeenCalled();
});

test("returns typed tool requests for persisted dispatch without an SDK loop", async () => {
    const body = JSON.stringify({
        id: "deferred-tool-call",
        created: 1,
        model: "test/saved-material-agent",
        provider: "Test provider",
        choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                        {
                            id: "call-1",
                            type: "function",
                            function: {
                                name: "search_material",
                                arguments: JSON.stringify({ query: "pricing" }),
                            },
                        },
                        {
                            id: "call-unlisted",
                            type: "function",
                            function: {
                                name: "unlisted_operation",
                                arguments: JSON.stringify({ requested: true }),
                            },
                        },
                    ],
                },
                finish_reason: "tool_calls",
            },
        ],
        usage: {
            prompt_tokens: 8,
            completion_tokens: 4,
            total_tokens: 12,
            cost: 0.0001,
        },
    });
    const request = vi.fn<typeof fetch>(
        async () =>
            new Response(body, {
                headers: { "Content-Type": "application/json" },
            }),
    );
    const route = {
        model: "test/saved-material-agent",
        provider: "test-provider",
        authorizedForAgent: true,
    } as const;
    const tools = {
        search_material: tool({
            description: "Search approved saved material.",
            inputSchema: z.object({ query: z.string() }),
        }),
    };

    const result = await invokeDeferredAgentTurn({
        route,
        dependencies: { apiKey: "test-only-key", fetch: request },
        instructions: "Inspect the approved material.",
        prompt: "Find pricing evidence.",
        tools,
    });

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.finishReason).toBe("tool-calls");
    expect(result.toolRequests).toHaveLength(2);
    expect(result.toolRequests[0]).toMatchObject({
        toolCallId: "call-1",
        toolName: "search_material",
        input: { query: "pricing" },
    });
    expect(result.toolRequests[1]).toMatchObject({
        toolCallId: "call-unlisted",
        toolName: "unlisted_operation",
        input: { requested: true },
        dynamic: true,
        invalid: true,
    });
    expect(JSON.stringify(result.toolRequests)).toContain('"requested":true');
    expect(request).toHaveBeenCalledOnce();
    const requestBody = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
        model: route.model,
        temperature: 0,
        max_tokens: 6144,
        provider: { only: [route.provider], allow_fallbacks: false },
    });
});

test("returns final assistant text for persisted completion parsing", async () => {
    const assistantOutput = JSON.stringify({
        kind: "complete",
        captureIds: ["sourceCaptures:approved"],
        workingNotes: "The inspected material supports a narrower conclusion.",
    });
    const request = vi.fn<typeof fetch>(
        async () =>
            new Response(
                JSON.stringify({
                    id: "deferred-completion",
                    created: 1,
                    model: "test/saved-material-agent",
                    provider: "Test provider",
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: "assistant",
                                content: assistantOutput,
                            },
                            finish_reason: "stop",
                        },
                    ],
                    usage: {
                        prompt_tokens: 8,
                        completion_tokens: 4,
                        total_tokens: 12,
                    },
                }),
                { headers: { "Content-Type": "application/json" } },
            ),
    );

    const result = await invokeDeferredAgentTurn({
        route: {
            model: "test/saved-material-agent",
            provider: "test-provider",
            authorizedForAgent: true,
        },
        dependencies: { apiKey: "test-only-key", fetch: request },
        instructions: "Inspect the approved material.",
        prompt: "Report whether inspection is complete.",
        tools: {},
    });

    expect(result).toMatchObject({ status: "succeeded", assistantOutput });
});

test("blocks tools with inline execution callbacks before provider dispatch", async () => {
    const request = vi.fn<typeof fetch>();
    const execute = vi.fn(async () => "must remain deferred");
    const result = await invokeDeferredAgentTurn({
        route: {
            model: "test/saved-material-agent",
            provider: "test-provider",
            authorizedForAgent: true,
        },
        dependencies: { apiKey: "test-only-key", fetch: request },
        instructions: "Inspect the approved material.",
        prompt: "Find pricing evidence.",
        tools: {
            search_material: tool({
                description: "Search approved saved material.",
                inputSchema: z.object({ query: z.string() }),
                execute,
            }),
        },
    });

    expect(result).toEqual({
        status: "blocked",
        reason: "tool_callbacks_not_allowed",
    });
    expect(request).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
});

test("serializes canonical mission tools and accepts a real Convex source ID", async () => {
    const { sourceId } = await seedSourcePreparation();
    const body = JSON.stringify({
        id: "saved-material-real-source-id",
        created: 1,
        model: "test/saved-material-agent",
        provider: "Test provider",
        choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                        {
                            id: "read-real-source",
                            type: "function",
                            function: {
                                name: "read_in_context",
                                arguments: JSON.stringify({
                                    sourceId,
                                    passageOrder: 0,
                                }),
                            },
                        },
                    ],
                },
                finish_reason: "tool_calls",
            },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
    });
    const request = vi.fn<typeof fetch>(
        async () =>
            new Response(body, {
                headers: { "Content-Type": "application/json" },
            }),
    );
    for (const definitionTool of Object.values(
        savedMaterialInspectionDefinition.tools,
    )) {
        await asSchema(definitionTool.inputSchema).jsonSchema;
    }
    const readSchema = asSchema(
        savedMaterialInspectionDefinition.tools.read_in_context.inputSchema,
    );
    expect(
        await readSchema.validate?.({ sourceId, passageOrder: 0, extra: true }),
    ).toMatchObject({ success: false });

    const result = await invokeDeferredAgentTurn({
        route: {
            model: "test/saved-material-agent",
            provider: "test-provider",
            authorizedForAgent: true,
        },
        dependencies: { apiKey: "test-only-key", fetch: request },
        instructions: savedMaterialInspectionDefinition.instructions,
        prompt: "Read the requested retained passage.",
        tools: savedMaterialInspectionDefinition.tools,
    });

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.toolRequests).toMatchObject([
        {
            toolCallId: "read-real-source",
            toolName: "read_in_context",
            input: { sourceId, passageOrder: 0 },
        },
    ]);
    const requestBody = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    const readTool = requestBody.tools.find(
        (candidate: { function: { name: string } }) =>
            candidate.function.name === "read_in_context",
    );
    expect(readTool.function.parameters.properties.sourceId).toMatchObject({
        type: "string",
    });
});

test("a response containing only invalid tool calls cannot trigger an SDK repair loop", async () => {
    const request = vi.fn<typeof fetch>(
        async () =>
            new Response(
                JSON.stringify({
                    id: "invalid-only",
                    created: 1,
                    model: "test/agent",
                    provider: "Test provider",
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: "assistant",
                                content: null,
                                tool_calls: [
                                    {
                                        id: "unlisted",
                                        type: "function",
                                        function: {
                                            name: "unlisted_operation",
                                            arguments: "{}",
                                        },
                                    },
                                ],
                            },
                            finish_reason: "tool_calls",
                        },
                    ],
                    usage: {
                        prompt_tokens: 8,
                        completion_tokens: 4,
                        total_tokens: 12,
                    },
                }),
                { headers: { "Content-Type": "application/json" } },
            ),
    );
    const result = await invokeDeferredAgentTurn({
        route: {
            model: "test/agent",
            provider: "test-provider",
            authorizedForAgent: true,
        },
        dependencies: { apiKey: "test-only-key", fetch: request },
        instructions: "Inspect approved material.",
        prompt: "Continue.",
        tools: {},
    });
    expect(result.status).toBe("succeeded");
    expect(request).toHaveBeenCalledOnce();
    if (result.status !== "succeeded")
        throw new Error("Expected observable invalid request");
    expect(result.toolRequests).toHaveLength(1);
    expect(result.toolRequests[0]).toMatchObject({
        toolName: "unlisted_operation",
        invalid: true,
    });
});
