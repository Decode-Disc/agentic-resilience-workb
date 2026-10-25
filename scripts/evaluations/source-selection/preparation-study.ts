import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    appendFileSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Doc } from "@convex/_generated/dataModel";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { makeFunctionReference } from "convex/server";
import { createServer } from "vite";
import type { internal } from "../../../convex/_generated/api.js";

const seedStudy = makeFunctionReference<
    "mutation",
    FunctionArgs<typeof internal.sourcePreparationEvaluation.seed>,
    FunctionReturnType<typeof internal.sourcePreparationEvaluation.seed>
>("sourcePreparationEvaluation:seed");
const copySourceStudy = makeFunctionReference<
    "mutation",
    FunctionArgs<typeof internal.sourcePreparationEvaluation.copySource>,
    FunctionReturnType<typeof internal.sourcePreparationEvaluation.copySource>
>("sourcePreparationEvaluation:copySource");
const startStudy = makeFunctionReference<
    "mutation",
    FunctionArgs<typeof internal.sourcePreparationEvaluation.start>,
    FunctionReturnType<typeof internal.sourcePreparationEvaluation.start>
>("sourcePreparationEvaluation:start");
const inspectStudy = makeFunctionReference<
    "query",
    FunctionArgs<typeof internal.sourcePreparationEvaluation.inspect>,
    FunctionReturnType<typeof internal.sourcePreparationEvaluation.inspect>
>("sourcePreparationEvaluation:inspect");

const sha = (s: string | Uint8Array) =>
    createHash("sha256").update(s).digest("hex");
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const save = (p: string, value: unknown) =>
    writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
type Snapshot = {
    run: Doc<"researchRuns">;
    preparations: Doc<"sourceSelectionProposalRebuilds">[];
    sources: Doc<"sources">[];
    captures: Doc<"sourceCaptures">[];
    tasks: Doc<"aiTaskResults">[];
};
type Manifest = {
    version: 1;
    sourceRunId: Doc<"researchRuns">["_id"];
    snapshotFile: string;
    snapshotSha256: string;
    sourceIds: Doc<"sources">["_id"][];
    replaySourceIds: Doc<"sources">["_id"][];
    captures: Array<{
        sourceId: Doc<"sources">["_id"];
        file: string;
        sha256: string;
    }>;
    code: Record<string, string>;
    catalog: Catalog;
    maximumAttempts: number;
    maximumReservationUsd: number;
    conditions: Array<{ phase: "reading" | "comparison"; concurrency: number }>;
};
type Catalog = {
    observedAt: string;
    models: Array<{
        id: string;
        provider: string;
        inputPricePerToken: number;
        outputPricePerToken: number;
        contextLength: number;
        sourceUrl: string;
    }>;
};

/** Refreshes public vendor metadata; no credentials or inference are involved. */
async function catalog(
    routes: Array<{ model: string; provider: string }>,
    ceilings: { input: number; output: number },
): Promise<Catalog> {
    const get = async (url: string) => {
        const r = await fetch(url, {
            redirect: "error",
            signal: AbortSignal.timeout(30000),
        });
        assert(r.ok, `Catalog HTTP ${r.status}`);
        return r.json();
    };
    const models = await get("https://openrouter.ai/api/v1/models");
    const selected: Catalog["models"] = [];
    for (const route of routes) {
        const model = models.data.find(
            (m: { id: string }) => m.id === route.model,
        );
        assert(model, "Configured model unavailable");
        const url = `https://openrouter.ai/api/v1/models/${route.model}/endpoints`;
        const endpoints = await get(url);
        const endpoint = endpoints.data.endpoints.find(
            (e: { provider_name: string; status: number }) =>
                e.provider_name.toLowerCase() ===
                    route.provider.toLowerCase() && e.status === 0,
        );
        assert(
            endpoint?.supported_parameters?.includes("structured_outputs"),
            "Configured structured-output route unavailable",
        );
        assert(
            Number(endpoint.pricing.prompt) <= ceilings.input &&
                Number(endpoint.pricing.completion) <= ceilings.output,
            "Route exceeds application price ceilings",
        );
        selected.push({
            id: route.model,
            provider: route.provider,
            inputPricePerToken: Number(endpoint.pricing.prompt),
            outputPricePerToken: Number(endpoint.pricing.completion),
            contextLength: model.context_length,
            sourceUrl: url,
        });
    }
    return { observedAt: new Date().toISOString(), models: selected };
}

/** Keeps the finite native log buffer drained while recording read failures explicitly. */
export function captureNativeStudyLogs(
    origin: string,
    adminKey: string,
    file: string,
) {
    const controller = new AbortController();
    let cursor = Date.now();
    const pending = (async () => {
        while (!controller.signal.aborted) {
            try {
                const response = await fetch(
                    `${origin}/api/stream_function_logs?cursor=${cursor}`,
                    {
                        headers: { Authorization: `Convex ${adminKey}` },
                        signal: AbortSignal.any([
                            controller.signal,
                            AbortSignal.timeout(30000),
                        ]),
                    },
                );
                assert(response.ok, `Native logs HTTP ${response.status}`);
                const page = await response.json();
                assert(
                    Array.isArray(page.entries) &&
                        Number.isFinite(page.newCursor),
                    "Invalid native log page",
                );
                for (const entry of page.entries) {
                    const { logLines: _lines, ...metadata } = entry;
                    appendFileSync(
                        file,
                        `${JSON.stringify({ ...metadata, error: Boolean(entry.error) })}\n`,
                    );
                }
                cursor = page.newCursor;
                if (!page.entries.length)
                    await new Promise((resolve) => setTimeout(resolve, 250));
            } catch {
                if (controller.signal.aborted) break;
                appendFileSync(
                    file,
                    `${JSON.stringify({ event: "log_read_failed", cursor, occurredAt: Date.now() })}\n`,
                );
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
    })();
    return async () => {
        controller.abort();
        await pending;
    };
}

/** Runs the actual durable workflow locally; replay grants zero model allowance even on a cache miss. */
export async function runPreparationStudy(argv: string[]) {
    const { values } = parseArgs({
        args: argv,
        options: {
            prepare: { type: "boolean" },
            offline: { type: "boolean" },
            live: { type: "boolean" },
            snapshot: { type: "string" },
            captures: { type: "string" },
            out: { type: "string" },
            slot: { type: "string" },
            authorization: { type: "string" },
            stress: { type: "boolean" },
        },
    });

    assert(
        [values.prepare, values.offline, values.live].filter(Boolean).length ===
            1,
        "Choose --prepare, --offline or --live",
    );
    assert(values.out, "--out is required");
    const dir = resolve(values.out);
    const server = await createServer({
        server: { middlewareMode: true, hmr: false },
        appType: "custom",
        logLevel: "error",
    });
    try {
        const domain = (await server.ssrLoadModule(
            "/convex/domain/sourceQualification.ts",
        )) as typeof import("@convex/domain/sourceQualification");
        const settings = (await server.ssrLoadModule(
            "/convex/integrations/sourceQualificationConfig.ts",
        )) as typeof import("@convex/integrations/sourceQualificationConfig");
        const study = (await server.ssrLoadModule(
            "/convex/sourcePreparationEvaluation.ts",
        )) as typeof import("@convex/sourcePreparationEvaluation");
        if (values.prepare) {
            assert(
                values.snapshot && values.captures,
                "--snapshot and --captures are required",
            );
            assert(
                !existsSync(join(dir, "manifest.json")),
                "Use a fresh immutable output directory",
            );
            mkdirSync(dir, { recursive: true });
            const snapshot = read(values.snapshot) as Snapshot;
            const p = snapshot.preparations.find(
                (p) => p._id === snapshot.run.sourcePreparationId,
            );
            assert(
                p && snapshot.run.executionStatus === "paused",
                "A completed preparation checkpoint is required",
            );
            const sources =
                p.sourceOutcomes
                    ?.filter((o) => o.result.status === "qualified")
                    .map((o) => o.sourceId) ?? [];
            assert(
                sources.length === 24,
                "This bounded protocol requires the retained 24-source corpus",
            );
            const captures = sources.map((sourceId) => {
                const c = snapshot.captures.find(
                    (c) => c.sourceId === sourceId && c.status === "committed",
                );
                assert(c?.contentHash, "Missing committed capture");
                const file = join("captures", `${c._id}.txt`);
                const captureDir = values.captures;
                assert(captureDir);
                const input = join(resolve(captureDir), `${c._id}.txt`);
                assert.equal(
                    sha(readFileSync(input)),
                    c.contentHash,
                    "Frozen capture bytes changed",
                );
                mkdirSync(join(dir, "captures"), { recursive: true });
                copyFileSync(input, join(dir, file));
                return { sourceId, file, sha256: c.contentHash };
            });
            copyFileSync(values.snapshot, join(dir, "snapshot.json"));
            const files = new Set([
                ...execFileSync("rg", ["--files", "convex"], {
                    encoding: "utf8",
                })
                    .trim()
                    .split("\n"),
                "package.json",
                "pnpm-lock.yaml",
                fileURLToPath(import.meta.url).replace(`${process.cwd()}/`, ""),
                "scripts/evaluations/source-selection/study-cli.ts",
            ]);
            const code: Record<string, string> = {};
            for (const file of files) {
                code[file] = sha(readFileSync(file));
                mkdirSync(dirname(join(dir, "code", file)), {
                    recursive: true,
                });
                copyFileSync(file, join(dir, "code", file));
            }
            const quoted = await catalog(
                [...settings.sourceQualificationRoutes],
                {
                    input:
                        settings.QUALIFICATION_MAX_INPUT_PRICE_PER_MILLION /
                        1e6,
                    output:
                        settings.QUALIFICATION_MAX_OUTPUT_PRICE_PER_MILLION /
                        1e6,
                },
            );
            const manifest: Manifest = {
                version: 1,
                sourceRunId: snapshot.run._id,
                snapshotFile: "snapshot.json",
                snapshotSha256: sha(readFileSync(join(dir, "snapshot.json"))),
                sourceIds: sources,
                replaySourceIds: sources.filter((sourceId) =>
                    snapshot.tasks.some(
                        (task) =>
                            task.sourceId === sourceId &&
                            task.output.kind === "source_qualification" &&
                            task.output.selectionStrategy === "full_document",
                    ),
                ),
                captures,
                code,
                catalog: quoted,
                maximumAttempts: study.PREPARATION_STUDY_MAX_ATTEMPTS,
                maximumReservationUsd:
                    study.PREPARATION_STUDY_MAX_RESERVATION_USD,
                conditions: [
                    { phase: "reading", concurrency: 2 },
                    { phase: "reading", concurrency: 4 },
                    { phase: "comparison", concurrency: 4 },
                    { phase: "comparison", concurrency: 2 },
                ],
            };
            save(join(dir, "manifest.json"), manifest);
            save(join(dir, "grant-template.json"), {
                manifestSha256: sha(JSON.stringify(manifest)),
                maximumAttempts: manifest.maximumAttempts,
                budgetUsd:
                    Math.ceil(manifest.maximumReservationUsd * 100) / 100,
                approvedAt: "REQUIRES_EXPLICIT_AUTHORIZATION",
            });
            console.log(
                JSON.stringify({
                    prepared: dir,
                    manifestSha256: sha(JSON.stringify(manifest)),
                    maximumAttempts: manifest.maximumAttempts,
                    maximumReservationUsd: manifest.maximumReservationUsd,
                }),
            );
            return;
        }
        const manifest = read(join(dir, "manifest.json")) as Manifest;
        assert.equal(
            sha(readFileSync(join(dir, manifest.snapshotFile))),
            manifest.snapshotSha256,
        );
        for (const [file, expected] of Object.entries(manifest.code))
            assert.equal(
                sha(readFileSync(file)),
                expected,
                `Prepared code changed: ${file}`,
            );
        for (const capture of manifest.captures)
            assert.equal(
                sha(readFileSync(join(dir, capture.file))),
                capture.sha256,
            );
        const manifestSha256 = sha(JSON.stringify(manifest));
        let approval: FunctionArgs<
            typeof internal.sourcePreparationEvaluation.start
        >["approval"];
        if (values.live) {
            assert(
                values.authorization,
                "Explicit --authorization is required for paid work",
            );
            const fresh = await catalog(
                [...settings.sourceQualificationRoutes],
                {
                    input:
                        settings.QUALIFICATION_MAX_INPUT_PRICE_PER_MILLION /
                        1e6,
                    output:
                        settings.QUALIFICATION_MAX_OUTPUT_PRICE_PER_MILLION /
                        1e6,
                },
            );
            const { validateStudyApproval } = (await server.ssrLoadModule(
                "/scripts/evaluations/source-selection/study-cli.ts",
            )) as typeof import("./study-cli.ts");
            approval = validateStudyApproval({
                manifestSha256,
                maximumAttempts: manifest.maximumAttempts,
                maximumReservationUsd: manifest.maximumReservationUsd,
                catalog: manifest.catalog,
                currentCatalog: fresh,
                approval: read(values.authorization),
            });
        }
        assert(values.slot, "An already admitted --slot is required");
        const config = read(".convex/local/default/config.json");
        const origin = `http://127.0.0.1:${config.ports.cloud}`;
        assert.equal(
            await fetch(`${origin}/instance_name`).then((r) => r.text()),
            config.deploymentName,
            "Local backend identity mismatch",
        );
        const client = new ConvexHttpClient(origin);
        (
            client as ConvexHttpClient & { setAdminAuth(key: string): void }
        ).setAdminAuth(config.adminKey);
        const flag = await client.query(
            makeFunctionReference<
                "query",
                { name: string },
                { value: string } | null
            >("_system/cli/queryEnvironmentVariables:get"),
            { name: "E2E_FIXTURES_ENABLED" },
        );
        assert.equal(
            flag?.value,
            "true",
            "Enable local fixtures explicitly; remove them after the experiment",
        );
        const snapshot = read(join(dir, manifest.snapshotFile)) as Snapshot;
        const p = snapshot.preparations.find(
            (p) => p._id === snapshot.run.sourcePreparationId,
        );
        assert(p?.sourceOutcomes);
        const company = snapshot.run.companySnapshot;
        assert(company);
        const conditions = values.offline
            ? [
                  {
                      phase: "replay" as const,
                      concurrency: 2,
                      version: "collect_then_compare_v1" as const,
                  },
                  {
                      phase: "replay" as const,
                      concurrency: 2,
                      version: "inline_controls_v2" as const,
                  },
                  {
                      phase: "replay" as const,
                      concurrency: 4,
                      version: "inline_controls_v2" as const,
                  },
                  ...(values.stress
                      ? [
                            {
                                phase: "replay" as const,
                                concurrency: 60,
                                version: "inline_controls_v2" as const,
                            },
                        ]
                      : []),
              ]
            : manifest.conditions.map((c) => ({
                  ...c,
                  version: "inline_controls_v2" as const,
              }));
        const batchKey = `${values.offline ? "offline" : "live"}-${Date.now()}`;
        const journal = join(dir, `${batchKey}.jsonl`);
        // A live rerun of a partial/unknown batch must never silently create new dossier namespaces.
        assert(
            !values.live || !existsSync(join(dir, "live-started.json")),
            "Paid batch already started; inspect its receipts instead of replaying",
        );
        if (values.live)
            save(join(dir, "live-started.json"), {
                manifestSha256,
                batchKey,
                approval,
            });
        const stopLogs = captureNativeStudyLogs(
            origin,
            config.adminKey,
            join(dir, `${batchKey}-native.jsonl`),
        );
        try {
            for (const [index, condition] of conditions.entries()) {
                const seeded = await client.mutation(seedStudy, {
                    slotKey: values.slot,
                    fixtureKey: `prep-${manifestSha256.slice(0, 12)}-${batchKey}-${index}`,
                    sourceRunId: manifest.sourceRunId,
                    manifestSha256,
                    phase: condition.phase,
                    concurrency: condition.concurrency,
                    executionPlanVersion: condition.version,
                });
                appendFileSync(
                    journal,
                    `${JSON.stringify({ event: "seeded", condition, ...seeded })}\n`,
                );
                const stressCapture = [...manifest.captures]
                    .filter((c) =>
                        manifest.replaySourceIds.includes(c.sourceId),
                    )
                    .sort((a, b) => {
                        const size = (id: typeof a.sourceId) =>
                            JSON.stringify(
                                snapshot.tasks.find(
                                    (t) =>
                                        t.sourceId === id &&
                                        t.output.kind ===
                                            "source_qualification",
                                ),
                            ).length;
                        return size(b.sourceId) - size(a.sourceId);
                    })[0];
                assert(
                    stressCapture,
                    "No complete frozen qualification for stress replay",
                );
                const entries =
                    condition.concurrency === 60
                        ? Array.from({ length: 60 }, () => stressCapture)
                        : manifest.captures.filter(
                              (c) =>
                                  !values.offline ||
                                  manifest.replaySourceIds.includes(c.sourceId),
                          );
                for (const [fixtureIndex, capture] of entries.entries()) {
                    const outcome = p.sourceOutcomes?.find(
                        (o) => o.sourceId === capture.sourceId,
                    );
                    assert(outcome?.result.status === "qualified");
                    const taskId = outcome.result.taskId;
                    const task = snapshot.tasks.find((t) => t._id === taskId);
                    assert(task);
                    const source = snapshot.sources.find(
                        (s) => s._id === capture.sourceId,
                    );
                    assert(source);
                    const metadata = snapshot.captures.find(
                        (c) =>
                            c.sourceId === source._id &&
                            c.status === "committed",
                    );
                    assert(metadata);
                    const title =
                        condition.concurrency === 60
                            ? `${source.title} [replay ${fixtureIndex}]`
                            : source.title;
                    const input = domain.prepareQualificationInput({
                        company,
                        canonicalUrl:
                            metadata.resolvedUrl ?? source.canonicalUrl,
                        title,
                        asOfTime: p.asOfTime ?? p.createdAt,
                        researchAngle: snapshot.run.researchAngle,
                        text: readFileSync(join(dir, capture.file), "utf8"),
                        retrievalCompleteness: metadata.readingCompleteness,
                        selectionPolicy: metadata.qualificationInputPolicy,
                    });
                    const imported = await client.mutation(copySourceStudy, {
                        preparationId: seeded.preparationId,
                        sourceId: source._id,
                        expectedContentHash: capture.sha256,
                        ...(condition.phase !== "reading"
                            ? { qualificationTaskId: task._id }
                            : {}),
                        ...(condition.phase === "replay"
                            ? { replayInputHash: input.inputHash }
                            : {}),
                        ...(condition.concurrency === 60
                            ? { fixtureIndex }
                            : {}),
                    });
                    appendFileSync(
                        journal,
                        `${JSON.stringify({ event: "imported", ...imported, originalSourceId: source._id })}\n`,
                    );
                }
                const startedAt = Date.now();
                const handle = await client.mutation(startStudy, {
                    preparationId: seeded.preparationId,
                    manifestSha256,
                    ...(approval ? { approval } : {}),
                });
                appendFileSync(
                    journal,
                    `${JSON.stringify({ event: "started", ...seeded, startedAt, handle })}\n`,
                );
                let result:
                    | FunctionReturnType<
                          typeof internal.sourcePreparationEvaluation.inspect
                      >
                    | undefined;
                while (Date.now() - startedAt < 16 * 60_000) {
                    result = await client.query(inspectStudy, {
                        preparationId: seeded.preparationId,
                        details: false,
                    });
                    if (result.preparation.status !== "started") break;
                    await new Promise((r) => setTimeout(r, 1000));
                }
                assert(
                    result && result.preparation.status !== "started",
                    "Study is still active; inspect/cancel before further work",
                );
                result = await client.query(inspectStudy, {
                    preparationId: seeded.preparationId,
                });
                save(join(dir, `${batchKey}-${index}-result.json`), result);
                assert(
                    !values.offline || result.calls.length === 0,
                    "Offline study unexpectedly reserved a provider call",
                );
                assert(result.preparation.completedAt);
                const summary = {
                    event: "completed",
                    condition,
                    ...seeded,
                    elapsedMs: result.preparation.completedAt - startedAt,
                    sources: result.preparation.sourceOutcomes?.length,
                    unavailable: result.preparation.sourceOutcomes?.filter(
                        (o) => o.result.status !== "qualified",
                    ).length,
                    steps: result.steps.length,
                    scheduledSteps: result.steps.filter(
                        (s) => "workId" in s && s.workId,
                    ).length,
                    providerCalls: result.calls.length,
                    reportedCostUsd: result.calls.reduce(
                        (n, c) => n + (c.reportedCost ?? 0),
                        0,
                    ),
                };
                appendFileSync(journal, `${JSON.stringify(summary)}\n`);
                console.log(JSON.stringify(summary));
                if (values.offline)
                    assert(
                        result.preparation.sourceOutcomes?.length ===
                            entries.length &&
                            result.preparation.sourceOutcomes.every(
                                (o) => o.result.status === "qualified",
                            ),
                        "Replay did not retain the full common workload; timing is diagnostic only",
                    );
                assert(
                    result.run.executionStatus === "paused",
                    "Evaluation did not release the visitor slot",
                );
                assert(
                    !result.calls.some(
                        (c) =>
                            c.status === "started" ||
                            c.dispatchOutcome === "unknown",
                    ),
                    "Unresolved provider outcome; stop the batch",
                );
            }
        } finally {
            await stopLogs();
        }
    } finally {
        await server.close();
    }
}
if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
    await runPreparationStudy(process.argv.slice(2));
