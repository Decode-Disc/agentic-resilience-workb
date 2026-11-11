import assert from "node:assert/strict";
import {
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

for (const { subscription, compaction, fault } of [
    { subscription: false, compaction: false, fault: "none" },
    { subscription: true, compaction: false, fault: "none" },
    { subscription: true, compaction: true, fault: "none" },
    { subscription: true, compaction: true, fault: "denied" },
    { subscription: true, compaction: true, fault: "unknown" },
    { subscription: true, compaction: true, fault: "settlement_ack" },
] as const)
    test(`Pi review reserves real campaign allowances before HTTP and command adopts only after reconciliation (subscription=${subscription}, compaction=${compaction}, fault=${fault})`, async () => {
        const allowance = fault === "denied" ? 8 : compaction ? 12 : 2;
        const t = convexTest(schema, import.meta.glob("/convex/**/*.ts"));
        const { preflightId } = await createAdmittedPreflight(t);
        await t.run(async (ctx) => {
            const preflight = await ctx.db.get(preflightId);
            assert(preflight?.ownerVisitorId);
            const visitor = await ctx.db.get(preflight.ownerVisitorId);
            assert(visitor);
            await ctx.db.patch(visitor.invitationId, { slotKey: "analyst-4" });
        });
        vi.stubEnv("WORKBENCH_REVIEW_REASONING", subscription ? "high" : "off");
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
                scope: "evidence_review",
                routes: [
                    {
                        provider: subscription ? "openai-codex" : "openai",
                        model: subscription ? "gpt-6.1-sol" : "gpt-4o-mini",
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
                lastPurpose = phase;
                requests++;
                const lot = await t.run((ctx) => ctx.db.get(lotId));
                expect(lot?.analysisAllocated).toEqual({
                    requests,
                    costMicros: subscription ? 0 : requests * 100000,
                });
                const body = await qualificationReviewPayload(init);
                if (subscription)
                    expect(body.reasoning).toMatchObject({ effort: "high" });
                emittedOutputs.push(body.max_output_tokens);
                expect(body.max_output_tokens).toBe(
                    subscription ? undefined : 1000,
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
                            "openai-codex",
                            "gpt-6.1-sol",
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
                    expect(String(body.instructions)).toContain(
                        template.evidenceHash,
                    );
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
                return qualificationReviewResponse(
                    qualificationReviewReport(review),
                    requests,
                );
            },
        };
        const { runAccountableCampaignReview } = await import(
            "@evaluations/workbench-browser/campaign-review"
        );
        const modelRuntime = await qualificationReviewRuntime(
            subscription ? "openai-codex" : "openai",
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
                    transport,
                }),
            assess: async () =>
                assert.fail("No assessment before reconciliation"),
        } satisfies Parameters<typeof runCampaignReviewStage>[0];
        let stage = await runCampaignReviewStage(stageOptions);
        if (fault !== "none") {
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
            expect(summaries).toBe(2);
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
            protocol: "investigator_v1",
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
            expect(lot).toMatchObject({
                status: "finished",
                verdict: "passed",
                analysisAllocated: {
                    requests: completedRequests,
                    costMicros: subscription ? 0 : 200000,
                },
            });
            expect(campaign).toMatchObject({
                status: "closed",
                analysisAllocated: {
                    requests: completedRequests,
                    costMicros: subscription ? 0 : 200000,
                },
            });
            expect(attempts).toHaveLength(completedRequests);
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
