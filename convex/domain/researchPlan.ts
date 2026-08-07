import type { SecCompanyMatch } from "@convex/companyResolution";

export const ASSESSMENT_DIMENSION_KEYS = [
    "context_ownership",
    "workflow_control",
    "system_of_action_capability",
    "orchestration_position",
    "model_platform_dependency",
    "data_defensibility",
    "switching_costs",
    "pricing_resilience",
    "learning_loops",
    "abstraction_exposure",
] as const;

export type CoveragePreset =
    | "balanced"
    | "first_party_depth"
    | "independent_scrutiny";

type ResearchPlanInput = {
    company: Pick<
        SecCompanyMatch,
        "legalName" | "ticker" | "websiteUrl" | "investorRelationsUrl"
    >;
    coveragePreset: CoveragePreset;
    researchAngle?: string;
};

export type ResearchPlanQuery = {
    query: string;
    category: string;
    discoveryIntent: string;
    includeDomains?: Array<string>;
    dimensionKeys: Array<(typeof ASSESSMENT_DIMENSION_KEYS)[number]>;
};

const balancedCategories = [
    ["investor_relations", "investor relations earnings presentation"],
    ["official_product", "official product API integration documentation"],
    ["official_commercial", "official pricing terms customer workflow"],
    ["counter_evidence", "independent analysis risks competitors replacement"],
] as const;

function hostname(url: string | undefined): string | undefined {
    if (!url) return undefined;
    try {
        return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
        return undefined;
    }
}

/**
 * Builds a bounded metadata-discovery plan. Presets change search depth only;
 * SEC filings are discovered directly; these queries only discover web sources.
 */
export function buildResearchPlan(input: ResearchPlanInput): {
    coveragePreset: CoveragePreset;
    researchAngle?: string;
    queries: Array<ResearchPlanQuery>;
} {
    const researchAngle = input.researchAngle?.trim().slice(0, 500);
    const categories: Array<readonly [string, string]> = [
        ...balancedCategories,
    ];
    if (input.coveragePreset === "first_party_depth") {
        categories.push([
            "official_security",
            "official security architecture trust documentation",
        ]);
    }
    if (input.coveragePreset === "independent_scrutiny") {
        categories.push([
            "independent_analysis",
            "independent industry analysis customer migration criticism",
        ]);
    }
    const qualifier = researchAngle ? ` ${researchAngle}` : "";
    return {
        coveragePreset: input.coveragePreset,
        researchAngle: researchAngle || undefined,
        queries: categories.map(([category, terms]) => {
            const officialDomain = hostname(input.company.websiteUrl);
            const investorDomain = hostname(input.company.investorRelationsUrl);
            const includeDomains =
                category === "investor_relations"
                    ? [
                          ...new Set(
                              [officialDomain, investorDomain].filter(Boolean),
                          ),
                      ]
                    : category.startsWith("official_") && officialDomain
                      ? [officialDomain]
                      : undefined;
            return {
                query: `"${input.company.legalName}" ${input.company.ticker} ${terms}${qualifier}`,
                category,
                discoveryIntent: category,
                includeDomains:
                    includeDomains && includeDomains.length > 0
                        ? (includeDomains as Array<string>)
                        : undefined,
                dimensionKeys: [...ASSESSMENT_DIMENSION_KEYS],
            };
        }),
    };
}
