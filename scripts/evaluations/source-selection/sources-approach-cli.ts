import assert from "node:assert/strict";
import {
    appendFileSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { z } from "zod";
import { buildSourcesApproachReport } from "./sources-approach-report.ts";
import {
    runSourcesMission,
    type SourcesMission,
    type SourcesModelProfile,
} from "./sources-approach-runner.ts";
import {
    inspectionScenarioHash,
    SOURCES_APPROACH_LIMITS,
    SOURCES_APPROACH_PROTOCOL,
    SOURCES_INSPECTION_LIMITS,
    SOURCES_INSPECTION_PROTOCOL,
    type SourcesApproach,
    type SourcesApproachResult,
    type SourcesInspectionBaseline,
    SourcesPreparation,
    type SourcesReasoning,
    type SourcesScenario,
    sourcesDigest,
} from "./sources-approach-study.ts";
import { openNativeSourcesInspection } from "./sources-inspection-retrieval.ts";
import { validateStudyApproval } from "./study-cli.ts";

export function buildSourcesMissions(
    scenarios: readonly SourcesScenario[],
    repetitions: number,
): SourcesMission[] {
    assert(
        Number.isSafeInteger(repetitions) &&
            repetitions > 0 &&
            repetitions <= 2,
        "Use one or two repetitions",
    );
    const conditions = [
        { approach: "fixed", reasoning: "off" },
        { approach: "agent", reasoning: "off" },
        { approach: "fixed", reasoning: "on" },
        { approach: "agent", reasoning: "on" },
    ] as const;
    const missions = [...scenarios]
        .sort((a, b) => a.phase.localeCompare(b.phase))
        .flatMap((s) =>
            Array.from({ length: repetitions }, (_, index) =>
                (index % 2 ? [...conditions].reverse() : conditions).map(
                    (condition) => ({
                        missionId: `${s.id}.${condition.approach}.${condition.reasoning}.${index + 1}`,
                        scenarioId: s.id,
                        ...condition,
                        repetition: index + 1,
                    }),
                ),
            ).flat(),
        );
    assert(
        missions.length * SOURCES_APPROACH_LIMITS.modelCalls <= 416,
        "Split this lot before authorization",
    );
    return missions;
}

const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const save = (path: string, value: unknown) =>
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
const companySchema = z.object({
    cik: z.string(),
    legalName: z.string(),
    ticker: z.string(),
    websiteUrl: z.string().optional(),
    investorRelationsUrl: z.string().optional(),
});
const profileSchema = z.object({
    model: z.string().regex(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/),
    provider: z.string().min(1),
    inputPricePerToken: z.number().finite().nonnegative(),
    outputPricePerToken: z.number().finite().nonnegative(),
    contextLength: z.number().int().positive(),
});
const candidateSchema = z.object({
    sourceId: z.string(),
    title: z.string(),
    canonicalUrl: z.url(),
    origin: z.enum(["sec", "exa", "analyst_url"]),
    category: z.string(),
    createdAt: z.number(),
    secForm: z.string().optional(),
});
const scenarioSchema = z.object({
    id: z.string().regex(/^[a-z0-9_-]+$/),
    phase: z.enum(["development", "validation"]),
    company: companySchema,
    asOfTime: z.number().finite(),
    researchAngle: z.string(),
    sources: z
        .array(
            z.object({
                candidate: candidateSchema,
                text: z.string(),
                contentHash: z.string().regex(/^[a-f0-9]{64}$/),
            }),
        )
        .min(1)
        .max(5),
});
const SOURCE_FILES = [
    "scripts/evaluations/source-selection/sources-inspection-retrieval.ts",
    "convex/retrievalEvaluation.ts",
    "convex/sourceRetrieval.ts",
    "convex/sourceRetrievalActions.ts",
    "scripts/evaluations/source-selection/sources-approach.ts",
    "scripts/evaluations/source-selection/sources-approach-cli.ts",
    "scripts/evaluations/source-selection/sources-approach-runner.ts",
    "scripts/evaluations/source-selection/sources-approach-study.ts",
    "scripts/evaluations/source-selection/sources-approach-report.ts",
    "scripts/evaluations/source-selection/study-cli.ts",
    "scripts/evaluations/source-selection/evaluation-records.ts",
    "convex/domain/sourceQualification.ts",
    "convex/domain/sourceComparison.ts",
    "convex/domain/sourceSelectionPolicy.ts",
    "convex/domain/sourcePassages.ts",
    "convex/domain/sourceRetrievalPolicy.ts",
    "convex/integrations/evidenceNormalization.ts",
    "convex/resourceLimits.ts",
    "package.json",
    "pnpm-lock.yaml",
];
type Manifest = {
    protocol:
        | typeof SOURCES_APPROACH_PROTOCOL
        | typeof SOURCES_INSPECTION_PROTOCOL;
    inspection?: {
        baselinesSha256: string;
        limits: typeof SOURCES_INSPECTION_LIMITS;
    };
    createdAt: string;
    scenariosSha256: string;
    code: Array<{ file: string; sha256: string }>;
    missions: SourcesMission[];
    profile: SourcesModelProfile | null;
    catalog: {
        observedAt: string;
        models: Array<{
            id: string;
            provider: string;
            inputPricePerToken: number;
            outputPricePerToken: number;
            contextLength: number;
            sourceUrl: string;
        }>;
    } | null;
    maximumAttempts: number;
    maximumReservationUsd: number | null;
    limits: typeof SOURCES_APPROACH_LIMITS;
    evidenceBoundary: string;
};
type InspectionInputs = Record<
    string,
    {
        baseline: SourcesInspectionBaseline;
        mandate: string;
        focusSourceIds?: string[];
    }
>;

/** Imports captures through a metadata allowlist; investigator labels never enter a mission. */
export function readSourcesScenarios(
    serviceNowFile: string,
    crossCompanyFile: string,
): SourcesScenario[] {
    const frozen = z
        .array(
            z.object({
                sourceId: z.string(),
                input: z.object({
                    normalizedText: z.string(),
                    request: z.object({
                        company: companySchema,
                        asOfDate: z.string(),
                        researchAngle: z.string(),
                        document: z.object({
                            title: z.string(),
                            canonicalUrl: z.string(),
                        }),
                    }),
                }),
            }),
        )
        .length(4)
        .parse(read(serviceNowFile));
    const first = frozen[0];
    assert(first, "ServiceNow captures required");
    const asOfTime = Date.parse(`${first.input.request.asOfDate}T00:00:00Z`);
    const scenarios: SourcesScenario[] = [
        {
            id: "servicenow",
            phase: "development",
            company: first.input.request.company,
            asOfTime,
            researchAngle: first.input.request.researchAngle,
            sources: frozen.map((item, index) => ({
                candidate: {
                    sourceId: `servicenow-source-${index + 1}`,
                    title: item.input.request.document.title,
                    canonicalUrl: item.input.request.document.canonicalUrl,
                    origin: "exa",
                    category: "captured",
                    createdAt: asOfTime,
                },
                text: item.input.normalizedText,
                contentHash: sourcesDigest(item.input.normalizedText),
            })),
        },
    ];
    const study = z
        .object({
            companies: z.array(companySchema.extend({ id: z.string() })),
            documents: z.array(
                z.object({
                    id: z.string(),
                    companyId: z.string(),
                    category: z.string(),
                    title: z.string(),
                    url: z.string(),
                    capturedAt: z.string(),
                    textFile: z.string(),
                    contentHash: z.string(),
                }),
            ),
        })
        .parse(read(crossCompanyFile));
    for (const companyId of ["adobe", "snowflake"]) {
        const company = study.companies.find((c) => c.id === companyId);
        assert(company, `Missing company ${companyId}`);
        const documents = [
            "annual",
            "quarterly",
            "terms",
            "analysis",
            "distractor",
        ].map((category) => {
            const document = study.documents.find(
                (d) => d.id === `${companyId}-${category}`,
            );
            assert(document, `Missing capture ${companyId}/${category}`);
            return document;
        });
        scenarios.push({
            id: companyId,
            phase: companyId === "snowflake" ? "validation" : "development",
            company: companySchema.parse(company),
            asOfTime,
            researchAngle: first.input.request.researchAngle,
            sources: documents.map((document, index) => {
                const text = readFileSync(
                    resolve(dirname(crossCompanyFile), document.textFile),
                    "utf8",
                );
                assert.equal(
                    sourcesDigest(text),
                    document.contentHash,
                    "Original capture hash mismatch",
                );
                const sec = new URL(document.url).hostname === "www.sec.gov";
                return {
                    candidate: {
                        sourceId: `${companyId}-source-${index + 1}`,
                        title: document.title,
                        canonicalUrl: document.url,
                        origin: sec ? "sec" : "exa",
                        category: sec ? "filing" : "captured",
                        createdAt: Date.parse(document.capturedAt),
                        secForm: sec
                            ? document.category === "annual"
                                ? "10-K"
                                : "10-Q"
                            : undefined,
                    },
                    text,
                    contentHash: document.contentHash,
                };
            }),
        });
    }
    return scenarios;
}

async function readRouteCatalog(
    profile: Pick<SourcesModelProfile, "model" | "provider">,
) {
    const sourceUrl = `https://openrouter.ai/api/v1/models/${profile.model}/endpoints`;
    const response = await fetch(sourceUrl, {
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
    });
    assert(response.ok, `Catalog HTTP ${response.status}`);
    const catalog = z
        .object({
            data: z.object({
                endpoints: z.array(
                    z.object({
                        provider_name: z.string(),
                        status: z.number(),
                        context_length: z.number(),
                        max_completion_tokens: z.number().nullable().optional(),
                        supported_parameters: z.array(z.string()),
                        pricing: z.object({
                            prompt: z.coerce.number().nonnegative(),
                            completion: z.coerce.number().nonnegative(),
                        }),
                    }),
                ),
            }),
        })
        .parse(await response.json());
    const endpoint = catalog.data.endpoints.find(
        (e) =>
            e.provider_name.toLowerCase() === profile.provider.toLowerCase() &&
            e.status === 0,
    );
    assert(endpoint, "Selected provider route unavailable");
    assert(
        ["tools", "structured_outputs", "reasoning"].every((p) =>
            endpoint.supported_parameters.includes(p),
        ),
        "Route must support tools, structured outputs and reasoning",
    );
    assert(
        endpoint.max_completion_tokens == null ||
            endpoint.max_completion_tokens >=
                SOURCES_APPROACH_LIMITS.outputTokens,
        "Route output capacity too small",
    );
    return {
        observedAt: new Date().toISOString(),
        models: [
            {
                id: profile.model,
                provider: profile.provider,
                inputPricePerToken: endpoint.pricing.prompt,
                outputPricePerToken: endpoint.pricing.completion,
                contextLength: endpoint.context_length,
                sourceUrl,
            },
        ],
    };
}

export function freezeSourcesStudy(args: {
    root: string;
    out: string;
    scenarios: SourcesScenario[];
    repetitions: number;
    maximumAttempts?: number;
    approach?: SourcesApproach;
    reasoning?: SourcesReasoning;
    catalog: Manifest["catalog"];
    inspection?: InspectionInputs;
}) {
    assert(
        !existsSync(args.out),
        "Use a new output directory; retained evidence is immutable",
    );
    const scenarios = z.array(scenarioSchema).min(1).parse(args.scenarios);
    assert(
        new Set(scenarios.map((s) => s.id)).size === scenarios.length,
        "Duplicate scenarios",
    );
    const preparations = scenarios.map((s) => new SourcesPreparation(s));
    if (args.inspection) {
        assert(
            scenarios.length === Object.keys(args.inspection).length,
            "One inspection baseline per scenario required",
        );
        for (const p of preparations) {
            const entry = args.inspection[p.scenario.id];
            assert(entry, "Inspection mandate required");
            assert(
                entry.mandate.trim(),
                "Inspection mandate must not be empty",
            );
            p.restoreBaseline(entry.baseline);
            if (entry.focusSourceIds)
                assert(
                    entry.focusSourceIds.length > 0 &&
                        new Set(entry.focusSourceIds).size ===
                            entry.focusSourceIds.length &&
                        entry.focusSourceIds.every((id) =>
                            p.sources.some((s) => s.sourceId === id),
                        ),
                    "Inspection focus must name distinct frozen sources",
                );
        }
    }
    const missions = buildSourcesMissions(scenarios, args.repetitions).filter(
        (mission) =>
            (!args.inspection || mission.reasoning === "off") &&
            (!args.approach || mission.approach === args.approach) &&
            (!args.reasoning || mission.reasoning === args.reasoning),
    );
    const quoted = args.catalog?.models[0];
    const profile = quoted
        ? profileSchema.parse({ ...quoted, model: quoted.id })
        : null;
    const missionCeiling =
        missions.length *
        (args.inspection
            ? SOURCES_INSPECTION_LIMITS.modelCalls
            : SOURCES_APPROACH_LIMITS.modelCalls);
    const maximumAttempts = args.maximumAttempts ?? missionCeiling;
    assert(
        Number.isSafeInteger(maximumAttempts) &&
            maximumAttempts > 0 &&
            maximumAttempts <= missionCeiling,
        "Attempt ceiling must fit the planned missions",
    );
    const code = SOURCE_FILES.map((file) => ({
        file,
        sha256: sourcesDigest(readFileSync(join(args.root, file), "utf8")),
    }));
    mkdirSync(args.out, { recursive: true });
    if (args.inspection)
        save(join(args.out, "inspection-baselines.json"), args.inspection);
    save(join(args.out, "scenarios.json"), scenarios);
    for (const entry of code) {
        const destination = join(args.out, "code", entry.file);
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(join(args.root, entry.file), destination);
    }
    const manifest: Manifest = {
        protocol: args.inspection
            ? SOURCES_INSPECTION_PROTOCOL
            : SOURCES_APPROACH_PROTOCOL,
        ...(args.inspection
            ? {
                  inspection: {
                      limits: SOURCES_INSPECTION_LIMITS,
                      baselinesSha256: sourcesDigest(
                          readFileSync(
                              join(args.out, "inspection-baselines.json"),
                              "utf8",
                          ),
                      ),
                  },
              }
            : {}),
        createdAt: new Date().toISOString(),
        scenariosSha256: sourcesDigest(
            readFileSync(join(args.out, "scenarios.json"), "utf8"),
        ),
        code,
        missions,
        profile,
        catalog: args.catalog,
        maximumAttempts,
        maximumReservationUsd: profile
            ? maximumAttempts *
              (Math.min(
                  SOURCES_APPROACH_LIMITS.requestBytes,
                  Math.max(
                      0,
                      profile.contextLength -
                          SOURCES_APPROACH_LIMITS.outputTokens,
                  ),
              ) *
                  profile.inputPricePerToken +
                  SOURCES_APPROACH_LIMITS.outputTokens *
                      profile.outputPricePerToken)
            : null,
        limits: SOURCES_APPROACH_LIMITS,
        evidenceBoundary: args.inspection
            ? "Frozen provisional v5 dossiers only. Adobe and Snowflake are development cases; CrowdStrike is previously exposed validation, not an unseen holdout. No discovery, acquisition, embedding calls, application changes or automatic semantic correctness score."
            : "Frozen captures only; no discovery or acquisition. ServiceNow and Adobe are development cases. Snowflake is previously exposed validation, not an unseen holdout. Experimental contract shared by both approaches; production routing and contracts are not changed.",
    };
    save(join(args.out, "manifest.json"), manifest);
    save(
        join(args.out, "prepared-inputs.json"),
        preparations.map((p) => ({
            scenarioId: p.scenario.id,
            sources: [...p.prepared].map(([sourceId, input]) => ({
                sourceId,
                input,
            })),
        })),
    );
    save(join(args.out, "authorization-template.json"), {
        manifestSha256: sourcesDigest(
            readFileSync(join(args.out, "manifest.json"), "utf8"),
        ),
        maximumAttempts,
        budgetUsd: manifest.maximumReservationUsd,
        approvedAt: null,
    });
    return manifest;
}

/** Refuses changed bytes before a resumed phase can dispatch another paid call. */
export function verifySourcesStudy(root: string, out: string) {
    const manifest = read(join(out, "manifest.json")) as Manifest;
    assert(
        [SOURCES_APPROACH_PROTOCOL, SOURCES_INSPECTION_PROTOCOL].includes(
            manifest.protocol,
        ),
        "Protocol mismatch",
    );
    if (manifest.protocol === SOURCES_INSPECTION_PROTOCOL) {
        assert(manifest.inspection, "Inspection baseline missing");
        assert.equal(
            sourcesDigest(
                readFileSync(join(out, "inspection-baselines.json"), "utf8"),
            ),
            manifest.inspection.baselinesSha256,
            "Inspection baseline changed",
        );
    }
    assert.equal(
        sourcesDigest(readFileSync(join(out, "scenarios.json"), "utf8")),
        manifest.scenariosSha256,
        "Frozen corpus changed",
    );
    for (const entry of manifest.code)
        assert.equal(
            sourcesDigest(readFileSync(join(root, entry.file), "utf8")),
            entry.sha256,
            `Frozen code changed: ${entry.file}`,
        );
    return manifest;
}

export async function runSourcesApproachCli(
    argv: string[],
    root = process.cwd(),
) {
    const { values } = parseArgs({
        args: argv,
        options: {
            prepare: { type: "boolean" },
            offline: { type: "boolean" },
            live: { type: "boolean" },
            continue: { type: "boolean" },
            summarize: { type: "boolean" },
            help: { type: "boolean" },
            out: { type: "string" },
            scenarios: { type: "string" },
            responses: { type: "string" },
            "inspection-baseline": { type: "string" },
            mandates: { type: "string" },
            "inspection-focus": { type: "string" },
            "search-responses": { type: "string" },
            "slot-key": { type: "string" },
            "servicenow-input": { type: "string" },
            model: { type: "string" },
            provider: { type: "string" },
            repetitions: { type: "string" },
            approach: { type: "string" },
            reasoning: { type: "string" },
            "maximum-attempts": { type: "string" },
            authorization: { type: "string" },
            phase: { type: "string" },
            execution: { type: "string" },
            report: { type: "string" },
        },
    });
    if (values.help) {
        console.log(
            "Sources evaluation: --prepare --out NEW_DIR [--scenarios FILE | --servicenow-input FILE | --inspection-baseline PREVIOUS_RUN --mandates FILE [--inspection-focus FILE]] [--model ID --provider ROUTE] [--approach fixed|agent] [--reasoning off|on]; --offline --out DIR --responses FILE [--search-responses FILE]; --live --out DIR --authorization FILE --phase development|validation [--slot-key CLAIMED_SLOT]; --summarize --out DIR [--report NEW_NAME]. No inference in prepare/offline/summarize. See README.md.",
        );
        return;
    }
    assert(
        [values.prepare, values.offline, values.live, values.summarize].filter(
            Boolean,
        ).length === 1,
        "Choose exactly one mode",
    );
    assert(values.out, "Supply --out DIR");
    const out = resolve(values.out);
    if (values.prepare) {
        assert(
            !values["inspection-focus"] || values["inspection-baseline"],
            "Inspection focus requires a frozen inspection baseline",
        );
        const serviceNow =
            values["servicenow-input"] ??
            "/tmp/qualification-scope-diagnosis-20261025/frozen-inputs.json";
        const crossCompany = join(
            root,
            "scripts/evaluations/source-selection/fixtures/cross-company-20261020/study.json",
        );
        let scenarios = values.scenarios
            ? z.array(scenarioSchema).parse(read(values.scenarios))
            : values["inspection-baseline"]
              ? []
              : readSourcesScenarios(serviceNow, crossCompany);
        let inspection: InspectionInputs | undefined;
        if (values["inspection-baseline"]) {
            assert(
                !values.scenarios && values.mandates,
                "Inspection import requires --mandates and its frozen original scenarios",
            );
            assert(
                !values.reasoning || values.reasoning === "off",
                "Inspection uses reasoning off",
            );
            const original = resolve(values["inspection-baseline"]);
            const originalManifest = read(
                join(original, "manifest.json"),
            ) as Manifest;
            assert.equal(
                sourcesDigest(
                    readFileSync(join(original, "scenarios.json"), "utf8"),
                ),
                originalManifest.scenariosSha256,
                "Original corpus changed",
            );
            const mandates = z
                .record(z.string(), z.string().min(1).max(8000))
                .parse(read(values.mandates));
            const focus = values["inspection-focus"]
                ? z
                      .record(
                          z.string(),
                          z.array(z.string().min(1)).min(1).max(5),
                      )
                      .parse(read(values["inspection-focus"]))
                : undefined;
            if (focus)
                assert(
                    Object.keys(focus).length ===
                        Object.keys(mandates).length &&
                        Object.keys(mandates).every((id) => focus[id]),
                    "One inspection focus per mandate required",
                );
            const originals = z
                .array(scenarioSchema)
                .parse(read(join(original, "scenarios.json")));
            const results = readFileSync(
                join(original, "live-results.jsonl"),
                "utf8",
            )
                .trim()
                .split("\n")
                .filter(Boolean)
                .map((line) => JSON.parse(line) as SourcesApproachResult);
            scenarios = Object.keys(mandates).map((id) => {
                const scenario = originals.find((s) => s.id === id);
                assert(scenario, "Mandate names an unknown frozen dossier");
                return {
                    ...scenario,
                    phase:
                        id === "crowdstrike"
                            ? ("validation" as const)
                            : ("development" as const),
                };
            });
            inspection = Object.fromEntries(
                scenarios.map((scenario) => {
                    const rows = results.filter(
                        (r) =>
                            r.scenarioId === scenario.id &&
                            r.approach === "fixed" &&
                            r.reasoning === "off",
                    );
                    assert(
                        rows.length === 1 && rows[0],
                        "Select an unambiguous fixed/off baseline",
                    );
                    assert(
                        rows[0].calls.every((c) => c.status === "succeeded"),
                        "Baseline has unresolved or invalid provider work",
                    );
                    return [
                        scenario.id,
                        {
                            baseline: {
                                scenarioHash: inspectionScenarioHash(scenario),
                                sources: rows[0].sources,
                            },
                            mandate: mandates[scenario.id] ?? "",
                            focusSourceIds: focus?.[scenario.id],
                        },
                    ];
                }),
            );
        }
        assert(
            Boolean(values.model) === Boolean(values.provider),
            "Supply both --model and --provider for an official quote",
        );
        const catalog =
            values.model && values.provider
                ? await readRouteCatalog(
                      profileSchema
                          .pick({ model: true, provider: true })
                          .parse({
                              model: values.model,
                              provider: values.provider,
                          }),
                  )
                : null;
        const manifest = freezeSourcesStudy({
            root,
            out,
            scenarios,
            repetitions: Number(values.repetitions ?? 2),
            approach: z
                .enum(["fixed", "agent"])
                .optional()
                .parse(values.approach),
            reasoning: z.enum(["off", "on"]).optional().parse(values.reasoning),
            maximumAttempts:
                values["maximum-attempts"] === undefined
                    ? undefined
                    : Number(values["maximum-attempts"]),
            catalog,
            inspection,
        });
        if (!values.scenarios && !inspection) {
            mkdirSync(join(out, "investigator-inputs"));
            copyFileSync(
                serviceNow,
                join(out, "investigator-inputs", "servicenow-original.json"),
            );
            copyFileSync(
                crossCompany,
                join(out, "investigator-inputs", "cross-company-original.json"),
            );
        }
        console.log(
            JSON.stringify({
                out,
                missions: manifest.missions.length,
                maximumAttempts: manifest.maximumAttempts,
                maximumReservationUsd: manifest.maximumReservationUsd,
            }),
        );
        return;
    }
    const manifest = values.summarize
        ? (read(join(out, "manifest.json")) as Manifest)
        : verifySourcesStudy(root, out);
    if (values.summarize) {
        const results: SourcesApproachResult[] = [];
        const available = ["offline", "live"].filter((execution) =>
            existsSync(join(out, `${execution}-results.jsonl`)),
        );
        const execution =
            values.execution ??
            (available.length === 1 ? available[0] : undefined);
        assert(
            execution && available.includes(execution),
            "Choose --execution offline or live; results must not be pooled",
        );
        for (const executionName of [execution]) {
            const file = join(out, `${executionName}-results.jsonl`);
            if (existsSync(file))
                results.push(
                    ...readFileSync(file, "utf8")
                        .trim()
                        .split("\n")
                        .filter(Boolean)
                        .map(
                            (line) => JSON.parse(line) as SourcesApproachResult,
                        ),
                );
        }
        assert(results.length, "No saved mission results");
        const report = buildSourcesApproachReport(results);
        const name =
            values.report ??
            `report-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
        assert(/^[a-zA-Z0-9_-]+$/.test(name), "Invalid report name");
        const notRunMissionIds = manifest.missions
            .filter((m) => !results.some((r) => r.missionId === m.missionId))
            .map((m) => m.missionId);
        writeFileSync(
            join(out, `${name}.md`),
            `${report.markdown}\nNot run: ${notRunMissionIds.join(", ") || "none"}.\n`,
            { flag: "wx" },
        );
        save(join(out, `${name}.json`), {
            ...report.summary,
            plannedMissionCount: manifest.missions.length,
            notRunMissionIds,
        });
        save(join(out, `${name}-review.json`), report.reviewTemplate);
        console.log(join(out, `${name}.md`));
        return;
    }
    const execution = values.live ? "live" : "offline";
    const phase = values.phase ?? (values.live ? "development" : "all");
    assert(
        ["development", "validation", "all"].includes(phase),
        "Unknown phase",
    );
    assert(
        !values.live || phase !== "all",
        "Run development and validation explicitly as separate live phases",
    );
    const scenarios = z
        .array(scenarioSchema)
        .parse(read(join(out, "scenarios.json")));
    const inspectionInputs = manifest.inspection
        ? (read(join(out, "inspection-baselines.json")) as InspectionInputs)
        : undefined;
    const searchResponses = values["search-responses"]
        ? z
              .record(
                  z.string(),
                  z.array(
                      z.object({
                          status: z.literal("available"),
                          hits: z.array(
                              z.object({
                                  sourceId: z.string(),
                                  passageKey: z.string(),
                                  excerpt: z.string(),
                              }),
                          ),
                          nextOffset: z.number().nullable(),
                      }),
                  ),
              )
              .parse(read(values["search-responses"]))
        : undefined;
    let missions = manifest.missions.filter(
        (m) =>
            phase === "all" ||
            scenarios.find((s) => s.id === m.scenarioId)?.phase === phase,
    );
    assert(missions.length, "Empty phase");
    const resultsFile = join(out, `${execution}-results.jsonl`);
    const existing = existsSync(resultsFile)
        ? readFileSync(resultsFile, "utf8")
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line) as SourcesApproachResult)
        : [];
    assert(
        values.continue ||
            !missions.some((m) =>
                existing.some((r) => r.missionId === m.missionId),
            ),
        "Mission already has retained results",
    );
    if (values.continue) {
        assert(
            existing.length,
            "Continuation requires retained mission results",
        );
        missions = missions.filter(
            (m) => !existing.some((r) => r.missionId === m.missionId),
        );
        assert(missions.length, "No remaining missions in this phase");
    }
    const segment = `${phase}${values.continue ? `-continuation-${existing.length}` : ""}`;
    let apiKey = "offline-replay-credential";
    let profile = manifest.profile ?? {
        model: "fixture/model",
        provider: "fixture",
        inputPricePerToken: 0,
        outputPricePerToken: 0,
        contextLength: 1_000_000,
    };
    let budget = 0;
    if (values.live) {
        assert(
            values.authorization && manifest.profile && manifest.catalog,
            "An exact live authorization and quoted manifest are required",
        );
        const current = await readRouteCatalog(manifest.profile);
        const approval = validateStudyApproval({
            manifestSha256: sourcesDigest(
                readFileSync(join(out, "manifest.json"), "utf8"),
            ),
            maximumAttempts: manifest.maximumAttempts,
            maximumReservationUsd: manifest.maximumReservationUsd,
            catalog: manifest.catalog,
            currentCatalog: current,
            approval: read(values.authorization),
        });
        budget = approval.budgetUsd;
        profile = manifest.profile;
        if (phase === "validation")
            assert(
                manifest.missions
                    .filter(
                        (m) =>
                            scenarios.find((s) => s.id === m.scenarioId)
                                ?.phase === "development",
                    )
                    .every((m) =>
                        existing.some((r) => r.missionId === m.missionId),
                    ),
                "Complete the frozen development lot before validation",
            );
        const env = existsSync(join(root, ".env.local"))
            ? parseEnv(readFileSync(join(root, ".env.local"), "utf8"))
            : {};
        apiKey = process.env.OPENROUTER_API_KEY ?? env.OPENROUTER_API_KEY ?? "";
        assert(apiKey, "configuration_unavailable");
        save(join(out, `preflight-${segment}.json`), current);
        save(join(out, `authorization-${segment}.json`), approval);
    }
    assert(
        !values.offline || values.responses,
        "Supply --responses FILE for an offline replay",
    );
    const responses = values.offline
        ? z
              .record(
                  z.string(),
                  z.array(
                      z.object({
                          requestHash: z.string().optional(),
                          response: z.record(z.string(), z.unknown()),
                      }),
                  ),
              )
              .parse(read(values.responses ?? ""))
        : undefined;
    const callsFile = join(out, `${execution}-calls.jsonl`);
    const previous = existsSync(callsFile)
        ? readFileSync(callsFile, "utf8")
              .trim()
              .split("\n")
              .filter(Boolean)
              .map(
                  (line) =>
                      JSON.parse(line) as {
                          missionId: string;
                          event: string;
                          receipt?: {
                              id: string;
                              reservationUsd: number;
                              costUsd?: number;
                              status: string;
                          };
                      },
              )
        : [];
    type Receipt = NonNullable<(typeof previous)[number]["receipt"]>;
    const starts: Receipt[] = [];
    const settled = new Map<string, Receipt>();
    for (const entry of previous) {
        if (!["started", "response", "result"].includes(entry.event)) continue;
        assert(entry.receipt, "Journal receipt missing");
        if (entry.event === "started") starts.push(entry.receipt);
        else settled.set(entry.receipt.id, entry.receipt);
    }
    assert(
        starts.every(
            (e) => settled.get(e.id)?.status !== "unknown" && settled.has(e.id),
        ),
        "Unresolved provider outcome: inspect receipts before a new lot",
    );
    assert(
        previous
            .filter((entry) => entry.event === "started")
            .every((entry) =>
                existing.some((result) => result.missionId === entry.missionId),
            ),
        "Started mission has no retained result: inspect before continuation",
    );
    let attempts = starts.length;
    let charged = starts.reduce(
        (sum, e) => sum + (settled.get(e.id)?.costUsd ?? e.reservationUsd),
        0,
    );
    writeFileSync(
        join(out, `${execution}-${segment}.started`),
        new Date().toISOString(),
        { flag: "wx" },
    );
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    let native:
        | Awaited<ReturnType<typeof openNativeSourcesInspection>>
        | undefined;
    let nativeScenarioId: string | undefined;
    try {
        for (const mission of missions) {
            if (controller.signal.aborted) break;
            const queue = responses?.[mission.missionId];
            if (values.offline)
                assert(
                    queue?.length,
                    `Missing replay responses for ${mission.missionId}`,
                );
            let responseIndex = 0;
            const scenario = scenarios.find((s) => s.id === mission.scenarioId);
            assert(scenario, "Frozen mission scenario missing");
            const inspection = inspectionInputs?.[scenario.id];
            if (inspection && values.live && nativeScenarioId !== scenario.id) {
                await native?.close();
                const indexingStarted = Date.now();
                assert(
                    values["slot-key"],
                    "Inspection requires an admitted --slot-key",
                );
                const config = z
                    .object({
                        deploymentName: z.string(),
                        adminKey: z.string(),
                        ports: z.object({ cloud: z.number().int().positive() }),
                    })
                    .parse(
                        read(join(root, ".convex/local/default/config.json")),
                    );
                native = await openNativeSourcesInspection({
                    origin: `http://127.0.0.1:${config.ports.cloud}`,
                    deploymentName: config.deploymentName,
                    adminKey: config.adminKey,
                    slotKey: values["slot-key"],
                    fixtureKey: `inspection-${sourcesDigest(`${sourcesDigest(readFileSync(join(out, "manifest.json"), "utf8"))}:${segment}:${scenario.id}`).slice(0, 24)}`,
                    preparation: new SourcesPreparation(scenario),
                    signal: controller.signal,
                });
                nativeScenarioId = scenario.id;
                appendFileSync(
                    callsFile,
                    `${JSON.stringify({ event: "native_retrieval_prepared", scenarioId: scenario.id, elapsedMs: Date.now() - indexingStarted })}\n`,
                );
            }
            let searchIndex = 0;
            const result = await runSourcesMission({
                ...mission,
                scenario,
                profile,
                apiKey,
                execution,
                signal: controller.signal,
                inspection: inspection
                    ? {
                          ...inspection,
                          search: native
                              ? native.search
                              : async () => {
                                    const result =
                                        searchResponses?.[mission.missionId]?.[
                                            searchIndex++
                                        ];
                                    assert(
                                        result,
                                        "Offline capture search response missing",
                                    );
                                    return result;
                                },
                      }
                    : undefined,
                fetch: values.offline
                    ? async (_url, init) => {
                          const row = queue?.[responseIndex++];
                          assert(row, "Replay exhausted");
                          if (row.requestHash)
                              assert.equal(
                                  sourcesDigest(String(init?.body)),
                                  row.requestHash,
                                  "Replay request differs from the retained request",
                              );
                          return new Response(JSON.stringify(row.response), {
                              headers: { "Content-Type": "application/json" },
                          });
                      }
                    : undefined,
                authorizeCall: values.live
                    ? (reservation) => {
                          assert(
                              attempts < manifest.maximumAttempts &&
                                  charged + reservation <= budget,
                              "Approved lot exhausted",
                          );
                          attempts++;
                          charged += reservation;
                      }
                    : undefined,
                journal: (entry) =>
                    appendFileSync(callsFile, `${JSON.stringify(entry)}\n`),
            });
            appendFileSync(resultsFile, `${JSON.stringify(result)}\n`);
            if (values.live)
                charged -= result.calls.reduce(
                    (sum, c) =>
                        sum +
                        (c.costUsd === undefined
                            ? 0
                            : c.reservationUsd - c.costUsd),
                    0,
                );
            if (
                result.status === "unknown" ||
                result.calls.some((c) => c.status === "failed")
            )
                break;
        }
    } finally {
        process.off("SIGINT", cancel);
        process.off("SIGTERM", cancel);
        await native?.close();
    }
    console.log(resultsFile);
}
