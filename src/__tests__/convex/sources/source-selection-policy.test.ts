import { buildSourceSelectionProposal } from "@convex/domain/sourceSelectionPolicy";
import { describe, expect, test } from "vitest";

const candidate = (
    sourceId: string,
    overrides: Partial<
        Parameters<typeof buildSourceSelectionProposal>[0]["candidates"][number]
    > = {},
) => ({
    sourceId,
    canonicalUrl: `https://${sourceId}.example.com/report`,
    title: `${sourceId} source`,
    origin: "exa" as const,
    category: "independent_analysis",
    providerResultPosition: 0,
    discoveryQueryIndex: 0,
    createdAt: 1,
    ...overrides,
});

describe("buildSourceSelectionProposal", () => {
    test("covers each available balanced family before filling the target", () => {
        const result = buildSourceSelectionProposal({
            coveragePreset: "balanced",
            target: 5,
            candidates: [
                candidate("regulatory-older", {
                    category: "regulatory",
                    publishedAt: 10,
                    providerResultPosition: 1,
                }),
                candidate("regulatory-best", {
                    category: "regulatory",
                    publishedAt: 20,
                    providerResultPosition: 0,
                }),
                candidate("investor", { category: "investor_relations" }),
                candidate("product", { category: "official_product" }),
                candidate("commercial", { category: "official_commercial" }),
                candidate("counter", { category: "counter_evidence" }),
                candidate("extra", { category: "independent_analysis" }),
            ],
        });

        expect(
            result.items
                .filter(({ disposition }) => disposition === "recommended")
                .map(({ sourceId }) => sourceId),
        ).toEqual([
            "regulatory-best",
            "investor",
            "product",
            "commercial",
            "counter",
        ]);
        expect(result.gaps).toEqual([]);
        expect(result.counts).toEqual({
            recommended: 5,
            needsAttention: 0,
            alternative: 2,
        });
    });

    test("recommends analyst sources first and counts them toward the target", () => {
        const result = buildSourceSelectionProposal({
            coveragePreset: "balanced",
            target: 2,
            candidates: [
                candidate("analyst", {
                    origin: "analyst_url",
                    category: "analyst_supplied",
                    providerResultPosition: undefined,
                    discoveryQueryIndex: undefined,
                }),
                candidate("regulatory", { category: "regulatory" }),
                candidate("counter", { category: "counter_evidence" }),
            ],
        });

        expect(result.items[0]).toMatchObject({
            sourceId: "analyst",
            disposition: "recommended",
            reasonCodes: ["added_by_analyst"],
        });
        expect(
            result.items.filter(
                ({ disposition }) => disposition === "recommended",
            ),
        ).toHaveLength(2);
    });

    test("does not recommend weak metadata merely to reach the target", () => {
        const result = buildSourceSelectionProposal({
            coveragePreset: "balanced",
            target: 12,
            candidates: [
                candidate("unknown", {
                    category: "unrecognized",
                    providerResultPosition: undefined,
                    discoveryQueryIndex: undefined,
                }),
            ],
        });

        expect(result.items).toEqual([
            expect.objectContaining({
                sourceId: "unknown",
                disposition: "needs_attention",
                reasonCodes: ["unrecognized_source_family"],
            }),
        ]);
        expect(result.counts.recommended).toBe(0);
        expect(result.gaps).toEqual([
            "regulatory",
            "investor_relations",
            "official_product",
            "official_commercial",
            "counter_evidence",
        ]);
    });

    test("uses research-angle relevance only as a stable tie breaker", () => {
        const result = buildSourceSelectionProposal({
            coveragePreset: "independent_scrutiny",
            researchAngle: "workflow migration",
            target: 1,
            candidates: [
                candidate("generic", {
                    title: "Independent company analysis",
                }),
                candidate("angle-match", {
                    title: "Workflow migration analysis",
                }),
            ],
        });

        expect(result.items[0]).toMatchObject({
            sourceId: "angle-match",
            disposition: "recommended",
        });
    });

    test("prefers a new publisher when filling beyond required families", () => {
        const result = buildSourceSelectionProposal({
            coveragePreset: "balanced",
            target: 2,
            candidates: [
                candidate("regulatory", {
                    canonicalUrl: "https://primary.example.com/filing",
                    category: "regulatory",
                }),
                candidate("same-publisher", {
                    canonicalUrl: "https://primary.example.com/analysis",
                    providerResultPosition: 0,
                }),
                candidate("diverse-publisher", {
                    canonicalUrl: "https://independent.example.com/analysis",
                    providerResultPosition: 1,
                }),
            ],
        });

        expect(
            result.items
                .filter(({ disposition }) => disposition === "recommended")
                .map(({ sourceId }) => sourceId),
        ).toEqual(["regulatory", "diverse-publisher"]);
    });
});
