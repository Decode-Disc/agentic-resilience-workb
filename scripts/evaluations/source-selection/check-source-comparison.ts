import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    appendFileSync,
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readdirSync,
    readFileSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import type {
    PreparedSourceComparisonInput,
    SourceComparisonOutput,
} from "@convex/domain/sourceComparison";
import type { SourceQualificationRoute } from "@convex/integrations/sourceQualificationConfig";
import { createServer } from "vite";
import {
    EVALUATION_ATTEMPT_RESERVATION_USD,
    EVALUATION_BUDGET_USD,
    readEvaluationHistory,
    redactEvaluationResponse,
} from "./evaluation-records.ts";

import { runStudyCli } from "./study-cli.ts";

if (
    process.argv.includes("--study") ||
    process.argv.includes("--list-models")
) {
    await runStudyCli("comparison");
    process.exit(0);
}

type ComparisonResult = Awaited<
    ReturnType<
        typeof import("@convex/integrations/sourceQualification").compareSourceContributions
    >
>;
type SavedResult = {
    event: "result";
    key: string;
    caseId: string;
    result: ComparisonResult;
    costUsd: number;
    costBasis: string;
};
type Start = {
    event: "started";
    key: string;
    reservation: number;
    model: string;
    caseId: string;
    at: string;
};
type AuditCase = {
    caseId: string;
    targetPassageKey: string;
    expectedDisposition: "possible_conflict";
    expectedArgumentEffect: string;
    judgment: string;
    model: string;
    status: string;
    inputHash?: string;
    serializedRequestBytes?: number;
    omittedFindingIndexes?: number[];
    preparedRequest?: PreparedSourceComparisonInput["request"];
};

const project = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const root = join(project, "scripts/evaluations/source-selection");
const args = process.argv.slice(2);
if (!args.includes("--live"))
    globalThis.fetch = async () => {
        throw new Error(
            "Offline comparison preparation cannot access a provider",
        );
    };
const option = (name: string) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
};
const name = option("--run");
assert(name && /^[a-zA-Z0-9_-]+$/.test(name), "Supply a new bounded run name");
const maximumAttempts = Number(option("--max-attempts") ?? 185);
assert(
    Number.isSafeInteger(maximumAttempts) && maximumAttempts > 0,
    "Invalid cumulative attempt ceiling",
);
const run = join(root, "runs", name);
const parentName = "qualification-v3-matrix-20261020";
assert(name !== parentName, "Never overwrite qualification evidence");
const parent = join(root, "runs", parentName);
const auditFile = option("--audit") ?? "source-comparison-input-final.json";
assert(
    /^[a-zA-Z0-9_-]+\.json$/.test(auditFile),
    "Invalid frozen audit filename",
);
const auditPath = join(parent, auditFile);
const catalogFile =
    option("--catalog") ?? "endpoints-targeted-comparison-2026-10-20.json";
assert(
    /^[a-zA-Z0-9_-]+\.json$/.test(catalogFile),
    "Invalid endpoint snapshot filename",
);
const catalogPath = join(root, "fixtures", catalogFile);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const read = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
const save = (path: string, value: unknown) =>
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
const auditBytes = readFileSync(auditPath, "utf8");
const audit = JSON.parse(auditBytes) as {
    sourceHashes: Record<string, string>;
    reports: AuditCase[];
};
for (const [path, expectedHash] of Object.entries(audit.sourceHashes))
    assert.equal(
        sha(readFileSync(join(project, path), "utf8")),
        expectedHash,
        `Frozen retrieval source changed: ${path}`,
    );
const parentManifest = read<{ priorRun: string }>(
    join(parent, "manifest.json"),
);
const paidComparisonRuns = readdirSync(join(root, "runs"), {
    withFileTypes: true,
})
    .filter(
        (entry) =>
            entry.isDirectory() &&
            entry.name !== name &&
            existsSync(join(root, "runs", entry.name, "calls.jsonl")),
    )
    .map((entry) => entry.name)
    .filter(
        (candidate) =>
            read<{ task?: string }>(
                join(root, "runs", candidate, "manifest.json"),
            ).task === "targeted_source_comparison",
    )
    .sort();
const historyNames = [
    ...new Set([
        ...parentManifest.priorRun.split(","),
        parentName,
        ...paidComparisonRuns,
    ]),
];
const prior = readEvaluationHistory(join(root, "runs"), historyNames);
const catalog = read<{
    checkedAt: string;
    routes: Array<{
        model: string;
        architecture: { input_modalities: string[] };
        endpoint: {
            tag: string;
            status: number;
            pricing: { prompt: string; completion: string };
            supported_parameters: string[];
        };
    }>;
}>(catalogPath);
const availableCases = audit.reports.filter(
    (item) =>
        item.status === "expected_evidence_retrieved" &&
        item.model === "xiaomi/mimo-v2.6-flash",
);
assert.equal(
    availableCases.length,
    2,
    "Expected the two recorded critical comparison cases",
);
const selectedCase = option("--case");
assert(
    !selectedCase ||
        availableCases.some((item) => item.caseId === selectedCase),
    "Unknown comparison case",
);
const cases = availableCases.filter(
    (item) => !selectedCase || item.caseId === selectedCase,
);
const server = await createServer({
    root: project,
    configFile: false,
    envDir: false,
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    resolve: { tsconfigPaths: true },
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
});
let lock: number | undefined;
const lockPath = join(run, "execution.lock");
try {
    const domain = (await server.ssrLoadModule(
        "/convex/domain/sourceComparison.ts",
    )) as typeof import("@convex/domain/sourceComparison");
    const transport = (await server.ssrLoadModule(
        "/convex/integrations/sourceQualification.ts",
    )) as typeof import("@convex/integrations/sourceQualification");
    const config = (await server.ssrLoadModule(
        "/convex/integrations/sourceQualificationConfig.ts",
    )) as typeof import("@convex/integrations/sourceQualificationConfig");
    const queue = cases.flatMap((item) =>
        config.sourceQualificationRoutes.map(
            (route: SourceQualificationRoute) => {
                assert(
                    item.preparedRequest &&
                        item.inputHash &&
                        item.serializedRequestBytes &&
                        item.omittedFindingIndexes,
                    "Incomplete frozen comparison input",
                );
                const endpoint = catalog.routes.find(
                    (candidate) =>
                        candidate.model === route.model &&
                        candidate.endpoint.tag === route.provider,
                );
                assert(
                    endpoint?.endpoint.status === 0 &&
                        endpoint.architecture.input_modalities.includes(
                            "text",
                        ) &&
                        endpoint.endpoint.supported_parameters.includes(
                            "structured_outputs",
                        ),
                    "Configured endpoint not supported by the recorded catalog",
                );
                const price = (value: string) => {
                    const match = /^\$([0-9.]+)\/M tokens$/.exec(value);
                    assert(match, "Unrecognized endpoint pricing units");
                    return Number(match[1]);
                };
                assert(
                    price(endpoint.endpoint.pricing.prompt) <=
                        config.QUALIFICATION_MAX_INPUT_PRICE_PER_MILLION &&
                        price(endpoint.endpoint.pricing.completion) <=
                            config.QUALIFICATION_MAX_OUTPUT_PRICE_PER_MILLION,
                    "Configured endpoint exceeds production price limits",
                );
                assert(
                    item.serializedRequestBytes <=
                        domain.SOURCE_COMPARISON_MAX_INPUT_BYTES &&
                        item.preparedRequest.findings.some(
                            (finding) => finding.primaryPassageKeys.length > 0,
                        ),
                    "No comparable bounded input",
                );
                const prepared: PreparedSourceComparisonInput = {
                    request: item.preparedRequest,
                    inputHash: item.inputHash,
                    omittedFindingIndexes: item.omittedFindingIndexes,
                    serializedRequestBytes: item.serializedRequestBytes,
                };
                return {
                    caseId: item.caseId,
                    route,
                    prepared,
                    key: `${route.model}:${item.caseId}:${item.inputHash}`,
                };
            },
        ),
    );
    const sourcePaths = [
        "convex/domain/sourceComparison.ts",
        "convex/integrations/sourceQualification.ts",
        "convex/integrations/sourceQualificationConfig.ts",
        "scripts/evaluations/source-selection/evaluation-records.ts",
        "scripts/evaluations/source-selection/check-source-comparison.ts",
        "pnpm-lock.yaml",
    ];
    const hashes = Object.fromEntries(
        sourcePaths.map((path) => [
            path,
            sha(readFileSync(join(project, path), "utf8")),
        ]),
    );
    const manifest = {
        task: "targeted_source_comparison",
        comparisonVersion: domain.SOURCE_COMPARISON_VERSION,
        priorRun: historyNames.join(","),
        priorAttempts: prior.attempts,
        priorCost: prior.conservativeCostUsd,
        priorJournalSha256: prior.journalSha256,
        maximumAttempts,
        budgetUsd: EVALUATION_BUDGET_USD,
        reservationPerAttempt: EVALUATION_ATTEMPT_RESERVATION_USD,
        auditFile,
        auditSha256: sha(auditBytes),
        catalogFile,
        catalogSha256: sha(readFileSync(catalogPath, "utf8")),
        hashes,
        qualificationOrigin:
            "Both comparison routes receive the same frozen MiMo qualification. This isolates the new comparison task; it is not a fresh qualification or application execution.",
        judgments: cases.map((item) => ({
            caseId: item.caseId,
            targetPassageKey: item.targetPassageKey,
            expectedDisposition: item.expectedDisposition,
            acceptablePrimaryPassageKeys:
                item.caseId === "doc_capital" ? ["p11", "p56"] : ["p145"],
            expectedArgumentEffect: item.expectedArgumentEffect,
            judgment: item.judgment,
            provenance:
                "Investigator-authored judgments from direct reading of frozen documents, recorded before comparison inference. No independent human ground truth.",
        })),
        inputs: queue.map((item) => ({
            caseId: item.caseId,
            route: item.route,
            prepared: item.prepared,
        })),
        acceptance:
            "Exact references and critical disposition are machine checks only. Investigator review of every returned contribution and explanation is required before semantic acceptance. No activation is performed.",
    };
    const manifestPath = join(run, "manifest.json");
    if (existsSync(manifestPath))
        assert.deepEqual(
            read(manifestPath),
            manifest,
            "Evaluation input changed; preserve this run",
        );
    if (args.includes("--prepare")) {
        mkdirSync(run, { recursive: true });
        if (!existsSync(manifestPath)) save(manifestPath, manifest);
        for (const path of sourcePaths) {
            const saved = join(run, "sources", `${path}.txt`);
            if (!existsSync(saved)) {
                mkdirSync(dirname(saved), { recursive: true });
                writeFileSync(saved, readFileSync(join(project, path)), {
                    flag: "wx",
                });
            }
        }
    }
    const journal = join(run, "calls.jsonl");
    const events: Array<Start | SavedResult> = existsSync(journal)
        ? readFileSync(journal, "utf8")
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line))
        : [];
    const starts = events.filter(
        (event): event is Start => event.event === "started",
    );
    const results = events.filter(
        (event): event is SavedResult => event.event === "result",
    );
    assert(
        starts.every((start) =>
            results.some((result) => result.key === start.key),
        ),
        "Unresolved prior attempt; refusing dispatch or automatic repetition",
    );
    assert(
        new Set(starts.map((item) => item.key)).size === starts.length &&
            starts.every((item) => queue.some((call) => call.key === item.key)),
        "Invalid comparison journal identity",
    );
    const pending = queue.filter(
        (call) => !starts.some((start) => start.key === call.key),
    );
    const requestedLimit = Number(option("--limit") ?? pending.length);
    assert(
        Number.isSafeInteger(requestedLimit) &&
            requestedLimit >= 0 &&
            requestedLimit <= 4,
        "Only the four prepared comparisons are available",
    );
    pending.splice(requestedLimit);
    let attempts = prior.attempts + starts.length;
    let spent =
        prior.conservativeCostUsd +
        results.reduce((sum, item) => sum + item.costUsd, 0);
    console.log(
        JSON.stringify({
            mode: args.includes("--live") ? "live" : "dry_run",
            preparedCalls: queue.length,
            pendingCalls: pending.length,
            priorAttempts: attempts,
            maximumAttempts,
            conservativeCostUsd: spent,
            maximumAdditionalReservationUsd:
                pending.length * EVALUATION_ATTEMPT_RESERVATION_USD,
            providerRequests: 0,
            appWrites: 0,
        }),
    );
    if (!args.includes("--live")) {
        assert(!args.includes("--prepare") || existsSync(manifestPath));
    } else {
        assert(
            existsSync(manifestPath),
            "Prepare and review the frozen manifest before live execution",
        );
        assert(
            Date.now() - Date.parse(catalog.checkedAt) < 3_600_000,
            "Refresh the official selected-endpoint snapshot before dispatch",
        );
        assert(
            attempts + pending.length <= maximumAttempts,
            "Prepared comparison exceeds the authorized cumulative call ceiling",
        );
        assert(
            spent + pending.length * EVALUATION_ATTEMPT_RESERVATION_USD <=
                EVALUATION_BUDGET_USD,
            "Prepared comparison exceeds the unchanged cumulative dollar budget",
        );
        lock = openSync(lockPath, "wx");
        const env = parseEnv(readFileSync(join(project, ".env.local"), "utf8"));
        const apiKey = process.env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY;
        assert(apiKey, "Configure the existing model credential securely");
        const controller = new AbortController();
        const abort = () => controller.abort();
        process.once("SIGINT", abort);
        process.once("SIGTERM", abort);
        const record = (event: Start | SavedResult) =>
            appendFileSync(journal, `${JSON.stringify(event)}\n`);
        try {
            for (const call of pending) {
                if (controller.signal.aborted) break;
                const start: Start = {
                    event: "started",
                    key: call.key,
                    model: call.route.model,
                    caseId: call.caseId,
                    reservation: EVALUATION_ATTEMPT_RESERVATION_USD,
                    at: new Date().toISOString(),
                };
                record(start);
                attempts += 1;
                spent += start.reservation;
                const result = await transport.compareSourceContributions(
                    call.prepared,
                    call.route,
                    {
                        apiKey,
                        signal: controller.signal,
                        onResponse: (response) => {
                            const redacted = redactEvaluationResponse(
                                response.body,
                                apiKey,
                            );
                            let decoded: unknown;
                            try {
                                const body = JSON.parse(redacted);
                                decoded = {
                                    id: body.id,
                                    model: body.model,
                                    provider: body.provider,
                                    usage: body.usage,
                                    error: body.error,
                                    choices: body.choices?.map(
                                        (choice: {
                                            index?: number;
                                            finish_reason?: string;
                                            error?: unknown;
                                            message?: {
                                                role?: string;
                                                content?: unknown;
                                            };
                                        }) => ({
                                            index: choice.index,
                                            finish_reason: choice.finish_reason,
                                            error: choice.error,
                                            message: {
                                                role: choice.message?.role,
                                                content:
                                                    choice.message?.content,
                                            },
                                        }),
                                    ),
                                };
                            } catch {
                                decoded = {
                                    nonJsonBody: redacted.slice(0, 8192),
                                    truncated: redacted.length > 8192,
                                };
                            }
                            mkdirSync(join(run, "http"), { recursive: true });
                            save(join(run, "http", `${sha(call.key)}.json`), {
                                status: response.status,
                                requestId: response.requestId,
                                generationId: response.generationId,
                                responseBytes: Buffer.byteLength(response.body),
                                responseSha256: sha(response.body),
                                storagePolicy:
                                    "Credential-redacted diagnostic fields and response content only. Reasoning fields omitted.",
                                response: decoded,
                            });
                        },
                    },
                );
                const costUsd = result.reportedCost ?? start.reservation;
                assert(
                    Number.isFinite(costUsd) && costUsd >= 0,
                    "Invalid provider cost receipt",
                );
                spent += costUsd - start.reservation;
                const saved: SavedResult = {
                    event: "result",
                    key: call.key,
                    caseId: call.caseId,
                    result,
                    costUsd,
                    costBasis:
                        result.reportedCost === undefined
                            ? "conservative_reservation"
                            : "provider_reported",
                };
                record(saved);
                results.push(saved);
                console.log(
                    JSON.stringify({
                        caseId: call.caseId,
                        model: call.route.model,
                        status: result.status,
                        costUsd,
                        latencyMs: result.latencyMs,
                    }),
                );
                if (
                    result.status === "failed" &&
                    [
                        "access_unavailable",
                        "invalid_output",
                        "request_invalid",
                    ].includes(result.errorCode)
                )
                    break;
            }
        } finally {
            process.off("SIGINT", abort);
            process.off("SIGTERM", abort);
        }
    }
    const judgments = results.map((item) => {
        const expected = manifest.judgments.find(
            (candidate) => candidate.caseId === item.caseId,
        );
        assert(expected, "Missing saved investigator judgment");
        const output: SourceComparisonOutput | undefined =
            item.result.status === "succeeded" ? item.result.output : undefined;
        const finding = output?.findings.find((candidate) =>
            candidate.targetPassages.some(
                (passage) => passage.passageKey === expected.targetPassageKey,
            ),
        );
        return {
            key: item.key,
            caseId: item.caseId,
            model: item.result.model,
            available: Boolean(output),
            criticalDispositionMatches:
                finding?.disposition === expected.expectedDisposition,
            expectedPrimaryCited:
                finding?.primaryPassages.some((passage) =>
                    expected.acceptablePrimaryPassageKeys.includes(
                        passage.passageKey,
                    ),
                ) ?? false,
            output,
            expectedArgumentEffect: expected.expectedArgumentEffect,
            investigatorReview: "pending",
        };
    });
    if (existsSync(manifestPath))
        writeFileSync(
            join(run, "summary.json"),
            `${JSON.stringify({ attempts, conservativeCostUsd: spent, completedComparisons: results.length, plannedComparisons: queue.length, judgments, semanticAcceptance: "pending_investigator_review", activationPerformed: false }, null, 2)}\n`,
        );
} finally {
    if (lock !== undefined) {
        closeSync(lock);
        unlinkSync(lockPath);
    }
    await server.close();
}
