import {
    createSourceComparisonResponseSchema,
    materializeSourceComparisonOutput,
    type PreparedSourceComparisonInput,
    prepareSourceComparisonInput,
    sourceComparisonOutputSchema,
} from "@convex/domain/sourceComparison";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { compareSourceContributions } from "@convex/integrations/sourceQualification";
import { sourceQualificationRoutes } from "@convex/integrations/sourceQualificationConfig";
import { expect, test, vi } from "vitest";
import { z } from "zod";

const company = {
    cik: "1373715",
    legalName: "ServiceNow, Inc.",
    ticker: "NOW",
};

const makeInput = (withPrimary: boolean): PreparedSourceComparisonInput => {
    const targetText =
        "Bundled workflow products may pressure subscription pricing.";
    const primaryText =
        "The company competes with providers that bundle workflow products into broad subscriptions.";
    const targetPassage = {
        passageKey: "p0",
        startOffset: 0,
        endOffset: targetText.length,
        quotation: targetText,
    };
    return prepareSourceComparisonInput({
        company,
        target: {
            runId: "run-1",
            corpusRevisionId: "revision-1",
            sourceId: "target-source",
            captureId: "target-capture",
            contentHash: sha256Hex(targetText),
            qualificationTaskId: "qualification-task",
            title: "Workflow competition analysis",
            canonicalUrl: "https://research.example/workflow",
            text: targetText,
            selectedPassages: [targetPassage],
            qualification: {
                companyMatch: "subject",
                companyPassages: [],
                documentKind: "independent_analysis",
                reportingPeriodEnd: null,
                reportingPeriodPassages: [],
                findings: [
                    {
                        role: "counter_evidence_primary",
                        kind: "attributed_argument",
                        summary: targetText,
                        passages: [{ passageKey: "p0", quotation: targetText }],
                        period: "current",
                        periodPassages: [],
                        dependsOnFlaggedAssertion: false,
                    },
                ],
                limitations: [],
            },
        },
        primaryCandidates: withPrimary
            ? [
                  {
                      sourceId: "primary-source",
                      captureId: "primary-capture",
                      contentHash: sha256Hex(primaryText),
                      title: "Annual report",
                      canonicalUrl:
                          "https://www.sec.gov/Archives/edgar/data/1373715/annual-report.htm",
                      authorityTier: "regulator_primary",
                      documentKind: "regulatory_annual",
                      text: primaryText,
                      passages: [
                          {
                              passageKey: "p1",
                              startOffset: 0,
                              endOffset: primaryText.length,
                              quotation: primaryText,
                              headingPath: ["Competition"],
                          },
                      ],
                  },
              ]
            : [],
    });
};

function responseFor(input: PreparedSourceComparisonInput) {
    return {
        findings: input.request.findings.map((finding) => ({
            findingIndex: finding.findingIndex,
            disposition: "no_conflict_observed",
            explanation:
                "The cited primary passage addresses the same entity, concept and period.",
            comparableDimensions: [
                "entity",
                "concept",
                "period",
                "unit_basis",
                "argument_effect",
            ],
            targetPassageKeys: finding.targetPassages.map(
                (passage) => passage.referenceKey,
            ),
            primaryPassageKeys: finding.primaryPassageKeys,
        })),
    };
}

test("new comparison calls use the admitted model capacity through the real transport", async () => {
    const input = makeInput(true);
    let limit: unknown;
    const result = await compareSourceContributions(
        input,
        {
            model: "example/comparison",
            executionPlanVersion: "source_actions_v4",
            descriptor: {
                contextWindow: 64000,
                maxTokens: 20000,
                reasoning: false,
                inputPrice: 0.01,
                outputPrice: 0.02,
                cacheReadPrice: 0,
                structuredOutputs: true,
            },
        },
        {
            apiKey: "offline-only",
            fetch: async (_url, init) => {
                const wire = JSON.parse(String(init?.body));
                limit = wire.max_tokens ?? wire.max_completion_tokens;
                return Response.json({
                    id: "offline-comparison",
                    model: "example/comparison",
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: "assistant",
                                content: JSON.stringify(responseFor(input)),
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
    );
    expect(result.status).toBe("succeeded");
    expect(limit).toBe(20000);
});

test("preserves a complete explanation beyond 600 characters through the bounded comparison transport", async () => {
    const input = makeInput(true);
    const providerOutput = responseFor(input);
    const explanation =
        "The cited annual report names bundled workflow products as a competitive risk. This supports the argument's premise about competition, but does not establish an observed pricing decline or quantify its effect on revenue. The argument remains attributed analysis rather than a verified financial outcome. ".repeat(
            3,
        );
    const finding = providerOutput.findings[0];
    if (!finding) throw new Error("Missing comparison finding");
    finding.explanation = explanation;
    const fetch = vi.fn<typeof globalThis.fetch>(
        async () =>
            new Response(
                JSON.stringify({
                    id: "comparison-test",
                    created: 1,
                    model: sourceQualificationRoutes[0].model,
                    provider: "Relace",
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: "assistant",
                                content: JSON.stringify(providerOutput),
                            },
                            finish_reason: "stop",
                        },
                    ],
                    usage: {
                        prompt_tokens: 240,
                        completion_tokens: 100,
                        total_tokens: 340,
                        cost: 0.0001,
                    },
                }),
                { headers: { "Content-Type": "application/json" } },
            ),
    );

    const result = await compareSourceContributions(
        input,
        sourceQualificationRoutes[0],
        { apiKey: "test-only-key", fetch },
    );

    expect(result).toMatchObject({ status: "succeeded" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("error");
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
        model: "deepseek/deepseek-v4.1-flash",
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
    expect(body.messages[0].content[0].text).toContain("untrusted data");
    const request = JSON.parse(body.messages[1].content);
    expect(request.findings[0].targetPassages[0].quotation).toBe(
        input.request.findings[0]?.targetPassages[0]?.quotation,
    );
    expect(request.primaryPassages[0].quotation).toContain(
        "bundle workflow products",
    );
    expect(request.primarySources[0]).toMatchObject({
        title: "Annual report",
        documentKind: "regulatory_annual",
    });
    expect(result).toMatchObject({
        status: "succeeded",
        output: {
            findings: [{ disposition: "no_conflict_observed", explanation }],
        },
    });
    if (result.status !== "succeeded") throw new Error("Comparison failed");
    expect(
        sourceComparisonOutputSchema.parse(result.output).findings[0]
            ?.explanation,
    ).toBe(explanation);
});

test("returns cached-ready inconclusive output without a provider request when no comparable primary passage was retrieved", async () => {
    const input = makeInput(false);
    const fetch = vi.fn<typeof globalThis.fetch>();

    const result = await compareSourceContributions(
        input,
        sourceQualificationRoutes[0],
        { apiKey: "test-only-key", fetch },
    );

    expect(result).toMatchObject({
        status: "not_run",
        reason: "no_comparable_primary_evidence",
        output: {
            checkStatus: "not_run",
            findings: [{ disposition: "inconclusive" }],
        },
    });
    expect(fetch).not.toHaveBeenCalled();
    const materialized = materializeSourceComparisonOutput(input, {
        findings: [],
    });
    expect(materialized).toMatchObject({
        status: "valid",
        output: { findings: [{ disposition: "inconclusive" }] },
    });
});

test.each([
    { change: { explanation: "" }, reason: "schema_invalid" },
    {
        change: { primaryPassageKeys: ["foreign-passage"] },
        reason: "reference_invalid",
    },
    {
        change: { explanation: "a".repeat(700 * 1024) },
        reason: "output_too_large",
    },
])("rejects $reason without weakening comparison integrity", ({
    change,
    reason,
}) => {
    const input = makeInput(true);
    const output = responseFor(input);
    Object.assign(output.findings[0] ?? {}, change);
    expect(materializeSourceComparisonOutput(input, output)).toEqual({
        status: "invalid",
        reason,
    });
});

test("changes request identity from the capped schema while keeping historical comparison output readable", () => {
    const input = makeInput(true);
    const schema = z.toJSONSchema(createSourceComparisonResponseSchema(input), {
        target: "draft-7",
        io: "input",
        reused: "inline",
    });
    const historicalSchema = JSON.parse(
        JSON.stringify(schema, (key, value) =>
            key === "explanation" ? { ...value, maxLength: 600 } : value,
        ),
    );
    const historicalHash = sha256Hex(
        JSON.stringify({
            request: input.request,
            responseSchema: historicalSchema,
        }),
    );
    expect(input.inputHash).not.toBe(historicalHash);

    const materialized = materializeSourceComparisonOutput(
        input,
        responseFor(input),
    );
    if (materialized.status !== "valid")
        throw new Error("Invalid historical fixture");
    const historicalOutput = {
        ...materialized.output,
        inputHash: historicalHash,
        comparisonVersion: "targeted-source-comparison-v1",
    };
    expect(sourceComparisonOutputSchema.parse(historicalOutput)).toEqual(
        historicalOutput,
    );
});
