import type { SecCompanyMatch } from '@convex/companyResolution';

export const ASSESSMENT_DIMENSION_KEYS = [
    'context_ownership',
    'workflow_control',
    'system_of_action_capability',
    'orchestration_position',
    'model_platform_dependency',
    'data_defensibility',
    'switching_costs',
    'pricing_resilience',
    'learning_loops',
    'abstraction_exposure',
] as const;

export type CoveragePreset =
    | 'balanced'
    | 'first_party_depth'
    | 'independent_scrutiny';

type ResearchPlanInput = {
    company: Pick<SecCompanyMatch, 'legalName' | 'ticker'>;
    coveragePreset: CoveragePreset;
    researchAngle?: string;
};

export type ResearchPlanQuery = {
    query: string;
    category: string;
    dimensionKeys: Array<(typeof ASSESSMENT_DIMENSION_KEYS)[number]>;
};

const balancedCategories = [
    ['regulatory', '10-K 10-Q 8-K SEC filings'],
    ['investor_relations', 'investor relations earnings presentation'],
    ['official_product', 'official product API integration documentation'],
    ['official_commercial', 'official pricing terms customer workflow'],
    ['counter_evidence', 'independent analysis risks competitors replacement'],
] as const;

/**
 * Builds a bounded metadata-discovery plan. Presets change search depth only;
 * they cannot remove regulatory or counter-evidence coverage.
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
    if (input.coveragePreset === 'first_party_depth') {
        categories.push([
            'official_security',
            'official security architecture trust documentation',
        ]);
    }
    if (input.coveragePreset === 'independent_scrutiny') {
        categories.push([
            'independent_analysis',
            'independent industry analysis customer migration criticism',
        ]);
    }
    const qualifier = researchAngle ? ` ${researchAngle}` : '';
    return {
        coveragePreset: input.coveragePreset,
        researchAngle: researchAngle || undefined,
        queries: categories.map(([category, terms]) => ({
            query: `"${input.company.legalName}" ${input.company.ticker} ${terms}${qualifier}`,
            category,
            dimensionKeys: [...ASSESSMENT_DIMENSION_KEYS],
        })),
    };
}
