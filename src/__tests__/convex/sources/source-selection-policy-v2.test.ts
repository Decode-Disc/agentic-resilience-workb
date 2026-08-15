import { buildSourceSelectionProposal } from "@convex/domain/sourceSelectionPolicy";
import { describe, expect, test } from "vitest";

type Candidate = Parameters<
    typeof buildSourceSelectionProposal
>[0]["candidates"][number];

const company = {
    cik: "1373715",
    legalName: "ServiceNow, Inc.",
    ticker: "NOW",
    websiteUrl: "https://servicenow.com/",
};

function candidate(
    sourceId: string,
    canonicalUrl: string,
    title: string,
    overrides: Partial<Candidate> = {},
): Candidate {
    return {
        sourceId,
        canonicalUrl,
        title,
        origin: "exa",
        category: "counter_evidence",
        providerResultPosition: 0,
        discoveryQueryIndex: 0,
        createdAt: 1,
        ...overrides,
    };
}

function build(candidates: ReadonlyArray<Candidate>) {
    return buildSourceSelectionProposal({
        candidates,
        company,
        coveragePreset: "balanced",
        ceiling: 24,
    });
}

describe("source selection policy v2", () => {
    test("prefers primary filings and excludes filing indexes and low-value forms", () => {
        const result = build([
            candidate(
                "filing-index",
                "https://fintel.io/sf/us/now",
                "NOW SEC Filings - Annual Report, Proxy and 10-Q",
                { category: "regulatory", providerResultPosition: 0 },
            ),
            candidate(
                "annual",
                "https://www.sec.gov/Archives/edgar/data/1373715/annual.htm",
                "10-K · 2026-01-29",
                { category: "regulatory", secForm: "10-K" },
            ),
            candidate(
                "interim",
                "https://www.sec.gov/Archives/edgar/data/1373715/interim.htm",
                "10-Q · 2026-07-23",
                { category: "regulatory", origin: "sec", secForm: "10-Q" },
            ),
            candidate(
                "material",
                "https://www.sec.gov/Archives/edgar/data/1373715/material.htm",
                "8-K · 2026-07-22",
                { category: "regulatory", origin: "sec", secForm: "8-K" },
            ),
            candidate(
                "ownership",
                "https://www.sec.gov/Archives/edgar/data/1373715/ownership.htm",
                "4 · 2026-08-01",
                { category: "regulatory", origin: "sec", secForm: "4" },
            ),
        ]);

        expect(recommendedIds(result)).toEqual([
            "annual",
            "interim",
            "material",
        ]);
        expect(item(result, "filing-index")).toMatchObject({
            disposition: "alternative",
            documentKind: "search_or_index",
            reasonCodes: ["search_or_index"],
        });
        expect(item(result, "ownership")).toMatchObject({
            disposition: "alternative",
            documentKind: "regulatory_ownership",
            reasonCodes: ["low_information_document"],
        });
    });

    test("does not classify partial path tokens as search indexes or community content", () => {
        const result = build([
            candidate(
                "partial-filings",
                "https://fintel.io/filingsarchive/servicenow",
                "Archive",
                { category: "regulatory" },
            ),
            candidate(
                "filings-index",
                "https://fintel.io/filings/servicenow",
                "Filings",
                { category: "regulatory" },
            ),
            candidate(
                "partial-community",
                "https://www.servicenow.com/communityish/question",
                "Question",
                { category: "official_product" },
            ),
        ]);

        expect(item(result, "partial-filings")).toMatchObject({
            documentKind: "unknown",
            reasonCodes: ["unverified_publisher"],
        });
        expect(item(result, "filings-index")).toMatchObject({
            documentKind: "search_or_index",
            reasonCodes: ["search_or_index"],
        });
        expect(item(result, "partial-community")).toMatchObject({
            documentKind: "unknown",
            reasonCodes: ["no_new_coverage"],
        });
    });

    test("uses publisher authority and document kind instead of the discovery category", () => {
        const result = build([
            candidate(
                "official-product",
                "https://www.servicenow.com/docs/integration-api.html",
                "Integration API documentation",
                { category: "official_product" },
            ),
            candidate(
                "community",
                "https://www.servicenow.com/community/api-question/td-p/1",
                "Solved: Which REST API should I use? - ServiceNow Community",
                { category: "official_product" },
            ),
            candidate(
                "official-pricing",
                "https://www.servicenow.com/products/pricing.html",
                "ServiceNow pricing",
                { category: "official_commercial" },
            ),
            candidate(
                "misclassified-sec",
                "https://www.sec.gov/Archives/edgar/data/1373715/registration.htm",
                "S-1",
                { category: "official_commercial", secForm: "S-1" },
            ),
            candidate(
                "morningstar",
                "https://www.morningstar.com/stocks/servicenow-risk-analysis",
                "ServiceNow risk analysis",
            ),
            candidate(
                "unverified-ai",
                "https://flash.stocksentinel.ai/now/research-report",
                "ServiceNow stock research report",
                { category: "official_product" },
            ),
        ]);

        expect(recommendedIds(result)).toEqual([
            "official-product",
            "official-pricing",
            "morningstar",
        ]);
        expect(item(result, "official-product")).toMatchObject({
            authorityTier: "company_primary",
            documentKind: "official_integration_documentation",
            sourceFamily: "official_product",
        });
        expect(item(result, "community")).toMatchObject({
            disposition: "alternative",
            documentKind: "community_content",
        });
        expect(item(result, "misclassified-sec")).toMatchObject({
            disposition: "alternative",
            sourceFamily: "regulatory",
        });
        expect(item(result, "unverified-ai")).toMatchObject({
            disposition: "alternative",
            authorityTier: "unverified",
            reasonCodes: ["unverified_publisher"],
        });
    });

    test("keeps unverified counter-evidence inspectable without filling required roles", () => {
        const result = build([
            candidate(
                "bear-analysis",
                "https://hatedmoats.substack.com/p/servicenow-deep-dive-analysis",
                "ServiceNow: Deep Dive Analysis",
            ),
            candidate(
                "ubs-downgrade",
                "https://intellectia.ai/news/etf/ubs-downgrades-servicenow",
                "UBS Downgrades ServiceNow to Neutral",
            ),
            candidate(
                "junk-aggregator",
                "https://askcyborg.com/preview/servicenow",
                "ServiceNow Business Model & Cyborg Sco",
            ),
            candidate(
                "non-counter-unverified",
                "https://someblog.example/servicenow",
                "ServiceNow blog post",
                { category: "official_product" },
            ),
            candidate(
                "unrelated-company",
                "https://hatedmoats.substack.com/p/acme-deep-dive",
                "Acme Corporation Deep Dive Analysis",
            ),
        ]);

        expect(item(result, "bear-analysis")).toMatchObject({
            disposition: "alternative",
            authorityTier: "unverified",
            sourceFamily: "counter_evidence",
            documentKind: "unverified_counter_evidence",
            reasonCodes: ["unverified_counter_evidence"],
        });
        expect(item(result, "ubs-downgrade")).toMatchObject({
            disposition: "alternative",
            authorityTier: "unverified",
            sourceFamily: "counter_evidence",
            documentKind: "unverified_counter_evidence",
            reasonCodes: ["unverified_counter_evidence"],
        });
        expect(result.coverageGaps).toEqual(
            expect.arrayContaining([
                "counter_evidence_primary",
                "counter_evidence_secondary",
            ]),
        );
        expect(item(result, "junk-aggregator")).toMatchObject({
            disposition: "alternative",
            authorityTier: "unverified",
            reasonCodes: ["unverified_publisher"],
        });
        expect(item(result, "non-counter-unverified")).toMatchObject({
            disposition: "alternative",
            authorityTier: "unverified",
            reasonCodes: ["unverified_publisher"],
        });
        expect(item(result, "unrelated-company")).toMatchObject({
            disposition: "alternative",
            authorityTier: "unverified",
            reasonCodes: ["unverified_publisher"],
        });
    });

    test("does not use a title alone to confirm an unverified counter-evidence lead", () => {
        const result = build([
            candidate(
                "title-only-company-match",
                "https://analyst-notes.example.com/posts/market-pressure",
                "ServiceNow downside analysis",
            ),
        ]);

        expect(item(result, "title-only-company-match")).toMatchObject({
            disposition: "alternative",
            authorityTier: "unverified",
            reasonCodes: ["unverified_publisher"],
        });
    });

    test("does not confirm company identity from query parameters or partial path tokens", () => {
        const result = build([
            candidate(
                "query-only-company-match",
                "https://www.reuters.com/technology/workflow-risk?company=servicenow",
                "Workflow risk",
            ),
            candidate(
                "partial-token-company-match",
                "https://www.reuters.com/technology/servicenowish-workflow-risk",
                "Workflow risk",
            ),
        ]);

        for (const sourceId of [
            "query-only-company-match",
            "partial-token-company-match",
        ]) {
            expect(item(result, sourceId)).toMatchObject({
                disposition: "alternative",
                authorityTier: "institutional_independent",
                reasonCodes: ["company_identity_unverified"],
            });
        }
    });

    test("recommends an opaque institutional source from explicit discovery metadata", () => {
        const result = build([
            candidate(
                "morningstar-analysis",
                "https://www.morningstar.com/stocks/deeply-undervalued-stock-long-term-investors-who-can-handle-uncertainty",
                "ServiceNow: A Deeply Undervalued Stock for Long-Term Investors Who Can Handle Uncertainty | Morningstar",
            ),
        ]);

        expect(item(result, "morningstar-analysis")).toMatchObject({
            disposition: "recommended",
            authorityTier: "institutional_independent",
            documentKind: "independent_analysis",
            sourceFamily: "independent_analysis",
            companyLinkageBasis: "discovery_metadata",
            declaredCoverageRoles: [
                "counter_evidence_primary",
                "counter_evidence_secondary",
                "independent_analysis_primary",
                "independent_analysis_secondary",
            ],
            eligibleCoverageRoles: [],
            coverageContributions: [],
            recommendationContributions: [
                expect.stringMatching(
                    /^company_linkage:discovery_metadata:morningstar\.com:/,
                ),
            ],
        });
        expect(result.coverageGaps).toEqual(
            expect.arrayContaining([
                "counter_evidence_primary",
                "counter_evidence_secondary",
            ]),
        );
    });

    test("recommends opaque shared IR from a distinctive domain alias without classifying its title", () => {
        const cccCompany = {
            cik: "1818201",
            legalName: "CCC Intelligent Solutions Holdings Inc.",
            ticker: "CCCS",
            websiteUrl: "https://cccis.com/",
        };
        const result = buildSourceSelectionProposal({
            candidates: [
                candidate(
                    "opaque-shared-ir",
                    "https://s205.q4cdn.com/916135447/files/downloads/opaque-document.pdf",
                    "CCCIS Annual Report 2025",
                    { category: "investor_relations" },
                ),
            ],
            company: cccCompany,
            coveragePreset: "balanced",
            ceiling: 24,
        });

        expect(item(result, "opaque-shared-ir")).toMatchObject({
            disposition: "recommended",
            authorityTier: "company_hosted_ir",
            companyLinkageBasis: "discovery_metadata",
            documentKind: "unknown",
            sourceFamily: "unrecognized",
            declaredCoverageRoles: [],
            eligibleCoverageRoles: [],
        });
    });

    test("rejects weak discovery metadata attribution signals", () => {
        const shortAliasCompany = {
            cik: "0001",
            legalName: "Box Inc.",
            ticker: "BOX",
            websiteUrl: "https://box.com/",
        };
        const result = buildSourceSelectionProposal({
            candidates: [
                candidate(
                    "ticker-only",
                    "https://www.reuters.com/technology/workflow-risk",
                    "NOW workflow risk",
                ),
                candidate(
                    "short-alias",
                    "https://www.reuters.com/technology/cloud-risk",
                    "Box cloud risk",
                ),
            ],
            company: shortAliasCompany,
            coveragePreset: "balanced",
            ceiling: 24,
        });

        for (const sourceId of ["ticker-only", "short-alias"]) {
            expect(item(result, sourceId)).toMatchObject({
                disposition: "alternative",
                companyLinkageBasis: "unverified",
                eligibleCoverageRoles: [],
                reasonCodes: ["company_identity_unverified"],
            });
        }
    });

    test("does not admit partners or unregistered publishers through title metadata", () => {
        const result = build([
            candidate(
                "qualified-partner-title",
                "https://aws.amazon.com/marketplace/opaque-product",
                "ServiceNow marketplace listing",
                { category: "official_product" },
            ),
            candidate(
                "unregistered-title",
                "https://research.example.com/opaque-analysis",
                "ServiceNow downside analysis",
            ),
        ]);

        expect(item(result, "qualified-partner-title")).toMatchObject({
            disposition: "alternative",
            companyLinkageBasis: "unverified",
            reasonCodes: ["company_identity_unverified"],
        });
        expect(item(result, "unregistered-title")).toMatchObject({
            disposition: "alternative",
            companyLinkageBasis: "unverified",
            reasonCodes: ["unverified_publisher"],
        });
    });

    test("requires a distinctive domain alias or complete legal-name sequence", () => {
        const cccCompany = {
            cik: "1818201",
            legalName: "CCC Intelligent Solutions Holdings Inc.",
            ticker: "CCCS",
            websiteUrl: "https://cccis.com/",
        };
        const result = buildSourceSelectionProposal({
            candidates: [
                candidate(
                    "generic-solutions",
                    "https://www.reuters.com/technology/solutions-market",
                    "Solutions market",
                ),
                candidate(
                    "domain-alias",
                    "https://www.reuters.com/technology/cccis-market",
                    "CCCS market",
                ),
                candidate(
                    "legal-name-sequence",
                    "https://www.reuters.com/technology/ccc-intelligent-solutions-market",
                    "CCC market",
                ),
            ],
            company: cccCompany,
            coveragePreset: "balanced",
            ceiling: 24,
        });

        expect(item(result, "generic-solutions")).toMatchObject({
            disposition: "alternative",
            reasonCodes: ["company_identity_unverified"],
        });
        for (const sourceId of ["domain-alias", "legal-name-sequence"]) {
            expect(item(result, sourceId)).toMatchObject({
                authorityTier: "institutional_independent",
            });
            expect(item(result, sourceId)?.reasonCodes).not.toContain(
                "company_identity_unverified",
            );
        }
    });

    test("keeps qualified reseller terms corroborative instead of canonical", () => {
        const result = build([
            candidate(
                "carahsoft-eula",
                "https://static.carahsoft.com/concrete/files/9414/3569/2932/ServiceNow_EULA.PDF",
                "ServiceNow EULA",
                { category: "official_commercial" },
            ),
        ]);

        expect(item(result, "carahsoft-eula")).toMatchObject({
            disposition: "alternative",
            authorityTier: "qualified_partner",
            sourceFamily: "official_commercial",
            documentKind: "partner_evidence",
            reasonCodes: ["qualified_partner_manual_review"],
        });
        expect(
            item(result, "carahsoft-eula")?.coverageContributions,
        ).not.toContain("official_commercial_terms");
        expect(result.coverageGaps).toContain("official_commercial_terms");
    });

    test("keeps qualified partner material without declared roles out of automatic selection", () => {
        const result = build([
            candidate(
                "aws-marketplace",
                "https://aws.amazon.com/marketplace/pp/prodview-servicenow",
                "ServiceNow on AWS Marketplace",
                { category: "official_product" },
            ),
        ]);

        expect(item(result, "aws-marketplace")).toMatchObject({
            disposition: "alternative",
            authorityTier: "qualified_partner",
            eligibleCoverageRoles: [],
            reasonCodes: ["qualified_partner_manual_review"],
        });
    });

    test("does not let independent, partner, or unrelated hosted IR sources satisfy first-party roles", () => {
        const result = build([
            candidate(
                "reuters-pricing",
                "https://www.reuters.com/technology/servicenow-pricing-pressure",
                "ServiceNow pricing comes under pressure",
            ),
            candidate(
                "aws-security",
                "https://aws.amazon.com/marketplace/servicenow-security",
                "ServiceNow security architecture on AWS Marketplace",
            ),
            candidate(
                "unrelated-ir",
                "https://s26.q4cdn.com/123456789/files/doc_financials/2026/acme-q2-results.pdf",
                "Acme Corporation second quarter 2026 financial results",
                { category: "investor_relations" },
            ),
            candidate(
                "servicenow-ir",
                "https://s26.q4cdn.com/123456789/files/doc_financials/2026/servicenow-q2-results.pdf",
                "ServiceNow second quarter 2026 financial results",
                { category: "investor_relations" },
            ),
        ]);

        expect(item(result, "reuters-pricing")).toMatchObject({
            authorityTier: "institutional_independent",
            documentKind: "news_reporting",
            sourceFamily: "counter_evidence",
        });
        expect(
            item(result, "reuters-pricing")?.coverageContributions,
        ).not.toContain("official_commercial_pricing");
        expect(item(result, "aws-security")).toMatchObject({
            authorityTier: "qualified_partner",
            documentKind: "partner_evidence",
        });
        expect(
            item(result, "aws-security")?.coverageContributions,
        ).not.toContain("official_security_architecture");
        expect(item(result, "unrelated-ir")).toMatchObject({
            disposition: "alternative",
            authorityTier: "company_hosted_ir",
            reasonCodes: ["company_identity_unverified"],
        });
        expect(item(result, "servicenow-ir")).toMatchObject({
            disposition: "recommended",
            authorityTier: "company_hosted_ir",
            documentKind: "earnings_release",
        });
    });

    test("grants trusted publishers only their declared automatic roles", () => {
        const result = build([
            candidate(
                "reuters-market-update",
                "https://www.reuters.com/technology/servicenow-market-update",
                "ServiceNow independent analysis",
            ),
        ]);

        expect(item(result, "reuters-market-update")).toMatchObject({
            authorityTier: "institutional_independent",
            documentKind: "news_reporting",
            sourceFamily: "counter_evidence",
            eligibleCoverageRoles: [
                "counter_evidence_primary",
                "counter_evidence_secondary",
            ],
        });
    });

    test("rejects a primary filing whose SEC issuer identity conflicts with the selected company", () => {
        const result = build([
            candidate(
                "other-issuer",
                "https://www.sec.gov/Archives/edgar/data/1818201/000181820126000001/other-20251231.htm",
                "10-K · 2026-02-20",
                {
                    origin: "sec",
                    category: "regulatory",
                    secForm: "10-K",
                    secAccessionNumber: "0001818201-26-000001",
                },
            ),
        ]);

        expect(item(result, "other-issuer")).toMatchObject({
            disposition: "needs_attention",
            authorityTier: "regulator_primary",
            reasonCodes: ["integrity_conflict"],
        });
    });

    test("does not infer final classifications from discovery intent or filing titles", () => {
        const result = build([
            candidate(
                "category-only-product",
                "https://www.servicenow.com/company/overview",
                "Company overview",
                { category: "official_product" },
            ),
            candidate(
                "title-only-filing",
                "https://www.sec.gov/Archives/edgar/data/1373715/untyped.htm",
                "10-K · 2026-01-29",
                { category: "regulatory", origin: "sec" },
            ),
        ]);

        expect(item(result, "category-only-product")).toMatchObject({
            disposition: "alternative",
            documentKind: "unknown",
        });
        expect(item(result, "title-only-filing")).toMatchObject({
            disposition: "alternative",
            documentKind: "regulatory_other",
            reasonCodes: ["low_information_document"],
        });
    });

    test("does not grant a first-party role from a title alone", () => {
        const result = build([
            candidate(
                "title-only-pricing",
                "https://www.servicenow.com/company/news.html",
                "ServiceNow pricing terms API integration security",
                { category: "official_commercial" },
            ),
        ]);

        expect(item(result, "title-only-pricing")).toMatchObject({
            disposition: "alternative",
            documentKind: "unknown",
            eligibleCoverageRoles: [],
        });
        expect(result.coverageGaps).toContain("official_commercial_pricing");
    });

    test("does not fill the adaptive ceiling with redundant sources", () => {
        const result = build([
            candidate(
                "results-primary",
                "https://investor.servicenow.com/news/results-q2-2026",
                "ServiceNow Reports Second Quarter 2026 Financial Results",
                {
                    category: "investor_relations",
                    providerResultPosition: 0,
                    publishedAt: Date.UTC(2026, 6, 23),
                },
            ),
            candidate(
                "results-duplicate",
                "https://newsroom.servicenow.com/results-q2-2026",
                "ServiceNow Reports Second Quarter 2026 Financial Results",
                {
                    category: "investor_relations",
                    providerResultPosition: 1,
                    publishedAt: Date.UTC(2026, 6, 23),
                },
            ),
            candidate(
                "unknown-one",
                "https://unknown-one.example/report",
                "ServiceNow analysis",
                { category: "official_product", providerResultPosition: 1 },
            ),
            candidate(
                "unknown-two",
                "https://unknown-two.example/report",
                "ServiceNow analysis",
                { category: "official_product", providerResultPosition: 2 },
            ),
        ]);

        expect(recommendedIds(result)).toEqual(["results-primary"]);
        expect(result.counts.recommended).toBe(1);
        expect(item(result, "results-duplicate")).toMatchObject({
            disposition: "alternative",
            duplicateOfSourceId: undefined,
            reasonCodes: ["no_new_coverage"],
        });
        expect(
            result.items.filter(
                ({ disposition }) => disposition === "needs_attention",
            ),
        ).toHaveLength(0);
    });

    test("does not deduplicate same-title documents without stable metadata", () => {
        const result = build([
            candidate(
                "same-title-one",
                "https://investor.servicenow.com/news/financial-results-one",
                "ServiceNow second quarter 2026 financial results",
                { category: "investor_relations" },
            ),
            candidate(
                "same-title-two",
                "https://newsroom.servicenow.com/financial-results-two",
                "ServiceNow second quarter 2026 financial results",
                { category: "investor_relations", providerResultPosition: 1 },
            ),
        ]);

        expect(item(result, "same-title-one")).toMatchObject({
            disposition: "recommended",
            duplicateOfSourceId: undefined,
        });
        expect(item(result, "same-title-two")).toMatchObject({
            disposition: "recommended",
            duplicateOfSourceId: undefined,
        });
    });

    test("does not infer first-party roles from incidental URL tokens", () => {
        const result = build([
            candidate(
                "customer-results",
                "https://www.servicenow.com/customers/results/acme",
                "Customer results",
                { category: "investor_relations" },
            ),
            candidate(
                "capital-allocation",
                "https://www.servicenow.com/company/capital-allocation",
                "Capital allocation",
                { category: "official_product" },
            ),
            candidate(
                "subscription-marketing",
                "https://www.servicenow.com/company/subscription-management",
                "Subscription management",
                { category: "official_commercial" },
            ),
        ]);

        for (const sourceId of [
            "customer-results",
            "capital-allocation",
            "subscription-marketing",
        ]) {
            expect(item(result, sourceId)).toMatchObject({
                disposition: "alternative",
                documentKind: "unknown",
                eligibleCoverageRoles: [],
            });
        }
    });

    test("uses SEC accession identity before titles when proving duplicates", () => {
        const result = build([
            candidate(
                "same-accession-primary",
                "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000001/now-20251231.htm",
                "ServiceNow annual report",
                {
                    origin: "sec",
                    category: "regulatory",
                    secForm: "10-K",
                    secAccessionNumber: "0001373715-26-000001",
                    publishedAt: Date.UTC(2026, 0, 29),
                },
            ),
            candidate(
                "same-accession-copy",
                "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000001/alternate-document.htm",
                "10-K filing document copy",
                {
                    origin: "sec",
                    category: "regulatory",
                    secForm: "10-K",
                    secAccessionNumber: "0001373715-26-000001",
                    publishedAt: Date.UTC(2026, 0, 29),
                    providerResultPosition: 1,
                },
            ),
            candidate(
                "different-accession-same-title",
                "https://www.sec.gov/Archives/edgar/data/1373715/000137371525000001/now-20241231.htm",
                "ServiceNow annual report",
                {
                    origin: "sec",
                    category: "regulatory",
                    secForm: "10-K",
                    secAccessionNumber: "0001373715-25-000001",
                    publishedAt: Date.UTC(2025, 0, 30),
                    providerResultPosition: 2,
                },
            ),
        ]);

        expect(item(result, "same-accession-copy")).toMatchObject({
            disposition: "alternative",
            duplicateOfSourceId: "same-accession-primary",
            reasonCodes: ["metadata_duplicate"],
        });
        expect(item(result, "different-accession-same-title")).toMatchObject({
            disposition: "recommended",
            duplicateOfSourceId: undefined,
        });
    });

    test("does not collapse distinct SEC periods or official documents from title alone", () => {
        const result = build([
            candidate(
                "annual-2026",
                "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000001/annual.htm",
                "ServiceNow annual report",
                {
                    origin: "sec",
                    category: "regulatory",
                    secForm: "10-K",
                    publishedAt: Date.UTC(2026, 0, 29),
                },
            ),
            candidate(
                "annual-2025",
                "https://www.sec.gov/Archives/edgar/data/1373715/000137371525000001/annual.htm",
                "ServiceNow annual report",
                {
                    origin: "sec",
                    category: "regulatory",
                    secForm: "10-K",
                    publishedAt: Date.UTC(2025, 0, 30),
                },
            ),
            candidate(
                "product-overview",
                "https://www.servicenow.com/products/overview",
                "ServiceNow product documentation",
            ),
            candidate(
                "product-architecture",
                "https://www.servicenow.com/products/architecture",
                "ServiceNow product documentation",
            ),
        ]);

        for (const sourceId of [
            "annual-2026",
            "annual-2025",
            "product-overview",
            "product-architecture",
        ]) {
            expect(item(result, sourceId)).toMatchObject({
                disposition: "recommended",
                duplicateOfSourceId: undefined,
            });
        }
    });

    test("keeps the eligible SEC document instead of its index for the same accession", () => {
        const result = build([
            candidate(
                "accession-index",
                "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000001/0001373715-26-000001-index.htm",
                "EDGAR Filing Documents for 0001373715-26-000001",
                { origin: "exa", category: "regulatory" },
            ),
            candidate(
                "accession-document",
                "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000001/annual.htm",
                "10-K",
                {
                    origin: "exa",
                    category: "regulatory",
                    secForm: "10-K",
                },
            ),
        ]);

        expect(item(result, "accession-document")).toMatchObject({
            disposition: "recommended",
            documentKind: "regulatory_annual",
            duplicateOfSourceId: undefined,
        });
        expect(item(result, "accession-index")).toMatchObject({
            disposition: "alternative",
            documentKind: "search_or_index",
            duplicateOfSourceId: "accession-document",
        });
    });

    test("enforces annual, interim, and material-event series caps independently", () => {
        const filings = [
            ...Array.from({ length: 4 }, (_, index) =>
                candidate(
                    `annual-${index}`,
                    `https://www.sec.gov/Archives/edgar/data/1373715/annual-${index}.htm`,
                    `10-K · ${2026 - index}-01-30`,
                    {
                        origin: "sec",
                        category: "regulatory",
                        secForm: "10-K",
                        secAccessionNumber: `annual-${index}`,
                        publishedAt: Date.UTC(2026 - index, 0, 30),
                    },
                ),
            ),
            ...Array.from({ length: 4 }, (_, index) =>
                candidate(
                    `interim-${index}`,
                    `https://www.sec.gov/Archives/edgar/data/1373715/interim-${index}.htm`,
                    `10-Q · 2026-${String(index + 3).padStart(2, "0")}-30`,
                    {
                        origin: "sec",
                        category: "regulatory",
                        secForm: "10-Q",
                        secAccessionNumber: `interim-${index}`,
                        publishedAt: Date.UTC(2026, index + 2, 30),
                    },
                ),
            ),
            ...Array.from({ length: 6 }, (_, index) =>
                candidate(
                    `material-${index}`,
                    `https://www.sec.gov/Archives/edgar/data/1373715/material-${index}.htm`,
                    `8-K · 2026-07-${String(index + 1).padStart(2, "0")}`,
                    {
                        origin: "sec",
                        category: "regulatory",
                        secForm: "8-K",
                        secAccessionNumber: `material-${index}`,
                        publishedAt: Date.UTC(2026, 6, index + 1),
                    },
                ),
            ),
        ];
        const result = build(filings);
        const recommended = result.items.filter(
            ({ disposition }) => disposition === "recommended",
        );

        expect(
            recommended.filter(
                ({ documentKind }) => documentKind === "regulatory_annual",
            ),
        ).toHaveLength(2);
        expect(
            recommended.filter(
                ({ documentKind }) => documentKind === "regulatory_interim",
            ),
        ).toHaveLength(2);
        expect(
            recommended.filter(
                ({ documentKind }) => documentKind === "regulatory_material",
            ),
        ).toHaveLength(3);
    });

    test("applies one combined independent-producer cap across news and analysis", () => {
        const result = buildSourceSelectionProposal({
            candidates: [
                candidate(
                    "reuters-news",
                    "https://reuters.com/technology/servicenow-news",
                    "ServiceNow market update",
                ),
                candidate(
                    "bloomberg-news",
                    "https://bloomberg.com/news/servicenow-update",
                    "ServiceNow market update",
                ),
                candidate(
                    "morningstar-analysis",
                    "https://morningstar.com/stocks/servicenow-risk",
                    "ServiceNow risk analysis",
                ),
                candidate(
                    "gartner-analysis",
                    "https://gartner.com/reviews/servicenow-competition",
                    "ServiceNow competition analysis",
                ),
                candidate(
                    "forrester-analysis",
                    "https://forrester.com/report/servicenow-research",
                    "ServiceNow research analysis",
                ),
                candidate(
                    "idc-analysis",
                    "https://idc.com/report/servicenow-research",
                    "ServiceNow workflow research analysis",
                ),
            ],
            company,
            coveragePreset: "balanced",
            ceiling: 24,
        });

        expect(
            result.items.filter(
                ({ disposition, sourceFamily }) =>
                    disposition === "recommended" &&
                    ["counter_evidence", "independent_analysis"].includes(
                        sourceFamily,
                    ),
            ),
        ).toHaveLength(4);
    });

    test("caps each official contribution family at four recommendations", () => {
        const differentiators = [
            "automation",
            "database",
            "analytics",
            "operations",
            "governance",
            "orchestration",
        ];
        const result = build([
            ...differentiators.map((differentiator, index) =>
                candidate(
                    `product-${index}`,
                    `https://www.servicenow.com/products/${differentiator}`,
                    `ServiceNow ${differentiator} product platform capability`,
                ),
            ),
            ...differentiators.map((differentiator, index) =>
                candidate(
                    `commercial-${index}`,
                    `https://www.servicenow.com/pricing/${differentiator}`,
                    `ServiceNow ${differentiator} pricing offer`,
                ),
            ),
        ]);
        const recommended = result.items.filter(
            ({ disposition }) => disposition === "recommended",
        );

        expect(
            recommended.filter(
                ({ sourceFamily }) => sourceFamily === "official_product",
            ),
        ).toHaveLength(4);
        expect(
            recommended.filter(
                ({ sourceFamily }) => sourceFamily === "official_commercial",
            ),
        ).toHaveLength(4);
    });

    test("keeps analyst sources included and gives every recommendation a coverage contribution", () => {
        const result = build([
            candidate(
                "analyst-source",
                "https://specialist.example/servicenow",
                "Specialist source supplied by the analyst",
                {
                    origin: "analyst_url",
                    category: "analyst_supplied",
                    providerResultPosition: undefined,
                    discoveryQueryIndex: undefined,
                },
            ),
            candidate(
                "reuters",
                "https://www.reuters.com/technology/servicenow-analysis",
                "ServiceNow faces workflow competition",
            ),
        ]);

        expect(item(result, "analyst-source")).toMatchObject({
            disposition: "recommended",
            authorityTier: "analyst_supplied",
            reasonCodes: ["added_by_analyst"],
        });
        for (const recommended of result.items.filter(
            ({ disposition }) => disposition === "recommended",
        )) {
            expect(recommended.coverageContributions.length).toBeGreaterThan(0);
        }
    });

    test("includes every analyst source before applying the discovery ceiling", () => {
        const result = buildSourceSelectionProposal({
            candidates: [
                candidate(
                    "analyst-one",
                    "https://specialist.example/one",
                    "First analyst source",
                    {
                        origin: "analyst_url",
                        category: "analyst_supplied",
                    },
                ),
                candidate(
                    "analyst-two",
                    "https://specialist.example/two",
                    "Second analyst source",
                    {
                        origin: "analyst_url",
                        category: "analyst_supplied",
                    },
                ),
                candidate(
                    "discovered-source",
                    "https://www.reuters.com/technology/servicenow-risk",
                    "ServiceNow risk",
                ),
            ],
            company,
            coveragePreset: "balanced",
            ceiling: 1,
        });

        expect(recommendedIds(result)).toEqual([
            "analyst-one",
            "analyst-two",
            "discovered-source",
        ]);
        expect(item(result, "discovered-source")).toMatchObject({
            disposition: "recommended",
            reasonCodes: ["required_coverage_role"],
        });
    });

    test("does not call the discovery ceiling reached when analyst sources fill the total", () => {
        const result = buildSourceSelectionProposal({
            candidates: [
                candidate(
                    "analyst-one",
                    "https://specialist.example/one",
                    "First analyst source",
                    { origin: "analyst_url", category: "analyst_supplied" },
                ),
                candidate(
                    "analyst-two",
                    "https://specialist.example/two",
                    "Second analyst source",
                    { origin: "analyst_url", category: "analyst_supplied" },
                ),
                candidate(
                    "reuters-primary",
                    "https://www.reuters.com/technology/servicenow-risk",
                    "ServiceNow risk",
                ),
                candidate(
                    "reuters-redundant",
                    "https://www.reuters.com/technology/servicenow-risk-update",
                    "ServiceNow risk update",
                ),
            ],
            company,
            coveragePreset: "balanced",
            ceiling: 3,
        });

        expect(item(result, "reuters-redundant")).toMatchObject({
            disposition: "alternative",
            reasonCodes: ["no_new_coverage"],
        });
    });

    test("limits analyst attention to one genuine provenance conflict", () => {
        const result = build([
            candidate("conflict-one", "not-a-url", "Broken source one"),
            candidate("conflict-two", "also-not-a-url", "Broken source two"),
        ]);

        expect(
            result.items.filter(
                ({ disposition }) => disposition === "needs_attention",
            ),
        ).toHaveLength(1);
        expect(item(result, "conflict-two")).toMatchObject({
            disposition: "alternative",
            reasonCodes: ["integrity_conflict"],
        });
    });
});

function recommendedIds(
    result: ReturnType<typeof buildSourceSelectionProposal>,
): Array<string> {
    return result.items
        .filter(({ disposition }) => disposition === "recommended")
        .map(({ sourceId }) => sourceId);
}

function item(
    result: ReturnType<typeof buildSourceSelectionProposal>,
    sourceId: string,
) {
    return result.items.find(
        (candidateItem) => candidateItem.sourceId === sourceId,
    );
}
