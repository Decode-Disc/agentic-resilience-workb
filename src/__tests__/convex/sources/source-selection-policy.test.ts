import {
    buildSourceSelectionProposal,
    evaluateSourceCoverage,
} from "@convex/domain/sourceSelectionPolicy";
import { describe, expect, test } from "vitest";

type Candidate = Parameters<
    typeof buildSourceSelectionProposal
>[0]["candidates"][number];

test("coverage matches do not count other regulatory forms as annual reports", () => {
    const coverage = evaluateSourceCoverage("balanced", [
        {
            sourceId: "annual",
            canonicalUrl: "https://sec.gov/annual",
            sourceFamily: "regulatory",
            eligibleCoverageRoles: [],
            declaredCoverageRoles: ["regulatory_annual"],
            included: true,
        },
        {
            sourceId: "event",
            canonicalUrl: "https://sec.gov/event",
            sourceFamily: "regulatory",
            eligibleCoverageRoles: [],
            declaredCoverageRoles: ["regulatory_material_event"],
            included: true,
        },
    ]);
    expect(coverage.find((r) => r.role === "regulatory_annual")).toMatchObject({
        candidateIds: ["annual"],
        relatedCandidateIds: ["event"],
    });
});

const company = {
    cik: "1373715",
    legalName: "ServiceNow, Inc.",
    ticker: "NOW",
    websiteUrl: "https://servicenow.com/",
};

function candidate(
    sourceId: string,
    overrides: Partial<Candidate> = {},
): Candidate {
    return {
        sourceId,
        canonicalUrl: `https://www.reuters.com/technology/${sourceId}`,
        title: `ServiceNow ${sourceId} analysis`,
        origin: "exa",
        category: "counter_evidence",
        providerResultPosition: 0,
        discoveryQueryIndex: 0,
        createdAt: 1,
        ...overrides,
    };
}

function build(
    candidates: ReadonlyArray<Candidate>,
    overrides: Partial<
        Omit<Parameters<typeof buildSourceSelectionProposal>[0], "candidates">
    > = {},
) {
    return buildSourceSelectionProposal({
        company,
        coveragePreset: "balanced",
        ceiling: 24,
        candidates,
        ...overrides,
    });
}

describe("buildSourceSelectionProposal", () => {
    test("returns the same ranked proposal for the same metadata snapshot", () => {
        const candidates = [
            candidate("annual", {
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/annual.htm",
                title: "10-K · 2026-01-29",
                origin: "sec",
                category: "regulatory",
                secForm: "10-K",
            }),
            candidate("risk"),
        ];

        expect(build(candidates)).toEqual(build([...candidates].reverse()));
    });

    test("keeps unverified metadata as a non-blocking alternative", () => {
        const result = build([
            candidate("unknown", {
                canonicalUrl: "https://unknown.example/report",
                category: "official_product",
            }),
        ]);

        expect(result.items).toEqual([
            expect.objectContaining({
                sourceId: "unknown",
                disposition: "alternative",
                reasonCodes: ["unverified_publisher"],
            }),
        ]);
        expect(result.counts.needsAttention).toBe(0);
    });

    test("uses the research angle as a stable tie breaker between qualified publishers", () => {
        const result = build(
            [
                candidate("generic", {
                    title: "ServiceNow independent company analysis",
                    providerResultPosition: 1,
                }),
                candidate("angle-match", {
                    canonicalUrl:
                        "https://www.bloomberg.com/technology/servicenow-workflow-migration",
                    title: "ServiceNow workflow migration analysis",
                    providerResultPosition: 1,
                }),
            ],
            {
                coveragePreset: "independent_scrutiny",
                researchAngle: "workflow migration",
                ceiling: 1,
            },
        );

        expect(result.items[0]).toMatchObject({
            sourceId: "angle-match",
            disposition: "recommended",
        });
    });

    test("uses distinct qualified publishers for counter-evidence coverage", () => {
        const result = build([
            candidate("reuters-one", {
                canonicalUrl:
                    "https://www.reuters.com/technology/servicenow-risk",
            }),
            candidate("reuters-two", {
                canonicalUrl:
                    "https://www.reuters.com/technology/servicenow-risk-update",
                providerResultPosition: 1,
            }),
            candidate("morningstar", {
                canonicalUrl:
                    "https://www.morningstar.com/stocks/servicenow-analysis",
            }),
        ]);

        expect(
            result.items
                .filter(({ disposition }) => disposition === "recommended")
                .map(({ sourceId }) => sourceId),
        ).toEqual(["morningstar", "reuters-one"]);
        expect(result.coverageGaps).not.toContain("counter_evidence_secondary");
    });
});

test.each([
    "pending",
    "historical",
    "unrelated",
    "unverified",
    "rejected",
] as const)("documentary supplement gaps preserve %s suitability independently of comparison", (condition) => {
    const result = build(
        [
            candidate("platform-argument", {
                canonicalUrl:
                    condition === "unverified"
                        ? "https://unknown.example/products/platform.html"
                        : "https://www.servicenow.com/products/platform.html",
                category: "official_product",
                inspection: {
                    status: "qualified",
                    readingCompleteness: "complete",
                    qualification: {
                        companyMatch:
                            condition === "unrelated" ? "unrelated" : "subject",
                        companyPassages: [
                            {
                                passageKey: "p0",
                                quotation: "ServiceNow platform workflows.",
                            },
                        ],
                        documentKind: "official_product_documentation",
                        reportingPeriodEnd: null,
                        reportingPeriodPassages: [],
                        findings: [
                            {
                                role: "official_product_platform",
                                kind: "attributed_argument",
                                summary: "Workflow control",
                                passages: [
                                    {
                                        passageKey: "p0",
                                        quotation:
                                            "ServiceNow platform workflows.",
                                    },
                                ],
                                period:
                                    condition === "historical"
                                        ? "historical"
                                        : "current",
                                periodPassages: [
                                    {
                                        passageKey: "p0",
                                        quotation:
                                            "ServiceNow platform workflows.",
                                    },
                                ],
                                dependsOnFlaggedAssertion: false,
                            },
                        ],
                        limitations: [],
                    },
                },
            }),
        ],
        {
            rejectedSourceIds:
                condition === "rejected" ? ["platform-argument"] : [],
        },
    );
    expect(result.coverageGaps).toContain("official_product_platform");
    expect(
        result.documentaryCoverageGaps.includes("official_product_platform"),
    ).toBe(condition !== "pending");
    if (condition === "pending")
        expect(result.items[0]?.roleAvailability).toContainEqual(
            expect.objectContaining({
                role: "official_product_platform",
                state: "limited",
                usage: "verification_required",
            }),
        );
});
