import { env } from "./_generated/server";

const DEFAULT_COMPANY_SEARCH_RESULT_LIMIT = 40;
const DEFAULT_SOURCE_CANDIDATE_LIMIT = 48;
const MAX_CONFIGURED_COLLECTION_LIMIT = 200;

function configuredPositiveInteger(
    value: string | undefined,
    fallback: number,
    label: string,
): number {
    if (value === undefined || value.trim().length === 0) {
        return fallback;
    }

    const parsed = Number(value);
    if (
        !Number.isInteger(parsed) ||
        parsed < 1 ||
        parsed > MAX_CONFIGURED_COLLECTION_LIMIT
    ) {
        throw new Error(
            `${label} must be an integer between 1 and ${MAX_CONFIGURED_COLLECTION_LIMIT}`,
        );
    }
    return parsed;
}

export function companySearchResultLimit(): number {
    return configuredPositiveInteger(
        env.COMPANY_SEARCH_RESULT_LIMIT,
        DEFAULT_COMPANY_SEARCH_RESULT_LIMIT,
        "Company search result limit",
    );
}

export function sourceCandidateLimit(): number {
    return configuredPositiveInteger(
        env.SOURCE_CANDIDATE_LIMIT,
        DEFAULT_SOURCE_CANDIDATE_LIMIT,
        "Source candidate limit",
    );
}

export function sourceRecommendedTarget(): number {
    const candidateLimit = sourceCandidateLimit();
    const ceiling = configuredPositiveInteger(
        env.SOURCE_RECOMMENDATION_CEILING,
        Math.ceil(candidateLimit / 2),
        "Source recommendation ceiling",
    );
    if (ceiling > candidateLimit) {
        throw new Error(
            "Source recommendation ceiling must not exceed source candidate limit",
        );
    }
    return ceiling;
}
