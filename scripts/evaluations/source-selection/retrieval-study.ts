import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ConvexHttpClient } from "convex/browser";
import { type FunctionReturnType, makeFunctionReference } from "convex/server";
import { createServer } from "vite";
import type { LoadedStudy } from "./source-quality-study.ts";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const save = (p: string, x: unknown) =>
    writeFileSync(p, `${JSON.stringify(x, null, 2)}\n`, { flag: "wx" });
const POLICY_FILES = [
    "convex/domain/sourcePassages.ts",
    "convex/domain/sourceRetrievalPolicy.ts",
    "convex/domain/sourceComparison.ts",
    "convex/integrations/sourceEmbeddings.ts",
];
type Passage = {
    order: number;
    quotation: string;
    startOffset: number;
    endOffset: number;
    headingPath: string[];
    searchText: string;
    textHash: string;
};
type FrozenDocument = {
    id: string;
    companyId: string;
    category: string;
    title: string;
    url: string;
    textFile: string;
    contentHash: string;
    passages: Passage[];
};
type FrozenCase = {
    id: string;
    companyId: string;
    topic: string;
    condition: string;
    query: string;
    primaryDocumentIds: string[];
    required: Array<{
        documentId: string;
        startOffset: number;
        endOffset: number;
    }>;
};
type Frozen = {
    version: string;
    frozenAt: string;
    studyHash: string;
    policyHashes: Record<string, string>;
    profile: string;
    documents: FrozenDocument[];
    cases: FrozenCase[];
    companies: LoadedStudy["study"]["companies"];
    budgetUsd: number;
};
type State = Record<
    string,
    {
        runId: Id<"researchRuns">;
        preparationId: Id<"sourceSelectionProposalRebuilds">;
        captures: Record<string, Id<"sourceCaptures">>;
    }
>;
type NativeResult = {
    caseId: string;
    mode: string;
    metadata: { effectiveMode: string; degradationReason?: string };
    latencyMs: number;
    inputBytes: number;
    complete: boolean;
    matched: number;
    required: number;
    provenanceFailures: number;
    selected: Array<{
        documentId: string;
        startOffset: number;
        endOffset: number;
        quotation: string;
    }>;
};

function studyEntry<T extends { id: string }>(
    entries: readonly T[],
    id: string,
): T {
    const entry = entries.find((entry) => entry.id === id);
    assert(entry, `Unknown frozen study entry: ${id}`);
    return entry;
}

function captureForDocument(
    captures: State[string]["captures"],
    id: string,
): Id<"sourceCaptures"> {
    const capture = captures[id];
    assert(capture, `Document has not been indexed: ${id}`);
    return capture;
}

function freezeRetrievalStudy(
    loaded: LoadedStudy,
    extractPassagesFromNormalizedText: typeof import("@convex/domain/sourcePassages").extractPassagesFromNormalizedText,
    shortRetrievalQuery: typeof import("@convex/domain/sourceRetrievalPolicy").shortRetrievalQuery,
    profileId: string,
    sourceComparisonQuery: typeof import("@convex/domain/sourceRetrievalPolicy").sourceComparisonQuery,
): Frozen {
    const documents = loaded.documents.map((d) => ({
        ...d,
        passages: extractPassagesFromNormalizedText({
            text: d.text,
            canonicalUrl: d.url,
            sourceVersionHash: d.contentHash,
            preparationVersion: "structured-v1",
        }).map((p) => {
            const searchText = [
                ...(p.headingPath ?? []),
                p.exactQuotation,
            ].join("\n");
            return {
                order: p.order,
                quotation: p.exactQuotation,
                startOffset: p.locator.startOffset,
                endOffset: p.locator.endOffset,
                headingPath: p.headingPath ?? [],
                searchText,
                textHash: hash(searchText),
            };
        }),
    }));
    const cases: FrozenCase[] = loaded.study.controls.flatMap((c) => {
        const target = studyEntry(loaded.documents, c.targetDocumentId);
        const query = shortRetrievalQuery(
            sourceComparisonQuery(
                {
                    passages: [
                        {
                            quotation: target.text.slice(
                                c.span.startOffset,
                                c.span.endOffset,
                            ),
                        },
                    ],
                    period: "unspecified",
                },
                null,
            ),
        );
        return ["focused", "distractors"].map((condition) => ({
            id: `${c.id}:${condition}`,
            companyId: c.companyId,
            topic: c.topic,
            condition,
            query,
            primaryDocumentIds:
                condition === "focused"
                    ? c.primaryDocumentIds
                    : documents
                          .filter(
                              (d) =>
                                  d.companyId === c.companyId &&
                                  [
                                      "annual",
                                      "quarterly",
                                      "product",
                                      "integration",
                                      "terms",
                                  ].includes(d.category),
                          )
                          .map((d) => d.id),
            required: c.primaryEvidence,
        }));
    });
    // References are full source spans, never the subset returned by a ranker.
    for (const c of cases)
        for (const ref of c.required) {
            const d = studyEntry(loaded.documents, ref.documentId);
            assert(
                ref.endOffset <= d.text.length &&
                    ref.endOffset > ref.startOffset,
                "Invalid full-evidence reference",
            );
        }
    const frozen: Frozen = {
        version: "retrieval-study-v1",
        frozenAt: new Date().toISOString(),
        studyHash: loaded.studySha256,
        policyHashes: Object.fromEntries(
            POLICY_FILES.map((p) => [p, hash(readFileSync(p, "utf8"))]),
        ),
        profile: profileId,
        documents: documents.map(({ text: _text, ...d }) => d),
        cases,
        companies: loaded.study.companies,
        budgetUsd: 0.1,
    };
    return frozen;
}

function scoreFrozenRetrieval(
    frozen: Frozen,
    dir: string,
    priceCeilingPerMillionTokens: number,
) {
    const results = readFileSync(join(dir, "native-results.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((s) => JSON.parse(s)) as NativeResult[];
    const unique = new Map(results.map((r) => [`${r.caseId}:${r.mode}`, r]));
    const metrics = frozen.companies.flatMap((c) =>
        ["lexical", "hybrid"].map((mode) => {
            const rows = [...unique.values()].filter(
                (r) => r.mode === mode && r.caseId.startsWith(`${c.id}-`),
            );
            return {
                company: c.id,
                mode,
                cases: rows.length,
                complete: rows.filter((r) => r.complete).length,
                matched: rows.reduce((n, r) => n + r.matched, 0),
                required: rows.reduce((n, r) => n + r.required, 0),
                degraded: rows.filter((r) => r.metadata.effectiveMode !== mode)
                    .length,
                provenanceFailures: rows.reduce(
                    (n, r) => n + r.provenanceFailures,
                    0,
                ),
            };
        }),
    );
    const comparable = frozen.cases.every((c) =>
        ["lexical", "hybrid"].every((m) => unique.has(`${c.id}:${m}`)),
    );
    const noRegression =
        frozen.companies.every((c) => {
            const pair = metrics.filter((m) => m.company === c.id);
            const [lexical, hybrid] = pair;
            assert(lexical && hybrid, "Missing company comparison");
            return hybrid.complete >= lexical.complete;
        }) &&
        [...new Set(frozen.cases.map((c) => c.topic))].every((topic) => {
            const ids = frozen.cases
                .filter((c) => c.topic === topic)
                .map((c) => c.id);
            return (
                ids.filter((id) => unique.get(`${id}:hybrid`)?.complete)
                    .length >=
                ids.filter((id) => unique.get(`${id}:lexical`)?.complete).length
            );
        });
    const heldoutImprovement = frozen.cases.some(
        (c) =>
            frozen.companies.find((x) => x.id === c.companyId)?.split ===
                "holdout" &&
            unique.get(`${c.id}:hybrid`)?.complete &&
            !unique.get(`${c.id}:lexical`)?.complete,
    );
    const provenanceFailures = metrics.reduce(
        (n, m) => n + m.provenanceFailures,
        0,
    );
    const partial = metrics.some((m) => m.degraded > 0);
    const journal = readFileSync(join(dir, "provider-journal.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { reservedBytes: number });
    const smokePath = join(dir, "provider-smoke.json");
    const smoke = existsSync(smokePath)
        ? (read(smokePath) as { inputBytes: number })
        : undefined;
    const smokeBytes = smoke?.inputBytes ?? 0;
    assert(
        Number.isSafeInteger(smokeBytes) && smokeBytes >= 0,
        "Invalid smoke input allowance",
    );
    const conservativeCostUsd =
        ((smokeBytes +
            journal.reduce((n, event) => n + event.reservedBytes, 0)) *
            priceCeilingPerMillionTokens) /
        1e6;
    const withinBudget = conservativeCostUsd <= frozen.budgetUsd;
    const qualification = readFileSync(
        join(dir, "qualification-results.jsonl"),
        "utf8",
    )
        .trim()
        .split("\n")
        .map(
            (line) =>
                JSON.parse(line) as {
                    documentId: string;
                    mode: string;
                    effectiveMode: string;
                    legacyReferenceAvailable: boolean;
                    referenceAvailable: boolean;
                },
        );
    const qualificationMetrics = ["lexical", "hybrid"].map((mode) => {
        const rows = qualification.filter((r) => r.mode === mode);
        return {
            mode,
            documents: rows.length,
            legacyAvailable: rows.filter((r) => r.legacyReferenceAvailable)
                .length,
            referenceAvailable: rows.filter((r) => r.referenceAvailable).length,
            legacyLosses: rows
                .filter(
                    (r) => r.legacyReferenceAvailable && !r.referenceAvailable,
                )
                .map((r) => r.documentId),
            degraded: rows.filter((r) => r.mode !== r.effectiveMode).length,
        };
    });
    const qualificationPreserved = qualificationMetrics.every(
        (m) =>
            m.documents === 32 &&
            m.legacyLosses.length === 0 &&
            m.degraded === 0,
    );
    const winner =
        comparable &&
        noRegression &&
        heldoutImprovement &&
        !provenanceFailures &&
        !partial &&
        withinBudget &&
        qualificationPreserved
            ? "hybrid"
            : "lexical";
    const report = {
        metrics,
        qualificationMetrics,
        qualificationPreserved,
        conservativeCostUsd,
        withinBudget,
        providerAttempts: journal.length + (smoke ? 1 : 0),
        comparable,
        noRegression,
        heldoutImprovement,
        provenanceFailures,
        partial,
        winner,
        groundTruth:
            "Investigator-authored historical references, not independent blinded human ground truth",
        frozenReferenceHash: hash(
            readFileSync(join(dir, "freeze.json"), "utf8"),
        ),
    };
    return report;
}

function buildRetrievalPerturbations(
    loaded: LoadedStudy,
    frozen: Frozen,
    companies: Frozen["companies"],
    extractPassagesFromNormalizedText: typeof import("@convex/domain/sourcePassages").extractPassagesFromNormalizedText,
) {
    const baseDocuments = [...loaded.documents];
    const baseControls = [...loaded.study.controls];
    const syntheticDocuments: typeof loaded.documents = [];
    const syntheticFrozen: FrozenDocument[] = [];
    const syntheticControls: typeof loaded.study.controls = [];
    const syntheticCases: FrozenCase[] = [];
    const mapping: unknown[] = [];
    const syntheticCompanies: typeof companies = [];
    for (const company of companies)
        for (const condition of ["late", "reordered"]) {
            const numeric = baseControls.find(
                (c) => c.companyId === company.id && c.topic === "numeric",
            );
            assert(numeric, "Missing numeric perturbation control");
            const variantCompanyId = `${company.id}-${condition}`;
            syntheticCompanies.push({
                ...company,
                id: variantCompanyId,
            });
            const cuts = new Map<string, number>();
            const lengths = new Map<string, number>();
            for (const d of baseDocuments.filter(
                (d) => d.companyId === company.id,
            )) {
                const references = numeric.primaryEvidence.filter(
                    (r) => r.documentId === d.id,
                );
                let cut =
                    condition === "late" && references.length
                        ? Math.max(...references.map((r) => r.endOffset))
                        : Math.floor(d.text.length / 2);
                cut = d.text.indexOf("\n\n", cut);
                if (cut < 0) cut = 0;
                while (
                    references.some(
                        (r) => r.startOffset < cut && r.endOffset > cut,
                    )
                ) {
                    cut = d.text.indexOf(
                        "\n\n",
                        Math.max(
                            ...references
                                .filter(
                                    (r) =>
                                        r.startOffset < cut &&
                                        r.endOffset > cut,
                                )
                                .map((r) => r.endOffset),
                        ),
                    );
                    if (cut < 0) {
                        cut = 0;
                        break;
                    }
                }
                if (!numeric.primaryDocumentIds.includes(d.id)) cut = 0;
                const text = cut
                    ? `${d.text.slice(cut)}\n\n${d.text.slice(0, cut)}`
                    : d.text;
                cuts.set(d.id, cut);
                lengths.set(d.id, d.text.length);
                const variant = {
                    ...d,
                    id: `${d.id}-${condition}`,
                    companyId: variantCompanyId,
                    text,
                    contentHash: hash(text),
                    title: `Synthetic ${condition}: ${d.title}`,
                };
                syntheticDocuments.push(variant);
                const passages = extractPassagesFromNormalizedText({
                    text,
                    canonicalUrl: d.url,
                    sourceVersionHash: variant.contentHash,
                    preparationVersion: "structured-v1",
                }).map((p) => {
                    const searchText = [
                        ...(p.headingPath ?? []),
                        p.exactQuotation,
                    ].join("\n");
                    return {
                        order: p.order,
                        quotation: p.exactQuotation,
                        startOffset: p.locator.startOffset,
                        endOffset: p.locator.endOffset,
                        headingPath: p.headingPath ?? [],
                        searchText,
                        textHash: hash(searchText),
                    };
                });
                const { text: _text, ...metadata } = variant;
                syntheticFrozen.push({ ...metadata, passages });
                mapping.push({
                    documentId: variant.id,
                    originalDocumentId: d.id,
                    originalHash: d.contentHash,
                    transformedHash: variant.contentHash,
                    cut,
                    condition,
                });
            }
            const required = numeric.primaryEvidence.map((r) => {
                const cut = cuts.get(r.documentId);
                const length = lengths.get(r.documentId);
                assert(
                    cut !== undefined && length !== undefined,
                    "Missing synthetic span mapping",
                );
                const shift =
                    cut && r.startOffset < cut ? length - cut + 2 : -cut;
                return {
                    ...r,
                    documentId: `${r.documentId}-${condition}`,
                    startOffset: r.startOffset + shift,
                    endOffset: r.endOffset + shift,
                };
            });
            const control = {
                ...numeric,
                id: `${numeric.id}-${condition}`,
                companyId: variantCompanyId,
                targetDocumentId: `${numeric.targetDocumentId}-${condition}`,
                primaryDocumentIds: numeric.primaryDocumentIds.map(
                    (id) => `${id}-${condition}`,
                ),
                primaryEvidence: required,
            };
            syntheticControls.push(control);
            const originalCase = frozen.cases.find(
                (c) => c.id === `${numeric.id}:focused`,
            );
            assert(originalCase, "Missing focused reference case");
            syntheticCases.push({
                ...originalCase,
                id: `${control.id}:focused`,
                companyId: variantCompanyId,
                primaryDocumentIds: control.primaryDocumentIds,
                required,
                condition: "focused",
            });
        }
    return {
        documents: syntheticDocuments,
        frozenDocuments: syntheticFrozen,
        controls: syntheticControls,
        cases: syntheticCases,
        companies: syntheticCompanies,
        mapping,
    };
}

/** Builds the same production comparison input for native execution and offline retention replay. */
export function prepareRetrievedStudyComparison(
    loaded: LoadedStudy,
    frozen: Frozen,
    company: LoadedStudy["study"]["companies"][number],
    c: FrozenCase,
    s: State[string],
    result: FunctionReturnType<typeof internal.sourceRetrievalActions.retrieve>,
    prepareSourceComparisonInput: typeof import("@convex/domain/sourceComparison").prepareSourceComparisonInput,
    contextExpansionByteLimit?: number,
) {
    const control = loaded.study.controls.find(
        (x) => `${x.id}:${c.condition}` === c.id,
    );
    assert(control, "Missing frozen comparison control");
    const target = studyEntry(loaded.documents, control.targetDocumentId);
    const targetQuotation = target.text.slice(
        control.span.startOffset,
        control.span.endOffset,
    );
    const byId = new Map(
        result.passages.map((p) => [p.id, `${p.captureId}:p${p.order}`]),
    );
    const prepared = prepareSourceComparisonInput({
        company: {
            cik: company.cik,
            legalName: company.legalName,
            ticker: company.ticker,
        },
        target: {
            runId: s.runId,
            corpusRevisionId: "evaluation-revision",
            sourceId: target.id,
            captureId: captureForDocument(s.captures, target.id),
            contentHash: target.contentHash,
            qualificationTaskId: "evaluation-qualification",
            title: target.title,
            canonicalUrl: target.url,
            text: target.text,
            selectedPassages: [{ passageKey: "target", ...control.span }],
            qualification: {
                companyMatch: "subject",
                companyPassages: [],
                documentKind: "independent_analysis",
                reportingPeriodEnd: null,
                reportingPeriodPassages: [],
                findings: [
                    {
                        role: "counter_evidence_primary",
                        kind: control.kind,
                        summary: targetQuotation.slice(0, 600),
                        passages: [
                            {
                                passageKey: "target",
                                quotation: targetQuotation,
                            },
                        ],
                        period: "unspecified",
                        periodPassages: [],
                        dependsOnFlaggedAssertion: false,
                    },
                ],
                limitations: [],
            },
        },
        primaryCandidates: c.primaryDocumentIds.map((id) => {
            const d = studyEntry(frozen.documents, id);
            const original = studyEntry(loaded.documents, id);
            return {
                sourceId: id,
                captureId: captureForDocument(s.captures, id),
                contentHash: d.contentHash,
                title: d.title,
                canonicalUrl: d.url,
                authorityTier: ["annual", "quarterly"].includes(d.category)
                    ? ("regulator_primary" as const)
                    : ("company_primary" as const),
                documentKind:
                    d.category === "annual"
                        ? ("regulatory_annual" as const)
                        : d.category === "quarterly"
                          ? ("regulatory_interim" as const)
                          : ("official_product_documentation" as const),
                reportingPeriodEnd: null,
                text: original.text,
                passages: d.passages.map((p) => ({
                    passageKey: `p${p.order}`,
                    startOffset: p.startOffset,
                    endOffset: p.endOffset,
                    quotation: p.quotation,
                    headingPath: p.headingPath,
                })),
            };
        }),
        retrieval: {
            contextExpansionByteLimit,
            metadata: result.metadata,
            rankings: [
                {
                    findingIndex: 0,
                    passageKeys: (result.rankings[0] ?? []).map((id) => {
                        const key = byId.get(id);
                        assert(key, "Native result omits a ranked passage");
                        return key;
                    }),
                },
            ],
        },
    });
    return prepared;
}

/** Extends the study runner with retrieval-only phases. No phase can invoke a generative model. */
export async function runRetrievalStudyCli(args: string[]) {
    const known = new Set([
        "--retrieval-phase",
        "--retrieval-mode",
        "--study",
        "--run-dir",
        "--company",
        "--slot-key",
        "--report-file",
    ]);
    const options = new Map<string, string>();
    for (let i = 0; i < args.length; i += 2) {
        const k = args[i],
            v = args[i + 1];
        assert(
            k && known.has(k) && v && !v.startsWith("--") && !options.has(k),
            "Invalid retrieval option",
        );
        options.set(k, v);
    }
    const phase = options.get("--retrieval-phase");
    assert(
        phase &&
            [
                "freeze",
                "export",
                "native",
                "import",
                "score",
                "finish",
                "qualification",
                "export-qualification",
                "perturb",
            ].includes(phase),
        "Unknown retrieval phase",
    );
    const mode = options.get("--retrieval-mode") ?? "both";
    assert(
        ["lexical", "hybrid", "both"].includes(mode),
        "Unknown retrieval mode",
    );
    const studyPath = resolve(
        options.get("--study") ??
            "scripts/evaluations/source-selection/fixtures/cross-company-20261020/study.json",
    );
    const dir = resolve(
        options.get("--run-dir") ??
            "/tmp/evidence-retrieval-implementation-20261021/evaluation",
    );
    mkdirSync(dir, { recursive: true });
    const server = await createServer({
        server: { middlewareMode: true },
        appType: "custom",
    });
    try {
        const { readStudy } = (await server.ssrLoadModule(
            "/scripts/evaluations/source-selection/source-quality-study.ts",
        )) as typeof import("./source-quality-study.ts");
        const loaded = readStudy(studyPath);
        const { extractPassagesFromNormalizedText } =
            (await server.ssrLoadModule(
                "/convex/domain/sourcePassages.ts",
            )) as typeof import("@convex/domain/sourcePassages");
        const { prepareQualificationInput } = (await server.ssrLoadModule(
            "/convex/domain/sourceQualification.ts",
        )) as typeof import("@convex/domain/sourceQualification");
        const { SOURCE_COVERAGE_ROLES, SOURCE_ROLE_REQUIREMENTS } =
            (await server.ssrLoadModule(
                "/convex/domain/sourceSelectionPolicy.ts",
            )) as typeof import("@convex/domain/sourceSelectionPolicy");
        const { prepareSourceComparisonInput } = (await server.ssrLoadModule(
            "/convex/domain/sourceComparison.ts",
        )) as typeof import("@convex/domain/sourceComparison");
        const { shortRetrievalQuery, sourceComparisonQuery } =
            (await server.ssrLoadModule(
                "/convex/domain/sourceRetrievalPolicy.ts",
            )) as typeof import("@convex/domain/sourceRetrievalPolicy");
        const { SOURCE_EMBEDDING_PROFILE: profile, validateEmbeddingVectors } =
            (await server.ssrLoadModule(
                "/convex/integrations/sourceEmbeddings.ts",
            )) as typeof import("@convex/integrations/sourceEmbeddings");
        const freezePath = join(dir, "freeze.json");
        if (phase === "freeze") {
            assert(
                !existsSync(freezePath),
                "Reference is already frozen; use a new run directory",
            );
            const frozen = freezeRetrievalStudy(
                loaded,
                extractPassagesFromNormalizedText,
                shortRetrievalQuery,
                profile.id,
                sourceComparisonQuery,
            );
            save(freezePath, frozen);
            console.log(
                JSON.stringify({
                    phase,
                    documents: frozen.documents.length,
                    cases: frozen.cases.length,
                    referenceHash: hash(readFileSync(freezePath, "utf8")),
                }),
            );
            return;
        }
        const frozen = read(freezePath) as Frozen;
        const fixtureNamespace = hash(readFileSync(freezePath, "utf8")).slice(
            0,
            12,
        );
        assert.equal(
            frozen.studyHash,
            loaded.studySha256,
            "Study changed after freeze",
        );
        assert.equal(frozen.profile, profile.id, "Embedding profile changed");
        for (const [p, h] of Object.entries(frozen.policyHashes))
            assert.equal(
                hash(readFileSync(p, "utf8")),
                h,
                `Policy changed after freeze: ${p}`,
            );
        let companies = frozen.companies.filter(
            (c) =>
                !options.get("--company") || c.id === options.get("--company"),
        );
        assert(companies.length, "Unknown company");
        if (phase === "export-qualification") {
            const texts = SOURCE_COVERAGE_ROLES.map((role) =>
                shortRetrievalQuery(
                    `${role.replaceAll("_", " ")}  ${SOURCE_ROLE_REQUIREMENTS[role].description}`,
                ),
            );
            save(join(dir, "embedding-role-requests.json"), {
                batches: Array.from(
                    { length: Math.ceil(texts.length / 8) },
                    (_, i) => ({
                        id: i,
                        profile: profile.id,
                        items: texts
                            .slice(i * 8, (i + 1) * 8)
                            .map((text) => ({ text, textHash: hash(text) })),
                    }),
                ),
            });
            console.log(JSON.stringify({ phase, texts: texts.length }));
            return;
        }
        if (phase === "export") {
            const unique = new Map<string, string>();
            for (const d of frozen.documents)
                for (const p of d.passages)
                    unique.set(p.textHash, p.searchText);
            for (const c of frozen.cases) unique.set(hash(c.query), c.query);
            const texts = [...unique].map(([textHash, text]) => ({
                textHash,
                text,
            }));
            assert(
                texts.every(
                    (t) =>
                        Buffer.byteLength(t.text) <= profile.maximumTextBytes,
                ),
                "Embedding text exceeds model input policy",
            );
            const bytes = texts.reduce(
                (n, t) => n + Buffer.byteLength(t.text),
                0,
            );
            const estimatedCeilingUsd =
                (bytes * profile.priceCeilingPerMillionTokens) / 1e6;
            assert(
                estimatedCeilingUsd + 0.000001 <= frozen.budgetUsd,
                "Embedding experiment would exceed approval ceiling",
            );
            const batches = Array.from(
                { length: Math.ceil(texts.length / 32) },
                (_, i) => ({
                    id: i,
                    profile: profile.id,
                    items: texts.slice(i * 32, (i + 1) * 32),
                }),
            );
            save(join(dir, "embedding-requests.json"), {
                bytes,
                estimatedCeilingUsd,
                batches,
            });
            console.log(
                JSON.stringify({
                    phase,
                    uniqueTexts: texts.length,
                    batches: batches.length,
                    bytes,
                    estimatedCeilingUsd,
                }),
            );
            return;
        }
        if (phase === "score") {
            const report = scoreFrozenRetrieval(
                frozen,
                dir,
                profile.priceCeilingPerMillionTokens,
            );
            save(
                join(dir, options.get("--report-file") ?? "score.json"),
                report,
            );
            console.log(JSON.stringify(report, null, 2));
            return;
        }
        const config = read(resolve(".convex/local/default/config.json"));
        assert(
            config.adminKey && config.ports?.cloud === 3210,
            "Expected existing local Convex configuration",
        );
        const client = new ConvexHttpClient("http://127.0.0.1:3210");
        (
            client as ConvexHttpClient & { setAdminAuth(key: string): void }
        ).setAdminAuth(config.adminKey);
        const statePath = join(dir, "native-state.json");
        const state: State = existsSync(statePath) ? read(statePath) : {};
        const persist = () =>
            writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
        if (phase === "perturb") {
            assert(
                mode === "lexical",
                "Synthetic acceptance uses the selected lexical method without further paid inference",
            );
            const synthetic = buildRetrievalPerturbations(
                loaded,
                frozen,
                companies,
                extractPassagesFromNormalizedText,
            );
            save(join(dir, "perturbation-freeze.json"), {
                createdAt: new Date().toISOString(),
                policyHashes: frozen.policyHashes,
                mapping: synthetic.mapping,
                cases: synthetic.cases,
            });
            loaded.documents.splice(
                0,
                loaded.documents.length,
                ...synthetic.documents,
            );
            loaded.study.controls.splice(
                0,
                loaded.study.controls.length,
                ...synthetic.controls,
            );
            frozen.documents = synthetic.frozenDocuments;
            frozen.cases = synthetic.cases;
            companies = synthetic.companies;
        }
        if (phase === "native" || phase === "perturb") {
            for (const company of companies) {
                if (!state[company.id]) {
                    state[company.id] = {
                        ...(await client.mutation(
                            makeFunctionReference<"mutation">(
                                "retrievalEvaluation:seed",
                            ),
                            {
                                slotKey:
                                    options.get("--slot-key") ?? "analyst-4",
                                fixtureKey: `retrieval-${fixtureNamespace}-${company.id}`,
                                company: {
                                    cik: company.cik,
                                    legalName: company.legalName,
                                    ticker: company.ticker,
                                },
                            },
                        )),
                        captures: {},
                    };
                    persist();
                }
                const s = state[company.id];
                assert(s, "Missing indexed company state");
                for (const d of frozen.documents.filter(
                    (d) => d.companyId === company.id,
                ))
                    if (!s.captures[d.id]) {
                        const original = studyEntry(loaded.documents, d.id);
                        const result = await client.action(
                            makeFunctionReference<"action">(
                                "retrievalEvaluation:addDocument",
                            ),
                            {
                                preparationId: s.preparationId,
                                documentKey: d.id,
                                url: d.url,
                                title: d.title,
                                text: original.text,
                                contentHash: d.contentHash,
                            },
                        );
                        s.captures[d.id] = result.captureId;
                        persist();
                    }
                for (const selectedMode of mode === "both"
                    ? ["lexical", "hybrid"]
                    : [mode])
                    for (const c of frozen.cases.filter(
                        (c) => c.companyId === company.id,
                    )) {
                        const started = performance.now();
                        const result = (await client.action(
                            makeFunctionReference<"action">(
                                "sourceRetrievalActions:retrieve",
                            ),
                            {
                                preparationId: s.preparationId,
                                captureIds: c.primaryDocumentIds.map(
                                    (id) => s.captures[id],
                                ),
                                queries: [c.query],
                                mode: selectedMode,
                            },
                        )) as FunctionReturnType<
                            typeof internal.sourceRetrievalActions.retrieve
                        >;
                        const reverse = new Map(
                            Object.entries(s.captures).map(([id, capture]) => [
                                capture,
                                id,
                            ]),
                        );
                        const prepared = prepareRetrievedStudyComparison(
                            loaded,
                            frozen,
                            company,
                            c,
                            s,
                            result,
                            prepareSourceComparisonInput,
                        );
                        const selected = prepared.request.primaryPassages.map(
                            (p) => {
                                const documentId = reverse.get(
                                    p.captureId as Id<"sourceCaptures">,
                                );
                                assert(documentId, "Unmapped native capture");
                                return {
                                    documentId,
                                    startOffset: p.startOffset,
                                    endOffset: p.endOffset,
                                    quotation: p.quotation,
                                };
                            },
                        );
                        const matched = c.required.filter((ref) => {
                            const original = studyEntry(
                                loaded.documents,
                                ref.documentId,
                            ).text;
                            let cursor = ref.startOffset;
                            for (const p of selected
                                .filter((p) => p.documentId === ref.documentId)
                                .sort(
                                    (a, b) => a.startOffset - b.startOffset,
                                )) {
                                if (p.endOffset <= cursor) continue;
                                if (
                                    p.startOffset > cursor &&
                                    original
                                        .slice(
                                            cursor,
                                            Math.min(
                                                p.startOffset,
                                                ref.endOffset,
                                            ),
                                        )
                                        .trim()
                                )
                                    return false;
                                cursor = Math.max(cursor, p.endOffset);
                                if (cursor >= ref.endOffset) return true;
                            }
                            return cursor >= ref.endOffset;
                        }).length;
                        const provenanceFailures = selected.filter(
                            (p) =>
                                studyEntry(
                                    loaded.documents,
                                    p.documentId,
                                ).text.slice(p.startOffset, p.endOffset) !==
                                p.quotation,
                        ).length;
                        appendFileSync(
                            join(
                                dir,
                                phase === "perturb"
                                    ? "perturbation-results.jsonl"
                                    : "native-results.jsonl",
                            ),
                            `${JSON.stringify({ caseId: c.id, mode: selectedMode, metadata: result.metadata, latencyMs: performance.now() - started, inputBytes: prepared.serializedRequestBytes, complete: matched === c.required.length && c.required.length > 0, matched, required: c.required.length, provenanceFailures, selected })}\n`,
                        );
                    }
                if (phase === "perturb")
                    await client.mutation(
                        makeFunctionReference<"mutation">(
                            "retrievalEvaluation:finish",
                        ),
                        { preparationId: s.preparationId },
                    );
                console.log(
                    JSON.stringify({ phase, company: company.id, mode }),
                );
            }
            return;
        }
        if (phase === "qualification") {
            const queries = SOURCE_COVERAGE_ROLES.map(
                (role) =>
                    `${role.replaceAll("_", " ")}  ${SOURCE_ROLE_REQUIREMENTS[role].description}`,
            );
            for (const company of companies) {
                const s = state[company.id];
                assert(s, "Index company captures first");
                for (const d of loaded.documents.filter(
                    (d) => d.companyId === company.id,
                )) {
                    const input = {
                        company: {
                            cik: company.cik,
                            legalName: company.legalName,
                            ticker: company.ticker,
                        },
                        canonicalUrl: d.url,
                        title: d.title,
                        asOfTime: Date.parse(d.capturedAt),
                        text: d.text,
                    };
                    const legacy = prepareQualificationInput(input);
                    for (const selectedMode of mode === "both"
                        ? ["lexical", "hybrid"]
                        : [mode]) {
                        const result = (await client.action(
                            makeFunctionReference<"action">(
                                "sourceRetrievalActions:retrieve",
                            ),
                            {
                                preparationId: s.preparationId,
                                captureIds: [s.captures[d.id]],
                                queries,
                                mode: selectedMode,
                            },
                        )) as FunctionReturnType<
                            typeof internal.sourceRetrievalActions.retrieve
                        >;
                        const prepared = prepareQualificationInput({
                            ...input,
                            retrieval: {
                                metadata: result.metadata,
                                passageOrders: result.passages.map(
                                    (p) => p.order,
                                ),
                            },
                        });
                        const contains = (
                            passages: typeof prepared.request.document.passages,
                        ) =>
                            passages.some(
                                (p) =>
                                    p.startOffset <=
                                        d.selectedSpan.startOffset &&
                                    p.endOffset >= d.selectedSpan.endOffset,
                            );
                        appendFileSync(
                            join(dir, "qualification-results.jsonl"),
                            `${JSON.stringify({ documentId: d.id, mode: selectedMode, effectiveMode: result.metadata.effectiveMode, legacyReferenceAvailable: contains(legacy.request.document.passages), referenceAvailable: contains(prepared.request.document.passages), selected: prepared.request.document.passages.length, readingCompleteness: prepared.readingCompleteness })}\n`,
                        );
                    }
                }
                console.log(
                    JSON.stringify({ phase, company: company.id, mode }),
                );
            }
            return;
        }
        if (phase === "import") {
            const requests = read(join(dir, "embedding-requests.json")) as {
                batches: Array<{
                    id: number;
                    items: Array<{ text: string; textHash: string }>;
                }>;
            };
            const vectors = new Map<string, number[]>();
            for (const batch of requests.batches) {
                const file = join(dir, `embedding-response-${batch.id}.json`);
                assert(existsSync(file), `Missing embedding batch ${batch.id}`);
                const response = read(file);
                assert.equal(
                    response.inputHash,
                    hash(JSON.stringify(batch.items.map((x) => x.text))),
                    "Embedding input hash mismatch",
                );
                const data = validateEmbeddingVectors(
                    response.result,
                    batch.items.length,
                );
                assert(data, `Invalid vector batch ${batch.id}`);
                batch.items.forEach((item, i) => {
                    const vector = data[i];
                    assert(vector, "Missing validated embedding");
                    vectors.set(item.textHash, vector);
                });
            }
            for (const c of companies) {
                const s = state[c.id];
                assert(s, "Run native lexical indexing first");
                for (const d of frozen.documents.filter(
                    (d) => d.companyId === c.id,
                ))
                    for (let i = 0; i < d.passages.length; i += 32) {
                        await client.mutation(
                            makeFunctionReference<"mutation">(
                                "retrievalEvaluation:importVectors",
                            ),
                            {
                                preparationId: s.preparationId,
                                captureId: s.captures[d.id],
                                profile: profile.id,
                                items: d.passages.slice(i, i + 32).map((p) => ({
                                    order: p.order,
                                    textHash: p.textHash,
                                    vector: vectors.get(p.textHash),
                                })),
                            },
                        );
                    }
                await client.mutation(
                    makeFunctionReference<"mutation">(
                        "retrievalEvaluation:importQueryVectors",
                    ),
                    {
                        preparationId: s.preparationId,
                        profile: profile.id,
                        items: frozen.cases
                            .filter((x) => x.companyId === c.id)
                            .map((x) => ({
                                text: x.query,
                                vector: vectors.get(hash(x.query)),
                            })),
                    },
                );
            }
            if (existsSync(join(dir, "embedding-role-vectors.json"))) {
                const role = read(join(dir, "embedding-role-vectors.json"));
                for (const c of companies) {
                    const companyState = state[c.id];
                    assert(companyState, "Missing indexed company");
                    await client.mutation(
                        makeFunctionReference<"mutation">(
                            "retrievalEvaluation:importQueryVectors",
                        ),
                        {
                            preparationId: companyState.preparationId,
                            profile: profile.id,
                            items: role.items,
                        },
                    );
                }
            }
            console.log(JSON.stringify({ phase, companies: companies.length }));
            return;
        }
        if (phase === "finish")
            for (const c of companies) {
                const companyState = state[c.id];
                if (companyState)
                    await client.mutation(
                        makeFunctionReference<"mutation">(
                            "retrievalEvaluation:finish",
                        ),
                        { preparationId: companyState.preparationId },
                    );
            }
    } finally {
        await server.close();
    }
}
if (
    process.argv[1] &&
    resolve(process.argv[1]) === resolve(import.meta.filename)
)
    runRetrievalStudyCli(process.argv.slice(2)).catch((error) => {
        console.error(
            error instanceof Error
                ? error.message
                : "Retrieval experiment failed",
        );
        process.exitCode = 1;
    });
