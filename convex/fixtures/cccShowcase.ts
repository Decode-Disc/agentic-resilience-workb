import {
    CLAIM_SCHEMA_VERSION,
    SHOWCASE_ADAPTER_VERSION,
    SHOWCASE_FIXTURE_VERSION,
    computeClaimInputHash,
    registerShowcaseManifest,
    type NormalizedClaimInput,
    type ShowcaseClaimOutput,
    type ShowcaseManifestEntry,
} from "@convex/domain/showcaseManifest";

export const CCC_SHOWCASE_FIXTURE_ID = "ccc-showcase-claims";

/**
 * Builds the deterministic CCC showcase manifest from the run's normalized
 * claim input. Claims reference committed passages by quotation hash and
 * passage key, so a fixture can only ever produce claims over the exact
 * passages the workflow committed. Shared by the convex fixture seed and the
 * convexTest showcase fixture so the deployable and test sources stay one.
 */
export function buildCccShowcaseManifest(
    normalizedInput: NormalizedClaimInput,
): ShowcaseManifestEntry {
    const inputHash = computeClaimInputHash(normalizedInput);

    // Map quotation hashes and passage keys from normalized passages
    const p0 = normalizedInput.passages[0]?.quotationHash ?? "hash_0";
    const p1 = normalizedInput.passages[1]?.quotationHash ?? "hash_1";
    const p2 = normalizedInput.passages[2]?.quotationHash ?? "hash_2";
    const p3 = normalizedInput.passages[3]?.quotationHash ?? "hash_3";
    const k0 = normalizedInput.passages[0]?.passageKey ?? "key_0";
    const k1 = normalizedInput.passages[1]?.passageKey ?? "key_1";
    const k2 = normalizedInput.passages[2]?.passageKey ?? "key_2";
    const k3 = normalizedInput.passages[3]?.passageKey ?? "key_3";

    const claims: ShowcaseClaimOutput[] = [
        {
            statement:
                "CCC connects approximately 30,000 repair facilities and 300+ insurance carriers across its workflow network.",
            classification: "Fact",
            evidence: [
                {
                    quotationHash: p0,
                    passageKey: k0,
                    sourceVersionHash:
                        normalizedInput.passages[0]?.sourceVersionHash,
                    relation: "supporting",
                },
            ],
            dimensionLinks: [
                {
                    dimensionKey: "workflow_control",
                    rationale:
                        "Deep bi-directional network integration across carriers and collision repairers.",
                },
                {
                    dimensionKey: "switching_costs",
                    rationale:
                        "Mission-critical shop and carrier embedded workflow systems create high operational friction to replace.",
                },
            ],
        },
        {
            statement:
                "CCC processes over 28 million claims annually, capturing the majority of US auto physical damage claim volumes.",
            classification: "Fact",
            evidence: [
                {
                    quotationHash: p1,
                    passageKey: k1,
                    sourceVersionHash:
                        normalizedInput.passages[1]?.sourceVersionHash,
                    relation: "supporting",
                },
            ],
            dimensionLinks: [
                {
                    dimensionKey: "data_defensibility",
                    rationale:
                        "Proprietary historical claims database and repair logic accumulated over decades of transactions.",
                },
            ],
        },
        {
            statement:
                "Emerging OEM-direct telematics and alternative platform integrations may present long-term disintermediation pressure on traditional repair routing.",
            classification: "Hypothesis",
            evidence: [
                {
                    quotationHash: p2,
                    passageKey: k2,
                    sourceVersionHash:
                        normalizedInput.passages[2]?.sourceVersionHash,
                    relation: "counter",
                },
            ],
            dimensionLinks: [
                {
                    dimensionKey: "abstraction_exposure",
                    rationale:
                        "Potential upstream vehicle data capture by automotive OEMs.",
                },
            ],
        },
        {
            statement:
                "Adoption velocity of third-party multi-modal foundation models versus proprietary estimating logic remains undetermined.",
            classification: "Unknown",
            evidence: [
                {
                    quotationHash: p3,
                    passageKey: k3,
                    sourceVersionHash:
                        normalizedInput.passages[3]?.sourceVersionHash,
                    relation: "context",
                },
            ],
            dimensionLinks: [
                {
                    dimensionKey: "model_platform_dependency",
                    rationale:
                        "Uncertainty around foundational AI dependencies versus in-house machine learning models.",
                },
            ],
            questionKey: "dimension:model_platform_dependency",
        },
    ];

    return {
        fixtureId: CCC_SHOWCASE_FIXTURE_ID,
        fixtureVersion: SHOWCASE_FIXTURE_VERSION,
        schemaVersion: CLAIM_SCHEMA_VERSION,
        adapterVersion: SHOWCASE_ADAPTER_VERSION,
        inputHash,
        claims,
    };
}

export function registerCccShowcaseFixture(
    normalizedInput: NormalizedClaimInput,
): ShowcaseManifestEntry {
    const entry = buildCccShowcaseManifest(normalizedInput);
    registerShowcaseManifest(entry);
    return entry;
}
