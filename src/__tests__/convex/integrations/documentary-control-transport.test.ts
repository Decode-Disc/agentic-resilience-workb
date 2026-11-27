import type { DocumentaryContribution } from "@convex/domain/sourcesContracts";
import { examineDocumentaryContributions } from "@convex/integrations/documentaryControl";
import { expect, test } from "vitest";
import { modelAttemptAuthority } from "@/__tests__/setup/model-configuration";
import { providerFixtureResponse } from "@/__tests__/setup/model-stream";

const contribution: DocumentaryContribution = {
    id: "documentary-contribution",
    version: 1,
    needIds: ["common-context"],
    statement: "The company supplies estimating software.",
    period: "2025",
    modality: "company statement",
    attribution: "Annual report",
    kind: "asserted_fact",
    evidence: [],
};
const finding = {
    contributionId: contribution.id,
    conclusion: "supported",
    permittedUse: "documentary",
    diagnostic: "The quotation supports the supplied statement.",
    needs: { "common-context": "documentary" },
};
const input = { contributions: [contribution], needs: [], evidence: [] };

/**
 * Settlement overhead a stalled diagnostic may add on top of the product grace:
 * the grace timer, the failed receipt write and event-loop scheduling. The
 * product bound stays MODEL_SETTLEMENT_GRACE_MS; this slack only keeps the test
 * from measuring scheduler punctuality, while still failing on an unbounded hang.
 */
const STALL_SETTLEMENT_SLACK_MS = 2_000;

const currentRoute = {
    model: "example/documentary",
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

function providerReply(output: unknown, finishReason = "stop") {
    return providerFixtureResponse({
        id: "offline-documentary",
        model: currentRoute.model,
        choices: [
            {
                index: 0,
                message: { role: "assistant", content: JSON.stringify(output) },
                finish_reason: finishReason,
            },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    });
}

test.each([
    "missing",
    "expired",
])("a documentary request with %s authority cannot reach the provider", async (state) => {
    let dispatched = false;
    const result = await examineDocumentaryContributions(input, currentRoute, {
        apiKey: "offline-only",
        authority:
            state === "missing"
                ? undefined
                : {
                      resourcePolicy: "authority_native_v1",
                      deadlineAt: Date.now() - 1,
                  },
        fetch: async () => {
            dispatched = true;
            const { contributionId: _id, ...value } = finding;
            return providerReply({
                objections: [],
                findings: { [contribution.id]: value },
            });
        },
    });
    expect(result).toMatchObject({
        status: "failed",
        dispatchOutcome: "not_dispatched",
        errorCode:
            state === "missing"
                ? "resource_policy_unsupported"
                : "execution_deadline",
    });
    expect(dispatched).toBe(false);
});

test.each([
    undefined,
    "source_actions_v3" as const,
])("current documentary authority supports retained workflow version %s", async (executionPlanVersion) => {
    let dispatched = false;
    const result = await examineDocumentaryContributions(
        input,
        { ...currentRoute, executionPlanVersion },
        {
            authority: modelAttemptAuthority(),
            apiKey: "offline-only",
            fetch: async () => {
                dispatched = true;
                return providerReply({
                    objections: [],
                    findings: {
                        [contribution.id]: {
                            conclusion: finding.conclusion,
                            permittedUse: finding.permittedUse,
                            diagnostic: finding.diagnostic,
                            needs: finding.needs,
                        },
                    },
                });
            },
        },
    );
    expect(result).toMatchObject({
        status: "succeeded",
        dispatchOutcome: "response_received",
        output: { findings: { [contribution.id]: { needs: finding.needs } } },
    });
    expect(dispatched).toBe(true);
});

test.each([
    {},
    {
        unknown: {
            conclusion: "supported",
            permittedUse: "documentary",
            diagnostic: "Unknown identity.",
        },
    },
])("new documentary examinations refuse incomplete or foreign findings", async (findings) => {
    const result = await examineDocumentaryContributions(input, currentRoute, {
        authority: modelAttemptAuthority(),
        apiKey: "offline-only",
        fetch: async () => providerReply({ objections: [], findings }),
    });
    expect(result).toMatchObject({
        status: "failed",
        errorCode: "invalid_output",
        outputDiagnostic: { reason: "schema_invalid" },
    });
});

test("new documentary examinations bind provider findings to the submitted identities", async () => {
    let wire: Record<string, unknown> = {};
    const { contributionId: _id, ...value } = finding;
    const result = await examineDocumentaryContributions(input, currentRoute, {
        authority: modelAttemptAuthority(),
        apiKey: "offline-only",
        fetch: async (_url, init) => {
            wire = JSON.parse(String(init?.body));
            return providerReply({
                objections: [],
                findings: { [contribution.id]: value },
            });
        },
    });
    expect(result).toMatchObject({
        status: "succeeded",
        output: { findings: { [contribution.id]: value }, objections: [] },
    });
    expect(wire).toMatchObject({
        messages: expect.arrayContaining([
            expect.objectContaining({
                role: "system",
                content: expect.arrayContaining([
                    expect.objectContaining({
                        text: expect.stringContaining("findings object"),
                    }),
                ]),
            }),
        ]),
        response_format: {
            json_schema: {
                schema: {
                    properties: {
                        findings: {
                            type: "object",
                            additionalProperties: false,
                            required: [contribution.id],
                        },
                    },
                },
            },
        },
    });
});

test("a legacy findings array is refused by the current schema without losing the raw reply", async () => {
    const output = {
        coherence: true,
        limitations: [],
        findings: [finding, finding],
    };
    const result = await examineDocumentaryContributions(input, currentRoute, {
        authority: modelAttemptAuthority(),
        apiKey: "offline-only",
        fetch: async () =>
            providerFixtureResponse({
                id: "offline-documentary",
                model: "example/documentary",
                choices: [
                    {
                        index: 0,
                        message: {
                            role: "assistant",
                            content: JSON.stringify(output),
                        },
                        finish_reason: "stop",
                    },
                ],
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 10,
                    total_tokens: 20,
                },
            }),
    });
    expect(result).toMatchObject({
        status: "failed",
        errorCode: "invalid_output",
        outputDiagnostic: {
            reason: "schema_invalid",
            output: JSON.stringify(output),
            finishReason: "stop",
        },
    });
});

test.each([
    "append",
    "seal",
])("a stalled diagnostic %s yields a failed receipt within the existing settlement grace", async (boundary) => {
    const began = Date.now();
    const { MODEL_SETTLEMENT_GRACE_MS } = await import(
        "@convex/resourcePolicy"
    );
    const attempt = examineDocumentaryContributions(input, currentRoute, {
        apiKey: "offline-only",
        authority: {
            ...modelAttemptAuthority(),
            deadlineAt: Date.now() + 30_000,
        },
        fetch: async () =>
            providerReply({
                objections: [],
                findings: {
                    [contribution.id]: {
                        conclusion: "supported",
                        permittedUse: "documentary",
                        diagnostic: "Exact text",
                        needs: { "common-context": "documentary" },
                    },
                },
            }),
        onVisibleText: async () =>
            boundary === "append" ? new Promise(() => {}) : undefined,
        finishVisibleOutput: async () =>
            boundary === "seal" ? new Promise(() => {}) : undefined,
    });
    const result = await Promise.race([
        attempt,
        new Promise((resolve) =>
            setTimeout(
                () => resolve({ status: "stalled" }),
                MODEL_SETTLEMENT_GRACE_MS + STALL_SETTLEMENT_SLACK_MS,
            ),
        ),
    ]);
    expect(result).toMatchObject({
        status: "failed",
        dispatchOutcome: "response_received",
        inputTokens: 10,
        outputTokens: 10,
    });
    expect(Date.now() - began).toBeLessThan(
        MODEL_SETTLEMENT_GRACE_MS + STALL_SETTLEMENT_SLACK_MS,
    );
}, 15000);

test("generation expiry remains a typed timeout when no capture RPC began", async () => {
    const result = examineDocumentaryContributions(input, currentRoute, {
        apiKey: "offline-only",
        authority: { ...modelAttemptAuthority(), deadlineAt: Date.now() + 100 },
        fetch: async (_url, init) =>
            new Response(
                new ReadableStream({
                    start(controller) {
                        init?.signal?.addEventListener(
                            "abort",
                            () => controller.error(init.signal?.reason),
                            { once: true },
                        );
                    },
                }),
                { headers: { "content-type": "text/event-stream" } },
            ),
    });
    await expect(result).resolves.toMatchObject({
        status: "failed",
        errorCode: "request_timeout",
        dispatchOutcome: "response_received",
    });
});

test("streaming documentary control above 1 MiB of SSE reasoning frames completes and settles usage", async () => {
    const { contributionId: _id, ...value } = finding;
    const finalContent = JSON.stringify({
        objections: [],
        findings: { [contribution.id]: value },
    });
    const reasoningPad = "r".repeat(4096);
    const reasoningFrame = `data: ${JSON.stringify({
        id: "gen-doc-large",
        object: "chat.completion.chunk",
        created: 1,
        model: currentRoute.model,
        choices: [
            {
                index: 0,
                delta: { reasoning: reasoningPad },
                finish_reason: null,
            },
        ],
    })}\n\n`;
    const contentFrame = `data: ${JSON.stringify({
        id: "gen-doc-large",
        object: "chat.completion.chunk",
        created: 1,
        model: currentRoute.model,
        choices: [
            {
                index: 0,
                delta: { content: finalContent },
                finish_reason: "stop",
            },
        ],
        usage: {
            prompt_tokens: 120,
            completion_tokens: 90,
            total_tokens: 210,
            cost: 0.0031,
        },
    })}\n\ndata: [DONE]\n\n`;
    const frameCount = Math.ceil(
        (1024 * 1024 + 65_536) / reasoningFrame.length,
    );
    const encoder = new TextEncoder();
    const result = await examineDocumentaryContributions(input, currentRoute, {
        apiKey: "offline-only",
        authority: modelAttemptAuthority(),
        fetch: async () =>
            new Response(
                new ReadableStream({
                    start(controller) {
                        for (let i = 0; i < frameCount; i++)
                            controller.enqueue(encoder.encode(reasoningFrame));
                        controller.enqueue(encoder.encode(contentFrame));
                        controller.close();
                    },
                }),
                {
                    headers: {
                        "content-type": "Text/Event-Stream; charset=utf-8",
                    },
                },
            ),
    });
    expect(result).toMatchObject({
        status: "succeeded",
        inputTokens: 120,
        outputTokens: 90,
        reportedCost: 0.0031,
    });
});

test("writes valid Unicode when a provider delta ends with half of a surrogate pair", async () => {
    const content = JSON.stringify({
        objections: [],
        findings: {
            [contribution.id]: {
                conclusion: "supported",
                permittedUse: "documentary",
                diagnostic: "Boundary 😀",
                needs: { "common-context": "documentary" },
            },
        },
    });
    const split = content.indexOf("😀") + 1;
    const parts = [content.slice(0, split), content.slice(split)];
    const frames = parts.map(
        (part, index) =>
            `data: ${JSON.stringify({
                id: "gen-surrogate-boundary",
                object: "chat.completion.chunk",
                created: 1,
                model: currentRoute.model,
                choices: [
                    {
                        index: 0,
                        delta: { content: part },
                        finish_reason: index === 1 ? "stop" : null,
                    },
                ],
            })}\n\n`,
    );
    const sse = [...frames, "data: [DONE]\n\n"].join("");
    const captured: string[] = [];
    const result = await examineDocumentaryContributions(input, currentRoute, {
        apiKey: "offline-only",
        authority: modelAttemptAuthority(),
        fetch: async () =>
            new Response(sse, {
                headers: { "content-type": "text/event-stream" },
            }),
        onVisibleText: async (text, sequence) => {
            if (
                new TextDecoder().decode(new TextEncoder().encode(text)) !==
                text
            )
                throw new Error("Convex requires valid Unicode");
            expect(sequence).toBe(captured.length);
            captured.push(text);
        },
    });
    expect(result.status).toBe("succeeded");
    expect(captured.join("")).toBe(content);
});

test("an examination keeps a faithful vendor argument while restricting its outcomes association", async () => {
    const vendor = {
        ...contribution,
        kind: "attributed_argument" as const,
        needIds: ["review-authority", "customer-outcomes"],
    };
    const response = {
        findings: {
            [vendor.id]: {
                conclusion: "supported",
                permittedUse: "attributed_argument_only",
                diagnostic:
                    "The vendor describes how reviewers approve estimates.",
                needs: {
                    "review-authority": "attributed_argument_only",
                    "customer-outcomes": "blocked",
                },
            },
        },
        objections: [
            {
                targets: [
                    { contributionId: vendor.id, needId: "customer-outcomes" },
                ],
                maximumUse: "blocked",
                diagnostic:
                    "A vendor description does not establish independent customer outcomes.",
            },
        ],
    };
    const result = await examineDocumentaryContributions(
        { ...input, contributions: [vendor] },
        currentRoute,
        {
            authority: modelAttemptAuthority(),
            apiKey: "offline-only",
            fetch: async () => providerReply(response),
        },
    );
    expect(result).toMatchObject({ status: "succeeded", output: response });
});

test.each([
    { threshold: 4096, run: 4095, interrupted: false },
    { threshold: 4096, run: 4096, interrupted: true },
    { threshold: 11, run: 11, interrupted: true },
])("outside-string whitespace run $run under policy $threshold", async ({
    threshold,
    run,
    interrupted,
}) => {
    const { contributionId: _id, ...value } = finding;
    const output = JSON.stringify({
        findings: { [contribution.id]: value },
        objections: [],
    });
    const chunks = [
        output + " \t".repeat(Math.floor(run / 4)),
        "\r\n".repeat(Math.floor(run / 4)) + " ".repeat(run % 4),
    ];
    let signal: AbortSignal | null | undefined;
    const received: string[] = [];
    const policy = {
        version: "structured_json_whitespace_v1",
        maxConsecutiveWhitespace: threshold,
    };
    const result = await examineDocumentaryContributions(input, currentRoute, {
        apiKey: "offline-only",
        authority: {
            ...modelAttemptAuthority(),
            structuredOutputPolicy: policy,
        },
        fetch: async (_url, init) => {
            signal = init?.signal;
            const frames = chunks.map(
                (content, index) =>
                    "data: " +
                    JSON.stringify({
                        id: "offline-whitespace",
                        model: currentRoute.model,
                        choices: [
                            {
                                index: 0,
                                delta: { content },
                                finish_reason: index ? "stop" : null,
                            },
                        ],
                        usage: {
                            prompt_tokens: 3,
                            completion_tokens: 4,
                            total_tokens: 7,
                        },
                    }) +
                    "\n\n",
            );
            return new Response(`${frames.join("")}data: [DONE]\n\n`, {
                headers: { "content-type": "text/event-stream" },
            });
        },
        onVisibleText: async (text) => {
            received.push(text);
        },
    });
    expect(received.join("")).toBe(chunks.join(""));
    expect(signal?.aborted).toBe(interrupted);
    expect(result).toMatchObject(
        interrupted
            ? { status: "failed", errorCode: "structured_output_whitespace" }
            : { status: "succeeded" },
    );
});

test("retains valid split escapes, spaces inside JSON strings, and separated whitespace runs", async () => {
    const slash = "\\";
    const diagnostic = [
        '"',
        " ".repeat(100),
        'quoted"',
        slash,
        "and text",
    ].join(" ");
    const { contributionId: _id, ...value } = finding;
    const output = JSON.stringify({
        findings: { [contribution.id]: { ...value, diagnostic } },
        objections: [],
    });
    const escapedQuote = output.indexOf([slash, '"'].join("")) + 1;
    const escapedBackslash = output.indexOf(slash.repeat(2)) + 1;
    expect(escapedQuote).toBeGreaterThan(0);
    expect(escapedBackslash).toBeGreaterThan(escapedQuote);
    const chunks = [
        " ".repeat(10) + output.slice(0, escapedQuote),
        output.slice(escapedQuote, escapedBackslash),
        output.slice(escapedBackslash) + " ".repeat(10),
    ];
    let signal: AbortSignal | null | undefined;
    const received: string[] = [];
    const result = await examineDocumentaryContributions(input, currentRoute, {
        apiKey: "offline-only",
        authority: {
            ...modelAttemptAuthority(),
            structuredOutputPolicy: {
                version: "structured_json_whitespace_v1",
                maxConsecutiveWhitespace: 11,
            },
        },
        fetch: async (_url, init) => {
            signal = init?.signal;
            return new Response(
                [
                    ...chunks.map(
                        (content, i) =>
                            `data: ${JSON.stringify({
                                id: "offline-valid-whitespace",
                                model: currentRoute.model,
                                choices: [
                                    {
                                        index: 0,
                                        delta: { content },
                                        finish_reason:
                                            i === chunks.length - 1
                                                ? "stop"
                                                : null,
                                    },
                                ],
                            })}\n\n`,
                    ),
                    "data: [DONE]\n\n",
                ].join(""),
                {
                    headers: { "content-type": "text/event-stream" },
                },
            );
        },
        onVisibleText: async (text) => {
            received.push(text);
        },
    });
    expect(signal?.aborted).toBe(false);
    expect(received.join("")).toBe(chunks.join(""));
    expect(result).toMatchObject({
        status: "succeeded",
        output: { findings: { [contribution.id]: { diagnostic } } },
    });
});
