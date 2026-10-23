import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceComparisonRequest } from "@convex/domain/sourceComparison";
import type { SourceQualification } from "@convex/domain/sourceQualification";
import { createServer } from "vite";

// This audits retrieval from frozen documents, not model understanding or app approval.
const root = dirname(fileURLToPath(import.meta.url));
const project = resolve(root, "../../..");
const runName = process.argv[2];
assert(runName && /^[a-zA-Z0-9_-]+$/.test(runName), "Supply a saved run name");
const run = join(root, "runs", runName);
const outputPath = resolve(
    process.argv[3] ?? join(run, "source-comparison-input-audit.json"),
);
const manifestBytes = readFileSync(join(run, "manifest.json"), "utf8");
const summaryBytes = readFileSync(join(run, "summary.json"), "utf8");
type DocumentInput = {
    caseId: string;
    prepared: {
        normalizedText: string;
        request: {
            company: { cik: string; legalName: string; ticker: string };
            document: {
                canonicalUrl: string;
                title: string;
                contentHash: string;
                passages: Array<{
                    passageKey: string;
                    text: string;
                    startOffset: number;
                    endOffset: number;
                }>;
            };
        };
    };
};
const manifest = JSON.parse(manifestBytes) as { inputs: DocumentInput[] };
const summary = JSON.parse(summaryBytes) as {
    judgments: Array<{
        caseId: string;
        model: string;
        qualification?: SourceQualification;
        unavailable?: string;
    }>;
};
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const sourcePaths = [
    "convex/domain/sourceComparison.ts",
    "convex/domain/sourcePassages.ts",
    "convex/resourceLimits.ts",
    "package.json",
    "pnpm-lock.yaml",
    "scripts/evaluations/source-selection/audit-source-comparison-input.ts",
];
const sourceHashes = Object.fromEntries(
    sourcePaths.map((path) => [
        path,
        sha(readFileSync(join(project, path), "utf8")),
    ]),
);
const documentFor = (caseId: string) => {
    const input = manifest.inputs.find(
        (candidate) => candidate.caseId === caseId,
    );
    assert(input, `Missing frozen document ${caseId}`);
    assert.equal(
        sha(input.prepared.normalizedText),
        input.prepared.request.document.contentHash,
        `Frozen content hash differs for ${caseId}`,
    );
    return input;
};

// Investigator expectations come from direct reading of the frozen primary text.
const cases = [
    {
        caseId: "doc_capital",
        targetPassageKey: "p63",
        expectedPrimaryPassageKeys: ["p6", "p11"],
        requiredContextPassageKeys: [],
        expectedDisposition: "possible_conflict",
        expectedArgumentEffect:
            "Restrict the full quotation containing the wrong amount. The amount discrepancy alone does not disprove the deceleration thesis.",
        judgment:
            "The full quotation contains an incorrect cRPO amount. The primary release states 12.64 billion and confirms 22.5 percent growth. The amount discrepancy alone does not disprove the deceleration thesis.",
    },
    {
        caseId: "doc_earningsmoat",
        targetPassageKey: "p104",
        expectedPrimaryPassageKeys: ["p145"],
        requiredContextPassageKeys: ["p144"],
        expectedDisposition: "possible_conflict",
        expectedArgumentEffect:
            "Restrict the zero-debt premise and the argument that depends on it. Preserve independent contributions on other passages.",
        judgment:
            "The zero-long-term-debt premise conflicts with the primary balance sheet, whose March 2026 and December 2025 columns both show 1,491 million net long-term debt. This does not invalidate independent competition or dilution contributions.",
    },
] as const;

type AuditReport = (typeof cases)[number] & { model: string } & (
        | { status: "qualification_unavailable"; reason: string }
        | { status: "target_passage_not_selected" }
        | {
              status:
                  | "expected_evidence_retrieved"
                  | "expected_evidence_missing";
              inputHash: string;
              serializedRequestBytes: number;
              omittedFindingIndexes: number[];
              selected: Array<{
                  findingIndex: number;
                  retrievesExpectedEvidence: boolean;
                  retrievesRequiredContext: boolean;
                  primaryPassages: SourceComparisonRequest["primaryPassages"];
              }>;
              preparedRequest: SourceComparisonRequest;
          }
    );

globalThis.fetch = async () => {
    throw new Error(
        "Network access is prohibited in this offline retrieval audit",
    );
};
const server = await createServer({
    root: project,
    configFile: false,
    envDir: false,
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    resolve: { tsconfigPaths: true },
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
    cacheDir: join(project, ".superpowers/sdd/source-comparison-module-cache"),
});
try {
    const comparison = (await server.ssrLoadModule(
        "/convex/domain/sourceComparison.ts",
    )) as typeof import("@convex/domain/sourceComparison");
    const passages = (await server.ssrLoadModule(
        "/convex/domain/sourcePassages.ts",
    )) as typeof import("@convex/domain/sourcePassages");
    const official = documentFor("doc_sec_q1").prepared;
    const primaryPassages = passages
        .extractPassagesFromNormalizedText({
            text: official.normalizedText,
            canonicalUrl: official.request.document.canonicalUrl,
            sourceVersionHash: official.request.document.contentHash,
        })
        .map((passage) => ({
            passageKey: `p${passage.order}`,
            startOffset: passage.locator.startOffset ?? -1,
            endOffset: passage.locator.endOffset ?? -1,
            quotation: passage.exactQuotation,
            headingPath: passage.headingPath ?? [],
        }));
    for (const testCase of cases) {
        assert(
            testCase.expectedPrimaryPassageKeys.some((key) =>
                primaryPassages.some((passage) => passage.passageKey === key),
            ),
            `Investigator primary locator is no longer reproducible: ${testCase.caseId}`,
        );
    }
    const reports: AuditReport[] = [];
    for (const model of new Set(
        summary.judgments.map((judgment) => judgment.model),
    )) {
        for (const testCase of cases) {
            const judgment = summary.judgments.find(
                (candidate) =>
                    candidate.caseId === testCase.caseId &&
                    candidate.model === model,
            );
            assert(judgment, "Missing original qualification outcome");
            const target = documentFor(testCase.caseId).prepared;
            const qualification = judgment.qualification;
            if (!qualification) {
                assert(
                    judgment.unavailable,
                    "Missing original qualification failure outcome",
                );
                reports.push({
                    ...testCase,
                    model,
                    status: "qualification_unavailable",
                    reason: judgment.unavailable,
                });
                continue;
            }
            const relevantFindings = qualification.findings.flatMap(
                (finding, index) =>
                    finding.passages.some(
                        (reference) =>
                            reference.passageKey === testCase.targetPassageKey,
                    )
                        ? [index]
                        : [],
            );
            if (!relevantFindings.length) {
                reports.push({
                    ...testCase,
                    model,
                    status: "target_passage_not_selected",
                });
                continue;
            }
            const prepared = comparison.prepareSourceComparisonInput({
                company: target.request.company,
                target: {
                    runId: `offline:${runName}`,
                    corpusRevisionId: `offline:${runName}:frozen-inputs`,
                    sourceId: testCase.caseId,
                    captureId: `offline:${testCase.caseId}:${target.request.document.contentHash}`,
                    contentHash: target.request.document.contentHash,
                    qualificationTaskId: `offline:${model}:${testCase.caseId}`,
                    title: target.request.document.title,
                    canonicalUrl: target.request.document.canonicalUrl,
                    text: target.normalizedText,
                    selectedPassages: target.request.document.passages,
                    qualification,
                },
                primaryCandidates: [
                    {
                        sourceId: "doc_sec_q1",
                        captureId: `offline:doc_sec_q1:${official.request.document.contentHash}`,
                        contentHash: official.request.document.contentHash,
                        title: official.request.document.title,
                        canonicalUrl: official.request.document.canonicalUrl,
                        authorityTier: "regulator_primary",
                        documentKind: "earnings_release",
                        reportingPeriodEnd: "2026-03-31",
                        text: official.normalizedText,
                        passages: primaryPassages,
                    },
                ],
            });
            const selected = prepared.request.findings
                .filter((finding) =>
                    relevantFindings.includes(finding.findingIndex),
                )
                .map((finding) => {
                    const references = prepared.request.primaryPassages.filter(
                        (passage) =>
                            finding.primaryPassageKeys.includes(
                                passage.referenceKey,
                            ),
                    );
                    return {
                        findingIndex: finding.findingIndex,
                        retrievesExpectedEvidence: references.some(
                            (reference) =>
                                testCase.expectedPrimaryPassageKeys.some(
                                    (key) => key === reference.passageKey,
                                ),
                        ),
                        retrievesRequiredContext:
                            testCase.requiredContextPassageKeys.every((key) =>
                                references.some(
                                    (reference) => reference.passageKey === key,
                                ),
                            ),
                        primaryPassages: references,
                    };
                });
            const found =
                selected.length > 0 &&
                selected.every(
                    (finding) =>
                        finding.retrievesExpectedEvidence &&
                        finding.retrievesRequiredContext,
                );
            reports.push({
                ...testCase,
                model,
                status: found
                    ? "expected_evidence_retrieved"
                    : "expected_evidence_missing",
                inputHash: prepared.inputHash,
                serializedRequestBytes: prepared.serializedRequestBytes,
                omittedFindingIndexes: prepared.omittedFindingIndexes,
                selected,
                preparedRequest: prepared.request,
            });
        }
    }
    const failures = reports.filter(
        (report) => report.status === "expected_evidence_missing",
    );
    const allCasesExamined = cases.every((testCase) =>
        reports.some(
            (report) =>
                report.caseId === testCase.caseId && "inputHash" in report,
        ),
    );
    for (const path of sourcePaths)
        assert.equal(
            sha(readFileSync(join(project, path), "utf8")),
            sourceHashes[path],
            `Module changed during audit: ${path}`,
        );
    writeFileSync(
        outputPath,
        `${JSON.stringify({ mode: "offline_retrieval_only", providerRequests: 0, appWrites: 0, status: failures.length ? "retrieval_regression" : allCasesExamined ? "reviewed_cases_retrieved" : "no_comparable_targets", provenance: "Synthetic run/revision/capture/task identifiers wrap unchanged frozen public document bytes for this offline diagnostic only. No application captures, model comparison output, factual approval or claims are created. Expectations are investigator-authored regression judgments, not independent ground truth.", manifestSha256: sha(manifestBytes), summarySha256: sha(summaryBytes), sourceHashes, reports }, null, 2)}\n`,
        { flag: "wx" },
    );
    console.log(
        JSON.stringify({
            output: outputPath,
            providerRequests: 0,
            reports: reports.map(({ caseId, model, status }) => ({
                caseId,
                model,
                status,
            })),
        }),
    );
    if (failures.length) process.exitCode = 1;
    else if (!allCasesExamined) process.exitCode = 2;
} finally {
    await server.close();
}
