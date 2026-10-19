import type { SecCompanyMatch } from "@convex/companyResolution";
import { v } from "convex/values";

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

export type AssessmentDimensionKey = (typeof ASSESSMENT_DIMENSION_KEYS)[number];

export const assessmentDimensionKeyValidator = v.union(
    ...ASSESSMENT_DIMENSION_KEYS.map((k) => v.literal(k)),
);

export const RESEARCH_PLAN_TEMPLATE_VERSION = 2;

export const DIMENSION_LABELS: Record<AssessmentDimensionKey, string> = {
    context_ownership: "context ownership",
    workflow_control: "workflow control",
    system_of_action_capability: "system-of-action capability",
    orchestration_position: "orchestration position",
    model_platform_dependency: "model-platform dependency",
    data_defensibility: "data defensibility",
    switching_costs: "switching costs",
    pricing_resilience: "pricing resilience",
    learning_loops: "learning loops",
    abstraction_exposure: "abstraction exposure",
};

export function dimensionLabel(key: AssessmentDimensionKey): string {
    return DIMENSION_LABELS[key];
}

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

export type ResearchPlanQuestionInput = {
    questionKey: string;
    prompt: string;
    dimensionKeys: Array<AssessmentDimensionKey>;
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
 * Builds the immutable, versioned semantic questions for a research plan.
 * One question per assessment dimension, plus a bounded research-angle question
 * when a nonempty angle was supplied. Prompts use the confirmed company name
 * and a human-readable dimension label so question text never leaks raw keys.
 */
export function buildResearchPlanQuestions(input: {
    company: { legalName: string };
    researchAngle?: string;
}): Array<ResearchPlanQuestionInput> {
    const trimmedAngle = input.researchAngle?.trim();
    const boundedAngle = trimmedAngle ? trimmedAngle.slice(0, 500) : undefined;
    const questions: Array<ResearchPlanQuestionInput> =
        ASSESSMENT_DIMENSION_KEYS.map((dimensionKey) => ({
            questionKey: `dimension:${dimensionKey}`,
            prompt: `What public evidence supports or challenges ${dimensionLabel(dimensionKey)} for ${input.company.legalName}?`,
            dimensionKeys: [dimensionKey],
        }));
    if (boundedAngle) {
        questions.push({
            questionKey: "research-angle",
            prompt: `What public evidence addresses this research focus: ${boundedAngle}?`,
            dimensionKeys: [...ASSESSMENT_DIMENSION_KEYS],
        });
    }
    return questions;
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
