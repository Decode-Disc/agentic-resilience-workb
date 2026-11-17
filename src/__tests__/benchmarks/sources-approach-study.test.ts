// @vitest-environment node
import assert from "node:assert/strict";
import { createQualificationResponseSchema } from "@convex/domain/sourceQualification";
import { expect, test } from "vitest";

const {
    createEvaluationQualificationSchema,
    SourcesPreparation,
    sourcesDigest,
    inspectionScenarioHash,
    qualificationCorrectionSchema,
} = (await import(
    new URL(
        "../../../scripts/evaluations/source-selection/sources-approach-study.ts",
        import.meta.url,
    ).href
)) as typeof import("@evaluations/source-selection/sources-approach-study");

function session() {
    const text =
        "Acme provides subscription services under these commercial terms. The customer pays the fees stated in an order form.";
    return new SourcesPreparation({
        id: "case",
        phase: "development",
        company: {
            cik: "123",
            legalName: "Acme",
            ticker: "ACME",
            websiteUrl: "https://acme.example",
        },
        asOfTime: Date.UTC(2026, 9, 25),
        researchAngle: "subscription terms",
        sources: [
            {
                candidate: {
                    sourceId: "terms",
                    title: "Acme subscription terms",
                    canonicalUrl:
                        "https://acme.example/legal/subscription-terms",
                    origin: "exa",
                    category: "commercial",
                    createdAt: 0,
                },
                text,
                contentHash: sourcesDigest(text),
            },
        ],
    });
}

function response() {
    const base = createQualificationResponseSchema([{ passageKey: "p0" }]);
    return {
        companyMatch: "subject",
        companyPassageKeys: ["p0"],
        documentKind: "official_commercial_terms",
        reportingPeriodEnd: null,
        reportingPeriodPassageKeys: [],
        contributions: {
            ...Object.fromEntries(
                Object.keys(base.shape.contributions.shape).map((role) => [
                    role,
                    null,
                ]),
            ),
            official_commercial_terms: [
                {
                    summary:
                        "The customer pays the fees specified in its order form.",
                    relevance:
                        "Documents how the subscription's commercial price is established.",
                    scope: "No public rate or realized pricing power is established.",
                    kind: "asserted_fact",
                    period: "current",
                    periodPassageKeys: [] as string[],
                    passageKeys: ["p0"],
                    dependsOnFlaggedAssertion: false,
                },
            ] satisfies [unknown],
        },
        limitations: [],
    };
}

test("the evaluation contract requires evidence for a claimed current period", () => {
    const schema = createEvaluationQualificationSchema([{ passageKey: "p0" }]);
    expect(schema.safeParse(response()).success).toBe(false);
    const grounded = response();
    grounded.contributions.official_commercial_terms[0].periodPassageKeys = [
        "p0",
    ];
    expect(schema.safeParse(grounded).success).toBe(true);
});

test("inspection restores a validated dossier without regenerating its qualifications", () => {
    const original = session();
    original.readSource("terms");
    const proposal = response();
    proposal.contributions.official_commercial_terms[0].period = "unspecified";
    expect(original.submitQualification("terms", proposal).status).toBe(
        "accepted",
    );
    const baseline = {
        scenarioHash: inspectionScenarioHash(original.scenario),
        sources: original.finish().sources,
    };
    const inspection = session();
    inspection.restoreBaseline(baseline);
    expect(inspection.sources).toEqual(baseline.sources);
    expect(
        inspection.events.some(
            (event) => event.operation === "baseline_restored",
        ),
    ).toBe(true);
    const corrupted = structuredClone(baseline);
    const finding = corrupted.sources[0]?.qualification?.findings[0];
    expect(finding).toBeDefined();
    const reference = finding?.passages[0];
    assert(reference);
    reference.quotation = "A statement absent from the capture";
    expect(() => session().restoreBaseline(corrupted)).toThrow(
        "Invalid baseline qualification",
    );
});

test("newly read capture passages can support a revision, while stale and uninspected references cannot", () => {
    const scenario = structuredClone(session().scenario);
    const text = Array.from(
        { length: 100 },
        (_, n) =>
            `Section ${n}. ${"Contract evidence for the company. ".repeat(75)}`,
    ).join("\n\n");
    const source = scenario.sources[0];
    assert(source);
    source.text = text;
    source.contentHash = sourcesDigest(text);
    const preparation = new SourcesPreparation(scenario);
    const first = preparation.readSource("terms");
    expect(first.status).toBe("accepted");
    if (first.status !== "accepted") throw new Error("Reading failed");
    expect(
        first.input.document.passages.some((p) => p.passageKey === "p99"),
    ).toBe(false);
    const proposal = response();
    proposal.contributions.official_commercial_terms[0].period = "unspecified";
    proposal.contributions.official_commercial_terms[0].passageKeys = ["p99"];
    expect(preparation.submitQualification("terms", proposal).status).toBe(
        "rejected",
    );
    const reading = preparation.readPassages("terms", ["p99"]);
    expect(reading.status).toBe("accepted");
    if (reading.status !== "accepted")
        throw new Error("Targeted reading failed");
    expect(reading.passages.some((p) => p.passageKey === "p99")).toBe(true);
    expect(
        preparation.submitQualification("terms", proposal, first.contextId),
    ).toMatchObject({
        status: "rejected",
        reason: "qualification_context_stale",
    });
    expect(
        preparation.submitQualification("terms", proposal, reading.contextId)
            .status,
    ).toBe("accepted");
    const qualified = preparation.sources[0]?.qualification;
    expect(qualified?.findings[0]?.passages[0]?.quotation).toContain(
        "Section 99.",
    );
    expect(preparation.readPassages("foreign", ["p99"]).status).toBe(
        "rejected",
    );
    expect(preparation.readPassages("terms", ["p10000"]).status).toBe(
        "rejected",
    );
});

test("reading windows stay bounded without forgetting previously inspected evidence", () => {
    const scenario = structuredClone(session().scenario);
    const source = scenario.sources[0];
    assert(source);
    source.text = Array.from(
        { length: 100 },
        (_, n) =>
            `Section ${n}. ${"Contract evidence for the company. ".repeat(75)}`,
    ).join("\n\n");
    source.contentHash = sourcesDigest(source.text);
    const preparation = new SourcesPreparation(scenario);
    const batch = preparation.readPassages("terms", [
        "p0",
        "p20",
        "p40",
        "p60",
        "p80",
        "p95",
    ]);
    assert(batch.status === "accepted");
    expect(batch.omittedRequestedPassageKeys).toEqual([]);
    expect(
        Buffer.byteLength(JSON.stringify(batch.passages)),
    ).toBeLessThanOrEqual(32 * 1024);
    for (let n = 0; n < 100; n += 5) {
        expect(preparation.readPassages("terms", [`p${n}`]).status).toBe(
            "accepted",
        );
    }
    const reread = preparation.readPassages("terms", ["p0"]);
    expect(reread.status).toBe("accepted");
    if (reread.status !== "accepted") throw new Error("Reading failed");
    const proposal = response();
    proposal.contributions.official_commercial_terms[0].period = "unspecified";
    proposal.contributions.official_commercial_terms[0].passageKeys = ["p95"];
    expect(
        preparation.submitQualification("terms", proposal, reread.contextId)
            .status,
    ).toBe("accepted");
    const reading = preparation.readSource("terms");
    assert(reading.status === "accepted");
    expect(
        Buffer.byteLength(JSON.stringify(reading.input)),
    ).toBeLessThanOrEqual(128 * 1024);
    expect(
        preparation.sources[0]?.qualification?.findings[0]?.passages[0]
            ?.quotation,
    ).toContain("Section 95.");
});

test("targeted corrections preserve unmentioned contributions and restrictions and reject stale or invalid batches atomically", () => {
    const preparation = session();
    preparation.readSource("terms");
    const proposal = response();
    proposal.contributions.official_commercial_terms[0].period = "unspecified";
    proposal.contributions.official_commercial_terms.push({
        ...proposal.contributions.official_commercial_terms[0],
        summary: "The order form governs commercial fees.",
    });
    const baselineProposal = {
        ...proposal,
        limitations: [
            {
                code: "period_unestablished",
                explanation: "No date is stated in the inspected terms.",
                passageKeys: ["p0"],
                scope: { kind: "document" },
            },
        ],
    };
    expect(
        preparation.submitQualification("terms", baselineProposal).status,
    ).toBe("accepted");
    const original = structuredClone(preparation.sources[0]?.qualification);
    assert(original);
    const correction = {
        sourceId: "terms",
        expectedRevision: 1,
        documentKind: null,
        findings: [
            {
                index: 0,
                replacement: {
                    role: "official_commercial_terms",
                    ...proposal.contributions.official_commercial_terms[0],
                    summary: "Commercial fees are agreed in an order form.",
                },
            },
        ],
        limitations: [],
    };
    expect(preparation.correctQualification(correction)).toMatchObject({
        status: "accepted",
        revision: 2,
    });
    expect(preparation.sources[0]?.qualification?.findings[1]).toEqual(
        original.findings[1],
    );
    expect(preparation.sources[0]?.qualification?.limitations).toEqual(
        original.limitations,
    );
    const retained = structuredClone(preparation.sources[0]?.qualification);
    const firstCorrection = correction.findings[0];
    assert(firstCorrection);
    expect(preparation.correctQualification(correction)).toMatchObject({
        status: "rejected",
        reason: "qualification_revision_stale",
    });
    expect(
        preparation.correctQualification({
            ...correction,
            expectedRevision: 2,
            findings: [{ ...correction.findings[0], index: null }],
        }),
    ).toMatchObject({
        status: "rejected",
        reason: "qualification_contract_invalid",
    });
    expect(
        preparation.correctQualification({
            ...correction,
            expectedRevision: 2,
            findings: [
                {
                    index: 0,
                    replacement: {
                        ...firstCorrection.replacement,
                        passageKeys: ["p999"],
                    },
                },
            ],
        }),
    ).toMatchObject({ status: "rejected", reason: "passage_not_inspected" });
    expect(preparation.sources[0]?.qualification).toEqual(retained);
});

test("the correction tool requires the same scoped restrictions as the v5 validator", () => {
    const correction = {
        sourceId: "terms",
        expectedRevision: 1,
        documentKind: null,
        findings: [],
        limitations: [
            {
                index: null,
                replacement: {
                    code: "period_unestablished",
                    explanation: "The period is not established.",
                    passageKeys: ["p0"],
                },
            },
        ],
    };
    expect(qualificationCorrectionSchema.safeParse(correction).success).toBe(
        false,
    );
    expect(
        qualificationCorrectionSchema.safeParse({
            ...correction,
            limitations: [
                {
                    index: null,
                    replacement: {
                        ...correction.limitations[0]?.replacement,
                        scope: { kind: "document" },
                    },
                },
            ],
        }).success,
    ).toBe(true);
});

test("a correction with unchanged values preserves the qualification revision despite field ordering", () => {
    const preparation = session();
    preparation.readSource("terms");
    const proposal = response();
    proposal.contributions.official_commercial_terms[0].period = "unspecified";
    expect(preparation.submitQualification("terms", proposal).status).toBe(
        "accepted",
    );
    expect(
        preparation.correctQualification({
            sourceId: "terms",
            expectedRevision: 1,
            documentKind: null,
            findings: [
                {
                    index: 0,
                    replacement: {
                        ...proposal.contributions.official_commercial_terms[0],
                        role: "official_commercial_terms",
                    },
                },
            ],
            limitations: [],
        }),
    ).toMatchObject({ status: "accepted", revision: 1 });
});

test("the bench searches captured financial tables beyond the selected qualification excerpts", () => {
    const annual =
        Array.from(
            { length: 580 },
            (_, i) =>
                `## Topic ${i}\n\nThe platform provides workflow integration, security architecture and licensing terms for enterprise customer ${i}.`,
        ).join("\n\n") +
        "\n\n## Consolidated statements of income\n\n| USD millions | FY2025 | FY2024 |\n| --- | ---: | ---: |\n| Total revenue | 23,769 | 21,505 |";
    const article =
        "Acme's FY2025 total revenue was approximately USD 22,500 million.";
    const preparation = new SourcesPreparation({
        ...session().scenario,
        sources: [
            {
                candidate: {
                    sourceId: "annual",
                    title: "Annual report",
                    canonicalUrl:
                        "https://www.sec.gov/Archives/edgar/data/123/annual.htm",
                    origin: "sec",
                    category: "filing",
                    secForm: "10-K",
                    createdAt: 0,
                },
                text: annual,
                contentHash: sourcesDigest(annual),
            },
            {
                candidate: {
                    sourceId: "article",
                    title: "Acme research",
                    canonicalUrl: "https://research.example/acme",
                    origin: "exa",
                    category: "analysis",
                    createdAt: 0,
                },
                text: article,
                contentHash: sourcesDigest(article),
            },
        ],
    });
    preparation.readSource("article");
    const proposal = response();
    const contribution = {
        ...proposal.contributions.official_commercial_terms[0],
        summary: article,
        relevance: "Provides a financial premise for a resilience thesis.",
        scope: "An unverified author-reported FY2025 revenue figure.",
        kind: "attributed_argument",
        period: "unspecified",
        periodPassageKeys: [],
    };
    expect(
        preparation.submitQualification("article", {
            ...proposal,
            documentKind: "independent_analysis",
            contributions: {
                ...proposal.contributions,
                official_commercial_terms: null,
                independent_analysis_primary: [contribution],
            },
        }).status,
    ).toBe("accepted");
    const comparison = preparation.prepareComparison("article");
    expect(comparison.status).toBe("accepted");
    if (comparison.status !== "accepted") throw new Error(comparison.reason);
    expect(
        comparison.input.primaryPassages.some((p) =>
            p.quotation.includes("23,769"),
        ),
    ).toBe(true);
    expect(comparison.input.assessmentPolicy).toBe("explicit-premises-v1");
});

test("the evaluation contract cannot negate its contributions with a second no-content verdict", () => {
    const proposal = response();
    proposal.contributions.official_commercial_terms[0].period = "unspecified";
    const contradictory = {
        ...proposal,
        limitations: [
            {
                code: "no_substantive_content",
                explanation: "Other documentary roles are absent.",
                passageKeys: ["p0"],
                scope: { kind: "document" },
            },
        ],
    };
    expect(
        createEvaluationQualificationSchema([{ passageKey: "p0" }]).safeParse(
            contradictory,
        ).success,
    ).toBe(false);
    expect(
        createQualificationResponseSchema(
            [{ passageKey: "p0" }],
            "source-qualification-v5",
        ).safeParse(contradictory).success,
    ).toBe(true);
});

test("both callers must inspect captured material before submitting a qualification", () => {
    const preparation = session();
    const proposal = response();
    proposal.contributions.official_commercial_terms[0].period = "unspecified";
    expect(preparation.submitQualification("terms", proposal)).toMatchObject({
        status: "rejected",
        reason: "source_not_inspected",
    });
    expect(preparation.sources[0]?.qualification).toBeUndefined();
    expect(preparation.readSource("terms").status).toBe("accepted");
    expect(preparation.submitQualification("terms", proposal).status).toBe(
        "accepted",
    );
    expect(preparation.sources[0]?.qualification?.findings).toHaveLength(1);
});

test("a rejected revision cannot erase useful accepted material", () => {
    const preparation = session();
    preparation.readSource("terms");
    const proposal = response();
    proposal.contributions.official_commercial_terms[0].period = "unspecified";
    expect(preparation.submitQualification("terms", proposal).status).toBe(
        "accepted",
    );
    expect(preparation.submitQualification("terms", response()).status).toBe(
        "rejected",
    );
    expect(preparation.sources[0]?.qualification?.findings[0]?.period).toBe(
        "unspecified",
    );
    expect(preparation.sources[0]?.qualificationRevision).toBe(1);
    expect(preparation.events.at(-1)).toMatchObject({
        operation: "submit_qualification",
        status: "rejected",
    });
});

test("a comparison prepared before a qualification revision cannot be admitted", () => {
    const preparation = session();
    preparation.readSource("terms");
    const proposal = response();
    proposal.contributions.official_commercial_terms[0].period = "unspecified";
    proposal.contributions.official_commercial_terms[0].kind =
        "attributed_argument";
    preparation.submitQualification("terms", proposal);
    const context = preparation.prepareComparison("terms");
    expect(context.status).toBe("accepted");
    if (context.status !== "accepted")
        throw new Error("Expected comparison context");
    proposal.contributions.official_commercial_terms[0].period = "historical";
    proposal.contributions.official_commercial_terms[0].periodPassageKeys = [
        "p0",
    ];
    preparation.submitQualification("terms", proposal);
    expect(
        preparation.submitComparison(context.contextId, { findings: [] }),
    ).toMatchObject({ status: "rejected", reason: "comparison_context_stale" });
    expect(preparation.sources[0]?.comparison).toBeUndefined();
});

test("ending before reading the corpus remains incomplete and preserves omissions", () => {
    const preparation = session();
    const result = preparation.finish();
    expect(result.status).toBe("partial");
    expect(result.sources[0]).toMatchObject({
        read: false,
        qualificationStatus: "unread",
    });
    expect(result.selection.items[0]?.eligibleCoverageRoles).toEqual([]);
});

test("a targeted primary reading reaches the comparison even when automatic lexical selection misses it", () => {
    const annual = Array.from(
        { length: 100 },
        (_, i) =>
            `## Topic ${i}\n\n${i === 99 ? "Customers retain ownership of their information and license processing solely for service provision." : "The platform offers workflow coordination capabilities. ".repeat(30)}`,
    ).join("\n\n");
    const article = "Acme has a durable workflow coordination advantage.";
    const preparation = new SourcesPreparation({
        ...session().scenario,
        sources: [
            {
                candidate: {
                    sourceId: "annual",
                    title: "Annual report",
                    canonicalUrl:
                        "https://www.sec.gov/Archives/edgar/data/123/annual.htm",
                    origin: "sec",
                    category: "filing",
                    secForm: "10-K",
                    createdAt: 0,
                },
                text: annual,
                contentHash: sourcesDigest(annual),
            },
            {
                candidate: {
                    sourceId: "article",
                    title: "Acme research",
                    canonicalUrl: "https://research.example/acme",
                    origin: "exa",
                    category: "analysis",
                    createdAt: 0,
                },
                text: article,
                contentHash: sourcesDigest(article),
            },
        ],
    });
    preparation.readSource("article");
    const proposed = response();
    const contribution = {
        ...proposed.contributions.official_commercial_terms[0],
        period: "unspecified",
        kind: "attributed_argument",
        summary: article,
    };
    expect(
        preparation.submitQualification("article", {
            ...proposed,
            documentKind: "independent_analysis",
            contributions: {
                ...proposed.contributions,
                official_commercial_terms: null,
                independent_analysis_primary: [contribution],
            },
        }).status,
    ).toBe("accepted");
    const before = preparation.prepareComparison("article");
    expect(before.status).toBe("accepted");
    if (before.status !== "accepted") throw new Error("Comparison unavailable");
    expect(
        before.input.primaryPassages.some((p) => p.passageKey === "p99"),
    ).toBe(false);
    expect(preparation.readPassages("annual", ["p99"]).status).toBe("accepted");
    expect(preparation.submitComparison(before.contextId, {}).status).toBe(
        "rejected",
    );
    const after = preparation.prepareComparison("article");
    expect(after.status).toBe("accepted");
    if (after.status !== "accepted") throw new Error("Comparison unavailable");
    expect(
        after.input.primaryPassages.some(
            (p) =>
                p.passageKey === "p99" &&
                p.quotation.includes("Customers retain ownership"),
        ),
    ).toBe(true);
});

test("restoring a comparison rejects a target quotation altered after materialization", () => {
    const original = session();
    original.readSource("terms");
    const proposed = response();
    proposed.contributions.official_commercial_terms[0].period = "unspecified";
    proposed.contributions.official_commercial_terms[0].kind =
        "attributed_argument";
    original.submitQualification("terms", proposed);
    const context = original.prepareComparison("terms");
    assert(context.status === "accepted");
    expect(
        original.submitComparison(context.contextId, {
            findings: [
                {
                    findingIndex: 0,
                    targetPassageKeys: ["target:0:p0"],
                    premises: [
                        {
                            statement:
                                "Customers pay the agreed subscription fees.",
                            disposition: "inconclusive",
                            explanation:
                                "No comparable independent primary evidence is available.",
                            comparableDimensions: [],
                            primaryPassageKeys: [],
                        },
                    ],
                },
            ],
        }).status,
    ).toBe("accepted");
    const baseline = {
        scenarioHash: inspectionScenarioHash(original.scenario),
        sources: original.finish().sources,
    };
    const reference =
        baseline.sources[0]?.comparison?.findings[0]?.targetPassages[0];
    assert(reference);
    reference.quotation =
        "A fabricated statement that does not occur in this source.";
    expect(() => session().restoreBaseline(baseline)).toThrow(
        "Invalid baseline target reference",
    );
});
