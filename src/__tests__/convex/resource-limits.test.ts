import {
    MAX_APPROVED_SOURCE_BYTES,
    MAX_EVIDENCE_ARTIFACT_BYTES,
    MAX_NORMALIZED_ARTIFACT_BYTES,
    MAX_PASSAGES_PER_SOURCE,
    MAX_PDF_PAGES,
    MAX_QUOTATION_CHARS,
    MAX_REDIRECTS,
    sourceRecommendedTarget,
} from "@convex/resourceLimits";
import { afterEach, expect, test } from "vitest";

const originalCandidateLimit = process.env.SOURCE_CANDIDATE_LIMIT;
const originalRecommendationCeiling = process.env.SOURCE_RECOMMENDATION_CEILING;

afterEach(() => {
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

test("exports Phase 5 locked resource limits", () => {
    expect(MAX_APPROVED_SOURCE_BYTES).toBe(16 * 1024 * 1024);
    expect(MAX_NORMALIZED_ARTIFACT_BYTES).toBe(16 * 1024 * 1024);
    expect(MAX_EVIDENCE_ARTIFACT_BYTES).toBe(16 * 1024 * 1024);
    expect(MAX_PDF_PAGES).toBe(400);
    expect(MAX_PASSAGES_PER_SOURCE).toBe(512);
    expect(MAX_QUOTATION_CHARS).toBe(4000);
    expect(MAX_REDIRECTS).toBe(5);
});
