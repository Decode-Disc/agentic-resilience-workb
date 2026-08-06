import {
    ASSESSMENT_DIMENSION_KEYS,
    buildResearchPlan,
} from "@convex/domain/researchPlan";
import { describe, expect, test } from "vitest";

describe("buildResearchPlan", () => {
    test.each([
        "balanced",
        "first_party_depth",
        "independent_scrutiny",
    ] as const)("keeps regulatory and counter-evidence coverage for %s", (coveragePreset) => {
        const plan = buildResearchPlan({
            company: {
                legalName: "CCC Intelligent Solutions Holdings Inc.",
                ticker: "CCCS",
            },
            coveragePreset,
            researchAngle: "claims workflow control",
        });

        expect(plan.queries.map(({ category }) => category)).toEqual(
            expect.arrayContaining(["regulatory", "counter_evidence"]),
        );
        expect(
            new Set(plan.queries.flatMap(({ dimensionKeys }) => dimensionKeys)),
        ).toEqual(new Set(ASSESSMENT_DIMENSION_KEYS));
        expect(
            plan.queries.every(({ query }) =>
                query.includes("claims workflow control"),
            ),
        ).toBe(true);
    });

    test("changes bounded depth by coverage preset", () => {
        const input = {
            company: {
                legalName: "CCC Intelligent Solutions Holdings Inc.",
                ticker: "CCCS",
            },
        };
        const balanced = buildResearchPlan({
            ...input,
            coveragePreset: "balanced",
        });
        const firstParty = buildResearchPlan({
            ...input,
            coveragePreset: "first_party_depth",
        });
        const independent = buildResearchPlan({
            ...input,
            coveragePreset: "independent_scrutiny",
        });

        expect(firstParty.queries.length).toBeGreaterThan(
            balanced.queries.length,
        );
        expect(independent.queries.length).toBeGreaterThan(
            balanced.queries.length,
        );
    });
});
