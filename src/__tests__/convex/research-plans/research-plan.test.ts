import {
    ASSESSMENT_DIMENSION_KEYS,
    buildResearchPlan,
    buildResearchPlanQuestions,
} from "@convex/domain/researchPlan";
import { describe, expect, test } from "vitest";

describe("buildResearchPlan", () => {
    test.each([
        "balanced",
        "first_party_depth",
        "independent_scrutiny",
    ] as const)("keeps direct SEC discovery separate from web discovery for %s", (coveragePreset) => {
        const plan = buildResearchPlan({
            company: {
                legalName: "CCC Intelligent Solutions Holdings Inc.",
                ticker: "CCCS",
                websiteUrl: "https://www.cccis.com/",
                investorRelationsUrl: "https://ir.cccis.com/",
            },
            coveragePreset,
            researchAngle: "claims workflow control",
        });

        expect(
            plan.queries.map(({ category }) => category).includes("regulatory"),
        ).toBe(false);
        expect(
            plan.queries.map(({ discoveryIntent }) => discoveryIntent),
        ).toEqual(
            expect.arrayContaining(["official_product", "counter_evidence"]),
        );
        expect(
            plan.queries.find(
                ({ discoveryIntent }) => discoveryIntent === "official_product",
            ),
        ).toMatchObject({ includeDomains: ["cccis.com"] });
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

describe("buildResearchPlanQuestions", () => {
    test("builds locked prompt text and dimension keys for 10 dimensions", () => {
        const questions = buildResearchPlanQuestions({
            company: { legalName: "ServiceNow, Inc." },
        });
        expect(questions).toHaveLength(10);
        expect(questions.map((q) => q.questionKey)).toEqual(
            ASSESSMENT_DIMENSION_KEYS.map((k) => `dimension:${k}`),
        );
        for (const q of questions) {
            expect(q.dimensionKeys).toHaveLength(1);
            expect(q.prompt).toMatch(
                /^What public evidence supports or challenges .+ for ServiceNow, Inc\.\?$/,
            );
        }
    });

    test("builds locked research-angle prompt without company name or quotes", () => {
        const questions = buildResearchPlanQuestions({
            company: { legalName: "ServiceNow, Inc." },
            researchAngle: "agentic revenue",
        });
        expect(questions).toHaveLength(11);
        const angleQ = questions.find(
            (q) => q.questionKey === "research-angle",
        );
        expect(angleQ).toEqual({
            questionKey: "research-angle",
            prompt: "What public evidence addresses this research focus: agentic revenue?",
            dimensionKeys: ASSESSMENT_DIMENSION_KEYS,
        });
    });
});
