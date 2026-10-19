import type { Id } from "@convex/_generated/dataModel";
import type {
    ClaimClassification,
    EvidenceRelation,
} from "@convex/domain/claims";
import type { AssessmentDimensionKey } from "@convex/domain/researchPlan";

export type RawEvidenceInput = {
    sourcePassageId: Id<"sourcePassages">;
    relation: EvidenceRelation;
};

export type RawDimensionLinkInput = {
    dimensionKey: AssessmentDimensionKey;
    rationale?: string;
};

export type RawClaimInput = {
    statement: string;
    classification: ClaimClassification;
    evidence: RawEvidenceInput[];
    dimensionLinks: RawDimensionLinkInput[];
};

export type CanonicalClaim = {
    statement: string;
    canonicalText: string;
    classification: ClaimClassification;
    evidence: RawEvidenceInput[];
    dimensionLinks: RawDimensionLinkInput[];
};

/**
 * Normalizes atomic claim statement text for exact canonical comparison.
 * Applies Unicode NFKC normalization, lowercase conversion, and whitespace collapsing.
 */
export function normalizeCanonicalText(text: string): string {
    return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Groups raw claims into canonical claims.
 * Conservative canonicalization: merges ONLY claims with exact equal normalized canonical text
 * AND equal classification.
 * Semantic near-duplicates or claims with different classifications remain separate.
 */
export function groupClaimsForCanonicalization(
    rawClaims: RawClaimInput[],
): CanonicalClaim[] {
    const groups = new Map<string, CanonicalClaim>();

    for (const raw of rawClaims) {
        const canonicalText = normalizeCanonicalText(raw.statement);
        const groupKey = `${canonicalText}:::${raw.classification}`;

        const existing = groups.get(groupKey);
        if (!existing) {
            // New canonical group
            const seenEvidence = new Set<string>();
            const uniqueEvidence: RawEvidenceInput[] = [];
            for (const ev of raw.evidence) {
                const evKey = `${ev.sourcePassageId}:::${ev.relation}`;
                if (!seenEvidence.has(evKey)) {
                    seenEvidence.add(evKey);
                    uniqueEvidence.push(ev);
                }
            }

            const seenDimensions = new Set<string>();
            const uniqueLinks: RawDimensionLinkInput[] = [];
            for (const link of raw.dimensionLinks) {
                if (!seenDimensions.has(link.dimensionKey)) {
                    seenDimensions.add(link.dimensionKey);
                    uniqueLinks.push(link);
                }
            }

            groups.set(groupKey, {
                statement: raw.statement.trim(),
                canonicalText,
                classification: raw.classification,
                evidence: uniqueEvidence,
                dimensionLinks: uniqueLinks,
            });
        } else {
            // Merge into existing group
            const seenEvidence = new Set(
                existing.evidence.map(
                    (e) => `${e.sourcePassageId}:::${e.relation}`,
                ),
            );
            for (const ev of raw.evidence) {
                const evKey = `${ev.sourcePassageId}:::${ev.relation}`;
                if (!seenEvidence.has(evKey)) {
                    seenEvidence.add(evKey);
                    existing.evidence.push(ev);
                }
            }

            const seenDimensions = new Set(
                existing.dimensionLinks.map((l) => l.dimensionKey),
            );
            for (const link of raw.dimensionLinks) {
                if (!seenDimensions.has(link.dimensionKey)) {
                    seenDimensions.add(link.dimensionKey);
                    existing.dimensionLinks.push(link);
                }
            }
        }
    }

    return Array.from(groups.values());
}
