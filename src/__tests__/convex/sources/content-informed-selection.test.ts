import type { SourceQualification } from "@convex/domain/sourceQualification";
import {
    buildSourceSelectionProposal,
    evaluateSourceCoverage,
    type SourceSelectionCandidate,
} from "@convex/domain/sourceSelectionPolicy";
import { expect, test } from "vitest";

const company = {
    cik: "1373715",
    legalName: "ServiceNow, Inc.",
    ticker: "NOW",
    websiteUrl: "https://servicenow.com",
};
const qualified = (
    overrides: Partial<SourceQualification> = {},
): SourceQualification => ({
    companyMatch: "subject",
    companyPassages: [{ passageKey: "p0", quotation: "ServiceNow" }],
    documentKind: "official_commercial_terms",
    reportingPeriodEnd: null,
    reportingPeriodPassages: [],
    findings: [
        {
            role: "official_commercial_terms",
            kind: "asserted_fact",
            summary: "Subscription conditions",
            passages: [
                { passageKey: "p1", quotation: "Subscription conditions" },
            ],
            period: "current",
            periodPassages: [
                { passageKey: "p1", quotation: "Current agreement" },
            ],
            dependsOnFlaggedAssertion: false,
        },
    ],
    limitations: [],
    ...overrides,
});
const candidate = (
    sourceId: string,
    result: SourceQualification,
    changes: Partial<SourceSelectionCandidate> = {},
): SourceSelectionCandidate => ({
    sourceId,
    canonicalUrl: `https://servicenow.com/legal/${sourceId}`,
    title: "Subscription agreement",
    origin: "exa",
    category: "official_commercial",
    createdAt: 1,
    inspection: {
        status: "qualified",
        qualification: result,
        readingCompleteness: "complete",
    },
    ...changes,
});
const build = (candidates: SourceSelectionCandidate[]) =>
    buildSourceSelectionProposal({
        candidates,
        company,
        ceiling: 24,
        coveragePreset: "balanced",
    });

test("establishes current commercial terms from inspected content", () => {
    expect(build([candidate("terms", qualified())]).items[0]).toMatchObject({
        eligibleCoverageRoles: ["official_commercial_terms"],
        roleAvailability: expect.arrayContaining([
            {
                role: "official_commercial_terms",
                state: "available",
                reasonCodes: [],
                usage: "documentary",
            },
        ]),
    });
});

test("mixed content remains useful but does not grant documentary factual use", () => {
    const q = qualified({ documentKind: "investor_presentation" });
    for (const finding of q.findings) {
        finding.role = "investor_presentation";
        finding.kind = "mixed_or_uncertain";
    }
    expect(build([candidate("mixed-results", q)]).items[0]).toMatchObject({
        eligibleCoverageRoles: [],
        roleAvailability: expect.arrayContaining([
            expect.objectContaining({
                role: "investor_presentation",
                state: "limited",
                usage: "verification_required",
            }),
        ]),
    });
});

test("retains narrow security information in product documentation without declaring full security coverage", () => {
    const q = qualified({ documentKind: "official_product_documentation" });
    for (const finding of q.findings)
        finding.role = "official_security_architecture";
    const result = build([candidate("platform-sheet", q)]).items[0];
    expect(result).toMatchObject({
        disposition: "recommended",
        eligibleCoverageRoles: [],
        roleAvailability: expect.arrayContaining([
            expect.objectContaining({
                role: "official_security_architecture",
                state: "limited",
                reasonCodes: ["document_scope_limited"],
                usage: "documentary",
            }),
        ]),
    });
});

test("historical terms remain useful but do not establish current terms", () => {
    const q = qualified();
    for (const finding of q.findings) finding.period = "historical";
    const result = build([candidate("old", q)]).items[0];
    expect(result).toMatchObject({
        disposition: "recommended",
        eligibleCoverageRoles: [],
        roleAvailability: expect.arrayContaining([
            expect.objectContaining({
                role: "official_commercial_terms",
                state: "limited",
                usage: "historical_only",
            }),
        ]),
    });
    if (!result) throw new Error("Expected a historical source projection");
    expect(
        evaluateSourceCoverage("balanced", [
            {
                ...result,
                canonicalUrl: "https://servicenow.com/legal/old",
                included: true,
            },
        ]).find((role) => role.role === "official_commercial_terms"),
    ).toMatchObject({ covered: false, availability: "limited" });
});

test("useful adverse arguments remain visible but require comparison without publisher promotion", () => {
    const q = qualified({ documentKind: "independent_analysis" });
    for (const finding of q.findings) {
        finding.role = "counter_evidence_primary";
        finding.kind = "attributed_argument";
    }
    const result = build([
        candidate("adverse", q, {
            canonicalUrl: "https://research.example/research",
            category: "independent_analysis",
        }),
    ]).items[0];
    expect(result).toMatchObject({
        disposition: "recommended",
        authorityTier: "unverified",
        companyLinkageBasis: "inspected_content",
        eligibleCoverageRoles: [],
        roleAvailability: expect.arrayContaining([
            expect.objectContaining({
                role: "counter_evidence_primary",
                state: "limited",
                reasonCodes: ["comparison_required"],
                usage: "verification_required",
            }),
        ]),
    });
});

test.each([
    "incidental_mention",
    "unrelated",
    "uncertain",
] as const)("%s does not acquire coverage from a plausible title", (companyMatch) => {
    const result = build([candidate("terms", qualified({ companyMatch }))])
        .items[0];
    expect(result?.disposition).toBe("alternative");
    expect(result?.eligibleCoverageRoles).toEqual([]);
});

test("product documentation cannot become commercial terms through a model role", () => {
    expect(
        build([
            candidate(
                "contracts-app",
                qualified({ documentKind: "official_product_documentation" }),
            ),
        ]).items[0]?.eligibleCoverageRoles,
    ).toEqual([]);
});

test("an obsolete destination does not retain presentation coverage", () => {
    expect(
        build([
            candidate(
                "presentation",
                qualified({ documentKind: "search_or_index" }),
            ),
        ]).items[0],
    ).toMatchObject({ disposition: "alternative", eligibleCoverageRoles: [] });
});

test("unavailable and partial reading do not prove absence or relevance", () => {
    const unavailable = candidate("unread", qualified(), {
        inspection: {
            status: "unavailable",
            reasonCode: "retrieval_unavailable",
        },
    });
    expect(build([unavailable]).items[0]).toMatchObject({
        eligibleCoverageRoles: [],
        inspectionStatus: "unavailable",
    });
    const partial = candidate("partial", qualified({ findings: [] }), {
        inspection: {
            status: "qualified",
            qualification: qualified({ findings: [] }),
            readingCompleteness: "partial",
        },
    });
    expect(build([partial]).items[0]?.roleAvailability).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                state: "not_established",
                reasonCodes: ["partial_reading"],
            }),
        ]),
    );
});

test("a finding dependent on a flagged assertion cannot establish useful coverage", () => {
    const q = qualified();
    for (const finding of q.findings) finding.dependsOnFlaggedAssertion = true;
    expect(
        build([candidate("unsafe", q)]).items[0]?.eligibleCoverageRoles,
    ).toEqual([]);
});

test("cited reporting periods distinguish reports published in the same quarter", () => {
    const q = qualified({
        documentKind: "earnings_release",
        reportingPeriodEnd: "2026-03-31",
    });
    for (const finding of q.findings) finding.role = "investor_results";
    const later = { ...q, reportingPeriodEnd: "2026-06-30" };
    const result = build([
        candidate("q1", q, { publishedAt: Date.UTC(2026, 6, 1) }),
        candidate("q2", later, { publishedAt: Date.UTC(2026, 6, 30) }),
    ]);
    expect(result.items.map((item) => item.duplicateOfSourceId)).toEqual([
        undefined,
        undefined,
    ]);
    expect(result.items.find((item) => item.sourceId === "q1")).toMatchObject({
        selectionRationale: {
            trigger: "distinct_contribution",
            contributions: [
                {
                    key: "earnings_release:2026-q1",
                    kind: "report_candidate",
                    basis: "inspected_content",
                    reportingPeriodEnd: "2026-03-31",
                },
            ],
        },
    });
});
