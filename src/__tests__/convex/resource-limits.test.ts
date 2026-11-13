import {
    companySearchResultLimit,
    preparationMaxConcurrency,
    preparationModelLimits,
    previewCacheTtlMs,
    sourceCandidateLimit,
    sourcePreparationEnabled,
    sourceRecommendedTarget,
} from "@convex/resourceLimits";
import {
    MAX_APPROVED_SOURCE_BYTES,
    MAX_EVIDENCE_ARTIFACT_BYTES,
    MAX_NORMALIZED_ARTIFACT_BYTES,
    MAX_PASSAGES_PER_SOURCE,
    MAX_PDF_PAGES,
    MAX_QUOTATION_CHARS,
    MAX_REDIRECTS,
} from "@convex/resourcePolicy";
import { afterEach, expect, test, vi } from "vitest";

const originalCandidateLimit = process.env.SOURCE_CANDIDATE_LIMIT;
const originalRecommendationCeiling = process.env.SOURCE_RECOMMENDATION_CEILING;

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    if (originalCandidateLimit === undefined) {
        delete process.env.SOURCE_CANDIDATE_LIMIT;
    } else {
        process.env.SOURCE_CANDIDATE_LIMIT = originalCandidateLimit;
    }
    if (originalRecommendationCeiling === undefined) {
        delete process.env.SOURCE_RECOMMENDATION_CEILING;
    } else {
        process.env.SOURCE_RECOMMENDATION_CEILING =
            originalRecommendationCeiling;
    }
});

test("reads preparation activation from the current invocation environment", () => {
    vi.stubEnv("SOURCE_QUALIFICATION_ENABLED", "false");
    expect(sourcePreparationEnabled()).toBe(false);
    vi.stubGlobal("process", {
        ...process,
        env: { ...process.env, SOURCE_QUALIFICATION_ENABLED: "true" },
    });
    expect(sourcePreparationEnabled()).toBe(true);
});

test("derives the source recommendation ceiling from half the candidate pool", () => {
    delete process.env.SOURCE_CANDIDATE_LIMIT;
    delete process.env.SOURCE_RECOMMENDATION_CEILING;

    expect(sourceRecommendedTarget()).toBe(24);
    process.env.SOURCE_CANDIDATE_LIMIT = "49";
    expect(sourceRecommendedTarget()).toBe(25);
});

test("prefers the explicit ceiling over the computed default", () => {
    process.env.SOURCE_CANDIDATE_LIMIT = "48";
    process.env.SOURCE_RECOMMENDATION_CEILING = "20";

    expect(sourceRecommendedTarget()).toBe(20);
});

test("rejects a source recommendation ceiling above the candidate limit", () => {
    process.env.SOURCE_CANDIDATE_LIMIT = "10";
    process.env.SOURCE_RECOMMENDATION_CEILING = "11";

    expect(() => sourceRecommendedTarget()).toThrow(
        "Source recommendation ceiling must not exceed source candidate limit",
    );
});

test("resolves collection defaults and explicit configuration at the environment boundary", () => {
    vi.stubEnv("COMPANY_SEARCH_RESULT_LIMIT", " ");
    vi.stubEnv("SOURCE_CANDIDATE_LIMIT", "");
    expect(companySearchResultLimit()).toBe(40);
    expect(sourceCandidateLimit()).toBe(48);
    vi.stubEnv("COMPANY_SEARCH_RESULT_LIMIT", "17");
    vi.stubEnv("SOURCE_CANDIDATE_LIMIT", "19");
    expect(companySearchResultLimit()).toBe(17);
    expect(sourceCandidateLimit()).toBe(19);
});

test.each([
    "0",
    "-1",
    "1.5",
    "201",
    "NaN",
    "Infinity",
])("rejects invalid collection configuration %s", (value) => {
    vi.stubEnv("SOURCE_CANDIDATE_LIMIT", value);
    expect(() => sourceCandidateLimit()).toThrow(
        "Source candidate limit must be an integer between 1 and 200",
    );
});

test("resolves preview time in milliseconds independently of collection counts", () => {
    vi.stubEnv("PREVIEW_CACHE_TTL_MS", "");
    expect(previewCacheTtlMs()).toBe(3_600_000);
    vi.stubEnv("PREVIEW_CACHE_TTL_MS", "1000");
    expect(previewCacheTtlMs()).toBe(1000);
    vi.stubEnv("PREVIEW_CACHE_TTL_MS", "999");
    expect(() => previewCacheTtlMs()).toThrow(
        "PREVIEW_CACHE_TTL_MS must be an integer >= 1000",
    );
});

test("resolves preparation concurrency separately from collection limits", () => {
    vi.stubEnv("SOURCE_PREPARATION_MAX_CONCURRENCY", "");
    expect(preparationMaxConcurrency()).toBe(2);
    vi.stubEnv("SOURCE_PREPARATION_MAX_CONCURRENCY", "201");
    expect(preparationMaxConcurrency()).toBe(201);
    vi.stubEnv("SOURCE_PREPARATION_MAX_CONCURRENCY", "0");
    expect(() => preparationMaxConcurrency()).toThrow(
        "Preparation concurrency must be an integer between 1 and 9007199254740991",
    );
});

test("resolves independent cumulative work and incident allowances", () => {
    vi.stubEnv("SOURCE_PREPARATION_WORK_LIMIT", " ");
    vi.stubEnv("SOURCE_PREPARATION_INCIDENT_LIMIT", "");
    expect(preparationModelLimits()).toEqual({ work: 120, incidents: 40 });
    vi.stubEnv("SOURCE_PREPARATION_WORK_LIMIT", "37");
    vi.stubEnv("SOURCE_PREPARATION_INCIDENT_LIMIT", "9");
    expect(preparationModelLimits()).toEqual({ work: 37, incidents: 9 });
    vi.stubEnv("SOURCE_PREPARATION_INCIDENT_LIMIT", "0");
    expect(() => preparationModelLimits()).toThrow(
        "Preparation limits must be positive safe integers",
    );
    vi.stubEnv("SOURCE_PREPARATION_WORK_LIMIT", "9007199254740991");
    vi.stubEnv("SOURCE_PREPARATION_INCIDENT_LIMIT", "1");
    expect(() => preparationModelLimits()).toThrow(
        "Combined preparation limit must be a safe integer",
    );
});

test("exports Phase 5 locked resource limits", () => {
    expect(MAX_APPROVED_SOURCE_BYTES).toBe(16 * 1024 * 1024);
    expect(MAX_NORMALIZED_ARTIFACT_BYTES).toBe(16 * 1024 * 1024);
    expect(MAX_EVIDENCE_ARTIFACT_BYTES).toBe(16 * 1024 * 1024);
    expect(MAX_PDF_PAGES).toBe(400);
    expect(MAX_PASSAGES_PER_SOURCE).toBe(512);
    expect(MAX_QUOTATION_CHARS).toBe(4000);
    expect(MAX_REDIRECTS).toBe(5);
});
