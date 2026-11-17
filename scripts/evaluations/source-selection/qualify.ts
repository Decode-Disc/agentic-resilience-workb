import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
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
    await runStudyCli("qualification");
    process.exit(0);
}

type Prepared = ReturnType<
    typeof import("@convex/domain/sourceQualification").prepareQualificationInput
>;
type Route =
    typeof import("@convex/integrations/sourceQualificationConfig").sourceQualificationRoutes[number];
type AttemptResult = Awaited<
    ReturnType<
        typeof import("@convex/integrations/sourceQualification").qualifySourceDocument
    >
>;
type EvaluationResult = AttemptResult & {
    event: "result";
    key: string;
    caseId: string;
    costUsd: number;
    costBasis: string;
    diagnostic?: unknown;
};
type Start = {
    event: "started";
    key: string;
    reservation: number;
    model: string;
    caseId: string;
    at: string;
};
type DocumentCase = {
    id: string;
    state: {
        source_url: string;
        discovery_title: string;
        captured_text: string;
    };
};
type ReferenceJudgment = {
    expected_company_match: string;
    expected_document_kind: string;
    required_roles_any_of: string[][];
    forbidden_roles: string[];
    expected_reporting_period_end?: string;
    rationale: string;
    usage_guard: string;
};
type ReplayResult = {
    event: "replayed";
    key: string;
    caseId: string;
    model: string;
    status: "succeeded";
    qualification: import("@convex/domain/sourceQualification").SourceQualification;
    sourceRun: string;
    sourceJournalSha256: string;
    originalStatus: string;
    originalErrorCode?: string;
};

const root = dirname(fileURLToPath(import.meta.url));
const project = resolve(root, "../../..");
const args = process.argv.slice(2);
assert(
    !(args.includes("--live") && args.includes("--replay-only")),
    "Choose live execution or offline replay, not both",
);
const option = (flag: string) => {
    const i = args.indexOf(flag);
    return i < 0 ? undefined : args[i + 1];
};
const maximumAttempts = Number(option("--max-attempts") ?? 100);
assert(Number.isSafeInteger(maximumAttempts) && maximumAttempts > 0);
const read = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const write = (path: string, value: unknown) =>
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
function jsonFields(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}
const dataset = read<{ cases: DocumentCase[] }>(
    join(root, "fixtures/dataset.json"),
);
const reference = read<{ judgments: Record<string, ReferenceJudgment> }>(
    join(root, "fixtures/qualification-reference.json"),
);
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
    const domain = (await server.ssrLoadModule(
        "/convex/domain/sourceQualification.ts",
    )) as typeof import("@convex/domain/sourceQualification");
    const transport = (await server.ssrLoadModule(
        "/convex/integrations/sourceQualification.ts",
    )) as typeof import("@convex/integrations/sourceQualification");
    const config = (await server.ssrLoadModule(
        "/convex/integrations/sourceQualificationConfig.ts",
    )) as typeof import("@convex/integrations/sourceQualificationConfig");
    const inputs = dataset.cases
        .filter((c: { id: string }) => c.id in reference.judgments)
        .map(
            (c: {
                id: string;
                state: {
                    source_url: string;
                    discovery_title: string;
                    captured_text: string;
                };
            }) => ({
                caseId: c.id,
                prepared: domain.prepareQualificationInput({
                    company: {
                        cik: "1373715",
                        legalName: "ServiceNow, Inc.",
                        ticker: "NOW",
                    },
                    canonicalUrl: c.state.source_url,
                    title: c.state.discovery_title,
                    asOfTime: Date.UTC(2026, 9, 20),
                    text: c.state.captured_text,
                }),
            }),
        );
    assert.equal(inputs.length, 19);
    const selectedInputs = option("--cases")
        ? inputs.filter((input: { caseId: string }) =>
              option("--cases")?.split(",").includes(input.caseId),
          )
        : inputs;
    const selectedRoutes = option("--models")
        ? config.sourceQualificationRoutes.filter((route: { model: string }) =>
              option("--models")?.split(",").includes(route.model),
          )
        : config.sourceQualificationRoutes;
    for (const name of option("--cases")?.split(",") ?? [])
        assert(
            inputs.some((input) => input.caseId === name),
            `Unknown document case: ${name}`,
        );
    for (const model of option("--models")?.split(",") ?? [])
        assert(
            config.sourceQualificationRoutes.some(
                (route) => route.model === model,
            ),
            `Unknown configured model: ${model}`,
        );
    assert(
        selectedInputs.length > 0 && selectedRoutes.length > 0,
        "No evaluation inputs selected",
    );
    const queue = selectedRoutes.flatMap((route: Route) =>
        selectedInputs.map((input: { caseId: string; prepared: Prepared }) => ({
            ...input,
            route,
            key: `${route.model}:${input.caseId}:${input.prepared.inputHash}`,
            reservation: EVALUATION_ATTEMPT_RESERVATION_USD,
        })),
    );
    const replays: ReplayResult[] = [];
    const unusableResponses: Array<Record<string, unknown>> = [];
    const reuseNames = option("--reuse-run")?.split(",") ?? [];
    for (const reuseName of reuseNames) {
        assert(/^[a-zA-Z0-9_-]+$/.test(reuseName));
        const savedManifest = read<{ routes: Route[] }>(
            join(root, "runs", reuseName, "manifest.json"),
        );
        const savedBytes = readFileSync(
            join(root, "runs", reuseName, "calls.jsonl"),
            "utf8",
        );
        const saved = savedBytes
            .trim()
            .split("\n")
            .filter(Boolean)
            .map(
                (line) =>
                    JSON.parse(line) as {
                        event: string;
                        key: string;
                        status: string;
                        errorCode?: string;
                        diagnostic?: { candidate?: unknown };
                    },
            );
        for (const call of queue) {
            if (replays.some((replay) => replay.key === call.key)) continue;
            const previous = saved.find(
                (entry) => entry.event === "result" && entry.key === call.key,
            );
            if (!previous) {
                assert(
                    !saved.some((entry) => entry.key === call.key),
                    "Unknown saved attempt; refusing to reissue it",
                );
                continue;
            }
            assert(
                savedManifest.routes.some(
                    (route) =>
                        route.model === call.route.model &&
                        route.provider === call.route.provider,
                ),
                "Saved route changed",
            );
            const validated = domain.materializeQualificationOutput(
                call.prepared,
                previous.diagnostic?.candidate,
            );
            if (
                validated.status !== "valid" &&
                (args.includes("--replay-only") ||
                    (args.includes("--repeat-failed-history") &&
                        previous.status === "failed"))
            ) {
                unusableResponses.push({
                    sourceRun: reuseName,
                    key: call.key,
                    originalStatus: previous.status,
                    validation: validated,
                });
                continue;
            }
            assert(
                validated.status === "valid",
                `Saved response ${reuseName}:${call.caseId}:${call.route.model} cannot be revalidated; refusing a silent paid repeat`,
            );
            replays.push({
                event: "replayed",
                key: call.key,
                caseId: call.caseId,
                model: call.route.model,
                status: "succeeded",
                qualification: validated.qualification,
                sourceRun: reuseName,
                sourceJournalSha256: sha(savedBytes),
                originalStatus: previous.status,
                originalErrorCode: previous.errorCode,
            });
        }
    }
    function judge(result: EvaluationResult | ReplayResult) {
        const expected = reference.judgments[result.caseId];
        assert(expected, "Missing frozen judgment");
        if (result.status !== "succeeded")
            return {
                caseId: result.caseId,
                model: result.model,
                unavailable: result.errorCode,
            };
        const q = result.qualification;
        const roles = q.findings.map((finding) => finding.role);
        return {
            caseId: result.caseId,
            model: result.model,
            evidenceOrigin:
                result.event === "replayed"
                    ? "offline_revalidation"
                    : "provider_execution",
            companyMatches: q.companyMatch === expected.expected_company_match,
            kindMatches: q.documentKind === expected.expected_document_kind,
            missingRoleGroups: expected.required_roles_any_of.filter(
                (group) =>
                    !group.some((role) =>
                        roles.includes(role as (typeof roles)[number]),
                    ),
            ),
            forbiddenRoles: expected.forbidden_roles.filter((role) =>
                roles.includes(role as (typeof roles)[number]),
            ),
            reportingPeriodMatches: expected.expected_reporting_period_end
                ? q.reportingPeriodEnd ===
                  expected.expected_reporting_period_end
                : null,
            qualification: q,
            referenceRationale: expected.rationale,
            usageGuard: expected.usage_guard,
        };
    }
    console.log(
        JSON.stringify({
            mode: args.includes("--live") ? "live" : "dry_run",
            documents: inputs.length,
            calls: queue.length - replays.length,
            revalidatedResponses: replays.length,
            maximumAttempts,
            budgetUsd: EVALUATION_BUDGET_USD,
            referenceSha256: sha(
                readFileSync(
                    join(root, "fixtures/qualification-reference.json"),
                    "utf8",
                ),
            ),
        }),
    );
    if (args.includes("--replay-only")) {
        const name = option("--run");
        assert(name && /^[a-zA-Z0-9_-]+$/.test(name));
        const run = join(root, "runs", name);
        mkdirSync(run, { recursive: true });
        write(join(run, "offline-revalidation.json"), {
            mode: "offline_revalidation",
            providerRequests: 0,
            qualificationVersion: domain.SOURCE_QUALIFICATION_VERSION,
            inputs,
            routes: selectedRoutes,
            passageExtractorSha256: sha(
                readFileSync(
                    join(project, "convex/domain/sourcePassages.ts"),
                    "utf8",
                ),
            ),
            materializerSha256: sha(
                readFileSync(
                    join(project, "convex/domain/sourceQualification.ts"),
                    "utf8",
                ),
            ),
            replays,
            unusableResponses,
            judgments: replays.map(judge),
        });
    }
    if (args.includes("--live")) {
        const name = option("--run");
        const priorName = option("--prior-run");
        const priorNames = priorName?.split(",");
        assert(name && /^[a-zA-Z0-9_-]+$/.test(name));
        assert(
            priorNames?.length &&
                priorNames.every(
                    (prior) => /^[a-zA-Z0-9_-]+$/.test(prior) && name !== prior,
                ),
            "Supply the choice-comparison run for combined accounting",
        );
        const priorHistory = readEvaluationHistory(
            join(root, "runs"),
            priorNames,
        );
        const priorCost = priorHistory.conservativeCostUsd;
        const run = join(root, "runs", name);
        const journal = join(run, "calls.jsonl");
        const events = existsSync(journal)
            ? readFileSync(journal, "utf8")
                  .trim()
                  .split("\n")
                  .filter(Boolean)
                  .map((line) => JSON.parse(line) as Start | EvaluationResult)
            : [];
        const results = events.filter((e) => e.event === "result");
        const starts = events.filter((e) => e.event === "started");
        assert(
            starts.every((start) =>
                results.some((result) => result.key === start.key),
            ),
            "Unknown earlier attempt; no automatic repeat",
        );
        const pending = queue.filter(
            (call: { key: string }) =>
                !results.some((result) => result.key === call.key) &&
                !replays.some((result) => result.key === call.key),
        );
        const limit = Number(option("--limit") ?? pending.length);
        assert(Number.isSafeInteger(limit) && limit >= 0);
        pending.splice(limit);
        assert(
            priorHistory.attempts + starts.length + pending.length <=
                maximumAttempts,
            `Selected evaluation requires ${priorHistory.attempts + starts.length + pending.length} total attempts; authorized maximum is ${maximumAttempts}`,
        );
        mkdirSync(run, { recursive: true });
        const sources = [
            "convex/domain/sourceQualification.ts",
            "convex/domain/sourcePassages.ts",
            "convex/domain/sourceSelectionPolicy.ts",
            "convex/integrations/sourceQualification.ts",
            "convex/integrations/sourceQualificationConfig.ts",
            "convex/integrations/evidenceNormalization.ts",
            "scripts/evaluations/source-selection/qualify.ts",
            "scripts/evaluations/source-selection/fixtures/qualification-reference.json",
            "pnpm-lock.yaml",
        ];
        const manifest = {
            schemaVersion: domain.SOURCE_QUALIFICATION_VERSION,
            priorRun: priorName,
            priorJournalSha256: priorHistory.journalSha256,
            priorAttempts: priorHistory.attempts,
            priorCost,
            maximumAttempts,
            budgetUsd: EVALUATION_BUDGET_USD,
            hashes: Object.fromEntries(
                sources.map((path) => [
                    path,
                    sha(readFileSync(join(project, path), "utf8")),
                ]),
            ),
            inputs,
            routes: selectedRoutes,
            selectedCases: selectedInputs.map(
                (input: { caseId: string }) => input.caseId,
            ),
            diagnostics: args.includes("--diagnostics"),
            repeatFailedHistory: args.includes("--repeat-failed-history"),
            unusableHistoricalResponses: unusableResponses,
            revalidatedResponses: replays,
        };
        for (const path of sources) {
            const snapshotPath = join(run, "sources", `${path}.txt`);
            mkdirSync(dirname(snapshotPath), { recursive: true });
            if (!existsSync(snapshotPath))
                writeFileSync(snapshotPath, readFileSync(join(project, path)), {
                    flag: "wx",
                });
        }
        const manifestPath = join(run, "manifest.json");
        if (existsSync(manifestPath))
            assert.deepEqual(
                read(manifestPath),
                manifest,
                "Inputs changed; retain this run and choose a new name",
            );
        else write(manifestPath, manifest);
        const env = parseEnv(readFileSync(join(project, ".env.local"), "utf8"));
        const configuredKey =
            process.env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY;
        assert(configuredKey, "Configure OpenRouter access in the environment");
        const apiKey: string = configuredKey;
        let attempts = priorHistory.attempts + starts.length;
        let spent =
            priorCost +
            starts.reduce(
                (sum, start) =>
                    sum +
                    (results.find((result) => result.key === start.key)
                        ?.costUsd ?? start.reservation),
                0,
            );
        const record = (event: unknown) =>
            appendFileSync(journal, `${JSON.stringify(event)}\n`);
        async function worker() {
            while (pending.length) {
                const call = pending.shift();
                if (!call) return;
                assert(
                    attempts < maximumAttempts &&
                        spent + call.reservation <= EVALUATION_BUDGET_USD,
                    "Combined evaluation envelope exhausted",
                );
                attempts += 1;
                spent += call.reservation;
                record({
                    event: "started",
                    key: call.key,
                    model: call.route.model,
                    caseId: call.caseId,
                    reservation: call.reservation,
                    at: new Date().toISOString(),
                });
                let diagnostic: unknown;
                const onResponse: Parameters<
                    typeof transport.qualifySourceDocument
                >[2]["onResponse"] = args.includes("--diagnostics")
                    ? ({ status, body: rawBody, requestId, generationId }) => {
                          const receipt = {
                              httpStatus: status,
                              requestId,
                              generationId,
                              responseBytes: Buffer.byteLength(rawBody),
                          };
                          const redacted = redactEvaluationResponse(
                              rawBody,
                              apiKey,
                          );
                          const saveHttpError = (error: unknown) => {
                              const path = `http/${sha(call.key)}.json`;
                              mkdirSync(join(run, "http"), { recursive: true });
                              write(join(run, path), {
                                  ...receipt,
                                  responseSha256: sha(rawBody),
                                  redaction: "configured_key_and_bearer_tokens",
                                  error,
                              });
                              return path;
                          };
                          let decoded: unknown;
                          try {
                              decoded = JSON.parse(redacted);
                          } catch {
                              diagnostic = {
                                  ...receipt,
                                  code: "non_json_response",
                                  responseSha256: sha(rawBody),
                                  httpErrorFile:
                                      status >= 400
                                          ? saveHttpError({
                                                nonJsonBody: redacted,
                                            })
                                          : undefined,
                              };
                              return;
                          }
                          const body = jsonFields(decoded);
                          if (!body) {
                              diagnostic = {
                                  ...receipt,
                                  code: "invalid_response_envelope",
                              };
                              return;
                          }
                          const choice = jsonFields(
                              Array.isArray(body.choices)
                                  ? body.choices[0]
                                  : undefined,
                          );
                          const error = jsonFields(body.error ?? choice?.error);
                          if (error) {
                              const metadata = jsonFields(error.metadata);
                              const httpErrorFile = saveHttpError({
                                  generationId: body.id,
                                  ...error,
                              });
                              diagnostic = {
                                  ...receipt,
                                  generationId: generationId ?? body.id,
                                  httpErrorFile,
                                  error: {
                                      code: error.code,
                                      message:
                                          typeof error.message === "string"
                                              ? error.message.slice(0, 2000)
                                              : undefined,
                                      providerName: metadata?.provider_name,
                                      errorType: metadata?.error_type,
                                      providerCode: metadata?.provider_code,
                                      raw:
                                          typeof metadata?.raw === "string"
                                              ? metadata.raw.slice(0, 8192)
                                              : undefined,
                                  },
                              };
                              return;
                          }
                          diagnostic = {
                              ...receipt,
                              generationId: generationId ?? body.id,
                          };
                          const content = jsonFields(choice?.message)?.content;
                          if (
                              typeof content !== "string" ||
                              content.length >= 65536
                          )
                              return;
                          let candidate: unknown;
                          try {
                              candidate = JSON.parse(content);
                          } catch {
                              diagnostic = {
                                  ...receipt,
                                  code: "malformed_json",
                              };
                              return;
                          }
                          const parsed = domain
                              .createQualificationResponseSchema(
                                  call.prepared.request.document.passages,
                              )
                              .safeParse(candidate);
                          diagnostic = {
                              ...receipt,
                              generationId: generationId ?? body.id,
                              candidate,
                              validation: domain.materializeQualificationOutput(
                                  call.prepared,
                                  candidate,
                              ),
                              schemaIssues: parsed.success
                                  ? []
                                  : parsed.error.issues,
                              finishReason: choice?.finish_reason,
                          };
                      }
                    : undefined;
                const result = await transport.qualifySourceDocument(
                    call.prepared,
                    call.route,
                    { apiKey, onResponse },
                );
                const costUsd = result.reportedCost ?? call.reservation;
                spent += costUsd - call.reservation;
                const entry: EvaluationResult = {
                    event: "result",
                    key: call.key,
                    caseId: call.caseId,
                    ...result,
                    diagnostic,
                    costUsd,
                    costBasis:
                        result.reportedCost === undefined
                            ? "conservative_reservation"
                            : "provider_reported",
                };
                record(entry);
                results.push(entry);
                console.log(
                    JSON.stringify({
                        caseId: call.caseId,
                        model: call.route.model,
                        status: result.status,
                        errorCode:
                            result.status === "failed"
                                ? result.errorCode
                                : undefined,
                        latencyMs: result.latencyMs,
                        costUsd,
                    }),
                );
                if (
                    result.status === "failed" &&
                    result.errorCode === "access_unavailable"
                )
                    throw new Error(
                        "Account access unavailable; comparison stopped",
                    );
            }
        }
        await Promise.all([worker(), worker()]);
        const judgments = [...results, ...replays].map(judge);
        writeFileSync(
            join(run, "summary.json"),
            `${JSON.stringify({ attempts, conservativeCostUsd: spent, judgments }, null, 2)}\n`,
        );
        console.log(JSON.stringify({ attempts, conservativeCostUsd: spent }));
    }
} finally {
    await server.close();
}
