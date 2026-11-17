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
import {
    EVALUATION_IO_POLICY,
    MODEL_MAX_INPUT_PRICE_PER_MILLION,
    MODEL_MAX_OUTPUT_PRICE_PER_MILLION,
} from "../../../convex/resourcePolicy.ts";

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
    version: 1 | 2 | 3;
    envelope?: Omit<
        NonNullable<StudySeed["envelope"]>,
        "version" | "conditionIndex"
    >;
    indicativeUncachedUsd?: number | null;
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
    conditions: Array<StudyCondition>;
    qualificationReference?: { file: string; sha256: string };
};
type StudySeed = FunctionArgs<typeof internal.sourcePreparationEvaluation.seed>;
type StudyCondition = {
    phase: StudySeed["phase"];
    concurrency: number;
    version?: StudySeed["executionPlanVersion"];
    warmup?: boolean;
    repetition?: number;
};
type QualificationReference = {
    sourceRunId: Doc<"researchRuns">["_id"];
    preparationId: Doc<"sourceSelectionProposalRebuilds">["_id"];
    qualifications: Array<{
        sourceId: Doc<"sources">["_id"];
        taskId: Doc<"aiTaskResults">["_id"];
        inputHash: string;
        contentHash: string;
        qualification?: import("@convex/domain/sourceQualification").SourceQualification;
        schemaVersion?: string;
    }>;
};

/** Freezes the order before any dispatch; paid repetitions require separately approved lots. */
export function buildPreparationStudyConditions(input: {
    phase: StudySeed["phase"];
    plans: Array<StudySeed["executionPlanVersion"]>;
    concurrencies: number[];
    repetitions: number;
    warmups: number;
    modelSourceCount?: number;
}): StudyCondition[] {
    assert(
        input.plans.length && input.concurrencies.length,
        "Study conditions are empty",
    );
    assert(
        input.plans.every((p) =>
            [
                "collect_then_compare_v1",
                "inline_controls_v2",
                "source_actions_v3",
            ].includes(p),
        ),
        "Unknown execution plan",
    );
    assert(
        input.concurrencies.every((c) => Number.isSafeInteger(c) && c > 0),
        "Invalid study concurrency",
    );
    assert(
        Number.isSafeInteger(input.repetitions) &&
            input.repetitions > 0 &&
            Number.isSafeInteger(input.warmups) &&
            input.warmups >= 0,
        "Invalid study repetitions",
    );
    const base = input.plans.flatMap((version) =>
        input.concurrencies.map((concurrency) => ({
            phase: input.phase,
            version,
            concurrency,
        })),
    );
    assert(
        base.length * (input.repetitions + input.warmups) <= 64,
        "Study condition limit exceeded",
    );
    const modelSourceCount = input.modelSourceCount ?? 24;
    assert(
        Number.isSafeInteger(modelSourceCount) &&
            modelSourceCount >= 0 &&
            modelSourceCount <= 24 &&
            (input.phase !== "reading" || modelSourceCount === 24),
        "Invalid model source count",
    );
    if (input.phase !== "replay") {
        assert(input.warmups === 0, "Paid warmups are not permitted");
        assert(
            base.length * input.repetitions * modelSourceCount * 2 <= 128,
            "Split paid conditions into separate approved lots",
        );
    }
    return [
        ...Array.from({ length: input.warmups }, (_, repetition) =>
            base.map((c) => ({ ...c, warmup: true, repetition })),
        ).flat(),
        ...Array.from({ length: input.repetitions }, (_, repetition) =>
            (repetition % 2 ? [...base].reverse() : base).map((c) => ({
                ...c,
                warmup: false,
                repetition,
            })),
        ).flat(),
    ];
}
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
            signal: AbortSignal.timeout(
                EVALUATION_IO_POLICY.catalogRequestTimeoutMs,
            ),
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
                            AbortSignal.timeout(
                                EVALUATION_IO_POLICY.nativeLogPageTimeoutMs,
                            ),
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
                    await new Promise((resolve) =>
                        setTimeout(
                            resolve,
                            EVALUATION_IO_POLICY.nativeLogIdlePollMs,
                        ),
                    );
            } catch {
                if (controller.signal.aborted) break;
                appendFileSync(
                    file,
                    `${JSON.stringify({ event: "log_read_failed", cursor, occurredAt: Date.now() })}\n`,
                );
                await new Promise((resolve) =>
                    setTimeout(
                        resolve,
                        EVALUATION_IO_POLICY.nativeLogFailureBackoffMs,
                    ),
                );
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
            phase: { type: "string" },
            plans: { type: "string" },
            concurrencies: { type: "string" },
            repetitions: { type: "string" },
            warmups: { type: "string" },
            "qualification-reference": { type: "string" },
            "qualification-results": { type: "string" },
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
        const studyPolicy = (await server.ssrLoadModule(
            "/convex/sourcePreparationStudyPolicy.ts",
        )) as typeof import("@convex/sourcePreparationStudyPolicy");
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
                !values.phase ||
                    ["replay", "reading", "comparison"].includes(values.phase),
                "Invalid study phase",
            );
            let referenceModelSources: number | undefined;
            let qualificationReference: Manifest["qualificationReference"];
            if (values["qualification-reference"]) {
                assert(
                    values.phase === "comparison",
                    "Qualification references are comparison-only",
                );
                const file = "qualification-reference.json";
                const reference = read(
                    values["qualification-reference"],
                ) as QualificationReference;
                assert.equal(
                    reference.sourceRunId,
                    snapshot.run._id,
                    "Reference belongs to another source dossier",
                );
                assert.equal(
                    reference.qualifications.length,
                    24,
                    "A complete reading reference is required",
                );
                const retained = values["qualification-results"]
                    ? (read(values["qualification-results"]) as {
                          tasks: Snapshot["tasks"];
                      })
                    : undefined;
                for (const entry of reference.qualifications) {
                    if (!entry.qualification || !entry.schemaVersion) {
                        const task = retained?.tasks.find(
                            (task) => task._id === entry.taskId,
                        );
                        assert(
                            task?.output.kind === "source_qualification" &&
                                task.inputHash === entry.inputHash &&
                                task.output.contentHash === entry.contentHash,
                            "Older reading references require --qualification-results with the matching retained native result",
                        );
                        entry.qualification = task.output.qualification;
                        entry.schemaVersion = task.schemaVersion;
                    }
                    entry.qualification =
                        domain.sourceQualificationSchema.parse(
                            entry.qualification,
                        );
                }
                referenceModelSources = reference.qualifications.filter(
                    (entry) => {
                        assert(
                            entry.qualification && entry.schemaVersion,
                            "Frozen qualification payload missing",
                        );
                        return studyPolicy.qualificationNeedsStudyComparison(
                            entry.qualification,
                            entry.schemaVersion,
                        );
                    },
                ).length;
                copyFileSync(
                    values["qualification-reference"],
                    join(dir, "qualification-reference-original.json"),
                );
                save(join(dir, file), reference);
                qualificationReference = {
                    file,
                    sha256: sha(readFileSync(join(dir, file))),
                };
            }
            const conditions = values.phase
                ? buildPreparationStudyConditions({
                      phase: values.phase as StudySeed["phase"],
                      plans: (values.plans ?? "source_actions_v3").split(
                          ",",
                      ) as StudySeed["executionPlanVersion"][],
                      concurrencies: (values.concurrencies ?? "2,4")
                          .split(",")
                          .map(Number),
                      repetitions: Number(values.repetitions ?? "1"),
                      warmups: Number(values.warmups ?? "0"),
                      modelSourceCount: referenceModelSources,
                  })
                : undefined;
            const replayOnly =
                conditions?.every(
                    (condition) => condition.phase === "replay",
                ) ?? false;
            assert(
                values.phase !== "comparison" || qualificationReference,
                "New comparison lots require a frozen reading reference",
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
            const quoted = replayOnly
                ? { observedAt: new Date().toISOString(), models: [] }
                : await catalog([...settings.sourceQualificationRoutes], {
                      input: MODEL_MAX_INPUT_PRICE_PER_MILLION / 1e6,
                      output: MODEL_MAX_OUTPUT_PRICE_PER_MILLION / 1e6,
                  });
            const frozenConditions = conditions ?? [
                { phase: "reading" as const, concurrency: 2 },
                { phase: "reading" as const, concurrency: 4 },
                { phase: "comparison" as const, concurrency: 4 },
                { phase: "comparison" as const, concurrency: 2 },
            ];
            const comparisonModelSources =
                referenceModelSources ??
                sources.filter((sourceId) => {
                    const outcome = p.sourceOutcomes?.find(
                        (entry) => entry.sourceId === sourceId,
                    );
                    const taskId =
                        outcome?.result.status === "qualified"
                            ? outcome.result.taskId
                            : undefined;
                    const task = snapshot.tasks.find(
                        (task) => task._id === taskId,
                    );
                    assert(
                        task?.output.kind === "source_qualification",
                        "Frozen qualification missing",
                    );
                    return studyPolicy.qualificationNeedsStudyComparison(
                        task.output.qualification,
                        task.schemaVersion,
                    );
                }).length;
            const conditionEnvelopes = frozenConditions.map((condition) => ({
                phase: condition.phase,
                modelSources:
                    condition.phase === "replay"
                        ? 0
                        : condition.phase === "reading"
                          ? 24
                          : comparisonModelSources,
            }));
            const envelope = {
                conditions: conditionEnvelopes,
                ...studyPolicy.quotePreparationStudy(conditionEnvelopes),
            };
            const manifest: Manifest = {
                version: 3,
                envelope,
                indicativeUncachedUsd: null,
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
                maximumAttempts: envelope.maximumAttempts,
                maximumReservationUsd: envelope.maximumReservationUsd,
                qualificationReference,
                conditions: frozenConditions,
            };
            save(join(dir, "manifest.json"), manifest);
            if (!replayOnly)
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
                    indicativeUncachedUsd:
                        manifest.indicativeUncachedUsd ?? null,
                    estimateUnavailableReason:
                        "exact_provider_requests_not_frozen",
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
        const qualificationReference = manifest.qualificationReference
            ? (() => {
                  const path = join(dir, manifest.qualificationReference.file);
                  assert.equal(
                      sha(readFileSync(path)),
                      manifest.qualificationReference.sha256,
                      "Frozen reading reference changed",
                  );
                  return read(path) as QualificationReference;
              })()
            : undefined;
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
                    input: MODEL_MAX_INPUT_PRICE_PER_MILLION / 1e6,
                    output: MODEL_MAX_OUTPUT_PRICE_PER_MILLION / 1e6,
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
        const conditions =
            manifest.version >= 2
                ? manifest.conditions.map((c) => ({
                      ...c,
                      version: c.version ?? ("inline_controls_v2" as const),
                  }))
                : values.offline
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
        assert(
            conditions.every((c) =>
                values.offline ? c.phase === "replay" : c.phase !== "replay",
            ),
            "Study mode does not match frozen conditions",
        );
        if (manifest.version === 2 && values.live) {
            assert(
                conditions.length * 24 * 2 <= 128 &&
                    conditions.every((c) => !("warmup" in c && c.warmup)),
                "Paid conditions exceed the approved lot",
            );
        }
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
                    ...(manifest.envelope
                        ? {
                              envelope: {
                                  version: 1 as const,
                                  conditionIndex: index,
                                  ...manifest.envelope,
                              },
                          }
                        : {}),
                    phase: condition.phase,
                    concurrency: condition.concurrency,
                    executionPlanVersion: condition.version,
                    ...(qualificationReference
                        ? {
                              qualificationReferencePreparationId:
                                  qualificationReference.preparationId,
                          }
                        : {}),
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
                const originalSourceIds = new Map<
                    Doc<"sources">["_id"],
                    Doc<"sources">["_id"]
                >();
                for (const [fixtureIndex, capture] of entries.entries()) {
                    const outcome = p.sourceOutcomes?.find(
                        (o) => o.sourceId === capture.sourceId,
                    );
                    assert(outcome?.result.status === "qualified");
                    const taskId = qualificationReference
                        ? qualificationReference.qualifications.find(
                              (q) => q.sourceId === capture.sourceId,
                          )?.taskId
                        : outcome.result.taskId;
                    assert(taskId, "Frozen qualification missing");
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
                            ? { qualificationTaskId: taskId }
                            : {}),
                        ...(condition.phase === "replay"
                            ? { replayInputHash: input.inputHash }
                            : {}),
                        ...(condition.concurrency === 60
                            ? { fixtureIndex }
                            : {}),
                    });
                    originalSourceIds.set(imported.sourceId, source._id);
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
                    await new Promise((r) =>
                        setTimeout(
                            r,
                            EVALUATION_IO_POLICY.preparationObservationPollMs,
                        ),
                    );
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
                    readingMs: result.preparation.initialReadingsCompletedAt
                        ? result.preparation.initialReadingsCompletedAt -
                          startedAt
                        : null,
                    proposalTailMs: result.preparation
                        .initialReadingsCompletedAt
                        ? result.preparation.completedAt -
                          result.preparation.initialReadingsCompletedAt
                        : null,
                    sources: result.preparation.sourceOutcomes?.length,
                    unavailable: result.preparation.sourceOutcomes?.filter(
                        (o) => o.result.status !== "qualified",
                    ).length,
                    steps: result.steps.length,
                    scheduledSteps: result.steps.filter(
                        (s) => "workId" in s && s.workId,
                    ).length,
                    providerCalls: result.calls.length,
                    distinctPaidSources: new Set(
                        result.calls.map((call) => call.sourceId),
                    ).size,
                    logicalModelInputs: new Set(
                        result.calls.map((call) => call.inputHash),
                    ).size,
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
                if (condition.phase === "reading") {
                    assert(
                        result.preparation.sourceOutcomes?.length ===
                            entries.length &&
                            result.preparation.sourceOutcomes.every(
                                (o) => o.result.status === "qualified",
                            ),
                        "Reading lot incomplete; do not continue or silently reduce its workload",
                    );
                    const reference: QualificationReference = {
                        sourceRunId: manifest.sourceRunId,
                        preparationId: seeded.preparationId,
                        qualifications: result.preparation.sourceOutcomes.map(
                            (outcome) => {
                                assert(outcome.result.status === "qualified");
                                const taskId = outcome.result.taskId;
                                const task = result.tasks.find(
                                    (t) => t._id === taskId,
                                );
                                assert(
                                    task?.output.kind ===
                                        "source_qualification" &&
                                        task.schemaVersion ===
                                            domain.SOURCE_QUALIFICATION_VERSION,
                                    "Fresh current-version qualifications required",
                                );
                                const sourceId = originalSourceIds.get(
                                    outcome.sourceId,
                                );
                                assert(
                                    sourceId,
                                    "Original source mapping missing",
                                );
                                return {
                                    sourceId,
                                    taskId: task._id,
                                    inputHash: task.inputHash,
                                    contentHash: task.output.contentHash,
                                    qualification: task.output.qualification,
                                    schemaVersion: task.schemaVersion,
                                };
                            },
                        ),
                    };
                    save(
                        join(
                            dir,
                            `${batchKey}-${index}-qualification-reference.json`,
                        ),
                        reference,
                    );
                }
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
