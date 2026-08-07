import type { CoveragePreset } from "@convex/domain/researchPlan";
import type {
    SourceCoverageRole,
    SourceSelectionCandidate,
    SourceSelectionCompany,
} from "@convex/domain/sourceSelectionPolicy";

export type GoldenSourceCandidate = SourceSelectionCandidate & {
    expectedEligibility: "must_include" | "may_include" | "must_exclude";
    expectedJustification: string;
    expectedRequirement?: {
        role: SourceCoverageRole;
        eventKey: string;
    };
    duplicateGroup?: string;
};

export type GoldenSourcePool = {
    fixtureRunKey: string;
    company: SourceSelectionCompany & { cik: string };
    coveragePreset: CoveragePreset;
    candidates: Array<GoldenSourceCandidate>;
};

/** Metadata-only snapshot of the 110 candidates present in the local prototype on 2026-08-07. */
const SOURCE_SELECTION_V2_EXISTING_CORPUS_BASE = [
    {
        fixtureRunKey: "ccc-balanced",
        company: {
            cik: "1818201",
            legalName: "CCC Intelligent Solutions Holdings Inc.",
            ticker: "CCC",
            websiteUrl: "https://cccis.com/",
        },
        coveragePreset: "balanced",
        candidates: [
            {
                sourceId: "ccc-balanced-01",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1818201/000181820126000040/xslF345X06/form4.xml",
                title: "4 · 2026-06-15",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1781481600000,
                providerReference: "0001818201-26-000040",
                secForm: "4",
                createdAt: 1,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
            },
            {
                sourceId: "ccc-balanced-02",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1818201/000119312526248437/ccc-20260427.htm",
                title: "8-K/A · 2026-05-29",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1780012800000,
                providerReference: "0001193125-26-248437",
                secForm: "8-K",
                createdAt: 2,
                expectedEligibility: "must_include",
                expectedJustification: "primary regulatory report",
            },
            {
                sourceId: "ccc-balanced-03",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1818201/000181820126000038/xslF345X06/form4.xml",
                title: "4 · 2026-05-26",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1779753600000,
                providerReference: "0001818201-26-000038",
                secForm: "4",
                createdAt: 3,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
                duplicateGroup: "ccc-balanced:title:4 · 2026-05-26",
            },
            {
                sourceId: "ccc-balanced-04",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1818201/000181820126000034/xslF345X06/form4.xml",
                title: "4 · 2026-05-26",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1779753600000,
                providerReference: "0001818201-26-000034",
                secForm: "4",
                createdAt: 4,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
                duplicateGroup: "ccc-balanced:title:4 · 2026-05-26",
            },
            {
                sourceId: "ccc-balanced-05",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1818201/000181820126000032/xslF345X06/form4.xml",
                title: "4 · 2026-05-26",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1779753600000,
                providerReference: "0001818201-26-000032",
                secForm: "4",
                createdAt: 5,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
                duplicateGroup: "ccc-balanced:title:4 · 2026-05-26",
            },
            {
                sourceId: "ccc-balanced-06",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1818201/000181820126000030/xslF345X06/form4.xml",
                title: "4 · 2026-05-26",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1779753600000,
                providerReference: "0001818201-26-000030",
                secForm: "4",
                createdAt: 6,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
                duplicateGroup: "ccc-balanced:title:4 · 2026-05-26",
            },
            {
                sourceId: "ccc-balanced-07",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1818201/000181820126000028/xslF345X06/form4.xml",
                title: "4 · 2026-05-26",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1779753600000,
                providerReference: "0001818201-26-000028",
                secForm: "4",
                createdAt: 7,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
                duplicateGroup: "ccc-balanced:title:4 · 2026-05-26",
            },
            {
                sourceId: "ccc-balanced-08",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1818201/000181820126000025/xslF345X06/form4.xml",
                title: "4 · 2026-05-26",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1779753600000,
                providerReference: "0001818201-26-000025",
                secForm: "4",
                createdAt: 8,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
                duplicateGroup: "ccc-balanced:title:4 · 2026-05-26",
            },
            {
                sourceId: "ccc-balanced-09",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1818201/000119312526067448/0001193125-26-067448-index.htm",
                title: "EDGAR Filing Documents for 0001193125-26-067448",
                origin: "exa",
                category: "regulatory",
                providerReference:
                    "https://www.sec.gov/Archives/edgar/data/1818201/000119312526067448/0001193125-26-067448-index.htm",
                createdAt: 9,
                expectedEligibility: "must_exclude",
                expectedJustification: "index or document landing page",
            },
            {
                sourceId: "ccc-balanced-10",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1818201/000119312526067448/ccc-20251231.htm",
                title: "10-K",
                origin: "exa",
                category: "regulatory",
                providerReference:
                    "https://www.sec.gov/Archives/edgar/data/1818201/000119312526067448/ccc-20251231.htm",
                secForm: "10-K",
                createdAt: 10,
                expectedEligibility: "must_include",
                expectedJustification: "primary regulatory report",
            },
            {
                sourceId: "ccc-balanced-11",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1818201/000119312526194147/ccc-20260331.htm",
                title: "10-Q",
                origin: "exa",
                category: "regulatory",
                providerReference:
                    "https://www.sec.gov/Archives/edgar/data/1818201/000119312526194147/ccc-20260331.htm",
                secForm: "10-Q",
                createdAt: 11,
                expectedEligibility: "must_include",
                expectedJustification: "primary regulatory report",
            },
            {
                sourceId: "ccc-balanced-12",
                canonicalUrl: "https://www.stocktitan.net/sec-filings/CCCS/",
                title: "CCCS SEC Filings - Ccc Intelligent Solutions Hld 10-K, 10-Q, 8 ...",
                origin: "exa",
                category: "regulatory",
                providerReference:
                    "https://www.stocktitan.net/sec-filings/CCCS/",
                createdAt: 12,
                expectedEligibility: "must_exclude",
                expectedJustification:
                    "community, aggregator, or unqualified publisher",
            },
            {
                sourceId: "ccc-balanced-13",
                canonicalUrl: "https://ir.cccis.com/",
                title: "CCC Intelligent Solutions: Investor Overview",
                origin: "exa",
                category: "investor_relations",
                providerReference: "https://ir.cccis.com/",
                createdAt: 13,
                expectedEligibility: "may_include",
                expectedJustification:
                    "qualified first-party, IR, or partner source",
            },
            {
                sourceId: "ccc-balanced-14",
                canonicalUrl:
                    "https://ir.cccis.com/news-releases/news-release-details/ccc-intelligent-solutions-holdings-inc-announces-fourth-4",
                title: "CCC Intelligent Solutions Holdings Inc. Announces Fourth Quarter and Fiscal Year 2025 Financial Results | CCC Intelligent Solutions",
                origin: "exa",
                category: "investor_relations",
                providerReference:
                    "https://ir.cccis.com/news-releases/news-release-details/ccc-intelligent-solutions-holdings-inc-announces-fourth-4",
                createdAt: 14,
                expectedEligibility: "must_include",
                expectedJustification: "results or investor presentation",
            },
            {
                sourceId: "ccc-balanced-15",
                canonicalUrl:
                    "https://ir.cccis.com/static-files/ec482f9b-4cb6-492d-ac67-a3cb466a6922",
                title: "CCC Intelligent Solutions Inc. (Nasdaq: CCC)",
                origin: "exa",
                category: "investor_relations",
                providerReference:
                    "https://ir.cccis.com/static-files/ec482f9b-4cb6-492d-ac67-a3cb466a6922",
                createdAt: 15,
                expectedEligibility: "may_include",
                expectedJustification:
                    "qualified first-party, IR, or partner source",
            },
            {
                sourceId: "ccc-balanced-16",
                canonicalUrl:
                    "https://ir.cccis.com/static-files/5f9fc085-bd98-4e5b-b40d-859c46a16874",
                title: "CCC) 1Q26 Earnings Call Transcript April 30, 2026",
                origin: "exa",
                category: "investor_relations",
                providerReference:
                    "https://ir.cccis.com/static-files/5f9fc085-bd98-4e5b-b40d-859c46a16874",
                createdAt: 16,
                expectedEligibility: "must_include",
                expectedJustification: "results or investor presentation",
            },
            {
                sourceId: "ccc-balanced-17",
                canonicalUrl:
                    "https://www.cccis.com/policy/terms-of-use-amplify",
                title: "Terms of use for CCC® Amplify - CCCIS",
                origin: "exa",
                category: "official_commercial",
                publishedAt: 1764115200000,
                providerReference:
                    "https://www.cccis.com/policy/terms-of-use-amplify",
                createdAt: 17,
                expectedEligibility: "must_include",
                expectedJustification: "official pricing or terms",
            },
            {
                sourceId: "ccc-balanced-18",
                canonicalUrl:
                    "https://www.cccis.com/policy/terms-of-use-payroll",
                title: "Terms of use for CCC® Payroll and CCC® Pay Workflow",
                origin: "exa",
                category: "official_commercial",
                providerReference:
                    "https://www.cccis.com/policy/terms-of-use-payroll",
                createdAt: 18,
                expectedEligibility: "must_include",
                expectedJustification: "official pricing or terms",
            },
            {
                sourceId: "ccc-balanced-19",
                canonicalUrl: "https://shop.cccis.com/promote-agreements/",
                title: "Promote Authorization Agreement - SHOP.CCCIS.COM | CCC Intelligent Solutions",
                origin: "exa",
                category: "official_commercial",
                providerReference: "https://shop.cccis.com/promote-agreements/",
                createdAt: 19,
                expectedEligibility: "may_include",
                expectedJustification:
                    "qualified first-party, IR, or partner source",
            },
            {
                sourceId: "ccc-balanced-20",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1818201/000119312521259471/d221590ds1.htm",
                title: "S-1",
                origin: "exa",
                category: "official_commercial",
                publishedAt: 1630022400000,
                providerReference:
                    "https://www.sec.gov/Archives/edgar/data/1818201/000119312521259471/d221590ds1.htm",
                secForm: "S-1",
                createdAt: 20,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
            },
            {
                sourceId: "ccc-balanced-21",
                canonicalUrl:
                    "https://koalagains.com/stocks/NASDAQ/CCCS/competition",
                title: "CCC Intelligent Solutions Holdings Inc. (CCCS) Competitive Analysis & Comparison (2026)",
                origin: "exa",
                category: "counter_evidence",
                publishedAt: 1761696000000,
                providerReference:
                    "https://koalagains.com/stocks/NASDAQ/CCCS/competition",
                createdAt: 21,
                expectedEligibility: "must_exclude",
                expectedJustification:
                    "community, aggregator, or unqualified publisher",
            },
            {
                sourceId: "ccc-balanced-22",
                canonicalUrl:
                    "https://opportunitycosts.substack.com/p/smart-claims-smarter-investment-a",
                title: "Smart Claims, Smarter Investment? A Look at CCC Intelligent Solutions (CCCS)",
                origin: "exa",
                category: "counter_evidence",
                publishedAt: 1748217600000,
                providerReference:
                    "https://opportunitycosts.substack.com/p/smart-claims-smarter-investment-a",
                createdAt: 22,
                expectedEligibility: "must_exclude",
                expectedJustification:
                    "community, aggregator, or unqualified publisher",
            },
            {
                sourceId: "ccc-balanced-23",
                canonicalUrl:
                    "https://askcyborg.com/preview/cccintelligentsolutions",
                title: "CCC Intelligent Solutions Holdings Inc. Business Model & Cyborg Sco... | AskCyborg",
                origin: "exa",
                category: "counter_evidence",
                publishedAt: 1781222400000,
                providerReference:
                    "https://askcyborg.com/preview/cccintelligentsolutions",
                createdAt: 23,
                expectedEligibility: "must_exclude",
                expectedJustification:
                    "community, aggregator, or unqualified publisher",
            },
            {
                sourceId: "ccc-balanced-24",
                canonicalUrl: "https://orbyd.app/dossiers/CCC/",
                title: "CCC stock analysis — CCC Intelligent Solutions Holdings — orbyd",
                origin: "exa",
                category: "counter_evidence",
                publishedAt: 1784073600000,
                providerReference: "https://orbyd.app/dossiers/CCC/",
                createdAt: 24,
                expectedEligibility: "must_exclude",
                expectedJustification:
                    "community, aggregator, or unqualified publisher",
            },
        ],
    },
    {
        fixtureRunKey: "servicenow-balanced-legacy",
        company: {
            cik: "1373715",
            legalName: "ServiceNow, Inc.",
            ticker: "NOW",
            websiteUrl: "https://servicenow.com/",
        },
        coveragePreset: "balanced",
        candidates: [
            {
                sourceId: "servicenow-balanced-legacy-01",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000076/now-20260630.htm",
                title: "10-Q · 2026-07-23",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1784764800000,
                providerReference: "0001373715-26-000076",
                secForm: "10-Q",
                createdAt: 1,
                expectedEligibility: "must_include",
                expectedJustification: "primary regulatory report",
            },
            {
                sourceId: "servicenow-balanced-legacy-02",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000074/forms-82026xamended2021eip.htm",
                title: "S-8 · 2026-07-22",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1784678400000,
                providerReference: "0001373715-26-000074",
                secForm: "S-8",
                createdAt: 2,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
                duplicateGroup:
                    "servicenow-balanced-legacy:title:s-8 · 2026-07-22",
            },
            {
                sourceId: "servicenow-balanced-legacy-03",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000073/forms-8xapollojul2026.htm",
                title: "S-8 · 2026-07-22",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1784678400000,
                providerReference: "0001373715-26-000073",
                secForm: "S-8",
                createdAt: 3,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
                duplicateGroup:
                    "servicenow-balanced-legacy:title:s-8 · 2026-07-22",
            },
            {
                sourceId: "servicenow-balanced-legacy-04",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000072/now-20260722.htm",
                title: "8-K · 2026-07-22",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1784678400000,
                providerReference: "0001373715-26-000072",
                secForm: "8-K",
                createdAt: 4,
                expectedEligibility: "must_include",
                expectedJustification: "primary regulatory report",
            },
            {
                sourceId: "servicenow-balanced-legacy-05",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000177329826000005/xslF345X06/wk-form4_1781727061.xml",
                title: "4 · 2026-06-17",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1781654400000,
                providerReference: "0001773298-26-000005",
                secForm: "4",
                createdAt: 5,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
            },
            {
                sourceId: "servicenow-balanced-legacy-06",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000176765926000008/xslF345X06/wk-form4_1780346799.xml",
                title: "4 · 2026-06-01",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1780272000000,
                providerReference: "0001767659-26-000008",
                secForm: "4",
                createdAt: 6,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
            },
            {
                sourceId: "servicenow-balanced-legacy-07",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000177329826000002/xslF345X06/wk-form3_1780007887.xml",
                title: "3 · 2026-05-28",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1779926400000,
                providerReference: "0001773298-26-000002",
                secForm: "3",
                createdAt: 7,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
            },
            {
                sourceId: "servicenow-balanced-legacy-08",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000195917326004083/xsl144X01/primary_doc.xml",
                title: "144 · 2026-05-28",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1779926400000,
                providerReference: "0001959173-26-004083",
                secForm: "144",
                createdAt: 8,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
            },
            {
                sourceId: "servicenow-balanced-legacy-09",
                canonicalUrl: "https://www.stocktitan.net/sec-filings/NOW/",
                title: "NOW SEC Filings - ServiceNow, Inc. 10-K, 10-Q, 8-K Forms",
                origin: "exa",
                category: "regulatory",
                providerReference:
                    "https://www.stocktitan.net/sec-filings/NOW/",
                createdAt: 9,
                expectedEligibility: "must_exclude",
                expectedJustification:
                    "community, aggregator, or unqualified publisher",
            },
            {
                sourceId: "servicenow-balanced-legacy-10",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000007/now-20251231.htm",
                title: "now-20251231",
                origin: "exa",
                category: "regulatory",
                providerReference:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000007/now-20251231.htm",
                secForm: "10-K",
                createdAt: 10,
                expectedEligibility: "must_include",
                expectedJustification: "primary regulatory report",
            },
            {
                sourceId: "servicenow-balanced-legacy-11",
                canonicalUrl: "https://fintel.io/sfs/us/now",
                title: "NOW SEC Filings - ServiceNow, Inc.- Annual Report, Proxy ...",
                origin: "exa",
                category: "regulatory",
                providerReference: "https://fintel.io/sfs/us/now",
                createdAt: 11,
                expectedEligibility: "must_exclude",
                expectedJustification:
                    "community, aggregator, or unqualified publisher",
            },
            {
                sourceId: "servicenow-balanced-legacy-12",
                canonicalUrl:
                    "https://investor.servicenow.com/news/news-details/2026/ServiceNow-Reports-Second-Quarter-2026-Financial-Results/default.aspx",
                title: "ServiceNow Reports Second Quarter 2026 Financial Results",
                origin: "exa",
                category: "investor_relations",
                publishedAt: 1784779184528,
                providerReference:
                    "https://investor.servicenow.com/news/news-details/2026/ServiceNow-Reports-Second-Quarter-2026-Financial-Results/default.aspx",
                createdAt: 12,
                expectedEligibility: "must_include",
                expectedJustification: "results or investor presentation",
            },
            {
                sourceId: "servicenow-balanced-legacy-13",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000072/erq2fy26.htm",
                title: "Document",
                origin: "exa",
                category: "investor_relations",
                providerReference:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000072/erq2fy26.htm",
                createdAt: 13,
                expectedEligibility: "must_exclude",
                expectedJustification: "index or document landing page",
            },
            {
                sourceId: "servicenow-balanced-legacy-14",
                canonicalUrl:
                    "https://newsroom.servicenow.com/press-releases/details/2026/ServiceNow-Reports-Second-Quarter-2026-Financial-Results/default.aspx",
                title: "ServiceNow Reports Second Quarter 2026 Financial Results - ServiceNow Newsroom",
                origin: "exa",
                category: "investor_relations",
                providerReference:
                    "https://newsroom.servicenow.com/press-releases/details/2026/ServiceNow-Reports-Second-Quarter-2026-Financial-Results/default.aspx",
                createdAt: 14,
                expectedEligibility: "must_include",
                expectedJustification: "results or investor presentation",
            },
            {
                sourceId: "servicenow-balanced-legacy-15",
                canonicalUrl:
                    "https://s205.q4cdn.com/916135447/files/doc_financials/2026/q1/ServiceNow-1Q26-Investor-Presentation.pdf",
                title: "ServiceNow 1Q26 Investor Presentation",
                origin: "exa",
                category: "investor_relations",
                providerReference:
                    "https://s205.q4cdn.com/916135447/files/doc_financials/2026/q1/ServiceNow-1Q26-Investor-Presentation.pdf",
                createdAt: 15,
                expectedEligibility: "must_include",
                expectedJustification: "results or investor presentation",
            },
            {
                sourceId: "servicenow-balanced-legacy-16",
                canonicalUrl:
                    "https://www.servicenow.com/docs/r/api-reference/rest-apis/hr-core-api.html",
                title: "HR REST API",
                origin: "exa",
                category: "official_product",
                providerReference:
                    "https://www.servicenow.com/docs/r/api-reference/rest-apis/hr-core-api.html",
                createdAt: 16,
                expectedEligibility: "must_include",
                expectedJustification:
                    "official product or integration documentation",
            },
            {
                sourceId: "servicenow-balanced-legacy-17",
                canonicalUrl:
                    "https://www.servicenow.com/lpdem/demonow-api-integration.html",
                title: "ServiceNow API Integration Demo",
                origin: "exa",
                category: "official_product",
                providerReference:
                    "https://www.servicenow.com/lpdem/demonow-api-integration.html",
                createdAt: 17,
                expectedEligibility: "must_include",
                expectedJustification:
                    "official product or integration documentation",
            },
            {
                sourceId: "servicenow-balanced-legacy-18",
                canonicalUrl:
                    "https://www.servicenow.com/community/s/cgfwn76974/attachments/cgfwn76974/now-platform-forum/27551/1/Flow%20Designer%20and%20Integration%20Hub%20Interactive%20Resource%20Guide.pdf",
                title: "Flow Designer & IntegrationHub",
                origin: "exa",
                category: "official_product",
                providerReference:
                    "https://www.servicenow.com/community/s/cgfwn76974/attachments/cgfwn76974/now-platform-forum/27551/1/Flow%20Designer%20and%20Integration%20Hub%20Interactive%20Resource%20Guide.pdf",
                createdAt: 18,
                expectedEligibility: "must_exclude",
                expectedJustification: "Community content",
            },
            {
                sourceId: "servicenow-balanced-legacy-19",
                canonicalUrl:
                    "https://www.servicenow.com/community/developer-articles/servicenow-to-servicenow-integration-using-rest-api-and-push-and/ta-p/2302147",
                title: "ServiceNow to ServiceNow Integration using REST API and PUSH and PUT methods with Business Rule",
                origin: "exa",
                category: "official_product",
                publishedAt: 1590451200000,
                providerReference:
                    "https://www.servicenow.com/community/developer-articles/servicenow-to-servicenow-integration-using-rest-api-and-push-and/ta-p/2302147",
                createdAt: 19,
                expectedEligibility: "must_exclude",
                expectedJustification: "Community content",
            },
            {
                sourceId: "servicenow-balanced-legacy-20",
                canonicalUrl: "https://www.servicenow.com/lpgp/pricing.html",
                title: "Pricing",
                origin: "exa",
                category: "official_commercial",
                providerReference:
                    "https://www.servicenow.com/lpgp/pricing.html",
                createdAt: 20,
                expectedEligibility: "must_include",
                expectedJustification: "official pricing or terms",
            },
            {
                sourceId: "servicenow-balanced-legacy-21",
                canonicalUrl:
                    "https://static.carahsoft.com/concrete/files/9414/3569/2932/ServiceNow_EULA.PDF",
                title: "(“Professional 2. ORDERING “Subscription “Packaged (“Service 3. GRANT OF USE RIGHTS; OWNERSHIP; CUSTOMER RESTRICTIONS “Customer",
                origin: "exa",
                category: "official_commercial",
                providerReference:
                    "https://static.carahsoft.com/concrete/files/9414/3569/2932/ServiceNow_EULA.PDF",
                createdAt: 21,
                expectedEligibility: "must_exclude",
                expectedJustification: "unverified external publisher",
            },
            {
                sourceId: "servicenow-balanced-legacy-22",
                canonicalUrl:
                    "https://aws.amazon.com/marketplace/pp/prodview-ruxchcof6gjpg",
                title: "ServiceNow on AWS",
                origin: "exa",
                category: "official_commercial",
                providerReference:
                    "https://aws.amazon.com/marketplace/pp/prodview-ruxchcof6gjpg",
                createdAt: 22,
                expectedEligibility: "may_include",
                expectedJustification:
                    "qualified first-party, IR, or partner source",
            },
            {
                sourceId: "servicenow-balanced-legacy-23",
                canonicalUrl:
                    "https://store.servicenow.com/store/app/44ea63e61b246a50a85b16db234bcbfb",
                title: "Contracts and Entitlement Workflows - ServiceNow Store",
                origin: "exa",
                category: "official_commercial",
                providerReference:
                    "https://store.servicenow.com/store/app/44ea63e61b246a50a85b16db234bcbfb",
                createdAt: 23,
                expectedEligibility: "may_include",
                expectedJustification:
                    "qualified first-party, IR, or partner source",
            },
            {
                sourceId: "servicenow-balanced-legacy-24",
                canonicalUrl:
                    "https://capitalblueprint.substack.com/p/servicenow-inc-nyse-now-deep-analysis",
                title: "ServiceNow Inc. (NYSE: NOW) — Deep Analysis Report - by Jin",
                origin: "exa",
                category: "counter_evidence",
                publishedAt: 1778544000000,
                providerReference:
                    "https://capitalblueprint.substack.com/p/servicenow-inc-nyse-now-deep-analysis",
                createdAt: 24,
                expectedEligibility: "must_exclude",
                expectedJustification:
                    "community, aggregator, or unqualified publisher",
            },
            {
                sourceId: "servicenow-balanced-legacy-25",
                canonicalUrl: "https://flash.stocksentinel.ai/research/NOW",
                title: "ServiceNow, Inc. (NOW) Stock Research Report | Flash",
                origin: "exa",
                category: "counter_evidence",
                publishedAt: 1782345600000,
                providerReference:
                    "https://flash.stocksentinel.ai/research/NOW",
                createdAt: 25,
                expectedEligibility: "must_exclude",
                expectedJustification:
                    "community, aggregator, or unqualified publisher",
            },
            {
                sourceId: "servicenow-balanced-legacy-26",
                canonicalUrl:
                    "https://secure.fundsupermart.com/fsmone/article/rcms380621/servicenow-fy2027-the-time-is-now",
                title: "ServiceNow FY2027: The Time Is NOW | FSM Global",
                origin: "exa",
                category: "counter_evidence",
                publishedAt: 1784160000000,
                providerReference:
                    "https://secure.fundsupermart.com/fsmone/article/rcms380621/servicenow-fy2027-the-time-is-now",
                createdAt: 26,
                expectedEligibility: "must_exclude",
                expectedJustification: "unverified external publisher",
            },
            {
                sourceId: "servicenow-balanced-legacy-27",
                canonicalUrl:
                    "https://intellectia.ai/news/etf/ubs-downgrades-servicenow-to-neutral-amid-ai-disruption-risks",
                title: "UBS Downgrades ServiceNow to Neutral Amid AI Disruption Risks",
                origin: "exa",
                category: "counter_evidence",
                publishedAt: 1775779200000,
                providerReference:
                    "https://intellectia.ai/news/etf/ubs-downgrades-servicenow-to-neutral-amid-ai-disruption-risks",
                createdAt: 27,
                expectedEligibility: "must_exclude",
                expectedJustification:
                    "community, aggregator, or unqualified publisher",
            },
        ],
    },
    {
        fixtureRunKey: "servicenow-first-party",
        company: {
            cik: "1373715",
            legalName: "ServiceNow, Inc.",
            ticker: "NOW",
            websiteUrl: "https://servicenow.com/",
        },
        coveragePreset: "first_party_depth",
        candidates: [
            {
                sourceId: "servicenow-first-party-01",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000076/now-20260630.htm",
                title: "10-Q · 2026-07-23",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1784764800000,
                providerReference: "0001373715-26-000076",
                secForm: "10-Q",
                createdAt: 1,
                expectedEligibility: "must_include",
                expectedJustification: "primary regulatory report",
            },
            {
                sourceId: "servicenow-first-party-02",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000074/forms-82026xamended2021eip.htm",
                title: "S-8 · 2026-07-22",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1784678400000,
                providerReference: "0001373715-26-000074",
                secForm: "S-8",
                createdAt: 2,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
                duplicateGroup: "servicenow-first-party:title:s-8 · 2026-07-22",
            },
            {
                sourceId: "servicenow-first-party-03",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000073/forms-8xapollojul2026.htm",
                title: "S-8 · 2026-07-22",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1784678400000,
                providerReference: "0001373715-26-000073",
                secForm: "S-8",
                createdAt: 3,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
                duplicateGroup: "servicenow-first-party:title:s-8 · 2026-07-22",
            },
            {
                sourceId: "servicenow-first-party-04",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000072/now-20260722.htm",
                title: "8-K · 2026-07-22",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1784678400000,
                providerReference: "0001373715-26-000072",
                secForm: "8-K",
                createdAt: 4,
                expectedEligibility: "must_include",
                expectedJustification: "primary regulatory report",
            },
            {
                sourceId: "servicenow-first-party-05",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000177329826000005/xslF345X06/wk-form4_1781727061.xml",
                title: "4 · 2026-06-17",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1781654400000,
                providerReference: "0001773298-26-000005",
                secForm: "4",
                createdAt: 5,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
            },
            {
                sourceId: "servicenow-first-party-06",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000176765926000008/xslF345X06/wk-form4_1780346799.xml",
                title: "4 · 2026-06-01",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1780272000000,
                providerReference: "0001767659-26-000008",
                secForm: "4",
                createdAt: 6,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
            },
            {
                sourceId: "servicenow-first-party-07",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000177329826000002/xslF345X06/wk-form3_1780007887.xml",
                title: "3 · 2026-05-28",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1779926400000,
                providerReference: "0001773298-26-000002",
                secForm: "3",
                createdAt: 7,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
            },
            {
                sourceId: "servicenow-first-party-08",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000195917326004083/xsl144X01/primary_doc.xml",
                title: "144 · 2026-05-28",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1779926400000,
                providerReference: "0001959173-26-004083",
                secForm: "144",
                createdAt: 8,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
            },
            {
                sourceId: "servicenow-first-party-09",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000007/now-20251231.htm",
                title: "now-20251231",
                origin: "exa",
                category: "regulatory",
                providerReference:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000007/now-20251231.htm",
                secForm: "10-K",
                createdAt: 9,
                expectedEligibility: "must_include",
                expectedJustification: "primary regulatory report",
            },
            {
                sourceId: "servicenow-first-party-10",
                canonicalUrl: "https://www.stocktitan.net/sec-filings/NOW/",
                title: "NOW SEC Filings - ServiceNow, Inc. 10-K, 10-Q, 8-K Forms",
                origin: "exa",
                category: "regulatory",
                providerReference:
                    "https://www.stocktitan.net/sec-filings/NOW/",
                createdAt: 10,
                expectedEligibility: "must_exclude",
                expectedJustification:
                    "community, aggregator, or unqualified publisher",
            },
            {
                sourceId: "servicenow-first-party-11",
                canonicalUrl: "https://fintel.io/sfs/us/now",
                title: "NOW SEC Filings - ServiceNow, Inc.- Annual Report, Proxy ...",
                origin: "exa",
                category: "regulatory",
                providerReference: "https://fintel.io/sfs/us/now",
                createdAt: 11,
                expectedEligibility: "must_exclude",
                expectedJustification:
                    "community, aggregator, or unqualified publisher",
            },
            {
                sourceId: "servicenow-first-party-12",
                canonicalUrl:
                    "https://investor.servicenow.com/news/news-details/2026/ServiceNow-Reports-Second-Quarter-2026-Financial-Results/default.aspx",
                title: "ServiceNow Reports Second Quarter 2026 Financial Results",
                origin: "exa",
                category: "investor_relations",
                publishedAt: 1784729505785,
                providerReference:
                    "https://investor.servicenow.com/news/news-details/2026/ServiceNow-Reports-Second-Quarter-2026-Financial-Results/default.aspx",
                createdAt: 12,
                expectedEligibility: "must_include",
                expectedJustification: "results or investor presentation",
            },
            {
                sourceId: "servicenow-first-party-13",
                canonicalUrl:
                    "https://newsroom.servicenow.com/press-releases/details/2026/ServiceNow-Reports-Second-Quarter-2026-Financial-Results/default.aspx",
                title: "ServiceNow Reports Second Quarter 2026 Financial Results - ServiceNow Newsroom",
                origin: "exa",
                category: "investor_relations",
                providerReference:
                    "https://newsroom.servicenow.com/press-releases/details/2026/ServiceNow-Reports-Second-Quarter-2026-Financial-Results/default.aspx",
                createdAt: 13,
                expectedEligibility: "must_include",
                expectedJustification: "results or investor presentation",
            },
            {
                sourceId: "servicenow-first-party-14",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000072/erq2fy26.htm",
                title: "Document",
                origin: "exa",
                category: "investor_relations",
                providerReference:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000072/erq2fy26.htm",
                createdAt: 14,
                expectedEligibility: "must_exclude",
                expectedJustification: "index or document landing page",
            },
            {
                sourceId: "servicenow-first-party-15",
                canonicalUrl:
                    "https://s205.q4cdn.com/916135447/files/doc_financials/2026/q1/ServiceNow-1Q26-Investor-Presentation.pdf",
                title: "ServiceNow 1Q26 Investor Presentation",
                origin: "exa",
                category: "investor_relations",
                providerReference:
                    "https://s205.q4cdn.com/916135447/files/doc_financials/2026/q1/ServiceNow-1Q26-Investor-Presentation.pdf",
                createdAt: 15,
                expectedEligibility: "must_include",
                expectedJustification: "results or investor presentation",
            },
            {
                sourceId: "servicenow-first-party-16",
                canonicalUrl:
                    "https://www.servicenow.com/community/developer-articles/servicenow-to-servicenow-integration-using-rest-api-and-push-and/ta-p/2302147",
                title: "ServiceNow to ServiceNow Integration using REST API and PUSH and PUT methods with Business Rule",
                origin: "exa",
                category: "official_product",
                publishedAt: 1590451200000,
                providerReference:
                    "https://www.servicenow.com/community/developer-articles/servicenow-to-servicenow-integration-using-rest-api-and-push-and/ta-p/2302147",
                createdAt: 16,
                expectedEligibility: "must_exclude",
                expectedJustification: "Community content",
            },
            {
                sourceId: "servicenow-first-party-17",
                canonicalUrl:
                    "https://www.servicenow.com/content/dam/servicenow-assets/public/en-us/doc-type/resource-center/ebook/ebk-now-platform-reference-guide.pdf",
                title: "The Now Platform Reference Guide",
                origin: "exa",
                category: "official_product",
                providerReference:
                    "https://www.servicenow.com/content/dam/servicenow-assets/public/en-us/doc-type/resource-center/ebook/ebk-now-platform-reference-guide.pdf",
                createdAt: 17,
                expectedEligibility: "must_include",
                expectedJustification:
                    "official product or integration documentation",
            },
            {
                sourceId: "servicenow-first-party-18",
                canonicalUrl:
                    "https://www.servicenow.com/community/developer-forum/rest-api-to-use-for-incidents-and-requests/m-p/3013033",
                title: "Solved: REST API to use for Incidents and Requests - ServiceNow Community",
                origin: "exa",
                category: "official_product",
                publishedAt: 1723075200000,
                providerReference:
                    "https://www.servicenow.com/community/developer-forum/rest-api-to-use-for-incidents-and-requests/m-p/3013033",
                createdAt: 18,
                expectedEligibility: "must_exclude",
                expectedJustification:
                    "community, aggregator, or unqualified publisher",
            },
            {
                sourceId: "servicenow-first-party-19",
                canonicalUrl:
                    "https://cdn.cdata.com/help/BNJ/jdbc/pg_connectionj.htm",
                title: "cdn.cdata.com",
                origin: "exa",
                category: "official_product",
                providerReference:
                    "https://cdn.cdata.com/help/BNJ/jdbc/pg_connectionj.htm",
                createdAt: 19,
                expectedEligibility: "must_exclude",
                expectedJustification: "unverified external publisher",
            },
            {
                sourceId: "servicenow-first-party-20",
                canonicalUrl: "https://www.servicenow.com/lpgp/pricing.html",
                title: "Pricing",
                origin: "exa",
                category: "official_commercial",
                providerReference:
                    "https://www.servicenow.com/lpgp/pricing.html",
                createdAt: 20,
                expectedEligibility: "must_include",
                expectedJustification: "official pricing or terms",
            },
            {
                sourceId: "servicenow-first-party-21",
                canonicalUrl:
                    "https://static.carahsoft.com/concrete/files/9414/3569/2932/ServiceNow_EULA.PDF",
                title: "(“Professional 2. ORDERING “Subscription “Packaged (“Service 3. GRANT OF USE RIGHTS; OWNERSHIP; CUSTOMER RESTRICTIONS “Customer",
                origin: "exa",
                category: "official_commercial",
                providerReference:
                    "https://static.carahsoft.com/concrete/files/9414/3569/2932/ServiceNow_EULA.PDF",
                createdAt: 21,
                expectedEligibility: "must_exclude",
                expectedJustification: "unverified external publisher",
            },
            {
                sourceId: "servicenow-first-party-22",
                canonicalUrl:
                    "https://aws.amazon.com/marketplace/pp/prodview-ruxchcof6gjpg",
                title: "ServiceNow on AWS",
                origin: "exa",
                category: "official_commercial",
                providerReference:
                    "https://aws.amazon.com/marketplace/pp/prodview-ruxchcof6gjpg",
                createdAt: 22,
                expectedEligibility: "may_include",
                expectedJustification:
                    "qualified first-party, IR, or partner source",
            },
            {
                sourceId: "servicenow-first-party-23",
                canonicalUrl:
                    "https://store.servicenow.com/store/app/44ea63e61b246a50a85b16db234bcbfb",
                title: "Contracts and Entitlement Workflows - ServiceNow Store",
                origin: "exa",
                category: "official_commercial",
                providerReference:
                    "https://store.servicenow.com/store/app/44ea63e61b246a50a85b16db234bcbfb",
                createdAt: 23,
                expectedEligibility: "may_include",
                expectedJustification:
                    "qualified first-party, IR, or partner source",
            },
            {
                sourceId: "servicenow-first-party-24",
                canonicalUrl:
                    "https://s205.q4cdn.com/916135447/files/doc_downloads/annual-meeting-of-share-holders/2026/NOW-2025-Annual-Report-bookmarked.pdf",
                title: "ServiceNow Annual Report 2025",
                origin: "exa",
                category: "counter_evidence",
                publishedAt: 1769558400000,
                providerReference:
                    "https://s205.q4cdn.com/916135447/files/doc_downloads/annual-meeting-of-share-holders/2026/NOW-2025-Annual-Report-bookmarked.pdf",
                createdAt: 24,
                expectedEligibility: "may_include",
                expectedJustification:
                    "qualified first-party, IR, or partner source",
            },
            {
                sourceId: "servicenow-first-party-25",
                canonicalUrl:
                    "https://capitalblueprint.substack.com/p/servicenow-inc-nyse-now-deep-analysis",
                title: "ServiceNow Inc. (NYSE: NOW) — Deep Analysis Report - by Jin",
                origin: "exa",
                category: "counter_evidence",
                publishedAt: 1778544000000,
                providerReference:
                    "https://capitalblueprint.substack.com/p/servicenow-inc-nyse-now-deep-analysis",
                createdAt: 25,
                expectedEligibility: "must_exclude",
                expectedJustification:
                    "community, aggregator, or unqualified publisher",
            },
            {
                sourceId: "servicenow-first-party-26",
                canonicalUrl:
                    "https://hatedmoats.substack.com/p/servicenow-deep-dive-analysis",
                title: "ServiceNow: Deep Dive Analysis - Hated Moats",
                origin: "exa",
                category: "counter_evidence",
                publishedAt: 1774620711465,
                providerReference:
                    "https://hatedmoats.substack.com/p/servicenow-deep-dive-analysis",
                createdAt: 26,
                expectedEligibility: "must_exclude",
                expectedJustification:
                    "community, aggregator, or unqualified publisher",
            },
            {
                sourceId: "servicenow-first-party-27",
                canonicalUrl: "https://flash.stocksentinel.ai/research/NOW",
                title: "ServiceNow, Inc. (NOW) Stock Research Report | Flash",
                origin: "exa",
                category: "counter_evidence",
                publishedAt: 1782345600000,
                providerReference:
                    "https://flash.stocksentinel.ai/research/NOW",
                createdAt: 27,
                expectedEligibility: "must_exclude",
                expectedJustification:
                    "community, aggregator, or unqualified publisher",
            },
            {
                sourceId: "servicenow-first-party-28",
                canonicalUrl:
                    "https://www.servicenow.com/content/dam/servicenow-assets/public/en-us/doc-type/resource-center/white-paper/instance-security-best-practice.pdf",
                title: "ServiceNow Security Best Practices Guide",
                origin: "exa",
                category: "official_security",
                providerReference:
                    "https://www.servicenow.com/content/dam/servicenow-assets/public/en-us/doc-type/resource-center/white-paper/instance-security-best-practice.pdf",
                createdAt: 28,
                expectedEligibility: "must_include",
                expectedJustification: "official security documentation",
            },
            {
                sourceId: "servicenow-first-party-29",
                canonicalUrl:
                    "https://www.servicenow.com/content/dam/servicenow-assets/public/en-us/doc-type/resource-center/white-paper/wp-data-encryption-with-servicenow.pdf",
                title: "Data Encryption",
                origin: "exa",
                category: "official_security",
                providerReference:
                    "https://www.servicenow.com/content/dam/servicenow-assets/public/en-us/doc-type/resource-center/white-paper/wp-data-encryption-with-servicenow.pdf",
                createdAt: 29,
                expectedEligibility: "must_include",
                expectedJustification: "official security documentation",
            },
            {
                sourceId: "servicenow-first-party-30",
                canonicalUrl:
                    "https://www.servicenow.com/standard/resource-center/data-sheet/ds-zero-trust-access.html",
                title: "ServiceNow Zero Trust Access",
                origin: "exa",
                category: "official_security",
                providerReference:
                    "https://www.servicenow.com/standard/resource-center/data-sheet/ds-zero-trust-access.html",
                createdAt: 30,
                expectedEligibility: "must_include",
                expectedJustification: "official security documentation",
            },
            {
                sourceId: "servicenow-first-party-31",
                canonicalUrl:
                    "https://www.servicenow.com/standard/resource-center/data-sheet/ds-platform-encryption.html",
                title: "Platform Encryption | Data Sheet -  ServiceNow",
                origin: "exa",
                category: "official_security",
                providerReference:
                    "https://www.servicenow.com/standard/resource-center/data-sheet/ds-platform-encryption.html",
                createdAt: 31,
                expectedEligibility: "must_include",
                expectedJustification: "official security documentation",
            },
        ],
    },
    {
        fixtureRunKey: "servicenow-balanced-current",
        company: {
            cik: "1373715",
            legalName: "ServiceNow, Inc.",
            ticker: "NOW",
            websiteUrl: "https://servicenow.com/",
        },
        coveragePreset: "balanced",
        candidates: [
            {
                sourceId: "servicenow-balanced-current-01",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000076/now-20260630.htm",
                title: "10-Q · 2026-07-23",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1784764800000,
                providerReference: "0001373715-26-000076",
                secForm: "10-Q",
                createdAt: 1,
                expectedEligibility: "must_include",
                expectedJustification: "primary regulatory report",
            },
            {
                sourceId: "servicenow-balanced-current-02",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000074/forms-82026xamended2021eip.htm",
                title: "S-8 · 2026-07-22",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1784678400000,
                providerReference: "0001373715-26-000074",
                secForm: "S-8",
                createdAt: 2,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
                duplicateGroup:
                    "servicenow-balanced-current:title:s-8 · 2026-07-22",
            },
            {
                sourceId: "servicenow-balanced-current-03",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000073/forms-8xapollojul2026.htm",
                title: "S-8 · 2026-07-22",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1784678400000,
                providerReference: "0001373715-26-000073",
                secForm: "S-8",
                createdAt: 3,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
                duplicateGroup:
                    "servicenow-balanced-current:title:s-8 · 2026-07-22",
            },
            {
                sourceId: "servicenow-balanced-current-04",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000072/now-20260722.htm",
                title: "8-K · 2026-07-22",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1784678400000,
                providerReference: "0001373715-26-000072",
                secForm: "8-K",
                createdAt: 4,
                expectedEligibility: "must_include",
                expectedJustification: "primary regulatory report",
            },
            {
                sourceId: "servicenow-balanced-current-05",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000177329826000005/xslF345X06/wk-form4_1781727061.xml",
                title: "4 · 2026-06-17",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1781654400000,
                providerReference: "0001773298-26-000005",
                secForm: "4",
                createdAt: 5,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
            },
            {
                sourceId: "servicenow-balanced-current-06",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000176765926000008/xslF345X06/wk-form4_1780346799.xml",
                title: "4 · 2026-06-01",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1780272000000,
                providerReference: "0001767659-26-000008",
                secForm: "4",
                createdAt: 6,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
            },
            {
                sourceId: "servicenow-balanced-current-07",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000177329826000002/xslF345X06/wk-form3_1780007887.xml",
                title: "3 · 2026-05-28",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1779926400000,
                providerReference: "0001773298-26-000002",
                secForm: "3",
                createdAt: 7,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
            },
            {
                sourceId: "servicenow-balanced-current-08",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000195917326004083/xsl144X01/primary_doc.xml",
                title: "144 · 2026-05-28",
                origin: "sec",
                category: "regulatory",
                publishedAt: 1779926400000,
                providerReference: "0001959173-26-004083",
                secForm: "144",
                createdAt: 8,
                expectedEligibility: "must_exclude",
                expectedJustification: "specialized SEC filing",
            },
            {
                sourceId: "servicenow-balanced-current-09",
                canonicalUrl:
                    "https://www.sec.gov/cgi-bin/browse-edgar?CIK=NOW&action=getcompany",
                title: "EDGAR Search Results",
                origin: "exa",
                category: "regulatory",
                providerReference:
                    "https://www.sec.gov/cgi-bin/browse-edgar?CIK=NOW&action=getcompany",
                createdAt: 9,
                expectedEligibility: "must_exclude",
                expectedJustification: "index or document landing page",
                duplicateGroup:
                    "servicenow-balanced-current:title:edgar search results",
            },
            {
                sourceId: "servicenow-balanced-current-10",
                canonicalUrl:
                    "https://www.sec.gov/cgi-bin/browse-edgar?CIK=NOW&action=getcompany&type=10-q",
                title: "EDGAR Search Results",
                origin: "exa",
                category: "regulatory",
                providerReference:
                    "https://www.sec.gov/cgi-bin/browse-edgar?CIK=NOW&action=getcompany&type=10-q",
                createdAt: 10,
                expectedEligibility: "must_exclude",
                expectedJustification: "index or document landing page",
                duplicateGroup:
                    "servicenow-balanced-current:title:edgar search results",
            },
            {
                sourceId: "servicenow-balanced-current-11",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000007/now-20251231.htm",
                title: "now-20251231",
                origin: "exa",
                category: "regulatory",
                providerReference:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000007/now-20251231.htm",
                secForm: "10-K",
                createdAt: 11,
                expectedEligibility: "must_include",
                expectedJustification: "primary regulatory report",
            },
            {
                sourceId: "servicenow-balanced-current-12",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000056/now-20260331.htm",
                title: "now-20260331",
                origin: "exa",
                category: "regulatory",
                providerReference:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000056/now-20260331.htm",
                secForm: "10-Q",
                createdAt: 12,
                expectedEligibility: "must_include",
                expectedJustification: "primary regulatory report",
            },
            {
                sourceId: "servicenow-balanced-current-13",
                canonicalUrl:
                    "https://s205.q4cdn.com/916135447/files/doc_financials/2026/q1/ServiceNow-1Q26-Investor-Presentation.pdf",
                title: "ServiceNow 1Q26 Investor Presentation",
                origin: "exa",
                category: "investor_relations",
                providerReference:
                    "https://s205.q4cdn.com/916135447/files/doc_financials/2026/q1/ServiceNow-1Q26-Investor-Presentation.pdf",
                createdAt: 13,
                expectedEligibility: "must_include",
                expectedJustification: "results or investor presentation",
            },
            {
                sourceId: "servicenow-balanced-current-14",
                canonicalUrl:
                    "https://investor.servicenow.com/news/news-details/2026/ServiceNow-Reports-Second-Quarter-2026-Financial-Results/default.aspx",
                title: "ServiceNow Reports Second Quarter 2026 Financial Results",
                origin: "exa",
                category: "investor_relations",
                publishedAt: 1784678400000,
                providerReference:
                    "https://investor.servicenow.com/news/news-details/2026/ServiceNow-Reports-Second-Quarter-2026-Financial-Results/default.aspx",
                createdAt: 14,
                expectedEligibility: "must_include",
                expectedJustification: "results or investor presentation",
            },
            {
                sourceId: "servicenow-balanced-current-15",
                canonicalUrl:
                    "https://investor.servicenow.com/news/news-details/2026/ServiceNow-Reports-First-Quarter-2026-Financial-Results/default.aspx",
                title: "ServiceNow Reports First Quarter 2026 Financial Results",
                origin: "exa",
                category: "investor_relations",
                publishedAt: 1776816000000,
                providerReference:
                    "https://investor.servicenow.com/news/news-details/2026/ServiceNow-Reports-First-Quarter-2026-Financial-Results/default.aspx",
                createdAt: 15,
                expectedEligibility: "must_include",
                expectedJustification: "results or investor presentation",
            },
            {
                sourceId: "servicenow-balanced-current-16",
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000072/erq2fy26.htm",
                title: "Document",
                origin: "exa",
                category: "investor_relations",
                providerReference:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000072/erq2fy26.htm",
                createdAt: 16,
                expectedEligibility: "must_exclude",
                expectedJustification: "index or document landing page",
            },
            {
                sourceId: "servicenow-balanced-current-17",
                canonicalUrl:
                    "https://www.servicenow.com/docs/r/api-reference/rest-apis/hr-core-api.html",
                title: "HR REST API",
                origin: "exa",
                category: "official_product",
                providerReference:
                    "https://www.servicenow.com/docs/r/api-reference/rest-apis/hr-core-api.html",
                createdAt: 17,
                expectedEligibility: "must_include",
                expectedJustification:
                    "official product or integration documentation",
            },
            {
                sourceId: "servicenow-balanced-current-18",
                canonicalUrl:
                    "https://www.servicenow.com/docs/r/washingtondc/api-reference/server-api-reference/c_GlideRecordAPI.html",
                title: "GlideRecord - Global",
                origin: "exa",
                category: "official_product",
                providerReference:
                    "https://www.servicenow.com/docs/r/washingtondc/api-reference/server-api-reference/c_GlideRecordAPI.html",
                createdAt: 18,
                expectedEligibility: "may_include",
                expectedJustification:
                    "qualified first-party, IR, or partner source",
            },
            {
                sourceId: "servicenow-balanced-current-19",
                canonicalUrl:
                    "https://www.servicenow.com/lpdem/demonow-api-integration.html",
                title: "ServiceNow API Integration Demo",
                origin: "exa",
                category: "official_product",
                providerReference:
                    "https://www.servicenow.com/lpdem/demonow-api-integration.html",
                createdAt: 19,
                expectedEligibility: "must_include",
                expectedJustification:
                    "official product or integration documentation",
            },
            {
                sourceId: "servicenow-balanced-current-20",
                canonicalUrl:
                    "https://www.servicenow.com/community/developer-articles/starting-with-rest-apis-servicenow-integration-level-1/ta-p/2329709",
                title: "Starting with REST APIs - ServiceNow Integration L... - ServiceNow Community",
                origin: "exa",
                category: "official_product",
                publishedAt: 1537747200000,
                providerReference:
                    "https://www.servicenow.com/community/developer-articles/starting-with-rest-apis-servicenow-integration-level-1/ta-p/2329709",
                createdAt: 20,
                expectedEligibility: "must_exclude",
                expectedJustification:
                    "community, aggregator, or unqualified publisher",
            },
            {
                sourceId: "servicenow-balanced-current-21",
                canonicalUrl: "https://www.servicenow.com/lpgp/pricing.html",
                title: "Pricing",
                origin: "exa",
                category: "official_commercial",
                providerReference:
                    "https://www.servicenow.com/lpgp/pricing.html",
                createdAt: 21,
                expectedEligibility: "must_include",
                expectedJustification: "official pricing or terms",
            },
            {
                sourceId: "servicenow-balanced-current-22",
                canonicalUrl:
                    "https://store.servicenow.com/store/app/eebdfef04739361439e06507e26d4334",
                title: "Customer Request for Quote - ServiceNow Store",
                origin: "exa",
                category: "official_commercial",
                providerReference:
                    "https://store.servicenow.com/store/app/eebdfef04739361439e06507e26d4334",
                createdAt: 22,
                expectedEligibility: "may_include",
                expectedJustification:
                    "qualified first-party, IR, or partner source",
            },
            {
                sourceId: "servicenow-balanced-current-23",
                canonicalUrl:
                    "https://www.servicenow.com/community/now-assist-articles/ai-agents-faq-and-troubleshooting/ta-p/3200454",
                title: "AI Agents FAQ and Troubleshooting - ServiceNow Community",
                origin: "exa",
                category: "official_commercial",
                publishedAt: 1742169600000,
                providerReference:
                    "https://www.servicenow.com/community/now-assist-articles/ai-agents-faq-and-troubleshooting/ta-p/3200454",
                createdAt: 23,
                expectedEligibility: "must_exclude",
                expectedJustification:
                    "community, aggregator, or unqualified publisher",
            },
            {
                sourceId: "servicenow-balanced-current-24",
                canonicalUrl:
                    "https://www.servicenow.com/standard/resource-center/data-sheet/ds-sales-and-order-management.html",
                title: "Sales and Order Management Data Sheet",
                origin: "exa",
                category: "official_commercial",
                providerReference:
                    "https://www.servicenow.com/standard/resource-center/data-sheet/ds-sales-and-order-management.html",
                createdAt: 24,
                expectedEligibility: "may_include",
                expectedJustification:
                    "qualified first-party, IR, or partner source",
            },
            {
                sourceId: "servicenow-balanced-current-25",
                canonicalUrl: "https://app.marginofinsight.com/stocks/NOW",
                title: "ServiceNow Inc. (NOW) — Equity Research | Margin of Insight",
                origin: "exa",
                category: "counter_evidence",
                publishedAt: 1778544000000,
                providerReference: "https://app.marginofinsight.com/stocks/NOW",
                createdAt: 25,
                expectedEligibility: "must_exclude",
                expectedJustification:
                    "community, aggregator, or unqualified publisher",
            },
            {
                sourceId: "servicenow-balanced-current-26",
                canonicalUrl:
                    "https://www.morningstar.com/stocks/deeply-undervalued-stock-long-term-investors-who-can-handle-uncertainty",
                title: "ServiceNow: A Deeply Undervalued Stock for Long-Term Investors Who Can Handle Uncertainty | Morningstar",
                origin: "exa",
                category: "counter_evidence",
                publishedAt: 1771459200000,
                providerReference:
                    "https://www.morningstar.com/stocks/deeply-undervalued-stock-long-term-investors-who-can-handle-uncertainty",
                createdAt: 26,
                expectedEligibility: "must_include",
                expectedJustification: "qualified independent producer",
            },
            {
                sourceId: "servicenow-balanced-current-27",
                canonicalUrl:
                    "https://earningsmoat.com/stocks/now-2025-earnings-analysis",
                title: "SERVICENOW, INC. NOW 2025 10-K Analysis | EarningsMoat",
                origin: "exa",
                category: "counter_evidence",
                publishedAt: 1775174400000,
                providerReference:
                    "https://earningsmoat.com/stocks/now-2025-earnings-analysis",
                createdAt: 27,
                expectedEligibility: "must_exclude",
                expectedJustification:
                    "community, aggregator, or unqualified publisher",
            },
            {
                sourceId: "servicenow-balanced-current-28",
                canonicalUrl:
                    "https://earningsmoat.com/stocks/now-2024-earnings-analysis",
                title: "ServiceNow, Inc. NOW 2024 10-K Analysis | EarningsMoat",
                origin: "exa",
                category: "counter_evidence",
                publishedAt: 1776902400000,
                providerReference:
                    "https://earningsmoat.com/stocks/now-2024-earnings-analysis",
                createdAt: 28,
                expectedEligibility: "must_exclude",
                expectedJustification:
                    "community, aggregator, or unqualified publisher",
            },
        ],
    },
] satisfies Array<GoldenSourcePool>;

const MUST_INCLUDE_REQUIREMENTS = {
    "ccc-balanced-02": ["regulatory_material_event", "0001193125-26-248437"],
    "ccc-balanced-10": ["regulatory_annual", "ccc-fy2025"],
    "ccc-balanced-11": ["regulatory_interim", "ccc-q1-2026"],
    "ccc-balanced-14": ["investor_results", "ccc-fy2025-results"],
    "ccc-balanced-16": ["investor_presentation", "ccc-q1-2026-transcript"],
    "ccc-balanced-17": ["official_commercial_terms", "ccc-amplify-terms"],
    "ccc-balanced-18": ["official_commercial_terms", "ccc-payroll-terms"],
    "servicenow-balanced-legacy-01": [
        "regulatory_interim",
        "0001373715-26-000076",
    ],
    "servicenow-balanced-legacy-04": [
        "regulatory_material_event",
        "0001373715-26-000072",
    ],
    "servicenow-balanced-legacy-10": ["regulatory_annual", "servicenow-fy2025"],
    "servicenow-balanced-legacy-12": [
        "investor_results",
        "servicenow-q2-2026-results",
    ],
    "servicenow-balanced-legacy-14": [
        "investor_results",
        "servicenow-q2-2026-results",
    ],
    "servicenow-balanced-legacy-15": [
        "investor_presentation",
        "servicenow-q1-2026-presentation",
    ],
    "servicenow-balanced-legacy-16": [
        "official_product_integration",
        "servicenow-hr-core-api",
    ],
    "servicenow-balanced-legacy-17": [
        "official_product_integration",
        "servicenow-api-demo",
    ],
    "servicenow-balanced-legacy-20": [
        "official_commercial_pricing",
        "servicenow-pricing",
    ],
    "servicenow-first-party-01": ["regulatory_interim", "0001373715-26-000076"],
    "servicenow-first-party-04": [
        "regulatory_material_event",
        "0001373715-26-000072",
    ],
    "servicenow-first-party-09": ["regulatory_annual", "servicenow-fy2025"],
    "servicenow-first-party-12": [
        "investor_results",
        "servicenow-q2-2026-results",
    ],
    "servicenow-first-party-13": [
        "investor_results",
        "servicenow-q2-2026-results",
    ],
    "servicenow-first-party-15": [
        "investor_presentation",
        "servicenow-q1-2026-presentation",
    ],
    "servicenow-first-party-17": [
        "official_product_platform",
        "servicenow-platform-reference",
    ],
    "servicenow-first-party-20": [
        "official_commercial_pricing",
        "servicenow-pricing",
    ],
    "servicenow-first-party-28": [
        "official_security_architecture",
        "servicenow-security-practices",
    ],
    "servicenow-first-party-29": [
        "official_security_architecture",
        "servicenow-data-encryption",
    ],
    "servicenow-first-party-30": [
        "official_security_architecture",
        "servicenow-zero-trust",
    ],
    "servicenow-first-party-31": [
        "official_security_architecture",
        "servicenow-platform-encryption",
    ],
    "servicenow-balanced-current-01": [
        "regulatory_interim",
        "0001373715-26-000076",
    ],
    "servicenow-balanced-current-04": [
        "regulatory_material_event",
        "0001373715-26-000072",
    ],
    "servicenow-balanced-current-11": [
        "regulatory_annual",
        "servicenow-fy2025",
    ],
    "servicenow-balanced-current-12": [
        "regulatory_interim",
        "servicenow-q1-2026",
    ],
    "servicenow-balanced-current-13": [
        "investor_presentation",
        "servicenow-q1-2026-presentation",
    ],
    "servicenow-balanced-current-14": [
        "investor_results",
        "servicenow-q2-2026-results",
    ],
    "servicenow-balanced-current-15": [
        "investor_results",
        "servicenow-q1-2026-results",
    ],
    "servicenow-balanced-current-17": [
        "official_product_integration",
        "servicenow-hr-core-api",
    ],
    "servicenow-balanced-current-19": [
        "official_product_integration",
        "servicenow-api-demo",
    ],
    "servicenow-balanced-current-21": [
        "official_commercial_pricing",
        "servicenow-pricing",
    ],
    "servicenow-balanced-current-26": [
        "counter_evidence_primary",
        "morningstar-servicenow-uncertainty",
    ],
} as const satisfies Record<string, readonly [SourceCoverageRole, string]>;

export const SOURCE_SELECTION_V2_EXISTING_CORPUS =
    SOURCE_SELECTION_V2_EXISTING_CORPUS_BASE.map((pool) => ({
        ...pool,
        candidates: pool.candidates.map((candidate) => {
            const requirement =
                MUST_INCLUDE_REQUIREMENTS[
                    candidate.sourceId as keyof typeof MUST_INCLUDE_REQUIREMENTS
                ];
            return {
                ...candidate,
                ...(requirement
                    ? {
                          expectedRequirement: {
                              role: requirement[0],
                              eventKey: requirement[1],
                          },
                      }
                    : {}),
            };
        }),
    })) satisfies Array<GoldenSourcePool>;
