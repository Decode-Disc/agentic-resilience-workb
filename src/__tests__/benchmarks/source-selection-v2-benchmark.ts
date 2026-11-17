import { buildSourceSelectionProposal } from "@convex/domain/sourceSelectionPolicy";

import type { GoldenSourcePool } from "./source-selection-v2-existing-corpus";

export type SourceSelectionBenchmarkMetrics = {
    recommended: number;
    truePositiveRecommendations: number;
    mustIncludeObligations: number;
    satisfiedMustIncludeObligations: number;
    mustIncludeCandidates: number;
    includedMustIncludeCandidates: number;
    mustInclude: number;
    includedMustInclude: number;
    metadataTriageObligations: number;
    satisfiedMetadataTriageObligations: number;
    forbiddenRecommendations: number;
    recommendationsWithoutContribution: number;
    duplicateRecommendations: number;
    classificationMismatches: number;
    maximumNeedsAttention: number;
    precision: number;
    mustIncludeRecall: number;
    mustIncludeCandidateRecall: number;
    metadataTriageRecall: number;
};

export function evaluateSourceSelectionPools(
    pools: ReadonlyArray<GoldenSourcePool>,
    ceiling = 24,
): SourceSelectionBenchmarkMetrics {
    let recommended = 0;
    let truePositiveRecommendations = 0;
    let mustInclude = 0;
    let includedMustInclude = 0;
    let mustIncludeCandidates = 0;
    let includedMustIncludeCandidates = 0;
    let metadataTriageObligations = 0;
    let satisfiedMetadataTriageObligations = 0;
    let forbiddenRecommendations = 0;
    let recommendationsWithoutContribution = 0;
    let duplicateRecommendations = 0;
    let classificationMismatches = 0;
    let maximumNeedsAttention = 0;

    for (const pool of pools) {
        const result = buildSourceSelectionProposal({
            candidates: pool.candidates,
            company: pool.company,
            coveragePreset: pool.coveragePreset,
            ceiling,
        });
        const expectedById = new Map(
            pool.candidates.map((candidate) => [candidate.sourceId, candidate]),
        );
        const recommendedItems = result.items.filter(
            ({ disposition }) => disposition === "recommended",
        );
        const recommendedIds = new Set(
            recommendedItems.map(({ sourceId }) => sourceId),
        );
        for (const candidate of pool.candidates) {
            if (!candidate.expectedClassification) continue;
            const item = result.items.find(
                ({ sourceId }) => sourceId === candidate.sourceId,
            );
            if (
                !item ||
                item.authorityTier !==
                    candidate.expectedClassification.authorityTier ||
                item.documentKind !==
                    candidate.expectedClassification.documentKind ||
                item.sourceFamily !==
                    candidate.expectedClassification.sourceFamily ||
                (candidate.expectedClassification.companyLinkageBasis !==
                    undefined &&
                    item.companyLinkageBasis !==
                        candidate.expectedClassification.companyLinkageBasis) ||
                (candidate.expectedClassification.declaredCoverageRoles !==
                    undefined &&
                    JSON.stringify(item.declaredCoverageRoles) !==
                        JSON.stringify(
                            candidate.expectedClassification
                                .declaredCoverageRoles,
                        )) ||
                JSON.stringify(item.eligibleCoverageRoles) !==
                    JSON.stringify(
                        candidate.expectedClassification.eligibleCoverageRoles,
                    )
            ) {
                classificationMismatches += 1;
            }
        }
        recommended += recommendedItems.length;
        maximumNeedsAttention = Math.max(
            maximumNeedsAttention,
            result.counts.needsAttention,
        );
        const mustIncludeRows = pool.candidates.filter(
            ({ expectedEligibility }) => expectedEligibility === "must_include",
        );
        const obligations = new Map<string, Array<string>>();
        for (const candidate of mustIncludeRows) {
            if (!candidate.expectedRequirement) {
                throw new Error(
                    `Missing typed must-include requirement for ${candidate.sourceId}`,
                );
            }
            const key = `${candidate.expectedRequirement.role}:${candidate.expectedRequirement.eventKey}`;
            const candidates = obligations.get(key) ?? [];
            candidates.push(candidate.sourceId);
            obligations.set(key, candidates);
        }
        mustIncludeCandidates += mustIncludeRows.length;
        includedMustIncludeCandidates += mustIncludeRows.filter(
            ({ sourceId }) => recommendedIds.has(sourceId),
        ).length;
        mustInclude += obligations.size;
        includedMustInclude += [...obligations.values()].filter((sourceIds) =>
            sourceIds.some((sourceId) => recommendedIds.has(sourceId)),
        ).length;
        const metadataTriageRows = pool.candidates.filter(
            ({ expectedMetadataTriage }) =>
                expectedMetadataTriage !== undefined,
        );
        metadataTriageObligations += metadataTriageRows.length;
        satisfiedMetadataTriageObligations += metadataTriageRows.filter(
            ({ sourceId }) => {
                const item = result.items.find(
                    (candidate) => candidate.sourceId === sourceId,
                );
                return (
                    item?.disposition === "recommended" &&
                    item.companyLinkageBasis === "discovery_metadata"
                );
            },
        ).length;
        for (const item of recommendedItems) {
            const expected = expectedById.get(item.sourceId);
            if (!expected) continue;
            if (expected.expectedEligibility === "must_exclude") {
                forbiddenRecommendations += 1;
            } else {
                truePositiveRecommendations += 1;
            }
            if (
                item.coverageContributions.length === 0 &&
                item.recommendationContributions.length === 0
            ) {
                recommendationsWithoutContribution += 1;
            }
            if (item.duplicateOfSourceId) {
                duplicateRecommendations += 1;
            }
        }
    }

    return {
        recommended,
        truePositiveRecommendations,
        mustIncludeObligations: mustInclude,
        satisfiedMustIncludeObligations: includedMustInclude,
        mustIncludeCandidates,
        includedMustIncludeCandidates,
        mustInclude,
        includedMustInclude,
        metadataTriageObligations,
        satisfiedMetadataTriageObligations,
        forbiddenRecommendations,
        recommendationsWithoutContribution,
        duplicateRecommendations,
        classificationMismatches,
        maximumNeedsAttention,
        precision:
            recommended === 0 ? 1 : truePositiveRecommendations / recommended,
        mustIncludeRecall:
            mustInclude === 0 ? 1 : includedMustInclude / mustInclude,
        mustIncludeCandidateRecall:
            mustIncludeCandidates === 0
                ? 1
                : includedMustIncludeCandidates / mustIncludeCandidates,
        metadataTriageRecall:
            metadataTriageObligations === 0
                ? 1
                : satisfiedMetadataTriageObligations /
                  metadataTriageObligations,
    };
}
