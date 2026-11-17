import type { Id } from "@convex/_generated/dataModel";
import type { SourceQualification } from "@convex/domain/sourceQualification";
import {
    buildSourceSelectionProposal,
    evaluateSourceCoverage,
    type SourceSelectionCandidate,
} from "@convex/domain/sourceSelectionPolicy";
import {
    projectSourceQualificationForReview,
    validatePreparedEvidenceUse,
} from "@convex/domain/sourceUsage";
import { expect, test } from "vitest";

const companies = [
    {
        cik: "0001640147",
        legalName: "Snowflake Inc.",
        ticker: "SNOW",
        websiteUrl: "https://snowflake.com",
    },
    {
        cik: "0001045810",
        legalName: "NVIDIA Corporation",
        ticker: "NVDA",
        websiteUrl: "https://nvidia.com",
    },
] as const;

test("records the new recommendation contribution without claiming unread content coverage", () => {
    const result = buildSourceSelectionProposal({
        company: companies[0],
        coveragePreset: "balanced",
        ceiling: 3,
        candidates: [1, 2].map((event) => ({
            sourceId: `event-${event}`,
            origin: "sec" as const,
            canonicalUrl: `https://www.sec.gov/Archives/edgar/data/1640147/event-${event}.htm`,
            category: "regulatory_material",
            title: `Material event ${event}`,
            secForm: "8-K",
            secAccessionNumber: `0001640147-26-00000${event}`,
            createdAt: event,
            inspection: {
                status: "unavailable" as const,
                reasonCode: "model_unavailable",
            },
        })),
    });
    expect(
        result.items.map(({ sourceId, disposition }) => ({
            sourceId,
            disposition,
        })),
    ).toEqual([
        { sourceId: "event-1", disposition: "recommended" },
        { sourceId: "event-2", disposition: "recommended" },
    ]);
    expect(result.items[1]).toMatchObject({
        coverageContributions: [],
        selectionRationale: {
            version: 1,
            trigger: "distinct_contribution",
            contributions: [
                {
                    key: "regulatory_event:0001640147-26-000002",
                    basis: "discovery_metadata",
                    kind: "filing_candidate",
                    role: "regulatory_material_event",
                },
            ],
        },
    });
});

test.each([
    { cik: "0000796343", legalName: "Adobe Inc.", ticker: "ADBE" },
    { cik: "0001045810", legalName: "NVIDIA Corporation", ticker: "NVDA" },
])("retains a structurally identified unread annual source for $legalName without content coverage", (company) => {
    const candidate: SourceSelectionCandidate = {
        sourceId: "annual",
        origin: "sec",
        secForm: "10-K",
        category: "regulatory_annual",
        createdAt: 1,
        canonicalUrl: `https://www.sec.gov/Archives/edgar/data/${Number(company.cik)}/annual.htm`,
        title: "Annual report",
        inspection: { status: "unavailable", reasonCode: "model_unavailable" },
    };
    const item = buildSourceSelectionProposal({
        company,
        candidates: [candidate],
        ceiling: 2,
        coveragePreset: "balanced",
    }).items[0];
    expect(item).toMatchObject({
        disposition: "recommended",
        reasonCodes: ["ranked_fill"],
        companyLinkageBasis: "structural",
        eligibleCoverageRoles: [],
        inspectionStatus: "unavailable",
    });
    expect(
        item?.roleAvailability?.every(
            (role) => role.state === "not_established",
        ),
    ).toBe(true);
});

test.each(
    companies,
)("keeps an unread analyst reference included for $legalName without granting coverage", (company) => {
    const candidate: SourceSelectionCandidate = {
        sourceId: "supplied-reference",
        canonicalUrl: `${company.websiteUrl}/legal/agreement`,
        title: "Agreement supplied by the analyst",
        origin: "analyst_url",
        category: "official_commercial",
        createdAt: 1,
        inspection: {
            status: "unavailable",
            reasonCode: "retrieval_unavailable",
        },
    };
    const proposal = buildSourceSelectionProposal({
        company,
        candidates: [candidate],
        ceiling: 1,
        coveragePreset: "balanced",
    });
    expect(proposal.items[0]).toMatchObject({
        disposition: "recommended",
        reasonCodes: ["added_by_analyst"],
        selectionRationale: {
            version: 1,
            trigger: "analyst_reference",
            contributions: [],
        },
        eligibleCoverageRoles: [],
        inspectionStatus: "unavailable",
    });
});

test("partial reading preserves established identity but unrelated or index content cannot gain inclusion", () => {
    const company = companies[0];
    const qualification: SourceQualification = {
        companyMatch: "uncertain",
        companyPassages: [],
        documentKind: "unknown",
        reportingPeriodEnd: null,
        reportingPeriodPassages: [],
        findings: [],
        limitations: [],
    };
    const candidate: SourceSelectionCandidate = {
        sourceId: "platform",
        canonicalUrl: `${company.websiteUrl}/docs/platform`,
        title: "Platform architecture",
        category: "official_product",
        origin: "exa",
        createdAt: 1,
        inspection: {
            status: "qualified",
            qualification,
            readingCompleteness: "partial",
        },
    };
    const proposal = () =>
        buildSourceSelectionProposal({
            company,
            candidates: [candidate],
            ceiling: 2,
            coveragePreset: "balanced",
        });
    expect(proposal().items[0]).toMatchObject({
        disposition: "recommended",
        eligibleCoverageRoles: [],
        inspectionStatus: "partial",
    });
    qualification.companyMatch = "unrelated";
    expect(proposal().items[0]?.disposition).toBe("alternative");
    qualification.companyMatch = "subject";
    qualification.documentKind = "search_or_index";
    expect(proposal().items[0]?.disposition).toBe("alternative");
});

test("preserves an independent documentary contribution beside a flagged passage", () => {
    const company = companies[0];
    const qualification: SourceQualification = {
        companyMatch: "subject",
        companyPassages: [{ passageKey: "p0", quotation: company.legalName }],
        documentKind: "official_product_documentation",
        reportingPeriodEnd: null,
        reportingPeriodPassages: [],
        findings: [
            "Storage and compute are separate.",
            "All customers have eliminated operating costs.",
        ].map((quotation, i) => ({
            role: "official_product_platform",
            kind: "asserted_fact",
            summary: quotation,
            passages: [{ passageKey: `p${i + 1}`, quotation }],
            period: "current",
            periodPassages: [],
            dependsOnFlaggedAssertion: false,
        })),
        limitations: [
            {
                code: "unverified_assertion",
                explanation: "The customer cost claim is not established.",
                passages: [
                    {
                        passageKey: "p2",
                        quotation:
                            "All customers have eliminated operating costs.",
                    },
                ],
            },
        ],
    };
    const item = buildSourceSelectionProposal({
        company,
        candidates: [
            {
                sourceId: "platform",
                canonicalUrl: `${company.websiteUrl}/docs/platform`,
                title: "Architecture",
                origin: "exa",
                category: "official_product",
                createdAt: 1,
                inspection: {
                    status: "qualified",
                    qualification,
                    readingCompleteness: "complete",
                },
            },
        ],
        ceiling: 2,
        coveragePreset: "balanced",
    }).items[0];
    if (!item) throw new Error("Missing proposal item");
    const roleAvailability = item.roleAvailability ?? [];
    const review = projectSourceQualificationForReview({
        qualification,
        roleAvailability,
        qualificationTaskId: "recorded-qualification" as Id<"aiTaskResults">,
    });
    expect(review.findings.map((finding) => finding.usage)).toEqual([
        "documentary",
        "verification_required",
    ]);
    expect(
        validatePreparedEvidenceUse({
            qualification,
            roleAvailability,
            sourceTitle: "Architecture",
            passage: {
                order: 1,
                exactQuotation: "Storage and compute are separate.",
            },
            statement: "Storage and compute are separate.",
            classification: "Fact",
            relation: "supporting",
        }),
    ).toEqual({ allowed: true, strengthensFactualSupport: true });
    expect(
        validatePreparedEvidenceUse({
            qualification,
            roleAvailability,
            sourceTitle: "Architecture",
            passage: {
                order: 2,
                exactQuotation:
                    "All customers have eliminated operating costs.",
            },
            statement: "All customers have eliminated operating costs.",
            classification: "Fact",
            relation: "supporting",
        }),
    ).toEqual({ allowed: false, reasonCode: "source_usage_restricted" });
    for (const limitation of qualification.limitations)
        limitation.passages = [];
    expect(
        projectSourceQualificationForReview({
            qualification,
            roleAvailability,
            qualificationTaskId:
                "recorded-qualification" as Id<"aiTaskResults">,
        }).findings.map((finding) => finding.usage),
    ).toEqual(["verification_required", "verification_required"]);
    expect(
        validatePreparedEvidenceUse({
            qualification,
            roleAvailability,
            sourceTitle: "Architecture",
            passage: {
                order: 1,
                exactQuotation: "Storage and compute are separate.",
            },
            statement: "Storage and compute are separate.",
            classification: "Fact",
            relation: "supporting",
        }),
    ).toEqual({ allowed: false, reasonCode: "source_usage_restricted" });
});

test.each(
    companies,
)("recognizes both covered needs in one included technical document for $legalName", (company) => {
    const roles = [
        "official_product_platform",
        "official_product_integration",
    ] as const;
    const qualification: SourceQualification = {
        companyMatch: "subject",
        companyPassages: [{ passageKey: "p0", quotation: company.legalName }],
        documentKind: "official_product_documentation",
        reportingPeriodEnd: null,
        reportingPeriodPassages: [],
        findings: roles.map((role, i) => ({
            role,
            kind: "asserted_fact",
            summary: "Technical description",
            passages: [
                {
                    passageKey: `p${i + 1}`,
                    quotation: i
                        ? "The API integrates with other applications."
                        : "The platform separates storage and compute.",
                },
            ],
            period: "current",
            periodPassages: [],
            dependsOnFlaggedAssertion: false,
        })),
        limitations: [],
    };
    const canonicalUrl = `${company.websiteUrl}/docs/platform`;
    const proposal = buildSourceSelectionProposal({
        company,
        candidates: [
            {
                sourceId: "platform",
                canonicalUrl,
                title: "Platform and API",
                origin: "exa",
                category: "official_product",
                createdAt: 1,
                inspection: {
                    status: "qualified",
                    qualification,
                    readingCompleteness: "complete",
                },
            },
        ],
        ceiling: 1,
        coveragePreset: "balanced",
    });
    const coverage = evaluateSourceCoverage(
        "balanced",
        proposal.items.map((item) => ({
            ...item,
            canonicalUrl,
            included: item.disposition === "recommended",
        })),
    );
    expect(
        coverage
            .filter((item) =>
                roles.includes(item.role as (typeof roles)[number]),
            )
            .map((item) => ({ role: item.role, covered: item.covered })),
    ).toEqual([
        { role: "official_product_platform", covered: true },
        { role: "official_product_integration", covered: true },
    ]);
    expect(proposal.coverageGaps).not.toContain("official_product_platform");
    expect(proposal.coverageGaps).not.toContain("official_product_integration");
});

test.each([
    {
        cik: "0000796343",
        legalName: "Adobe Inc.",
        ticker: "ADBE",
        websiteUrl: "https://adobe.com",
    },
    {
        cik: "0001535527",
        legalName: "CrowdStrike Holdings, Inc.",
        ticker: "CRWD",
        websiteUrl: "https://crowdstrike.com",
    },
])("retains two qualified reporting periods for $legalName", (company) => {
    const candidates: SourceSelectionCandidate[] = [
        "2026-03-31",
        "2026-06-30",
    ].map((period, index) => {
        const qualification: SourceQualification = {
            companyMatch: "subject",
            companyPassages: [
                { passageKey: "p0", quotation: company.legalName },
            ],
            documentKind: "regulatory_interim",
            reportingPeriodEnd: period,
            reportingPeriodPassages: [{ passageKey: "p1", quotation: period }],
            findings: [
                {
                    role: "regulatory_interim",
                    kind: "asserted_fact",
                    summary: "Quarterly results",
                    passages: [
                        { passageKey: "p2", quotation: "Quarterly results" },
                    ],
                    period: "current",
                    periodPassages: [{ passageKey: "p1", quotation: period }],
                    dependsOnFlaggedAssertion: false,
                },
            ],
            limitations: [],
        };
        return {
            sourceId: `quarter-${index + 1}`,
            canonicalUrl: `https://www.sec.gov/Archives/edgar/data/${Number(company.cik)}/quarter-${index + 1}.htm`,
            title: "Quarterly report",
            origin: "sec",
            secForm: "10-Q",
            category: "regulatory_interim",
            publishedAt: Date.UTC(2026, 6, index + 1),
            createdAt: 1,
            inspection: {
                status: "qualified",
                qualification,
                readingCompleteness: "complete",
            },
        };
    });
    const proposal = buildSourceSelectionProposal({
        company,
        candidates,
        ceiling: 4,
        coveragePreset: "balanced",
    });
    expect(
        proposal.items
            .filter((item) => item.disposition === "recommended")
            .map((item) => item.sourceId)
            .sort(),
    ).toEqual(["quarter-1", "quarter-2"]);
});
