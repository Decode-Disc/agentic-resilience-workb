import assert from "node:assert/strict";
import test from "node:test";
import { campaignManifestSchema } from "../../../convex/qualificationCampaignPolicy.ts";
import { qualificationReviewResponse } from "../setup/qualification-review.ts";

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

test("a campaign cannot silently default its spending allowance or expiration", () => {
    assert.equal(
        campaignManifestSchema.safeParse({ objective: "Qualify Sources" })
            .success,
        false,
    );
});

import {
    existsSync,
    mkdtempSync,
    readFileSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCampaign } from "../../../scripts/evaluations/workbench-browser/campaign.ts";
import { sha256 } from "../../../scripts/evaluations/workbench-browser/protocol.ts";

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
    "unknown",
    "denied",
    "503",
    "assess-ack",
    "unqualified",
    "tampered",
    "foreign-candidate",
])
    test(`campaign command review handles ${fault}`, async () => {
        const retained = fault === "retained";
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
                routes: [{ provider: "openai", model: "gpt-4o-mini" }],
                maxRequestCostMicros: 100000,
                perLot: { requests: 3, costMicros: 300000 },
                total: { requests: 6, costMicros: 600000 },
                maxInputTokens: 32000,
                maxOutputTokens: 1000,
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
        review.cases[0].checks["proposed-framing-is-saved"] = "passed";
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
        let allocation = { requests: 0, costMicros: 0 };
        mock.method(client, "query", async (reference) => {
            assert.equal(
                getFunctionName(reference),
                "qualificationCampaigns:inspect",
            );
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
                assert.equal(args.reservationMicros, 100000);
                if (fault === "denied")
                    throw new Error("Analysis allowance exhausted");
                allocation = {
                    requests: allocation.requests + 1,
                    costMicros: allocation.costMicros + args.reservationMicros,
                };
            }
            if (
                name.endsWith(":settleAnalysis") &&
                ["settlement", "tampered"].includes(fault) &&
                !interrupted
            ) {
                interrupted = true;
                throw new Error("settlement acknowledgement lost");
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
        const boundaries = {
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
                fetch: async (_url, init) => {
                    dispatches++;
                    if (fault === "unknown")
                        throw new Error("connection lost after dispatch");
                    if (fault === "503")
                        return new Response("unavailable", { status: 503 });
                    const body = JSON.parse(init.body);
                    assert.equal(body.model, "gpt-4o-mini");
                    assert.equal(body.max_output_tokens, 1000);
                    assert.match(
                        JSON.stringify(
                            body.tools.find((tool) => tool.name === "read")
                                .parameters.properties.offset,
                        ),
                        /byte position/,
                    );
                    if (dispatches === 2)
                        assert.match(
                            JSON.stringify(body.input),
                            /retained evidence/,
                        );
                    return qualificationReviewResponse(
                        JSON.stringify(review),
                        dispatches,
                    );
                },
            },
        };
        const exitCode = process.exitCode;
        try {
            if (fault === "unqualified") boundaries.reviewTransport = undefined;
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
                await run();
                assert.equal(dispatches, 1);
                assert.equal(lot.status, "review");
                assert.equal(archives, 0);
                return;
            }
            if (fault === "unqualified") {
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
                    { status: "pending", reason: "live_transport_unqualified" },
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
            if (fault === "settlement" || fault === "assess-ack") await run();
            assert.equal(
                lot.status,
                "finished",
                JSON.stringify({
                    dispatches,
                    operations,
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
            assert.equal(archives, fault === "assess-ack" ? 2 : 1);
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
                    costMicros: 200000,
                });
            }
            assert.equal(
                readFileSync(join(lotRoot, "campaign-result.json"), "utf8"),
                frozen,
            );
        } finally {
            process.exitCode = exitCode;
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
    faux.setResponses([ai.fauxAssistantMessage(JSON.stringify(review))]);
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
                return ai.fauxAssistantMessage(JSON.stringify(review));
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
    await runtime.setRuntimeApiKey("openai", "synthetic-test-key");
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
