import type { Id } from "./_generated/dataModel";
import { env } from "./_generated/server";
import { executionError } from "./execution/errors";
import {
    configuredPositiveInteger,
    DEFAULT_COMPANY_SEARCH_RESULT_LIMIT,
    DEFAULT_PREPARATION_MAX_CONCURRENCY,
    MAX_HISTORICAL_SOURCE_CANDIDATES,
    MAX_INITIAL_SOURCE_CANDIDATES,
    requiredPositiveInteger,
    resolvePreparationModelLimits,
    resolvePreviewCacheTtlMs,
    resolveSourceRecommendedTarget,
} from "./resourcePolicy";

/** Environment boundary for staged preparation activation. */
export function sourcePreparationEnabled(): boolean {
    return process.env.SOURCE_QUALIFICATION_ENABLED === "true";
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
    return resolveSourceRecommendedTarget(
        sourceDossierCandidateLimit(preparationId),
        env.SOURCE_RECOMMENDATION_CEILING,
        !!preparationId,
    );
}

export function previewCacheTtlMs(): number {
    return resolvePreviewCacheTtlMs(env.PREVIEW_CACHE_TTL_MS);
}

/** Fan-out is independent of queue and request-size capacities. */
export function preparationMaxConcurrency(): number {
    return configuredPositiveInteger(
        env.SOURCE_PREPARATION_MAX_CONCURRENCY,
        DEFAULT_PREPARATION_MAX_CONCURRENCY,
        "Preparation concurrency",
        Number.MAX_SAFE_INTEGER,
    );
}

/** Read at execution start; an updated default cannot change an admitted grant. */
export function preparationModelLimits() {
    return resolvePreparationModelLimits(
        process.env.SOURCE_PREPARATION_WORK_LIMIT,
        process.env.SOURCE_PREPARATION_INCIDENT_LIMIT,
    );
}

/**
 * Sources paid-work window per preparation and per Continue.
 * Unit: minutes (returned in milliseconds). Source: deployment setting
 * `SOURCES_PREPARATION_WINDOW_MINUTES`. Exhaustion: triggers the recoverable
 * time-limit decision when remaining capacity admits continuation, or settles
 * with limits otherwise.
 */
export function sourcePreparationWindowMs(): number {
    let minutes: number | undefined;
    try {
        minutes = requiredPositiveInteger(
            env.SOURCES_PREPARATION_WINDOW_MINUTES,
            "Sources preparation window",
            Number.MAX_SAFE_INTEGER,
        );
    } catch {
        throw executionError("sources_configuration_unavailable");
    }
    if (minutes === undefined)
        throw executionError("sources_configuration_unavailable");
    const windowMs = minutes * 60_000;
    if (!Number.isSafeInteger(windowMs))
        throw executionError("sources_configuration_unavailable");
    return windowMs;
}
