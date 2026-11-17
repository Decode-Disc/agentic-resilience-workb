// @vitest-environment node
const { evaluationTransport, validateAnswers } = await import(
    new URL(
        "../../../scripts/evaluations/source-selection/decision-protocol.ts",
        import.meta.url,
    ).href
);

import { expect, test, vi } from "vitest";
import type {
    StudyCase,
    StudyCall,
} from "@scripts/evaluations/source-selection/source-quality-study";

vi.mock("node:fs", async (original) => {
    const fs = await original<typeof import("node:fs")>();
    return {
        ...fs,
        readFileSync: new Proxy(fs.readFileSync, {
            apply(target, receiver, args) {
                if (
                    typeof args[0] === "string" &&
                    args[0].endsWith("/.env.local")
                )
                    return args[1] === "utf8" ? "" : Buffer.alloc(0);
                return Reflect.apply(target, receiver, args);
            },
        }),
    };
});

test("routes Luna through native decisions rather than chat completions", () => {
    expect(evaluationTransport("openai/gpt-6-luna-decisions")).toMatchObject({
        native: true,
        endpoint: "https://openrouter.ai/api/alpha/decisions",
    });
});

test("retains strict native question membership and probability validation", () => {
    const questions = {
        finding: {
            type: "choice" as const,
            instructions: "Which?",
            criteria: { supported: "Supported", unknown: "Unknown" },
        },
    };
    expect(
        validateAnswers(
            {
                answers: {
                    finding: {
                        type: "choice",
                        choice: "supported",
                        confidence: 0.9,
                        probabilities: { supported: 0.9, unknown: 0.1 },
                    },
                },
            },
            questions,
            true,
        ),
    ).toEqual({ finding: "supported" });
    expect(() =>
        validateAnswers(
            {
                answers: {
                    finding: {
                        type: "choice",
                        choice: "invented",
                        confidence: 0.9,
                        probabilities: { supported: 0.9, unknown: 0.1 },
                    },
                },
            },
            questions,
            true,
        ),
    ).toThrow("Unknown choice");
});

const { readStudy, prepareStudy, scoreStudy } = await import(
    new URL(
        "../../../scripts/evaluations/source-selection/source-quality-study.ts",
        import.meta.url,
    ).href
);
const { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } =
    await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { createHash } = await import("node:crypto");
const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex");

function studyFixture() {
    const directory = mkdtempSync(join(tmpdir(), "source-quality-test-"));
    const text =
        "Example Company reports revenue of 100 million for fiscal year 2025. Management expects revenue to grow in fiscal year 2026. The author argues that workflow integration could increase switching costs.";
    const protocol = JSON.parse(
        readFileSync(
            new URL(
                "../../../scripts/evaluations/source-selection/study-protocol.json",
                import.meta.url,
            ),
            "utf8",
        ),
    );
    const companies = ["adobe", "nvidia", "snowflake", "crowdstrike"].map(
        (id, index) => ({
            id,
            cik: String(index + 1),
            legalName: `Example ${id}`,
            ticker: id.toUpperCase(),
            websiteUrl: "https://example.com/",
            split: index === 0 ? "development" : "holdout",
        }),
    );
    const documents = companies.flatMap((company) =>
        protocol.categories.map((category: string) => ({
            id: `${company.id}-${category}`,
            companyId: company.id,
            category,
            title: `Example ${category}`,
            url: `https://example.com/${company.id}/${category}`,
            capturedAt: "2026-10-20T00:00:00.000Z",
            textFile: "capture.txt",
            contentHash: digest(text),
            selectedSpan: { startOffset: 0, endOffset: text.length },
        })),
    );
    const controls = companies.flatMap((company) =>
        ["numeric", "forecast", "capability", "unresolved"].map((topic) => ({
            id: `${company.id}-${topic}`,
            companyId: company.id,
            targetDocumentId: `${company.id}-analysis`,
            span: { startOffset: 0, endOffset: text.length },
            kind: "attributed_argument",
            primaryDocumentIds: [`${company.id}-annual`],
            topic,
        })),
    );
    const historical = JSON.stringify({
        cases: [
            "relation_crpo",
            "relation_margin_risk",
            "relation_reported_debt",
            "relation_contracts_product",
        ].map((id) => ({
            id,
            state: { text },
            questions: {
                verdict: {
                    type: "choice",
                    instructions: "Does the supplied passage support this?",
                    criteria: { yes: "Yes", unknown: "Unknown" },
                },
            },
        })),
    });
    const historicalReference = JSON.stringify({
        judgments: Object.fromEntries(
            [
                "relation_crpo",
                "relation_margin_risk",
                "relation_reported_debt",
                "relation_contracts_product",
            ].map((id) => [id, { expected: { verdict: ["unknown"] } }]),
        ),
    });
    const reference = {
        author: "Investigating assistant",
        independentHumanGroundTruth: false,
        frozenAt: "2026-10-20T12:00:00.000Z",
        judgments: {},
        grouped: {},
    };
    const study = {
        schemaVersion: "source-quality-study-v1",
        studyId: protocol.studyId,
        protocolFile: "protocol.json",
        protocolSha256: digest(JSON.stringify(protocol)),
        instructionsFrozenAt: "2026-10-20T00:00:00.000Z",
        companies,
        documents,
        controls,
        referenceFile: "reference.json",
        historicalDatasetFile: "historical.json",
        historicalReferenceFile: "historical-reference.json",
        historicalDatasetSha256: digest(historical),
        historicalReferenceSha256: digest(historicalReference),
    };
    for (const [name, bytes] of Object.entries({
        "study.json": JSON.stringify(study),
        "protocol.json": JSON.stringify(protocol),
        "capture.txt": text,
        "reference.json": JSON.stringify(reference),
        "historical.json": historical,
        "historical-reference.json": historicalReference,
    }))
        writeFileSync(join(directory, name), bytes);
    return { directory, path: join(directory, "study.json"), study, reference };
}

test("plans all 416 attempts while missing investigator references block inference", () => {
    const fixture = studyFixture();
    try {
        const manifest = prepareStudy(readStudy(fixture.path));
        expect(manifest.calls).toHaveLength(416);
        expect(
            manifest.calls.filter(
                (call: { task: string }) => call.task === "choices",
            ),
        ).toHaveLength(320);
        expect(
            manifest.calls.filter(
                (call: { task: string }) => call.task === "qualification",
            ),
        ).toHaveLength(64);
        expect(
            manifest.calls.filter(
                (call: { task: string }) => call.task === "comparison",
            ),
        ).toHaveLength(32);
        expect(manifest.status).toBe("blocked");
        expect(manifest.blockers).toContain(
            "missing_reference:document:adobe-annual",
        );
        expect(manifest.providerRequests).toBe(0);
        expect(manifest.integrationExcludedModels).toEqual([
            "openai/gpt-6-luna-decisions",
        ]);
        const native = manifest.calls.find(
            (call: { model: string }) =>
                call.model === "openai/gpt-6-luna-decisions",
        );
        expect(native.body).toHaveProperty("questions");
        expect(native.body).not.toHaveProperty("messages");
    } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
    }
});

test("rejects changed captures and a changed frozen protocol", () => {
    const fixture = studyFixture();
    try {
        writeFileSync(
            join(fixture.directory, "capture.txt"),
            "Changed capture",
        );
        expect(() => readStudy(fixture.path)).toThrow("Capture changed");
        writeFileSync(join(fixture.directory, "protocol.json"), "{}");
        expect(() => readStudy(fixture.path)).toThrow(
            "Study protocol changed after freeze",
        );
    } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
    }
});

test("keeps failed holdout responses in the denominator without scoring a missing reference as wrong", () => {
    const fixture = studyFixture();
    try {
        const loaded = readStudy(fixture.path);
        const manifest = prepareStudy(loaded);
        const call = manifest.calls.find(
            (item: { caseId: string; model: string }) =>
                item.caseId === "document:nvidia-annual" &&
                item.model === "microsoft/microsoft-decision-1",
        );
        const report = scoreStudy(loaded, manifest, [
            { key: call.key, status: "failed", costUsd: 0.04, latencyMs: 120 },
        ]);
        const observation = report.observations.find(
            (item: { key: string }) => item.key === call.key,
        );
        expect(observation.status).toBe("unusable");
        expect(observation.judgments[0]).toMatchObject({
            actual: null,
            correct: null,
            referenceStatus: "missing",
        });
        expect(report.observations).toHaveLength(416);
    } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
    }
});

test("rejects an evidence quotation that does not match the frozen document", () => {
    const fixture = studyFixture();
    try {
        const entry = {
            accepted: ["subject"],
            rationale: "A deliberately invalid reference anchor.",
            evidence: [
                {
                    documentId: "adobe-annual",
                    startOffset: 0,
                    endOffset: 7,
                    quotation: "forged!",
                },
            ],
            metric: "classification",
            unsafeChoices: [],
        };
        const judgments = {
            "document:adobe-annual": {
                company: entry,
                purpose: { ...entry, accepted: ["regulatory_annual"] },
                usefulness: { ...entry, accepted: ["useful"] },
                nature: { ...entry, accepted: ["reported_outcome"] },
                period: { ...entry, accepted: ["historical"] },
                citation: { ...entry, accepted: ["none"] },
            },
        };
        writeFileSync(
            join(fixture.directory, "reference.json"),
            JSON.stringify({ ...fixture.reference, judgments }),
        );
        expect(() => prepareStudy(readStudy(fixture.path))).toThrow(
            "Reference quotation mismatch",
        );
    } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
    }
});

const { readEvaluationHistory } = await import(
    new URL(
        "../../../scripts/evaluations/source-selection/evaluation-records.ts",
        import.meta.url,
    ).href
);
const { runStudyCli } = await import(
    new URL(
        "../../../scripts/evaluations/source-selection/study-cli.ts",
        import.meta.url,
    ).href
);

test.each([
    "completed",
    "cancelled-before-dispatch",
] as const)("approved grouped execution %s preserves frozen SDK budgets and settles its real result", async (outcome) => {
    const fixture = studyFixture();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
        const initial = prepareStudy(readStudy(fixture.path));
        writeFileSync(
            join(fixture.directory, "reference.json"),
            JSON.stringify({
                ...fixture.reference,
                judgments: Object.fromEntries(
                    initial.cases
                        .filter(
                            (item: StudyCase) => item.family !== "regression",
                        )
                        .map((item: StudyCase) => [
                            item.sourceCaseId ?? item.id,
                            Object.fromEntries(
                                Object.entries(item.questions).map(
                                    ([key, question]) => [
                                        key,
                                        {
                                            accepted: [
                                                Object.keys(
                                                    question.criteria,
                                                )[0],
                                            ],
                                            unsafeChoices: [],
                                            rationale:
                                                "Synthetic reference for execution mechanics only.",
                                            metric: "classification",
                                            evidence: [],
                                        },
                                    ],
                                ),
                            ),
                        ]),
                ),
                grouped: Object.fromEntries(
                    initial.calls
                        .filter((call: StudyCall) => call.task !== "choices")
                        .map((call: StudyCall) => [
                            `${call.task}:${call.caseId}`,
                            {
                                rationale:
                                    "Synthetic reference for execution mechanics only.",
                                expected: {},
                            },
                        ]),
                ),
            }),
        );
        const catalog = join(fixture.directory, "catalog.json");
        writeFileSync(
            catalog,
            JSON.stringify({
                observedAt: new Date().toISOString(),
                models: initial.models.map((id: string) => ({
                    id,
                    provider: "fixture",
                    contextLength: 64000,
                    maximumOutputTokens: 6144,
                    inputPricePerToken: 0.00000007,
                    outputPricePerToken: 0.0000005,
                    sourceUrl: "https://openrouter.ai/api/v1/models",
                    descriptor: {
                        contextWindow: 64000,
                        maxTokens: 2048,
                        reasoning: false,
                        inputPrice: 0.07,
                        outputPrice: 0.5,
                        cacheReadPrice: 0,
                        structuredOutputs: true,
                    },
                })),
            }),
        );
        const base = ["--study", fixture.path, "--catalog", catalog];
        await runStudyCli("qualification", [
            ...base,
            "--prepare",
            "--run",
            "capture",
        ]);
        const capture = JSON.parse(
            readFileSync(
                join(fixture.directory, "runs/capture/manifest.json"),
                "utf8",
            ),
        );
        expect(capture.blockers).toEqual(["missing_input_contract"]);
        writeFileSync(
            join(fixture.directory, "input-contract.json"),
            JSON.stringify({
                protocolSha256: fixture.study.protocolSha256,
                frozenAt: fixture.study.instructionsFrozenAt,
                providerInputHashes: Object.fromEntries(
                    capture.calls.map((call: StudyCall) => [
                        call.key,
                        call.requestHash,
                    ]),
                ),
            }),
        );
        writeFileSync(
            fixture.path,
            JSON.stringify({
                ...fixture.study,
                inputContractFile: "input-contract.json",
            }),
        );
        const model = capture.calls.find(
            (call: StudyCall) => call.task === "qualification",
        ).model;
        const selected = [
            ...base,
            "--tasks",
            "qualification",
            "--models",
            model,
            "--run",
            "approved",
        ];
        await runStudyCli("qualification", [...selected, "--prepare"]);
        const path = join(fixture.directory, "runs/approved/manifest.json");
        const manifestBytes = readFileSync(path, "utf8");
        const manifest = JSON.parse(manifestBytes);
        expect(manifest.status).toBe("prepared");
        expect(manifest.maximumAttempts).toBe(32);
        expect(manifest.calls[0].body.max_tokens).toBe(2048);
        const authorization = join(fixture.directory, "authorization.json");
        writeFileSync(
            authorization,
            JSON.stringify({
                manifestSha256: digest(JSON.stringify(manifest)),
                maximumAttempts: 32,
                budgetUsd: 1,
                approvedAt: new Date().toISOString(),
            }),
        );
        const { SOURCE_COVERAGE_ROLES } = await import(
            "@convex/domain/sourceSelectionPolicy"
        );
        const output = {
            companyMatch: "uncertain",
            companyPassageKeys: [],
            documentKind: "independent_analysis",
            reportingPeriodEnd: null,
            reportingPeriodPassageKeys: [],
            contributions: Object.fromEntries(
                SOURCE_COVERAGE_ROLES.map((role) => [role, null]),
            ),
            limitations: [],
        };
        const requests: string[] = [];
        vi.stubEnv("OPENROUTER_API_KEY", "synthetic-study-only-key");
        vi.stubGlobal(
            "fetch",
            async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
                const request = new Request(url, init);
                expect(request.url).toBe(
                    "https://openrouter.ai/api/v1/chat/completions",
                );
                const body = await request.text();
                requests.push(body);
                expect(
                    manifest.calls.map((call: StudyCall) => call.requestHash),
                ).toContain(digest(body));
                expect(JSON.parse(body).max_tokens).toBe(2048);
                return new Response(
                    JSON.stringify({
                        id: "study-fixture",
                        model,
                        provider: "fixture",
                        created: 1,
                        choices: [
                            {
                                index: 0,
                                message: {
                                    role: "assistant",
                                    content: JSON.stringify(output),
                                },
                                finish_reason: "stop",
                            },
                        ],
                        usage: {
                            prompt_tokens: 200,
                            completion_tokens: 50,
                            total_tokens: 250,
                            cost: 0.0001,
                        },
                    }),
                    { headers: { "content-type": "application/json" } },
                );
            },
        );
        if (outcome === "cancelled-before-dispatch") {
            const once = process.once.bind(process);
            vi.spyOn(process, "once").mockImplementation((event, listener) => {
                const registered = once(event, listener);
                if (event === "SIGTERM") queueMicrotask(() => listener());
                return registered;
            });
        }
        await runStudyCli("qualification", [
            ...selected,
            "--live",
            "--authorization",
            authorization,
        ]);
        const journalPath = join(
            fixture.directory,
            "runs/approved/calls.jsonl",
        );
        const entries = readFileSync(journalPath, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        const result = entries.find((entry) => entry.event === "result");
        if (outcome === "cancelled-before-dispatch") {
            expect(requests).toHaveLength(0);
            const results = entries.filter((entry) => entry.event === "result");
            expect(results).toHaveLength(2);
            for (const item of results)
                expect(item).toMatchObject({
                    status: "failed",
                    costUsd: 0,
                    costBasis: "not_dispatched",
                    output: {
                        status: "failed",
                        errorCode: "cancelled",
                        dispatchOutcome: "not_dispatched",
                    },
                });
            expect(JSON.parse(log.mock.calls.at(-1)?.[0])).toMatchObject({
                reportedCostUsd: 0,
                unknownChargeReservedUsd: 0,
                actualAttempts: 2,
            });
            return;
        }
        expect(result, result?.output?.outputDiagnostic?.reason).toMatchObject({
            status: "succeeded",
            costUsd: 0.0001,
            costBasis: "provider_reported",
            output: {
                status: "succeeded",
                qualification: {
                    companyMatch: "uncertain",
                    documentKind: "independent_analysis",
                    reportingPeriodEnd: null,
                    findings: [],
                    limitations: output.limitations,
                },
            },
        });
        expect(requests).toHaveLength(8);
        expect(readFileSync(path, "utf8")).toBe(manifestBytes);
        const summary = JSON.parse(log.mock.calls.at(-1)?.[0]);
        expect(summary).toMatchObject({
            actualAttempts: 8,
            unknownChargeReservedUsd: 0,
            unresolvedAttempts: 0,
            appWrites: 0,
        });
        expect(summary.reportedCostUsd).toBeCloseTo(0.0008, 12);
        const before = readFileSync(journalPath, "utf8");
        await runStudyCli("qualification", [
            ...selected,
            "--live",
            "--authorization",
            authorization,
        ]);
        expect(requests).toHaveLength(8);
        expect(readFileSync(journalPath, "utf8")).toBe(before);
    } finally {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        rmSync(fixture.directory, { recursive: true, force: true });
    }
}, 60000);

test("rejects orphaned ledger results instead of understating an experiment's spending", () => {
    const fixture = studyFixture();
    try {
        mkdirSync(join(fixture.directory, "run"));
        writeFileSync(
            join(fixture.directory, "run", "calls.jsonl"),
            `${JSON.stringify({
                event: "result",
                key: "unrecorded-dispatch",
                costUsd: 0.5,
            })}\n`,
        );
        expect(() => readEvaluationHistory(fixture.directory, ["run"])).toThrow(
            "Orphaned or duplicate historical result",
        );
    } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
    }
});

test.each([
    "choices",
    "qualification",
    "comparison",
] as const)("blocks unapproved live %s execution before preparing SDK requests", async (mode) => {
    const fixture = studyFixture();
    try {
        await expect(
            runStudyCli(mode, ["--study", fixture.path, "--live"]),
        ).rejects.toThrow("no authorized inference manifest");
    } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
    }
});

test("keeps every supplied primary reference available after bounding a common request", () => {
    const fixture = studyFixture();
    try {
        const manifest = prepareStudy(readStudy(fixture.path));
        const control = manifest.cases.find(
            (item: { id: string }) => item.id === "control:adobe-numeric",
        );
        expect(control.state.primaryPassages.length).toBeGreaterThan(0);
        for (const passage of control.state.primaryPassages)
            expect(Object.keys(control.questions.citation.criteria)).toContain(
                passage.referenceKey,
            );
    } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
    }
});

test("rejects unsupported study limits instead of silently planning a larger batch", async () => {
    const fixture = studyFixture();
    try {
        await expect(
            runStudyCli("choices", ["--study", fixture.path, "--limit", "1"]),
        ).rejects.toThrow("Unknown study option: --limit");
    } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
    }
});

const { validateStudyApproval } = await import(
    new URL(
        "../../../scripts/evaluations/source-selection/study-cli.ts",
        import.meta.url,
    ).href
);
const approvalTime = Date.UTC(2026, 9, 20, 12);
const quotedCatalog = {
    observedAt: "2026-10-20T11:45:00.000Z",
    models: [
        {
            id: "jev-1.14.0",
            inputPricePerToken: 0.000000042,
            outputPricePerToken: 0,
            contextLength: 32768,
            provider: "typesafe",
            sourceUrl: "https://docs.typesafe.ai/models",
        },
    ],
};
const approvedLot = {
    manifestSha256: "exact-manifest",
    maximumAttempts: 416,
    budgetUsd: 3,
    approvedAt: "2026-10-20T11:50:00.000Z",
};

test("rejects a different paid lot and a reservation above its approved budget", () => {
    expect(() =>
        validateStudyApproval({
            manifestSha256: "different-manifest",
            maximumReservationUsd: 2.9,
            catalog: quotedCatalog,
            approval: approvedLot,
            now: approvalTime,
        }),
    ).toThrow("another manifest");
    expect(() =>
        validateStudyApproval({
            manifestSha256: "exact-manifest",
            maximumReservationUsd: 3.01,
            catalog: quotedCatalog,
            approval: approvedLot,
            now: approvalTime,
        }),
    ).toThrow("exceeds its budget");
    expect(
        validateStudyApproval({
            manifestSha256: "exact-manifest",
            maximumReservationUsd: 2.9,
            catalog: quotedCatalog,
            approval: approvedLot,
            now: approvalTime,
        }),
    ).toMatchObject({ maximumAttempts: 416, budgetUsd: 3 });
});

test("reuses the approved lot with a fresh snapshot at the same or lower tariffs", () => {
    const later = approvalTime + 7200000;
    const fresh = {
        ...quotedCatalog,
        observedAt: new Date(later - 60000).toISOString(),
        models: quotedCatalog.models.map((model) => ({
            ...model,
            inputPricePerToken: 0.00000004,
        })),
    };
    expect(
        validateStudyApproval({
            manifestSha256: "exact-manifest",
            maximumReservationUsd: 2.9,
            catalog: quotedCatalog,
            currentCatalog: fresh,
            approval: approvedLot,
            now: later,
        }),
    ).toMatchObject({ budgetUsd: 3 });
    expect(() =>
        validateStudyApproval({
            manifestSha256: "exact-manifest",
            maximumReservationUsd: 2.9,
            catalog: quotedCatalog,
            currentCatalog: {
                ...fresh,
                models: fresh.models.map((model) => ({
                    ...model,
                    inputPricePerToken: 0.00000005,
                })),
            },
            approval: approvedLot,
            now: later,
        }),
    ).toThrow("Fresh tariff or provider exceeds the approved quote");
});

test("rejects duplicate logical controls before they can reserve two paid calls for one key", () => {
    const fixture = studyFixture();
    try {
        const first = fixture.study.controls[0];
        const second = fixture.study.controls[1];
        expect(first && second).toBeTruthy();
        if (!first || !second) throw new Error("Missing fixture control");
        second.id = first.id;
        writeFileSync(fixture.path, JSON.stringify(fixture.study));
        expect(() => prepareStudy(readStudy(fixture.path))).toThrow(
            "Duplicate study request identity",
        );
    } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
    }
});

test("keeps development and holdout labels out of production-adapter inputs", () => {
    const fixture = studyFixture();
    try {
        const manifest = prepareStudy(readStudy(fixture.path));
        for (const call of manifest.calls.filter(
            (item: { task: string }) => item.task !== "choices",
        )) {
            const expected = fixture.study.companies.find(
                (company) => company.id === call.companyId,
            );
            expect(call.prepared.request.company).toEqual({
                cik: expected?.cik,
                legalName: expected?.legalName,
                ticker: expected?.ticker,
            });
        }
    } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
    }
});

test("separates unrun and unusable observations from wrong semantic answers", () => {
    const fixture = studyFixture();
    try {
        const entry = (accepted: string, metric: string) => ({
            accepted: [accepted],
            rationale: "Synthetic reference for availability accounting.",
            evidence: [],
            metric,
            unsafeChoices: [],
        });
        const judgments = {
            "document:adobe-annual": {
                company: entry("uncertain", "classification"),
                purpose: entry("unknown", "classification"),
                usefulness: entry("limited", "usefulness"),
                nature: entry("mixed_or_uncertain", "nature"),
                period: entry("unspecified", "period"),
                citation: entry("p0", "citation"),
            },
        };
        writeFileSync(
            join(fixture.directory, "reference.json"),
            JSON.stringify({ ...fixture.reference, judgments }),
        );
        const loaded = readStudy(fixture.path);
        const manifest = prepareStudy(loaded);
        const call = manifest.calls.find(
            (item: { model: string; caseId: string }) =>
                item.model === "deepseek/deepseek-v4-flash-0731" &&
                item.caseId === "document:adobe-annual",
        );
        const row = (report: ReturnType<typeof scoreStudy>) =>
            report.metrics.find(
                (item: {
                    model: string;
                    companyId: string;
                    family: string;
                    question: string;
                }) =>
                    item.model === call.model &&
                    item.companyId === "adobe" &&
                    item.family === "document" &&
                    item.question === "company",
            );
        expect(row(scoreStudy(loaded, manifest, []))).toMatchObject({
            count: 8,
            available: 0,
            incorrect: 0,
            notRun: 8,
            unusable: 0,
        });
        expect(
            row(
                scoreStudy(loaded, manifest, [
                    { key: call.key, status: "failed" },
                ]),
            ),
        ).toMatchObject({
            count: 8,
            available: 0,
            incorrect: 0,
            notRun: 7,
            unusable: 1,
        });
        const content = JSON.stringify({
            company: "unrelated",
            purpose: "unknown",
            usefulness: "limited",
            nature: "mixed_or_uncertain",
            period: "unspecified",
            citation: "p0",
        });
        expect(
            row(
                scoreStudy(loaded, manifest, [
                    {
                        key: call.key,
                        status: "succeeded",
                        response: {
                            choices: [
                                { finish_reason: "stop", message: { content } },
                            ],
                        },
                    },
                ]),
            ),
        ).toMatchObject({
            count: 8,
            available: 1,
            incorrect: 1,
            notRun: 7,
            unusable: 0,
        });
    } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
    }
});

test("retains execution ownership until every in-flight worker settles after failure", async () => {
    const { finishStudyWorkers } = await import(
        new URL(
            "../../../scripts/evaluations/source-selection/study-cli.ts",
            import.meta.url,
        ).href
    );
    let release = () => {};
    const inFlight = new Promise<void>((resolve) => {
        release = resolve;
    });
    let stopped = false;
    let finished = false;
    const running = finishStudyWorkers(
        [Promise.reject(new Error("budget exhausted")), inFlight],
        () => {
            stopped = true;
        },
    ).catch((error: Error) => {
        finished = true;
        return error;
    });
    try {
        await new Promise((resolve) => setImmediate(resolve));
        expect(finished).toBe(false);
        expect(stopped).toBe(true);
    } finally {
        release();
    }
    expect((await running).message).toBe("budget exhausted");
});

test("binds a twenty-request screen to selected frozen cases and its own attempt ceiling", async () => {
    const fixture = studyFixture();
    try {
        const cases = [
            "control:adobe-numeric",
            "control:nvidia-forecast",
            "control:snowflake-capability",
            "control:crowdstrike-numeric",
        ];
        const selection = join(fixture.directory, "screen.json");
        writeFileSync(selection, JSON.stringify(cases));
        await runStudyCli("choices", [
            "--study",
            fixture.path,
            "--cases",
            selection,
            "--prepare",
            "--run",
            "screen",
        ]);
        const manifest = JSON.parse(
            readFileSync(
                join(fixture.directory, "runs/screen/manifest.json"),
                "utf8",
            ),
        );
        expect(manifest.calls).toHaveLength(20);
        expect(
            manifest.cases.map((item: { id: string }) => item.id).sort(),
        ).toEqual(cases.sort());
        expect(manifest.maximumAttempts).toBe(20);
        expect(
            validateStudyApproval({
                manifestSha256: "screen",
                maximumAttempts: 20,
                maximumReservationUsd: 0.081,
                catalog: quotedCatalog,
                approval: {
                    ...approvedLot,
                    manifestSha256: "screen",
                    maximumAttempts: 20,
                    budgetUsd: 0.1,
                },
                now: approvalTime,
            }),
        ).toMatchObject({ maximumAttempts: 20, budgetUsd: 0.1 });
        expect(() =>
            validateStudyApproval({
                manifestSha256: "screen",
                maximumAttempts: 20,
                maximumReservationUsd: 0.081,
                catalog: quotedCatalog,
                approval: { ...approvedLot, manifestSha256: "screen" },
                now: approvalTime,
            }),
        ).toThrow("Invalid explicit study authorization");
    } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
    }
});

test("replaces only the two requested candidates while retaining identical common inputs", async () => {
    const fixture = studyFixture();
    try {
        const cases = [
            "control:adobe-numeric",
            "control:nvidia-forecast",
            "control:snowflake-capability",
            "control:crowdstrike-numeric",
        ];
        const replacements = [
            {
                from: "deepseek/deepseek-v4-flash-0731",
                to: "deepseek/deepseek-v4.1-flash",
                provider: "relace",
            },
            {
                from: "openai/gpt-6-luna-decisions",
                to: "deepseek/deepseek-v4.1-flash-1017",
                provider: "relace",
            },
        ];
        const casePath = join(fixture.directory, "cases.json"),
            replacementPath = join(fixture.directory, "replacements.json");
        writeFileSync(casePath, JSON.stringify(cases));
        writeFileSync(replacementPath, JSON.stringify(replacements));
        await runStudyCli("choices", [
            "--study",
            fixture.path,
            "--cases",
            casePath,
            "--replacements",
            replacementPath,
            "--prepare",
            "--run",
            "replacements",
        ]);
        const manifest = JSON.parse(
            readFileSync(
                join(fixture.directory, "runs/replacements/manifest.json"),
                "utf8",
            ),
        );
        expect(manifest.calls).toHaveLength(8);
        expect(manifest.maximumAttempts).toBe(8);
        expect(manifest.models).toEqual(replacements.map((item) => item.to));
        const baseline = prepareStudy(readStudy(fixture.path));
        for (const call of manifest.calls) {
            const original = baseline.calls.find(
                (item: { caseId: string; model: string; task: string }) =>
                    item.caseId === call.caseId &&
                    item.model === "deepseek/deepseek-v4-flash-0731" &&
                    item.task === "choices",
            );
            expect(call.body.messages).toEqual(original.body.messages);
            expect(call.body.response_format).toEqual(
                original.body.response_format,
            );
            expect(call.body).toMatchObject({
                model: call.model,
                temperature: 0,
                reasoning: { enabled: false },
                max_tokens: 1024,
                provider: { only: ["relace"], allow_fallbacks: false },
            });
            expect(call.native).toBe(false);
            expect(call.requestHash).toBe(digest(JSON.stringify(call.body)));
        }
    } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
    }
});

const glmProfile = {
    id: "z-ai/glm-5.3-flash",
    provider: "open-inference/fp4",
    inputPricePerToken: 0.000000047076,
    outputPricePerToken: 0.00000012,
    contextLength: 1048576,
    sourceUrl:
        "https://openrouter.ai/api/v1/models/z-ai/glm-5.3-flash/endpoints",
    reasoning: { effort: "low", exclude: true },
    maximumOutputTokens: 8192,
};

test("preserves long-case context when selecting models without relaxing ordinary case limits", async () => {
    const fixture = studyFixture();
    try {
        const text = Array.from(
            { length: 500 },
            (_, index) =>
                `Section ${index}. Example Company reports revenue of ${index + 100} million for fiscal year 2025. Management expects workflow integration to increase switching costs.`,
        ).join("\n\n");
        const document = fixture.study.documents.find(
            (item) => item.id === "adobe-annual",
        );
        expect(document).toBeDefined();
        Object.assign(document as object, {
            textFile: "long.txt",
            contentHash: digest(text),
        });
        writeFileSync(join(fixture.directory, "long.txt"), text);
        writeFileSync(fixture.path, JSON.stringify(fixture.study));
        const casesPath = join(fixture.directory, "cases.json");
        const catalogPath = join(fixture.directory, "catalog.json");
        writeFileSync(
            casesPath,
            JSON.stringify(["document:adobe-annual", "long:adobe-annual"]),
        );
        writeFileSync(
            catalogPath,
            JSON.stringify({
                ...quotedCatalog,
                models: [glmProfile, ...quotedCatalog.models],
            }),
        );
        await runStudyCli("choices", [
            "--study",
            fixture.path,
            "--cases",
            casesPath,
            "--catalog",
            catalogPath,
            "--models",
            "all",
            "--prepare",
            "--run",
            "long-selected",
        ]);
        const manifest = JSON.parse(
            readFileSync(
                join(fixture.directory, "runs/long-selected/manifest.json"),
                "utf8",
            ),
        );
        expect(manifest.calls).toHaveLength(4);
        const baseline = prepareStudy(readStudy(fixture.path));
        for (const call of manifest.calls) {
            const bytes = Buffer.byteLength(JSON.stringify(call.body));
            expect(bytes).toBeLessThanOrEqual(
                call.family === "long_input" ? 131072 : 24576,
            );
            if (!call.native && call.family === "long_input") {
                expect(bytes).toBeGreaterThan(24576);
                const original = baseline.calls.find(
                    (item: { caseId: string; native: boolean }) =>
                        item.caseId === call.caseId && !item.native,
                );
                expect(call.body.messages).toEqual(original?.body.messages);
            }
        }
        expect(manifest.providerRequests).toBe(0);
        expect(manifest.appWrites).toBe(0);
    } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
    }
});

test.each([
    ["z-ai/glm-5.3-flash", 4],
    ["z-ai/glm-5.3-flash,jev-1.14.0", 8],
    ["all", 8],
])("selects %s from catalog data without source edits", async (models, count) => {
    const fixture = studyFixture();
    try {
        const casesPath = join(fixture.directory, "cases.json"),
            catalogPath = join(fixture.directory, "catalog.json");
        writeFileSync(
            casesPath,
            JSON.stringify([
                "control:adobe-numeric",
                "control:nvidia-forecast",
                "control:snowflake-capability",
                "control:crowdstrike-numeric",
            ]),
        );
        writeFileSync(
            catalogPath,
            JSON.stringify({
                ...quotedCatalog,
                models: [glmProfile, ...quotedCatalog.models],
            }),
        );
        await runStudyCli("choices", [
            "--study",
            fixture.path,
            "--cases",
            casesPath,
            "--catalog",
            catalogPath,
            "--models",
            models,
            "--prepare",
            "--run",
            "selected",
        ]);
        const manifest = JSON.parse(
            readFileSync(
                join(fixture.directory, "runs/selected/manifest.json"),
                "utf8",
            ),
        );
        expect(manifest.calls).toHaveLength(count);
        expect(manifest.maximumAttempts).toBe(count);
        expect(manifest.models).toEqual(
            count === 4 ? [glmProfile.id] : [glmProfile.id, "jev-1.14.0"],
        );
        const baseline = prepareStudy(readStudy(fixture.path));
        for (const call of manifest.calls) {
            if (call.model === glmProfile.id) {
                const original = baseline.calls.find(
                    (c: { model: string; caseId: string }) =>
                        c.model === "deepseek/deepseek-v4-flash-0731" &&
                        c.caseId === call.caseId,
                );
                expect(call.body.messages).toEqual(original.body.messages);
                expect(call.body).toMatchObject({
                    model: glmProfile.id,
                    provider: { only: [glmProfile.provider] },
                    reasoning: { effort: "low", exclude: true },
                    max_tokens: 8192,
                });
                expect(call.reservationUsd).toBeGreaterThanOrEqual(
                    8192 * 0.00000012,
                );
            } else {
                expect(call.native).toBe(true);
                expect(call.endpoint).toBe(
                    "https://api.typesafe.ai/v1/systemone",
                );
            }
        }
    } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
    }
});

test("rejects unknown or duplicate selected models instead of launching a different lot", async () => {
    const fixture = studyFixture();
    try {
        const casesPath = join(fixture.directory, "cases.json"),
            catalogPath = join(fixture.directory, "catalog.json");
        writeFileSync(casesPath, JSON.stringify(["control:adobe-numeric"]));
        writeFileSync(
            catalogPath,
            JSON.stringify({ ...quotedCatalog, models: [glmProfile] }),
        );
        const base = [
            "--study",
            fixture.path,
            "--cases",
            casesPath,
            "--catalog",
            catalogPath,
        ];
        await expect(
            runStudyCli("choices", [...base, "--models", "unknown/model"]),
        ).rejects.toThrow("Unknown selected model");
        await expect(
            runStudyCli("choices", [
                ...base,
                "--models",
                `${glmProfile.id},${glmProfile.id}`,
            ]),
        ).rejects.toThrow("Supply distinct selected model identifiers");
    } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
    }
});

test("selects the same 96 real grouped requests through either grouped entrypoint", async () => {
    const fixture = studyFixture();
    try {
        const catalogPath = join(fixture.directory, "catalog.json");
        const models = [
            "deepseek/deepseek-v4.1-flash",
            "deepseek/deepseek-v4.1-flash-1017",
        ];
        writeFileSync(
            catalogPath,
            JSON.stringify({
                observedAt: new Date().toISOString(),
                models: models.map((id) => ({
                    id,
                    provider: "relace",
                    inputPricePerToken: 0.00000007,
                    outputPricePerToken: 0.0000005,
                    contextLength: 1048576,
                    maximumOutputTokens: 6144,
                    reasoning: {
                        enabled: false,
                        effort: "none",
                        exclude: true,
                    },
                    descriptor: {
                        contextWindow: 1048576,
                        maxTokens: 8192,
                        reasoning: false,
                        inputPrice: 0.07,
                        outputPrice: 0.5,
                        cacheReadPrice: 0,
                        structuredOutputs: true,
                    },
                    sourceUrl: `https://openrouter.ai/api/v1/models/${id}/endpoints`,
                })),
            }),
        );
        for (const mode of ["qualification", "comparison"] as const) {
            await runStudyCli(mode, [
                "--study",
                fixture.path,
                "--catalog",
                catalogPath,
                "--tasks",
                "qualification,comparison",
                "--models",
                "all",
                "--prepare",
                "--run",
                "grouped-selected",
            ]);
        }
        const manifest = JSON.parse(
            readFileSync(
                join(fixture.directory, "runs/grouped-selected/manifest.json"),
                "utf8",
            ),
        );
        expect(manifest.codeHashes["convex/resourcePolicy.ts"]).toBe(
            digest(readFileSync("convex/resourcePolicy.ts", "utf8")),
        );
        expect(manifest.calls).toHaveLength(96);
        expect(manifest.maximumAttempts).toBe(96);
        expect(
            manifest.calls.filter(
                (c: { task: string }) => c.task === "qualification",
            ),
        ).toHaveLength(64);
        expect(
            manifest.calls.filter(
                (c: { task: string }) => c.task === "comparison",
            ),
        ).toHaveLength(32);
        expect(manifest.models).toEqual(models);
        expect(
            new Set(manifest.calls.map((c: { key: string }) => c.key)).size,
        ).toBe(96);
        const baseline = prepareStudy(readStudy(fixture.path));
        for (const call of manifest.calls) {
            const original = baseline.calls.find(
                (item: { task: string; caseId: string }) =>
                    item.task === call.task && item.caseId === call.caseId,
            );
            expect(call.prepared).toEqual(original?.prepared);
            expect(call.body.messages.length).toBeGreaterThan(0);
            expect(call.body.response_format.type).toBe("json_schema");
            expect(call.body).toMatchObject({
                model: call.model,
                max_tokens: 6144,
                temperature: 0,
                reasoning: { enabled: false, effort: "none", exclude: true },
                provider: {
                    only: ["relace"],
                    allow_fallbacks: false,
                    max_price: { prompt: 0.07, completion: 0.5 },
                },
            });
            expect(call.requestHash).toBe(digest(JSON.stringify(call.body)));
            expect(call.reservationUsd).toBeGreaterThanOrEqual(
                6144 * 0.0000005,
            );
        }
        expect(manifest.providerRequests).toBe(0);
        expect(manifest.appWrites).toBe(0);
    } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
    }
}, 15_000);

test("grouped study capture preserves the SDK output bound below the selected ceiling", async () => {
    const fixture = studyFixture();
    try {
        const catalog = join(fixture.directory, "bounded-model.json");
        writeFileSync(
            catalog,
            JSON.stringify({
                observedAt: new Date().toISOString(),
                models: [
                    {
                        id: "example/narrow-output",
                        provider: "fixture",
                        inputPricePerToken: 0.00000007,
                        outputPricePerToken: 0.0000005,
                        contextLength: 64000,
                        maximumOutputTokens: 6144,
                        descriptor: {
                            contextWindow: 64000,
                            maxTokens: 2048,
                            reasoning: false,
                            inputPrice: 0.07,
                            outputPrice: 0.5,
                            cacheReadPrice: 0,
                            structuredOutputs: true,
                        },
                        sourceUrl:
                            "https://openrouter.ai/api/v1/models/example/narrow-output/endpoints",
                    },
                ],
            }),
        );
        await runStudyCli("qualification", [
            "--study",
            fixture.path,
            "--catalog",
            catalog,
            "--tasks",
            "qualification,comparison",
            "--models",
            "all",
            "--prepare",
            "--run",
            "bounded",
        ]);
        const manifest = JSON.parse(
            readFileSync(
                join(fixture.directory, "runs/bounded/manifest.json"),
                "utf8",
            ),
        );
        expect(manifest.calls).toHaveLength(48);
        for (const call of manifest.calls) {
            expect(call.body.messages.length).toBeGreaterThan(0);
            expect(call.body.max_tokens).toBe(2048);
        }
        expect(manifest.providerRequests).toBe(0);
    } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
    }
});

test("grouped study preparation refuses missing capabilities without guessing a request", async () => {
    const fixture = studyFixture();
    try {
        const catalog = join(fixture.directory, "missing-capabilities.json");
        writeFileSync(
            catalog,
            JSON.stringify({
                observedAt: new Date().toISOString(),
                models: [
                    {
                        id: "example/unprepared",
                        provider: "fixture",
                        inputPricePerToken: 0.00000007,
                        outputPricePerToken: 0.0000005,
                        contextLength: 64000,
                        sourceUrl:
                            "https://openrouter.ai/api/v1/models/example/unprepared/endpoints",
                    },
                ],
            }),
        );
        await runStudyCli("qualification", [
            "--study",
            fixture.path,
            "--catalog",
            catalog,
            "--tasks",
            "qualification,comparison",
            "--models",
            "all",
            "--prepare",
            "--run",
            "unprepared",
        ]);
        const manifest = JSON.parse(
            readFileSync(
                join(fixture.directory, "runs/unprepared/manifest.json"),
                "utf8",
            ),
        );
        expect(manifest.status).toBe("blocked");
        expect(manifest.calls).toHaveLength(48);
        expect(
            manifest.blockers.filter((code: string) =>
                code.startsWith("missing_model_capabilities:"),
            ),
        ).toHaveLength(48);
        expect(
            manifest.calls.every(
                (call: { body: { messages?: unknown } }) =>
                    call.body.messages === undefined,
            ),
        ).toBe(true);
        expect(manifest.providerRequests).toBe(0);
    } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
    }
});

const { scoreReviewedRetrieval } = await import(
    new URL(
        "../../../scripts/evaluations/source-selection/retrieval-replay.ts",
        import.meta.url,
    ).href
);

test("reviewed retrieval accepts only complete adjudicated equivalent evidence and preserves exact recall", () => {
    const text =
        "2026 USD revenue 10. Alternate 2026 USD revenue 10. 2025 USD revenue 10.";
    const review = {
        controls: [
            {
                id: "revenue",
                status: "comparable",
                references: [
                    { documentId: "doc", startOffset: 0, endOffset: 20 },
                ],
                equivalentEvidenceSets: [
                    {
                        rationale:
                            "Same reporting year, units and total in the disaggregation table.",
                        references: [
                            {
                                documentId: "doc",
                                startOffset: 31,
                                endOffset: 51,
                                quotationSha256: createHash("sha256")
                                    .update(text.slice(31, 51))
                                    .digest("hex"),
                            },
                        ],
                    },
                ],
            },
        ],
    };
    const row = {
        caseId: "revenue:focused",
        mode: "lexical",
        selected: [{ documentId: "doc", startOffset: 31, endOffset: 51 }],
        inputBytes: 100,
        complete: false,
    };
    expect(
        scoreReviewedRetrieval(review, [row], new Map([["doc", text]]))
            .conditions[0],
    ).toMatchObject({ retained: true, exactRetained: false });
    expect(
        scoreReviewedRetrieval(
            review,
            [
                {
                    ...row,
                    selected: [
                        {
                            documentId: "doc",
                            startOffset: 51,
                            endOffset: text.length,
                        },
                    ],
                },
            ],
            new Map([["doc", text]]),
        ).conditions[0].retained,
    ).toBe(false);
    expect(
        scoreReviewedRetrieval(
            review,
            [
                {
                    ...row,
                    selected: [
                        { documentId: "doc", startOffset: 36, endOffset: 51 },
                    ],
                },
            ],
            new Map([["doc", text]]),
        ).conditions[0].retained,
    ).toBe(false);
    expect(() =>
        scoreReviewedRetrieval(
            review,
            [row],
            new Map([
                ["doc", text.replace("Alternate 2026", "Alternate 2025")],
            ]),
        ),
    ).toThrow("Reviewed quotation changed");
});

test("reviewed retrieval keeps contextual and unresolved controls outside comparable recall", () => {
    const controls = [
        {
            id: "direct",
            status: "comparable",
            references: [{ documentId: "doc", startOffset: 0, endOffset: 5 }],
        },
        {
            id: "context",
            status: "context_only",
            references: [{ documentId: "doc", startOffset: 0, endOffset: 5 }],
        },
        { id: "unknown", status: "unresolved", references: [] },
    ];
    const rows = controls.map((c) => ({
        caseId: `${c.id}:focused`,
        mode: "lexical",
        selected: [{ documentId: "doc", startOffset: 0, endOffset: 5 }],
        inputBytes: 100,
        complete: true,
    }));
    const scored = scoreReviewedRetrieval(
        { controls },
        rows,
        new Map([["doc", "proof"]]),
    );
    expect(scored.summary[0]).toMatchObject({
        comparable: { retained: 1, total: 1 },
        contextOnly: { retained: 1, total: 1 },
        unresolvedConditions: 1,
    });
    expect(
        scored.conditions.find(
            (c: { status: string; retained: boolean | null }) =>
                c.status === "unresolved",
        )?.retained,
    ).toBeNull();
    expect(scored.modelVerdictMeasured).toBe(false);
    expect(scored.winner).toBeNull();
    expect(() =>
        scoreReviewedRetrieval(
            { controls },
            [...rows, rows[0]],
            new Map([["doc", "proof"]]),
        ),
    ).toThrow("Duplicate replay condition");
});

test("reviewed retention rejects selected quotations that do not reproduce the capture", () => {
    const review = {
        controls: [
            {
                id: "control",
                status: "comparable",
                references: [
                    { documentId: "doc", startOffset: 0, endOffset: 5 },
                ],
            },
        ],
    };
    const row = {
        caseId: "control:focused",
        mode: "lexical",
        inputBytes: 1,
        complete: true,
        selected: [
            {
                documentId: "doc",
                startOffset: 0,
                endOffset: 5,
                quotation: "false",
            },
        ],
    };
    expect(() =>
        scoreReviewedRetrieval(review, [row], new Map([["doc", "proof"]])),
    ).toThrow("Selected quotation changed");
});

test("reviewed recall requires complete substantive coverage and valid capture spans", () => {
    const control = {
        id: "direct",
        status: "comparable",
        references: [{ documentId: "doc", startOffset: 0, endOffset: 11 }],
    };
    const row = {
        caseId: "direct:focused",
        mode: "lexical",
        selected: [
            { documentId: "doc", startOffset: 0, endOffset: 5 },
            { documentId: "doc", startOffset: 6, endOffset: 11 },
        ],
        inputBytes: 100,
        complete: false,
    };
    expect(
        scoreReviewedRetrieval(
            { controls: [control] },
            [row],
            new Map([["doc", "proof basis"]]),
        ).summary[0]?.comparable.retained,
    ).toBe(1);
    const second = row.selected[1];
    if (!second) throw new Error("Missing second selected span");
    second.startOffset = 7;
    expect(
        scoreReviewedRetrieval(
            { controls: [control] },
            [row],
            new Map([["doc", "proof basis"]]),
        ).summary[0]?.comparable.retained,
    ).toBe(0);
    const reference = control.references[0];
    if (!reference) throw new Error("Missing reference");
    reference.endOffset = 20;
    expect(() =>
        scoreReviewedRetrieval(
            { controls: [control] },
            [row],
            new Map([["doc", "proof basis"]]),
        ),
    ).toThrow("Invalid reviewed span");
});

test("a frozen stop-at-budget policy accepts a smaller explicit budget without weakening whole-lot approval", () => {
    const request = {
        manifestSha256: "exact-manifest",
        maximumReservationUsd: 3.01,
        catalog: quotedCatalog,
        approval: approvedLot,
        now: approvalTime,
    };
    expect(() => validateStudyApproval(request)).toThrow("exceeds its budget");
    expect(
        validateStudyApproval({ ...request, budgetPolicy: "stop_at_budget" }),
    ).toMatchObject({ budgetUsd: 3 });
});

test("prepare can retain an uncached estimate from exact historical request usage", async () => {
    const fixture = studyFixture();
    try {
        const selected = join(fixture.directory, "cases.json");
        const catalogPath = join(fixture.directory, "prices.json");
        writeFileSync(selected, JSON.stringify(["control:adobe-numeric"]));
        writeFileSync(catalogPath, JSON.stringify(quotedCatalog));
        const base = [
            "--study",
            fixture.path,
            "--cases",
            selected,
            "--catalog",
            catalogPath,
            "--models",
            "jev-1.14.0",
            "--prepare",
        ];
        await runStudyCli("choices", [...base, "--run", "first"]);
        const manifest = JSON.parse(
            readFileSync(
                join(fixture.directory, "runs/first/manifest.json"),
                "utf8",
            ),
        );
        const reference = join(fixture.directory, "usage.jsonl");
        const call = manifest.calls[0];
        writeFileSync(
            reference,
            [
                {
                    event: "started",
                    key: call.key,
                    requestHash: call.requestHash,
                },
                {
                    event: "result",
                    key: call.key,
                    response: {
                        model: call.model,
                        usage: {
                            prompt_tokens: 100,
                            completion_tokens: 50,
                            prompt_tokens_details: { cached_tokens: 100 },
                        },
                    },
                },
            ]
                .map((entry) => JSON.stringify(entry))
                .join("\n"),
        );
        await runStudyCli("choices", [
            ...base,
            "--run",
            "estimated",
            "--cost-reference",
            reference,
        ]);
        const quoted = JSON.parse(
            readFileSync(
                join(fixture.directory, "runs/estimated/manifest.json"),
                "utf8",
            ),
        );
        expect(quoted.indicativeUncachedUsd).toBeCloseTo(0.0000042, 12);
        expect(quoted.costReferenceSha256).toBe(
            digest(readFileSync(reference, "utf8")),
        );
        expect(quoted.maximumReservationUsd).toBeGreaterThan(
            quoted.indicativeUncachedUsd,
        );
    } finally {
        rmSync(fixture.directory, { recursive: true, force: true });
    }
}, 30_000);

test("an explicitly authorized zero-call lot needs no monetary reservation", () => {
    expect(
        validateStudyApproval({
            manifestSha256: "empty-lot",
            maximumAttempts: 0,
            maximumReservationUsd: 0,
            catalog: quotedCatalog,
            now: approvalTime,
            approval: {
                ...approvedLot,
                manifestSha256: "empty-lot",
                maximumAttempts: 0,
                budgetUsd: 0,
            },
        }),
    ).toMatchObject({ maximumAttempts: 0, budgetUsd: 0 });
});
