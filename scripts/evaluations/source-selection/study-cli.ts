import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    appendFileSync,
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readFileSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { createServer } from "vite";
import { evaluationTransport, validateAnswers } from "./decision-protocol.ts";
import {
    EvaluationBudget,
    EvaluationBudgetStop,
    estimateUncachedEvaluation,
    knownEvaluationCharge,
    readEvaluationHistory,
    redactEvaluationResponse,
} from "./evaluation-records.ts";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const save = (path: string, value: unknown) =>
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
type Catalog = {
    observedAt: string;
    models: Array<{
        id: string;
        inputPricePerToken: number;
        outputPricePerToken: number;
        contextLength: number;
        provider: string;
        sourceUrl: string;
        reasoning?: { enabled?: boolean; effort?: string; exclude?: boolean };
        maximumOutputTokens?: number;
    }>;
};
/** Applies evaluation routing and billing settings without changing task inputs or schemas. */
function selectGenerativeRequest(
    template: Record<string, unknown>,
    selected: { id: string; provider: string },
    profile?: Catalog["models"][number],
): Record<string, unknown> {
    const body = structuredClone(template);
    body.model = selected.id;
    body.provider = {
        ...(body.provider as object),
        only: [selected.provider],
        ...(profile
            ? {
                  max_price: {
                      prompt: profile.inputPricePerToken * 1_000_000,
                      completion: profile.outputPricePerToken * 1_000_000,
                  },
              }
            : {}),
    };
    if (profile?.reasoning !== undefined) {
        const reasoning = profile.reasoning;
        assert(
            reasoning &&
                typeof reasoning === "object" &&
                !Array.isArray(reasoning) &&
                Object.keys(reasoning).every((key) =>
                    ["enabled", "effort", "exclude"].includes(key),
                ) &&
                (reasoning.enabled === undefined ||
                    typeof reasoning.enabled === "boolean") &&
                (reasoning.exclude === undefined ||
                    typeof reasoning.exclude === "boolean") &&
                (reasoning.effort === undefined ||
                    [
                        "none",
                        "minimal",
                        "low",
                        "medium",
                        "high",
                        "xhigh",
                        "max",
                    ].includes(reasoning.effort)),
            "Invalid catalog reasoning settings",
        );
        body.reasoning = structuredClone(reasoning);
    }
    if (profile?.maximumOutputTokens !== undefined) {
        assert(
            Number.isSafeInteger(profile.maximumOutputTokens) &&
                profile.maximumOutputTokens > 0 &&
                profile.maximumOutputTokens <= 8192,
            "Catalog output cap must be between 1 and 8192 tokens",
        );
        body.max_tokens = profile.maximumOutputTokens;
    }
    return body;
}

type Approval = {
    manifestSha256: string;
    maximumAttempts: number;
    budgetUsd: number;
    approvedAt: string;
};

type Entry = {
    event: "started" | "result" | "response";
    key: string;
    reservation?: number;
    requestHash?: string;
    status?: string;
    response?: Record<string, unknown>;
    costUsd?: number;
    costBasis?: string;
    estimatedCostUsd?: number;
    latencyMs?: number;
    output?: unknown;
    at: string;
};
const SOURCE_FILES = [
    "scripts/evaluations/source-selection/study-cli.ts",
    "scripts/evaluations/source-selection/source-quality-study.ts",
    "scripts/evaluations/source-selection/decision-protocol.ts",
    "scripts/evaluations/source-selection/evaluation-records.ts",
    "convex/domain/sourceQualification.ts",
    "convex/domain/sourceComparison.ts",
    "convex/domain/sourcePassages.ts",
    "convex/domain/sourceSelectionPolicy.ts",
    "convex/integrations/sourceQualification.ts",
    "convex/integrations/sourceQualificationConfig.ts",
    "convex/integrations/evidenceNormalization.ts",
    "convex/resourceLimits.ts",
    "pnpm-lock.yaml",
];

/** Shares one immutable manifest/accounting journal across the three entrypoints; default execution is offline. */
export async function runStudyCli(
    mode: "choices" | "qualification" | "comparison",
    args = process.argv.slice(2),
) {
    if (args.includes("--retrieval-phase")) {
        if (args[args.indexOf("--retrieval-phase") + 1] === "replay") {
            const { runRetrievalReplay } = await import(
                "./retrieval-replay.ts"
            );
            return runRetrievalReplay(args);
        }
        const { runRetrievalStudyCli } = await import("./retrieval-study.ts");
        return runRetrievalStudyCli(args);
    }
    const valued = new Set([
        "--study",
        "--run",
        "--catalog",
        "--report",
        "--authorization",
        "--phase",
        "--preflight-catalog",
        "--cases",
        "--replacements",
        "--models",
        "--tasks",
        "--budget-policy",
        "--cost-reference",
    ]);
    const switches = new Set([
        "--prepare",
        "--summarize",
        "--live",
        "--list-models",
    ]);
    const seen = new Set<string>();
    for (let index = 0; index < args.length; index++) {
        const flag = args[index];
        assert(
            flag && (valued.has(flag) || switches.has(flag)),
            `Unknown study option: ${flag}`,
        );
        assert(!seen.has(flag), `Duplicate study option: ${flag}`);
        seen.add(flag);
        if (valued.has(flag)) {
            const value = args[++index];
            assert(
                value && !value.startsWith("--"),
                `Missing study option value: ${flag}`,
            );
        }
    }
    assert(
        [...switches].filter((flag) => seen.has(flag)).length <= 1,
        "Choose preparation, scoring or live dispatch separately",
    );
    const option = (flag: string) => {
        const index = args.indexOf(flag);
        return index < 0 ? undefined : args[index + 1];
    };
    const catalogPath = option("--catalog");
    const catalog = catalogPath ? (read(catalogPath) as Catalog) : undefined;
    if (args.includes("--list-models")) {
        assert(
            catalog && Array.isArray(catalog.models),
            "Supply --catalog to list available models",
        );
        assert(
            !option("--models") && !option("--replacements"),
            "List models separately from selection",
        );
        console.log(
            JSON.stringify(
                {
                    observedAt: catalog.observedAt,
                    models: catalog.models.map((model) => ({
                        id: model.id,
                        provider: model.provider,
                        reasoning: model.reasoning,
                        maximumOutputTokens: model.maximumOutputTokens,
                    })),
                },
                null,
                2,
            ),
        );
        return;
    }
    const path = option("--study");
    assert(path && !path.startsWith("--"), "Supply --study STUDY.json");
    const candidate = read(path) as { schemaVersion?: string };
    assert(
        candidate.schemaVersion === "source-quality-study-v1",
        "Invalid source quality study",
    );
    const live = args.includes("--live");
    const authorizationFile = option("--authorization");
    assert(
        !live || authorizationFile,
        "This study has no authorized inference manifest; supply a separately approved --authorization file",
    );
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const server = await createServer({
        root,
        configFile: false,
        envDir: false,
        server: { middlewareMode: true, hmr: false, ws: false, watch: null },
        resolve: { tsconfigPaths: true },
        appType: "custom",
        optimizeDeps: { noDiscovery: true },
        cacheDir: "/tmp/workbench-source-quality-study-cache",
    });
    let lock: number | undefined;
    let lockPath: string | undefined;
    try {
        const domain = (await server.ssrLoadModule(
            "/scripts/evaluations/source-selection/source-quality-study.ts",
        )) as typeof import("./source-quality-study.ts");
        const transport = (await server.ssrLoadModule(
            "/convex/integrations/sourceQualification.ts",
        )) as typeof import("@convex/integrations/sourceQualification");
        const loaded = domain.readStudy(path);
        const manifest = domain.prepareStudy(loaded);
        // Capture the SDK's actual wire bodies using only an external-I/O double.
        // This request-local fake credential never leaves the process.
        for (const call of manifest.calls.filter((c) => c.task !== "choices")) {
            let body: Record<string, unknown> | undefined;
            const fetchCapture: typeof fetch = async (_url, init) => {
                assert.equal(
                    typeof init?.body,
                    "string",
                    "SDK did not serialize a JSON request",
                );
                body = JSON.parse(init?.body as string) as Record<
                    string,
                    unknown
                >;
                return new Response(
                    JSON.stringify({
                        error: { message: "Offline wire capture", code: 400 },
                    }),
                    {
                        status: 400,
                        headers: { "content-type": "application/json" },
                    },
                );
            };
            const route = {
                model: call.model,
                provider: call.model.startsWith("deepseek/")
                    ? "reka"
                    : "deepinfra/fp8",
            } as Parameters<typeof transport.qualifySourceDocument>[1];
            const dependencies = {
                apiKey: "offline-wire-capture-not-a-provider-key",
                fetch: fetchCapture,
            };
            if (call.task === "qualification")
                await transport.qualifySourceDocument(
                    call.prepared as Parameters<
                        typeof transport.qualifySourceDocument
                    >[0],
                    route,
                    dependencies,
                );
            else
                await transport.compareSourceContributions(
                    call.prepared as Parameters<
                        typeof transport.compareSourceContributions
                    >[0],
                    route,
                    dependencies,
                );
            if (body) {
                call.body = body;
                call.requestHash = sha(JSON.stringify(body));
            } else
                manifest.blockers.push(`adapter_issued_no_request:${call.key}`);
        }
        if (loaded.inputContract) {
            assert.equal(
                Object.keys(loaded.inputContract.providerInputHashes).length,
                manifest.calls.length,
                "Frozen input request count changed",
            );
            for (const call of manifest.calls)
                assert.equal(
                    call.requestHash,
                    loaded.inputContract.providerInputHashes[call.key],
                    `Frozen provider input changed: ${call.key}`,
                );
        }
        const selectionPath = option("--cases");
        const selectedCaseIds = selectionPath ? read(selectionPath) : null;
        if (selectedCaseIds !== null) {
            assert(
                Array.isArray(selectedCaseIds) &&
                    selectedCaseIds.length > 0 &&
                    selectedCaseIds.every((id) => typeof id === "string") &&
                    new Set(selectedCaseIds).size === selectedCaseIds.length,
                "Supply distinct frozen case identifiers",
            );
            assert(
                selectedCaseIds.every((id) =>
                    manifest.cases.some((item) => item.id === id),
                ),
                "Unknown frozen case selection",
            );
            manifest.cases = manifest.cases.filter((item) =>
                selectedCaseIds.includes(item.id),
            );
            manifest.calls = manifest.calls.filter(
                (call) =>
                    call.task === "choices" &&
                    selectedCaseIds.includes(call.caseId),
            );
            assert(
                manifest.calls.length ===
                    selectedCaseIds.length * manifest.models.length,
                "Incomplete selected-case comparison",
            );
        }
        const replacementsPath = option("--replacements");
        const replacements = replacementsPath
            ? (read(replacementsPath) as Array<{
                  from: string;
                  to: string;
                  provider: string;
              }>)
            : null;
        const requestedModels = option("--models");
        const requestedTasks = option("--tasks")?.split(",");
        if (requestedTasks) {
            assert(
                requestedModels &&
                    !replacements &&
                    !selectedCaseIds &&
                    requestedTasks.length > 0 &&
                    new Set(requestedTasks).size === requestedTasks.length &&
                    requestedTasks.every((task) =>
                        ["qualification", "comparison"].includes(task),
                    ) &&
                    requestedTasks.includes(mode),
                "Grouped task selection requires --models, matching entrypoints and distinct qualification/comparison tasks; select common cases separately",
            );
        }
        assert(
            !(requestedModels && replacements),
            "Choose --models or legacy --replacements separately",
        );
        let selectedModels: Array<{ id: string; provider: string }> | null =
            null;
        if (requestedModels) {
            assert(
                catalog && Array.isArray(catalog.models),
                "Model selection requires --catalog",
            );
            const identifiers =
                requestedModels === "all"
                    ? catalog.models.map((model) => model.id)
                    : requestedModels.split(",").map((id) => id.trim());
            assert(
                identifiers.length > 0 &&
                    identifiers.every((id) => id.length > 0) &&
                    new Set(identifiers).size === identifiers.length,
                "Supply distinct selected model identifiers",
            );
            selectedModels = identifiers.map((id) => {
                const profile = catalog.models.find((model) => model.id === id);
                assert(profile, `Unknown selected model: ${id}`);
                return { id, provider: profile.provider };
            });
        } else if (replacements !== null) {
            assert(
                Array.isArray(replacements) &&
                    replacements.length > 0 &&
                    replacements.every(
                        (item) =>
                            item &&
                            typeof item.from === "string" &&
                            typeof item.to === "string" &&
                            typeof item.provider === "string" &&
                            item.provider.length > 0 &&
                            manifest.models.includes(item.from),
                    ) &&
                    new Set(replacements.map((item) => item.from)).size ===
                        replacements.length &&
                    new Set(replacements.map((item) => item.to)).size ===
                        replacements.length,
                "Invalid model replacements",
            );
            selectedModels = replacements.map((item) => ({
                id: item.to,
                provider: item.provider,
            }));
        }
        if (selectedModels !== null && requestedTasks) {
            assert(catalog);
            assert(
                selectedModels.every(
                    (selected) => !evaluationTransport(selected.id).native,
                ),
                "Native decision models cannot execute grouped extraction tasks",
            );
            const units = new Map<string, (typeof manifest.calls)[number]>();
            for (const call of manifest.calls) {
                if (
                    requestedTasks.includes(call.task) &&
                    !units.has(`${call.task}:${call.caseId}`)
                )
                    units.set(`${call.task}:${call.caseId}`, call);
            }
            manifest.calls = [...units.values()].flatMap((template) =>
                selectedModels.map((selected) => {
                    assert(
                        typeof selected.provider === "string" &&
                            selected.provider.length > 0,
                        "Selected model needs a configured provider",
                    );
                    const profile = catalog.models.find(
                        (model) => model.id === selected.id,
                    );
                    assert(profile);
                    const body = selectGenerativeRequest(
                        template.body,
                        selected,
                        profile,
                    );
                    return {
                        ...template,
                        key: `${template.task}:${template.caseId}:${selected.id}`,
                        model: selected.id,
                        body,
                        requestHash: sha(JSON.stringify(body)),
                    };
                }),
            );
            manifest.models = selectedModels.map((selected) => selected.id);
        } else if (selectedModels !== null) {
            assert(
                mode === "choices" && selectedCaseIds !== null,
                "Model selection requires an explicit common-case selection",
            );
            const originalCalls = manifest.calls;
            manifest.calls = manifest.cases.flatMap((item) =>
                selectedModels.map((selected) => {
                    assert(
                        typeof selected.provider === "string" &&
                            selected.provider.length > 0,
                        "Selected model needs a configured provider",
                    );
                    const route = evaluationTransport(selected.id);
                    const existing = originalCalls.find(
                        (call) =>
                            call.caseId === item.id &&
                            call.model === selected.id,
                    );
                    const profile = catalog?.models.find(
                        (model) => model.id === selected.id,
                    );
                    if (route.native) {
                        assert(
                            existing?.native,
                            "No frozen native template for selected model",
                        );
                        assert(
                            !profile?.reasoning &&
                                profile?.maximumOutputTokens === undefined,
                            "Generative settings cannot be applied to a native decision model",
                        );
                        return existing;
                    }
                    const template =
                        existing ??
                        originalCalls.find(
                            (call) => call.caseId === item.id && !call.native,
                        );
                    assert(
                        template,
                        "Selected model needs a generative common-task template",
                    );
                    const body = selectGenerativeRequest(
                        template.body,
                        selected,
                        profile,
                    );
                    assert(
                        Buffer.byteLength(JSON.stringify(body)) <=
                            (item.family === "long_input"
                                ? domain.LONG_COMMON_INPUT_BYTE_LIMIT
                                : loaded.protocol.commonInputByteLimit),
                        "Selected model input exceeds the frozen common-input cap",
                    );
                    return {
                        ...template,
                        key: `choices:${item.id}:${selected.id}`,
                        model: selected.id,
                        endpoint: route.endpoint,
                        keyName: route.key,
                        native: false,
                        body,
                        requestHash: sha(JSON.stringify(body)),
                    };
                }),
            );
            manifest.models = selectedModels.map((selected) => selected.id);
        }
        const quoteBlockers: string[] = [];
        if (!catalog) quoteBlockers.push("missing_official_price_snapshot");
        for (const call of manifest.calls) {
            const price = catalog?.models.find((p) => p.id === call.model);
            if (!price) {
                quoteBlockers.push(`missing_tariff:${call.model}`);
                continue;
            }
            if (selectedModels && !call.native)
                assert.equal(
                    price.provider,
                    (call.body.provider as { only: string[] }).only[0],
                    "Selected route differs from its quoted provider",
                );
            assert(
                Number.isFinite(price.inputPricePerToken) &&
                    price.inputPricePerToken >= 0 &&
                    Number.isFinite(price.outputPricePerToken) &&
                    price.outputPricePerToken >= 0,
                "Invalid official tariff",
            );
            assert(
                /^https:\/\/(openrouter\.ai|docs\.typesafe\.ai|api\.typesafe\.ai)\//.test(
                    price.sourceUrl,
                ),
                "Tariff must identify its official source",
            );
            const multiplier = call.native
                ? Object.keys(call.body.questions as object).length
                : 1;
            const outputLimit = Number(call.body.max_tokens ?? 1024);
            call.reservationUsd =
                (Buffer.byteLength(JSON.stringify(call.body)) + 2048) *
                    multiplier *
                    price.inputPricePerToken +
                outputLimit * price.outputPricePerToken;
        }
        const name = option("--run");
        assert(
            !name || /^[a-zA-Z0-9_-]+$/.test(name),
            "Supply a bounded run name",
        );
        const run = name
            ? resolve(dirname(resolve(path)), "runs", name)
            : undefined;
        const manifestPath = run ? join(run, "manifest.json") : undefined;
        const retained =
            manifestPath && existsSync(manifestPath)
                ? (read(manifestPath) as { budgetPolicy?: string })
                : undefined;
        const costReferencePath =
            option("--cost-reference") ??
            (run && existsSync(join(run, "cost-reference.jsonl"))
                ? join(run, "cost-reference.jsonl")
                : undefined);
        const forecast = estimateUncachedEvaluation({
            calls: manifest.calls,
            catalog,
            referenceFile: costReferencePath,
        });
        const budgetMetadata: {
            budgetPolicy?: string;
            indicativeUncachedUsd?: number | null;
            costReferenceSha256?: string | null;
        } =
            !retained || retained.budgetPolicy !== undefined
                ? {
                      budgetPolicy:
                          option("--budget-policy") ??
                          retained?.budgetPolicy ??
                          "whole_lot",
                      ...forecast,
                  }
                : {};
        const frozen = {
            ...manifest,
            ...budgetMetadata,
            maximumAttempts: manifest.calls.length,
            selectedCaseIds,
            selectedModelIds: selectedModels?.map((model) => model.id) ?? null,
            ...(requestedTasks ? { selectedTasks: requestedTasks } : {}),
            replacements,
            replacementsSha256: replacementsPath
                ? sha(readFileSync(replacementsPath, "utf8"))
                : null,
            selectionSha256: selectionPath
                ? sha(readFileSync(selectionPath, "utf8"))
                : null,
            runName: option("--run") ?? null,
            status: manifest.blockers.length ? "blocked" : "prepared",
            codeHashes: Object.fromEntries(
                SOURCE_FILES.map((file) => [
                    file,
                    sha(readFileSync(join(root, file), "utf8")),
                ]),
            ),
            catalogSha256: catalogPath
                ? sha(readFileSync(catalogPath, "utf8"))
                : null,
            catalog: catalog ?? null,
            quoteBlockers: [...new Set(quoteBlockers)],
            maximumReservationUsd: quoteBlockers.length
                ? null
                : manifest.calls.reduce(
                      (sum, call) => sum + (call.reservationUsd ?? 0),
                      0,
                  ),
        };
        assert(
            frozen.budgetPolicy === undefined ||
                ["whole_lot", "stop_at_budget"].includes(frozen.budgetPolicy),
            "Invalid budget policy",
        );
        assert(
            !retained ||
                retained.budgetPolicy !== undefined ||
                !option("--budget-policy") ||
                option("--budget-policy") === "whole_lot",
            "Historical lots retain whole-lot approval",
        );
        const manifestSha256 = sha(JSON.stringify(frozen));
        if (manifestPath && existsSync(manifestPath))
            assert.equal(
                sha(JSON.stringify(read(manifestPath))),
                manifestSha256,
                "Study, code, reference, tariff or input drift; preserve this run and prepare a new one",
            );
        if (args.includes("--prepare")) {
            assert(run && manifestPath, "Preparation requires --run NAME");
            mkdirSync(run, { recursive: true });
            if (!existsSync(manifestPath)) {
                save(manifestPath, frozen);
                if (costReferencePath)
                    writeFileSync(
                        join(run, "cost-reference.jsonl"),
                        readFileSync(costReferencePath),
                        { flag: "wx" },
                    );
            }
        }
        const journal = run ? join(run, "calls.jsonl") : undefined;
        if (live) {
            assert(
                run && manifestPath && existsSync(manifestPath),
                "Prepare and inspect the immutable manifest first",
            );
            lockPath = join(run, "execution.lock");
            lock = openSync(lockPath, "wx");
        }
        const events: Entry[] =
            journal && existsSync(journal)
                ? readFileSync(journal, "utf8")
                      .split("\n")
                      .filter(Boolean)
                      .map((line) => JSON.parse(line))
                : [];
        assert(
            new Set(
                events.filter((e) => e.event === "started").map((e) => e.key),
            ).size === events.filter((e) => e.event === "started").length,
            "Duplicate study attempt",
        );
        const starts = events.filter((e) => e.event === "started");
        const results = events.filter((e) => e.event === "result");
        assert(
            new Set(results.map((e) => e.key)).size === results.length &&
                results.every((r) => starts.some((s) => s.key === r.key)),
            "Invalid study result journal",
        );
        const unresolved = starts.filter(
            (s) => !results.some((r) => r.key === s.key),
        );
        assert(
            events.every((event) =>
                manifest.calls.some((call) => call.key === event.key),
            ),
            "Journal contains a foreign study request",
        );
        let liveAccounting: EvaluationBudget | undefined;
        let approvedBudgetUsd: number | undefined;
        let budgetStopReason: string | undefined;
        const historicalCosts =
            events.length && run && name
                ? readEvaluationHistory(dirname(run), [name])
                : {
                      reportedCostUsd: 0,
                      unknownChargeReservedUsd: 0,
                      conservativeCostUsd: 0,
                  };
        let exposure = historicalCosts.conservativeCostUsd;
        const phase = option("--phase") ?? "development";
        assert(
            ["development", "holdout", "regression"].includes(phase),
            "Unknown study phase",
        );
        if (live) {
            assert(
                run && manifestPath && journal && existsSync(manifestPath),
                "Prepare and inspect the immutable manifest first",
            );
            assert(
                frozen.status === "prepared" && !frozen.quoteBlockers.length,
                "Study corpus, reference or cost quote is incomplete",
            );
            assert(
                !unresolved.length,
                "Unknown external outcome; automatic repetition is prohibited",
            );
            const currentCatalogPath = option("--preflight-catalog");
            const approval = validateStudyApproval({
                manifestSha256,
                maximumAttempts: frozen.maximumAttempts,
                maximumReservationUsd: frozen.maximumReservationUsd,
                budgetPolicy: frozen.budgetPolicy as
                    | "whole_lot"
                    | "stop_at_budget",
                catalog,
                currentCatalog: currentCatalogPath
                    ? (read(currentCatalogPath) as Catalog)
                    : undefined,
                approval: read(authorizationFile as string),
            });
            if (phase === "holdout")
                assert(
                    manifest.calls
                        .filter((c) => c.split === "development")
                        .every((c) => results.some((r) => r.key === c.key)),
                    "Complete the development phase across all three entrypoints before the holdout",
                );
            const queue = manifest.calls.filter(
                (c) =>
                    c.task === mode &&
                    c.split === phase &&
                    !starts.some((s) => s.key === c.key),
            );
            assert(
                starts.length + queue.length <= approval.maximumAttempts,
                "Study attempt ceiling exceeded",
            );
            const envFile = join(root, ".env.local");
            const env = existsSync(envFile)
                ? parseEnv(readFileSync(envFile, "utf8"))
                : {};
            const keys = Object.fromEntries(
                [...new Set(queue.map((c) => c.keyName))].map((key) => [
                    key,
                    process.env[key] || env[key],
                ]),
            );
            assert(
                Object.values(keys).every(
                    (value) => typeof value === "string" && value.trim(),
                ),
                "Configure the required study credentials through the existing secure environment",
            );
            const controller = new AbortController();
            const stop = () => controller.abort();
            process.once("SIGINT", stop);
            process.once("SIGTERM", stop);
            const record = (entry: Entry) =>
                appendFileSync(journal, `${JSON.stringify(entry)}\n`);
            const accounting = new EvaluationBudget({
                budgetUsd: approval.budgetUsd,
                maximumAttempts: approval.maximumAttempts,
                history: starts.map((start) => {
                    const result = results.find(
                        (entry) => entry.key === start.key,
                    );
                    assert(
                        typeof start.reservation === "number",
                        "Missing historical reservation",
                    );
                    return {
                        id: start.key,
                        reservationUsd: start.reservation,
                        costUsd: knownEvaluationCharge(result),
                        settled: !!result,
                    };
                }),
            });
            liveAccounting = accounting;
            approvedBudgetUsd = approval.budgetUsd;
            let index = 0;
            let dispatchBlocked = false;
            try {
                const worker = async () => {
                    while (!controller.signal.aborted && !dispatchBlocked) {
                        const call = queue[index++];
                        if (!call) return;
                        const reservation = call.reservationUsd;
                        assert(reservation !== undefined);
                        try {
                            await accounting.reserve(
                                call.key,
                                reservation,
                                controller.signal,
                            );
                        } catch (error) {
                            if (!(error instanceof EvaluationBudgetStop))
                                throw error;
                            dispatchBlocked = true;
                            budgetStopReason = error.reason;
                            appendFileSync(
                                journal,
                                `${JSON.stringify({ event: "stopped", key: call.key, reason: error.reason, at: new Date().toISOString() })}\n`,
                            );
                            return;
                        }
                        record({
                            event: "started",
                            key: call.key,
                            reservation: reservation,
                            requestHash: call.requestHash,
                            at: new Date().toISOString(),
                        });
                        const began = Date.now();
                        const saved: Entry = {
                            event: "result",
                            key: call.key,
                            status: "failed",
                            costUsd: reservation,
                            costBasis: "unknown_charge_reservation",
                            at: new Date().toISOString(),
                        };
                        const apiKey = keys[call.keyName] as string;
                        try {
                            const signal = AbortSignal.any([
                                controller.signal,
                                AbortSignal.timeout(60000),
                            ]);
                            if (call.task === "choices") {
                                const response = await fetch(call.endpoint, {
                                    method: "POST",
                                    headers: {
                                        Authorization: `Bearer ${apiKey}`,
                                        "Content-Type": "application/json",
                                    },
                                    body: JSON.stringify(call.body),
                                    redirect: "error",
                                    signal,
                                });
                                if (
                                    [401, 402, 403, 429].includes(
                                        response.status,
                                    )
                                )
                                    dispatchBlocked = true;
                                const bytes = await boundedResponse(response);
                                const parsed = JSON.parse(
                                    redactEvaluationResponse(bytes, apiKey),
                                ) as Record<string, unknown>;
                                saved.response = diagnosticFields(parsed);
                                record({
                                    event: "response",
                                    key: call.key,
                                    requestHash: call.requestHash,
                                    status: `http_${response.status}`,
                                    response: saved.response,
                                    at: new Date().toISOString(),
                                });
                                const usage = parsed.usage as
                                    | {
                                          cost?: number;
                                          input_tokens?: number;
                                          output_tokens?: number;
                                      }
                                    | undefined;
                                if (
                                    typeof usage?.cost === "number" &&
                                    Number.isFinite(usage.cost) &&
                                    usage.cost >= 0
                                ) {
                                    saved.costUsd = usage.cost;
                                    saved.costBasis = "provider_reported";
                                } else if (
                                    call.native &&
                                    typeof usage?.input_tokens === "number" &&
                                    Number.isFinite(usage.input_tokens) &&
                                    usage.input_tokens >= 0 &&
                                    (usage.output_tokens === undefined ||
                                        (typeof usage.output_tokens ===
                                            "number" &&
                                            Number.isFinite(
                                                usage.output_tokens,
                                            ) &&
                                            usage.output_tokens >= 0))
                                ) {
                                    const price = catalog?.models.find(
                                        (p) => p.id === call.model,
                                    );
                                    assert(price);
                                    saved.estimatedCostUsd =
                                        usage.input_tokens *
                                            price.inputPricePerToken +
                                        (usage.output_tokens ?? 0) *
                                            price.outputPricePerToken;
                                    saved.costBasis =
                                        "unknown_charge_reservation";
                                }
                                assert(
                                    response.ok,
                                    `Provider HTTP ${response.status}`,
                                );
                                const item = manifest.cases.find(
                                    (c) => c.id === call.caseId,
                                );
                                assert(item);
                                validateAnswers(
                                    parsed,
                                    item.questions,
                                    call.native,
                                );
                                saved.status = "succeeded";
                            } else {
                                const quotedProvider = (
                                    call.body.provider as { only: string[] }
                                ).only[0];
                                assert(
                                    quotedProvider,
                                    "Frozen evaluation provider is missing",
                                );
                                const route = {
                                    model: call.model,
                                    provider: quotedProvider,
                                } satisfies Parameters<
                                    typeof transport.qualifySourceDocument
                                >[1];
                                const dependencies = {
                                    apiKey,
                                    signal,
                                    onResponse: (response: {
                                        status: number;
                                        body: string;
                                    }) => {
                                        if (
                                            [401, 402, 403, 429].includes(
                                                response.status,
                                            )
                                        )
                                            dispatchBlocked = true;
                                        let diagnostic: Record<string, unknown>;
                                        try {
                                            diagnostic = diagnosticFields(
                                                JSON.parse(
                                                    redactEvaluationResponse(
                                                        response.body,
                                                        apiKey,
                                                    ),
                                                ) as Record<string, unknown>,
                                            );
                                        } catch {
                                            diagnostic = {
                                                responseSha256: sha(
                                                    response.body,
                                                ),
                                                responseBytes:
                                                    Buffer.byteLength(
                                                        response.body,
                                                    ),
                                            };
                                        }
                                        record({
                                            event: "response",
                                            key: call.key,
                                            requestHash: call.requestHash,
                                            status: `http_${response.status}`,
                                            response: diagnostic,
                                            at: new Date().toISOString(),
                                        });
                                    },
                                    fetch: async (
                                        url: Parameters<typeof fetch>[0],
                                        init?: Parameters<typeof fetch>[1],
                                    ) => {
                                        const body = requestedTasks
                                            ? JSON.stringify(
                                                  selectGenerativeRequest(
                                                      JSON.parse(
                                                          String(init?.body),
                                                      ) as Record<
                                                          string,
                                                          unknown
                                                      >,
                                                      {
                                                          id: call.model,
                                                          provider:
                                                              route.provider,
                                                      },
                                                      catalog?.models.find(
                                                          (model) =>
                                                              model.id ===
                                                              call.model,
                                                      ),
                                                  ),
                                              )
                                            : String(init?.body);
                                        assert.equal(
                                            sha(body),
                                            call.requestHash,
                                            "SDK request differs from the approved manifest",
                                        );
                                        return fetch(url, { ...init, body });
                                    },
                                };
                                const result =
                                    call.task === "qualification"
                                        ? await transport.qualifySourceDocument(
                                              call.prepared as Parameters<
                                                  typeof transport.qualifySourceDocument
                                              >[0],
                                              route,
                                              dependencies,
                                          )
                                        : await transport.compareSourceContributions(
                                              call.prepared as Parameters<
                                                  typeof transport.compareSourceContributions
                                              >[0],
                                              route,
                                              dependencies,
                                          );
                                saved.output = result;
                                saved.status = result.status;
                                if (result.reportedCost !== undefined) {
                                    saved.costUsd = result.reportedCost;
                                    saved.costBasis = "provider_reported";
                                }
                            }
                        } catch (error) {
                            saved.status = controller.signal.aborted
                                ? "cancelled"
                                : "failed";
                            saved.output = {
                                error: redactEvaluationResponse(
                                    error instanceof Error
                                        ? error.message
                                        : "Study attempt failed",
                                    apiKey,
                                ),
                            };
                        }
                        saved.latencyMs = Date.now() - began;
                        record(saved);
                        accounting.settle(
                            call.key,
                            knownEvaluationCharge(saved),
                        );
                        const currentExposure = accounting.summary();
                        exposure =
                            currentExposure.reportedCostUsd +
                            currentExposure.unknownChargeReservedUsd;
                        results.push(saved);
                    }
                };
                await finishStudyWorkers(
                    Array.from({ length: 2 }, worker),
                    stop,
                );
            } finally {
                process.off("SIGINT", stop);
                process.off("SIGTERM", stop);
            }
        }
        if (args.includes("--summarize")) {
            assert(
                run && manifestPath && existsSync(manifestPath),
                "Select a prepared run for offline scoring",
            );
            const report = domain.scoreStudy(
                loaded,
                manifest,
                results.map((result) => ({
                    key: result.key,
                    status: result.status ?? "failed",
                    response: result.response,
                    costUsd: result.costUsd,
                    latencyMs: result.latencyMs,
                    output: result.output,
                })),
            );
            const reportName = option("--report") ?? "summary.json";
            assert(
                /^[a-zA-Z0-9_-]+\.json$/.test(reportName),
                "Invalid report filename",
            );
            save(join(run, reportName), {
                ...report,
                journalSha256:
                    journal && existsSync(journal)
                        ? sha(readFileSync(journal, "utf8"))
                        : null,
                manifestSha256,
            });
            const prefix = reportName.slice(0, -5);
            const review = report.observations
                .filter((observation) => observation.status === "succeeded")
                .map((observation) => {
                    const reviewId = sha(
                        `${manifestSha256}:${observation.key}`,
                    ).slice(0, 20);
                    const receipt =
                        "output" in observation && observation.output
                            ? observation.output
                            : undefined;
                    return {
                        reviewId,
                        caseId: manifest.calls.find(
                            (call) => call.key === observation.key,
                        )?.caseId,
                        task: observation.task,
                        companyId: observation.companyId,
                        judgments:
                            "judgments" in observation
                                ? observation.judgments
                                : undefined,
                        output: receipt
                            ? {
                                  qualification: receipt.qualification,
                                  output: receipt.output,
                              }
                            : undefined,
                        reviewStatus: "pending",
                    };
                });
            save(join(run, `${prefix}-blind-review.json`), {
                manifestSha256,
                items: review,
            });
            save(
                join(run, `${prefix}-review-key.json`),
                Object.fromEntries(
                    report.observations
                        .filter(
                            (observation) => observation.status === "succeeded",
                        )
                        .map((observation) => [
                            sha(`${manifestSha256}:${observation.key}`).slice(
                                0,
                                20,
                            ),
                            { key: observation.key, model: observation.model },
                        ]),
                ),
            );
        }
        console.log(
            JSON.stringify(
                {
                    studyId: manifest.studyId,
                    status: frozen.status,
                    mode: live ? "live" : "offline",
                    entrypoint: mode,
                    manifestSha256,
                    plannedCalls: manifest.calls.length,
                    byTask: Object.fromEntries(
                        ["choices", "qualification", "comparison"].map(
                            (task) => [
                                task,
                                manifest.calls.filter((c) => c.task === task)
                                    .length,
                            ],
                        ),
                    ),
                    documents: loaded.documents.length,
                    controls: loaded.study.controls.length,
                    blockers: frozen.blockers,
                    quoteBlockers: frozen.quoteBlockers,
                    budgetPolicy: frozen.budgetPolicy,
                    indicativeUncachedUsd: frozen.indicativeUncachedUsd,
                    maximumReservationUsd: frozen.maximumReservationUsd,
                    approvedBudgetUsd: approvedBudgetUsd ?? null,
                    stopReason: budgetStopReason,
                    reportedCostUsd:
                        liveAccounting?.summary().reportedCostUsd ??
                        historicalCosts.reportedCostUsd,
                    unknownChargeReservedUsd:
                        liveAccounting?.summary().unknownChargeReservedUsd ??
                        historicalCosts.unknownChargeReservedUsd,
                    actualAttempts:
                        liveAccounting?.summary().attempts ?? starts.length,
                    unresolvedAttempts: unresolved.length,
                    conservativeCostUsd: exposure,
                    providerRequests: live ? "see_journal" : 0,
                    appWrites: 0,
                    integrationExcludedModels:
                        manifest.integrationExcludedModels,
                },
                null,
                2,
            ),
        );
    } finally {
        if (lock !== undefined) {
            closeSync(lock);
            if (lockPath) unlinkSync(lockPath);
        }
        await server.close();
    }
}

/** Owns the completion boundary before the shared execution lock is released. */
export async function finishStudyWorkers(
    workers: Promise<void>[],
    stop: () => void,
) {
    const settled = await Promise.allSettled(
        workers.map((worker) =>
            worker.catch((error) => {
                stop();
                throw error;
            }),
        ),
    );
    const failure = settled.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
}
async function boundedResponse(response: Response) {
    const reader = response.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (reader)
        try {
            while (true) {
                const part = await reader.read();
                if (part.done) break;
                size += part.value.byteLength;
                if (size > 1024 * 1024) {
                    await reader.cancel();
                    throw new Error("Study response exceeds 1 MiB");
                }
                chunks.push(part.value);
            }
        } finally {
            reader.releaseLock();
        }
    return Buffer.concat(chunks).toString("utf8");
}
function diagnosticFields(body: Record<string, unknown>) {
    return {
        id: body.id,
        model: body.model,
        provider: body.provider,
        usage: body.usage,
        answers: body.answers,
        choices: Array.isArray(body.choices)
            ? body.choices.map(
                  (choice: {
                      finish_reason?: string;
                      message?: { content?: unknown };
                  }) => ({
                      finish_reason: choice.finish_reason,
                      message: { content: choice.message?.content },
                  }),
              )
            : undefined,
        error: body.error,
    };
}

/** Validates one exact approved lot before credentials are read or a request is sent. */
export function validateStudyApproval(args: {
    manifestSha256: string;
    maximumAttempts?: number;
    maximumReservationUsd: number | null;
    budgetPolicy?: "whole_lot" | "stop_at_budget";
    catalog: Catalog | undefined;
    approval: unknown;
    currentCatalog?: Catalog;
    now?: number;
}) {
    assert(
        args.budgetPolicy === undefined ||
            ["whole_lot", "stop_at_budget"].includes(args.budgetPolicy),
        "Invalid budget policy",
    );
    const now = args.now ?? Date.now();
    const catalog = args.currentCatalog ?? args.catalog;
    assert(
        catalog &&
            now - Date.parse(catalog.observedAt) >= 0 &&
            now - Date.parse(catalog.observedAt) < 3600000,
        "Refresh the official tariff/provider snapshot before dispatch",
    );
    assert(args.catalog, "Missing approved tariff snapshot");
    for (const quoted of args.catalog.models) {
        const current = catalog.models.find((model) => model.id === quoted.id);
        assert(
            current &&
                current.provider === quoted.provider &&
                Number.isFinite(current.inputPricePerToken) &&
                current.inputPricePerToken >= 0 &&
                current.inputPricePerToken <= quoted.inputPricePerToken &&
                Number.isFinite(current.outputPricePerToken) &&
                current.outputPricePerToken >= 0 &&
                current.outputPricePerToken <= quoted.outputPricePerToken &&
                current.contextLength >= quoted.contextLength,
            "Fresh tariff or provider exceeds the approved quote",
        );
    }
    assert(
        args.approval && typeof args.approval === "object",
        "Invalid explicit study authorization",
    );
    const approval = args.approval as Approval;
    assert.equal(
        approval.manifestSha256,
        args.manifestSha256,
        "Authorization belongs to another manifest",
    );
    assert(
        approval.maximumAttempts === (args.maximumAttempts ?? 416) &&
            Number.isSafeInteger(approval.maximumAttempts) &&
            approval.maximumAttempts >= 0 &&
            (approval.maximumAttempts > 0 ||
                args.maximumReservationUsd === 0) &&
            approval.maximumAttempts <= 416 &&
            Number.isFinite(approval.budgetUsd) &&
            (approval.budgetUsd > 0 ||
                (approval.budgetUsd === 0 && approval.maximumAttempts === 0)) &&
            Number.isFinite(Date.parse(approval.approvedAt)),
        "Invalid explicit study authorization",
    );
    assert(
        args.maximumReservationUsd !== null &&
            Number.isFinite(args.maximumReservationUsd) &&
            args.maximumReservationUsd >= 0 &&
            (args.budgetPolicy === "stop_at_budget" ||
                args.maximumReservationUsd <= approval.budgetUsd),
        "Whole approved lot exceeds its budget",
    );
    return approval;
}
