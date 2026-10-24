import { prepareQualificationInput } from "@convex/domain/sourceQualification";
import { SOURCE_COVERAGE_ROLES } from "@convex/domain/sourceSelectionPolicy";
import { qualifySourceDocument } from "@convex/integrations/sourceQualification";
import { sourceQualificationRoutes } from "@convex/integrations/sourceQualificationConfig";
import { expect, test, vi } from "vitest";

const unspecifiedPeriod = {
    reportingPeriodEnd: null,
    reportingPeriodPassages: [],
};
const preparedExample = () =>
    prepareQualificationInput({
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
            apiKey: "test-only-key",
            fetch: request,
        }),
    ).toMatchObject({ status: "succeeded", qualification });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[1]?.redirect).toBe("error");
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
        model,
        temperature: 0,
        max_tokens: 6144,
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
            { apiKey: "test-only-key", fetch: request, onResponse },
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
            { apiKey: "test-only-key", fetch: request, onResponse },
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
            { apiKey: "test-only-key", fetch: request },
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
            { apiKey: "", fetch: request },
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
                apiKey: "test-only-key",
                fetch: request,
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
        apiKey: "test-only-key",
        fetch: request,
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
