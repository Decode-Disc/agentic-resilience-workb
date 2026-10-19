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

const DEFAULT_PREVIEW_CACHE_TTL_MS = 60 * 60 * 1000; // one hour
const MIN_PREVIEW_CACHE_TTL_MS = 1000;

export function previewCacheTtlMs(): number {
    const value = env.PREVIEW_CACHE_TTL_MS;
    if (value === undefined || value.trim().length === 0) {
        return DEFAULT_PREVIEW_CACHE_TTL_MS;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < MIN_PREVIEW_CACHE_TTL_MS) {
        throw new Error(
            `PREVIEW_CACHE_TTL_MS must be an integer >= ${MIN_PREVIEW_CACHE_TTL_MS}`,
        );
    }
    return parsed;
}

// Maximum PNG byte size we persist in the preview cache. Larger screenshots are
// returned to the caller but not cached, to avoid unbounded storage growth.
export const PREVIEW_CACHE_MAX_BYTES = 700 * 1024;

// Phase 5 locked resource and extraction limits
export const MAX_APPROVED_SOURCE_BYTES = 16 * 1024 * 1024; // 16 MiB declared/decompressed
export const MAX_NORMALIZED_ARTIFACT_BYTES = 16 * 1024 * 1024; // 16 MiB
export const MAX_EVIDENCE_ARTIFACT_BYTES = 16 * 1024 * 1024;
export const MAX_PDF_PAGES = 400;
export const MAX_PASSAGES_PER_SOURCE = 512;
export const MAX_QUOTATION_CHARS = 4000;
export const MAX_REDIRECTS = 5;

// Phase 5 claim limits
export const MAX_CLAIMS_PER_RUN = 128;
export const MAX_EVIDENCE_PER_CLAIM = 32;
export const MAX_DIMENSION_LINKS_PER_CLAIM = 10;
export const MAX_CLAIM_STATEMENT_CHARS = 1000;
export const MAX_CLAIM_RATIONALE_CHARS = 2000;
export const MAX_CLAIM_INPUT_PASSAGES = 4096;
