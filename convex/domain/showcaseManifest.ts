import type {
    ClaimClassification,
    EvidenceRelation,
} from "@convex/domain/claims";
import {
    claimClassificationValidator,
    evidenceRelationValidator,
} from "@convex/domain/claims";
import type { AssessmentDimensionKey } from "@convex/domain/researchPlan";
import { assessmentDimensionKeyValidator } from "@convex/domain/researchPlan";
import { v } from "convex/values";
import { sha256Hex, type SourceLocator } from "@convex/domain/sourcePassages";

export const CLAIM_SCHEMA_VERSION = "claim-v1";
export const SHOWCASE_ADAPTER_VERSION = "showcase-adapter-v1";
export const SHOWCASE_FIXTURE_VERSION = "ccc-showcase-v1";

export type NormalizedQuestionInput = {
    questionKey: string;
    prompt: string;
    dimensionKeys: AssessmentDimensionKey[];
};

export type NormalizedPassageInput = {
    sourceId: string;
    sourceVersionHash: string;
    passageOrder: number;
    quotationHash: string;
    passageKey: string;
    exactQuotation: string;
    locator: SourceLocator;
};

export type NormalizedClaimInput = {
    corpusRevisionId: string;
    schemaVersion: string;
    adapterVersion: string;
    questions: NormalizedQuestionInput[];
    passages: NormalizedPassageInput[];
};

export type ShowcaseClaimEvidenceOutput = {
    quotationHash: string;
    passageKey: string;
    sourceVersionHash?: string;
    relation: EvidenceRelation;
};

export const showcaseClaimEvidenceOutputValidator = v.object({
    quotationHash: v.string(),
    passageKey: v.string(),
    sourceVersionHash: v.optional(v.string()),
    relation: evidenceRelationValidator,
});

export type ShowcaseClaimDimensionLinkOutput = {
    dimensionKey: AssessmentDimensionKey;
    rationale?: string;
};

export const showcaseClaimDimensionLinkOutputValidator = v.object({
    dimensionKey: assessmentDimensionKeyValidator,
    rationale: v.optional(v.string()),
});

export type ShowcaseClaimOutput = {
    statement: string;
    classification: ClaimClassification;
    evidence: ShowcaseClaimEvidenceOutput[];
    dimensionLinks: ShowcaseClaimDimensionLinkOutput[];
    /** For Unknown claims: the question key this claim addresses */
    questionKey?: string;
};

export const showcaseClaimOutputValidator = v.object({
    statement: v.string(),
    classification: claimClassificationValidator,
    evidence: v.array(showcaseClaimEvidenceOutputValidator),
    dimensionLinks: v.array(showcaseClaimDimensionLinkOutputValidator),
    questionKey: v.optional(v.string()),
});

export type ShowcaseManifestEntry = {
    fixtureId: string;
    fixtureVersion: string;
    schemaVersion: string;
    adapterVersion: string;
    inputHash: string;
    claims: ShowcaseClaimOutput[];
};

/**
 * Deterministically serializes and hashes the complete normalized claim input.
 * Any single byte change across questions, passages, locators, quotations,
 * or corpus revision identity will produce a completely different hash.
 */
export function computeClaimInputHash(input: NormalizedClaimInput): string {
    // Sort questions deterministically by questionKey
    const sortedQuestions = [...input.questions]
        .sort((a, b) => a.questionKey.localeCompare(b.questionKey))
        .map((q) => ({
            questionKey: q.questionKey,
            prompt: q.prompt,
            dimensionKeys: [...q.dimensionKeys].sort(),
        }));

    // Sort passages deterministically by sourceId then passageOrder
    const sortedPassages = [...input.passages]
        .sort((a, b) => {
            const cmp = a.sourceId.localeCompare(b.sourceId);
            if (cmp !== 0) return cmp;
            return a.passageOrder - b.passageOrder;
        })
        .map((p) => ({
            sourceId: p.sourceId,
            sourceVersionHash: p.sourceVersionHash,
            passageOrder: p.passageOrder,
            quotationHash: p.quotationHash,
            passageKey: p.passageKey,
            exactQuotation: p.exactQuotation,
            locator: p.locator,
        }));

    const canonicalObject = {
        corpusRevisionId: input.corpusRevisionId,
        schemaVersion: input.schemaVersion,
        adapterVersion: input.adapterVersion,
        questions: sortedQuestions,
        passages: sortedPassages,
    };

    const serialized = JSON.stringify(canonicalObject);
    return sha256Hex(serialized);
}

// In-memory test/showcase registry
const showcaseManifestRegistry = new Map<string, ShowcaseManifestEntry>();

/**
 * Deep-clones and deep-freezes a manifest entry so later caller mutation cannot
 * alter the registered manifest. Performs version identity validation.
 */
export function freezeShowcaseManifestEntry(
    entry: ShowcaseManifestEntry,
): ShowcaseManifestEntry {
    if (entry.schemaVersion !== CLAIM_SCHEMA_VERSION) {
        throw new Error(
            `Manifest schemaVersion "${entry.schemaVersion}" does not match current CLAIM_SCHEMA_VERSION "${CLAIM_SCHEMA_VERSION}"`,
        );
    }
    if (entry.adapterVersion !== SHOWCASE_ADAPTER_VERSION) {
        throw new Error(
            `Manifest adapterVersion "${entry.adapterVersion}" does not match current SHOWCASE_ADAPTER_VERSION "${SHOWCASE_ADAPTER_VERSION}"`,
        );
    }
    if (entry.fixtureVersion !== SHOWCASE_FIXTURE_VERSION) {
        throw new Error(
            `Manifest fixtureVersion "${entry.fixtureVersion}" does not match current SHOWCASE_FIXTURE_VERSION "${SHOWCASE_FIXTURE_VERSION}"`,
        );
    }
    const cloned = JSON.parse(JSON.stringify(entry)) as ShowcaseManifestEntry;
    deepFreeze(cloned);
    return cloned;
}

function manifestPayloadForComparison(
    entry: ShowcaseManifestEntry,
): Pick<
    ShowcaseManifestEntry,
    | "fixtureId"
    | "fixtureVersion"
    | "schemaVersion"
    | "adapterVersion"
    | "claims"
> {
    return {
        fixtureId: entry.fixtureId,
        fixtureVersion: entry.fixtureVersion,
        schemaVersion: entry.schemaVersion,
        adapterVersion: entry.adapterVersion,
        claims: entry.claims,
    };
}

export function manifestsAreByteEquivalent(
    left: ShowcaseManifestEntry,
    right: ShowcaseManifestEntry,
): boolean {
    return (
        JSON.stringify(manifestPayloadForComparison(left)) ===
        JSON.stringify(manifestPayloadForComparison(right))
    );
}

function deepFreeze<T>(obj: T): T {
    Object.freeze(obj);
    for (const value of Object.values(obj as Record<string, unknown>)) {
        if (
            value !== null &&
            typeof value === "object" &&
            !Object.isFrozen(value)
        ) {
            deepFreeze(value);
        }
    }
    return obj;
}

export function registerShowcaseManifest(entry: ShowcaseManifestEntry): void {
    const frozen = freezeShowcaseManifestEntry(entry);
    const existing = showcaseManifestRegistry.get(frozen.inputHash);
    if (existing) {
        if (!manifestsAreByteEquivalent(existing, frozen)) {
            throw new Error(
                "Attempted to mutate immutable showcase manifest entry for existing input hash",
            );
        }
        return;
    }
    showcaseManifestRegistry.set(frozen.inputHash, frozen);
}

export function lookupShowcaseManifest(
    inputHash: string,
): ShowcaseManifestEntry | null {
    return showcaseManifestRegistry.get(inputHash) ?? null;
}

export function clearShowcaseManifests(): void {
    showcaseManifestRegistry.clear();
}
