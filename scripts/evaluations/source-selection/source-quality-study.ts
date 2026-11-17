import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import {
    prepareSourceComparisonInput,
    type SourceComparisonPrimaryCandidate,
    sourceComparisonOutputSchema,
} from "@convex/domain/sourceComparison";
import { extractPassagesFromNormalizedText } from "@convex/domain/sourcePassages";
import {
    prepareQualificationInput,
    type SourceQualification,
    sourceQualificationSchema,
} from "@convex/domain/sourceQualification";
import {
    classifySourceComparisonContext,
    SOURCE_DOCUMENT_KINDS,
} from "@convex/domain/sourceSelectionPolicy";
import { z } from "zod";
import {
    type DecisionQuestion,
    evaluationTransport,
    validateAnswers,
} from "./decision-protocol.ts";

const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
export const LONG_COMMON_INPUT_BYTE_LIMIT = 128 * 1024;
const companySchema = z
    .object({
        id: z.string(),
        cik: z.string().regex(/^\d+$/),
        legalName: z.string(),
        ticker: z.string(),
        websiteUrl: z.url(),
        split: z.enum(["development", "holdout"]),
    })
    .strict();
const spanSchema = z
    .object({
        startOffset: z.number().int().nonnegative(),
        endOffset: z.number().int().positive(),
    })
    .strict();
const documentSchema = z
    .object({
        id: z.string(),
        companyId: z.string(),
        category: z.enum([
            "annual",
            "quarterly",
            "product",
            "integration",
            "terms",
            "analysis",
            "news",
            "distractor",
        ]),
        title: z.string(),
        url: z.url().startsWith("https://"),
        capturedAt: z.iso.datetime(),
        textFile: z.string(),
        contentHash: z.string().regex(/^[a-f0-9]{64}$/),
        selectedSpan: spanSchema,
    })
    .strict();
const controlSchema = z
    .object({
        id: z.string(),
        companyId: z.string(),
        targetDocumentId: z.string(),
        span: spanSchema,
        kind: z.enum(["attributed_argument", "forecast"]),
        primaryDocumentIds: z.array(z.string()),
        primaryEvidence: z
            .array(
                z
                    .object({ documentId: z.string(), ...spanSchema.shape })
                    .strict(),
            )
            .max(6)
            .default([]),
        topic: z.enum(["numeric", "forecast", "capability", "unresolved"]),
    })
    .strict();
const questionReferenceSchema = z
    .object({
        accepted: z.array(z.string()).min(1),
        rationale: z.string().min(10),
        evidence: z.array(
            z
                .object({
                    documentId: z.string(),
                    ...spanSchema.shape,
                    quotation: z.string().min(1),
                })
                .strict(),
        ),
        metric: z.enum([
            "classification",
            "usefulness",
            "nature",
            "period",
            "citation",
            "comparison",
        ]),
        unsafeChoices: z.array(z.string()),
    })
    .strict();
const referenceSchema = z
    .object({
        author: z.literal("Investigating assistant"),
        independentHumanGroundTruth: z.literal(false),
        frozenAt: z.iso.datetime(),
        judgments: z.record(
            z.string(),
            z.record(z.string(), questionReferenceSchema),
        ),
        grouped: z.record(
            z.string(),
            z
                .object({
                    rationale: z.string().min(10),
                    expected: z.record(z.string(), z.unknown()),
                })
                .strict(),
        ),
    })
    .strict();
const protocolSchema = z
    .object({
        schemaVersion: z.literal("source-quality-protocol-v1"),
        studyId: z.string(),
        asOfTime: z.iso.datetime(),
        developmentCompany: z.string(),
        holdoutCompanies: z.array(z.string()).length(3),
        categories: z.array(documentSchema.shape.category).length(8),
        selectionRule: z.string(),
        models: z.array(z.string()).length(5),
        integrationExcludedModels: z.array(z.string()),
        commonInputByteLimit: z.literal(24576),
        maximumAttempts: z.literal(416),
        concurrency: z.literal(2),
        timeoutSeconds: z.literal(60),
        instructions: z.string().min(100),
    })
    .strict();
export const studySchema = z
    .object({
        schemaVersion: z.literal("source-quality-study-v1"),
        studyId: z.string(),
        protocolFile: z.string(),
        protocolSha256: z.string(),
        instructionsFrozenAt: z.iso.datetime(),
        companies: z.array(companySchema).length(4),
        documents: z.array(documentSchema).max(32),
        controls: z.array(controlSchema).max(16),
        referenceFile: z.string(),
        inputContractFile: z.string().optional(),
        historicalDatasetFile: z.string(),
        historicalReferenceFile: z.string(),
        historicalDatasetSha256: z.string(),
        historicalReferenceSha256: z.string(),
    })
    .strict();
export type SourceQualityStudy = z.infer<typeof studySchema>;
export type StudyReference = z.infer<typeof referenceSchema>;
type Document = z.infer<typeof documentSchema>;
type Company = z.infer<typeof companySchema>;
export type StudyCase = {
    id: string;
    companyId: string;
    split: "development" | "holdout" | "regression";
    family:
        | "document"
        | "control"
        | "regression"
        | "sensitivity"
        | "long_input";
    state: Record<string, unknown>;
    questions: Record<string, DecisionQuestion>;
    sourceCaseId?: string;
    variant?: string;
};
export type StudyCall = {
    key: string;
    caseId: string;
    companyId: string;
    split: StudyCase["split"];
    family: string;
    task: "choices" | "qualification" | "comparison";
    model: string;
    endpoint: string;
    native: boolean;
    keyName: string;
    body: Record<string, unknown>;
    requestHash: string;
    prepared?: unknown;
    reservationUsd?: number;
};
const question = (
    instructions: string,
    criteria: Record<string, string>,
): DecisionQuestion => ({ type: "choice", instructions, criteria });
const choices = (values: readonly string[]) =>
    Object.fromEntries(
        values.map((value) => [value, value.replaceAll("_", " ")]),
    );
const NATURES =
    sourceQualificationSchema.shape.findings.element.shape.kind.options;

/** Reads only explicitly named study artifacts and binds every subsequent request to their exact bytes. */
export function readStudy(studyPath: string) {
    const filename = resolve(studyPath);
    const directory = resolve(filename, "..");
    const artifactRoot = resolve(directory, "..");
    const files = new Map<string, string>();
    const read = (relative: string) => {
        const path = resolve(directory, relative);
        assert(
            path.startsWith(`${artifactRoot}${sep}`),
            "Study artifact escapes its directory",
        );
        const bytes = readFileSync(path, "utf8");
        files.set(relative, hash(bytes));
        return bytes;
    };
    const study = studySchema.parse(JSON.parse(readFileSync(filename, "utf8")));
    const protocolBytes = read(study.protocolFile);
    assert.equal(
        hash(protocolBytes),
        study.protocolSha256,
        "Study protocol changed after freeze",
    );
    const protocol = protocolSchema.parse(JSON.parse(protocolBytes));
    assert.equal(study.studyId, protocol.studyId, "Study identity mismatch");
    assert.deepEqual(
        study.companies.filter((c) => c.split === "holdout").map((c) => c.id),
        protocol.holdoutCompanies,
        "Holdout assignment changed",
    );
    assert.equal(
        study.companies.find((c) => c.split === "development")?.id,
        protocol.developmentCompany,
    );
    const documents = study.documents.map((document) => {
        const text = read(document.textFile);
        assert.equal(
            hash(text),
            document.contentHash,
            `Capture changed: ${document.id}`,
        );
        assert(
            study.companies.some((c) => c.id === document.companyId),
            "Unknown document company",
        );
        assert(
            document.selectedSpan.endOffset >
                document.selectedSpan.startOffset &&
                document.selectedSpan.endOffset <= text.length,
            "Invalid selected source span",
        );
        return { ...document, text };
    });
    assert.equal(
        new Set(documents.map((d) => d.id)).size,
        documents.length,
        "Duplicate document identity",
    );
    assert.equal(
        new Set(documents.map((d) => `${d.companyId}:${d.category}`)).size,
        documents.length,
        "Duplicate company/category slot",
    );
    const reference = referenceSchema.parse(
        JSON.parse(read(study.referenceFile)),
    );
    assert(
        Date.parse(study.instructionsFrozenAt) <=
            Date.parse(reference.frozenAt),
        "Reference predates instruction freeze",
    );
    const historicalDatasetBytes = read(study.historicalDatasetFile);
    const historicalReferenceBytes = read(study.historicalReferenceFile);
    assert.equal(
        hash(historicalDatasetBytes),
        study.historicalDatasetSha256,
        "Historical dataset changed",
    );
    assert.equal(
        hash(historicalReferenceBytes),
        study.historicalReferenceSha256,
        "Historical reference changed",
    );
    const historical = JSON.parse(historicalDatasetBytes) as {
        cases: Array<{
            id: string;
            state: Record<string, unknown>;
            questions: Record<string, DecisionQuestion>;
        }>;
    };
    const historicalReference = JSON.parse(historicalReferenceBytes) as {
        judgments: Record<string, { expected: Record<string, string[]> }>;
    };
    const inputContract = study.inputContractFile
        ? (JSON.parse(read(study.inputContractFile)) as {
              protocolSha256: string;
              providerInputHashes: Record<string, string>;
              frozenAt: string;
          })
        : undefined;
    if (inputContract) {
        assert.equal(
            inputContract.protocolSha256,
            study.protocolSha256,
            "Input contract protocol changed",
        );
        assert.equal(
            inputContract.frozenAt,
            study.instructionsFrozenAt,
            "Input contract freeze changed",
        );
    }
    return {
        study,
        protocol,
        documents,
        reference,
        historical,
        historicalReference,
        inputContract,
        files,
        studySha256: hash(readFileSync(filename, "utf8")),
    };
}
export type LoadedStudy = ReturnType<typeof readStudy>;

function wireRequest(model: string, item: StudyCase, instructions: string) {
    const transport = evaluationTransport(model);
    const state = item.state;
    const nativeQuestions = Object.fromEntries(
        Object.entries(item.questions).map(([id, q]) => [
            id,
            { ...q, instructions: `${instructions}\n\n${q.instructions}` },
        ]),
    );
    const body: Record<string, unknown> = transport.native
        ? {
              model,
              state,
              questions: nativeQuestions,
              ...(model.startsWith("jev-")
                  ? {}
                  : { provider: { allow_fallbacks: false } }),
          }
        : {
              model,
              messages: [
                  { role: "system", content: instructions },
                  {
                      role: "user",
                      content: JSON.stringify({
                          state: item.state,
                          questions: item.questions,
                      }),
                  },
              ],
              temperature: 0,
              reasoning: { enabled: false },
              // resource-policy-exception: Frozen source-quality comparison output condition, not an adaptive application default.
              max_tokens: 1024,
              provider: {
                  require_parameters: true,
                  allow_fallbacks: false,
                  only: [
                      model.startsWith("deepseek/") ? "reka" : "deepinfra/fp8",
                  ],
                  max_price: { prompt: 0.15, completion: 0.6 },
              },
              response_format: {
                  type: "json_schema",
                  json_schema: {
                      name: "source_decisions",
                      strict: true,
                      schema: {
                          type: "object",
                          properties: Object.fromEntries(
                              Object.entries(item.questions).map(([id, q]) => [
                                  id,
                                  {
                                      type: "string",
                                      enum: Object.keys(q.criteria),
                                  },
                              ]),
                          ),
                          required: Object.keys(item.questions),
                          additionalProperties: false,
                      },
                  },
              },
          };
    return { ...transport, body };
}

/** Benchmark assignment and local website-classification metadata are not model context. */
function companyForModel(company: Company) {
    return {
        cik: company.cik,
        legalName: company.legalName,
        ticker: company.ticker,
    };
}

function commonDocumentCase(
    document: Document & { text: string },
    company: Company,
    long: boolean,
    asOfTime: string,
): StudyCase {
    const prepared = prepareQualificationInput({
        company: companyForModel(company),
        canonicalUrl: document.url,
        title: document.title,
        asOfTime: Date.parse(asOfTime),
        text: document.text,
    });
    const passages = prepared.request.document.passages;
    const selected = document.text.slice(
        document.selectedSpan.startOffset,
        document.selectedSpan.endOffset,
    );
    return {
        id: `${long ? "long" : "document"}:${document.id}`,
        companyId: company.id,
        split: company.split,
        family: long ? "long_input" : "document",
        state: {
            company: companyForModel(company),
            url: document.url,
            title: document.title,
            asOfDate: asOfTime.slice(0, 10),
            targetExcerpt: selected,
            inspectedPassages: passages,
            partialReading:
                prepared.request.document.readingCompleteness === "partial",
        },
        questions: {
            company: question(
                "What is this document's relationship to the supplied company?",
                choices([
                    "subject",
                    "incidental_mention",
                    "unrelated",
                    "uncertain",
                ]),
            ),
            purpose: question(
                "What is the document's actual purpose? Titles do not establish it.",
                choices(SOURCE_DOCUMENT_KINDS),
            ),
            usefulness: question(
                "Does the inspected content help assess the company's product architecture, commercial control, reported economics or a specific adverse business mechanism? A useful document is not necessarily reliable factual evidence.",
                {
                    useful: "A substantive relevant contribution is established",
                    limited:
                        "Useful context with material scope or applicability limits",
                    not_established:
                        "The supplied content establishes no substantive contribution",
                },
            ),
            nature: question(
                "Classify targetExcerpt by its documentary nature, not the truth of its assertions.",
                choices(NATURES),
            ),
            period: question(
                "Does inspected content explicitly establish current or historical applicability of targetExcerpt as of the supplied date? A capture/publication date alone is insufficient.",
                choices(["current", "historical", "unspecified"]),
            ),
            citation: question(
                "Which inspected passage most directly supports targetExcerpt? Select none if none suffices.",
                {
                    none: "None of the supplied passages suffices",
                    ...Object.fromEntries(
                        passages.map((p) => [
                            p.passageKey,
                            `Inspected passage ${p.passageKey}`,
                        ]),
                    ),
                },
            ),
        },
    };
}

function boundCommonCase(
    item: StudyCase,
    models: string[],
    instructions: string,
    maxBytes: number,
) {
    const entries = (item.state.inspectedPassages ??
        item.state.primaryPassages) as
        | Array<{ passageKey?: string; referenceKey?: string }>
        | undefined;
    const candidate = (count: number) => {
        const result = structuredClone(item);
        if (entries) {
            const retained = entries.slice(0, count);
            if (item.state.inspectedPassages)
                result.state.inspectedPassages = retained;
            else result.state.primaryPassages = retained;
            const allowed = new Set(
                retained.map((p) =>
                    item.state.primaryPassages ? p.referenceKey : p.passageKey,
                ),
            );
            const citation = result.questions.citation;
            if (citation)
                citation.criteria = Object.fromEntries(
                    Object.entries(citation.criteria).filter(
                        ([id]) => id === "none" || allowed.has(id),
                    ),
                );
            const omitted = entries.length - count;
            if (omitted) {
                result.state.partialReading = true;
                result.state.omittedPassages = omitted;
            }
        }
        return result;
    };
    const fits = (value: StudyCase) =>
        models.every(
            (model) =>
                Buffer.byteLength(
                    JSON.stringify(
                        wireRequest(model, value, instructions).body,
                    ),
                ) <= maxBytes,
        );
    let low = 0,
        high = entries?.length ?? 0;
    const empty = candidate(0);
    assert(fits(empty), `Study case cannot fit shared input bound: ${item.id}`);
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (fits(candidate(middle))) low = middle;
        else high = middle - 1;
    }
    return candidate(low);
}

/** Prepares real production inputs; it never loads credentials, calls a provider or accesses Convex. */
export function prepareStudy(loaded: LoadedStudy) {
    const { study, protocol, documents } = loaded;
    const documentCases = documents.map((document) =>
        commonDocumentCase(
            document,
            study.companies.find((c) => c.id === document.companyId) as Company,
            false,
            protocol.asOfTime,
        ),
    );
    const cases = documentCases.map((item) =>
        boundCommonCase(
            item,
            protocol.models,
            protocol.instructions,
            protocol.commonInputByteLimit,
        ),
    );
    const grouped: StudyCall[] = [];
    for (const document of documents) {
        const company = study.companies.find(
            (c) => c.id === document.companyId,
        ) as Company;
        const prepared = prepareQualificationInput({
            company: companyForModel(company),
            canonicalUrl: document.url,
            title: document.title,
            asOfTime: Date.parse(protocol.asOfTime),
            text: document.text,
        });
        for (const model of protocol.models.slice(0, 2))
            grouped.push(
                groupedCall(
                    "qualification",
                    `document:${document.id}`,
                    company,
                    model,
                    prepared,
                ),
            );
    }
    for (const control of study.controls) {
        const company = study.companies.find((c) => c.id === control.companyId);
        const targetDocument = documents.find(
            (d) => d.id === control.targetDocumentId,
        );
        assert(
            company &&
                targetDocument &&
                targetDocument.companyId === company.id,
            "Invalid control company/target",
        );
        assert(
            control.span.endOffset > control.span.startOffset &&
                control.span.endOffset <= targetDocument.text.length,
            "Invalid control target span",
        );
        const quotation = targetDocument.text.slice(
            control.span.startOffset,
            control.span.endOffset,
        );
        const qualification: SourceQualification = {
            companyMatch: "subject",
            companyPassages: [],
            documentKind: "independent_analysis",
            reportingPeriodEnd: null,
            reportingPeriodPassages: [],
            findings: [
                {
                    role: "counter_evidence_secondary",
                    kind: control.kind,
                    summary: quotation.slice(0, 600),
                    passages: [{ passageKey: "target", quotation }],
                    period: "unspecified",
                    periodPassages: [],
                    dependsOnFlaggedAssertion: false,
                },
            ],
            limitations: [],
        };
        const primaries = control.primaryDocumentIds.map((id) => {
            const document = documents.find((d) => d.id === id);
            assert(
                document && document.companyId === company.id,
                "Unknown or cross-company primary capture",
            );
            assert(
                [
                    "annual",
                    "quarterly",
                    "product",
                    "integration",
                    "terms",
                ].includes(document.category),
                "External source cannot become a primary comparison source",
            );
            const classification = classifySourceComparisonContext(
                {
                    sourceId: document.id,
                    canonicalUrl: document.url,
                    title: document.title,
                    origin:
                        new URL(document.url).hostname === "www.sec.gov"
                            ? "sec"
                            : "exa",
                    category: document.category,
                    createdAt: Date.parse(document.capturedAt),
                    secForm:
                        document.category === "annual"
                            ? "10-K"
                            : document.category === "quarterly"
                              ? "10-Q"
                              : undefined,
                },
                company,
            );
            assert(
                classification.companyIdentityConfirmed &&
                    [
                        "regulator_primary",
                        "company_primary",
                        "company_hosted_ir",
                    ].includes(classification.authorityTier),
                "Primary authority not established by the production classifier",
            );
            return {
                sourceId: document.id,
                captureId: document.id,
                contentHash: document.contentHash,
                title: document.title,
                canonicalUrl: document.url,
                authorityTier:
                    classification.authorityTier as SourceComparisonPrimaryCandidate["authorityTier"],
                documentKind: classification.documentKind,
                text: document.text,
                passages: extractPassagesFromNormalizedText({
                    text: document.text,
                    canonicalUrl: document.url,
                    sourceVersionHash: document.contentHash,
                    maxPassages: 10000,
                }).map((p) => ({
                    passageKey: `p${p.order}`,
                    quotation: p.exactQuotation,
                    startOffset: p.locator.startOffset ?? 0,
                    endOffset: p.locator.endOffset ?? 0,
                    headingPath: p.headingPath ?? [],
                })),
            } satisfies SourceComparisonPrimaryCandidate;
        });
        const prepared = prepareSourceComparisonInput({
            company: companyForModel(company),
            target: {
                runId: study.studyId,
                corpusRevisionId: study.protocolSha256,
                sourceId: targetDocument.id,
                captureId: targetDocument.id,
                contentHash: targetDocument.contentHash,
                qualificationTaskId: `reference:${control.id}`,
                title: targetDocument.title,
                canonicalUrl: targetDocument.url,
                text: targetDocument.text,
                selectedPassages: [{ passageKey: "target", ...control.span }],
                qualification,
            },
            primaryCandidates: primaries,
        });
        assert.equal(
            prepared.request.findings.length,
            1,
            "Control target was omitted by production preparation",
        );
        const evidence = control.primaryEvidence.map((anchor, index) => {
            const document = documents.find((d) => d.id === anchor.documentId);
            assert(
                document && control.primaryDocumentIds.includes(document.id),
                "Investigator evidence must belong to a supplied eligible primary capture",
            );
            assert(
                anchor.endOffset > anchor.startOffset &&
                    anchor.endOffset <= document.text.length &&
                    anchor.endOffset - anchor.startOffset <= 4000,
                "Invalid investigator primary span",
            );
            return {
                sourceId: document.id,
                captureId: document.id,
                contentHash: document.contentHash,
                passageKey: `anchor${index}`,
                startOffset: anchor.startOffset,
                endOffset: anchor.endOffset,
                quotation: document.text.slice(
                    anchor.startOffset,
                    anchor.endOffset,
                ),
                headingPath: [],
                referenceKey: `anchor${index}`,
            };
        });
        const provided = [...evidence, ...prepared.request.primaryPassages]
            .filter(
                (p, index, all) =>
                    all.findIndex(
                        (other) =>
                            other.sourceId === p.sourceId &&
                            other.startOffset === p.startOffset &&
                            other.endOffset === p.endOffset,
                    ) === index,
            )
            .map((p, index) => ({ ...p, referenceKey: `e${index}` }));
        const state = {
            company: companyForModel(company),
            contribution: quotation,
            targetContext: {
                url: targetDocument.url,
                title: targetDocument.title,
                precedingText: targetDocument.text.slice(
                    Math.max(0, control.span.startOffset - 500),
                    control.span.startOffset,
                ),
            },
            primaryPassages: provided,
            partialReading:
                prepared.request.completeness.omittedPrimaryPassageCount > 0,
        };
        const item: StudyCase = {
            id: `control:${control.id}`,
            companyId: company.id,
            split: company.split,
            family: "control",
            state,
            questions: {
                disposition: question(
                    "Compare the contribution only with supplied primary passages. A possible conflict needs comparable evidence; no conflict observed needs comparable evidence for all material premises and never certifies truth. Otherwise use inconclusive.",
                    choices([
                        "no_conflict_observed",
                        "possible_conflict",
                        "inconclusive",
                    ]),
                ),
                entity: question(
                    "Do the contribution and supplied primary evidence concern the same entity?",
                    choices(["aligned", "different", "not_established"]),
                ),
                period: question(
                    "Is a directly comparable reporting period or applicability basis supplied for the material premise? Inspect every table column. Do not annualize a quarter.",
                    choices(["aligned", "different", "not_established"]),
                ),
                nature: question(
                    "Classify the contribution by documentary nature; attribution does not verify its truth.",
                    choices(NATURES),
                ),
                citation: question(
                    "Which supplied primary passage most directly establishes the comparison? Choose none if no directly comparable passage exists.",
                    {
                        none: "No directly comparable passage",
                        ...Object.fromEntries(
                            provided.map((p) => [
                                p.referenceKey,
                                `Primary passage ${p.referenceKey}`,
                            ]),
                        ),
                    },
                ),
            },
        };
        cases.push(
            boundCommonCase(
                item,
                protocol.models,
                protocol.instructions,
                protocol.commonInputByteLimit,
            ),
        );
        for (const model of protocol.models.slice(0, 2))
            grouped.push(
                groupedCall("comparison", item.id, company, model, prepared),
            );
    }
    const regressionIds = [
        "relation_crpo",
        "relation_margin_risk",
        "relation_reported_debt",
        "relation_contracts_product",
    ];
    for (const id of regressionIds) {
        const original = loaded.historical.cases.find((c) => c.id === id);
        assert(original, "Historical regression missing");
        cases.push({
            id: `regression:${id}`,
            companyId: "servicenow",
            split: "regression",
            family: "regression",
            state: original.state,
            questions: original.questions,
        });
    }
    for (const company of study.companies) {
        const base = cases.find(
            (c) =>
                c.companyId === company.id &&
                c.family === "control" &&
                c.id.endsWith("numeric"),
        );
        if (base)
            for (const variant of ["repeat", "reverse_choice_order"]) {
                const item = structuredClone(base);
                item.id = `sensitivity:${base.id}:${variant}`;
                item.family = "sensitivity";
                item.sourceCaseId = base.id;
                item.variant = variant;
                if (variant === "reverse_choice_order")
                    for (const q of Object.values(item.questions))
                        q.criteria = Object.fromEntries(
                            Object.entries(q.criteria).reverse(),
                        );
                cases.push(item);
            }
        const longest = documents
            .filter((d) => d.companyId === company.id)
            .sort(
                (a, b) => Buffer.byteLength(b.text) - Buffer.byteLength(a.text),
            )[0];
        if (longest)
            cases.push(
                boundCommonCase(
                    commonDocumentCase(
                        longest,
                        company,
                        true,
                        protocol.asOfTime,
                    ),
                    protocol.models,
                    protocol.instructions,
                    LONG_COMMON_INPUT_BYTE_LIMIT,
                ),
            );
    }
    const calls: StudyCall[] = [
        ...cases.flatMap((item) =>
            protocol.models.map((model) => {
                const wire = wireRequest(model, item, protocol.instructions);
                return {
                    key: `choices:${item.id}:${model}`,
                    caseId: item.id,
                    companyId: item.companyId,
                    split: item.split,
                    family: item.family,
                    task: "choices" as const,
                    model,
                    endpoint: wire.endpoint,
                    native: wire.native,
                    keyName: wire.key,
                    body: wire.body,
                    requestHash: hash(JSON.stringify(wire.body)),
                };
            }),
        ),
        ...grouped,
    ];
    assert(
        new Set(calls.map((call) => call.key)).size === calls.length,
        "Duplicate study request identity",
    );
    assert(
        calls.length <= protocol.maximumAttempts,
        "Study exceeds the fixed 416-attempt design",
    );
    const missing = validateReference(loaded, cases, grouped);
    if (!loaded.inputContract) missing.push("missing_input_contract");
    if (documents.length !== 32 || study.controls.length !== 16)
        missing.push(
            `incomplete_corpus:${documents.length}/32 documents, ${study.controls.length}/16 controls`,
        );
    for (const company of study.companies) {
        const topics = study.controls
            .filter((c) => c.companyId === company.id)
            .map((c) => c.topic);
        if (new Set(topics).size !== 4)
            missing.push(`incomplete_control_topics:${company.id}`);
    }
    return {
        schemaVersion: "source-quality-manifest-v1",
        studyId: study.studyId,
        studySha256: loaded.studySha256,
        protocolSha256: study.protocolSha256,
        artifacts: Object.fromEntries(loaded.files),
        referenceSha256: loaded.files.get(study.referenceFile),
        status: missing.length ? "blocked" : "prepared",
        blockers: missing,
        models: protocol.models,
        integrationExcludedModels: protocol.integrationExcludedModels,
        maximumAttempts: protocol.maximumAttempts,
        concurrency: protocol.concurrency,
        timeoutSeconds: protocol.timeoutSeconds,
        cases,
        calls,
        providerRequests: 0,
        appWrites: 0,
        semanticAcceptance: "not_evaluated",
        independentHumanGroundTruth: false,
    };
}
function groupedCall(
    task: "qualification" | "comparison",
    caseId: string,
    company: Company,
    model: string,
    prepared: { request: unknown; inputHash: string },
): StudyCall {
    // The CLI captures the actual SDK wire body before hashing, quoting or dispatch.
    return {
        key: `${task}:${caseId}:${model}`,
        caseId,
        companyId: company.id,
        split: company.split,
        family: task,
        task,
        model,
        endpoint: evaluationTransport(model).endpoint,
        native: false,
        keyName: "OPENROUTER_API_KEY",
        body: {},
        requestHash: prepared.inputHash,
        prepared,
    };
}
function validateReference(
    loaded: LoadedStudy,
    cases: StudyCase[],
    grouped: StudyCall[],
) {
    const missing: string[] = [];
    for (const item of cases) {
        if (item.family === "regression") continue;
        const sourceId = item.sourceCaseId ?? item.id;
        const expected = loaded.reference.judgments[sourceId];
        if (!expected) {
            missing.push(`missing_reference:${item.id}`);
            continue;
        }
        assert.deepEqual(
            Object.keys(expected).sort(),
            Object.keys(item.questions).sort(),
            `Reference questions mismatch: ${item.id}`,
        );
        for (const [id, ref] of Object.entries(expected)) {
            const criteria = item.questions[id]?.criteria ?? {};
            for (const value of [...ref.accepted, ...ref.unsafeChoices])
                assert(
                    Object.hasOwn(criteria, value),
                    `Reference choice not supplied: ${item.id}:${id}:${value}`,
                );
            for (const anchor of ref.evidence) {
                const document = loaded.documents.find(
                    (d) => d.id === anchor.documentId,
                );
                assert(
                    document &&
                        document.text.slice(
                            anchor.startOffset,
                            anchor.endOffset,
                        ) === anchor.quotation,
                    `Reference quotation mismatch: ${item.id}:${id}`,
                );
            }
        }
    }
    for (const call of grouped)
        if (!loaded.reference.grouped[`${call.task}:${call.caseId}`])
            missing.push(
                `missing_grouped_reference:${call.task}:${call.caseId}`,
            );
    return [...new Set(missing)];
}

/** Separates availability, harmful choices, abstention and citation errors instead of hiding them in one accuracy score. */
export function scoreStudy(
    loaded: LoadedStudy,
    manifest: ReturnType<typeof prepareStudy>,
    results: Array<{
        key: string;
        status: string;
        response?: Record<string, unknown>;
        answers?: Record<string, string>;
        costUsd?: number;
        latencyMs?: number;
        output?: unknown;
    }>,
) {
    const observations = manifest.calls.map((call) => {
        const result = results.find((r) => r.key === call.key);
        if (call.task !== "choices") {
            const reference =
                loaded.reference.grouped[`${call.task}:${call.caseId}`];
            const expected = reference?.expected ?? {};
            const receipt =
                result?.output && typeof result.output === "object"
                    ? (result.output as Record<string, unknown>)
                    : undefined;
            const checks: Array<{
                question: string;
                expected: unknown;
                actual: unknown;
                correct: boolean;
            }> = [];
            let available = false;
            if (call.task === "qualification") {
                const parsed = sourceQualificationSchema.safeParse(
                    receipt?.qualification,
                );
                if (parsed.success && result?.status === "succeeded") {
                    available = true;
                    const qualification = parsed.data;
                    for (const field of [
                        "companyMatch",
                        "documentKind",
                    ] as const) {
                        const wanted = expected[field];
                        if (Array.isArray(wanted))
                            checks.push({
                                question: field,
                                expected: wanted,
                                actual: qualification[field],
                                correct: wanted.includes(qualification[field]),
                            });
                    }
                    const roles = new Set(
                        qualification.findings.map((f) => f.role),
                    );
                    if (Array.isArray(expected.requiredRoles))
                        for (const role of expected.requiredRoles)
                            checks.push({
                                question: `requiredRole:${String(role)}`,
                                expected: true,
                                actual: roles.has(role),
                                correct: roles.has(role),
                            });
                    if (Array.isArray(expected.forbiddenRoles))
                        for (const role of expected.forbiddenRoles)
                            checks.push({
                                question: `forbiddenRole:${String(role)}`,
                                expected: false,
                                actual: roles.has(role),
                                correct: !roles.has(role),
                            });
                    if (typeof expected.minimumContributions === "number")
                        checks.push({
                            question: "usefulContributions",
                            expected: `at least ${expected.minimumContributions}`,
                            actual: qualification.findings.length,
                            correct:
                                qualification.findings.length >=
                                expected.minimumContributions,
                        });
                }
            } else {
                const parsed = sourceComparisonOutputSchema.safeParse(
                    receipt?.output,
                );
                if (parsed.success && result?.status === "succeeded") {
                    available = true;
                    for (const finding of parsed.data.findings)
                        if (Array.isArray(expected.dispositions))
                            checks.push({
                                question: `disposition:${finding.findingIndex}`,
                                expected: expected.dispositions,
                                actual: finding.disposition,
                                correct: expected.dispositions.includes(
                                    finding.disposition,
                                ),
                            });
                }
            }
            return {
                key: call.key,
                model: call.model,
                companyId: call.companyId,
                split: call.split,
                task: call.task,
                family: call.family,
                status: available
                    ? "succeeded"
                    : result
                      ? "unusable"
                      : "not_run",
                machineJudgments: checks,
                output: receipt,
                investigatorReview: "pending",
                costUsd: result?.costUsd,
                latencyMs: result?.latencyMs,
            };
        }
        const item = manifest.cases.find((c) => c.id === call.caseId);
        assert(item);
        let answers: Record<string, string> | undefined;
        if (result?.status === "succeeded") {
            try {
                answers = result.response
                    ? validateAnswers(
                          result.response,
                          item.questions,
                          call.native,
                      )
                    : result.answers;
                assert(
                    answers &&
                        Object.keys(answers).length ===
                            Object.keys(item.questions).length,
                );
                for (const [id, value] of Object.entries(answers))
                    assert(
                        Object.hasOwn(
                            item.questions[id]?.criteria ?? {},
                            value,
                        ),
                    );
            } catch {
                answers = undefined;
            }
        }
        const sourceId = item.sourceCaseId ?? item.id;
        const historical = sourceId.startsWith("regression:")
            ? loaded.historicalReference.judgments[sourceId.slice(11)]?.expected
            : undefined;
        const reference = loaded.reference.judgments[sourceId];
        return {
            key: call.key,
            model: call.model,
            companyId: call.companyId,
            split: call.split,
            task: call.task,
            family: item.family,
            status: answers ? "succeeded" : result ? "unusable" : "not_run",
            costUsd: result?.costUsd,
            latencyMs: result?.latencyMs,
            judgments: Object.keys(item.questions).map((id) => {
                const expected = reference?.[id];
                const accepted = expected?.accepted ?? historical?.[id] ?? [];
                const actual = answers?.[id];
                return {
                    question: id,
                    metric: expected?.metric ?? "regression",
                    expected: accepted,
                    actual: actual ?? null,
                    referenceStatus: accepted.length ? "available" : "missing",
                    correct:
                        accepted.length && actual !== undefined
                            ? accepted.includes(actual)
                            : null,
                    unsafe:
                        actual !== undefined &&
                        (expected?.unsafeChoices.includes(actual) ?? false),
                    abstention:
                        actual !== undefined &&
                        [
                            "uncertain",
                            "unspecified",
                            "not_established",
                            "inconclusive",
                            "none",
                            "mixed_or_uncertain",
                        ].includes(actual),
                };
            }),
        };
    });
    const metrics = new Map<
        string,
        {
            model: string;
            companyId: string;
            split: string;
            family: string;
            task: string;
            question: string;
            count: number;
            available: number;
            notRun: number;
            unusable: number;
            correct: number;
            incorrect: number;
            missingReference: number;
            unsafe: number;
            appropriateAbstentions: number;
            avoidableAbstentions: number;
        }
    >();
    for (const observation of observations) {
        if (!("judgments" in observation) || !observation.judgments) continue;
        for (const judgment of observation.judgments) {
            const key = JSON.stringify([
                observation.model,
                observation.companyId,
                observation.split,
                observation.family,
                observation.task,
                judgment.question,
            ]);
            let row = metrics.get(key);
            if (!row) {
                row = {
                    model: observation.model,
                    companyId: observation.companyId,
                    split: observation.split,
                    family: observation.family,
                    task: observation.task,
                    question: judgment.question,
                    count: 0,
                    available: 0,
                    notRun: 0,
                    unusable: 0,
                    correct: 0,
                    incorrect: 0,
                    missingReference: 0,
                    unsafe: 0,
                    appropriateAbstentions: 0,
                    avoidableAbstentions: 0,
                };
                metrics.set(key, row);
            }
            row.count += 1;
            if (observation.status === "not_run") row.notRun += 1;
            if (observation.status === "unusable") row.unusable += 1;
            if (judgment.actual !== null) row.available += 1;
            if (judgment.referenceStatus === "missing")
                row.missingReference += 1;
            if (judgment.correct === null) continue;
            else if (judgment.correct) row.correct += 1;
            else row.incorrect += 1;
            if (judgment.unsafe) row.unsafe += 1;
            if (judgment.abstention && judgment.correct)
                row.appropriateAbstentions += 1;
            else if (judgment.abstention && judgment.correct === false)
                row.avoidableAbstentions += 1;
        }
    }
    return {
        studyId: loaded.study.studyId,
        observations,
        metrics: [...metrics.values()],
        semanticAcceptance: observations.some(
            (observation) => observation.status === "succeeded",
        )
            ? "pending_investigator_review"
            : "not_evaluated",
        recommendation: "not_automatically_selected",
        integrationExcludedModels: manifest.integrationExcludedModels,
        limits: [
            "Investigator reference without independent human adjudication",
            "Stratified challenge set, not random operational prevalence",
            "No production acceptance or activation",
            "Common controls include investigator-selected evidence; grouped controls use production retrieval and have separate references",
            "Document citation localization includes an exact excerpt and does not establish semantic retrieval recall",
            "Sensitivity and historical regressions are separate from holdout quality",
        ],
    };
}
