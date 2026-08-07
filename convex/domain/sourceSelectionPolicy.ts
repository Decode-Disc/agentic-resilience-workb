import type { CoveragePreset } from "@convex/domain/researchPlan";

export const SOURCE_SELECTION_POLICY_VERSION = "source-selection-v1";

export const SOURCE_FAMILIES = [
    "regulatory",
    "investor_relations",
    "official_product",
    "official_commercial",
    "counter_evidence",
    "official_security",
    "independent_analysis",
] as const;

export type SourceFamily = (typeof SOURCE_FAMILIES)[number];
export type SourceSelectionDisposition =
    | "recommended"
    | "needs_attention"
    | "alternative";
export type SourceSelectionReasonCode =
    | "added_by_analyst"
    | "required_family_coverage"
    | "ranked_fill"
    | "unrecognized_source_family"
    | "not_selected";

export type SourceSelectionCandidate = {
    sourceId: string;
    canonicalUrl: string;
    title: string;
    origin: "sec" | "exa" | "analyst_url";
    category: string;
    publishedAt?: number;
    providerResultPosition?: number;
    discoveryQueryIndex?: number;
    createdAt: number;
};

export type SourceSelectionProposalResult = {
    items: Array<{
        sourceId: string;
        disposition: SourceSelectionDisposition;
        sourceFamily: SourceFamily | "unrecognized" | "analyst_supplied";
        rank: number;
        reasonCodes: Array<SourceSelectionReasonCode>;
    }>;
    gaps: Array<SourceFamily>;
    counts: {
        recommended: number;
        needsAttention: number;
        alternative: number;
    };
};

const BALANCED_FAMILIES: ReadonlyArray<SourceFamily> = [
    "regulatory",
    "investor_relations",
    "official_product",
    "official_commercial",
    "counter_evidence",
];

const FAMILY_PRIORITY = new Map(
    SOURCE_FAMILIES.map((family, index) => [family, index]),
);

function requiredFamilies(preset: CoveragePreset): Array<SourceFamily> {
    if (preset === "first_party_depth") {
        return [...BALANCED_FAMILIES, "official_security"];
    }
    if (preset === "independent_scrutiny") {
        return [...BALANCED_FAMILIES, "independent_analysis"];
    }
    return [...BALANCED_FAMILIES];
}

function sourceFamily(
    candidate: SourceSelectionCandidate,
): SourceFamily | "unrecognized" | "analyst_supplied" {
    if (candidate.origin === "analyst_url") {
        return "analyst_supplied";
    }
    return SOURCE_FAMILIES.includes(candidate.category as SourceFamily)
        ? (candidate.category as SourceFamily)
        : "unrecognized";
}

function normalizedTokens(value: string | undefined): Set<string> {
    return new Set(
        (value ?? "")
            .toLocaleLowerCase("en")
            .split(/[^a-z0-9]+/)
            .filter((token) => token.length > 2),
    );
}

function angleMatchCount(title: string, angleTokens: Set<string>): number {
    const titleTokens = normalizedTokens(title);
    let matches = 0;
    for (const token of angleTokens) {
        if (titleTokens.has(token)) {
            matches += 1;
        }
    }
    return matches;
}

function publisherHost(canonicalUrl: string): string {
    return new URL(canonicalUrl).hostname.toLocaleLowerCase("en");
}

function compareCandidates(
    left: SourceSelectionCandidate,
    right: SourceSelectionCandidate,
    angleTokens: Set<string>,
): number {
    const familyDelta =
        (FAMILY_PRIORITY.get(sourceFamily(left) as SourceFamily) ?? 99) -
        (FAMILY_PRIORITY.get(sourceFamily(right) as SourceFamily) ?? 99);
    if (familyDelta !== 0) {
        return familyDelta;
    }
    const positionDelta =
        (left.providerResultPosition ?? Number.MAX_SAFE_INTEGER) -
        (right.providerResultPosition ?? Number.MAX_SAFE_INTEGER);
    if (positionDelta !== 0) {
        return positionDelta;
    }
    const recencyDelta = (right.publishedAt ?? 0) - (left.publishedAt ?? 0);
    if (recencyDelta !== 0) {
        return recencyDelta;
    }
    const angleDelta =
        angleMatchCount(right.title, angleTokens) -
        angleMatchCount(left.title, angleTokens);
    if (angleDelta !== 0) {
        return angleDelta;
    }
    const queryDelta =
        (left.discoveryQueryIndex ?? Number.MAX_SAFE_INTEGER) -
        (right.discoveryQueryIndex ?? Number.MAX_SAFE_INTEGER);
    if (queryDelta !== 0) {
        return queryDelta;
    }
    return left.sourceId.localeCompare(right.sourceId, "en");
}

export function buildSourceSelectionProposal(input: {
    candidates: ReadonlyArray<SourceSelectionCandidate>;
    coveragePreset: CoveragePreset;
    researchAngle?: string;
    target: number;
}): SourceSelectionProposalResult {
    const angleTokens = normalizedTokens(input.researchAngle);
    const candidates = [...input.candidates].sort((left, right) =>
        compareCandidates(left, right, angleTokens),
    );
    const selected = new Map<string, SourceSelectionReasonCode>();

    const analystSources = candidates
        .filter(({ origin }) => origin === "analyst_url")
        .sort((left, right) =>
            left.createdAt === right.createdAt
                ? left.sourceId.localeCompare(right.sourceId, "en")
                : left.createdAt - right.createdAt,
        );
    for (const candidate of analystSources) {
        selected.set(candidate.sourceId, "added_by_analyst");
    }

    const required = requiredFamilies(input.coveragePreset);
    const gaps: Array<SourceFamily> = [];
    for (const family of required) {
        const best = candidates.find(
            (candidate) =>
                sourceFamily(candidate) === family &&
                !selected.has(candidate.sourceId),
        );
        if (!best) {
            gaps.push(family);
            continue;
        }
        if (selected.size >= input.target) {
            gaps.push(family);
            continue;
        }
        selected.set(best.sourceId, "required_family_coverage");
    }

    const selectedPublishers = new Set(
        candidates
            .filter(({ sourceId }) => selected.has(sourceId))
            .map(({ canonicalUrl }) => publisherHost(canonicalUrl)),
    );
    while (selected.size < input.target) {
        const next = candidates
            .filter(
                (candidate) =>
                    !selected.has(candidate.sourceId) &&
                    sourceFamily(candidate) !== "unrecognized",
            )
            .sort((left, right) => {
                const diversityDelta =
                    Number(
                        selectedPublishers.has(
                            publisherHost(left.canonicalUrl),
                        ),
                    ) -
                    Number(
                        selectedPublishers.has(
                            publisherHost(right.canonicalUrl),
                        ),
                    );
                return (
                    diversityDelta ||
                    compareCandidates(left, right, angleTokens)
                );
            })[0];
        if (!next) {
            break;
        }
        selected.set(next.sourceId, "ranked_fill");
        selectedPublishers.add(publisherHost(next.canonicalUrl));
    }

    const selectedCandidates = candidates
        .filter(({ sourceId }) => selected.has(sourceId))
        .sort((left, right) => {
            const leftReason = selected.get(left.sourceId);
            const rightReason = selected.get(right.sourceId);
            if (
                leftReason === "added_by_analyst" &&
                rightReason !== "added_by_analyst"
            ) {
                return -1;
            }
            if (
                rightReason === "added_by_analyst" &&
                leftReason !== "added_by_analyst"
            ) {
                return 1;
            }
            return compareCandidates(left, right, angleTokens);
        });
    const alternatives = candidates.filter(
        ({ sourceId }) => !selected.has(sourceId),
    );
    const ordered = [...selectedCandidates, ...alternatives];
    const items = ordered.map((candidate, rank) => {
        const family = sourceFamily(candidate);
        const reason = selected.get(candidate.sourceId);
        if (reason) {
            return {
                sourceId: candidate.sourceId,
                disposition: "recommended" as const,
                sourceFamily: family,
                rank,
                reasonCodes: [reason],
            };
        }
        if (family === "unrecognized") {
            return {
                sourceId: candidate.sourceId,
                disposition: "needs_attention" as const,
                sourceFamily: family,
                rank,
                reasonCodes: ["unrecognized_source_family" as const],
            };
        }
        return {
            sourceId: candidate.sourceId,
            disposition: "alternative" as const,
            sourceFamily: family,
            rank,
            reasonCodes: ["not_selected" as const],
        };
    });

    return {
        items,
        gaps,
        counts: {
            recommended: items.filter(
                ({ disposition }) => disposition === "recommended",
            ).length,
            needsAttention: items.filter(
                ({ disposition }) => disposition === "needs_attention",
            ).length,
            alternative: items.filter(
                ({ disposition }) => disposition === "alternative",
            ).length,
        },
    };
}
