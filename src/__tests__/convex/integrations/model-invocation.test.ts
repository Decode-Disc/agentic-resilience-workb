import { savedMaterialInspectionDefinition } from "@convex/domain/savedMaterialInspection";
import { invokeDeferredAgentTurn } from "@convex/integrations/modelInvocation";
import { v } from "convex/values";
import { expect, test, vi } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

test("blocks a deferred agent turn when no authorized route exists", async () => {
    const request = vi.fn<typeof fetch>();
    const result = await invokeDeferredAgentTurn({
        route: undefined,
        dependencies: { apiKey: "", fetch: request },
        instructions: "Inspect the approved material.",
        prompt: "Continue the investigation.",
        operations: {},
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
    const operations = {
        search_material: {
            description: "Search approved saved material.",
            inputValidator: v.object({ query: v.string() }),
        },
    };

    const result = await invokeDeferredAgentTurn({
        route,
        dependencies: { apiKey: "test-only-key", fetch: request },
        instructions: "Inspect the approved material.",
        prompt: "Find pricing evidence.",
        operations,
    });

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.finishReason).toBe("tool-calls");
    expect(result.requests).toHaveLength(2);
    expect(result.requests[0]).toMatchObject({
        callId: "call-1",
        name: "search_material",
        inputJson: JSON.stringify({ query: "pricing" }),
    });
    expect(result.requests[1]).toMatchObject({
        callId: "call-unlisted",
        name: "unlisted_operation",
        inputJson: JSON.stringify({ requested: true }),
    });
    expect(result.requests[1]?.inputJson).toBe('{"requested":true}');
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
        operations: {},
    });

    expect(result).toMatchObject({ status: "succeeded", assistantOutput });
});

test("blocks tools with inline execution callbacks before provider dispatch", async () => {
    const request = vi.fn<typeof fetch>();
    const execute = vi.fn(async () => "must remain deferred");
    const executableOperation = {
        description: "Search approved saved material.",
        inputValidator: v.object({ query: v.string() }),
        execute,
    };
    const result = await invokeDeferredAgentTurn({
        route: {
            model: "test/saved-material-agent",
            provider: "test-provider",
            authorizedForAgent: true,
        },
        dependencies: { apiKey: "test-only-key", fetch: request },
        instructions: "Inspect the approved material.",
        prompt: "Find pricing evidence.",
        operations: { search_material: executableOperation },
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
    const result = await invokeDeferredAgentTurn({
        route: {
            model: "test/saved-material-agent",
            provider: "test-provider",
            authorizedForAgent: true,
        },
        dependencies: { apiKey: "test-only-key", fetch: request },
        instructions: savedMaterialInspectionDefinition.instructions,
        prompt: "Read the requested retained passage.",
        operations: savedMaterialInspectionDefinition.operations,
    });

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.requests).toMatchObject([
        {
            callId: "read-real-source",
            name: "read_in_context",
            inputJson: JSON.stringify({ sourceId, passageOrder: 0 }),
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
        operations: {},
    });
    expect(result.status).toBe("succeeded");
    expect(request).toHaveBeenCalledOnce();
    if (result.status !== "succeeded")
        throw new Error("Expected observable invalid request");
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]).toMatchObject({
        name: "unlisted_operation",
    });
});
