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
                coherence: true,
                limitations: [],
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
                    coherence: true,
                    limitations: [],
                    findings: {
                        [contribution.id]: {
                            conclusion: finding.conclusion,
                            permittedUse: finding.permittedUse,
                            diagnostic: finding.diagnostic,
                        },
                    },
                });
            },
        },
    );
    expect(result).toMatchObject({
        status: "succeeded",
        dispatchOutcome: "response_received",
        output: { findings: [finding] },
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
        fetch: async () =>
            providerReply({ coherence: true, limitations: [], findings }),
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
                coherence: true,
                limitations: [],
                findings: { [contribution.id]: value },
            });
        },
    });
    expect(result).toMatchObject({
        status: "succeeded",
        output: { findings: [finding], coherence: true, limitations: [] },
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
                coherence: true,
                limitations: [],
                findings: {
                    [contribution.id]: {
                        conclusion: "supported",
                        permittedUse: "documentary",
                        diagnostic: "Exact text",
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
        coherence: true,
        limitations: [],
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
