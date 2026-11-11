import {
    CLAIM_CLASSIFICATIONS,
    EVIDENCE_RELATIONS,
} from "@convex/domain/claims";
import {
    ASSESSMENT_DIMENSION_KEYS,
    type AssessmentDimensionKey,
} from "@convex/domain/researchPlan";
import {
    CLAIM_SCHEMA_VERSION,
    computeClaimInputHash,
    lookupShowcaseManifest,
    type NormalizedClaimInput,
    SHOWCASE_ADAPTER_VERSION,
    SHOWCASE_FIXTURE_VERSION,
    type ShowcaseClaimOutput,
    type ShowcaseManifestEntry,
} from "@convex/domain/showcaseManifest";
import {
    MAX_CLAIM_RATIONALE_CHARS,
    MAX_CLAIM_STATEMENT_CHARS,
    MAX_CLAIMS_PER_RUN,
    MAX_DIMENSION_LINKS_PER_CLAIM,
    MAX_EVIDENCE_PER_CLAIM,
} from "@convex/resourcePolicy";

export type ShowcaseClaimAdapterSuccess = {
    status: "success";
    fixtureId: string;
    fixtureVersion: string;
    schemaVersion: string;
    adapterVersion: string;
    claims: ShowcaseClaimOutput[];
};

export type ShowcaseClaimAdapterUnavailable = {
    status: "unavailable";
    reason: string;
};

export type ShowcaseClaimAdapterResult =
    | ShowcaseClaimAdapterSuccess
    | ShowcaseClaimAdapterUnavailable;

/**
 * Executes deterministic showcase claim extraction against a resolved manifest
 * entry. Performs zero external I/O and creates zero ProviderCalls. The caller
 * already confirmed the exact input hash; the entry is revalidated here so a
 * durable or in-memory entry can never bypass the version/hash/claims gate.
 */
export function executeShowcaseClaimExtractionFromManifest(args: {
    manifest: ShowcaseManifestEntry | null | undefined;
    normalizedInput: NormalizedClaimInput;
}): ShowcaseClaimAdapterResult {
    const entry: ShowcaseManifestEntry | null = args.manifest ?? null;
    if (!entry) {
        return {
            status: "unavailable",
            reason: "unknown_input_hash",
        };
    }

    // Recompute normalized input hash to verify manifest entry integrity
    const recomputedHash = computeClaimInputHash(args.normalizedInput);
    if (recomputedHash !== entry.inputHash) {
        throw new Error(
            "Showcase manifest entry inputHash does not match recomputed hash from normalized input",
        );
    }

    // Require current schema/adapter/fixture versions
    if (entry.schemaVersion !== CLAIM_SCHEMA_VERSION) {
        throw new Error(
            `Showcase manifest schemaVersion "${entry.schemaVersion}" does not match current "${CLAIM_SCHEMA_VERSION}"`,
        );
    }
    if (entry.adapterVersion !== SHOWCASE_ADAPTER_VERSION) {
        throw new Error(
            `Showcase manifest adapterVersion "${entry.adapterVersion}" does not match current "${SHOWCASE_ADAPTER_VERSION}"`,
        );
    }
    if (entry.fixtureVersion !== SHOWCASE_FIXTURE_VERSION) {
        throw new Error(
            `Showcase manifest fixtureVersion "${entry.fixtureVersion}" does not match current "${SHOWCASE_FIXTURE_VERSION}"`,
        );
    }

    // Validate fixture outputs strictly
    if (!Array.isArray(entry.claims) || entry.claims.length === 0) {
        throw new Error("Showcase manifest contains no claims");
    }

    if (entry.claims.length > MAX_CLAIMS_PER_RUN) {
        throw new Error(
            `Showcase manifest exceeds MAX_CLAIMS_PER_RUN (${MAX_CLAIMS_PER_RUN})`,
        );
    }

    for (const [index, claim] of entry.claims.entries()) {
        if (
            !claim.statement ||
            claim.statement.trim().length === 0 ||
            claim.statement.length > MAX_CLAIM_STATEMENT_CHARS
        ) {
            throw new Error(
                `Showcase claim at index ${index} has invalid statement length`,
            );
        }

        if (!CLAIM_CLASSIFICATIONS.includes(claim.classification)) {
            throw new Error(
                `Showcase claim at index ${index} has invalid classification "${claim.classification}"`,
            );
        }

        if (!Array.isArray(claim.evidence) || claim.evidence.length === 0) {
            throw new Error(
                `Showcase claim at index ${index} must have at least one evidence passage`,
            );
        }

        if (claim.evidence.length > MAX_EVIDENCE_PER_CLAIM) {
            throw new Error(
                `Showcase claim at index ${index} exceeds MAX_EVIDENCE_PER_CLAIM (${MAX_EVIDENCE_PER_CLAIM})`,
            );
        }

        for (const [evIdx, ev] of claim.evidence.entries()) {
            if (!ev.quotationHash || ev.quotationHash.trim().length === 0) {
                throw new Error(
                    `Showcase claim ${index} evidence ${evIdx} is missing quotationHash`,
                );
            }
            if (!ev.passageKey || ev.passageKey.trim().length === 0) {
                throw new Error(
                    `Showcase claim ${index} evidence ${evIdx} is missing passageKey`,
                );
            }
            if (!EVIDENCE_RELATIONS.includes(ev.relation)) {
                throw new Error(
                    `Showcase claim ${index} evidence ${evIdx} has invalid relation "${ev.relation}"`,
                );
            }
        }

        if (Array.isArray(claim.dimensionLinks)) {
            if (claim.dimensionLinks.length > MAX_DIMENSION_LINKS_PER_CLAIM) {
                throw new Error(
                    `Showcase claim ${index} exceeds MAX_DIMENSION_LINKS_PER_CLAIM (${MAX_DIMENSION_LINKS_PER_CLAIM})`,
                );
            }

            for (const [linkIdx, link] of claim.dimensionLinks.entries()) {
                if (
                    !ASSESSMENT_DIMENSION_KEYS.includes(
                        link.dimensionKey as AssessmentDimensionKey,
                    )
                ) {
                    throw new Error(
                        `Showcase claim ${index} link ${linkIdx} has invalid dimensionKey "${link.dimensionKey}"`,
                    );
                }
                if (
                    link.rationale &&
                    link.rationale.length > MAX_CLAIM_RATIONALE_CHARS
                ) {
                    throw new Error(
                        `Showcase claim ${index} link ${linkIdx} rationale exceeds MAX_CLAIM_RATIONALE_CHARS`,
                    );
                }
            }
        }
    }

    return {
        status: "success",
        fixtureId: entry.fixtureId,
        fixtureVersion: entry.fixtureVersion,
        schemaVersion: entry.schemaVersion,
        adapterVersion: entry.adapterVersion,
        claims: entry.claims,
    };
}

/**
 * Executes deterministic showcase claim extraction against the in-memory
 * registry. Performs zero external I/O and creates zero I/O, and refuses any
 * input hash not registered in the showcase manifest.
 */
export function executeShowcaseClaimExtraction(args: {
    inputHash: string;
    normalizedInput: NormalizedClaimInput;
}): ShowcaseClaimAdapterResult {
    const entry: ShowcaseManifestEntry | null = lookupShowcaseManifest(
        args.inputHash,
    );
    if (!entry) {
        return {
            status: "unavailable",
            reason: "unknown_input_hash",
        };
    }
    return executeShowcaseClaimExtractionFromManifest({
        manifest: entry,
        normalizedInput: args.normalizedInput,
    });
}
