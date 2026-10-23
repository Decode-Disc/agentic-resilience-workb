import {
    createSourceComparisonResponseSchema,
    materializeSourceComparisonOutput,
    prepareSourceComparisonInput,
    SOURCE_COMPARISON_MAX_INPUT_BYTES,
} from "@convex/domain/sourceComparison";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { expect, test } from "vitest";

const company = {
    cik: "1373715",
    legalName: "ServiceNow, Inc.",
    ticker: "NOW",
};

const makeTarget = (
    findings: Array<{ passageKey: string; quotation: string }[]>,
) => {
    let text = "";
    const selectedPassages: Array<{
        passageKey: string;
        startOffset: number;
        endOffset: number;
    }> = [];
    const qualificationFindings = findings.map((references, index) => {
        const passages = references.map((reference) => {
            if (text) text += "\n\n";
            const startOffset = text.length;
            text += reference.quotation;
            selectedPassages.push({
                passageKey: reference.passageKey,
                startOffset,
                endOffset: text.length,
            });
            return reference;
        });
        return {
            role: "counter_evidence_primary" as const,
            kind:
                index % 2 === 0
                    ? ("attributed_argument" as const)
                    : ("forecast" as const),
            summary: passages[0]?.quotation ?? "",
            passages,
            period: "current" as const,
            periodPassages: [],
            dependsOnFlaggedAssertion: false,
        };
    });
    return {
        runId: "run-1",
        corpusRevisionId: "revision-1",
        sourceId: "target-source",
        captureId: "target-capture",
        contentHash: sha256Hex(text),
        qualificationTaskId: "qualification-task",
        title: "Workflow competition analysis",
        canonicalUrl: "https://research.example/workflow",
        text,
        selectedPassages,
        qualification: {
            companyMatch: "subject" as const,
            companyPassages: [],
            documentKind: "independent_analysis" as const,
            reportingPeriodEnd: null,
            reportingPeriodPassages: [],
            findings: qualificationFindings,
            limitations: [],
        },
    };
};

test("binds comparison cache identity to the active run and corpus revision", () => {
    const target = makeTarget([
        [
            {
                passageKey: "p0",
                quotation: "Bundled workflow products pressure pricing.",
            },
        ],
    ]);
    const primaryText = "The company competes with bundled workflow products.";
    const first = prepareSourceComparisonInput({
        company,
        target,
        primaryCandidates: [primary(primaryText)],
    });
    const otherRevision = prepareSourceComparisonInput({
        company,
        target: { ...target, corpusRevisionId: "revision-2" },
        primaryCandidates: [primary(primaryText)],
    });

    expect(otherRevision.inputHash).not.toBe(first.inputHash);
});

const primary = (text: string) => ({
    sourceId: "primary-source",
    captureId: "primary-capture",
    contentHash: sha256Hex(text),
    title: "Annual report",
    canonicalUrl:
        "https://www.sec.gov/Archives/edgar/data/1373715/annual-report.htm",
    authorityTier: "regulator_primary" as const,
    documentKind: "regulatory_annual" as const,
    reportingPeriodEnd: null,
    publishedAt: Date.UTC(2026, 9, 20),
    text,
    passages: [
        {
            passageKey: "p0",
            startOffset: 0,
            endOffset: text.length,
            quotation: text,
            headingPath: ["Competition"],
        },
    ],
});

test("builds grouped input from exact target and captured primary passages", () => {
    const target = makeTarget([
        [
            {
                passageKey: "p0",
                quotation:
                    "Bundled workflow products may pressure subscription pricing.",
            },
        ],
    ]);
    const primaryText =
        "The company competes with providers that bundle workflow products into broad subscriptions.";
    const prepared = prepareSourceComparisonInput({
        company,
        target,
        primaryCandidates: [primary(primaryText)],
    });

    expect(prepared.request.findings).toHaveLength(1);
    expect(prepared.request.findings[0]?.targetPassages[0]).toMatchObject({
        passageKey: "p0",
        quotation: target.qualification.findings[0]?.passages[0]?.quotation,
        startOffset: 0,
    });
    expect(prepared.request.primaryPassages[0]).toMatchObject({
        sourceId: "primary-source",
        captureId: "primary-capture",
        contentHash: sha256Hex(primaryText),
        quotation: primaryText,
        startOffset: 0,
        endOffset: primaryText.length,
    });
    expect(prepared.request.primarySources[0]).toMatchObject({
        sourceId: "primary-source",
        captureId: "primary-capture",
        title: "Annual report",
        canonicalUrl:
            "https://www.sec.gov/Archives/edgar/data/1373715/annual-report.htm",
        documentKind: "regulatory_annual",
    });
    expect(prepared.request.instructions).toContain("untrusted data");
});

test("reports a reached candidate metadata bound without inventing an omission count", () => {
    const target = makeTarget([
        [
            {
                passageKey: "p0",
                quotation: "Bundled workflow products pressure pricing.",
            },
        ],
    ]);
    const prepared = prepareSourceComparisonInput({
        company,
        target,
        primaryCandidates: [
            primary("The company competes with bundled workflow products."),
        ],
        candidateMetadataLimitReached: true,
    });

    expect(prepared.request.completeness).toMatchObject({
        candidateMetadataLimitReached: true,
        omittedPrimaryCaptureCount: 0,
    });
    const materialized = materializeSourceComparisonOutput(prepared, {
        findings: [],
    });
    expect(materialized.status).toBe("valid");
    if (materialized.status !== "valid") return;
    expect(materialized.output).toMatchObject({
        completeness: "partial",
        candidateMetadataLimitReached: true,
        omittedPrimaryCaptureCount: 0,
    });
});

test("adds immediately preceding table title and unit caption as bounded context", () => {
    const target = makeTarget([
        [{ passageKey: "p0", quotation: "The company has no long-term debt." }],
    ]);
    const segments = [
        "Condensed Consolidated Balance Sheets",
        "(in millions)",
        "| | March 31, 2026 | December 31, 2025 |\n| --- | --- | --- |\n| Long-term debt, net | 1,491 | 1,500 |",
    ];
    const text = segments.join("\n\n");
    let offset = 0;
    const passages = segments.map((quotation, index) => {
        const passage = {
            passageKey: `p${143 + index}`,
            startOffset: offset,
            endOffset: offset + quotation.length,
            quotation,
            headingPath: ["Financial statements"],
        };
        offset += quotation.length + 2;
        return passage;
    });
    const prepared = prepareSourceComparisonInput({
        company,
        target,
        primaryCandidates: [
            {
                ...primary(text),
                text,
                contentHash: sha256Hex(text),
                passages,
            },
        ],
    });
    const finding = prepared.request.findings[0];
    if (!finding) throw new Error("Expected a comparable finding");
    const references = prepared.request.primaryPassages.filter((passage) =>
        finding.primaryPassageKeys.includes(passage.referenceKey),
    );

    expect(references.map((passage) => passage.passageKey)).toEqual(
        expect.arrayContaining(["p143", "p144", "p145"]),
    );
    expect(references).toHaveLength(3);
});

test("ranks relevant primary document purpose ahead of recency before the capture cap", () => {
    const target = makeTarget([
        [
            {
                passageKey: "p0",
                quotation: "The company competes in workflow subscriptions.",
            },
        ],
    ]);
    const relevantText = "The company competes in workflow subscriptions.";
    const primaryCandidates = [
        ...Array.from({ length: 8 }, (_, index) => ({
            ...primary(relevantText),
            sourceId: `newer-unrelated-${index}`,
            captureId: `newer-unrelated-capture-${index}`,
            documentKind: "regulatory_other" as const,
            publishedAt: Date.UTC(2026, 9, 20 - index),
        })),
        {
            ...primary(relevantText),
            sourceId: "older-annual",
            captureId: "older-annual-capture",
            documentKind: "regulatory_annual" as const,
            publishedAt: Date.UTC(2025, 9, 20),
        },
    ];
    const prepared = prepareSourceComparisonInput({
        company,
        target,
        primaryCandidates,
    });

    expect(
        prepared.request.primaryPassages.some(
            (passage) => passage.sourceId === "older-annual",
        ),
    ).toBe(true);
});

test("missing comparable evidence remains inconclusive and cannot be labeled agreement", () => {
    const target = makeTarget([
        [{ passageKey: "p0", quotation: "Revenue increased during the year." }],
    ]);
    const prepared = prepareSourceComparisonInput({
        company,
        target,
        primaryCandidates: [],
    });
    const output = materializeSourceComparisonOutput(
        prepared,
        { findings: [] },
        "not_run",
    );

    expect(output.status).toBe("valid");
    if (output.status !== "valid") return;
    expect(output.output.findings[0]).toMatchObject({
        disposition: "inconclusive",
        primaryPassages: [],
    });
    expect(output.output.checkStatus).toBe("not_run");
    expect(
        createSourceComparisonResponseSchema(prepared).safeParse({
            findings: [
                {
                    findingIndex: 0,
                    disposition: "no_conflict_observed",
                    explanation: "No issue was identified.",
                    comparableDimensions: [
                        "entity",
                        "concept",
                        "period",
                        "unit_basis",
                        "argument_effect",
                    ],
                    targetPassageKeys: ["target:0:p0"],
                    primaryPassageKeys: [],
                },
            ],
        }).success,
    ).toBe(false);
});

test("foreign evidence references are rejected and unsupported conflict is downgraded", () => {
    const target = makeTarget([
        [
            {
                passageKey: "p0",
                quotation: "Bundled workflow products compete on price.",
            },
        ],
    ]);
    const primaryText =
        "The company competes with providers that bundle workflow products into broad subscriptions.";
    const prepared = prepareSourceComparisonInput({
        company,
        target,
        primaryCandidates: [primary(primaryText)],
    });
    const finding = prepared.request.findings[0];
    if (!finding) throw new Error("Expected a comparable finding");
    const invalidResponse = {
        findings: [
            {
                findingIndex: finding.findingIndex,
                disposition: "possible_conflict",
                explanation: "A material concern may affect the argument.",
                comparableDimensions: ["concept", "argument_effect"],
                targetPassageKeys: finding.targetPassages.map(
                    (passage) => passage.referenceKey,
                ),
                primaryPassageKeys: ["foreign-reference"],
            },
        ],
    };

    expect(
        createSourceComparisonResponseSchema(prepared).safeParse(
            invalidResponse,
        ).success,
    ).toBe(false);
    expect(
        createSourceComparisonResponseSchema(prepared).safeParse({
            findings: [
                {
                    ...invalidResponse.findings[0],
                    primaryPassageKeys: [],
                },
            ],
        }).success,
    ).toBe(false);
    expect(
        materializeSourceComparisonOutput(prepared, {
            findings: [
                {
                    ...invalidResponse.findings[0],
                    primaryPassageKeys: [],
                },
            ],
        }),
    ).toMatchObject({
        status: "valid",
        output: { findings: [{ disposition: "inconclusive" }] },
    });
});

test("keeps a conflict on one contribution separate from an independent growth contribution", () => {
    const target = makeTarget([
        [
            {
                passageKey: "p0",
                quotation: "The current backlog is 10 billion dollars.",
            },
        ],
        [
            {
                passageKey: "p1",
                quotation: "The current backlog grew 22 percent.",
            },
        ],
    ]);
    const primaryText =
        "The report gives the current backlog as 12 billion dollars and says it grew 22 percent.";
    const prepared = prepareSourceComparisonInput({
        company,
        target,
        primaryCandidates: [primary(primaryText)],
    });
    const response = {
        findings: prepared.request.findings.map((finding) => ({
            findingIndex: finding.findingIndex,
            disposition:
                finding.findingIndex === 0
                    ? ("possible_conflict" as const)
                    : ("no_conflict_observed" as const),
            explanation: "The cited primary passage is comparable in scope.",
            comparableDimensions: [
                "entity",
                "concept",
                "period",
                "unit_basis",
                "argument_effect",
            ] as const,
            targetPassageKeys: finding.targetPassages.map(
                (passage) => passage.referenceKey,
            ),
            primaryPassageKeys: finding.primaryPassageKeys,
        })),
    };

    const result = materializeSourceComparisonOutput(prepared, response);
    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(
        result.output.findings.map(({ disposition }) => disposition),
    ).toEqual(["possible_conflict", "no_conflict_observed"]);
});

test("counts complete serialized context and schemas without clipping target quotations", () => {
    const longQuote =
        "A complete long target passage about enterprise workflow competition and recurring subscription pricing. ".repeat(
            40,
        );
    const targetReferences = Array.from({ length: 15 }, (_, findingIndex) =>
        Array.from({ length: 3 }, (_, passageIndex) => {
            const suffix = ` contribution-${findingIndex}-${passageIndex}`;
            return {
                passageKey: `p${findingIndex * 3 + passageIndex}`,
                quotation: `${longQuote.slice(0, 4000 - suffix.length)}${suffix}`,
            };
        }),
    );
    const target = makeTarget(targetReferences);
    const primaryText =
        "The annual report describes enterprise workflow competition and subscription pricing.";
    const prepared = prepareSourceComparisonInput({
        company,
        target,
        primaryCandidates: [primary(primaryText)],
    });
    const requestQuotes = prepared.request.findings.flatMap((finding) =>
        finding.targetPassages.map((passage) => passage.quotation),
    );

    expect(prepared.serializedRequestBytes).toBeLessThanOrEqual(
        SOURCE_COMPARISON_MAX_INPUT_BYTES,
    );
    expect(prepared.omittedFindingIndexes.length).toBeGreaterThan(0);
    const exactSourceQuotes = new Set(
        targetReferences.flat().map(({ quotation }) => quotation),
    );
    expect(
        requestQuotes.every((quotation) => exactSourceQuotes.has(quotation)),
    ).toBe(true);
    expect(requestQuotes.every((quotation) => quotation.length <= 4000)).toBe(
        true,
    );
});

test("uses compact deterministic primary aliases without losing citation identity", () => {
    const target = makeTarget([
        [
            {
                passageKey: "p0",
                quotation: "Bundled workflow products pressure pricing.",
            },
        ],
    ]);
    const text = "The company competes with bundled workflow products.";
    const candidates = [
        {
            ...primary(text),
            sourceId: `source-${"a".repeat(64)}`,
            captureId: `capture-${"b".repeat(64)}`,
        },
        {
            ...primary(text),
            sourceId: `source-${"c".repeat(64)}`,
            captureId: `capture-${"d".repeat(64)}`,
        },
    ];
    const prepared = prepareSourceComparisonInput({
        company,
        target,
        primaryCandidates: candidates,
    });
    const aliases = prepared.request.primaryPassages.map(
        (passage) => passage.referenceKey,
    );
    expect(aliases).toHaveLength(2);
    expect(aliases.every((alias) => /^primary:[0-9]{1,2}$/.test(alias))).toBe(
        true,
    );
    expect(new Set(aliases).size).toBe(2);
    expect(
        prepareSourceComparisonInput({
            company,
            target,
            primaryCandidates: [...candidates].reverse(),
        }),
    ).toEqual(prepared);
    const finding = prepared.request.findings[0];
    expect(finding).toBeDefined();
    if (!finding) throw new Error("Expected the target contribution");
    const response = {
        findings: [
            {
                findingIndex: finding.findingIndex,
                disposition: "possible_conflict",
                explanation:
                    "The supplied primary passages address this premise.",
                comparableDimensions: [
                    "entity",
                    "concept",
                    "period",
                    "unit_basis",
                    "argument_effect",
                ],
                targetPassageKeys: finding.targetPassages.map(
                    (passage) => passage.referenceKey,
                ),
                primaryPassageKeys: aliases,
            },
        ],
    };
    expect(
        createSourceComparisonResponseSchema(prepared).safeParse(response)
            .success,
    ).toBe(true);
    const materialized = materializeSourceComparisonOutput(prepared, response);
    expect(materialized.status).toBe("valid");
    if (materialized.status !== "valid") return;
    expect(materialized.output.findings[0]?.primaryPassages).toEqual(
        candidates.map((candidate) => ({
            sourceId: candidate.sourceId,
            captureId: candidate.captureId,
            contentHash: candidate.contentHash,
            passageKey: "p0",
            startOffset: 0,
            endOffset: text.length,
            quotation: text,
        })),
    );
    expect(
        materializeSourceComparisonOutput(prepared, {
            findings: [
                { ...response.findings[0], primaryPassageKeys: ["primary:63"] },
            ],
        }),
    ).toEqual({ status: "invalid", reason: "reference_invalid" });
});

test("permits exact primary evidence supplied for another contribution in the same grouped request", () => {
    const target = makeTarget([
        [
            {
                passageKey: "p0",
                quotation:
                    "Expansion can be funded from retained earnings without financing obligations.",
            },
        ],
        [
            {
                passageKey: "p1",
                quotation:
                    "Outstanding long-term debt reduces balance sheet flexibility.",
            },
        ],
    ]);
    const debt = {
        ...primary("Long-term debt, net: 1,491 million at December 31, 2025."),
        sourceId: "debt-source",
        captureId: "debt-capture",
    };
    const prepared = prepareSourceComparisonInput({
        company,
        target,
        primaryCandidates: [
            ...Array.from({ length: 6 }, (_, index) => ({
                ...primary(
                    "Expansion is funded from retained earnings and financing obligations.",
                ),
                sourceId: `expansion-${index}`,
                captureId: `expansion-capture-${index}`,
            })),
            debt,
        ],
    });
    const finding = prepared.request.findings.find(
        (item) => item.findingIndex === 0,
    );
    const reference = prepared.request.primaryPassages.find(
        (item) => item.sourceId === debt.sourceId,
    );
    if (!finding || !reference)
        throw new Error(
            "Expected both contributions and captured debt context",
        );
    expect(finding.primaryPassageKeys).not.toContain(reference.referenceKey);
    const response = {
        findings: [
            {
                findingIndex: 0,
                disposition: "possible_conflict",
                explanation:
                    "The provided balance sheet records outstanding debt relevant to this financing premise.",
                comparableDimensions: [
                    "entity",
                    "concept",
                    "period",
                    "unit_basis",
                    "argument_effect",
                ],
                targetPassageKeys: finding.targetPassages.map(
                    (item) => item.referenceKey,
                ),
                primaryPassageKeys: [reference.referenceKey],
            },
        ],
    };
    expect(
        createSourceComparisonResponseSchema(prepared).safeParse(response)
            .success,
    ).toBe(true);
    const result = materializeSourceComparisonOutput(prepared, response);
    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.output.findings[0]).toMatchObject({
        disposition: "possible_conflict",
        primaryPassages: [
            {
                sourceId: debt.sourceId,
                captureId: debt.captureId,
                contentHash: debt.contentHash,
                quotation: debt.text,
            },
        ],
    });
    expect(
        materializeSourceComparisonOutput(prepared, {
            findings: [
                { ...response.findings[0], primaryPassageKeys: ["primary:63"] },
            ],
        }),
    ).toEqual({ status: "invalid", reason: "reference_invalid" });
});

test("keeps the provider reference limit when grouped primary context exceeds one finding", () => {
    const target = makeTarget([
        [{ passageKey: "p0", quotation: "Alpha expansion financing." }],
        [{ passageKey: "p1", quotation: "Beta debt financing." }],
    ]);
    const chunks = Array.from(
        { length: 12 },
        (_, index) =>
            `${index < 6 ? "Alpha expansion" : "Beta debt"} financing cost paragraph ${index}.`,
    );
    const text = chunks.join("\n\n");
    let offset = 0;
    const passages = chunks.map((quotation, index) => {
        const passage = {
            passageKey: `p${index}`,
            startOffset: offset,
            endOffset: offset + quotation.length,
            quotation,
            headingPath: [],
        };
        offset += quotation.length + 2;
        return passage;
    });
    const prepared = prepareSourceComparisonInput({
        company,
        target,
        primaryCandidates: [{ ...primary(text), passages }],
    });
    const keys = prepared.request.primaryPassages.map(
        (item) => item.referenceKey,
    );
    expect(keys.length).toBeGreaterThan(8);
    const finding = prepared.request.findings[0];
    if (!finding) throw new Error("Expected a target contribution");
    const response = {
        findings: [
            {
                findingIndex: finding.findingIndex,
                disposition: "inconclusive",
                explanation:
                    "The supplied context does not establish a conclusion.",
                comparableDimensions: [],
                targetPassageKeys: finding.targetPassages.map(
                    (item) => item.referenceKey,
                ),
                primaryPassageKeys: keys.slice(0, 9),
            },
        ],
    };
    expect(
        createSourceComparisonResponseSchema(prepared).safeParse(response)
            .success,
    ).toBe(false);
    const firstResponse = response.findings[0];
    if (!firstResponse) throw new Error("Expected a provider finding");
    firstResponse.primaryPassageKeys = keys.slice(0, 8);
    expect(
        createSourceComparisonResponseSchema(prepared).safeParse(response)
            .success,
    ).toBe(true);
});

test("native content ranking can select the ninth eligible capture before the eight-capture limit", () => {
    const target = makeTarget([
        [
            {
                passageKey: "p0",
                quotation:
                    "Subscription revenue for fiscal 2025 should be checked.",
            },
        ],
    ]);
    const candidates = Array.from({ length: 9 }, (_, i) => ({
        ...primary(
            i === 8
                ? "Subscription revenue in fiscal 2025 was USD 23769 million."
                : "General corporate disclosure.",
        ),
        sourceId: `source-${i}`,
        captureId: `capture-${i}`,
    }));
    const prepared = prepareSourceComparisonInput({
        company,
        target,
        primaryCandidates: candidates,
        retrieval: {
            metadata: {
                version: "structured-v1",
                requestedMode: "lexical",
                effectiveMode: "lexical",
                selectedPassageKeys: ["capture-8:p0"],
                omittedCandidateCount: 8,
            },
            rankings: [{ findingIndex: 0, passageKeys: ["capture-8:p0"] }],
        },
    });
    expect(
        prepared.request.primaryPassages.some(
            (p) => p.captureId === "capture-8" && p.quotation.includes("23769"),
        ),
    ).toBe(true);
    expect(prepared.request.primarySources.length).toBeLessThanOrEqual(8);
});

function nativeComparisonArgs(chunks: string[]) {
    const text = chunks.join("\n\n");
    let offset = 0;
    const passages = chunks.map((quotation, i) => {
        const row = {
            passageKey: `p${i}`,
            startOffset: offset,
            endOffset: offset + quotation.length,
            quotation,
            headingPath: [],
        };
        offset += quotation.length + 2;
        return row;
    });
    return {
        company,
        target: makeTarget([
            [
                {
                    passageKey: "p0",
                    quotation: "Check annual revenue and its reporting basis.",
                },
            ],
        ]),
        primaryCandidates: [{ ...primary(text), passages }],
        retrieval: {
            metadata: {
                version: "structured-v1" as const,
                requestedMode: "lexical" as const,
                effectiveMode: "lexical" as const,
                selectedPassageKeys: passages.map(
                    (p) => `primary-capture:${p.passageKey}`,
                ),
                omittedCandidateCount: 0,
            },
            rankings: [
                {
                    findingIndex: 0,
                    passageKeys: passages.map(
                        (p) => `primary-capture:${p.passageKey}`,
                    ),
                },
            ],
        },
    };
}

test("versioned comparison retains retrieved evidence beyond the priority shortlist when shared input space remains", () => {
    const chunks = Array.from(
        { length: 12 },
        (_, i) =>
            `Disclosure ${i}: ${i === 8 ? "Revenue excludes discontinued operations." : "Annual financial and operating context."}`,
    );
    const prepared = prepareSourceComparisonInput(nativeComparisonArgs(chunks));
    const retained = prepared.request.primaryPassages.find((p) =>
        p.quotation.includes("excludes discontinued"),
    );
    expect(retained).toBeDefined();
    expect(prepared.request.findings[0]?.primaryPassageKeys).toHaveLength(6);
    expect(prepared.request.completeness.omittedPrimaryPassageCount).toBe(0);
    expect(prepared.serializedRequestBytes).toBeLessThanOrEqual(
        SOURCE_COMPARISON_MAX_INPUT_BYTES,
    );
    expect(
        createSourceComparisonResponseSchema(prepared).safeParse({
            findings: [
                {
                    findingIndex: 0,
                    disposition: "inconclusive",
                    explanation: "The reporting basis needs review.",
                    comparableDimensions: [],
                    targetPassageKeys:
                        prepared.request.findings[0]?.targetPassages.map(
                            (p) => p.referenceKey,
                        ),
                    primaryPassageKeys: [retained?.referenceKey],
                },
            ],
        }).success,
    ).toBe(true);
});

test("versioned comparison gives overlapping evidence one place using the complete covering quotation", () => {
    const args = nativeComparisonArgs([
        "Revenue basis and reporting units appear together.",
        "A separate useful disclosure.",
    ]);
    const candidate = args.primaryCandidates[0];
    const full = candidate?.passages[0];
    const ranking = args.retrieval.rankings[0];
    if (!candidate || !full || !ranking)
        throw new Error("Missing comparison fixture");
    candidate.passages.unshift({
        ...full,
        passageKey: "fragment",
        quotation: full.quotation.slice(0, 13),
        endOffset: 13,
    });
    ranking.passageKeys.unshift("primary-capture:fragment");
    const prepared = prepareSourceComparisonInput(args);
    expect(prepared.request.primaryPassages.map((p) => p.quotation)).toEqual([
        full.quotation,
        "A separate useful disclosure.",
    ]);
    expect(prepared.request.findings[0]?.primaryPassageKeys).toHaveLength(2);
});

test("extra retrieved context respects the whole request byte budget and preserves priority evidence for every finding", () => {
    const args = nativeComparisonArgs(
        Array.from(
            { length: 64 },
            (_, i) => `Disclosure ${i}. ${"Evidence context. ".repeat(210)}`,
        ),
    );
    args.target = makeTarget([
        [{ passageKey: "target0", quotation: "Check annual revenue." }],
        [
            {
                passageKey: "target1",
                quotation: "Check contractual commitments.",
            },
        ],
    ]);
    const firstRanking = args.retrieval.rankings[0];
    if (!firstRanking) throw new Error("Missing first ranking");
    args.retrieval.rankings.push({
        findingIndex: 1,
        passageKeys: [...firstRanking.passageKeys].reverse(),
    });
    const prepared = prepareSourceComparisonInput({
        ...args,
        retrieval: {
            ...args.retrieval,
            contextExpansionByteLimit: SOURCE_COMPARISON_MAX_INPUT_BYTES,
        },
    });
    expect(prepared.request.findings).toHaveLength(2);
    expect(
        prepared.request.findings.every(
            (f) => f.primaryPassageKeys.length === 6,
        ),
    ).toBe(true);
    expect(prepared.request.primaryPassages.length).toBeGreaterThan(12);
    expect(prepared.request.primaryPassages.length).toBeLessThanOrEqual(64);
    expect(prepared.serializedRequestBytes).toBeLessThanOrEqual(
        SOURCE_COMPARISON_MAX_INPUT_BYTES,
    );
    expect(prepared.request.completeness.omittedPrimaryPassageCount).toBe(
        64 - prepared.request.primaryPassages.length,
    );
    expect(
        prepared.request.primaryPassages.some((p) =>
            p.quotation.startsWith("Disclosure 63."),
        ),
    ).toBe(true);
});

test("default context expansion stays within 32 KiB and does not alter unversioned selection", () => {
    const args = nativeComparisonArgs(
        Array.from(
            { length: 32 },
            (_, i) =>
                `Disclosure ${i}. ${"Annual revenue context. ".repeat(55)}`,
        ),
    );
    const current = prepareSourceComparisonInput(args);
    expect(current.request.primaryPassages.length).toBeGreaterThan(6);
    expect(current.serializedRequestBytes).toBeLessThanOrEqual(32 * 1024);
    const { retrieval: _retrieval, ...legacy } = args;
    expect(
        prepareSourceComparisonInput(legacy).request.primaryPassages,
    ).toHaveLength(6);
    expect(() =>
        prepareSourceComparisonInput({
            ...args,
            retrieval: {
                ...args.retrieval,
                contextExpansionByteLimit:
                    SOURCE_COMPARISON_MAX_INPUT_BYTES + 1,
            },
        }),
    ).toThrow("Invalid comparison context expansion budget");
});
