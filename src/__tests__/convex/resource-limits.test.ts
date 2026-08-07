import { sourceRecommendedTarget } from "@convex/resourceLimits";
import { afterEach, expect, test } from "vitest";

const originalCandidateLimit = process.env.SOURCE_CANDIDATE_LIMIT;
const originalRecommendedTarget = process.env.SOURCE_RECOMMENDED_TARGET;

afterEach(() => {
    if (originalCandidateLimit === undefined) {
        delete process.env.SOURCE_CANDIDATE_LIMIT;
    } else {
        process.env.SOURCE_CANDIDATE_LIMIT = originalCandidateLimit;
    }
    if (originalRecommendedTarget === undefined) {
        delete process.env.SOURCE_RECOMMENDED_TARGET;
    } else {
        process.env.SOURCE_RECOMMENDED_TARGET = originalRecommendedTarget;
    }
});

test("defaults the source recommendation target to twelve", () => {
    delete process.env.SOURCE_CANDIDATE_LIMIT;
    delete process.env.SOURCE_RECOMMENDED_TARGET;

    expect(sourceRecommendedTarget()).toBe(12);
});

test("rejects a source recommendation target above the candidate limit", () => {
    process.env.SOURCE_CANDIDATE_LIMIT = "10";
    process.env.SOURCE_RECOMMENDED_TARGET = "11";

    expect(() => sourceRecommendedTarget()).toThrow(
        "Source recommendation target must not exceed source candidate limit",
    );
});
