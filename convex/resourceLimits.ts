import type { Id } from "./_generated/dataModel";
import { env } from "./_generated/server";

export const MAX_ANALYSES_PER_VISITOR = 3;

const DEFAULT_COMPANY_SEARCH_RESULT_LIMIT = 40;
export const MAX_INITIAL_SOURCE_CANDIDATES = 48;
const MAX_PREPARED_RECOMMENDATIONS = 24;
const MAX_CONFIGURED_COLLECTION_LIMIT = 200;

/** Keeps staged preparation activation consistent at every workflow entry point. */
export function sourcePreparationEnabled(): boolean {
    return process.env.SOURCE_QUALIFICATION_ENABLED === "true";
}

function configuredPositiveInteger(
    value: string | undefined,
    fallback: number,
    label: string,
    maximum = MAX_CONFIGURED_COLLECTION_LIMIT,
): number {
    if (value === undefined || value.trim().length === 0) {
        return fallback;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
        throw new Error(`${label} must be an integer between 1 and ${maximum}`);
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
        MAX_INITIAL_SOURCE_CANDIDATES,
        "Source candidate limit",
    );
}

/** Preparation reserves a finite supplement without increasing initial discovery. */
export function sourceDossierCandidateLimit(
    preparationId?: Id<"sourceSelectionProposalRebuilds">,
): number {
    return preparationId
        ? MAX_HISTORICAL_SOURCE_CANDIDATES
        : sourceCandidateLimit();
}

export function sourceRecommendedTarget(
    preparationId?: Id<"sourceSelectionProposalRebuilds">,
): number {
    const candidateLimit = sourceDossierCandidateLimit(preparationId);
    const ceiling = configuredPositiveInteger(
        env.SOURCE_RECOMMENDATION_CEILING,
        preparationId
            ? MAX_PREPARED_RECOMMENDATIONS
            : Math.ceil(candidateLimit / 2),
        "Source recommendation ceiling",
    );
    if (ceiling > candidateLimit) {
        throw new Error(
            "Source recommendation ceiling must not exceed source candidate limit",
        );
    }
    return preparationId
        ? Math.min(MAX_PREPARED_RECOMMENDATIONS, ceiling)
        : ceiling;
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

export const SOURCE_PREPARATION_DEADLINE_MS = 15 * 60_000;

/** Source fan-out is independent of the shared Workflow queue and request-size limits. */
export function preparationMaxConcurrency(): number {
    return configuredPositiveInteger(
        env.SOURCE_PREPARATION_MAX_CONCURRENCY,
        2,
        "Preparation concurrency",
        Number.MAX_SAFE_INTEGER,
    );
}
// Legacy envelope used only when reconstructing dossiers without versioned accounting.
export const LEGACY_PREPARATION_MODEL_ATTEMPT_LIMIT = 120;

/** Read at execution start so an explicit resume can adopt updated deployment limits. */
export function preparationModelLimits() {
    const read = (value: string | undefined, fallback: number) => {
        if (value === undefined || value.trim() === "") return fallback;
        const limit = Number(value);
        if (!Number.isSafeInteger(limit) || limit < 1)
            throw new Error(
                "Preparation limits must be positive safe integers",
            );
        return limit;
    };
    const work = read(process.env.SOURCE_PREPARATION_WORK_LIMIT, 120);
    const incidents = read(process.env.SOURCE_PREPARATION_INCIDENT_LIMIT, 40);
    if (!Number.isSafeInteger(work + incidents))
        throw new Error("Combined preparation limit must be a safe integer");
    return { work, incidents };
}
export const MAX_SUPPLEMENT_SEARCHES = 3;
export const MAX_SUPPLEMENT_CANDIDATES = 12;
export const MAX_HISTORICAL_SOURCE_CANDIDATES = 60;

// Phase 5 claim limits
export const MAX_CLAIMS_PER_RUN = 128;
export const MAX_EVIDENCE_PER_CLAIM = 32;
export const MAX_DIMENSION_LINKS_PER_CLAIM = 10;
export const MAX_CLAIM_STATEMENT_CHARS = 1000;
export const MAX_CLAIM_RATIONALE_CHARS = 2000;
export const MAX_CLAIM_INPUT_PASSAGES = 4096;

/** Shared embedding format and conservative input allowance, separate from generative-call quotas. */
export const SOURCE_EMBEDDING_DIMENSIONS = 1024;
export const SOURCE_EMBEDDING_PROFILE_VERSION = "evidence-embedding-v1";
export const MAX_SOURCE_EMBEDDING_BATCH_TEXTS = 32;
export const MAX_SOURCE_EMBEDDING_TEXT_BYTES = 6000;
export const SOURCE_EMBEDDING_PRICE_CEILING_PER_MILLION_TOKENS = 0.012;
export const MAX_SOURCE_EMBEDDING_INPUT_BYTES = Math.floor(
    (0.01 * 1_000_000) / SOURCE_EMBEDDING_PRICE_CEILING_PER_MILLION_TOKENS,
);
export const MAX_SOURCE_EMBEDDING_ATTEMPTS = 128;
export const MAX_CONCURRENT_SOURCE_EMBEDDING_CALLS = 2;

export const MAX_SOURCE_SEARCH_CANDIDATES = 20_000;
export const MAX_SOURCE_SEARCH_BLOCKS = 100_000;

/** Snapshotted so existing preparation journals retain their recorded step sequence. */
export const SOURCE_PREPARATION_SOURCE_ACTIONS_VERSION = "source_actions_v3";
export const SOURCE_PREPARATION_EXECUTION_PLAN_VERSION =
    SOURCE_PREPARATION_SOURCE_ACTIONS_VERSION;

/** Keeps rejected assistant output within one bounded provider receipt. */
export const MAX_PREPARATION_DIAGNOSTIC_BYTES = 64 * 1024;

/** Bounds the retained log replayed by one Pi worker without discarding originals. */
export const PI_SESSION_MAX_BYTES = 32 * 1024 * 1024;
export const PI_COMMIT_MAX_BYTES = 512 * 1024;
export const PI_LEASE_RENEW_INTERVAL_MS = 25_000;
