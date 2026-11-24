import { invokeOneShot } from "@convex/integrations/modelTransport";
import { expect, test } from "vitest";
import { z } from "zod";
import {
    fixtureModelDescriptor,
    modelAttemptAuthority,
} from "@/__tests__/setup/model-configuration";
import { streamingModelFetch } from "@/__tests__/setup/model-stream";

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
