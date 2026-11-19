import { prepareQualificationInput } from "@convex/domain/sourceQualification";
import { SOURCE_COVERAGE_ROLES } from "@convex/domain/sourceSelectionPolicy";
import { qualifySourceDocument } from "@convex/integrations/sourceQualification";
import { modelAttemptAuthority } from "@/__tests__/setup/model-configuration";
import { streamingModelFetch } from "@/__tests__/setup/model-stream";

// Frozen provider-metadata fixtures, not live catalogue defaults.
const qualificationRoute = {
    model: "deepseek/deepseek-v4.1-flash",
    provider: "relace",
    executionPlanVersion: "source_actions_v4" as const,
    descriptor: {
        contextWindow: 200000,
        maxTokens: 20000,
        reasoning: true,
        inputPrice: 0.15,
        outputPrice: 0.6,
        cacheReadPrice: 0,
        structuredOutputs: true,
    },
    reasoningEffort: "low" as const,
};
const sourceQualificationRoutes = [
    qualificationRoute,
    { ...qualificationRoute, model: "deepseek/deepseek-v4.1-flash-1017" },
] as const;

import { expect, test, vi } from "vitest";

const unspecifiedPeriod = {
    reportingPeriodEnd: null,
    reportingPeriodPassages: [],
};
const preparedExample = () =>
    prepareQualificationInput({
        protocolVersion: "source-qualification-v5",
        company: {
            cik: "1373715",
            legalName: "ServiceNow, Inc.",
            ticker: "NOW",
        },
        canonicalUrl: "https://www.servicenow.com/workflows",
        title: "Workflows",
        asOfTime: Date.UTC(2026, 9, 20),
        text: "ServiceNow provides workflow software.",
    });

test.each([
    { index: 0, model: "deepseek/deepseek-v4.1-flash" },
    { index: 1, model: "deepseek/deepseek-v4.1-flash-1017" },
])("uses $model through Relace with strict structured output and price limits", async ({
    index,
    model,
}) => {
    const route = sourceQualificationRoutes[index];
    if (!route) throw new Error("Missing qualification route");
    const input = prepareQualificationInput({
        protocolVersion: "source-qualification-v5",
        company: {
            cik: "1373715",
            legalName: "ServiceNow, Inc.",
            ticker: "NOW",
        },
        canonicalUrl: "https://www.servicenow.com/workflows",
        title: "Workflows",
        asOfTime: Date.UTC(2026, 9, 20),
        text: "ServiceNow provides workflow software.",
    });
    const qualification = {
        companyMatch: "subject",
        companyPassages: [
            {
                passageKey: "p0",
                quotation: "ServiceNow provides workflow software.",
            },
        ],
        documentKind: "official_product_documentation",
        ...unspecifiedPeriod,
        findings: [
            {
                role: "official_product_platform",
                kind: "asserted_fact",
                summary: "ServiceNow provides workflow software.",
                relevance: "Describes the company's workflow offering.",
                scope: "Issuer product description, not independent proof of adoption.",
                passages: [
                    {
                        passageKey: "p0",
                        quotation: "ServiceNow provides workflow software.",
                    },
                ],
                period: "unspecified",
                periodPassages: [],
                dependsOnFlaggedAssertion: false,
            },
        ],
        limitations: [],
    };
    const response = {
        companyMatch: "subject",
        companyPassageKeys: ["p0"],
        documentKind: "official_product_documentation",
        reportingPeriodEnd: null,
        reportingPeriodPassageKeys: [],
        contributions: Object.fromEntries(
            SOURCE_COVERAGE_ROLES.map((role) => [
                role,
                role === "official_product_platform"
                    ? [
                          {
                              summary: "ServiceNow provides workflow software.",
                              relevance:
                                  "Describes the company's workflow offering.",
                              scope: "Issuer product description, not independent proof of adoption.",
                              kind: "asserted_fact",
                              passageKeys: ["p0"],
                              period: "unspecified",
                              periodPassageKeys: [],
                              dependsOnFlaggedAssertion: false,
                          },
                      ]
                    : null,
            ]),
        ),
        limitations: [],
    };
    const request = vi.fn<typeof fetch>(
        async () =>
            new Response(
                JSON.stringify({
                    id: "qualification-test",
                    created: 1,
                    model,
                    provider: "Relace",
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: "assistant",
                                content: JSON.stringify(response),
                            },
                            finish_reason: "stop",
                        },
                    ],
                    usage: {
                        prompt_tokens: 200,
                        completion_tokens: 100,
                        total_tokens: 300,
                        cost: 0.0001,
                    },
                }),
                { headers: { "Content-Type": "application/json" } },
            ),
    );
    expect(
        await qualifySourceDocument(input, route, {
            authority: modelAttemptAuthority(),
            apiKey: "test-only-key",
            fetch: streamingModelFetch(request),
        }),
    ).toMatchObject({ status: "succeeded", qualification });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[1]?.redirect).toBe("error");
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
        model,
        temperature: 0,
        max_tokens: 20000,
        provider: {
            only: ["relace"],
            allow_fallbacks: false,
            require_parameters: true,
            max_price: { prompt: 0.15, completion: 0.6 },
        },
        response_format: { type: "json_schema", json_schema: { strict: true } },
    });
    expect(body.models).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(body.messages[0]).toMatchObject({
        role: "system",
        content: [{ type: "text", text: input.request.instructions }],
    });
    expect(JSON.parse(body.messages[1].content).document.passages).toEqual(
        input.request.document.passages,
    );
});

test("rejects an oversized decompressed provider body before parsing", async () => {
    const onResponse = vi.fn();
    const request = vi.fn<typeof fetch>(
        async () => new Response("x".repeat(1024 * 1024 + 1)),
    );
    expect(
        await qualifySourceDocument(
            preparedExample(),
            sourceQualificationRoutes[0],
            {
                authority: modelAttemptAuthority(),
                apiKey: "test-only-key",
                fetch: streamingModelFetch(request),
                onResponse,
            },
        ),
    ).toMatchObject({
        status: "failed",
        errorCode: "response_too_large",
        retryable: false,
    });
    expect(request).toHaveBeenCalledOnce();
    expect(onResponse).not.toHaveBeenCalled();
});

test("makes the bounded HTTP failure available to an explicit diagnostic observer without exposing request headers", async () => {
    const body = JSON.stringify({
        error: {
            code: 502,
            message: "Provider rejected the schema",
            metadata: {
                provider_name: "Reka",
                error_type: "provider_response_error",
                raw: '{"error":{"message":"Unsupported schema constraint"}}',
            },
        },
    });
    const onResponse = vi.fn();
    const request = vi.fn<typeof fetch>(
        async () =>
            new Response(body, {
                status: 502,
                headers: {
                    "Content-Type": "application/json",
                    "X-Request-Id": "request-test",
                    "X-Generation-Id": "generation-test",
                    "Set-Cookie": "private-response-cookie",
                },
            }),
    );
    expect(
        await qualifySourceDocument(
            preparedExample(),
            sourceQualificationRoutes[0],
            {
                authority: modelAttemptAuthority(),
                apiKey: "test-only-key",
                fetch: streamingModelFetch(request),
                onResponse,
            },
        ),
    ).toMatchObject({
        status: "failed",
        errorCode: "transport_unavailable",
        retryable: true,
    });
    expect(onResponse).toHaveBeenCalledExactlyOnceWith({
        status: 502,
        body,
        requestId: "request-test",
        generationId: "generation-test",
    });
    expect(request).toHaveBeenCalledOnce();
});

test.each([
    [500, "transport_unavailable", true],
    [429, "transport_unavailable", true],
    [401, "access_unavailable", false],
    [402, "access_unavailable", false],
    [400, "request_invalid", false],
])("returns a typed HTTP %i failure without SDK retries", async (status, errorCode, retryable) => {
    const request = vi.fn<typeof fetch>(
        async () =>
            new Response(
                JSON.stringify({
                    error: { message: "Provider test failure", code: status },
                }),
                {
                    status: Number(status),
                    headers: { "Content-Type": "application/json" },
                },
            ),
    );
    expect(
        await qualifySourceDocument(
            preparedExample(),
            sourceQualificationRoutes[0],
            {
                authority: modelAttemptAuthority(),
                apiKey: "test-only-key",
                fetch: streamingModelFetch(request),
            },
        ),
    ).toMatchObject({ status: "failed", errorCode, retryable });
    expect(request).toHaveBeenCalledOnce();
});

test("missing credentials and prior cancellation perform no request", async () => {
    const request = vi.fn<typeof fetch>();
    expect(
        await qualifySourceDocument(
            preparedExample(),
            sourceQualificationRoutes[0],
            { authority: modelAttemptAuthority(), apiKey: "", fetch: request },
        ),
    ).toMatchObject({
        status: "failed",
        errorCode: "missing_configuration",
        retryable: false,
    });
    expect(
        await qualifySourceDocument(
            preparedExample(),
            sourceQualificationRoutes[0],
            {
                authority: modelAttemptAuthority(),
                apiKey: "test-only-key",
                fetch: streamingModelFetch(request),
                signal: AbortSignal.abort(),
            },
        ),
    ).toMatchObject({
        status: "failed",
        errorCode: "cancelled",
        retryable: false,
    });
    expect(request).not.toHaveBeenCalled();
});

test.each([
    [80, 3900],
    [512, 30],
    [29, 3900],
])("bounds %i passages of length %i together with the structured response schema", async (passageCount, passageLength) => {
    const input = prepareQualificationInput({
        company: {
            cik: "1373715",
            legalName: "ServiceNow, Inc.",
            ticker: "NOW",
        },
        canonicalUrl: "https://www.servicenow.com/large-document",
        title: "Workflow architecture",
        asOfTime: Date.UTC(2026, 9, 20),
        text: Array.from(
            { length: passageCount },
            (_, index) =>
                `# Workflow section ${index}\n\nServiceNow workflow architecture ${"x".repeat(passageLength)}`,
        ).join("\n\n"),
    });
    const request = vi.fn<typeof fetch>(
        async () =>
            new Response(
                JSON.stringify({
                    error: {
                        message: "Controlled request rejection",
                        code: 400,
                    },
                }),
                {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                },
            ),
    );
    await qualifySourceDocument(input, sourceQualificationRoutes[0], {
        authority: modelAttemptAuthority(),
        apiKey: "test-only-key",
        fetch: streamingModelFetch(request),
    });
    expect(request).toHaveBeenCalledOnce();
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    const encoder = new TextEncoder();
    const messages = body.messages as Array<{
        content: string | Array<{ type: string; text: string }>;
    }>;
    const messageBytes = messages.reduce(
        (total, message) =>
            total +
            encoder.encode(
                typeof message.content === "string"
                    ? message.content
                    : message.content.map((part) => part.text).join("\n"),
            ).byteLength,
        0,
    );
    const schemaBytes = encoder.encode(
        JSON.stringify(body.response_format.json_schema.schema),
    ).byteLength;
    expect(messageBytes + schemaBytes).toBeLessThanOrEqual(128 * 1024);
    expect(input.readingCompleteness).toBe("partial");
});

test("retains a bounded rejected assistant output and the exact parsing reason without hidden reasoning", async () => {
    const content = "☀️".repeat(30000);
    const request = vi.fn<typeof fetch>(
        async () =>
            new Response(
                JSON.stringify({
                    id: "bad-structured-result",
                    created: 1,
                    model: sourceQualificationRoutes[0].model,
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: "assistant",
                                content,
                                reasoning_content:
                                    "private reasoning must not be retained",
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
                { headers: { "Content-Type": "application/json" } },
            ),
    );
    const result = await qualifySourceDocument(
        preparedExample(),
        sourceQualificationRoutes[0],
        {
            authority: modelAttemptAuthority(),
            apiKey: "test-only-key",
            fetch: streamingModelFetch(request),
        },
    );
    expect(result).toMatchObject({
        status: "failed",
        errorCode: "invalid_output",
        outputDiagnostic: {
            reason: "json_invalid",
            finishReason: "stop",
            originalBytes: new TextEncoder().encode(content).length,
            truncated: true,
        },
    });
    if (result.status !== "failed" || !result.outputDiagnostic?.output)
        throw new Error("Missing diagnostic");
    expect(
        new TextEncoder().encode(result.outputDiagnostic.output).length,
    ).toBeLessThanOrEqual(64 * 1024);
    expect(JSON.stringify(result.outputDiagnostic)).not.toContain(
        "private reasoning",
    );
    expect(result.outputDiagnostic.output).not.toContain("�");
});

test.each([
    ["{}", "stop", "schema_invalid"],
    ["{", "length", "finish_reason_invalid"],
])("distinguishes a rejected %s output finished by %s", async (content, finishReason, reason) => {
    const request = vi.fn<typeof fetch>(
        async () =>
            new Response(
                JSON.stringify({
                    id: "invalid-output",
                    created: 1,
                    model: sourceQualificationRoutes[0].model,
                    choices: [
                        {
                            index: 0,
                            message: { role: "assistant", content },
                            finish_reason: finishReason,
                        },
                    ],
                    usage: {
                        prompt_tokens: 10,
                        completion_tokens: 10,
                        total_tokens: 20,
                    },
                }),
                { headers: { "Content-Type": "application/json" } },
            ),
    );
    expect(
        await qualifySourceDocument(
            preparedExample(),
            sourceQualificationRoutes[0],
            {
                authority: modelAttemptAuthority(),
                apiKey: "test-only-key",
                fetch: streamingModelFetch(request),
            },
        ),
    ).toMatchObject({
        status: "failed",
        errorCode: "invalid_output",
        outputDiagnostic: {
            reason,
            finishReason,
            output: content,
            truncated: false,
        },
    });
});

test("retains the original assistant text when documentary validation rejects a schema-valid output", async () => {
    const content = JSON.stringify(
        {
            companyMatch: "subject",
            companyPassageKeys: [],
            documentKind: "official_product_documentation",
            reportingPeriodEnd: null,
            reportingPeriodPassageKeys: [],
            contributions: Object.fromEntries(
                SOURCE_COVERAGE_ROLES.map((role) => [role, null]),
            ),
            limitations: [],
        },
        null,
        2,
    );
    const request = vi.fn<typeof fetch>(
        async () =>
            new Response(
                JSON.stringify({
                    id: "invalid-documentary-basis",
                    created: 1,
                    model: sourceQualificationRoutes[0].model,
                    choices: [
                        {
                            index: 0,
                            message: { role: "assistant", content },
                            finish_reason: "stop",
                        },
                    ],
                    usage: {
                        prompt_tokens: 10,
                        completion_tokens: 10,
                        total_tokens: 20,
                    },
                }),
                { headers: { "Content-Type": "application/json" } },
            ),
    );
    const result = await qualifySourceDocument(
        preparedExample(),
        sourceQualificationRoutes[0],
        {
            authority: modelAttemptAuthority(),
            apiKey: "test-only-key",
            fetch: streamingModelFetch(request),
        },
    );
    expect(result).toMatchObject({
        status: "failed",
        errorCode: "invalid_output",
        outputDiagnostic: {
            reason: "company_basis_missing",
            output: content,
            originalBytes: new TextEncoder().encode(content).length,
            truncated: false,
        },
    });
    expect(result).not.toHaveProperty("assistantOutput");
});
