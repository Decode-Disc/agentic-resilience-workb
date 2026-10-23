import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceQualification } from "@convex/domain/sourceQualification";
import type { SourceSelectionCandidate } from "@convex/domain/sourceSelectionPolicy";
import { createServer } from "vite";

// Offline inspection of actual policy effects, separate from model correctness.
const root = dirname(fileURLToPath(import.meta.url));
const project = resolve(root, "../../..");
const runName = process.argv[2];
assert(runName && /^[a-zA-Z0-9_-]+$/.test(runName), "Supply a saved run name");
const run = join(root, "runs", runName);
const summaryBytes = readFileSync(join(run, "summary.json"), "utf8");
const summary = JSON.parse(summaryBytes) as {
    judgments: Array<{
        caseId: string;
        model: string;
        qualification?: SourceQualification;
        unavailable?: string;
    }>;
};
const manifest = JSON.parse(readFileSync(join(run, "manifest.json"), "utf8"));
const datasetBytes = readFileSync(join(root, "fixtures/dataset.json"), "utf8");
const dataset = JSON.parse(datasetBytes) as {
    cases: Array<{
        id: string;
        state: { source_url: string; discovery_title: string };
    }>;
};
const probes = JSON.parse(
    readFileSync(
        join(root, "fixtures/qualification-usage-probes.json"),
        "utf8",
    ),
) as {
    probes: Array<{
        caseId: string;
        passageKey: string;
        statement: string;
        expectedAllowed: boolean;
        rationale: string;
    }>;
};
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const paths = [
    "convex/domain/sourceSelectionPolicy.ts",
    "convex/domain/sourceUsage.ts",
    "convex/domain/sourceQualification.ts",
    "convex/domain/sourcePassages.ts",
    "scripts/evaluations/source-selection/audit-qualified-selection.ts",
    "scripts/evaluations/source-selection/fixtures/qualification-usage-probes.json",
];
const hashes = Object.fromEntries(
    paths.map((path) => [path, sha(readFileSync(join(project, path), "utf8"))]),
);
for (const path of paths)
    if (manifest.hashes[path])
        assert.equal(
            hashes[path],
            manifest.hashes[path],
            `Changed module: ${path}`,
        );

globalThis.fetch = async () => {
    throw new Error("Network access is prohibited in this offline audit");
};
const server = await createServer({
    root: project,
    configFile: false,
    envDir: false,
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    resolve: { tsconfigPaths: true },
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
    cacheDir: "/tmp/workbench-qualification-module-cache",
});
try {
    const policy = (await server.ssrLoadModule(
        "/convex/domain/sourceSelectionPolicy.ts",
    )) as typeof import("@convex/domain/sourceSelectionPolicy");
    const usage = (await server.ssrLoadModule(
        "/convex/domain/sourceUsage.ts",
    )) as typeof import("@convex/domain/sourceUsage");
    const models = [...new Set(summary.judgments.map((j) => j.model))];
    const reports = models.map((model) => {
        const judgments = summary.judgments.filter((j) => j.model === model);
        assert.equal(judgments.length, 19, "Incomplete document comparison");
        assert.equal(new Set(judgments.map((j) => j.caseId)).size, 19);
        const candidates: SourceSelectionCandidate[] = judgments.map((j) => {
            const document = dataset.cases.find((c) => c.id === j.caseId);
            assert(document, "Missing document");
            const input = manifest.inputs.find(
                (i: { caseId: string }) => i.caseId === j.caseId,
            );
            assert(input, "Missing prepared input");
            let inspection: NonNullable<SourceSelectionCandidate["inspection"]>;
            if (j.qualification) {
                inspection = {
                    status: "qualified",
                    qualification: j.qualification,
                    readingCompleteness: input.prepared.readingCompleteness,
                };
            } else {
                assert(j.unavailable, "Missing qualification outcome");
                inspection = {
                    status: "unavailable",
                    reasonCode: j.unavailable,
                };
            }
            return {
                sourceId: j.caseId,
                canonicalUrl: document.state.source_url,
                title: document.state.discovery_title,
                origin:
                    new URL(document.state.source_url).hostname ===
                    "www.sec.gov"
                        ? "sec"
                        : "exa",
                category: "other",
                createdAt: 1,
                inspection,
            };
        });
        const proposal = policy.buildSourceSelectionProposal({
            candidates,
            company: {
                cik: "1373715",
                legalName: "ServiceNow, Inc.",
                ticker: "NOW",
                websiteUrl: "https://www.servicenow.com",
            },
            coveragePreset: "balanced",
            ceiling: 24,
        });
        return {
            model,
            items: proposal.items.map((item) => {
                const candidate = candidates.find(
                    (c) => c.sourceId === item.sourceId,
                );
                assert(candidate?.inspection, "Missing inspected candidate");
                const qualification =
                    candidate.inspection.status === "qualified"
                        ? candidate.inspection.qualification
                        : null;
                const passages = new Map(
                    qualification?.findings.flatMap((f) =>
                        f.passages.map((p) => [p.passageKey, p] as const),
                    ) ?? [],
                );
                const attributedUseProbes: Array<Record<string, unknown>> = [];
                for (const [findingIndex, finding] of (
                    qualification?.findings ?? []
                ).entries()) {
                    if (
                        !qualification ||
                        !["attributed_argument", "forecast"].includes(
                            finding.kind,
                        )
                    )
                        continue;
                    const reference = {
                        findingIndex,
                        role: finding.role,
                        passageKeys: finding.passages.map((p) => p.passageKey),
                    };
                    try {
                        const attributed = usage.constructAttributedHypothesis({
                            qualification,
                            sourceTitle: candidate.title,
                            role: finding.role,
                            findingIndex,
                        });
                        attributedUseProbes.push({
                            ...reference,
                            statement: attributed.statement,
                            citationResults: attributed.passages.map(
                                (passage) =>
                                    usage.validatePreparedEvidenceUse({
                                        qualification,
                                        sourceTitle: candidate.title,
                                        roleAvailability:
                                            item.roleAvailability ?? [],
                                        passage: {
                                            order: Number(
                                                passage.passageKey.slice(1),
                                            ),
                                            exactQuotation: passage.quotation,
                                        },
                                        statement: attributed.statement,
                                        classification: "Hypothesis",
                                        relation: "supporting",
                                    }),
                            ),
                        });
                    } catch (error) {
                        attributedUseProbes.push({
                            ...reference,
                            constructionError:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        });
                    }
                }
                return {
                    sourceId: item.sourceId,
                    authorityTier: item.authorityTier,
                    disposition: item.disposition,
                    qualificationOutcome: candidate.inspection.status,
                    unavailableReason:
                        candidate.inspection.status === "unavailable"
                            ? candidate.inspection.reasonCode
                            : undefined,
                    roleAvailability: item.roleAvailability,
                    attributedUseProbes,
                    factualSupportProbes: [...passages.values()].map(
                        (passage) => ({
                            passageKey: passage.passageKey,
                            result: usage.validatePreparedEvidenceUse({
                                qualification,
                                sourceTitle: candidate.title,
                                roleAvailability: item.roleAvailability ?? [],
                                passage: {
                                    order: Number(passage.passageKey.slice(1)),
                                    exactQuotation: passage.quotation,
                                },
                                statement: passage.quotation,
                                classification: "Fact",
                                relation: "supporting",
                            }),
                        }),
                    ),
                    semanticMisuseProbes: probes.probes
                        .filter((p) => p.caseId === item.sourceId)
                        .map((probe) => {
                            const input = manifest.inputs.find(
                                (i: { caseId: string }) =>
                                    i.caseId === item.sourceId,
                            );
                            const passage =
                                input.prepared.request.document.passages.find(
                                    (p: { passageKey: string }) =>
                                        p.passageKey === probe.passageKey,
                                );
                            assert(
                                passage,
                                "Missing probe passage in original input",
                            );
                            const result = usage.validatePreparedEvidenceUse({
                                qualification,
                                sourceTitle: candidate.title,
                                roleAvailability: item.roleAvailability ?? [],
                                passage: {
                                    order: Number(probe.passageKey.slice(1)),
                                    exactQuotation: passage.text,
                                },
                                statement: probe.statement,
                                classification: "Fact",
                                relation: "supporting",
                            });
                            return {
                                ...probe,
                                result,
                                matchesExpected:
                                    result.allowed === probe.expectedAllowed,
                            };
                        }),
                };
            }),
        };
    });
    const output = process.argv[3]
        ? resolve(process.argv[3])
        : join(run, "selection-policy-audit.json");
    const mismatches = reports.flatMap((report) =>
        report.items.flatMap((item) =>
            item.semanticMisuseProbes
                .filter((probe) => !probe.matchesExpected)
                .map((probe) => ({
                    model: report.model,
                    caseId: probe.caseId,
                    passageKey: probe.passageKey,
                    expectedAllowed: probe.expectedAllowed,
                    actualAllowed: probe.result.allowed,
                })),
        ),
    );
    const unsafeUseMismatches = mismatches.filter(
        (mismatch) => !mismatch.expectedAllowed && mismatch.actualAllowed,
    );
    const status = unsafeUseMismatches.length
        ? "unsafe_use_detected"
        : mismatches.length
          ? "expected_use_blocked"
          : "probes_match";
    writeFileSync(
        output,
        `${JSON.stringify(
            {
                mode: "offline_policy_effects",
                providerRequests: 0,
                status,
                mismatches,
                unsafeUseMismatches,
                limitations:
                    "Nineteen-document subset with category other and only URL-derived origin. Not the original full dossier or a semantic correctness verdict. Factual support probes show policy eligibility, not verified truth, approval or materialized claims.",
                summarySha256: sha(summaryBytes),
                datasetSha256: sha(datasetBytes),
                hashes,
                reports,
            },
            null,
            2,
        )}\n`,
        { flag: "wx" },
    );
    console.log(
        JSON.stringify({
            output,
            models: reports.length,
            documentsPerModel: 19,
            providerRequests: 0,
            status,
            mismatches,
        }),
    );
    if (mismatches.length) process.exitCode = 1;
} finally {
    await server.close();
}
