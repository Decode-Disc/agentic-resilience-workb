import {
    materializeSourceComparisonOutput,
    type PreparedSourceComparisonInput,
    prepareSourceComparisonInput,
} from "@convex/domain/sourceComparison";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { compareSourceContributions } from "@convex/integrations/sourceQualification";
import { sourceQualificationRoutes } from "@convex/integrations/sourceQualificationConfig";
import { expect, test, vi } from "vitest";

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

test("sends one bounded schema-constrained comparison through the configured route", async () => {
    const input = makeInput(true);
    const providerOutput = responseFor(input);
    const fetch = vi.fn<typeof globalThis.fetch>(
        async () =>
            new Response(
                JSON.stringify({
                    id: "comparison-test",
                    created: 1,
                    model: sourceQualificationRoutes[0].model,
                    provider: "Reka",
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
        model: sourceQualificationRoutes[0].model,
        temperature: 0,
        max_tokens: 6144,
        provider: {
            only: [sourceQualificationRoutes[0].provider],
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
        output: { findings: [{ disposition: "no_conflict_observed" }] },
    });
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
