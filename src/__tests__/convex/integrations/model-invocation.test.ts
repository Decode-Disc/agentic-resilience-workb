import { savedMaterialInspectionDefinition } from "@convex/domain/savedMaterialInspection";
import { agentToolSchemas } from "@convex/execution/agentDefinition";
import {
    invokeDeferredAgentTurn,
    invokeOneShot,
} from "@convex/integrations/modelTransport";
import { v } from "convex/values";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import {
    fixtureModelDescriptor,
    modelAttemptAuthority,
} from "@/__tests__/setup/model-configuration";
import { streamingModelFetch } from "@/__tests__/setup/model-stream";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

test("retains an original observable turn before the generation runtime receives it", async () => {
    const events: string[] = [];
    const originalInput = '{ "query" : "pricing" }';
    let observed: unknown;
    const dependencies = {
        authority: modelAttemptAuthority(),
        apiKey: "test-secret",
        beforeDispatch: async () => {
            events.push("request");
        },
        onObservation: async (result: unknown) => {
            observed = result;
            events.push("observation");
        },
        fetch: streamingModelFetch(async () => {
            events.push("provider");
            return new Response(
                JSON.stringify({
                    id: "observed-before-storage",
                    created: 1,
                    model: "test/agent",
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: "assistant",
                                content: null,
                                reasoning: "private reasoning",
                                tool_calls: [
                                    {
                                        id: "call-original",
                                        type: "function",
                                        function: {
                                            name: "search_material",
                                            arguments: originalInput,
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
            );
        }),
    };
    const result = await invokeDeferredAgentTurn({
        route: {
            model: "test/agent",
            provider: "test",
            authorizedForAgent: true,
            descriptor: fixtureModelDescriptor,
        },
        dependencies,
        instructions: "Inspect.",
        prompt: "Continue.",
        operations: {
            search_material: {
                description: "Search.",
                inputValidator: v.object({ query: v.string() }),
            },
        },
    });
    events.push("returned");
    expect(events).toEqual(["request", "provider", "observation", "returned"]);
    expect(observed).toMatchObject({
        status: "succeeded",
        inputTokens: 8,
        outputTokens: 4,
        requests: [
            {
                callId: "call-original",
                name: "search_material",
                inputJson: originalInput,
            },
        ],
    });
    expect(result).toEqual(observed);
    expect(JSON.stringify(observed)).not.toContain("private reasoning");
    expect(JSON.stringify(observed)).not.toContain("test-secret");
});

test("journals the serialized HTTP request before dispatch and the original reply before parsing", async () => {
    const events: string[] = [];
    let requestJson = "";
    let wireJson = "";
    const result = await invokeOneShot({
        route: {
            descriptor: fixtureModelDescriptor,
            model: "test/journal",
            provider: "test-provider",
        },
        dependencies: {
            authority: modelAttemptAuthority(),
            apiKey: "secret-not-for-the-journal",
            beforeDispatch: async (snapshot: string) => {
                requestJson = snapshot;
                events.push("journal");
            },
            fetch: streamingModelFetch(async (_url, init) => {
                wireJson = String(init?.body);
                events.push("dispatch");
                return new Response(
                    JSON.stringify({
                        id: "journal-response",
                        created: 1,
                        model: "test/journal",
                        choices: [
                            {
                                index: 0,
                                message: {
                                    role: "assistant",
                                    content:
                                        '{ "answer" : "original wording" }',
                                    reasoning: "private reasoning",
                                },
                                finish_reason: "stop",
                            },
                        ],
                        usage: {
                            prompt_tokens: 10,
                            completion_tokens: 8,
                            total_tokens: 18,
                        },
                    }),
                    { headers: { "Content-Type": "application/json" } },
                );
            }),
        },
        instructions: "Use the retained evidence.",
        prompt: "What does it establish?",
        schema: z.object({ answer: z.string() }),
        schemaName: "journal_answer",
    });
    expect(events).toEqual(["journal", "dispatch"]);
    const snapshot = JSON.parse(requestJson);
    const wire = JSON.parse(wireJson);
    expect(snapshot.input).toEqual(wire);
    expect(snapshot.settings.provider).toEqual(wire.provider);
    expect(requestJson).toContain("Use the retained evidence.");
    expect(requestJson).toContain("What does it establish?");
    expect(requestJson).toContain('"answer"');
    expect(requestJson).not.toContain("secret-not-for-the-journal");
    expect(result.status).toBe("succeeded");
    expect(JSON.parse(result.observableReplyJson ?? "null")).toMatchObject({
        content: [{ type: "text", text: '{ "answer" : "original wording" }' }],
    });
    expect(result.observableReplyJson).not.toContain("private reasoning");
});

test("a current deferred turn refuses missing model capabilities before HTTP", async () => {
    const request = vi.fn<typeof fetch>(async () =>
        Response.json({
            id: "unprepared",
            model: "test/unprepared",
            choices: [
                {
                    index: 0,
                    message: { role: "assistant", content: "Acknowledged." },
                    finish_reason: "stop",
                },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
    );
    const result = await invokeDeferredAgentTurn({
        route: { model: "test/unprepared", authorizedForAgent: true },
        dependencies: {
            authority: modelAttemptAuthority(),
            apiKey: "offline-only",
            fetch: streamingModelFetch(request),
        },
        instructions: "Reply.",
        prompt: "Continue.",
        operations: {},
    });
    expect(result).toMatchObject({
        status: "failed",
        errorCode: "invalid_model_output_limit",
        dispatchOutcome: "not_dispatched",
    });
    expect(request).not.toHaveBeenCalled();
});

test("blocks a deferred agent turn when no authorized route exists", async () => {
    const request = vi.fn<typeof fetch>();
    const result = await invokeDeferredAgentTurn({
        route: undefined,
        dependencies: {
            authority: modelAttemptAuthority(),
            apiKey: "",
            fetch: streamingModelFetch(request),
        },
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

test("a backend preparation failure is explicitly not dispatched", async () => {
    const request = vi.fn<typeof fetch>();
    const result = await invokeDeferredAgentTurn({
        route: {
            model: "test/agent",
            provider: "test",
            authorizedForAgent: true,
            descriptor: fixtureModelDescriptor,
        },
        dependencies: {
            authority: modelAttemptAuthority(),
            apiKey: "test-only-key",
            fetch: streamingModelFetch(request),
        },
        instructions: "Inspect.",
        prompt: "Continue.",
        operations: {},
        generateStep: async () => {
            throw new Error("Component storage unavailable");
        },
    });
    expect(result).toMatchObject({
        status: "failed",
        errorCode: "generation_backend_unavailable",
        dispatchOutcome: "not_dispatched",
        retryable: false,
    });
    expect(request).not.toHaveBeenCalled();
});

test("a failed request checkpoint prevents dispatch and returns an explicit non-dispatch outcome", async () => {
    const request = vi.fn<typeof fetch>();
    const result = await invokeDeferredAgentTurn({
        route: {
            model: "test/journal",
            provider: "test-provider",
            authorizedForAgent: true,
            descriptor: fixtureModelDescriptor,
        },
        dependencies: {
            authority: modelAttemptAuthority(),
            apiKey: "test-only-key",
            fetch: streamingModelFetch(request),
            beforeDispatch: async () => {
                throw new Error("checkpoint unavailable");
            },
        },
        instructions: "Inspect.",
        prompt: "Continue.",
        operations: {},
    });
    expect(result).toMatchObject({
        status: "failed",
        errorCode: "journal_request_unavailable",
        dispatchOutcome: "not_dispatched",
        retryable: false,
    });
    expect(request).not.toHaveBeenCalled();
});

test("returns typed tool requests for persisted dispatch without an SDK loop", async () => {
    let requestSnapshot = "";
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
        descriptor: fixtureModelDescriptor,
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
        dependencies: {
            authority: modelAttemptAuthority(),
            apiKey: "test-only-key",
            fetch: streamingModelFetch(request),
            beforeDispatch: async (json) => {
                requestSnapshot = json;
            },
        },
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
    expect(JSON.parse(requestSnapshot).input).toEqual(requestBody);
    expect(JSON.parse(result.observableReplyJson ?? "null").content).toEqual([
        {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "search_material",
            input: '{"query":"pricing"}',
        },
        {
            type: "tool-call",
            toolCallId: "call-unlisted",
            toolName: "unlisted_operation",
            input: '{"requested":true}',
        },
    ]);
    expect(requestBody).toMatchObject({
        model: route.model,
        temperature: 0,
        max_tokens: 8192,
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
            descriptor: fixtureModelDescriptor,
        },
        dependencies: {
            authority: modelAttemptAuthority(),
            apiKey: "test-only-key",
            fetch: streamingModelFetch(request),
        },
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
            descriptor: fixtureModelDescriptor,
        },
        dependencies: {
            authority: modelAttemptAuthority(),
            apiKey: "test-only-key",
            fetch: streamingModelFetch(request),
        },
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
            descriptor: fixtureModelDescriptor,
        },
        dependencies: {
            authority: modelAttemptAuthority(),
            apiKey: "test-only-key",
            fetch: streamingModelFetch(request),
        },
        instructions: savedMaterialInspectionDefinition.instructions,
        prompt: "Read the requested retained passage.",
        operations: agentToolSchemas(savedMaterialInspectionDefinition),
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
            descriptor: fixtureModelDescriptor,
        },
        dependencies: {
            authority: modelAttemptAuthority(),
            apiKey: "test-only-key",
            fetch: streamingModelFetch(request),
        },
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

test("invalid structured output retains the original observable reply before schema rejection", async () => {
    const original = ' { "wrong_field": true } ';
    const result = await invokeOneShot({
        route: {
            descriptor: fixtureModelDescriptor,
            model: "test/journal",
            provider: "test-provider",
        },
        instructions: "Inspect.",
        prompt: "Answer.",
        schema: z.object({ answer: z.string() }),
        schemaName: "answer",
        dependencies: {
            authority: modelAttemptAuthority(),
            apiKey: "test-only-key",
            fetch: streamingModelFetch(
                async () =>
                    new Response(
                        JSON.stringify({
                            id: "invalid-journal",
                            created: 1,
                            model: "test/journal",
                            choices: [
                                {
                                    index: 0,
                                    message: {
                                        role: "assistant",
                                        content: original,
                                    },
                                    finish_reason: "stop",
                                },
                            ],
                            usage: {
                                prompt_tokens: 1,
                                completion_tokens: 1,
                                total_tokens: 2,
                            },
                        }),
                        { headers: { "Content-Type": "application/json" } },
                    ),
            ),
        },
    });
    expect(result.status).toBe("failed");
    expect(JSON.parse(result.observableReplyJson ?? "null").content).toEqual([
        { type: "text", text: original },
    ]);
});

test("one-shot cancellation retains the actual DOM abort cause rather than a generic transport error", async () => {
    const cancellation = new AbortController();
    let diagnostic: unknown;
    const result = await invokeOneShot({
        route: { descriptor: fixtureModelDescriptor, model: "test/structured" },
        dependencies: {
            authority: modelAttemptAuthority(),
            apiKey: "offline-only",
            signal: cancellation.signal,
            observeProvider: async (observation) => {
                diagnostic = observation.diagnostic;
            },
            fetch: streamingModelFetch(async () => {
                cancellation.abort(
                    new DOMException(
                        "Preparation deadline elapsed",
                        "TimeoutError",
                    ),
                );
                throw new Error("Generic transport cancellation");
            }),
        },
        instructions: "Read.",
        prompt: "Material.",
        schema: z.object({ answer: z.string() }),
        schemaName: "cancelled_documentary_control",
    });
    expect(result).toMatchObject({
        status: "failed",
        errorCode: "request_timeout",
        retryable: false,
    });
    expect(diagnostic).toMatchObject({
        name: "TimeoutError",
        message: "Preparation deadline elapsed",
        phase: "provider_transport",
    });
});
