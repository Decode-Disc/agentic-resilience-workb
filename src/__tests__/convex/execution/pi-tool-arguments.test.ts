import { createPiToolArgumentsCapture } from "@convex/integrations/piToolArguments";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { expect, test, vi } from "vitest";
import { nativePiFixtureProvider } from "@/__tests__/setup/pi-native";

test.each([
    "[]",
    "null",
    '"text"',
])("syntactically valid JSON %s is refused when it is not an argument object", (rawArguments) => {
    const capture = createPiToolArgumentsCapture("openai-completions");
    capture.observe({
        choices: [
            {
                delta: {
                    tool_calls: [
                        {
                            index: 0,
                            id: "non-object",
                            function: { arguments: rawArguments },
                        },
                    ],
                },
            },
        ],
    });
    expect(capture.forCall("non-object")).toEqual({
        rawArguments,
        argumentsError: "Tool arguments must be a JSON object",
    });
});

test.each([
    {
        collision: "an index changes its call identity",
        tools: [
            { index: 0, id: "first", function: { arguments: "{}" } },
            { index: 0, id: "second", function: { arguments: "" } },
        ],
        ids: ["first", "second"],
    },
    {
        collision: "a late identity belongs to another populated index",
        tools: [
            { index: 0, function: { arguments: "{}" } },
            { index: 1, id: "shared", function: { arguments: "{}" } },
            { index: 0, id: "shared", function: { arguments: "" } },
        ],
        ids: ["shared"],
    },
])("original arguments are unavailable when $collision", ({ tools, ids }) => {
    const capture = createPiToolArgumentsCapture("openai-completions");
    capture.observe({ choices: [{ delta: { tool_calls: tools } }] });
    for (const id of ids)
        expect(capture.forCall(id)).toEqual({
            rawArguments: null,
            argumentsError: expect.stringContaining("ambiguously correlated"),
        });
});

test.each([
    {
        label: "SDK-repaired newline",
        original: '{ "query": "line\nline" }',
        normalized: { query: "line\nline" },
        invalid: true,
    },
    {
        label: "valid escaped newline",
        original: '{ "query": "line\\nline" }',
        normalized: { query: "line\nline" },
        invalid: false,
    },
    {
        label: "empty input without deltas",
        original: "",
        normalized: {},
        invalid: false,
    },
])("Anthropic preserves the original arguments and validates JSON before native SDK repair ($label)", async ({
    original,
    normalized,
    invalid,
}) => {
    const model = nativePiFixtureProvider
        .getModels()
        .find((model) => model.api === "anthropic-messages");
    if (!model) throw new Error("Expected installed Anthropic native API");
    const events = [
        {
            type: "message_start",
            message: {
                id: "native-anthropic",
                type: "message",
                role: "assistant",
                model: model.id,
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 10, output_tokens: 0 },
            },
        },
        {
            type: "content_block_start",
            index: 0,
            content_block: {
                type: "tool_use",
                id: "anthropic-tool",
                name: "search_available_material",
                input: {},
            },
        },
        ...(original ? [original.slice(0, 15), original.slice(15)] : []).map(
            (partial_json) => ({
                type: "content_block_delta",
                index: 0,
                delta: { type: "input_json_delta", partial_json },
            }),
        ),
        { type: "content_block_stop", index: 0 },
        {
            type: "message_delta",
            delta: { stop_reason: "tool_use", stop_sequence: null },
            usage: { output_tokens: 5 },
        },
        { type: "message_stop" },
    ];
    const network = vi.fn(
        async () =>
            new Response(
                events
                    .map(
                        (event) =>
                            `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
                    )
                    .join(""),
                { headers: { "content-type": "text/event-stream" } },
            ),
    );
    const capture = createPiToolArgumentsCapture(model.api);
    const received = await nativePiFixtureProvider
        .streamSimple(
            model,
            normalizeContext({
                messages: [
                    {
                        role: "user",
                        content: "Search the retained material",
                        timestamp: 1,
                    },
                ],
            }),
            {
                apiKey: "test-only-key",
                fetch: network,
                maxRetries: 0,
                onProviderStreamEvent: (event) => capture.observe(event),
            },
        )
        .result();
    expect(received.stopReason).toBe("toolUse");
    expect(received.content).toContainEqual(
        expect.objectContaining({
            type: "toolCall",
            id: "anthropic-tool",
            arguments: normalized,
        }),
    );
    const tool = received.content.find((c) => c.type === "toolCall");
    if (tool?.type !== "toolCall")
        throw new Error("Expected native SDK tool call");
    expect(tool.argumentsError).toBeUndefined();
    expect(capture.forCall(tool.id)).toEqual({
        rawArguments: original,
        rawInput: {},
        ...(invalid ? { argumentsError: expect.any(String) } : {}),
    });
    expect(network).toHaveBeenCalledOnce();
});
