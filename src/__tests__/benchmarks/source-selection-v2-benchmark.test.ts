import { describe, expect, test } from "vitest";
import { buildSourceSelectionProposal } from "@convex/domain/sourceSelectionPolicy";

import { evaluateSourceSelectionPools } from "./source-selection-v2-benchmark";
import {
    type GoldenSourcePool,
    SOURCE_SELECTION_V2_EXISTING_CORPUS,
} from "./source-selection-v2-existing-corpus";

describe("source selection v2 golden corpus", () => {
    test("contains the complete normalized 110-candidate snapshot", () => {
        expect(SOURCE_SELECTION_V2_EXISTING_CORPUS).toHaveLength(4);
        expect(
            SOURCE_SELECTION_V2_EXISTING_CORPUS.reduce(
                (total, pool) => total + pool.candidates.length,
                0,
            ),
        ).toBe(110);
    });

    test("meets the deterministic reliability gates", () => {
        const metrics = evaluateSourceSelectionPools(
            SOURCE_SELECTION_V2_EXISTING_CORPUS,
        );

        expect(metrics.forbiddenRecommendations).toBe(0);
        expect(metrics.duplicateRecommendations).toBe(0);
        expect(metrics.recommendationsWithoutContribution).toBe(0);
        expect(metrics.maximumNeedsAttention).toBeLessThanOrEqual(1);
        expect(metrics.precision).toBeGreaterThanOrEqual(0.95);
        expect(metrics.mustIncludeRecall).toBeGreaterThanOrEqual(0.9);
        expect(metrics).toMatchObject({
            recommended: 44,
            truePositiveRecommendations: 44,
            mustIncludeObligations: 37,
            satisfiedMustIncludeObligations: 37,
            mustIncludeCandidates: 39,
            includedMustIncludeCandidates: 37,
        });
    });

    test("satisfies every typed obligation in the frozen corpus", () => {
        const unsatisfied = SOURCE_SELECTION_V2_EXISTING_CORPUS.flatMap(
            (pool) => {
                const result = buildSourceSelectionProposal({
                    candidates: pool.candidates,
                    company: pool.company,
                    coveragePreset: pool.coveragePreset,
                    ceiling: 24,
                });
                const recommended = new Set(
                    result.items
                        .filter(
                            ({ disposition }) => disposition === "recommended",
                        )
                        .map(({ sourceId }) => sourceId),
                );
                const obligations = new Map<string, Array<string>>();
                for (const candidate of pool.candidates) {
                    if (!candidate.expectedRequirement) continue;
                    const key = `${candidate.expectedRequirement.role}:${candidate.expectedRequirement.eventKey}`;
                    obligations.set(key, [
                        ...(obligations.get(key) ?? []),
                        candidate.sourceId,
                    ]);
                }
                return [...obligations.entries()].flatMap(
                    ([obligation, sourceIds]) =>
                        sourceIds.some((sourceId) => recommended.has(sourceId))
                            ? []
                            : [`${pool.fixtureRunKey}:${obligation}`],
                );
            },
        );

        expect(unsatisfied).toEqual([]);
    });

    test("counts typed role-event obligations instead of collapsing prose labels", () => {
        const candidates = [
            {
                sourceId: "a-event-a-primary",
                canonicalUrl: "https://analyst.example/event-a",
                title: "Event A",
                origin: "analyst_url" as const,
                category: "analyst_supplied",
                createdAt: 1,
                expectedEligibility: "must_include" as const,
                expectedJustification: "same prose label",
                expectedRequirement: {
                    role: "official_product_platform" as const,
                    eventKey: "event-a",
                },
            },
            {
                sourceId: "z-event-a-alternate",
                canonicalUrl: "https://analyst.example/event-a-copy",
                title: "Event A alternate",
                origin: "analyst_url" as const,
                category: "analyst_supplied",
                createdAt: 2,
                expectedEligibility: "must_include" as const,
                expectedJustification: "same prose label",
                expectedRequirement: {
                    role: "official_product_platform" as const,
                    eventKey: "event-a",
                },
            },
            {
                sourceId: "b-event-b",
                canonicalUrl: "https://analyst.example/event-b",
                title: "Event B",
                origin: "analyst_url" as const,
                category: "analyst_supplied",
                createdAt: 3,
                expectedEligibility: "must_include" as const,
                expectedJustification: "same prose label",
                expectedRequirement: {
                    role: "official_product_platform" as const,
                    eventKey: "event-b",
                },
            },
        ];
        const pool: GoldenSourcePool = {
            fixtureRunKey: "typed-obligations",
            company: {
                cik: "1373715",
                legalName: "ServiceNow, Inc.",
                ticker: "NOW",
                websiteUrl: "https://servicenow.com/",
            },
            coveragePreset: "balanced",
            candidates,
        };

        const metrics = evaluateSourceSelectionPools([pool], 2);

        expect(metrics.mustIncludeObligations).toBe(2);
        expect(metrics.satisfiedMustIncludeObligations).toBe(2);
        expect(metrics.mustIncludeCandidates).toBe(3);
        expect(metrics.includedMustIncludeCandidates).toBe(2);
        expect(metrics.mustIncludeRecall).toBe(1);
        expect(metrics.mustIncludeCandidateRecall).toBeCloseTo(2 / 3);
    });
});
