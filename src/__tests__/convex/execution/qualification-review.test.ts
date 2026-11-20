import assert from "node:assert/strict";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { internal } from "@convex/_generated/api";
import {
    type AnalysisReceipt,
    campaignManifestSchema,
    emptyCampaignLimits,
} from "@convex/qualificationCampaignPolicy";
import schema from "@convex/schema";
import {
    acquireCampaignLock,
    campaignReviewTemplate,
    runCampaign,
    runCampaignReviewStage,
} from "@evaluations/workbench-browser/campaign";
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName, makeFunctionReference } from "convex/server";
import type { Value } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import {
    qualificationReviewApiAnalysis,
    qualificationReviewPayload,
    qualificationReviewReport,
    qualificationReviewResponse,
    qualificationReviewRuntime,
} from "@/__tests__/setup/qualification-review";
import { configurableCampaign } from "@/__tests__/setup/qualification-v2";
import { createAdmittedPreflight } from "@/__tests__/setup/research-launch";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

const apiUsageCases = new Map<
    string,
    { usage: unknown; receipt?: Partial<AnalysisReceipt> }
>([
    ["api_usage_missing_input", { usage: { output_tokens: 100 } }],
    [
        "api_usage_negative_input",
        { usage: { input_tokens: -1, output_tokens: 100 } },
    ],
    ["api_usage_missing_output", { usage: { input_tokens: 100 } }],
    [
        "api_usage_cache_overflow",
        {
            usage: {
                input_tokens: 100,
                output_tokens: 100,
                input_tokens_details: {
                    cached_tokens: 80,
                    cache_write_tokens: 21,
                },
            },
        },
    ],
    [
        "api_usage_unpriced_cache",
        {
            usage: {
                input_tokens: 100,
                output_tokens: 100,
                input_tokens_details: {
                    cache_write_tokens: 10,
                    cache_write_tokens_details: { ttl_12h_tokens: 10 },
                },
            },
        },
    ],
    [
        "api_usage_zero_input",
        {
            usage: { input_tokens: 0, output_tokens: 100 },
            receipt: { input: 0, output: 100, costMicros: 60 },
        },
    ],
    [
        "api_usage_zero_output",
        {
            usage: { input_tokens: 100, output_tokens: 0 },
            receipt: { input: 100, output: 0, costMicros: 15 },
        },
    ],
    [
        "api_usage_all_cached",
        {
            usage: {
                input_tokens: 100,
                output_tokens: 100,
                input_tokens_details: { cached_tokens: 100 },
            },
            receipt: { input: 0, cacheRead: 100, output: 100, costMicros: 68 },
        },
    ],
]);

for (const { subscription, compaction, fault } of [
    { subscription: false, compaction: false, fault: "none" },
    { subscription: false, compaction: false, fault: "api" },
    { subscription: false, compaction: true, fault: "api" },
    { subscription: false, compaction: false, fault: "api_high" },
    { subscription: false, compaction: false, fault: "api_command" },
    ...[
        "api_401",
        "api_429",
        "api_budget_exhausted",
        "api_usage",
        "api_price",
        "api_settlement",
        "api_unknown",
        ...apiUsageCases.keys(),
    ].map(
        (fault) => ({ subscription: false, compaction: false, fault }) as const,
    ),
    { subscription: true, compaction: false, fault: "none" },
    { subscription: true, compaction: true, fault: "none" },
    { subscription: true, compaction: true, fault: "denied" },
    { subscription: true, compaction: true, fault: "unknown" },
    { subscription: true, compaction: true, fault: "settlement_ack" },
] as const)
    test(`Pi review reserves real campaign allowances before HTTP and command adopts only after reconciliation (subscription=${subscription}, compaction=${compaction}, fault=${fault})`, async () => {
        const api = fault.startsWith("api");
        const usageCase = apiUsageCases.get(fault);
        const high = fault === "api_high";
        const reuseBudget = fault === "api" && !compaction;
        const exhaustsBudget = fault === "api_budget_exhausted";
        const verifiedUsage =
            reuseBudget ||
            exhaustsBudget ||
            [
                "api_usage_unpriced_cache",
                "api_settlement",
                "api_unknown",
            ].includes(fault);
        const requestReservation = high ? 4000000 : 100000;
        const allowance =
            fault === "denied" ? 8 : compaction ? 12 : api ? 3 : 2;
        const reviewBudget = reuseBudget
            ? requestReservation + 148
            : exhaustsBudget
              ? requestReservation + 73
              : allowance * requestReservation;
        const t = convexTest(schema, import.meta.glob("/convex/**/*.ts"));
        const { preflightId } = await createAdmittedPreflight(t);
        await t.run(async (ctx) => {
            const preflight = await ctx.db.get(preflightId);
            assert(preflight?.ownerVisitorId);
            const visitor = await ctx.db.get(preflight.ownerVisitorId);
            assert(visitor);
            await ctx.db.patch(visitor.invitationId, { slotKey: "analyst-4" });
        });
        vi.stubEnv(
            "WORKBENCH_REVIEW_REASONING",
            subscription || high ? "high" : "off",
        );
        vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
        vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
        const manifest = campaignManifestSchema.parse({
            ...configurableCampaign(),
            version: 3,
            mode: "deterministic",
            batteryHash: "a".repeat(64),
            perLot: emptyCampaignLimits(),
            total: emptyCampaignLimits(),
            analysis: api
                ? {
                      ...qualificationReviewApiAnalysis(
                          high ? "gpt-6.1-sol" : "gpt-4o-mini",
                      ),
                      ...(verifiedUsage
                          ? { settlementPolicy: "verified_usage_v1" }
                          : {}),
                      perLot: {
                          requests: allowance,
                          costMicros: reviewBudget,
                      },
                      total: {
                          requests: allowance,
                          costMicros: reviewBudget,
                      },
                      timeoutMs: compaction ? 60000 : 10000,
                  }
                : {
                      scope: "evidence_review",
                      routes: [
                          {
                              provider: subscription
                                  ? "openai-codex"
                                  : "openai",
                              model: subscription
                                  ? "gpt-6.1-sol"
                                  : "gpt-4o-mini",
                          },
                      ],
                      ...(subscription
                          ? {
                                accounting: "native_subscription",
                                perLot: { requests: allowance },
                                total: { requests: allowance },
                            }
                          : {
                                maxRequestCostMicros: 100000,
                                perLot: { requests: 2, costMicros: 200000 },
                                total: { requests: 2, costMicros: 200000 },
                                maxOutputTokens: 1000,
                            }),
                      ...(compaction
                          ? {}
                          : { maxInputTokens: subscription ? 512 : 32000 }),
                      timeoutMs: compaction ? 60000 : 10000,
                  },
        });
        if (fault === "api_price") {
            assert(manifest.version === 3 && manifest.analysis.pricing);
            manifest.analysis.pricing.cost.output = 0.7;
        }
        const campaignId = await t.mutation(
            internal.qualificationCampaigns.authorize,
            { manifest },
        );
        const lotId = await t.mutation(internal.qualificationCampaigns.admit, {
            campaignId,
            key: "lot-1",
            candidateHash: "b".repeat(64),
            changedPaths: [],
        });
        await t.mutation(internal.qualificationCampaigns.beginCleanup, {
            lotId,
        });
        const root = mkdtempSync(join(tmpdir(), "pi-campaign-convex-"));
        const lotRoot = join(root, "lots", "lot-1");
        mkdirSync(lotRoot, { recursive: true });
        writeFileSync(
            join(root, "campaign.json"),
            JSON.stringify({ campaignId, manifest, fingerprints: {} }),
        );
        writeFileSync(
            join(lotRoot, "campaign-lot.json"),
            JSON.stringify({
                manifest,
                candidateHash: "b".repeat(64),
                fingerprints: {},
            }),
        );
        writeFileSync(
            join(lotRoot, "campaign-result.json"),
            JSON.stringify({ completed: true, cleanupCompleted: true }),
        );
        writeFileSync(
            join(lotRoot, "published.json"),
            "Synthetic evidence fixture: the framing was saved.".repeat(
                compaction ? 7000 : 1,
            ),
        );
        const template = campaignReviewTemplate(lotRoot);
        writeFileSync(
            join(lotRoot, "review-template.json"),
            JSON.stringify(template),
        );
        const review = {
            ...template,
            cases: template.cases.map((item) => ({
                ...item,
                checks: Object.fromEntries(
                    Object.keys(item.checks).map((key) => [key, "passed"]),
                ),
                finding:
                    "The synthetic fixture records the expected saved framing.",
                evidence: ["published.json"],
            })),
        };
        const client = new ConvexHttpClient("http://127.0.0.1:3210");
        let lastPurpose: string | undefined,
            lostAcknowledgement = false;
        vi.spyOn(client, "mutation").mockImplementation(async (...args) => {
            const result = await t.mutation(
                makeFunctionReference<"mutation", Record<string, Value>, Value>(
                    getFunctionName(args[0]),
                ),
                args[1] ?? {},
            );
            if (
                fault === "api_settlement" &&
                requests === 2 &&
                !lostAcknowledgement &&
                getFunctionName(args[0]) ===
                    getFunctionName(
                        internal.qualificationCampaigns.settleAnalysis,
                    )
            ) {
                lostAcknowledgement = true;
                throw new Error(
                    "Synthetic lost API settlement acknowledgement",
                );
            }
            if (
                fault === "settlement_ack" &&
                !lostAcknowledgement &&
                lastPurpose === "compaction" &&
                getFunctionName(args[0]) ===
                    getFunctionName(
                        internal.qualificationCampaigns.settleAnalysis,
                    )
            ) {
                lostAcknowledgement = true;
                throw new Error(
                    "Synthetic lost summary settlement acknowledgement",
                );
            }
            return result;
        });
        vi.spyOn(client, "query").mockImplementation((...args) =>
            t.query(
                makeFunctionReference<"query", Record<string, Value>, Value>(
                    getFunctionName(args[0]),
                ),
                args[1] ?? {},
            ),
        );
        let requests = 0,
            investigations = 0,
            summaries = 0,
            largestInputBytes = 0;
        const expectedInput = new Map<number, number>();
        const emittedOutputs: unknown[] = [];
        const draft =
            "# Findings\n\nThe saved framing matches the captured evidence; investigation can continue.";
        const checkpoint =
            "Native checkpoint: evidence inspected; preserve the saved framing finding.";
        const transport = {
            kind: "mock-openai" as const,
            fetch: async (
                _input: Parameters<typeof fetch>[0],
                init?: RequestInit,
                phase?: string,
            ) => {
                if (api) {
                    const started = readFileSync(
                        join(lotRoot, "progress.jsonl"),
                        "utf8",
                    )
                        .trim()
                        .split("\n")
                        .map((line) => JSON.parse(line))
                        .filter((entry) => entry.event === "analysis_started")
                        .at(-1);
                    assert(started);
                    phase = started.purpose;
                    expect(String(_input)).toContain("api.openai.com");
                    expect(
                        new Headers(init?.headers).get("authorization"),
                    ).toBe("Bearer sk-synthetic-offline-qualification-key");
                }
                lastPurpose = phase;
                requests++;
                const lot = await t.run((ctx) => ctx.db.get(lotId));
                expect(lot?.analysisAllocated).toEqual({
                    requests,
                    costMicros: subscription
                        ? 0
                        : verifiedUsage
                          ? requestReservation + (requests - 1) * 74
                          : requests * requestReservation,
                });
                const body = await qualificationReviewPayload(init);
                if (api) {
                    expect(body.service_tier).toBe("default");
                    expect(JSON.stringify(body)).not.toContain("sk-synthetic");
                    if (fault === "api_401" || fault === "api_429")
                        return new Response(
                            JSON.stringify({
                                error: {
                                    message: "Synthetic provider rejection",
                                },
                            }),
                            {
                                status: fault === "api_401" ? 401 : 429,
                                headers: { "content-type": "application/json" },
                            },
                        );
                    if (fault === "api_unknown")
                        throw new Error("Synthetic connection lost");
                    if (usageCase)
                        return qualificationReviewResponse(
                            qualificationReviewReport(review),
                            requests,
                            null,
                            usageCase.usage,
                        );
                    if (fault === "api_usage")
                        return qualificationReviewResponse(
                            draft,
                            requests,
                            null,
                            {
                                input_tokens: 0,
                                output_tokens: 0,
                                input_tokens_details: { cached_tokens: 0 },
                            },
                        );
                }
                if (high) {
                    expect(body.reasoning).toMatchObject({ effort: "medium" });
                    assert(Array.isArray(body.input));
                    expect(body.input.at(-1)).toEqual({
                        type: "configuration_update",
                        reasoning: { effort: "high" },
                    });
                } else if (subscription)
                    expect(body.reasoning).toMatchObject({ effort: "high" });
                emittedOutputs.push(body.max_output_tokens);
                expect(body.max_output_tokens).toBe(
                    subscription ? undefined : high ? 128000 : 1000,
                );
                largestInputBytes = Math.max(
                    largestInputBytes,
                    Buffer.byteLength(JSON.stringify(body.input)),
                );
                expectedInput.set(requests, 100);
                if (compaction && phase === "compaction") {
                    summaries++;
                    if (fault === "unknown")
                        throw new Error("Synthetic summary connection lost");
                    return qualificationReviewResponse(checkpoint, requests);
                }
                investigations++;
                if (compaction) {
                    if (investigations === 1)
                        return qualificationReviewResponse(
                            draft,
                            requests,
                            null,
                        );
                    if (investigations <= 7)
                        return qualificationReviewResponse("", requests, {
                            name: "read",
                            arguments: {
                                path: "published.json",
                                offset: 1 + (investigations - 2) * 51200,
                                limit: 51200,
                            },
                        });
                    if (investigations === 8) {
                        const model = modelRuntime.getModel(
                            subscription ? "openai-codex" : "openai",
                            subscription ? "gpt-6.1-sol" : "gpt-4o-mini",
                        );
                        assert(model);
                        const input = model.contextWindow - 1000;
                        expectedInput.set(requests, input);
                        return qualificationReviewResponse(
                            draft,
                            requests,
                            undefined,
                            {
                                input_tokens: input,
                                output_tokens: 100,
                                input_tokens_details: { cached_tokens: 0 },
                            },
                        );
                    }
                    expect(summaries).toBeGreaterThan(0);
                    expect(JSON.stringify(body.input)).toContain(checkpoint);
                    expect(
                        JSON.stringify(body.instructions ?? body.input),
                    ).toContain(template.evidenceHash);
                    expect(
                        readFileSync(
                            join(lotRoot, "automated-review-report.md"),
                            "utf8",
                        ),
                    ).toBe(draft);
                }
                if (requests === 2 && !compaction)
                    expect(JSON.stringify(body.input)).toContain(
                        "Synthetic evidence fixture",
                    );
                if (api && !compaction && requests === 2)
                    return qualificationReviewResponse(
                        "",
                        requests,
                        {
                            name: "write",
                            arguments: {
                                path: "automated-review-report.md",
                                content: draft,
                            },
                        },
                        {
                            input_tokens: 100,
                            output_tokens: 100,
                            input_tokens_details: { cached_tokens: 20 },
                            output_tokens_details: { reasoning_tokens: 40 },
                        },
                    );
                return qualificationReviewResponse(
                    qualificationReviewReport(review),
                    requests,
                    undefined,
                    {
                        input_tokens: 100,
                        output_tokens: 100,
                        input_tokens_details: { cached_tokens: api ? 20 : 0 },
                        output_tokens_details: { reasoning_tokens: 40 },
                    },
                );
            },
        };
        const { runAccountableCampaignReview } = await import(
            "@evaluations/workbench-browser/campaign-review"
        );
        const modelRuntime = await qualificationReviewRuntime(
            subscription ? "openai-codex" : api ? "both" : "openai",
        );
        let httpError: unknown;
        if (api)
            vi.spyOn(globalThis, "fetch").mockImplementation(
                async (input, init) => {
                    try {
                        return await transport.fetch(input, init);
                    } catch (error) {
                        httpError = error;
                        throw error;
                    }
                },
            );
        const stageOptions = {
            root: lotRoot,
            evidenceHash: template.evidenceHash,
            reconciled: false,
            review: (evidenceRoot) =>
                runAccountableCampaignReview({
                    root: lotRoot,
                    evidenceRoot,
                    template,
                    manifest,
                    campaignId,
                    lotId,
                    client,
                    modelRuntime,
                    ...(api ? {} : { transport }),
                }),
            assess: async () =>
                assert.fail("No assessment before reconciliation"),
        } satisfies Parameters<typeof runCampaignReviewStage>[0];
        if (fault === "api_command") {
            await t.mutation(internal.qualificationCampaigns.reconcile, {
                lotId,
                cleanupCompleted: true,
            });
            let archived = 0;
            const boundaries = {
                modelRuntime,
                lock: () => acquireCampaignLock(join(root, "fixture.lock")),
                connect: async () => ({
                    client,
                    origins: {
                        convex: "http://127.0.0.1:3210",
                        site: "http://127.0.0.1:3211",
                    },
                }),
                archive: () => {
                    archived++;
                },
            };
            const exitCode = process.exitCode;
            try {
                await runCampaign("run", root, {}, undefined, boundaries);
                if (httpError) throw httpError;
                expect((await t.run((ctx) => ctx.db.get(lotId)))?.status).toBe(
                    "finished",
                );
                expect(
                    existsSync(
                        join(
                            lotRoot,
                            `automated-review-evidence-${template.evidenceHash}`,
                        ),
                    ),
                ).toBe(true);
                expect(
                    JSON.parse(
                        readFileSync(
                            join(lotRoot, "automated-review-result.json"),
                            "utf8",
                        ),
                    ),
                ).toMatchObject({ evidenceHash: template.evidenceHash });
                expect(
                    JSON.parse(
                        readFileSync(
                            join(lotRoot, "automated-review-assessment.json"),
                            "utf8",
                        ),
                    ),
                ).toMatchObject({ verdict: "passed" });
                const completed = requests;
                expect(completed).toBe(3);
                await runCampaign("close", root, {}, undefined, boundaries);
                expect(requests).toBe(completed);
                expect(archived).toBe(1);
                expect(
                    vi
                        .mocked(client.mutation)
                        .mock.calls.filter(
                            ([ref]) =>
                                getFunctionName(ref) ===
                                getFunctionName(
                                    internal.qualificationCampaigns.assess,
                                ),
                        ),
                ).toHaveLength(1);
                expect(
                    (await t.run((ctx) => ctx.db.get(campaignId)))?.status,
                ).toBe("closed");
            } finally {
                process.exitCode = exitCode;
            }
            return;
        }
        let stage = await runCampaignReviewStage(stageOptions);
        if (httpError && fault !== "api_unknown") throw httpError;
        if (usageCase?.receipt) {
            expect(stage.status).toBe("awaiting_reconciliation");
            expect(requests).toBe(1);
            const [attempt] = await t.run((ctx) =>
                ctx.db.query("qualificationAnalysisAttempts").collect(),
            );
            expect(attempt).toMatchObject({
                status: "settled",
                receipt: { costBasis: "sdk_estimate", ...usageCase.receipt },
            });
            return;
        }
        if (api && fault !== "api" && fault !== "api_high") {
            expect(stage).toMatchObject({
                status: "pending",
                reason:
                    fault === "api_price"
                        ? "model_pricing_changed"
                        : fault === "api_401"
                          ? "provider_authentication_failed"
                          : fault === "api_429"
                            ? "provider_rate_limited"
                            : exhaustsBudget
                              ? "analysis_reservation_unavailable"
                              : fault === "api_usage" ||
                                  usageCase !== undefined ||
                                  fault === "api_settlement"
                                ? "analysis_settlement_unconfirmed"
                                : "unknown_dispatch_outcome",
            });
            const before = requests;
            expect(before).toBe(
                fault === "api_price" ? 0 : fault === "api_settlement" ? 2 : 1,
            );
            let attempts = await t.run((ctx) =>
                ctx.db.query("qualificationAnalysisAttempts").collect(),
            );
            expect(attempts).toHaveLength(before);
            if (usageCase) {
                expect(
                    vi
                        .mocked(client.mutation)
                        .mock.calls.filter(
                            ([ref]) =>
                                getFunctionName(ref) ===
                                getFunctionName(
                                    internal.qualificationCampaigns
                                        .settleAnalysis,
                                ),
                        ),
                ).toHaveLength(0);
                expect(
                    existsSync(join(lotRoot, "automated-review-result.json")),
                ).toBe(false);
                expect(
                    readFileSync(
                        join(lotRoot, "automated-review-report.md"),
                        "utf8",
                    ),
                ).toContain("Synthetic diagnostic handoff");
            }
            expect(
                attempts.filter((attempt) => attempt.status === "reserved"),
            ).toHaveLength(
                fault === "api_price" ||
                    exhaustsBudget ||
                    fault === "api_settlement"
                    ? 0
                    : 1,
            );
            if (fault === "api_settlement") {
                expect(
                    readFileSync(
                        join(lotRoot, "automated-review-report.md"),
                        "utf8",
                    ),
                ).toBe(draft);
                const pinPath = join(lotRoot, "automated-review-mission.json");
                const pin = JSON.parse(readFileSync(pinPath, "utf8"));
                pin.deadlineAt = Date.now() - 1;
                writeFileSync(pinPath, JSON.stringify(pin));
                await modelRuntime.removeRuntimeApiKey("openai");
                vi.stubEnv("OPENAI_API_KEY", "");
            }
            stage = await runCampaignReviewStage(stageOptions);
            expect(stage.status).toBe("pending");
            expect(requests).toBe(before);
            attempts = await t.run((ctx) =>
                ctx.db.query("qualificationAnalysisAttempts").collect(),
            );
            if (fault === "api_settlement") {
                expect(
                    attempts.every(
                        (attempt) =>
                            attempt.status === "settled" &&
                            attempt.receipt?.costBasis === "sdk_estimate",
                    ),
                ).toBe(true);
                expect(stage).toMatchObject({
                    reason: "provider_login_required",
                });
                expect(
                    (await t.run((ctx) => ctx.db.get(lotId)))
                        ?.analysisAllocated,
                ).toEqual({ requests: 2, costMicros: 148 });
            }
            expect((await t.run((ctx) => ctx.db.get(lotId)))?.status).toBe(
                "closing",
            );
            return;
        }
        if (fault !== "none" && fault !== "api" && fault !== "api_high") {
            expect(stage).toMatchObject({
                status: "pending",
                reason:
                    fault === "denied"
                        ? "analysis_reservation_unavailable"
                        : fault === "unknown"
                          ? "unknown_dispatch_outcome"
                          : "analysis_settlement_unconfirmed",
            });
            expect(
                readFileSync(
                    join(lotRoot, "automated-review-report.md"),
                    "utf8",
                ),
            ).toBe(draft);
            const before = requests;
            const attempts = await t.run((ctx) =>
                ctx.db
                    .query("qualificationAnalysisAttempts")
                    .withIndex("by_lot_and_attempt", (q) =>
                        q.eq("lotId", lotId),
                    )
                    .take(allowance + 1),
            );
            expect(attempts).toHaveLength(before);
            expect(
                attempts.filter((attempt) => attempt.status === "reserved"),
            ).toHaveLength(fault === "unknown" ? 1 : 0);
            expect((await t.run((ctx) => ctx.db.get(lotId)))?.status).toBe(
                "closing",
            );
            stage = await runCampaignReviewStage(stageOptions);
            if (fault === "denied" || fault === "unknown") {
                expect(stage.status).toBe("pending");
                expect(requests).toBe(before);
                expect(investigations).toBe(8);
                expect(summaries).toBe(fault === "unknown" ? 1 : 0);
                return;
            }
            expect(lostAcknowledgement).toBe(true);
        }
        if (compaction) {
            if (api) expect(summaries).toBeGreaterThan(0);
            else expect(summaries).toBe(2);
            expect(investigations).toBe(9);
            expect(largestInputBytes).toBeGreaterThan(256 * 1024);
        }
        expect(stage.status, JSON.stringify({ stage, emittedOutputs })).toBe(
            "awaiting_reconciliation",
        );
        const completedRequests = requests;
        const intents = readFileSync(join(lotRoot, "progress.jsonl"), "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
            .filter((entry) => entry.event === "analysis_started");
        expect(intents).toHaveLength(completedRequests);
        expect(
            intents.filter((entry) => entry.purpose === "compaction"),
        ).toHaveLength(summaries);
        expect(
            readFileSync(join(lotRoot, "automated-review-report.md"), "utf8"),
        ).toContain("saved framing");
        expect(
            JSON.parse(
                readFileSync(
                    join(lotRoot, "automated-review-report.json"),
                    "utf8",
                ),
            ),
        ).toMatchObject({
            evidenceHash: template.evidenceHash,
            assessment: "pending",
        });
        expect(
            JSON.parse(
                readFileSync(
                    join(lotRoot, "automated-review-mission.json"),
                    "utf8",
                ),
            ),
        ).toMatchObject({
            protocol: "investigator_v2",
            resourcePolicy: "authority_native_v1",
            evidenceHash: template.evidenceHash,
            mission: expect.stringContaining("source-supported"),
            missionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        });
        const missionPath = join(lotRoot, "automated-review-mission.json");
        const pinnedMission = readFileSync(missionPath);
        unlinkSync(missionPath);
        const legacy = await runAccountableCampaignReview({
            root: lotRoot,
            evidenceRoot: join(
                lotRoot,
                `automated-review-evidence-${template.evidenceHash}`,
            ),
            template,
            manifest,
            campaignId,
            lotId,
            client,
            modelRuntime,
            transport,
        });
        expect(legacy).toMatchObject({
            status: "pending",
            reason: "legacy_review_protocol_unavailable",
        });
        expect(requests).toBe(completedRequests);
        writeFileSync(missionPath, pinnedMission, { flag: "wx" });
        expect((await t.run((ctx) => ctx.db.get(lotId)))?.status).toBe(
            "closing",
        );
        expect(
            await t.mutation(internal.qualificationCampaigns.reconcile, {
                lotId,
                cleanupCompleted: true,
            }),
        ).toMatchObject({ reconciled: true });
        const exitCode = process.exitCode;
        try {
            let archived = 0;
            const boundaries = {
                lock: () => acquireCampaignLock(join(root, "fixture.lock")),
                connect: async () => ({
                    client,
                    origins: {
                        convex: "http://127.0.0.1:3210",
                        site: "http://127.0.0.1:3211",
                    },
                }),
                archive: () => {
                    archived++;
                },
            };
            await runCampaign("run", root, {}, undefined, boundaries);
            await runCampaign("close", root, {}, undefined, boundaries);
            const lot = await t.run((ctx) => ctx.db.get(lotId));
            const campaign = await t.run((ctx) => ctx.db.get(campaignId));
            const attempts = await t.run((ctx) =>
                ctx.db
                    .query("qualificationAnalysisAttempts")
                    .withIndex("by_lot_and_attempt", (q) =>
                        q.eq("lotId", lotId),
                    )
                    .take(allowance + 1),
            );
            const analysisAllocated = {
                requests: completedRequests,
                costMicros: subscription
                    ? 0
                    : reuseBudget
                      ? 222
                      : completedRequests * requestReservation,
            };
            expect(lot).toMatchObject({
                status: "finished",
                verdict: "passed",
                analysisAllocated,
            });
            expect(campaign).toMatchObject({
                status: "closed",
                analysisAllocated,
            });
            expect(attempts).toHaveLength(completedRequests);
            if (api && !compaction)
                for (const attempt of attempts) {
                    expect(attempt).toMatchObject({
                        status: "settled",
                        costMicros: high ? 1162 : 74,
                        receipt: {
                            accounting: "api_cost",
                            costBasis: "sdk_estimate",
                            input: 80,
                            output: 100,
                            cacheRead: 20,
                            cacheWrite: 0,
                        },
                    });
                    expect(attempt.receipt?.costUsd).toBeCloseTo(
                        high ? 0.001162 : 0.0000735,
                        12,
                    );
                }
            expect(
                attempts.every(
                    (attempt) =>
                        attempt.status === "settled" &&
                        (subscription
                            ? attempt.costMicros === undefined &&
                              attempt.receipt?.accounting ===
                                  "native_subscription" &&
                              attempt.receipt.input ===
                                  expectedInput.get(
                                      Number(
                                          attempt.attemptKey.split("-").at(-1),
                                      ),
                                  ) &&
                              attempt.receipt.output === 100
                            : api
                              ? (attempt.costMicros ?? 0) > 0 &&
                                attempt.receipt?.costBasis === "sdk_estimate"
                              : attempt.costMicros === 0),
                ),
            ).toBe(true);
            expect(requests).toBe(completedRequests);
            expect(archived).toBe(1);
            expect(
                JSON.parse(
                    readFileSync(
                        join(lotRoot, "automated-review-report.json"),
                        "utf8",
                    ),
                ),
            ).toMatchObject({ assessment: "assessed", verdict: "passed" });
            const logged = vi
                .spyOn(console, "log")
                .mockImplementation(() => {});
            await runCampaign("status", root, {}, undefined, boundaries);
            const status = JSON.parse(logged.mock.calls.at(-1)?.[0] ?? "{}");
            expect(status.diagnosticReports[0]).toMatchObject({
                lot: "lot-1",
                path: join(lotRoot, "automated-review-report.md"),
                assessment: "assessed",
                summary:
                    "The synthetic fixture records the expected saved framing.",
            });
            expect(requests).toBe(completedRequests);
            expect(
                JSON.parse(
                    readFileSync(
                        join(lotRoot, `assessment-${lot?.assessmentHash}.json`),
                        "utf8",
                    ),
                ),
            ).toMatchObject({ reviewer: "automated", verdict: "passed" });
        } finally {
            process.exitCode = exitCode;
        }
    }, 60000);

async function createDiagnosticReviewHarness(options: {
    timeoutMs?: number;
    fetchImpl: (
        input: Parameters<typeof fetch>[0],
        init?: RequestInit,
    ) => Promise<Response>;
}) {
    const t = convexTest(schema, import.meta.glob("/convex/**/*.ts"));
    const { preflightId } = await createAdmittedPreflight(t);
    await t.run(async (ctx) => {
        const preflight = await ctx.db.get(preflightId);
        assert(preflight?.ownerVisitorId);
        const visitor = await ctx.db.get(preflight.ownerVisitorId);
        assert(visitor);
        await ctx.db.patch(visitor.invitationId, { slotKey: "analyst-4" });
    });
    vi.stubEnv("WORKBENCH_REVIEW_REASONING", "off");
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    const manifest = campaignManifestSchema.parse({
        ...configurableCampaign(),
        version: 3,
        mode: "deterministic",
        batteryHash: "a".repeat(64),
        perLot: emptyCampaignLimits(),
        total: emptyCampaignLimits(),
        analysis: {
            ...qualificationReviewApiAnalysis("gpt-4o-mini"),
            settlementPolicy: "verified_usage_v1",
            perLot: { requests: 3, costMicros: 300000 },
            total: { requests: 3, costMicros: 300000 },
            timeoutMs: options.timeoutMs ?? 10000,
        },
    });
    const campaignId = await t.mutation(
        internal.qualificationCampaigns.authorize,
        { manifest },
    );
    const lotId = await t.mutation(internal.qualificationCampaigns.admit, {
        campaignId,
        key: "lot-1",
        candidateHash: "b".repeat(64),
        changedPaths: [],
    });
    await t.mutation(internal.qualificationCampaigns.beginCleanup, { lotId });
    const root = mkdtempSync(join(tmpdir(), "pi-campaign-diag-"));
    const lotRoot = join(root, "lots", "lot-1");
    mkdirSync(lotRoot, { recursive: true });
    writeFileSync(
        join(root, "campaign.json"),
        JSON.stringify({ campaignId, manifest, fingerprints: {} }),
    );
    writeFileSync(
        join(lotRoot, "campaign-lot.json"),
        JSON.stringify({
            manifest,
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(
        join(lotRoot, "campaign-result.json"),
        JSON.stringify({ completed: true, cleanupCompleted: true }),
    );
    writeFileSync(
        join(lotRoot, "published.json"),
        "Synthetic evidence fixture: the framing was saved.",
    );
    const template = campaignReviewTemplate(lotRoot);
    writeFileSync(
        join(lotRoot, "review-template.json"),
        JSON.stringify(template),
    );
    const client = new ConvexHttpClient("http://127.0.0.1:3210");
    vi.spyOn(client, "mutation").mockImplementation((...args) =>
        t.mutation(
            makeFunctionReference<"mutation", Record<string, Value>, Value>(
                getFunctionName(args[0]),
            ),
            args[1] ?? {},
        ),
    );
    vi.spyOn(client, "query").mockImplementation((...args) =>
        t.query(
            makeFunctionReference<"query", Record<string, Value>, Value>(
                getFunctionName(args[0]),
            ),
            args[1] ?? {},
        ),
    );
    const modelRuntime = await qualificationReviewRuntime("openai");
    const { runAccountableCampaignReview } = await import(
        "@evaluations/workbench-browser/campaign-review"
    );
    const stageOptions = {
        root: lotRoot,
        evidenceHash: template.evidenceHash,
        reconciled: false,
        review: (evidenceRoot: string) =>
            runAccountableCampaignReview({
                root: lotRoot,
                evidenceRoot,
                template,
                manifest,
                campaignId,
                lotId,
                client,
                modelRuntime,
                transport: {
                    kind: "mock-openai" as const,
                    fetch: (input, init) => options.fetchImpl(input, init),
                },
            }),
        assess: async () =>
            assert.fail("No assessment on failed review dispatch"),
    };
    return { t, lotId, lotRoot, template, stageOptions };
}

test("automated review retains sanitized dispatch, mid-stream SSE, and HTTP 5xx diagnostics while blocking redispatch", async () => {
    const { lotRoot, template, stageOptions } =
        await createDiagnosticReviewHarness({
            fetchImpl: async () => {
                throw new Error(
                    "connect ECONNRESET https://api.openai.com/v1/responses?secret=1 Bearer sk-synthetic-offline-qualification-key",
                );
            },
        });
    const dispatchFailure = await runCampaignReviewStage(stageOptions);
    expect(dispatchFailure).toMatchObject({
        status: "pending",
        reason: "unknown_dispatch_outcome",
        diagnostic: {
            attempt: 1,
            purpose: "investigation",
            phase: "request_dispatch",
            bytesRead: 0,
            chunksRead: 0,
            stopReason: "error",
            transportError: {
                name: "Error",
                causeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            },
        },
    });
    const persisted = JSON.parse(
        readFileSync(join(lotRoot, "automated-review-status.json"), "utf8"),
    );
    expect(persisted).toEqual(dispatchFailure);
    const serialized = JSON.stringify(persisted);
    expect(serialized).not.toContain("sk-synthetic-offline-qualification-key");
    expect(serialized).not.toContain("api.openai.com");
    expect(serialized).toContain("[redacted]");
    expect(
        existsSync(
            join(
                lotRoot,
                `automated-review-response-analysis-${template.evidenceHash.slice(0, 16)}-1.json`,
            ),
        ),
    ).toBe(false);

    // Mid-stream SSE drop after 200 headers: retain partial SSE metadata without reasoning/secrets or response cache file.
    let streamAttempts = 0;
    const streamDrop = await createDiagnosticReviewHarness({
        fetchImpl: async () => {
            streamAttempts++;
            const encoder = new TextEncoder();
            let pulls = 0;
            const stream = new ReadableStream<Uint8Array>({
                pull(controller) {
                    pulls++;
                    if (pulls === 1) {
                        controller.enqueue(
                            encoder.encode(
                                [
                                    'data: {"type":"response.created","response":{"id":"resp-midstream-30","status":"in_progress"}}',
                                    "",
                                    'data: {"type":"response.reasoning.encrypted","encrypted_content":"DO_NOT_COPY_ENCRYPTED_REASONING"}',
                                    "",
                                    'data: {"type":"response.failed","response":{"id":"resp-midstream-30","status":"failed","error":{"type":"server_error","code":"stream_reset","message":"Upstream reset Bearer sk-secret123"}}}',
                                    "",
                                    "",
                                ].join("\n"),
                            ),
                        );
                        return;
                    }
                    controller.error(
                        new Error(
                            "Premature close Bearer sk-secret456 token=leak",
                        ),
                    );
                },
            });
            return new Response(stream, {
                status: 200,
                headers: {
                    "content-type": "text/event-stream; charset=utf-8",
                    "x-request-id": "req-openai-midstream-30",
                },
            });
        },
    });
    const streamResult = await runCampaignReviewStage(streamDrop.stageOptions);
    expect(streamResult).toMatchObject({
        status: "pending",
        reason: "unknown_dispatch_outcome",
        diagnostic: {
            attempt: 1,
            purpose: "investigation",
            phase: "stream_read",
            httpStatus: 200,
            requestId: "req-openai-midstream-30",
            stopReason: "error",
            transportError: {
                name: "Error",
                causeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            },
            sseSummary: {
                lastEventType: "response.failed",
                responseId: "resp-midstream-30",
                responseStatus: "failed",
                completedUsageSeen: false,
                providerError: {
                    type: "server_error",
                    code: "stream_reset",
                    message: "Upstream reset Bearer [redacted]",
                },
            },
        },
    });
    const streamSerialized = readFileSync(
        join(streamDrop.lotRoot, "automated-review-status.json"),
        "utf8",
    );
    expect(streamSerialized).not.toContain("DO_NOT_COPY_ENCRYPTED_REASONING");
    expect(streamSerialized).not.toContain("sk-secret123");
    expect(streamSerialized).not.toContain("sk-secret456");
    expect(streamSerialized).not.toContain("token=leak");
    expect(
        existsSync(
            join(
                streamDrop.lotRoot,
                `automated-review-response-analysis-${streamDrop.template.evidenceHash.slice(0, 16)}-1.json`,
            ),
        ),
    ).toBe(false);
    // Re-running after unknown outcome must block redispatch without issuing another HTTP request.
    await runCampaignReviewStage(streamDrop.stageOptions);
    expect(streamAttempts).toBe(1);

    // HTTP 502 response retains httpStatus and sanitized providerMessage alongside unknown_dispatch_outcome.
    const badGateway = await createDiagnosticReviewHarness({
        fetchImpl: async () =>
            new Response(
                JSON.stringify({
                    error: {
                        message:
                            "Bad gateway from https://api.openai.com/v1/responses Bearer sk-secret789",
                    },
                }),
                {
                    status: 502,
                    headers: {
                        "content-type": "application/json",
                        "x-request-id": "req-openai-502",
                    },
                },
            ),
    });
    const badGatewayResult = await runCampaignReviewStage(
        badGateway.stageOptions,
    );
    expect(badGatewayResult).toMatchObject({
        status: "pending",
        reason: "unknown_dispatch_outcome",
        diagnostic: {
            attempt: 1,
            purpose: "investigation",
            phase: "response_persist",
            httpStatus: 502,
            requestId: "req-openai-502",
            stopReason: "error",
        },
    });
    const badGatewaySerialized = readFileSync(
        join(badGateway.lotRoot, "automated-review-status.json"),
        "utf8",
    );
    expect(badGatewaySerialized).not.toContain("sk-secret789");
    expect(badGatewaySerialized).not.toContain("api.openai.com");
});

test("automated review preserves execution_deadline when timeout aborts an in-flight call", async () => {
    const { lotRoot, stageOptions } = await createDiagnosticReviewHarness({
        timeoutMs: 300,
        fetchImpl: (_input, init) =>
            new Promise<Response>((_resolve, reject) => {
                const abort = () =>
                    reject(
                        Object.assign(new Error("The operation was aborted"), {
                            name: "AbortError",
                        }),
                    );
                if (init?.signal?.aborted) {
                    abort();
                    return;
                }
                init?.signal?.addEventListener("abort", abort, { once: true });
            }),
    });
    const result = await runCampaignReviewStage(stageOptions);
    expect(result).toMatchObject({
        status: "pending",
        reason: "execution_deadline",
        diagnostic: {
            attempt: 1,
            purpose: "investigation",
            stopReason: "aborted",
        },
    });
    expect(
        JSON.parse(
            readFileSync(join(lotRoot, "automated-review-status.json"), "utf8"),
        ),
    ).toMatchObject({
        status: "pending",
        reason: "execution_deadline",
    });
});

test("automated review completes, settles, and replays SSE responses exceeding 1 MiB", async () => {
    let requests = 0;
    let largeAttemptHash = "";
    const { t, lotId, lotRoot, template, stageOptions } =
        await createDiagnosticReviewHarness({
            fetchImpl: async () => {
                requests++;
                const reviewPayload = {
                    ...template,
                    cases: template.cases.map((item) => ({
                        ...item,
                        checks: Object.fromEntries(
                            Object.keys(item.checks).map((key) => [
                                key,
                                "passed",
                            ]),
                        ),
                        finding:
                            "The synthetic fixture records the expected saved framing.",
                        evidence: ["published.json"],
                    })),
                };
                if (requests === 1) {
                    const largeEncryptedReasoning = "R".repeat(1_250_000);
                    const toolCallItem = {
                        id: "fc-large-1",
                        type: "function_call",
                        call_id: "call-large-1",
                        name: "read",
                        arguments: JSON.stringify({ path: "published.json" }),
                        status: "completed",
                    };
                    const reasoningItem = {
                        id: "rs-large-1",
                        type: "reasoning",
                        summary: [{ type: "summary_text", text: "Checked." }],
                        encrypted_content: largeEncryptedReasoning,
                        status: "completed",
                    };
                    const sseEvents = [
                        {
                            type: "response.created",
                            response: { id: "resp-large-1" },
                        },
                        {
                            type: "response.output_item.added",
                            output_index: 0,
                            item: {
                                id: "rs-large-1",
                                type: "reasoning",
                                summary: [],
                            },
                        },
                        {
                            type: "response.output_item.done",
                            output_index: 0,
                            item: reasoningItem,
                        },
                        {
                            type: "response.output_item.added",
                            output_index: 1,
                            item: { ...toolCallItem, arguments: "" },
                        },
                        {
                            type: "response.function_call_arguments.delta",
                            item_id: "fc-large-1",
                            output_index: 1,
                            delta: toolCallItem.arguments,
                        },
                        {
                            type: "response.function_call_arguments.done",
                            item_id: "fc-large-1",
                            output_index: 1,
                            arguments: toolCallItem.arguments,
                        },
                        {
                            type: "response.output_item.done",
                            output_index: 1,
                            item: toolCallItem,
                        },
                        {
                            type: "response.completed",
                            response: {
                                id: "resp-large-1",
                                status: "completed",
                                output: [reasoningItem, toolCallItem],
                                usage: {
                                    input_tokens: 1200,
                                    output_tokens: 300,
                                    input_tokens_details: {
                                        cached_tokens: 200,
                                    },
                                },
                            },
                        },
                    ];
                    const sseBody = `${sseEvents.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`;
                    assert(Buffer.byteLength(sseBody) > 1_048_576);
                    return new Response(sseBody, {
                        status: 200,
                        headers: {
                            "content-type": "text/event-stream; charset=utf-8",
                        },
                    });
                }
                return qualificationReviewResponse(
                    qualificationReviewReport(reviewPayload),
                    requests,
                    null,
                    {
                        input_tokens: 400,
                        output_tokens: 100,
                        input_tokens_details: { cached_tokens: 0 },
                    },
                );
            },
        });
    const stage = await runCampaignReviewStage(stageOptions);
    expect(stage.status).toBe("awaiting_reconciliation");
    expect(requests).toBe(2);
    const largeResponsePath = join(
        lotRoot,
        `automated-review-response-analysis-${template.evidenceHash.slice(0, 16)}-1.json`,
    );
    expect(existsSync(largeResponsePath)).toBe(true);
    const savedLarge = JSON.parse(readFileSync(largeResponsePath, "utf8"));
    expect(Buffer.byteLength(savedLarge.body)).toBeGreaterThan(1_048_576);
    const attempts = await t.run((ctx) =>
        ctx.db
            .query("qualificationAnalysisAttempts")
            .withIndex("by_lot_and_attempt", (q) => q.eq("lotId", lotId))
            .collect(),
    );
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
        status: "settled",
        receipt: { input: 1000, cacheRead: 200, output: 300 },
    });
    largeAttemptHash = attempts[0]?.receipt?.observationHash ?? "";
    expect(largeAttemptHash).toMatch(/^[a-f0-9]{64}$/);
    // Replay on recovery reuses the >1 MiB cached response without re-dispatching HTTP.
    unlinkSync(join(lotRoot, "automated-review-result.json"));
    const replayed = await runCampaignReviewStage(stageOptions);
    expect(replayed.status).toBe("awaiting_reconciliation");
    expect(requests).toBe(2);
});

test("automated review settles verified usage when HTTP 200 SSE drops after terminal response.completed", async () => {
    let requests = 0;
    const { t, lotId, lotRoot, template, stageOptions } =
        await createDiagnosticReviewHarness({
            fetchImpl: async () => {
                requests++;
                const reviewPayload = {
                    ...template,
                    cases: template.cases.map((item) => ({
                        ...item,
                        checks: Object.fromEntries(
                            Object.keys(item.checks).map((key) => [
                                key,
                                "passed",
                            ]),
                        ),
                        finding:
                            "The synthetic fixture records the expected saved framing.",
                        evidence: ["published.json"],
                    })),
                };
                const reportText = qualificationReviewReport(reviewPayload);
                const msgItem = {
                    id: "msg-post-terminal-1",
                    type: "message",
                    role: "assistant",
                    content: [
                        {
                            type: "output_text",
                            text: reportText,
                            annotations: [],
                        },
                    ],
                    status: "completed",
                };
                const terminalFrames = [
                    {
                        type: "response.created",
                        response: { id: "resp-post-terminal-1" },
                    },
                    {
                        type: "response.output_item.added",
                        output_index: 0,
                        item: { ...msgItem, content: [] },
                    },
                    {
                        type: "response.content_part.added",
                        item_id: msgItem.id,
                        output_index: 0,
                        content_index: 0,
                        part: {
                            type: "output_text",
                            text: "",
                            annotations: [],
                        },
                    },
                    {
                        type: "response.output_text.delta",
                        item_id: msgItem.id,
                        output_index: 0,
                        content_index: 0,
                        delta: reportText,
                    },
                    {
                        type: "response.output_text.done",
                        item_id: msgItem.id,
                        output_index: 0,
                        content_index: 0,
                        text: reportText,
                    },
                    {
                        type: "response.output_item.done",
                        output_index: 0,
                        item: msgItem,
                    },
                    {
                        type: "response.completed",
                        response: {
                            id: "resp-post-terminal-1",
                            status: "completed",
                            output: [msgItem],
                            usage: {
                                input_tokens: 500,
                                output_tokens: 250,
                                input_tokens_details: { cached_tokens: 100 },
                            },
                        },
                    },
                ];
                const encoder = new TextEncoder();
                let pulls = 0;
                const stream = new ReadableStream<Uint8Array>({
                    pull(controller) {
                        pulls++;
                        if (pulls === 1) {
                            controller.enqueue(
                                encoder.encode(
                                    `${terminalFrames.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")}data: {"type":"incomplete_trailing_frame"`,
                                ),
                            );
                            return;
                        }
                        controller.error(
                            new Error("ECONNRESET after response.completed"),
                        );
                    },
                });
                return new Response(stream, {
                    status: 200,
                    headers: {
                        "content-type": "text/event-stream; charset=utf-8",
                    },
                });
            },
        });
    const stage = await runCampaignReviewStage(stageOptions);
    expect(stage.status).toBe("awaiting_reconciliation");
    expect(requests).toBe(1);
    const responseFilePath = join(
        lotRoot,
        `automated-review-response-analysis-${template.evidenceHash.slice(0, 16)}-1.json`,
    );
    expect(existsSync(responseFilePath)).toBe(true);
    const saved = JSON.parse(readFileSync(responseFilePath, "utf8"));
    expect(saved.body).not.toContain("incomplete_trailing_frame");
    expect(saved.body).toContain('"type":"response.completed"');
    const attempts = await t.run((ctx) =>
        ctx.db
            .query("qualificationAnalysisAttempts")
            .withIndex("by_lot_and_attempt", (q) => q.eq("lotId", lotId))
            .collect(),
    );
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
        status: "settled",
        receipt: { input: 400, cacheRead: 100, output: 250 },
    });
});
