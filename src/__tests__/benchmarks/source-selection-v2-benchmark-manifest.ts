import type { CoveragePreset } from "@convex/domain/researchPlan";

export type SourceSelectionLiveCompany = {
    id: string;
    cik: string;
    legalName: string;
    ticker: string;
    websiteUrl: string;
    coveragePreset: CoveragePreset;
};

export const SOURCE_SELECTION_V2_LIVE_COMPANIES = [
    {
        id: "servicenow",
        cik: "1373715",
        legalName: "ServiceNow, Inc.",
        ticker: "NOW",
        websiteUrl: "https://servicenow.com/",
        coveragePreset: "first_party_depth",
    },
    {
        id: "ccc",
        cik: "1818201",
        legalName: "CCC Intelligent Solutions Holdings Inc.",
        ticker: "CCC",
        websiteUrl: "https://cccis.com/",
        coveragePreset: "independent_scrutiny",
    },
    {
        id: "microsoft",
        cik: "789019",
        legalName: "Microsoft Corporation",
        ticker: "MSFT",
        websiteUrl: "https://microsoft.com/",
        coveragePreset: "balanced",
    },
    {
        id: "cloudflare",
        cik: "1477333",
        legalName: "Cloudflare, Inc.",
        ticker: "NET",
        websiteUrl: "https://cloudflare.com/",
        coveragePreset: "balanced",
    },
    {
        id: "shopify",
        cik: "1594805",
        legalName: "Shopify Inc.",
        ticker: "SHOP",
        websiteUrl: "https://shopify.com/",
        coveragePreset: "balanced",
    },
] satisfies Array<SourceSelectionLiveCompany>;
