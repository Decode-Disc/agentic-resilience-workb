// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOURCE_COVERAGE_ROLES } from "@convex/domain/sourceSelectionPolicy";
import { expect, test, vi } from "vitest";

const { buildSourcesMissions, runSourcesApproachCli, verifySourcesStudy } =
    (await import(
        new URL(
            "../../../scripts/evaluations/source-selection/sources-approach-cli.ts",
            import.meta.url,
        ).href
    )) as typeof import("../../../scripts/evaluations/source-selection/sources-approach-cli");

test("the lot crosses both approaches and reasoning settings, balances order, and separates validation", () => {
    const scenarios = ["servicenow", "adobe", "snowflake"].map((id) => ({
        id,
        phase:
            id === "snowflake"
                ? ("validation" as const)
                : ("development" as const),
        company: { cik: "123", ticker: "ACME", legalName: "Acme" },
        asOfTime: 0,
        researchAngle: "terms",
        sources: [],
    }));
    const missions = buildSourcesMissions(scenarios, 2);
    expect(missions).toHaveLength(24);
    expect(new Set(missions.map((m) => m.missionId)).size).toBe(24);
    expect(
        missions.slice(0, 16).every((m) => m.scenarioId !== "snowflake"),
    ).toBe(true);
    for (const scenario of scenarios) {
        const rows = missions.filter((m) => m.scenarioId === scenario.id);
        expect(
            rows.slice(0, 4).map((m) => `${m.approach}.${m.reasoning}`),
        ).toEqual(
            rows
                .slice(4)
                .reverse()
                .map((m) => `${m.approach}.${m.reasoning}`),
        );
    }
});

test("prepare, offline replay and summary preserve four comparable missions without network I/O", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sources-approach-test-"));
    const out = join(dir, "run");
    const text =
        "Acme provides subscription services under this agreement. Customers pay the fees in their order form.";
    const source = {
        candidate: {
            sourceId: "source-1",
            title: "Acme subscription terms",
            canonicalUrl: "https://acme.example/legal/terms",
            origin: "exa",
            category: "captured",
            createdAt: 0,
        },
        text,
        contentHash: createHash("sha256").update(text).digest("hex"),
        knownGood: "ANSWER_KEY_SENTINEL",
    };
    const scenarios = [
        {
            id: "acme",
            phase: "development",
            company: {
                cik: "123",
                legalName: "Acme",
                ticker: "ACME",
                websiteUrl: "https://acme.example",
            },
            asOfTime: Date.UTC(2026, 9, 25),
            researchAngle: "Commercial terms",
            sources: [source],
            expected: "ANSWER_KEY_SENTINEL",
        },
    ];
    const scenarioFile = join(dir, "input.json");
    writeFileSync(scenarioFile, JSON.stringify(scenarios));
    const proposal = {
        companyMatch: "subject",
        companyPassageKeys: ["p0"],
        documentKind: "official_commercial_terms",
        reportingPeriodEnd: null,
        reportingPeriodPassageKeys: [],
        contributions: {
            ...Object.fromEntries(
                SOURCE_COVERAGE_ROLES.map((role) => [role, null]),
            ),
            official_commercial_terms: [
                {
                    summary:
                        "The customer pays the fees stated in its order form.",
                    relevance: "Documents commercial payment conditions.",
                    scope: "The order sets the amount; no public rate is established.",
                    kind: "asserted_fact",
                    period: "unspecified",
                    periodPassageKeys: [],
                    passageKeys: ["p0"],
                    dependsOnFlaggedAssertion: false,
                },
            ],
        },
        limitations: [],
    };
    const reply = (name?: string, args?: unknown) => ({
        response: {
            id: "simulated",
            created: 1,
            model: "fixture/model",
            choices: [
                {
                    index: 0,
                    finish_reason: name ? "tool_calls" : "stop",
                    message: name
                        ? {
                              role: "assistant",
                              content: null,
                              tool_calls: [
                                  {
                                      id: `call-${name}`,
                                      type: "function",
                                      function: {
                                          name,
                                          arguments: JSON.stringify(args),
                                      },
                                  },
                              ],
                          }
                        : {
                              role: "assistant",
                              content: JSON.stringify(proposal),
                          },
                },
            ],
            usage: {
                prompt_tokens: 100,
                completion_tokens: 50,
                total_tokens: 150,
                cost: 0,
            },
        },
    });
    const responses: Record<string, unknown> = {};
    for (const reasoning of ["off", "on"]) {
        responses[`acme.fixed.${reasoning}.1`] = [reply()];
        responses[`acme.agent.${reasoning}.1`] = [
            reply("mission_control", {}),
            reply("read_source", { sourceId: "source-1" }),
            reply("submit_qualification", { sourceId: "source-1", proposal }),
            reply("preview_selection", {}),
            reply("complete", {
                notes: "Simulated completion; no quality inference.",
            }),
        ];
    }
    const responsesFile = join(dir, "responses.json");
    writeFileSync(responsesFile, JSON.stringify(responses));
    const request = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("Unexpected network I/O"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
        await runSourcesApproachCli([
            "--prepare",
            "--out",
            out,
            "--scenarios",
            scenarioFile,
            "--repetitions",
            "1",
        ]);
        expect(verifySourcesStudy(process.cwd(), out).maximumAttempts).toBe(64);
        const focusedOut = join(dir, "fixed-off-run");
        await runSourcesApproachCli([
            "--prepare",
            "--out",
            focusedOut,
            "--scenarios",
            scenarioFile,
            "--repetitions",
            "1",
            "--approach",
            "fixed",
            "--reasoning",
            "off",
        ]);
        expect(verifySourcesStudy(process.cwd(), focusedOut).missions).toEqual([
            {
                missionId: "acme.fixed.off.1",
                scenarioId: "acme",
                approach: "fixed",
                reasoning: "off",
                repetition: 1,
            },
        ]);
        const cappedOut = join(dir, "capped-run");
        await runSourcesApproachCli([
            "--prepare",
            "--out",
            cappedOut,
            "--scenarios",
            scenarioFile,
            "--repetitions",
            "1",
            "--maximum-attempts",
            "60",
        ]);
        expect(
            verifySourcesStudy(process.cwd(), cappedOut).maximumAttempts,
        ).toBe(60);
        expect(readFileSync(join(out, "scenarios.json"), "utf8")).not.toContain(
            "ANSWER_KEY_SENTINEL",
        );
        await runSourcesApproachCli([
            "--offline",
            "--out",
            out,
            "--responses",
            responsesFile,
        ]);
        await runSourcesApproachCli([
            "--summarize",
            "--out",
            out,
            "--report",
            "rehearsal",
        ]);
        const results = readFileSync(join(out, "offline-results.jsonl"), "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        expect(results).toHaveLength(4);
        expect(
            results.every(
                (r) => r.status === "complete" && r.execution === "offline",
            ),
        ).toBe(true);
        expect(
            results[0].sources[0].qualification.findings[0].passages[0]
                .quotation,
        ).toContain("Customers pay");
        expect(
            readFileSync(join(out, "offline-calls.jsonl"), "utf8"),
        ).not.toContain("ANSWER_KEY_SENTINEL");
        expect(readFileSync(join(out, "rehearsal.md"), "utf8")).toContain(
            "Offline results are simulated",
        );
        expect(request).not.toHaveBeenCalled();
        await expect(
            runSourcesApproachCli([
                "--offline",
                "--out",
                out,
                "--responses",
                responsesFile,
            ]),
        ).rejects.toThrow("already has retained results");
        const callsPath = join(out, "offline-calls.jsonl");
        const firstMissionCalls = readFileSync(callsPath, "utf8")
            .trim()
            .split("\n")
            .filter(
                (line) => JSON.parse(line).missionId === results[0].missionId,
            )
            .join("\n");
        writeFileSync(
            join(out, "offline-results.jsonl"),
            `${JSON.stringify(results[0])}\n`,
        );
        writeFileSync(callsPath, `${firstMissionCalls}\n`);
        const firstStarted = firstMissionCalls
            .split("\n")
            .map((line) => JSON.parse(line))
            .find((entry) => entry.event === "started");
        writeFileSync(
            callsPath,
            `${firstMissionCalls}\n${JSON.stringify({ ...firstStarted, receipt: { ...firstStarted.receipt, id: "unresolved" } })}\n`,
        );
        await expect(
            runSourcesApproachCli([
                "--offline",
                "--continue",
                "--out",
                out,
                "--responses",
                responsesFile,
            ]),
        ).rejects.toThrow("Unresolved provider outcome");
        writeFileSync(callsPath, `${firstMissionCalls}\n`);
        await runSourcesApproachCli([
            "--offline",
            "--continue",
            "--out",
            out,
            "--responses",
            responsesFile,
        ]);
        const continued = readFileSync(
            join(out, "offline-results.jsonl"),
            "utf8",
        )
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        expect(continued).toHaveLength(4);
        expect(new Set(continued.map((r) => r.missionId)).size).toBe(4);
        expect(continued[0]).toEqual(results[0]);
        expect(
            readFileSync(callsPath, "utf8")
                .split("\n")
                .filter(
                    (line) =>
                        line &&
                        JSON.parse(line).missionId === results[0].missionId,
                )
                .join("\n"),
        ).toBe(firstMissionCalls);
        writeFileSync(join(out, "scenarios.json"), "[]");
        expect(() => verifySourcesStudy(process.cwd(), out)).toThrow(
            "Frozen corpus changed",
        );
    } finally {
        request.mockRestore();
        log.mockRestore();
        rmSync(dir, { recursive: true, force: true });
    }
});

test("inspection freeze preserves the baseline and creates only fixed/off and agent/off missions", async () => {
    const { freezeSourcesStudy } = await import(
        "../../../scripts/evaluations/source-selection/sources-approach-cli"
    );
    const { SourcesPreparation, sourcesDigest, inspectionScenarioHash } =
        await import(
            "../../../scripts/evaluations/source-selection/sources-approach-study"
        );
    const dir = mkdtempSync(join(tmpdir(), "sources-inspection-freeze-"));
    try {
        const text =
            "The company provides an API for customer workflow integrations.";
        const scenario = {
            id: "acme",
            phase: "development" as const,
            company: { cik: "123", ticker: "ACME", legalName: "Acme" },
            asOfTime: 0,
            researchAngle: "",
            sources: [
                {
                    candidate: {
                        sourceId: "api",
                        title: "API",
                        canonicalUrl: "https://acme.example/api",
                        origin: "exa" as const,
                        category: "captured",
                        createdAt: 0,
                    },
                    text,
                    contentHash: sourcesDigest(text),
                },
            ],
        };
        const p = new SourcesPreparation(scenario);
        p.readSource("api");
        p.submitQualification("api", {
            companyMatch: "uncertain",
            companyPassageKeys: [],
            documentKind: "unknown",
            reportingPeriodEnd: null,
            reportingPeriodPassageKeys: [],
            contributions: Object.fromEntries(
                SOURCE_COVERAGE_ROLES.map((role) => [role, null]),
            ),
            limitations: [],
        });
        expect(p.sources[0]?.qualificationStatus).toBe("qualified");
        const baseline = {
            scenarioHash: inspectionScenarioHash(scenario),
            sources: p.finish().sources,
        };
        const out = join(dir, "run");
        const manifest = freezeSourcesStudy({
            root: process.cwd(),
            out,
            scenarios: [scenario],
            repetitions: 2,
            catalog: null,
            inspection: {
                acme: {
                    baseline,
                    mandate: "Inspect the evidence for workflow integrations.",
                },
            },
        });
        expect(manifest.protocol).toBe("sources-inspection-v2");
        expect(manifest.missions.map((m) => [m.approach, m.reasoning])).toEqual(
            [
                ["fixed", "off"],
                ["agent", "off"],
                ["agent", "off"],
                ["fixed", "off"],
            ],
        );
        expect(manifest.maximumAttempts).toBe(48);
        expect(
            JSON.parse(
                readFileSync(join(out, "inspection-baselines.json"), "utf8"),
            ).acme.baseline,
        ).toEqual(baseline);
        verifySourcesStudy(process.cwd(), out);
        writeFileSync(join(out, "inspection-baselines.json"), "{}");
        expect(() => verifySourcesStudy(process.cwd(), out)).toThrow(
            "Inspection baseline changed",
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("live budget stopping preserves completed calls and settles each receipt before the next qualification", async () => {
    const { freezeSourcesStudy } = await import(
        "../../../scripts/evaluations/source-selection/sources-approach-cli"
    );
    const { sourcesDigest } = await import(
        "../../../scripts/evaluations/source-selection/sources-approach-study"
    );
    const dir = mkdtempSync(join(tmpdir(), "sources-budget-contract-"));
    const text = "Acme publishes this public document.";
    const scenarios = [
        {
            id: "acme",
            phase: "development" as const,
            company: { cik: "123", legalName: "Acme", ticker: "ACME" },
            asOfTime: 0,
            researchAngle: "",
            sources: [1, 2].map((index) => ({
                candidate: {
                    sourceId: `source-${index}`,
                    title: `Document ${index}`,
                    canonicalUrl: `https://acme.example/${index}`,
                    origin: "exa" as const,
                    category: "captured",
                    createdAt: 0,
                },
                text,
                contentHash: sourcesDigest(text),
            })),
        },
    ];
    const catalog = {
        observedAt: new Date().toISOString(),
        models: [
            {
                id: "fixture/model",
                provider: "fixture",
                inputPricePerToken: 0,
                outputPricePerToken: 0.000001,
                contextLength: 1000000,
                sourceUrl:
                    "https://openrouter.ai/api/v1/models/fixture/model/endpoints",
            },
        ],
    };
    let dispatches = 0;
    const request = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (url) => {
            if (String(url).endsWith("/endpoints"))
                return Response.json({
                    data: {
                        endpoints: [
                            {
                                provider_name: "fixture",
                                status: 0,
                                context_length: 1000000,
                                supported_parameters: [
                                    "tools",
                                    "structured_outputs",
                                    "reasoning",
                                ],
                                pricing: { prompt: 0, completion: 0.000001 },
                            },
                        ],
                    },
                });
            expect(String(url)).toBe(
                "https://openrouter.ai/api/v1/chat/completions",
            );
            dispatches++;
            return Response.json({
                id: `synthetic-${dispatches}`,
                model: "fixture/model",
                created: 0,
                choices: [
                    {
                        index: 0,
                        finish_reason: "stop",
                        message: {
                            role: "assistant",
                            content: JSON.stringify({
                                companyMatch: "uncertain",
                                companyPassageKeys: [],
                                documentKind: "unknown",
                                reportingPeriodEnd: null,
                                reportingPeriodPassageKeys: [],
                                contributions: Object.fromEntries(
                                    SOURCE_COVERAGE_ROLES.map((role) => [
                                        role,
                                        null,
                                    ]),
                                ),
                                limitations: [],
                            }),
                        },
                    },
                ],
                usage: {
                    prompt_tokens: 100,
                    completion_tokens: 50,
                    total_tokens: 150,
                    cost: 0.001,
                },
            });
        });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic-budget-test-key");
    try {
        for (const [budgetUsd, expectedCalls, status] of [
            [0.0175, 2, "complete"],
            [0.0165, 1, "partial"],
        ] as const) {
            dispatches = 0;
            const out = join(dir, `run-${expectedCalls}`);
            freezeSourcesStudy({
                root: process.cwd(),
                out,
                scenarios,
                repetitions: 1,
                approach: "fixed",
                reasoning: "off",
                maximumAttempts: 4,
                budgetPolicy: "stop_at_budget",
                catalog,
            });
            const authorization = join(dir, `approval-${expectedCalls}.json`);
            writeFileSync(
                authorization,
                JSON.stringify({
                    manifestSha256: sourcesDigest(
                        readFileSync(join(out, "manifest.json"), "utf8"),
                    ),
                    maximumAttempts: 4,
                    budgetUsd,
                    approvedAt: new Date().toISOString(),
                }),
            );
            await runSourcesApproachCli([
                "--live",
                "--out",
                out,
                "--authorization",
                authorization,
                "--phase",
                "development",
            ]);
            const result = JSON.parse(
                readFileSync(join(out, "live-results.jsonl"), "utf8").trim(),
            );
            expect(result.status).toBe(status);
            expect(dispatches).toBe(expectedCalls);
            expect(result.calls).toHaveLength(expectedCalls);
            if (status === "partial")
                expect(result.stopReason).toBe("budget_exhausted");
            const journal = readFileSync(join(out, "live-calls.jsonl"), "utf8");
            expect(journal).not.toContain("synthetic-budget-test-key");
            await runSourcesApproachCli([
                "--summarize",
                "--out",
                out,
                "--report",
                "budget-summary",
            ]);
            const summary = JSON.parse(
                readFileSync(join(out, "budget-summary.json"), "utf8"),
            );
            expect(summary.budget.authorizedBudgetsUsd).toEqual([
                { file: "authorization-development.json", budgetUsd },
            ]);
            expect(summary.budget.maximumReservationUsd).toBeGreaterThan(
                budgetUsd,
            );
        }
    } finally {
        request.mockRestore();
        log.mockRestore();
        vi.unstubAllEnvs();
        rmSync(dir, { recursive: true, force: true });
    }
}, 30_000);
