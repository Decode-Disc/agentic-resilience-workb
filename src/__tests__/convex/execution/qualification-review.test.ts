import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { internal } from "@convex/_generated/api";
import {
    campaignManifestSchema,
    emptyCampaignLimits,
} from "@convex/qualificationCampaignPolicy";
import schema from "@convex/schema";
import {
    campaignReviewTemplate,
    runCampaign,
    runCampaignReviewStage,
} from "@evaluations/workbench-browser/campaign";
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName, makeFunctionReference } from "convex/server";
import type { Value } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { qualificationReviewResponse } from "@/__tests__/setup/qualification-review";
import { configurableCampaign } from "@/__tests__/setup/qualification-v2";
import { createAdmittedPreflight } from "@/__tests__/setup/research-launch";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

test("Pi review reserves real campaign allowances before HTTP and command adopts only after reconciliation", async () => {
    const t = convexTest(schema, import.meta.glob("/convex/**/*.ts"));
    const { preflightId } = await createAdmittedPreflight(t);
    await t.run(async (ctx) => {
        const preflight = await ctx.db.get(preflightId);
        assert(preflight?.ownerVisitorId);
        const visitor = await ctx.db.get(preflight.ownerVisitorId);
        assert(visitor);
        await ctx.db.patch(visitor.invitationId, { slotKey: "analyst-4" });
    });
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
            routes: [{ provider: "openai", model: "gpt-4o-mini" }],
            maxRequestCostMicros: 100000,
            perLot: { requests: 2, costMicros: 200000 },
            total: { requests: 2, costMicros: 200000 },
            maxInputTokens: 32000,
            maxOutputTokens: 1000,
            timeoutMs: 10000,
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
        "Synthetic evidence fixture: the framing was saved.",
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
    let requests = 0;
    const transport = {
        kind: "mock-openai" as const,
        fetch: async (
            _input: Parameters<typeof fetch>[0],
            init?: RequestInit,
        ) => {
            requests++;
            const lot = await t.run((ctx) => ctx.db.get(lotId));
            expect(lot?.analysisAllocated).toEqual({
                requests,
                costMicros: requests * 100000,
            });
            const body = JSON.parse(String(init?.body));
            expect(body.max_output_tokens).toBe(1000);
            if (requests === 2)
                expect(JSON.stringify(body.input)).toContain(
                    "Synthetic evidence fixture",
                );
            return qualificationReviewResponse(
                JSON.stringify(review),
                requests,
            );
        },
    };
    const { runAccountableCampaignReview } = await import(
        "@evaluations/workbench-browser/campaign-review"
    );
    const stage = await runCampaignReviewStage({
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
                transport,
            }),
        assess: async () => assert.fail("No assessment before reconciliation"),
    });
    expect(stage.status).toBe("awaiting_reconciliation");
    expect((await t.run((ctx) => ctx.db.get(lotId)))?.status).toBe("closing");
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
                .withIndex("by_lot_and_attempt", (q) => q.eq("lotId", lotId))
                .take(3),
        );
        expect(lot).toMatchObject({
            status: "finished",
            verdict: "passed",
            analysisAllocated: { requests: 2, costMicros: 200000 },
        });
        expect(campaign).toMatchObject({
            status: "closed",
            analysisAllocated: { requests: 2, costMicros: 200000 },
        });
        expect(attempts).toHaveLength(2);
        expect(
            attempts.every(
                (attempt) =>
                    attempt.status === "settled" && attempt.costMicros === 0,
            ),
        ).toBe(true);
        expect(requests).toBe(2);
        expect(archived).toBe(1);
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
