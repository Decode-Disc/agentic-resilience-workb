import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test, { beforeEach } from "node:test";
import {
    analysisMandateSchema,
    campaignManifestSchema,
} from "../../../convex/qualificationCampaignPolicy.ts";
import {
    qualificationReviewCodexCredential,
    qualificationReviewReport,
    qualificationReviewResponse,
    qualificationReviewRuntime,
} from "../setup/qualification-review.ts";

// Most legacy fixtures use non-reasoning API/faux models; reasoning cases control their own environment.
beforeEach((t) => {
    const previous = process.env.WORKBENCH_REVIEW_REASONING;
    process.env.WORKBENCH_REVIEW_REASONING = "off";
    t.after(() => {
        if (previous === undefined)
            delete process.env.WORKBENCH_REVIEW_REASONING;
        else process.env.WORKBENCH_REVIEW_REASONING = previous;
    });
});

test("new analysis mandates require independent finite allowances and leave old mandates unchanged", () => {
    const base = makeManifest();
    const mandate = {
        ...base,
        version: 3,
        configurations: [
            { id: "main", purpose: "quality", models: base.models },
        ],
        scenarios: [
            {
                id: "initial-framing",
                company: {
                    cik: "1",
                    name: "Fixture",
                    ticker: "FIX",
                    websiteUrl: "https://example.com",
                },
                framing: {
                    scope: "Fixture",
                    questions: [
                        {
                            id: "position",
                            text: "What changed?",
                            shortLabel: "Position",
                            rationale: "Review the evidence.",
                        },
                    ],
                },
                steps: [{ id: "save", action: "save_framing" }],
            },
        ],
        analysis: {
            scope: "evidence_review",
            routes: [{ provider: "openai", model: "fixture" }],
            perLot: { requests: 2, costMicros: 200000 },
            total: { requests: 4, costMicros: 400000 },
            maxInputTokens: 1000,
            maxOutputTokens: 100,
            timeoutMs: 10000,
        },
    };
    delete mandate.models;
    assert.equal(campaignManifestSchema.safeParse(mandate).success, true);
    assert.equal(
        campaignManifestSchema.safeParse({
            ...mandate,
            analysis: {
                ...mandate.analysis,
                routes: [{ provider: "openai-codex", model: "fixture-codex" }],
            },
        }).success,
        true,
        "Pi OpenAI subscription identity must remain explicit",
    );
    assert.equal(
        campaignManifestSchema.safeParse({
            ...mandate,
            analysis: {
                ...mandate.analysis,
                total: { requests: 1, costMicros: 400000 },
            },
        }).success,
        false,
    );
    assert.equal(campaignManifestSchema.safeParse(base).success, true);
    assert.equal(
        campaignManifestSchema.safeParse({
            ...base,
            analysis: mandate.analysis,
        }).success,
        false,
    );
});

test("native review mandates use SDK capacity without a required input proxy while API bounds remain explicit", () => {
    const native = {
        scope: "evidence_review",
        accounting: "native_subscription",
        routes: [{ provider: "openai-codex", model: "fixture" }],
        perLot: { requests: 4 },
        total: { requests: 4 },
        timeoutMs: 10000,
    };
    assert.deepEqual(analysisMandateSchema.parse(native), native);
    assert.equal(
        analysisMandateSchema.parse({ ...native, maxInputTokens: 512 })
            .maxInputTokens,
        512,
    );
    const api = {
        ...native,
        accounting: undefined,
        routes: [{ provider: "openai", model: "fixture" }],
        perLot: { requests: 4, costMicros: 1000 },
        total: { requests: 4, costMicros: 1000 },
        maxOutputTokens: 100,
    };
    assert.equal(analysisMandateSchema.safeParse(api).success, false);
    assert.equal(
        analysisMandateSchema.safeParse({ ...api, maxInputTokens: 1000 })
            .success,
        true,
    );
});

test("a campaign cannot silently default its spending allowance or expiration", () => {
    assert.equal(
        campaignManifestSchema.safeParse({ objective: "Qualify Sources" })
            .success,
        false,
    );
});

import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    closeCampaignContext,
    runCampaign,
} from "../../../scripts/evaluations/workbench-browser/campaign.ts";
import { sha256 } from "../../../scripts/evaluations/workbench-browser/protocol.ts";

test("shared context cleanup finishes beyond 25 pages and refuses stalled continuation", async () => {
    const remaining = Array.from({ length: 31 }, (_, index) => index);
    let closed = false;
    await closeCampaignContext(
        {
            mutation: async (_ref, args) => {
                assert.equal(args.contextKey, "fixture-context");
                remaining.shift();
                closed = remaining.length === 0;
                return {
                    done: closed,
                    cursor: closed ? undefined : String(remaining.length),
                };
            },
        },
        "fixture-context",
    );
    assert.equal(closed, true);
    assert.equal(remaining.length, 0);
    await assert.rejects(
        closeCampaignContext(
            {
                mutation: async (_ref, args) => ({
                    done: false,
                    cursor: args.cursor ?? "same",
                }),
            },
            "fixture-context",
        ),
        /cursor did not advance/,
    );
});

const makeManifest = () => ({
    version: 1,
    key: "prepared",
    objective: "Qualify the protected Workbench path",
    capability: "workbench",
    mode: "deterministic",
    batteryHash: sha256(
        readFileSync(
            "scripts/evaluations/workbench-browser/browser-cases.json",
        ),
    ),
    expectations: [
        { id: "initial-framing", checks: ["proposed-framing-is-saved"] },
    ],
    models: { workbench: { model: "fixture", reasoning: "recommended" } },
    correctionPaths: ["convex/execution"],
    maximumLots: 2,
    repetitionsPerCandidate: 1,
    expiresAt: Date.now() + 60000,
    perLot: { model: 0, search: 0, acquisition: 0, costUsd: 0 },
    total: { model: 0, search: 0, acquisition: 0, costUsd: 0 },
});
test("prepare retains a reviewable mandate without authorizing a lot or contacting a service", async () => {
    const root = mkdtempSync(join(tmpdir(), "campaign-test-"));
    const input = join(root, "input.json");
    writeFileSync(input, JSON.stringify(makeManifest()));
    await runCampaign("prepare", root, { manifest: input });
    const retained = JSON.parse(
        readFileSync(join(root, "campaign.json"), "utf8"),
    );
    assert.equal(retained.manifest.key, "prepared");
    assert.equal(retained.campaignId, undefined);
    assert.equal(existsSync(join(root, "lots")), false);
});

import {
    acquireCampaignLock,
    assessCampaignLot,
    campaignReviewTemplate,
    validateCampaignReview,
} from "../../../scripts/evaluations/workbench-browser/campaign.ts";

test("a mechanical completion still needs a judgment bound to unchanged evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "campaign-review-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(
        join(root, "campaign-result.json"),
        JSON.stringify({ completed: true, cleanupCompleted: true }),
    );
    writeFileSync(
        join(root, "published.json"),
        JSON.stringify({ text: "Research has not started." }),
    );
    const review = campaignReviewTemplate(root);
    review.cases[0].finding = "The saved program matches the retained reply.";
    review.cases[0].evidence = ["published.json"];
    assert.equal(assessCampaignLot(root, review).verdict, "inconclusive");
    review.cases[0].checks["proposed-framing-is-saved"] = "passed";
    assert.equal(assessCampaignLot(root, review).verdict, "passed");
    writeFileSync(
        join(root, "published.json"),
        JSON.stringify({ text: "Different answer" }),
    );
    assert.throws(() => assessCampaignLot(root, review), /Stale/);
});
test("automated assessments identify their reviewer and reject evidence outside the frozen index", () => {
    const root = mkdtempSync(join(tmpdir(), "campaign-auto-assessment-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(
        join(root, "campaign-result.json"),
        JSON.stringify({ completed: true, cleanupCompleted: true }),
    );
    writeFileSync(join(root, "published.json"), "captured evidence");
    const review = campaignReviewTemplate(root);
    review.cases[0].finding = "The response matches the captured evidence.";
    review.cases[0].evidence = ["published.json"];
    const result = assessCampaignLot(root, review, { reviewer: "automated" });
    assert.equal(
        JSON.parse(readFileSync(result.path, "utf8")).reviewer,
        "automated",
    );
    writeFileSync(join(root, "later.json"), "not captured");
    review.cases[0].evidence = ["later.json"];
    assert.throws(
        () => assessCampaignLot(root, review, { reviewer: "automated" }),
        /evidence/i,
    );
});

test("retained automated review survives cleanup updating current evidence", async () => {
    const { runCampaignReviewStage } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-auto-revision-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(
        join(root, "campaign-result.json"),
        JSON.stringify({ completed: false, cleanupCompleted: false }),
    );
    writeFileSync(join(root, "published.json"), "captured evidence");
    const review = campaignReviewTemplate(root);
    writeFileSync(join(root, "review-template.json"), JSON.stringify(review));
    review.cases[0].finding = "The response matches the captured evidence.";
    review.cases[0].evidence = ["published.json"];
    const options = {
        root,
        evidenceHash: review.evidenceHash,
        review: async () => ({ status: "completed", review }),
        assess: async () => {},
    };
    assert.equal(
        (await runCampaignReviewStage({ ...options, reconciled: false }))
            .status,
        "awaiting_reconciliation",
    );
    writeFileSync(
        join(root, "campaign-result.json"),
        JSON.stringify({ completed: false, cleanupCompleted: true }),
    );
    writeFileSync(
        join(root, "review-template.json"),
        JSON.stringify(campaignReviewTemplate(root, { recovery: true })),
    );
    assert.equal(
        (await runCampaignReviewStage({ ...options, reconciled: true })).status,
        "assessed",
    );
});

for (const fault of [
    "retained",
    "none",
    "settlement",
    "settlement-expired",
    "settlement-unsupported",
    "settlement-expired-subscription",
    "settlement-expired-no-auth",
    "settlement-expired-tampered",
    "unknown-expired",
    "legacy-reasoning",
    "settlement-revision",
    "unknown",
    "denied",
    "503",
    "assess-ack",
    "report-ack-status",
    "report-ack-close",
    "unqualified",
    "tampered",
    "foreign-candidate",
    "auth-key",
    "auth-oauth",
    "auth-missing",
    "auth-codex",
    "auth-codex-reasoning",
    "auth-codex-legacy-reasoning",
    "auth-subscription",
    "auth-subscription-key",
    "isolated-lock",
    "invalid-verdict",
])
    test(`campaign command review handles ${fault}`, async () => {
        const retained = fault === "retained";
        const subscription =
            fault.startsWith("auth-subscription") ||
            fault === "settlement-expired-subscription";
        const codex = fault.startsWith("auth-codex") || subscription;
        const nativeAuth = fault.startsWith("auth-") || subscription;
        process.env.WORKBENCH_REVIEW_REASONING = codex
            ? fault === "auth-codex-reasoning"
                ? "high"
                : "low"
            : "off";
        const { mock } = await import("node:test");
        const { mkdirSync } = await import("node:fs");
        const { ConvexHttpClient } = await import("convex/browser");
        const { getFunctionName } = await import("convex/server");
        const { runCampaignReviewStage } = await import(
            "../../../scripts/evaluations/workbench-browser/campaign.ts"
        );
        const base = makeManifest();
        const { models, ...shared } = base;
        const manifest = campaignManifestSchema.parse({
            ...shared,
            version: 3,
            executionSurface: "backend",
            configurations: [{ id: "main", purpose: "quality", models }],
            scenarios: [
                {
                    id: "initial-framing",
                    company: {
                        cik: "1",
                        name: "Fixture",
                        ticker: "FIX",
                        websiteUrl: "https://example.com",
                    },
                    framing: {
                        scope: "Fixture",
                        questions: [
                            {
                                id: "position",
                                text: "What changed?",
                                shortLabel: "Position",
                                rationale: "Review the evidence.",
                            },
                        ],
                    },
                    steps: [{ id: "save", action: "save_framing" }],
                },
            ],
            analysis: {
                scope: "evidence_review",
                routes: [
                    {
                        provider: codex ? "openai-codex" : "openai",
                        model: codex ? "gpt-6.1-sol" : "gpt-4o-mini",
                    },
                ],
                ...(subscription
                    ? {
                          accounting: "native_subscription",
                          perLot: { requests: 3 },
                          total: { requests: 6 },
                      }
                    : {
                          maxRequestCostMicros: 100000,
                          perLot: { requests: 3, costMicros: 300000 },
                          total: { requests: 6, costMicros: 600000 },
                          maxOutputTokens: 1000,
                      }),
                maxInputTokens: 32000,
                timeoutMs: 10000,
            },
        });
        const root = mkdtempSync(join(tmpdir(), "campaign-command-recovery-"));
        const lotRoot = join(root, "lots", "lot-1");
        mkdirSync(lotRoot, { recursive: true });
        writeFileSync(
            join(root, "campaign.json"),
            JSON.stringify({
                manifest,
                fingerprints: {},
                campaignId: "campaign-fixture",
            }),
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
        writeFileSync(join(lotRoot, "published.json"), "retained evidence");
        const review = campaignReviewTemplate(lotRoot);
        review.cases[0].finding =
            "The saved framing matches the captured evidence.";
        review.cases[0].checks["proposed-framing-is-saved"] =
            fault === "invalid-verdict" ? "pass" : "passed";
        review.cases[0].evidence = ["published.json"];
        writeFileSync(
            join(lotRoot, "review-template.json"),
            JSON.stringify(campaignReviewTemplate(lotRoot)),
        );
        if (retained)
            await runCampaignReviewStage({
                root: lotRoot,
                evidenceHash: review.evidenceHash,
                reconciled: false,
                review: async () => ({ status: "completed", review }),
                assess: async () => assert.fail("not reconciled"),
            });
        const frozen = readFileSync(
            join(lotRoot, "campaign-result.json"),
            "utf8",
        );
        const lot = {
            candidateHash:
                fault === "foreign-candidate" ? "c".repeat(64) : "b".repeat(64),
            _id: "lot-fixture",
            key: "lot-1",
            status: "review",
            createdAt: 1,
        };
        const snapshot = {
            campaign: { manifest, activeLotId: lot._id },
            lots: [lot],
            continueCursor: null,
            coverage: [],
        };
        const client = new ConvexHttpClient("http://127.0.0.1:3210");
        const operations = [];
        let interrupted = false;
        const settled = new Map();
        let allocation = { requests: 0, costMicros: 0 };
        mock.method(client, "query", async (reference) => {
            assert.equal(
                getFunctionName(reference),
                "qualificationCampaigns:inspect",
            );
            if (fault === "isolated-lock") {
                let excluded = false;
                try {
                    const release = await acquireCampaignLock(
                        join(root, "fixture.lock"),
                    );
                    await release();
                } catch (error) {
                    assert.match(
                        error.message,
                        /Another qualification is active/,
                    );
                    excluded = true;
                }
                assert.equal(
                    excluded,
                    true,
                    "The deployment lock must cover query and assessment effects",
                );
            }
            return snapshot;
        });
        mock.method(client, "mutation", async (reference, args) => {
            const name = getFunctionName(reference);
            operations.push(name);
            assert.ok(
                [
                    "qualificationCampaigns:close",
                    "qualificationCampaigns:assess",
                    "qualificationCampaigns:reserveAnalysis",
                    "qualificationCampaigns:settleAnalysis",
                ].includes(name),
            );
            if (name.endsWith(":reserveAnalysis")) {
                assert.equal(args.evidenceHash, review.evidenceHash);
                assert.equal(
                    args.reservationMicros,
                    subscription ? undefined : 100000,
                );
                if (fault === "denied")
                    throw new Error("Analysis allowance exhausted");
                allocation = {
                    requests: allocation.requests + 1,
                    costMicros:
                        allocation.costMicros + (args.reservationMicros ?? 0),
                };
            }
            if (name.endsWith(":settleAnalysis") && subscription) {
                assert.equal(args.costMicros, undefined);
                assert.equal(args.receipt.accounting, "native_subscription");
                assert.equal(args.receipt.input, 100);
                assert.equal(args.receipt.output, 100);
                assert.equal(args.receipt.costMicros, undefined);
            }
            if (
                name.endsWith(":settleAnalysis") &&
                ((fault.startsWith("settlement-") &&
                    fault !== "settlement-revision") ||
                    ["settlement", "tampered"].includes(fault) ||
                    fault.endsWith("reasoning") ||
                    (fault === "settlement-revision" &&
                        args.attemptKey.endsWith("-2"))) &&
                !interrupted
            ) {
                interrupted = true;
                throw new Error("settlement acknowledgement lost");
            }
            if (name.endsWith(":settleAnalysis")) {
                if (settled.has(args.attemptKey))
                    assert.deepEqual(settled.get(args.attemptKey), args);
                else settled.set(args.attemptKey, structuredClone(args));
            }
            if (name.endsWith(":assess")) {
                assert.equal(args.verdict, "passed");
                lot.status = "finished";
                snapshot.campaign.activeLotId = undefined;
                if (fault === "assess-ack" && !interrupted) {
                    interrupted = true;
                    throw new Error("assessment acknowledgement lost");
                }
            }
            return null;
        });
        let archives = 0;
        let dispatches = 0;
        let mockFailure;
        const boundaries = {
            lock: () => acquireCampaignLock(join(root, "fixture.lock")),
            modelRuntime: nativeAuth
                ? undefined
                : await qualificationReviewRuntime(),
            connect: async () => ({
                client,
                origins: {
                    convex: "http://127.0.0.1:3210",
                    site: "http://127.0.0.1:3211",
                },
            }),
            archive: () => {
                archives++;
            },
            reviewTransport: {
                kind: "mock-openai",
                fetch: async (url, init) => {
                    try {
                        dispatches++;
                        if (fault === "auth-key") {
                            assert.equal(
                                url,
                                "https://pi-auth-fixture.invalid/v1/responses",
                            );
                            assert.equal(
                                sha256(
                                    new Headers(init.headers).get(
                                        "authorization",
                                    ),
                                ),
                                sha256("Bearer sk-synthetic-native-pi-key"),
                            );
                        }
                        if (fault === "unknown" || fault === "unknown-expired")
                            throw new Error("connection lost after dispatch");
                        if (fault === "503")
                            return new Response("unavailable", { status: 503 });
                        const { qualificationReviewPayload } = await import(
                            "../setup/qualification-review.ts"
                        );
                        const body = await qualificationReviewPayload(init);
                        assert.equal(
                            body.model,
                            codex ? "gpt-6.1-sol" : "gpt-4o-mini",
                        );
                        assert.equal(
                            body.max_output_tokens,
                            codex ? undefined : 1000,
                        );
                        if (codex)
                            assert.equal(
                                body.reasoning.effort,
                                fault === "auth-codex-reasoning"
                                    ? "high"
                                    : "low",
                            );
                        assert.match(
                            JSON.stringify(body),
                            /1-based UTF-8 byte position/,
                        );
                        if (dispatches === 2)
                            assert.match(
                                JSON.stringify(body.input),
                                /retained evidence/,
                            );
                        return qualificationReviewResponse(
                            qualificationReviewReport(review),
                            dispatches,
                        );
                    } catch (error) {
                        mockFailure = error.message;
                        throw error;
                    }
                },
            },
        };
        const exitCode = process.exitCode;
        const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
        const previousApiKey = process.env.OPENAI_API_KEY;
        let nativeFetchMock;
        try {
            if (nativeAuth) {
                const agentDir = mkdtempSync(join(tmpdir(), "pi-native-auth-"));
                process.env.PI_CODING_AGENT_DIR = agentDir;
                delete process.env.OPENAI_API_KEY;
                const credential =
                    (codex && fault !== "auth-subscription-key") ||
                    fault === "auth-oauth"
                        ? codex
                            ? qualificationReviewCodexCredential()
                            : {
                                  type: "oauth",
                                  access: "synthetic-oauth-access",
                                  refresh: "synthetic-oauth-refresh",
                                  expires: Date.now() + 600000,
                              }
                        : {
                              type: "api_key",
                              key: "sk-synthetic-native-pi-key",
                          };
                writeFileSync(
                    join(agentDir, "auth.json"),
                    JSON.stringify(
                        fault === "auth-missing"
                            ? {}
                            : {
                                  [codex ? "openai-codex" : "openai"]:
                                      credential,
                              },
                    ),
                );
                writeFileSync(
                    join(agentDir, "models.json"),
                    JSON.stringify({
                        providers: {
                            openai: {
                                baseUrl: "https://pi-auth-fixture.invalid/v1",
                            },
                        },
                    }),
                );
            }
            if (subscription) {
                nativeFetchMock = mock.method(
                    globalThis,
                    "fetch",
                    boundaries.reviewTransport.fetch,
                );
                boundaries.reviewTransport = undefined;
            }
            if (["unqualified", "auth-oauth", "auth-missing"].includes(fault))
                boundaries.reviewTransport = undefined;
            const run = () =>
                runCampaign(
                    "run",
                    root,
                    {},
                    async () => assert.fail("no scenario replay"),
                    boundaries,
                );
            if (fault === "foreign-candidate") {
                await assert.rejects(run(), /candidate/i);
                assert.equal(dispatches, 0);
                assert.equal(operations.length, 0);
                return;
            }
            if (fault === "assess-ack")
                await assert.rejects(run(), /acknowledgement lost/);
            else await run();
            if (
                [
                    "settlement-expired",
                    "settlement-unsupported",
                    "settlement-expired-subscription",
                    "settlement-expired-no-auth",
                    "settlement-expired-tampered",
                    "unknown-expired",
                ].includes(fault)
            ) {
                assert.equal(dispatches, 1);
                assert.equal(
                    settled.size,
                    0,
                    "settlement failed before backend commit",
                );
                const pinPath = join(lotRoot, "automated-review-mission.json");
                if (fault === "settlement-unsupported") {
                    const pin = JSON.parse(readFileSync(pinPath, "utf8"));
                    pin.resourcePolicy = "unsupported";
                    writeFileSync(pinPath, JSON.stringify(pin));
                }
                if (fault === "settlement-expired-tampered") {
                    const { readdirSync } = await import("node:fs");
                    const name = readdirSync(lotRoot).find((name) =>
                        name.startsWith("automated-review-response-"),
                    );
                    const path = join(lotRoot, name);
                    const record = JSON.parse(readFileSync(path, "utf8"));
                    record.body += "changed";
                    writeFileSync(path, JSON.stringify(record));
                }
                const pinBytes = readFileSync(pinPath, "utf8");
                const deadline = JSON.parse(pinBytes).deadlineAt;
                const before = structuredClone(allocation);
                if (fault === "settlement-expired-no-auth")
                    mock.method(
                        boundaries.modelRuntime,
                        "checkAuth",
                        async () => undefined,
                    );
                const realNow = Date.now;
                Date.now = () => deadline + 1;
                try {
                    if (fault === "settlement-expired-tampered")
                        await assert.rejects(
                            run(),
                            /Retained analysis observation changed/,
                        );
                    else {
                        await run();
                        await run();
                    }
                } finally {
                    Date.now = realNow;
                }
                const recoverable = ![
                    "unknown-expired",
                    "settlement-expired-tampered",
                ].includes(fault);
                assert.equal(
                    settled.size,
                    recoverable ? 1 : 0,
                    "only known unchanged receipts can reconcile after expiry",
                );
                assert.equal(
                    dispatches,
                    1,
                    "accounting recovery must not invoke inference",
                );
                assert.deepEqual(allocation, before);
                assert.equal(readFileSync(pinPath, "utf8"), pinBytes);
                assert.equal(
                    readFileSync(join(lotRoot, "campaign-result.json"), "utf8"),
                    frozen,
                );
                assert.equal(lot.status, "review");
                assert.equal(
                    operations.filter((name) =>
                        name.endsWith(":settleAnalysis"),
                    ).length,
                    recoverable ? 2 : fault === "unknown-expired" ? 0 : 1,
                );
                assert.equal(
                    operations.filter((name) => name.endsWith(":assess"))
                        .length,
                    0,
                );
                if (fault !== "settlement-expired-tampered")
                    assert.equal(
                        JSON.parse(
                            readFileSync(
                                join(lotRoot, "automated-review-status.json"),
                                "utf8",
                            ),
                        ).reason,
                        fault === "settlement-unsupported"
                            ? "resource_policy_unsupported"
                            : fault === "settlement-expired-no-auth"
                              ? "provider_login_required"
                              : "execution_deadline",
                    );
                return;
            }
            if (fault.startsWith("report-ack-")) {
                const reportPath = join(
                    lotRoot,
                    "automated-review-report.json",
                );
                const stale = JSON.parse(readFileSync(reportPath, "utf8"));
                assert.equal(stale.assessment, "assessed");
                assert.equal(
                    existsSync(
                        join(lotRoot, "automated-review-assessment.json"),
                    ),
                    true,
                );
                stale.assessment = "pending";
                delete stale.verdict;
                writeFileSync(reportPath, JSON.stringify(stale));
                const action = fault.endsWith("status") ? "status" : "close";
                await runCampaign(
                    action,
                    root,
                    {},
                    async () => assert.fail("no scenario replay"),
                    boundaries,
                );
                const restored = JSON.parse(readFileSync(reportPath, "utf8"));
                assert.equal(
                    restored.assessment,
                    "assessed",
                    "Acknowledged assessment must repair its report projection",
                );
                assert.equal(restored.verdict, "passed");
                if (action === "status") {
                    const status = JSON.parse(
                        readFileSync(join(root, "status.json"), "utf8"),
                    );
                    assert.equal(
                        status.diagnosticReports[0].assessment,
                        "assessed",
                    );
                }
                assert.equal(dispatches, 2);
                assert.equal(
                    operations.filter((name) => name.endsWith(":assess"))
                        .length,
                    1,
                );
            }
            if (fault === "settlement-revision") {
                assert.equal(dispatches, 2);
                assert.equal(
                    existsSync(join(lotRoot, "automated-review-result.json")),
                    false,
                );
                assert.equal(
                    existsSync(join(lotRoot, "automated-review-report.md")),
                    true,
                );
                writeFileSync(
                    join(lotRoot, "reconciliation.json"),
                    JSON.stringify({ reconciled: true, cleanup: "completed" }),
                );
                const recovered = campaignReviewTemplate(lotRoot, {
                    recovery: true,
                });
                writeFileSync(
                    join(lotRoot, "review-template.json"),
                    JSON.stringify(recovered),
                );
                assert.notEqual(recovered.evidenceHash, review.evidenceHash);
                process.env.WORKBENCH_REVIEW_REASONING =
                    "invalid-after-interruption";
                await run();
                assert.equal(
                    JSON.parse(
                        readFileSync(
                            join(lotRoot, "automated-review-mission.json"),
                            "utf8",
                        ),
                    ).evidenceHash,
                    review.evidenceHash,
                );
                assert.equal(
                    JSON.parse(
                        readFileSync(
                            join(lotRoot, "review-template.json"),
                            "utf8",
                        ),
                    ).evidenceHash,
                    recovered.evidenceHash,
                );
            }
            if (fault === "tampered") {
                const { readdirSync } = await import("node:fs");
                const file = readdirSync(lotRoot).find((name) =>
                    name.startsWith("automated-review-response-"),
                );
                assert.ok(file);
                const path = join(lotRoot, file);
                const record = JSON.parse(readFileSync(path, "utf8"));
                record.body = record.body.replaceAll(
                    "published.json",
                    "campaign-result.json",
                );
                writeFileSync(path, JSON.stringify(record));
                await assert.rejects(
                    run(),
                    /Retained analysis observation changed/,
                );
                assert.equal(dispatches, 1);
                assert.equal(lot.status, "review");
                assert.equal(archives, 0);
                return;
            }
            if (fault === "invalid-verdict") {
                assert.equal(lot.status, "review");
                assert.equal(dispatches, 3);
                assert.equal(
                    archives,
                    1,
                    "Pending developer findings must be archived independently of assessment",
                );
                assert.equal(
                    existsSync(join(lotRoot, "automated-review-report.md")),
                    true,
                );
                assert.equal(
                    existsSync(
                        join(lotRoot, "automated-review-assessment.json"),
                    ),
                    false,
                );
                assert.equal(
                    JSON.parse(
                        readFileSync(
                            join(lotRoot, "automated-review-status.json"),
                            "utf8",
                        ),
                    ).reason,
                    "analysis_reservation_unavailable",
                );
                await run();
                assert.equal(
                    dispatches,
                    3,
                    "Recovery must reuse known responses",
                );
                assert.equal(
                    archives,
                    1,
                    "Unchanged diagnostic evidence must reuse its archive receipt",
                );
                return;
            }
            if (fault === "auth-subscription-key") {
                assert.equal(dispatches, 0);
                assert.equal(operations.length, 0);
                assert.equal(archives, 0);
                assert.equal(lot.status, "review");
                const status = JSON.parse(
                    readFileSync(
                        join(lotRoot, "automated-review-status.json"),
                        "utf8",
                    ),
                );
                assert.equal(status.reason, "provider_login_required");
                assert.match(status.message, /\/login openai-codex/);
                return;
            }
            if (fault === "auth-missing") {
                assert.equal(dispatches, 0);
                assert.equal(operations.length, 0);
                const status = JSON.parse(
                    readFileSync(
                        join(lotRoot, "automated-review-status.json"),
                        "utf8",
                    ),
                );
                assert.equal(status.reason, "provider_login_required");
                assert.match(status.message, /\/login openai/);
                assert.equal(
                    existsSync(join(lotRoot, "automated-review-auth.json")),
                    false,
                );
                return;
            }
            if (["unqualified", "auth-oauth"].includes(fault)) {
                assert.equal(dispatches, 0);
                assert.equal(archives, 0);
                assert.equal(lot.status, "review");
                assert.deepEqual(
                    JSON.parse(
                        readFileSync(
                            join(lotRoot, "automated-review-status.json"),
                            "utf8",
                        ),
                    ),
                    {
                        status: "pending",
                        reason: "live_transport_unqualified",
                        authentication:
                            fault === "auth-oauth" ? "oauth" : "api_key",
                    },
                );
                assert.equal(
                    existsSync(
                        join(
                            lotRoot,
                            `automated-review-evidence-${review.evidenceHash}`,
                        ),
                    ),
                    false,
                );
                return;
            }
            if (["unknown", "denied", "503"].includes(fault)) {
                assert.equal(lot.status, "review");
                await run();
                assert.equal(dispatches, fault === "denied" ? 0 : 1);
                assert.equal(
                    operations.filter((name) =>
                        name.endsWith(":reserveAnalysis"),
                    ).length,
                    1,
                );
                assert.equal(archives, 0);
                assert.deepEqual(
                    allocation,
                    fault === "denied"
                        ? { requests: 0, costMicros: 0 }
                        : { requests: 1, costMicros: 100000 },
                );
                assert.equal(
                    existsSync(
                        join(lotRoot, "automated-review-assessment.json"),
                    ),
                    false,
                );
                return;
            }
            if (
                ["settlement", "assess-ack"].includes(fault) ||
                fault.endsWith("reasoning")
            ) {
                const pinPath = join(lotRoot, "automated-review-mission.json");
                if (fault.endsWith("legacy-reasoning")) {
                    const pin = JSON.parse(readFileSync(pinPath, "utf8"));
                    delete pin.reasoning;
                    writeFileSync(pinPath, JSON.stringify(pin));
                }
                const originalPin = readFileSync(pinPath, "utf8");
                process.env.WORKBENCH_REVIEW_REASONING =
                    "invalid-after-interruption";
                await run();
                assert.equal(readFileSync(pinPath, "utf8"), originalPin);
                if (fault.endsWith("legacy-reasoning")) {
                    assert.equal(lot.status, "review");
                    assert.deepEqual(
                        JSON.parse(
                            readFileSync(
                                join(lotRoot, "automated-review-status.json"),
                                "utf8",
                            ),
                        ),
                        {
                            status: "pending",
                            reason: "reviewer_pin_incomplete",
                        },
                    );
                    assert.equal(dispatches, 1);
                    assert.equal(
                        operations.filter((name) =>
                            name.endsWith(":reserveAnalysis"),
                        ).length,
                        1,
                    );
                    assert.equal(
                        operations.filter((name) =>
                            name.endsWith(":settleAnalysis"),
                        ).length,
                        2,
                    );
                    assert.equal(settled.size, 1);
                    assert.equal(
                        operations.filter((name) => name.endsWith(":assess"))
                            .length,
                        0,
                    );
                    assert.deepEqual(allocation, {
                        requests: 1,
                        costMicros: subscription ? 0 : 100000,
                    });
                    assert.equal(
                        existsSync(
                            join(lotRoot, "automated-review-assessment.json"),
                        ),
                        false,
                    );
                    return;
                }
            }
            assert.equal(
                lot.status,
                "finished",
                JSON.stringify({
                    dispatches,
                    operations,
                    mockFailure,
                    status: existsSync(
                        join(lotRoot, "automated-review-status.json"),
                    )
                        ? readFileSync(
                              join(lotRoot, "automated-review-status.json"),
                              "utf8",
                          )
                        : null,
                }),
            );
            await runCampaign(
                "close",
                root,
                {},
                async () => assert.fail("no scenario replay"),
                boundaries,
            );
            assert.equal(
                operations.filter((name) => name.endsWith(":assess")).length,
                fault === "assess-ack" ? 2 : 1,
            );
            assert.equal(
                archives,
                ["assess-ack", "settlement-revision"].includes(fault) ? 2 : 1,
            );
            assert.equal(dispatches, retained ? 0 : 2);
            if (!retained) {
                const journal = readFileSync(
                    join(lotRoot, "progress.jsonl"),
                    "utf8",
                )
                    .trim()
                    .split("\n")
                    .map(JSON.parse);
                assert.equal(
                    journal.filter(
                        (event) => event.event === "analysis_finished",
                    ).length,
                    2,
                );
                assert.equal(
                    operations.filter((name) =>
                        name.endsWith(":reserveAnalysis"),
                    ).length,
                    2,
                );
                assert.deepEqual(allocation, {
                    requests: 2,
                    costMicros: subscription ? 0 : 200000,
                });
            }
            assert.equal(
                readFileSync(join(lotRoot, "campaign-result.json"), "utf8"),
                frozen,
            );
        } finally {
            nativeFetchMock?.mock.restore();
            process.exitCode = exitCode;
            if (previousAgentDir === undefined)
                delete process.env.PI_CODING_AGENT_DIR;
            else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
            if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
            else process.env.OPENAI_API_KEY = previousApiKey;
        }
    });

test("automated review resumes an interrupted snapshot before dispatch", async () => {
    const { runCampaignReviewStage } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-partial-snapshot-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(
        join(root, "campaign-result.json"),
        JSON.stringify({ completed: true, cleanupCompleted: true }),
    );
    writeFileSync(join(root, "published.json"), "captured evidence");
    const review = campaignReviewTemplate(root);
    review.cases[0].finding = "The response matches captured evidence.";
    review.cases[0].evidence = ["published.json"];
    const snapshot = join(
        root,
        `automated-review-evidence-${review.evidenceHash}`,
    );
    const { mkdirSync } = await import("node:fs");
    mkdirSync(snapshot);
    writeFileSync(join(snapshot, "published.json"), "captured evidence");
    let calls = 0;
    const result = await runCampaignReviewStage({
        root,
        evidenceHash: review.evidenceHash,
        reconciled: false,
        review: async () => {
            calls++;
            return { status: "completed", review };
        },
        assess: async () => {},
    });
    assert.equal(result.status, "awaiting_reconciliation");
    assert.equal(calls, 1);
});

test("snapshot recovery never writes through a replaced destination directory", async () => {
    const { runCampaignReviewStage } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const { mkdirSync } = await import("node:fs");
    const root = mkdtempSync(join(tmpdir(), "campaign-snapshot-link-"));
    const outside = mkdtempSync(join(tmpdir(), "campaign-snapshot-outside-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "published.json"), "captured evidence");
    const review = campaignReviewTemplate(root);
    const snapshot = join(
        root,
        `automated-review-evidence-${review.evidenceHash}`,
    );
    mkdirSync(snapshot);
    symlinkSync(outside, join(snapshot, "docs"));
    await assert.rejects(
        runCampaignReviewStage({
            root,
            evidenceHash: review.evidenceHash,
            reconciled: false,
            review: async () => {
                throw new Error("must not dispatch");
            },
            assess: async () => {},
        }),
        /symlink|ELOOP|ENOTDIR/i,
    );
    assert.equal(existsSync(join(outside, "published.json")), false);
});

test("automated review rejects an invalid evidence revision before filesystem access", async () => {
    const { runCampaignReviewStage } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-invalid-revision-"));
    await assert.rejects(
        runCampaignReviewStage({
            root,
            evidenceHash: "../../outside",
            reconciled: false,
            assess: async () => {},
        }),
        /Invalid evidence revision/,
    );
});

test("retained automated review rejects changed frozen snapshot evidence", async () => {
    const { runCampaignReviewStage } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-snapshot-change-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(
        join(root, "campaign-result.json"),
        JSON.stringify({ completed: true, cleanupCompleted: true }),
    );
    writeFileSync(join(root, "published.json"), "captured evidence");
    const review = campaignReviewTemplate(root);
    review.cases[0].finding = "The response matches the captured evidence.";
    review.cases[0].evidence = ["published.json"];
    const options = {
        root,
        evidenceHash: review.evidenceHash,
        review: async () => ({ status: "completed", review }),
        assess: async () => {},
    };
    await runCampaignReviewStage({ ...options, reconciled: false });
    writeFileSync(
        join(
            root,
            `automated-review-evidence-${review.evidenceHash}`,
            "published.json",
        ),
        "altered evidence",
    );
    await assert.rejects(
        runCampaignReviewStage({ ...options, reconciled: true }),
        /stale/i,
    );
});

test("Pi review stage resumes its retained result and completes reconciled assessment", async () => {
    const pi = await import("@earendil-works/pi-coding-agent");
    const { dirname } = await import("node:path");
    const { fileURLToPath, pathToFileURL } = await import("node:url");
    const sdkDir = dirname(
        fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
    );
    const ai = await import(
        pathToFileURL(join(sdkDir, "../../pi-ai/dist/index.js")).href
    );
    const { runPiCampaignReview } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign-review.ts"
    );
    const { runCampaignReviewStage } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-pi-stage-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(
        join(root, "campaign-result.json"),
        JSON.stringify({ completed: true, cleanupCompleted: true }),
    );
    writeFileSync(join(root, "published.json"), "captured evidence");
    const review = campaignReviewTemplate(root);
    review.cases[0].finding = "The response matches the captured evidence.";
    review.cases[0].evidence = ["published.json"];
    review.cases[0].checks["proposed-framing-is-saved"] = "passed";
    const faux = ai.fauxProvider();
    const runtime = await pi.ModelRuntime.create({
        authPath: join(root, "auth.json"),
        modelsPath: null,
        modelsStorePath: join(root, "models.json"),
        allowModelNetwork: false,
        refreshOnCreate: false,
    });
    runtime.registerNativeProvider(faux.provider);
    faux.setResponses([
        ai.fauxAssistantMessage(qualificationReviewReport(review)),
    ]);
    const calls = [];
    const options = {
        root,
        evidenceHash: review.evidenceHash,
        review: (evidenceRoot) =>
            runPiCampaignReview({
                root: evidenceRoot,
                template: campaignReviewTemplate(evidenceRoot),
                runtime,
                model: faux.getModel(),
                transport: "mock",
                limits: {
                    maxInputTokens: 10000,
                    maxOutputTokens: 1000,
                    timeoutMs: 10000,
                },
                reserve: async () => calls.push("reserve"),
                settle: async () => calls.push("settle"),
            }),
        assess: async (assessment) => calls.push(assessment.verdict),
    };
    assert.equal(
        (await runCampaignReviewStage({ ...options, reconciled: false }))
            .status,
        "awaiting_reconciliation",
    );
    assert.equal(
        (await runCampaignReviewStage({ ...options, reconciled: true })).status,
        "assessed",
    );
    assert.deepEqual(calls, ["reserve", "settle", "passed"]);
    assert.equal(faux.state.callCount, 1);
});

test("unavailable transport leaves evidence untouched and avoids creating a snapshot", async () => {
    const { runCampaignReviewStage } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-no-transport-"));
    const evidenceHash = "a".repeat(64);
    const result = await runCampaignReviewStage({
        root,
        evidenceHash,
        reconciled: false,
        assess: async () => {
            throw new Error("unexpected assessment");
        },
    });
    assert.deepEqual(result, {
        status: "pending",
        reason: "transport_unqualified",
    });
    assert.equal(
        existsSync(join(root, `automated-review-evidence-${evidenceHash}`)),
        false,
    );
});

test("blocked automated review is retained as pending without changing mechanical result", async () => {
    const { runCampaignReviewStage } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-auto-pending-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    const mechanical = JSON.stringify({
        completed: false,
        cleanupCompleted: true,
    });
    writeFileSync(join(root, "campaign-result.json"), mechanical);
    const template = campaignReviewTemplate(root);
    const result = await runCampaignReviewStage({
        root,
        evidenceHash: template.evidenceHash,
        reconciled: true,
        assess: async () => {
            throw new Error("must not assess");
        },
    });
    assert.equal(result.reason, "transport_unqualified");
    assert.deepEqual(
        JSON.parse(
            readFileSync(join(root, "automated-review-status.json"), "utf8"),
        ),
        result,
    );
    assert.equal(
        readFileSync(join(root, "campaign-result.json"), "utf8"),
        mechanical,
    );
});

test("assessment handoff rejects a retained receipt without a retained review", async () => {
    const { runCampaignReviewStage } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-assessment-orphan-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(
        join(root, "campaign-result.json"),
        JSON.stringify({ completed: true, cleanupCompleted: true }),
    );
    writeFileSync(
        join(root, "automated-review-assessment.json"),
        JSON.stringify({ assessmentHash: "a".repeat(64), verdict: "passed" }),
    );
    const template = campaignReviewTemplate(root);
    let calls = 0;
    await assert.rejects(
        runCampaignReviewStage({
            root,
            evidenceHash: template.evidenceHash,
            reconciled: true,
            review: async () => {
                calls++;
                return { status: "pending", reason: "unavailable" };
            },
            assess: async () => {},
        }),
        /receipt/i,
    );
    assert.equal(calls, 0);
});

for (const mismatch of ["foreign-identity", "changed-assessment"])
    test(`report projection refuses mismatched acknowledged artifacts (${mismatch})`, async () => {
        const { campaignReviewReport, retainCampaignReviewReport } =
            await import(
                "../../../scripts/evaluations/workbench-browser/campaign.ts"
            );
        const root = mkdtempSync(join(tmpdir(), "campaign-report-projection-"));
        writeFileSync(
            join(root, "campaign-lot.json"),
            JSON.stringify({
                manifest: makeManifest(),
                candidateHash: "b".repeat(64),
                fingerprints: {},
            }),
        );
        writeFileSync(join(root, "published.json"), "Retained evidence.");
        const review = campaignReviewTemplate(root);
        review.cases[0].finding =
            "The saved result matches the captured evidence.";
        review.cases[0].evidence = ["published.json"];
        retainCampaignReviewReport(
            root,
            review,
            "# Findings\n\nRetained diagnosis awaiting its acknowledged assessment.",
            1,
        );
        writeFileSync(
            join(root, "automated-review-result.json"),
            JSON.stringify({
                kind: "automated",
                evidenceHash: review.evidenceHash,
                review,
            }),
        );
        const assessment = {
            ...review,
            candidateHash:
                mismatch === "foreign-identity"
                    ? "c".repeat(64)
                    : review.candidateHash,
            verdict: "inconclusive",
            reviewer: "automated",
            modelTaskQuality: "limited_to_declared_expectations",
        };
        const assessmentHash = sha256(JSON.stringify(assessment));
        writeFileSync(
            join(root, "automated-review-assessment.json"),
            JSON.stringify({ assessmentHash, verdict: "inconclusive" }),
        );
        const stored = structuredClone(assessment);
        if (mismatch === "changed-assessment")
            stored.cases[0].finding =
                "Changed after the receipt was acknowledged.";
        writeFileSync(
            join(root, `assessment-${assessmentHash}.json`),
            JSON.stringify(stored),
        );
        assert.throws(() => campaignReviewReport(root), /changed|differs/i);
        assert.equal(
            JSON.parse(
                readFileSync(
                    join(root, "automated-review-report.json"),
                    "utf8",
                ),
            ).assessment,
            "pending",
        );
    });

for (const variant of ["property-order", "extra-field"])
    test(`legacy assessment recovery preserves committed identity (${variant})`, async () => {
        const { runCampaignReviewStage } = await import(
            "../../../scripts/evaluations/workbench-browser/campaign.ts"
        );
        const root = mkdtempSync(join(tmpdir(), "campaign-legacy-identity-"));
        writeFileSync(
            join(root, "campaign-lot.json"),
            JSON.stringify({
                manifest: makeManifest(),
                candidateHash: "b".repeat(64),
                fingerprints: {},
            }),
        );
        writeFileSync(
            join(root, "campaign-result.json"),
            JSON.stringify({ completed: true, cleanupCompleted: true }),
        );
        writeFileSync(
            join(root, "published.json"),
            "Historical retained evidence.",
        );
        const template = campaignReviewTemplate(root);
        template.cases[0].finding =
            "The historical judgment matches the captured result.";
        template.cases[0].checks["proposed-framing-is-saved"] = "passed";
        template.cases[0].evidence = ["published.json"];
        const legacy =
            variant === "property-order"
                ? Object.fromEntries(Object.entries(template).reverse())
                : {
                      ...template,
                      legacyAnnotation: "Previously accepted annotation",
                  };
        const committedHash = sha256(
            JSON.stringify({
                ...legacy,
                verdict: "passed",
                reviewer: "automated",
                modelTaskQuality: "limited_to_declared_expectations",
            }),
        );
        writeFileSync(
            join(root, "automated-review-result.json"),
            JSON.stringify({
                kind: "automated",
                evidenceHash: template.evidenceHash,
                review: legacy,
            }),
        );
        let reviewerCalls = 0;
        const result = await runCampaignReviewStage({
            root,
            evidenceHash: template.evidenceHash,
            reconciled: true,
            review: async () => {
                reviewerCalls++;
                throw new Error("Retained review must not dispatch");
            },
            assess: async (assessment) =>
                assert.equal(
                    assessment.assessmentHash,
                    committedHash,
                    "Recovery must reuse the already committed assessment",
                ),
        });
        assert.equal(result.status, "assessed");
        assert.equal(reviewerCalls, 0);
        assert.equal(
            JSON.parse(
                readFileSync(
                    join(root, "automated-review-assessment.json"),
                    "utf8",
                ),
            ).assessmentHash,
            committedHash,
        );
    });

test("assessment handoff retries the same retained assessment after interruption", async () => {
    const { runCampaignReviewStage } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-assessment-retry-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(
        join(root, "campaign-result.json"),
        JSON.stringify({ completed: true, cleanupCompleted: true }),
    );
    writeFileSync(join(root, "published.json"), "evidence");
    const review = campaignReviewTemplate(root);
    review.cases[0].finding = "The response matches the captured evidence.";
    review.cases[0].evidence = ["published.json"];
    let attempts = 0;
    let hash;
    const options = {
        root,
        evidenceHash: review.evidenceHash,
        reconciled: true,
        review: async () => ({ status: "completed", review }),
        assess: async (assessment) => {
            attempts++;
            if (hash) assert.equal(assessment.assessmentHash, hash);
            hash = assessment.assessmentHash;
            if (attempts === 1) throw new Error("connection interrupted");
        },
    };
    await assert.rejects(runCampaignReviewStage(options), /interrupted/);
    assert.equal((await runCampaignReviewStage(options)).status, "assessed");
    assert.equal(attempts, 2);
});

test("automated review survives reconciliation delay and hands off only once", async () => {
    const { runCampaignReviewStage } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-auto-stage-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(
        join(root, "campaign-result.json"),
        JSON.stringify({ completed: true, cleanupCompleted: true }),
    );
    writeFileSync(join(root, "published.json"), "captured evidence");
    const review = campaignReviewTemplate(root);
    review.cases[0].finding = "The response matches the captured evidence.";
    review.cases[0].evidence = ["published.json"];
    review.cases[0].checks["proposed-framing-is-saved"] = "passed";
    let reviews = 0;
    let assessments = 0;
    const options = {
        root,
        evidenceHash: review.evidenceHash,
        review: async () => {
            reviews++;
            return { status: "completed", review };
        },
        assess: async () => {
            assessments++;
        },
    };
    assert.equal(
        (await runCampaignReviewStage({ ...options, reconciled: false }))
            .status,
        "awaiting_reconciliation",
    );
    assert.equal(assessments, 0);
    assert.equal(
        (await runCampaignReviewStage({ ...options, reconciled: true })).status,
        "assessed",
    );
    assert.equal(
        (await runCampaignReviewStage({ ...options, reconciled: true })).status,
        "assessed",
    );
    assert.equal(reviews, 1);
    assert.equal(assessments, 1);
});

test("automated review rejects references absent from its frozen evidence revision", () => {
    const root = mkdtempSync(join(tmpdir(), "campaign-auto-review-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(
        join(root, "campaign-result.json"),
        JSON.stringify({ completed: true, cleanupCompleted: true }),
    );
    writeFileSync(
        join(root, "published.json"),
        JSON.stringify({ text: "Research has not started." }),
    );
    const review = campaignReviewTemplate(root);
    writeFileSync(
        join(root, "later.json"),
        JSON.stringify({ text: "Not captured." }),
    );
    review.cases[0].finding = "The response is supported by this evidence.";
    review.cases[0].evidence = ["later.json"];
    assert.throws(
        () => validateCampaignReview(root, review, { reviewer: "automated" }),
        /evidence/i,
    );
    review.cases[0].evidence = ["published.json"];
    assert.equal(
        validateCampaignReview(root, review, { reviewer: "automated" })
            .evidenceHash,
        review.evidenceHash,
    );
    review.cases[0].evidence = ["./published.json"];
    assert.throws(
        () => validateCampaignReview(root, review, { reviewer: "automated" }),
        /evidence/i,
    );
    symlinkSync("published.json", join(root, "link.json"));
    review.cases[0].evidence = ["link.json"];
    assert.throws(
        () => validateCampaignReview(root, review, { reviewer: "automated" }),
        /evidence/i,
    );
    review.cases[0].evidence = ["published.json"];
    writeFileSync(join(root, "published.json"), "changed");
    assert.throws(
        () => validateCampaignReview(root, review, { reviewer: "automated" }),
        /Stale/,
    );
});

test("reviewer discovers indexed evidence and reads bounded windows of large verified files", async () => {
    const { listCampaignReviewEvidence, readCampaignReviewEvidenceWindow } =
        await import(
            "../../../scripts/evaluations/workbench-browser/campaign.ts"
        );
    const root = mkdtempSync(join(tmpdir(), "campaign-review-windows-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    const content = "abcé😀0123456789".repeat(5000);
    writeFileSync(join(root, "published.json"), content);
    const { evidenceHash } = campaignReviewTemplate(root);
    const paths = [];
    let cursor = 0;
    do {
        const page = listCampaignReviewEvidence(root, evidenceHash, cursor, 1);
        paths.push(...page.paths);
        cursor = page.nextCursor;
    } while (cursor !== null);
    assert.ok(paths.includes("published.json"));
    let result = "";
    let offset = 0;
    while (offset < Buffer.byteLength(content)) {
        const window = readCampaignReviewEvidenceWindow(
            root,
            evidenceHash,
            "published.json",
            offset,
            8192,
        );
        result += window.content;
        assert.ok(Buffer.byteLength(window.content) <= 8192);
        offset = window.nextOffset;
    }
    assert.equal(result, content);
    assert.throws(
        () =>
            readCampaignReviewEvidenceWindow(
                root,
                evidenceHash,
                "missing.json",
                0,
                1024,
            ),
        /evidence/i,
    );
    assert.throws(
        () =>
            readCampaignReviewEvidenceWindow(
                root,
                evidenceHash,
                "published.json",
                0,
                51201,
            ),
        /window/i,
    );
    writeFileSync(join(root, "published.json"), `${content.slice(0, -1)}X`);
    assert.throws(
        () =>
            readCampaignReviewEvidenceWindow(
                root,
                evidenceHash,
                "published.json",
                0,
                1024,
            ),
        /stale/i,
    );
    unlinkSync(join(root, "published.json"));
    symlinkSync("campaign-lot.json", join(root, "published.json"));
    assert.throws(
        () =>
            readCampaignReviewEvidenceWindow(
                root,
                evidenceHash,
                "published.json",
                0,
                1024,
            ),
        /symlink/i,
    );
});

test("investigator search finds archived source beyond the first inventory page", async () => {
    const campaign = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-search-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(root, "code"));
    for (let i = 0; i < 101; i++)
        writeFileSync(
            join(root, "code", `${String(i).padStart(3, "0")}.ts`),
            "unrelated source\n",
        );
    writeFileSync(
        join(root, "code", "owner.ts"),
        "export function settleBilling() {}\nsettleBilling();\n",
    );
    const { evidenceHash } = campaignReviewTemplate(root);
    const matches = [];
    let cursor;
    let pages = 0;
    do {
        const page = campaign.searchCampaignReviewEvidence(root, evidenceHash, {
            pattern: "settlebilling",
            ignoreCase: true,
            limit: 1,
            cursor,
        });
        matches.push(...page.matches);
        cursor = page.nextCursor;
        assert(++pages < 10, "Search continuation must advance");
    } while (cursor);
    assert(
        pages > 1,
        "Bounded search must disclose incomplete inventory coverage",
    );
    assert.deepEqual(
        matches.map(({ path, line }) => ({ path, line })),
        [
            { path: "code/owner.ts", line: 1 },
            { path: "code/owner.ts", line: 2 },
        ],
    );
    assert.match(matches[0].content, /settleBilling/);
});

test("newline-heavy evidence returns and resumes within a bounded search heap", async () => {
    const { spawnSync } = await import("node:child_process");
    const root = mkdtempSync(join(tmpdir(), "campaign-search-heap-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    const blankLines = 16 * 1024 * 1024;
    writeFileSync(
        join(root, "large.txt"),
        `needle\n${"\n".repeat(blankLines)}🙂 İ needle\n`,
    );
    const { evidenceHash } = campaignReviewTemplate(root);
    const script = `
        const { searchCampaignReviewEvidence: search } = await import('./scripts/evaluations/workbench-browser/campaign.ts');
        const [root, evidenceHash] = process.argv.slice(1);
        const options = { path: 'large.txt', pattern: 'needle', limit: 1 };
        const first = search(root, evidenceHash, options);
        const second = search(root, evidenceHash, { ...options, cursor: first.nextCursor });
        const tail = search(root, evidenceHash, { ...options, cursor: second.nextCursor });
        console.log(JSON.stringify({ first: first.matches, second: second.matches, finished: tail.nextCursor }));
    `;
    const result = spawnSync(
        "/bin/sh",
        [
            "-c",
            'ulimit -c 0; exec "$@"',
            "search-heap-probe",
            process.execPath,
            "--max-old-space-size=96",
            "--experimental-strip-types",
            "--input-type=module",
            "-e",
            script,
            root,
            evidenceHash,
        ],
        { encoding: "utf8", timeout: 30000 },
    );
    assert.equal(
        result.status,
        0,
        `${result.signal ?? result.error ?? "Search failed"}: ${result.stderr.match(/^FATAL ERROR.*$/m)?.[0] ?? result.stderr.slice(-1200)}`,
    );
    const page = JSON.parse(result.stdout);
    assert.equal(page.first[0].line, 1);
    assert.equal(page.first[0].offset, 1);
    assert.equal(page.second[0].line, blankLines + 2);
    assert.equal(page.second[0].offset, blankLines + 16);
    assert.equal(page.finished, null);
});

test("case-insensitive evidence search returns a read-ready Unicode byte locator", async () => {
    const { searchCampaignReviewEvidence } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-search-unicode-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(join(root, "owner.ts"), "İ🙂 settleBilling();\n");
    const { evidenceHash } = campaignReviewTemplate(root);
    const page = searchCampaignReviewEvidence(root, evidenceHash, {
        pattern: "settlebilling",
        ignoreCase: true,
    });
    assert.equal(page.matches[0].offset, 8);
});

test("investigator search excludes unindexed data and rejects changed, escaped or cancelled reads", async () => {
    const { searchCampaignReviewEvidence } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-search-integrity-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(join(root, "owner.ts"), "billing\nbilling\n");
    const { evidenceHash } = campaignReviewTemplate(root);
    writeFileSync(join(root, "unindexed.txt"), "private billing");
    const options = { pattern: "billing", path: "owner.ts", limit: 1 };
    const first = searchCampaignReviewEvidence(root, evidenceHash, options);
    assert(first.nextCursor);
    assert.throws(
        () =>
            searchCampaignReviewEvidence(root, evidenceHash, {
                ...options,
                pattern: "different",
                cursor: first.nextCursor,
            }),
        /cursor/,
    );
    for (const path of ["../owner.ts", "/etc/passwd", "unindexed.txt"])
        assert.throws(
            () =>
                searchCampaignReviewEvidence(root, evidenceHash, {
                    ...options,
                    path,
                }),
            /scope/,
        );
    const whole = searchCampaignReviewEvidence(root, evidenceHash, {
        pattern: "private billing",
    });
    assert.equal(whole.matches.length, 0);
    assert.equal(whole.nextCursor, null);
    assert.throws(
        () =>
            searchCampaignReviewEvidence(root, evidenceHash, {
                ...options,
                signal: AbortSignal.abort(),
            }),
        /abort/i,
    );
    writeFileSync(join(root, "owner.ts"), "changed billing");
    assert.throws(
        () => searchCampaignReviewEvidence(root, evidenceHash, options),
        /changed|stale/i,
    );
    unlinkSync(join(root, "owner.ts"));
    symlinkSync(join(root, "unindexed.txt"), join(root, "owner.ts"));
    assert.throws(
        () => searchCampaignReviewEvidence(root, evidenceHash, options),
        /symlink/i,
    );
});

test("automated evidence reading permits only unchanged indexed files within its byte limit", async () => {
    const { readCampaignReviewEvidence } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-review-read-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(join(root, "published.json"), "original");
    const { evidenceHash } = campaignReviewTemplate(root);
    writeFileSync(join(root, "later.json"), "unindexed");
    assert.equal(
        readCampaignReviewEvidence(root, evidenceHash, "published.json", 8),
        "original",
    );
    assert.throws(
        () =>
            readCampaignReviewEvidence(root, evidenceHash, "published.json", 7),
        /limit/i,
    );
    assert.throws(
        () => readCampaignReviewEvidence(root, evidenceHash, "later.json", 100),
        /evidence/i,
    );
    assert.throws(
        () =>
            readCampaignReviewEvidence(
                root,
                evidenceHash,
                "../published.json",
                100,
            ),
        /evidence/i,
    );
    unlinkSync(join(root, "published.json"));
    symlinkSync("later.json", join(root, "published.json"));
    assert.throws(
        () =>
            readCampaignReviewEvidence(
                root,
                evidenceHash,
                "published.json",
                100,
            ),
        /symlink/i,
    );
    unlinkSync(join(root, "published.json"));
    writeFileSync(join(root, "published.json"), "modified");
    assert.throws(
        () =>
            readCampaignReviewEvidence(
                root,
                evidenceHash,
                "published.json",
                100,
            ),
        /stale/i,
    );
});

test("automated evidence reading rejects symlinked parent directories", async () => {
    const { readCampaignReviewEvidence } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const { mkdirSync, renameSync } = await import("node:fs");
    const root = mkdtempSync(join(tmpdir(), "campaign-parent-link-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "published.json"), "evidence");
    const { evidenceHash } = campaignReviewTemplate(root);
    renameSync(join(root, "docs"), join(root, "moved"));
    symlinkSync("moved", join(root, "docs"));
    assert.throws(
        () =>
            readCampaignReviewEvidence(
                root,
                evidenceHash,
                "docs/published.json",
                100,
            ),
        /symlink|ELOOP|ENOTDIR/i,
    );
});

test("automated evidence reading rejects a symlinked evidence root", async () => {
    const { readCampaignReviewEvidence } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-review-root-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(join(root, "published.json"), "evidence");
    const { evidenceHash } = campaignReviewTemplate(root);
    const alias = `${root}-alias`;
    symlinkSync(root, alias);
    assert.throws(
        () =>
            readCampaignReviewEvidence(
                alias,
                evidenceHash,
                "published.json",
                100,
            ),
        /symlink/i,
    );
});

for (const changedEvidence of [false, true])
    test(`Pi reviewer reads frozen evidence and reports integrity failures (changed=${changedEvidence})`, async () => {
        const pi = await import("@earendil-works/pi-coding-agent");
        const { dirname } = await import("node:path");
        const { fileURLToPath, pathToFileURL } = await import("node:url");
        const sdkDir = dirname(
            fileURLToPath(
                import.meta.resolve("@earendil-works/pi-coding-agent"),
            ),
        );
        const ai = await import(
            pathToFileURL(join(sdkDir, "../../pi-ai/dist/index.js")).href
        );
        const { runPiCampaignReview } = await import(
            "../../../scripts/evaluations/workbench-browser/campaign-review.ts"
        );
        const root = mkdtempSync(join(tmpdir(), "campaign-pi-review-"));
        writeFileSync(
            join(root, "campaign-lot.json"),
            JSON.stringify({
                manifest: makeManifest(),
                candidateHash: "b".repeat(64),
                fingerprints: {},
            }),
        );
        writeFileSync(
            join(root, "published.json"),
            "captured evidence".repeat(5000),
        );
        const review = campaignReviewTemplate(root);
        review.cases[0].finding = "The response matches the captured evidence.";
        review.cases[0].checks["proposed-framing-is-saved"] = "passed";
        review.cases[0].evidence = ["published.json"];
        const faux = ai.fauxProvider();
        const runtime = await pi.ModelRuntime.create({
            authPath: join(root, "auth.json"),
            modelsPath: null,
            modelsStorePath: join(root, "models.json"),
            allowModelNetwork: false,
            refreshOnCreate: false,
        });
        runtime.registerNativeProvider(faux.provider);
        faux.setResponses([
            ai.fauxAssistantMessage([ai.fauxToolCall("ls", {})], {
                stopReason: "toolUse",
            }),
            (context) => {
                assert.match(
                    JSON.stringify(context.messages.at(-1)),
                    /published\.json/,
                );
                return ai.fauxAssistantMessage(
                    [
                        ai.fauxToolCall("read", {
                            path: "published.json",
                            limit: 512,
                        }),
                    ],
                    { stopReason: "toolUse" },
                );
            },
            (context) => {
                const result = JSON.stringify(context.messages.at(-1));
                assert.match(result, /captured evidence/);
                assert.match(result, /nextOffset/);
                if (changedEvidence)
                    writeFileSync(
                        join(root, "published.json"),
                        "changed after reading",
                    );
                return ai.fauxAssistantMessage(
                    qualificationReviewReport(review),
                );
            },
        ]);
        const events = [];
        await assert.rejects(
            runPiCampaignReview({
                root,
                template: campaignReviewTemplate(root),
                runtime,
                model: { ...faux.getModel(), provider: "openai" },
                transport: "mock",
                limits: {
                    maxInputTokens: 10000,
                    maxOutputTokens: 1000,
                    timeoutMs: 10000,
                },
                reserve: async () => {},
                settle: async () => {},
            }),
            /transport.*blocked/i,
        );
        const pending = runPiCampaignReview({
            root,
            reportRoot: root,
            template: campaignReviewTemplate(root),
            runtime,
            model: faux.getModel(),
            transport: "mock",
            limits: {
                maxInputTokens: 10000,
                maxOutputTokens: 1000,
                timeoutMs: 10000,
            },
            reserve: async (attempt) => events.push(`reserve:${attempt}`),
            settle: async (attempt) => events.push(`settle:${attempt}`),
        });
        if (changedEvidence) {
            await assert.rejects(pending, /stale/i);
            assert.match(
                readFileSync(join(root, "automated-review-report.md"), "utf8"),
                /captured evidence/,
            );
            return;
        }
        const result = await pending;
        assert.equal(result.status, "completed");
        assert.equal(
            result.review.cases[0].checks["proposed-framing-is-saved"],
            "passed",
        );
        assert.deepEqual(events, [
            "reserve:1",
            "settle:1",
            "reserve:2",
            "settle:2",
            "reserve:3",
            "settle:3",
        ]);
        assert.equal(faux.state.callCount, 3);
    });

test("a rejected assessment retains a developer report while reconciliation is blocked", async () => {
    const { runPiCampaignReview } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign-review.ts"
    );
    const { runCampaignReviewStage } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-investigator-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    const mechanical = { completed: false, cleanupCompleted: true };
    writeFileSync(
        join(root, "campaign-result.json"),
        JSON.stringify(mechanical),
    );
    writeFileSync(
        join(root, "published.json"),
        "The documentary control timed out.",
    );
    const template = campaignReviewTemplate(root);
    const review = structuredClone(template);
    review.cases[0].finding =
        "Documentary control timed out before a useful handoff.";
    review.cases[0].checks["proposed-framing-is-saved"] = "fail";
    review.cases[0].evidence = ["published.json"];
    const report = `# Developer handoff\n\nDocumentary control timed out; inspect the attempt deadline before changing the model.\n\n## Assessment\n\n\`\`\`json\n${JSON.stringify(review)}\n\`\`\``;
    const runtime = await qualificationReviewRuntime();
    let requests = 0;
    const result = await runCampaignReviewStage({
        root,
        evidenceHash: template.evidenceHash,
        reconciled: false,
        review: (evidenceRoot) =>
            runPiCampaignReview({
                root: evidenceRoot,
                reportRoot: root,
                template,
                runtime,
                model: runtime.getModel("openai", "gpt-4o-mini"),
                transport: {
                    kind: "mock-openai",
                    fetch: () => async () => {
                        requests++;
                        return qualificationReviewResponse(report, requests);
                    },
                },
                limits: {
                    maxInputTokens: 32000,
                    maxOutputTokens: 1000,
                    timeoutMs: 10000,
                },
                reserve: async (attempt) =>
                    assert(attempt <= 2, "Analysis allowance exhausted"),
                settle: async () => {},
            }),
        assess: async () =>
            assert.fail("Invalid or unreconciled review cannot be assessed"),
    });
    assert.equal(result.status, "pending");
    assert.equal(result.reason, "analysis_reservation_unavailable");
    assert.equal(requests, 2);
    assert.match(
        readFileSync(join(root, "automated-review-report.md"), "utf8"),
        /inspect the attempt deadline/,
    );
    assert.equal(
        existsSync(join(root, "automated-review-assessment.json")),
        false,
    );
    assert.deepEqual(
        JSON.parse(readFileSync(join(root, "campaign-result.json"), "utf8")),
        mechanical,
    );
});

test("a length-limited diagnostic remains available without accepting assessment", async () => {
    const { dirname } = await import("node:path");
    const { fileURLToPath, pathToFileURL } = await import("node:url");
    const sdk = dirname(
        fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
    );
    const ai = await import(
        pathToFileURL(join(sdk, "../../pi-ai/dist/index.js")).href
    );
    const { runPiCampaignReview } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign-review.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-review-partial-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    const template = campaignReviewTemplate(root);
    const runtime = await qualificationReviewRuntime();
    const faux = ai.fauxProvider();
    runtime.registerNativeProvider(faux.provider);
    const text =
        "# Findings\n\nUseful partial diagnosis: inspect the captured operation and its archived owner.";
    faux.setResponses([
        ai.fauxAssistantMessage(text, { stopReason: "length" }),
    ]);
    const events = [];
    const result = await runPiCampaignReview({
        root,
        reportRoot: root,
        template,
        runtime,
        model: faux.getModel(),
        transport: "mock",
        limits: {
            maxInputTokens: 32000,
            maxOutputTokens: 1000,
            timeoutMs: 10000,
        },
        reserve: async () => {
            events.push("reserve");
        },
        settle: async () => {
            events.push("settle");
        },
    });
    assert.equal(result.status, "pending");
    assert.equal(
        readFileSync(join(root, "automated-review-report.md"), "utf8"),
        text,
    );
    const report = JSON.parse(
        readFileSync(join(root, "automated-review-report.json"), "utf8"),
    );
    assert.equal(report.assessment, "pending");
    assert.equal(report.complete, false);
    assert.deepEqual(events, ["reserve", "settle"]);
    assert.equal(faux.state.callCount, 1);
});

test("a completed diagnostic survives a lost reviewer settlement acknowledgement without another call", async () => {
    const { runPiCampaignReview } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign-review.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-report-settlement-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    const template = campaignReviewTemplate(root);
    const runtime = await qualificationReviewRuntime();
    let requests = 0;
    const text =
        "# Findings\n\nSource-supported suspect: the billing observation is not marked final. Verify the settlement owner.\n";
    const result = await runPiCampaignReview({
        root,
        reportRoot: root,
        template,
        runtime,
        model: runtime.getModel("openai", "gpt-4o-mini"),
        transport: {
            kind: "mock-openai",
            fetch: () => async () => {
                requests++;
                return qualificationReviewResponse(text, 2);
            },
        },
        limits: {
            maxInputTokens: 32000,
            maxOutputTokens: 1000,
            timeoutMs: 10000,
        },
        reserve: async () => {},
        settle: async () => {
            throw new Error("Settlement acknowledgement lost");
        },
    });
    assert.equal(result.status, "pending");
    assert.equal(requests, 1);
    assert.equal(
        readFileSync(join(root, "automated-review-report.md"), "utf8"),
        text,
    );
    assert.equal(
        JSON.parse(
            readFileSync(join(root, "automated-review-report.json"), "utf8"),
        ).assessment,
        "pending",
    );
});

test("report filesystem failure stays explicit and cannot prevent known usage settlement", async () => {
    const { runPiCampaignReview } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign-review.ts"
    );
    const { mkdirSync, renameSync } = await import("node:fs");
    const root = mkdtempSync(join(tmpdir(), "campaign-report-io-"));
    const reportRoot = join(root, "reports");
    mkdirSync(reportRoot);
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    const template = campaignReviewTemplate(root);
    const runtime = await qualificationReviewRuntime();
    let settled = 0;
    let requests = 0;
    await assert.rejects(
        runPiCampaignReview({
            root,
            reportRoot,
            template,
            runtime,
            model: runtime.getModel("openai", "gpt-4o-mini"),
            transport: {
                kind: "mock-openai",
                fetch: () => async () => {
                    requests++;
                    renameSync(reportRoot, `${reportRoot}-retained`);
                    writeFileSync(reportRoot, "Directory no longer available");
                    return qualificationReviewResponse(
                        "# Findings\n\nUseful diagnostic before I/O failure.",
                        2,
                    );
                },
            },
            limits: {
                maxInputTokens: 32000,
                maxOutputTokens: 1000,
                timeoutMs: 10000,
            },
            reserve: async () => {},
            settle: async () => {
                settled++;
            },
        }),
        { code: "ENOTDIR" },
    );
    assert.equal(settled, 1);
    assert.equal(requests, 1);
});

for (const shape of ["bare-json", "assessment-only"])
    test(`new investigator requires a developer handoff before accepting assessment (${shape})`, async () => {
        const { runPiCampaignReview } = await import(
            "../../../scripts/evaluations/workbench-browser/campaign-review.ts"
        );
        const root = mkdtempSync(join(tmpdir(), "campaign-review-envelope-"));
        writeFileSync(
            join(root, "campaign-lot.json"),
            JSON.stringify({
                manifest: makeManifest(),
                candidateHash: "b".repeat(64),
                fingerprints: {},
            }),
        );
        writeFileSync(
            join(root, "published.json"),
            "Synthetic retained result.",
        );
        const review = campaignReviewTemplate(root);
        review.cases[0].finding =
            "The saved result matches the captured evidence.";
        review.cases[0].checks["proposed-framing-is-saved"] = "passed";
        review.cases[0].evidence = ["published.json"];
        const appendix = `## Assessment\n\n\`\`\`json\n${JSON.stringify(review)}\n\`\`\``;
        const first = shape === "bare-json" ? JSON.stringify(review) : appendix;
        const report = `# Findings\n\nThe captured result supports the saved finding.\n\n${appendix}`;
        const runtime = await qualificationReviewRuntime();
        let calls = 0;
        let settled = 0;
        const result = await runPiCampaignReview({
            root,
            reportRoot: root,
            template: review,
            runtime,
            model: runtime.getModel("openai", "gpt-4o-mini"),
            transport: {
                kind: "mock-openai",
                fetch: () => async () => {
                    assert(++calls <= 2);
                    return qualificationReviewResponse(
                        calls === 1 ? first : report,
                        2,
                    );
                },
            },
            limits: {
                maxInputTokens: 32000,
                maxOutputTokens: 1000,
                timeoutMs: 10000,
            },
            reserve: async () => {},
            settle: async () => {
                settled++;
            },
        });
        assert.equal(result.status, "completed");
        assert.equal(
            calls,
            2,
            "The new protocol must correct a missing handoff",
        );
        assert.equal(settled, 2);
        assert.equal(
            readFileSync(join(root, "automated-review-report-1.md"), "utf8"),
            first,
        );
        assert.equal(
            readFileSync(join(root, "automated-review-report.md"), "utf8"),
            report,
        );
    });

test("malformed assessment formatting stays within its review deadline", async () => {
    const { runPiCampaignReview } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign-review.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-review-whitespace-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(join(root, "published.json"), "Synthetic captured result.");
    const review = campaignReviewTemplate(root);
    review.cases[0].finding = "The saved result matches the captured evidence.";
    review.cases[0].checks["proposed-framing-is-saved"] = "passed";
    review.cases[0].evidence = ["published.json"];
    const runtime = await qualificationReviewRuntime();
    let calls = 0;
    const deadline = 1000;
    const begun = performance.now();
    const result = await runPiCampaignReview({
        root,
        reportRoot: root,
        template: review,
        runtime,
        model: runtime.getModel("openai", "gpt-4o-mini"),
        transport: {
            kind: "mock-openai",
            fetch: () => async () => {
                assert(++calls <= 2, "Format correction must remain bounded");
                const text =
                    calls === 1
                        ? `# Findings\n\nUseful diagnosis.\n\n## Assessment${"\n".repeat(65536)}not fenced JSON`
                        : `# Findings\n\nThe captured result supports the finding.\n\n## Assessment\n\n\`\`\`json\n${JSON.stringify(review)}\n\`\`\``;
                return qualificationReviewResponse(text, 2);
            },
        },
        limits: {
            maxInputTokens: 200000,
            maxOutputTokens: 1000,
            timeoutMs: deadline,
        },
        reserve: async () => {},
        settle: async () => {},
    });
    assert.equal(result.status, "completed");
    assert.equal(calls, 2);
    assert(
        performance.now() - begun < deadline,
        "Malformed whitespace must not block the review deadline",
    );
});

test("Pi corrects assessment format in its existing session without losing the original report", async () => {
    const { runPiCampaignReview } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign-review.ts"
    );
    const { qualificationReviewPayload } = await import(
        "../setup/qualification-review.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-format-feedback-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(join(root, "published.json"), "The saved framing matches.");
    const template = campaignReviewTemplate(root);
    const review = structuredClone(template);
    review.cases[0].finding =
        "The saved framing matches the inspected evidence.";
    review.cases[0].evidence = ["published.json"];
    review.cases[0].checks["proposed-framing-is-saved"] = "pass";
    const invalid = `# Findings\n\nSaved framing matches.\n\n## Assessment\n\`\`\`json\n${JSON.stringify(review)}\n\`\`\``;
    const runtime = await qualificationReviewRuntime();
    const requests = [];
    const result = await runPiCampaignReview({
        root,
        reportRoot: root,
        template,
        runtime,
        model: runtime.getModel("openai", "gpt-4o-mini"),
        transport: {
            kind: "mock-openai",
            fetch: () => async (_input, init) => {
                const body = await qualificationReviewPayload(init);
                requests.push(body);
                if (requests.length === 3) {
                    assert.match(
                        JSON.stringify(body.input),
                        /Invalid review verdict/,
                    );
                    assert.match(
                        JSON.stringify(body.input),
                        /passed.*failed.*inconclusive/,
                    );
                    review.cases[0].checks["proposed-framing-is-saved"] =
                        "passed";
                }
                const text =
                    requests.length <= 2
                        ? invalid
                        : `# Findings\n\nSaved framing matches.\n\n## Assessment\n\`\`\`json\n${JSON.stringify(review)}\n\`\`\``;
                return qualificationReviewResponse(text, requests.length);
            },
        },
        limits: {
            maxInputTokens: 32000,
            maxOutputTokens: 1000,
            timeoutMs: 10000,
        },
        reserve: async (attempt) =>
            assert(attempt <= 3, "Analysis allowance exhausted"),
        settle: async () => {},
    });
    assert.equal(result.status, "completed");
    assert.equal(
        result.review.cases[0].checks["proposed-framing-is-saved"],
        "passed",
    );
    assert.equal(requests.length, 3);
    assert.equal(
        readFileSync(join(root, "automated-review-report-2.md"), "utf8"),
        invalid,
    );
    assert.match(
        readFileSync(join(root, "automated-review-report.md"), "utf8"),
        /"passed"/,
    );
});

async function reviewerReasoningFixture() {
    const root = mkdtempSync(join(tmpdir(), "campaign-reasoning-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(join(root, "published.json"), "Saved framing matches.");
    const template = campaignReviewTemplate(root);
    const review = structuredClone(template);
    review.cases[0].finding = "Saved framing matches the inspected evidence.";
    review.cases[0].evidence = ["published.json"];
    const runtime = await qualificationReviewRuntime("openai-codex");
    const requests = [];
    const reservations = [];
    const settlements = [];
    return {
        requests,
        reservations,
        settlements,
        options: {
            root,
            reportRoot: root,
            template,
            runtime,
            model: runtime.getModel("openai-codex", "gpt-6.1-sol"),
            transport: {
                kind: "mock-openai",
                fetch: () => async (_input, init) => {
                    const { qualificationReviewPayload } = await import(
                        "../setup/qualification-review.ts"
                    );
                    requests.push(await qualificationReviewPayload(init));
                    return qualificationReviewResponse(
                        qualificationReviewReport(review),
                        requests.length,
                    );
                },
            },
            limits: { maxInputTokens: 32000, timeoutMs: 10000 },
            reserve: async (attempt) => reservations.push(attempt),
            settle: async (attempt) => settlements.push(attempt),
        },
    };
}

async function withReviewerReasoningProject(
    run,
    { environment, shared, linked = false } = {},
) {
    const cwd = process.cwd();
    const previous = process.env.WORKBENCH_REVIEW_REASONING;
    const project = mkdtempSync(join(tmpdir(), "reviewer-project-"));
    execFileSync("git", ["init", "-q", project], {
        env: {
            ...process.env,
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_NOSYSTEM: "1",
        },
    });
    const resources = ".agents/skills/workbench-evaluation/references";
    mkdirSync(join(project, resources), { recursive: true });
    copyFileSync(
        join(cwd, resources, "reviewer-mission.md"),
        join(project, resources, "reviewer-mission.md"),
    );
    if (shared !== undefined)
        writeFileSync(
            join(project, ".env.local"),
            `WORKBENCH_REVIEW_REASONING=${shared}\n`,
        );
    let selected = project;
    if (linked) {
        const gitEnv = {
            ...process.env,
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_NOSYSTEM: "1",
        };
        execFileSync(
            "git",
            [
                "-C",
                project,
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.com",
                "-c",
                "commit.gpgsign=false",
                "-c",
                "core.hooksPath=/dev/null",
                "commit",
                "--allow-empty",
                "-qm",
                "fixture",
            ],
            { env: gitEnv },
        );
        selected = join(project, "linked");
        execFileSync(
            "git",
            [
                "-C",
                project,
                "worktree",
                "add",
                "--detach",
                "-q",
                selected,
                "HEAD",
            ],
            { env: gitEnv },
        );
        mkdirSync(join(selected, resources), { recursive: true });
        copyFileSync(
            join(cwd, resources, "reviewer-mission.md"),
            join(selected, resources, "reviewer-mission.md"),
        );
        writeFileSync(
            join(selected, ".env.local"),
            "WORKBENCH_REVIEW_REASONING=xhigh\n",
        );
    }
    if (environment === undefined)
        delete process.env.WORKBENCH_REVIEW_REASONING;
    else process.env.WORKBENCH_REVIEW_REASONING = environment;
    process.chdir(selected);
    try {
        return await run(project);
    } finally {
        process.chdir(cwd);
        if (previous === undefined)
            delete process.env.WORKBENCH_REVIEW_REASONING;
        else process.env.WORKBENCH_REVIEW_REASONING = previous;
    }
}

for (const pinChange of [
    {
        label: "missing policy",
        field: "resourcePolicy",
        value: undefined,
        reason: "resource_policy_unsupported",
    },
    {
        label: "unsupported policy",
        field: "resourcePolicy",
        value: "unsupported_policy",
        reason: "resource_policy_unsupported",
    },
    {
        label: "missing reasoning",
        field: "reasoning",
        value: undefined,
        reason: "reviewer_pin_incomplete",
    },
    {
        label: "missing deadline",
        field: "deadlineAt",
        value: undefined,
        reason: "reviewer_pin_incomplete",
    },
    {
        label: "expired deadline",
        field: "deadlineAt",
        value: 1,
        reason: "execution_deadline",
    },
    {
        label: "missing model",
        field: "model",
        value: undefined,
        reason: "reviewer_pin_incomplete",
    },
    {
        label: "changed model capacity",
        field: "model",
        value: {
            provider: "openai-codex",
            id: "gpt-6.1-sol",
            api: "openai-codex-responses",
            contextWindow: 1,
            maxTokens: 1,
        },
        reason: "reviewer_model_changed",
    },
])
    test(`retained reviewer pin with ${pinChange.label} blocks continuation without rewriting evidence or dispatching`, async () => {
        const { runPiCampaignReview } = await import(
            "../../../scripts/evaluations/workbench-browser/campaign-review.ts"
        );
        const fixture = await reviewerReasoningFixture();
        await withReviewerReasoningProject(async () => {
            assert.equal(
                (await runPiCampaignReview(fixture.options)).status,
                "completed",
            );
            const pinPath = join(
                fixture.options.root,
                "automated-review-mission.json",
            );
            const pin = JSON.parse(readFileSync(pinPath, "utf8"));
            pin[pinChange.field] = pinChange.value;
            writeFileSync(pinPath, JSON.stringify(pin));
            const original = readFileSync(pinPath);
            const requests = fixture.requests.length;
            const reservations = [...fixture.reservations];
            const settlements = [...fixture.settlements];
            assert.deepEqual(await runPiCampaignReview(fixture.options), {
                status: "pending",
                reason: pinChange.reason,
            });
            assert.equal(fixture.requests.length, requests);
            assert.deepEqual(fixture.reservations, reservations);
            assert.deepEqual(fixture.settlements, settlements);
            assert.deepEqual(readFileSync(pinPath), original);
        });
    });

test("reviewer reasoning defaults to high in the native Codex request", async () => {
    const { runPiCampaignReview } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign-review.ts"
    );
    const fixture = await reviewerReasoningFixture();
    await withReviewerReasoningProject(async () => {
        const result = await runPiCampaignReview(fixture.options);
        assert.equal(result.status, "completed");
        assert.equal(fixture.requests[0].reasoning.effort, "high");
        assert.equal(fixture.requests.length, 2);
        assert.deepEqual(fixture.settlements, [1, 2]);
        const pin = JSON.parse(
            readFileSync(
                join(fixture.options.root, "automated-review-mission.json"),
                "utf8",
            ),
        );
        assert.deepEqual(pin.reasoning, {
            requested: "high",
            effective: "high",
        });
    });
});

test("reviewer reasoning defaults with an unrelated shared setting without loading it", async () => {
    const { runPiCampaignReview } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign-review.ts"
    );
    const fixture = await reviewerReasoningFixture();
    const previous = process.env.UNRELATED_REVIEWER_SETTING;
    await withReviewerReasoningProject(async (project) => {
        writeFileSync(
            join(project, ".env.local"),
            "UNRELATED_REVIEWER_SETTING=EXCLUDED_ENV_SENTINEL\n",
        );
        const result = await runPiCampaignReview(fixture.options);
        assert.equal(result.status, "completed");
        assert.equal(fixture.requests[0].reasoning.effort, "high");
        assert.equal(process.env.UNRELATED_REVIEWER_SETTING, previous);
        assert.doesNotMatch(
            JSON.stringify(fixture.requests),
            /EXCLUDED_ENV_SENTINEL/,
        );
    });
});

test("reviewer reasoning uses process configuration before the shared file", async () => {
    const { runPiCampaignReview } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign-review.ts"
    );
    const fixture = await reviewerReasoningFixture();
    await withReviewerReasoningProject(
        async () => {
            const result = await runPiCampaignReview(fixture.options);
            assert.equal(result.status, "completed");
            assert.deepEqual(
                fixture.requests.map((request) => request.reasoning.effort),
                ["medium", "medium"],
            );
        },
        { environment: "medium", shared: "high" },
    );
});

test("reviewer reasoning reads the shared main-worktree file from a linked checkout", async () => {
    const { runPiCampaignReview } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign-review.ts"
    );
    const fixture = await reviewerReasoningFixture();
    await withReviewerReasoningProject(
        async () => {
            const result = await runPiCampaignReview(fixture.options);
            assert.equal(result.status, "completed");
            assert.deepEqual(
                fixture.requests.map((request) => request.reasoning.effort),
                ["medium", "medium"],
            );
        },
        { shared: "medium", linked: true },
    );
});

test("reviewer reasoning reports shared configuration I/O failure without dispatch", async () => {
    const { runPiCampaignReview } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign-review.ts"
    );
    const fixture = await reviewerReasoningFixture();
    await withReviewerReasoningProject(async (project) => {
        mkdirSync(join(project, ".env.local"));
        await assert.rejects(runPiCampaignReview(fixture.options), (error) => {
            assert.match(
                error.message,
                /Cannot read shared reviewer reasoning configuration/,
            );
            assert.equal(error.cause?.code, "EISDIR");
            return true;
        });
        assert.deepEqual(fixture.reservations, []);
        assert.deepEqual(fixture.requests, []);
        assert.equal(
            existsSync(
                join(fixture.options.root, "automated-review-mission.json"),
            ),
            false,
        );
    });
});

for (const invalid of ["", "hgh", "off"])
    test(`reviewer reasoning blocks invalid or unsupported selection ${JSON.stringify(invalid)}`, async () => {
        const { runPiCampaignReview } = await import(
            "../../../scripts/evaluations/workbench-browser/campaign-review.ts"
        );
        const fixture = await reviewerReasoningFixture();
        await withReviewerReasoningProject(
            async () => {
                const result = await runPiCampaignReview(fixture.options);
                assert.deepEqual(result, {
                    status: "pending",
                    reason: "reviewer_reasoning_unavailable",
                });
                assert.deepEqual(fixture.reservations, []);
                assert.deepEqual(fixture.requests, []);
                assert.equal(
                    existsSync(
                        join(
                            fixture.options.root,
                            "automated-review-mission.json",
                        ),
                    ),
                    false,
                );
            },
            { environment: invalid },
        );
    });

for (const provider of ["openai", "openai-codex"])
    test(`investigator receives its mission and searches archived source through Pi (${provider})`, async () => {
        const { runPiCampaignReview } = await import(
            "../../../scripts/evaluations/workbench-browser/campaign-review.ts"
        );
        const { qualificationReviewPayload } = await import(
            "../setup/qualification-review.ts"
        );
        const { mkdirSync } = await import("node:fs");
        const root = mkdtempSync(
            join(tmpdir(), "campaign-investigator-tools-"),
        );
        writeFileSync(
            join(root, "campaign-lot.json"),
            JSON.stringify({
                manifest: makeManifest(),
                candidateHash: "b".repeat(64),
                fingerprints: {},
            }),
        );
        writeFileSync(
            join(root, "campaign-result.json"),
            JSON.stringify({ completed: false, cleanupCompleted: true }),
        );
        writeFileSync(
            join(root, "reconciliation.json"),
            JSON.stringify({ reconciled: false, usage: { model: 9 } }),
        );
        mkdirSync(join(root, "code"));
        writeFileSync(
            join(root, "code", "owner.ts"),
            "export const reportedCostFinal = false;\n",
        );
        const template = campaignReviewTemplate(root);
        const review = structuredClone(template);
        review.cases[0].finding =
            "The finality flag is false; inspect its source owner.";
        review.cases[0].evidence = ["code/owner.ts"];
        const runtime = await qualificationReviewRuntime(provider);
        process.env.WORKBENCH_REVIEW_REASONING =
            provider === "openai-codex" ? "low" : "off";
        let requests = 0;
        const result = await runPiCampaignReview({
            root,
            reportRoot: root,
            template,
            runtime,
            model: runtime.getModel(
                provider,
                provider === "openai" ? "gpt-4o-mini" : "gpt-6.1-sol",
            ),
            transport: {
                kind: "mock-openai",
                fetch: () => async (_input, init) => {
                    const body = await qualificationReviewPayload(init);
                    const serialized = JSON.stringify(body);
                    requests++;
                    if (requests === 1) {
                        assert.match(serialized, /grep/);
                        assert.match(
                            serialized,
                            /Qualify the protected Workbench path/,
                        );
                        assert.match(serialized, /source-supported/);
                        assert.match(serialized, /reconciled/);
                        assert.doesNotMatch(
                            serialized,
                            /"name":"(?:bash|write|edit)"/,
                        );
                    } else {
                        assert.match(serialized, /code\/owner\.ts/);
                        assert.match(serialized, /reportedCostFinal = false/);
                    }
                    return qualificationReviewResponse(
                        qualificationReviewReport(review),
                        requests,
                        requests === 1
                            ? {
                                  name: "grep",
                                  arguments: {
                                      pattern: "reportedCostFinal",
                                      literal: true,
                                      path: "code",
                                  },
                              }
                            : null,
                    );
                },
            },
            limits: {
                maxInputTokens: 32000,
                maxOutputTokens: 1000,
                timeoutMs: 10000,
            },
            reserve: async (attempt) => assert(attempt <= 2),
            settle: async () => {},
        });
        assert.equal(result.status, "completed");
        assert.equal(requests, 2);
    });

test("real Pi OpenAI transport does not retry a mocked HTTP 503 when retries are disabled", async () => {
    const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
    const root = mkdtempSync(join(tmpdir(), "campaign-openai-transport-"));
    const runtime = await ModelRuntime.create({
        authPath: join(root, "auth.json"),
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
    });
    const model = runtime.getModel("openai", "gpt-4o-mini");
    assert.ok(model);
    await runtime.setRuntimeApiKey("openai", "sk-synthetic-test-key");
    let calls = 0;
    const stream = runtime.streamSimple(
        model,
        {
            messages: [
                { role: "user", content: "test", timestamp: Date.now() },
            ],
        },
        {
            maxRetries: 0,
            fetch: async () => {
                calls++;
                return new Response("unavailable", { status: 503 });
            },
        },
    );
    const result = await stream.result();
    assert.equal(result.stopReason, "error");
    assert.equal(calls, 1);
});

test("Pi reviewer does not continue after settlement fails", async () => {
    const pi = await import("@earendil-works/pi-coding-agent");
    const { dirname } = await import("node:path");
    const { fileURLToPath, pathToFileURL } = await import("node:url");
    const sdkDir = dirname(
        fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
    );
    const ai = await import(
        pathToFileURL(join(sdkDir, "../../pi-ai/dist/index.js")).href
    );
    const { runPiCampaignReview } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign-review.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-pi-settlement-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(join(root, "published.json"), "captured evidence");
    const template = campaignReviewTemplate(root);
    const faux = ai.fauxProvider();
    const runtime = await pi.ModelRuntime.create({
        authPath: join(root, "auth.json"),
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
    });
    runtime.registerNativeProvider(faux.provider);
    faux.setResponses([
        ai.fauxAssistantMessage(
            [ai.fauxToolCall("read", { path: "published.json" })],
            { stopReason: "toolUse" },
        ),
        ai.fauxAssistantMessage("unexpected"),
    ]);
    const result = await runPiCampaignReview({
        root,
        template,
        runtime,
        model: faux.getModel(),
        transport: "mock",
        limits: {
            maxInputTokens: 10000,
            maxOutputTokens: 1000,
            timeoutMs: 10000,
        },
        reserve: async () => {},
        settle: async () => {
            throw new Error("settlement unavailable");
        },
    });
    assert.equal(result.status, "pending");
    assert.equal(faux.state.callCount, 1);
});

test("Pi reviewer fails closed when a later model reservation is denied", async () => {
    const pi = await import("@earendil-works/pi-coding-agent");
    const { dirname } = await import("node:path");
    const { fileURLToPath, pathToFileURL } = await import("node:url");
    const sdkDir = dirname(
        fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
    );
    const ai = await import(
        pathToFileURL(join(sdkDir, "../../pi-ai/dist/index.js")).href
    );
    const { runPiCampaignReview } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign-review.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-pi-reservation-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(join(root, "published.json"), "captured evidence");
    const faux = ai.fauxProvider();
    const runtime = await pi.ModelRuntime.create({
        authPath: join(root, "auth.json"),
        modelsPath: null,
        modelsStorePath: join(root, "models.json"),
        allowModelNetwork: false,
        refreshOnCreate: false,
    });
    runtime.registerNativeProvider(faux.provider);
    faux.setResponses([
        ai.fauxAssistantMessage(
            [ai.fauxToolCall("read", { path: "published.json" })],
            { stopReason: "toolUse" },
        ),
        ai.fauxAssistantMessage("unexpected"),
    ]);
    const attempts = [];
    const result = await runPiCampaignReview({
        root,
        template: campaignReviewTemplate(root),
        runtime,
        model: faux.getModel(),
        transport: "mock",
        limits: {
            maxInputTokens: 10000,
            maxOutputTokens: 1000,
            timeoutMs: 10000,
        },
        reserve: async (attempt) => {
            attempts.push(attempt);
            if (attempt === 2) throw new Error("allowance exhausted");
        },
        settle: async () => {},
    });
    assert.equal(result.status, "pending");
    assert.deepEqual(attempts, [1, 2]);
    assert.equal(faux.state.callCount, 1);
});

test("automated review rejects a symlink even when it was indexed", () => {
    const root = mkdtempSync(join(tmpdir(), "campaign-review-symlink-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(
        join(root, "campaign-result.json"),
        JSON.stringify({ completed: true, cleanupCompleted: true }),
    );
    writeFileSync(join(root, "published.json"), "captured");
    symlinkSync("published.json", join(root, "link.json"));
    const review = campaignReviewTemplate(root);
    review.cases[0].finding = "The requested observation is available.";
    review.cases[0].evidence = ["link.json"];
    assert.throws(
        () => validateCampaignReview(root, review, { reviewer: "automated" }),
        /symlink/,
    );
});

test("recovery excludes automated review artifacts from the next evidence revision", () => {
    const root = mkdtempSync(join(tmpdir(), "campaign-review-artifacts-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(
        join(root, "campaign-result.json"),
        JSON.stringify({ completed: true, cleanupCompleted: true }),
    );
    const first = campaignReviewTemplate(root);
    writeFileSync(join(root, "review-template.json"), JSON.stringify(first));
    writeFileSync(join(root, "automated-review-journal.jsonl"), "{}\n");
    writeFileSync(join(root, "automated-review-result-abc.json"), "{}\n");
    const second = campaignReviewTemplate(root, { recovery: true });
    assert.equal(second.evidenceHash, first.evidenceHash);
});

test("a simulated review with incomplete cleanup stays pending without altering mechanical evidence", async () => {
    const { runSimulatedCampaignReview } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-simulated-review-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    const mechanical = JSON.stringify({
        completed: true,
        cleanupCompleted: false,
        diagnostics: ["cleanup failed"],
    });
    writeFileSync(join(root, "campaign-result.json"), mechanical);
    const template = campaignReviewTemplate(root);
    const result = runSimulatedCampaignReview(root, {
        evidenceHash: template.evidenceHash,
    });
    assert.equal(result.status, "pending");
    assert.equal(
        readFileSync(join(root, "campaign-result.json"), "utf8"),
        mechanical,
    );
    assert.equal(existsSync(join(root, "automated-review-intent.json")), true);
    const statusPath = join(root, "automated-review-status.jsonl");
    const firstStatus = readFileSync(statusPath, "utf8");
    assert.equal(JSON.parse(firstStatus).status, "pending");
    runSimulatedCampaignReview(root, { evidenceHash: template.evidenceHash });
    assert.equal(readFileSync(statusPath, "utf8"), firstStatus);
});

test("a simulated review retains an evidence-bound result without assessing the lot", async () => {
    const { runSimulatedCampaignReview } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-simulated-complete-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(
        join(root, "campaign-result.json"),
        JSON.stringify({ completed: true, cleanupCompleted: true }),
    );
    writeFileSync(
        join(root, "captured.json"),
        JSON.stringify({ saved: false }),
    );
    const review = campaignReviewTemplate(root);
    review.cases[0].checks["proposed-framing-is-saved"] = "failed";
    review.cases[0].finding = "The captured framing was not saved.";
    review.cases[0].evidence = ["captured.json"];
    const result = runSimulatedCampaignReview(root, {
        evidenceHash: review.evidenceHash,
        review,
    });
    assert.equal(result.status, "completed");
    assert.deepEqual(
        JSON.parse(
            readFileSync(join(root, "automated-review-result.json"), "utf8"),
        ).review,
        review,
    );
    assert.equal(existsSync(join(root, "assessment.json")), false);
    assert.equal(
        runSimulatedCampaignReview(root, {
            evidenceHash: review.evidenceHash,
            review,
        }).status,
        "completed",
    );
    const changed = structuredClone(review);
    changed.cases[0].finding = "A conflicting observation was submitted.";
    assert.throws(
        () =>
            runSimulatedCampaignReview(root, {
                evidenceHash: review.evidenceHash,
                review: changed,
            }),
        /result changed/,
    );
});

test("an interrupted simulated dispatch remains pending and is never replayed", async () => {
    const { runSimulatedCampaignReview } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "campaign-simulated-interrupted-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(
        join(root, "campaign-result.json"),
        JSON.stringify({ completed: true, cleanupCompleted: true }),
    );
    writeFileSync(join(root, "captured.json"), "captured");
    const template = campaignReviewTemplate(root);
    const first = runSimulatedCampaignReview(root, {
        evidenceHash: template.evidenceHash,
        simulatedOutcome: "unknown",
    });
    assert.equal(first.status, "pending");
    assert.equal(first.reason, "unknown_dispatch_outcome");
    const journalPath = join(root, "automated-review-attempt.json");
    const retained = readFileSync(journalPath, "utf8");
    const second = runSimulatedCampaignReview(root, {
        evidenceHash: template.evidenceHash,
        simulatedOutcome: "unknown",
    });
    assert.equal(second.status, "pending");
    assert.equal(readFileSync(journalPath, "utf8"), retained);
});

test("the qualification lock stays held until cleanup releases it", async () => {
    const root = mkdtempSync(join(tmpdir(), "campaign-lock-"));
    const lock = join(root, "lock");
    const release = await acquireCampaignLock(lock);
    await assert.rejects(acquireCampaignLock(lock), /active/);
    await release();
    await (await acquireCampaignLock(lock))();
});

for (const legacy of [false, true]) {
    test(`recovery freezes a new evidence revision and preserves failed history (legacy=${legacy})`, () => {
        const root = mkdtempSync(join(tmpdir(), "campaign-recovery-review-"));
        writeFileSync(
            join(root, "campaign-lot.json"),
            JSON.stringify({
                manifest: makeManifest(),
                candidateHash: "b".repeat(64),
                fingerprints: {},
            }),
        );
        const resultPath = join(root, "campaign-result.json");
        const reconciliationPath = join(root, "reconciliation.json");
        const sourcePath = join(root, "evidence-index-source.txt");
        writeFileSync(sourcePath, "Raw evidence");
        writeFileSync(
            resultPath,
            JSON.stringify({
                completed: false,
                cleanupCompleted: false,
                failure: "Timeout during initialization",
            }),
        );
        writeFileSync(
            reconciliationPath,
            JSON.stringify({ reconciled: false }),
        );
        const first = campaignReviewTemplate(root);
        writeFileSync(
            join(root, "review-template.json"),
            JSON.stringify(first),
        );
        if (legacy) {
            unlinkSync(join(root, `evidence-index-${first.evidenceHash}.json`));
            unlinkSync(
                join(root, `review-template-${first.evidenceHash}.json`),
            );
        }
        const originalIndex = readFileSync(
            join(root, "evidence-index.json"),
            "utf8",
        );
        writeFileSync(
            resultPath,
            JSON.stringify({
                completed: false,
                cleanupCompleted: true,
                failure: "Timeout during initialization",
            }),
        );
        writeFileSync(reconciliationPath, JSON.stringify({ reconciled: true }));
        assert.throws(
            () => campaignReviewTemplate(root),
            /Stale campaign evidence/,
        );

        const recovered = campaignReviewTemplate(root, { recovery: true });
        assert.notEqual(recovered.evidenceHash, first.evidenceHash);
        assert.equal(
            readFileSync(join(root, "evidence-index.json"), "utf8"),
            originalIndex,
        );
        assert(
            existsSync(join(root, `evidence-index-${first.evidenceHash}.json`)),
        );
        assert(
            existsSync(
                join(root, `evidence-index-${recovered.evidenceHash}.json`),
            ),
        );
        writeFileSync(
            join(root, "review-template.json"),
            JSON.stringify(recovered),
        );
        assert.throws(
            () => assessCampaignLot(root, first),
            /Stale campaign review/,
        );
        for (const c of recovered.cases) {
            c.checks = Object.fromEntries(
                Object.keys(c.checks).map((key) => [key, "passed"]),
            );
            c.finding =
                "Cleanup recovered, but the original execution failure remains.";
            c.evidence = ["campaign-result.json", "reconciliation.json"];
        }
        assert.equal(assessCampaignLot(root, recovered).verdict, "failed");
        writeFileSync(sourcePath, "Changed raw evidence");
        assert.throws(
            () => campaignReviewTemplate(root),
            /Stale campaign evidence/,
        );
        writeFileSync(sourcePath, "Raw evidence");
        writeFileSync(
            reconciliationPath,
            JSON.stringify({ reconciled: false }),
        );
        assert.throws(
            () => campaignReviewTemplate(root),
            /Stale campaign evidence/,
        );
    });
}

import { sourcesBatterySchema } from "../../../scripts/evaluations/workbench-browser/protocol.ts";

test("a Sources protocol records lower search and acquisition allowances without claiming the maxima", () => {
    const battery = JSON.parse(
        readFileSync(
            "scripts/evaluations/workbench-browser/sources-cases.json",
            "utf8",
        ),
    );
    assert.equal(
        sourcesBatterySchema.safeParse({
            ...battery,
            maximumSearchAttempts: 1,
            maximumAcquisitions: 2,
        }).success,
        true,
    );
});

test("a retained execution failure blocks acceptance even when an earlier completion flag is true", () => {
    const root = mkdtempSync(join(tmpdir(), "campaign-failure-review-"));
    writeFileSync(
        join(root, "campaign-lot.json"),
        JSON.stringify({
            manifest: makeManifest(),
            candidateHash: "b".repeat(64),
            fingerprints: {},
        }),
    );
    writeFileSync(
        join(root, "campaign-result.json"),
        JSON.stringify({
            completed: true,
            cleanupCompleted: true,
            failure: "Candidate changed after the browser scenarios completed",
        }),
    );
    const review = campaignReviewTemplate(root);
    for (const c of review.cases) {
        c.checks = Object.fromEntries(
            Object.keys(c.checks).map((key) => [key, "passed"]),
        );
        c.finding = "Published evidence meets the declared expectation.";
        c.evidence = ["campaign-result.json"];
    }
    assert.equal(assessCampaignLot(root, review).verdict, "failed");
});
