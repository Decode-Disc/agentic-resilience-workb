import {
    groupClaimsForCanonicalization,
    normalizeCanonicalText,
    type RawClaimInput,
} from "@convex/domain/claimCanonicalization";
import { describe, expect, test } from "vitest";

describe("Claim Canonicalization", () => {
    test("normalizes whitespace, unicode NFKC, and casing", () => {
        const text1 = "  ＣＣＣ  connects   ３０,０００+ repair facilities.  ";
        const text2 = "ccc connects 30,000+ repair facilities.";
        expect(normalizeCanonicalText(text1)).toBe(
            "ccc connects 30,000+ repair facilities.",
        );
        expect(normalizeCanonicalText(text1)).toBe(
            normalizeCanonicalText(text2),
        );
    });

    test("merges only exact equal normalized text with equal classification", () => {
        const rawClaims: RawClaimInput[] = [
            {
                statement: "CCC connects 30,000+ repair facilities.",
                classification: "Fact",
                evidence: [
                    {
                        sourcePassageId: "passage_1" as any,
                        relation: "supporting",
                    },
                ],
                dimensionLinks: [
                    {
                        dimensionKey: "network_effects" as any,
                        rationale: "Network scale",
                    },
                ],
            },
            {
                statement: "ｃｃｃ connects ３０,０００+ repair facilities. ",
                classification: "Fact",
                evidence: [
                    {
                        sourcePassageId: "passage_2" as any,
                        relation: "supporting",
                    },
                ],
                dimensionLinks: [
                    {
                        dimensionKey: "switching_costs" as any,
                        rationale: "Facility lock-in",
                    },
                ],
            },
        ];

        const canonical = groupClaimsForCanonicalization(rawClaims);
        expect(canonical).toHaveLength(1);
        const first = canonical[0];
        expect(first?.statement).toBe(
            "CCC connects 30,000+ repair facilities.",
        );
        expect(first?.classification).toBe("Fact");
        expect(first?.evidence).toHaveLength(2);
        expect(
            first?.evidence.map(
                (e: { sourcePassageId: string }) => e.sourcePassageId,
            ),
        ).toEqual(["passage_1", "passage_2"]);
        expect(first?.dimensionLinks).toHaveLength(2);
    });

    test("keeps same text with different classifications separate", () => {
        const rawClaims: RawClaimInput[] = [
            {
                statement:
                    "CCC has high pricing power across carrier accounts.",
                classification: "Fact",
                evidence: [
                    {
                        sourcePassageId: "passage_1" as any,
                        relation: "supporting",
                    },
                ],
                dimensionLinks: [],
            },
            {
                statement:
                    "CCC has high pricing power across carrier accounts.",
                classification: "Inference",
                evidence: [
                    {
                        sourcePassageId: "passage_2" as any,
                        relation: "supporting",
                    },
                ],
                dimensionLinks: [],
            },
        ];

        const canonical = groupClaimsForCanonicalization(rawClaims);
        expect(canonical).toHaveLength(2);
        expect(canonical[0]?.classification).toBe("Fact");
        expect(canonical[1]?.classification).toBe("Inference");
    });

    test("keeps semantic near-duplicates separate without merging", () => {
        const rawClaims: RawClaimInput[] = [
            {
                statement:
                    "CCC connects over 30,000 repair facilities in the US.",
                classification: "Fact",
                evidence: [
                    {
                        sourcePassageId: "passage_1" as any,
                        relation: "supporting",
                    },
                ],
                dimensionLinks: [],
            },
            {
                statement:
                    "CCC connects 30,000+ collision repair facilities nationwide.",
                classification: "Fact",
                evidence: [
                    {
                        sourcePassageId: "passage_2" as any,
                        relation: "supporting",
                    },
                ],
                dimensionLinks: [],
            },
        ];

        const canonical = groupClaimsForCanonicalization(rawClaims);
        expect(canonical).toHaveLength(2);
        expect(canonical[0]?.statement).toBe(
            "CCC connects over 30,000 repair facilities in the US.",
        );
        expect(canonical[1]?.statement).toBe(
            "CCC connects 30,000+ collision repair facilities nationwide.",
        );
    });

    test("deduplicates identical evidence and dimension links on merge", () => {
        const rawClaims: RawClaimInput[] = [
            {
                statement:
                    "CCC integrates directly with 300+ insurance carriers.",
                classification: "Fact",
                evidence: [
                    {
                        sourcePassageId: "passage_1" as any,
                        relation: "supporting",
                    },
                ],
                dimensionLinks: [
                    {
                        dimensionKey: "workflow_control" as any,
                        rationale: "Carrier integration",
                    },
                ],
            },
            {
                statement:
                    "CCC integrates directly with 300+ insurance carriers.",
                classification: "Fact",
                evidence: [
                    {
                        sourcePassageId: "passage_1" as any,
                        relation: "supporting",
                    },
                ],
                dimensionLinks: [
                    {
                        dimensionKey: "workflow_control" as any,
                        rationale: "Carrier integration",
                    },
                ],
            },
        ];

        const canonical = groupClaimsForCanonicalization(rawClaims);
        expect(canonical).toHaveLength(1);
        expect(canonical[0]?.evidence).toHaveLength(1);
        expect(canonical[0]?.dimensionLinks).toHaveLength(1);
    });
});
