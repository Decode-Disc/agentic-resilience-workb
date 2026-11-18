import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openQualificationJournal } from "../../../scripts/evaluations/workbench-browser/journal.ts";

test("resuming an unfinished scenario preserves its identity and refuses another dispatch", () => {
    const root = mkdtempSync(join(tmpdir(), "qualification-journal-"));
    try {
        const journal = openQualificationJournal(root, {
            batteryHash: "one",
            mode: "live",
        });
        journal.begin("refinement");
        const reopened = openQualificationJournal(root, {
            batteryHash: "one",
            mode: "live",
        });
        assert.throws(
            () => reopened.begin("refinement"),
            /Unfinished scenario/,
        );
        assert.throws(
            () =>
                openQualificationJournal(root, {
                    batteryHash: "two",
                    mode: "live",
                }),
            /Protocol changed/,
        );
        assert.equal(
            readFileSync(join(root, "progress.jsonl"), "utf8")
                .trim()
                .split("\n").length,
            1,
        );
    } finally {
        rmSync(root, { recursive: true });
    }
});

for (const accounting of [
    "legacy_numeric",
    "legacy_api",
    "api_cost",
    "native_subscription",
])
    test(`analysis attempts retain ${accounting} intent and receipt across recovery without redispatch`, () => {
        const root = mkdtempSync(
            join(tmpdir(), "qualification-review-journal-"),
        );
        const protocol = { mode: "live" };
        const identity = {
            campaignId: "campaign",
            lotId: "lot",
            mandateHash: "a".repeat(64),
            candidateHash: "b".repeat(64),
            evidenceHash: "c".repeat(64),
            provider: "openai",
            model: "fixture",
            attemptKey: "first",
        };
        const journal = openQualificationJournal(root, protocol);
        journal.beginAnalysis(identity);
        const reopened = openQualificationJournal(root, protocol);
        assert.throws(
            () => reopened.beginAnalysis(identity),
            /outcome unknown/i,
        );
        assert.equal(reopened.analysisAttempts()[0].status, "unknown");
        const receipt = {
            input: 12,
            output: 3,
            ...(accounting === "native_subscription"
                ? { accounting }
                : accounting === "api_cost"
                  ? {
                        accounting,
                        costMicros: 15,
                        costUsd: 0.000015,
                        costBasis: "sdk_estimate",
                        pricingHash: "e".repeat(64),
                        cacheRead: 5,
                        cacheWrite: 0,
                        observationHash: "f".repeat(64),
                    }
                  : accounting === "legacy_api"
                    ? { accounting: "api_cost", costMicros: 15 }
                    : { costMicros: 15 }),
        };
        reopened.finishAnalysis(identity, receipt);
        reopened.finishAnalysis(identity, receipt);
        assert.throws(
            () =>
                reopened.finishAnalysis(identity, {
                    ...receipt,
                    output: 4,
                }),
            /conflict/i,
        );
        assert.throws(
            () =>
                reopened.beginAnalysis({
                    ...identity,
                    evidenceHash: "d".repeat(64),
                }),
            /conflict/i,
        );
        const finished = openQualificationJournal(root, protocol);
        assert.deepEqual(finished.analysisAttempts()[0].receipt, receipt);
        if (accounting === "api_cost")
            for (const change of [
                { costBasis: "provider_reported" },
                { pricingHash: "a".repeat(64) },
                { cacheRead: 6 },
                { cacheWrite: 1 },
            ])
                assert.throws(
                    () =>
                        finished.finishAnalysis(identity, {
                            ...receipt,
                            ...change,
                        }),
                    /conflict/i,
                );
        if (accounting === "native_subscription")
            assert.throws(
                () =>
                    finished.finishAnalysis(identity, {
                        ...receipt,
                        costMicros: 0,
                    }),
                /invalid/i,
            );
        assert.throws(
            () => finished.beginAnalysis(identity),
            /already completed/i,
        );
        assert.equal(finished.results().length, 0);
    });

test("analysis settlement acknowledgements survive reopening without acknowledging unknown work", () => {
    const root = mkdtempSync(join(tmpdir(), "qualification-settlement-ack-"));
    try {
        const protocol = { mode: "live" };
        const journal = openQualificationJournal(root, protocol);
        const identity = {
            campaignId: "campaign",
            lotId: "lot",
            mandateHash: "a".repeat(64),
            candidateHash: "b".repeat(64),
            evidenceHash: "c".repeat(64),
            provider: "openai",
            model: "fixture",
            attemptKey: "first",
        };
        journal.beginAnalysis(identity);
        assert.throws(
            () => journal.acknowledgeAnalysisSettlement(identity),
            /conflict/i,
        );
        journal.finishAnalysis(identity, {
            input: 12,
            output: 3,
            costMicros: 15,
            observationHash: "d".repeat(64),
        });
        assert.equal(journal.analysisAttempts()[0].settled, undefined);
        assert.throws(
            () =>
                journal.acknowledgeAnalysisSettlement({
                    ...identity,
                    lotId: "foreign",
                }),
            /conflict/i,
        );
        journal.acknowledgeAnalysisSettlement(identity);
        const reopened = openQualificationJournal(root, protocol);
        reopened.acknowledgeAnalysisSettlement(identity);
        assert.equal(reopened.analysisAttempts()[0].settled, true);
        assert.equal(
            readFileSync(join(root, "progress.jsonl"), "utf8")
                .trim()
                .split("\n")
                .map(JSON.parse)
                .filter((entry) => entry.event === "analysis_settled").length,
            1,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("analysis journal treats reordered identities as the same and rejects invalid records", () => {
    const root = mkdtempSync(
        join(tmpdir(), "qualification-analysis-validation-"),
    );
    const journal = openQualificationJournal(root, { mode: "live" });
    const identity = {
        campaignId: "campaign",
        lotId: "lot",
        mandateHash: "a".repeat(64),
        candidateHash: "b".repeat(64),
        evidenceHash: "c".repeat(64),
        provider: "openai",
        model: "fixture",
        attemptKey: "first",
    };
    journal.beginAnalysis(identity);
    const reordered = {
        attemptKey: identity.attemptKey,
        model: identity.model,
        provider: identity.provider,
        evidenceHash: identity.evidenceHash,
        candidateHash: identity.candidateHash,
        mandateHash: identity.mandateHash,
        lotId: identity.lotId,
        campaignId: identity.campaignId,
    };
    journal.finishAnalysis(reordered, { costMicros: 3, output: 2, input: 1 });
    journal.finishAnalysis(identity, { input: 1, output: 2, costMicros: 3 });
    assert.throws(
        () =>
            journal.beginAnalysis({
                ...identity,
                attemptKey: "",
                evidenceHash: "../../bad",
            }),
        /invalid/i,
    );
    assert.throws(
        () =>
            journal.finishAnalysis(identity, {
                input: -1,
                output: 2,
                costMicros: 3,
            }),
        /invalid/i,
    );
});

test("a completed scenario is retained on resume and is never submitted again", () => {
    const root = mkdtempSync(join(tmpdir(), "qualification-journal-"));
    try {
        const journal = openQualificationJournal(root, {
            mode: "deterministic",
        });
        journal.begin("reload");
        journal.finish("reload", {
            executionIntegrity: "passed",
            semanticTask: "not_assessed",
        });
        const reopened = openQualificationJournal(root, {
            mode: "deterministic",
        });
        assert.equal(reopened.begin("reload"), false);
        assert.equal(reopened.results()[0].semanticTask, "not_assessed");
    } finally {
        rmSync(root, { recursive: true });
    }
});

const {
    cleanupQualification,
    qualificationDiagnostic,
    malformedOutcome,
    attemptMissions,
} = await import(
    "../../../scripts/evaluations/workbench-browser/qualification.ts"
);

test("disk exhaustion cannot prevent any revocation, even when closing the browser also fails", async () => {
    const attempted = [];
    const full = () => {
        throw Object.assign(new Error("secret-value"), { code: "ENOSPC" });
    };
    const diagnostics = await cleanupQualification({
        disableRelay: full,
        captureFinal: full,
        closeContext: () => {
            attempted.push("context");
        },
        closeBrowser: () => {
            attempted.push("browser");
            throw new Error("secret");
        },
        closeRelay: () => {
            attempted.push("relay");
        },
        restoreFlags: ["E2E_FIXTURES_ENABLED", "WORKBENCH_AGENT_ENABLED"].map(
            (name) => ({
                name,
                restore: () => {
                    attempted.push(name);
                },
            }),
        ),
    });
    assert.deepEqual(attempted, [
        "context",
        "browser",
        "relay",
        "E2E_FIXTURES_ENABLED",
        "WORKBENCH_AGENT_ENABLED",
    ]);
    assert.equal(diagnostics.length, 3);
    assert.equal(diagnostics[0].code, "ENOSPC");
    assert.equal(JSON.stringify(diagnostics).includes("secret"), false);
});

test("malformed-response qualification requires the injection and a refusal without forbidden effects", () => {
    assert.equal(
        malformedOutcome({
            injected: false,
            refused: false,
            forbiddenEffect: false,
            continued: true,
        }),
        "not_proven",
    );
    assert.equal(
        malformedOutcome({
            injected: true,
            refused: false,
            forbiddenEffect: false,
            continued: true,
        }),
        "not_proven",
    );
    assert.equal(
        malformedOutcome({
            injected: true,
            refused: true,
            forbiddenEffect: true,
            continued: true,
        }),
        "failed",
    );
    assert.equal(
        malformedOutcome({
            injected: true,
            refused: true,
            forbiddenEffect: false,
            continued: true,
        }),
        "passed",
    );
});

test("recovery verdict excludes an older failed mission even when it sorts after the recovery", () => {
    const failure = { _id: "z-old", status: "failed" };
    const recovered = { _id: "a-new", status: "completed" };
    assert.deepEqual(
        attemptMissions(
            { missions: [failure] },
            { missions: [recovered, failure] },
        ),
        [recovered],
    );
});

test("diagnostics preserve the stage and known error code but discard arbitrary errors", () => {
    const safe = qualificationDiagnostic(
        "refinement:settle",
        Object.assign(new Error("Bearer secret"), { code: "ERR_ASSERTION" }),
        "mission completes",
    );
    assert.deepEqual(safe, {
        step: "refinement:settle",
        category: "assertion_failed",
        code: "ERR_ASSERTION",
        expectation: "mission completes",
    });
    assert.equal(JSON.stringify(safe).includes("secret"), false);
});

test("typed configuration refusals remain actionable without logging backend exception text", () => {
    const error = Object.assign(
        new Error("backend diagnostic with token=secret"),
        { data: { code: "model_unavailable" } },
    );
    assert.equal(
        qualificationDiagnostic("authorize-live-lot", error).code,
        "model_unavailable",
    );
});

const { qualificationDecision } = await import(
    "../../../scripts/evaluations/workbench-browser/qualification.ts"
);
test("completed missions with unreviewed task outcomes cannot qualify the capability", () => {
    assert.equal(
        qualificationDecision(
            false,
            ["refinement"],
            [
                {
                    scenario: "refinement",
                    executionIntegrity: "passed",
                    semanticTask: "manual_review_required",
                },
            ],
        ),
        "inconclusive",
    );
});
test("missing mandatory cases remain inconclusive rather than an application failure", () => {
    assert.equal(
        qualificationDecision(
            false,
            ["pause", "resume"],
            [
                {
                    scenario: "pause",
                    executionIntegrity: "passed",
                    semanticTask: "passed",
                },
            ],
        ),
        "inconclusive",
    );
});
test("a demonstrated failure blocks acceptance even with complete coverage", () => {
    assert.equal(
        qualificationDecision(
            false,
            ["refinement"],
            [
                {
                    scenario: "refinement",
                    executionIntegrity: "failed",
                    semanticTask: "passed",
                },
            ],
        ),
        "failed",
    );
});

test("unknown charges remain inconclusive and a reconciliation mismatch blocks even reviewed successful cases", () => {
    const results = [
        {
            scenario: "case",
            executionIntegrity: "passed",
            semanticTask: "passed",
        },
    ];
    assert.equal(
        qualificationDecision(false, ["case"], results, {
            unknownCharges: 1,
            reconciled: true,
        }),
        "inconclusive",
    );
    assert.equal(
        qualificationDecision(false, ["case"], results, {
            unknownCharges: 0,
            reconciled: false,
        }),
        "failed",
    );
});

const { campaignManifestSchema } = await import(
    "../../../convex/qualificationCampaignPolicy.ts"
);
const { configurableCampaign } = await import("../setup/qualification-v2.ts");

test("dated fresh-framing mandates refuse scripted programs and documentary seeding", () => {
    const base = configurableCampaign();
    const scenario = {
        ...base.scenarios[0],
        framingRequest: {
            text: "will it survive after the recent crisis ?",
            receivedAt: "2026-11-18T09:00:00.000Z",
        },
    };
    const manifest = {
        ...base,
        scenarios: [scenario],
        expectations: [{ id: scenario.id, checks: ["agent-saved-framing"] }],
        batteryHash: "a".repeat(64),
    };
    assert.equal(campaignManifestSchema.safeParse(manifest).success, false);
    scenario.steps = [{ id: "start", action: "start_research" }];
    assert.equal(campaignManifestSchema.safeParse(manifest).success, true);
    scenario.initialFixture = {
        id: "sources_correction",
        hash: "b".repeat(64),
    };
    assert.equal(campaignManifestSchema.safeParse(manifest).success, false);
    delete scenario.initialFixture;
    scenario.framingRequest.receivedAt = "not-a-date";
    assert.equal(campaignManifestSchema.safeParse(manifest).success, false);
});

test("prepared directed-framing comparisons keep fresh requests, shared material and zero paid authority", async () => {
    const { createHash } = await import("node:crypto");
    const directory = new URL(
        "../../../scripts/evaluations/workbench-browser/fixtures/directed-framing-20261118/",
        import.meta.url,
    );
    const manifest = campaignManifestSchema.parse(
        JSON.parse(
            readFileSync(new URL("campaign-input.json", directory), "utf8"),
        ),
    );
    assert.equal(manifest.mode, "deterministic");
    assert.deepEqual(manifest.total, {
        model: 0,
        search: 0,
        acquisition: 0,
        costUsd: 0,
    });
    assert.equal(manifest.scenarios.length, 7);
    assert(
        manifest.scenarios.every(
            (s) =>
                s.framingRequest &&
                !s.initialFixture &&
                !s.steps.some((step) => step.action === "save_framing"),
        ),
    );
    const presets = manifest.scenarios.filter((s) => s.id.startsWith("ccc-"));
    assert.deepEqual(
        presets.map((s) => s.coveragePreset),
        ["balanced", "first_party_depth", "independent_scrutiny"],
    );
    assert.equal(
        new Set(presets.map((s) => JSON.stringify(s.framingRequest))).size,
        1,
    );
    const unnamed = manifest.scenarios.find((s) => s.id === "nvidia-unnamed");
    assert.equal(
        unnamed.framingRequest.text,
        "will it survive after the recent crisis ?",
    );
    assert.equal(unnamed.framingRequest.receivedAt, "2026-11-18T09:00:00.000Z");
    assert(!unnamed.framingRequest.text.includes("sec.gov"));
    assert(!unnamed.framingRequest.text.includes("Huang"));
    const material = JSON.parse(
        readFileSync(new URL("material.json", directory), "utf8"),
    );
    for (const document of material.documents)
        assert.equal(
            createHash("sha256")
                .update(readFileSync(new URL(document.file, directory)))
                .digest("hex"),
            document.sha256,
        );
    assert(
        material.ccc.results.every((result) =>
            result.text.startsWith("Illustrative fixture:"),
        ),
    );
    assert(
        material.provenance.includes(
            "not a capture of the historical Exa index",
        ),
    );
});

test("campaign preparation freezes retrieval material for a future real-model mandate without dispatch", async () => {
    const { writeFileSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    const { resolve } = await import("node:path");
    const { runCampaign } = await import(
        "../../../scripts/evaluations/workbench-browser/campaign.ts"
    );
    const root = mkdtempSync(join(tmpdir(), "framing-replay-prepare-"));
    try {
        const materialPath = resolve(
            "scripts/evaluations/workbench-browser/fixtures/directed-framing-20261118/material.json",
        );
        const materialHash = createHash("sha256")
            .update(readFileSync(materialPath))
            .digest("hex");
        const input = JSON.parse(
            readFileSync(
                "scripts/evaluations/workbench-browser/fixtures/directed-framing-20261118/campaign-input.json",
                "utf8",
            ),
        );
        input.mode = "live";
        input.expiresAt = Date.now() + 3600000;
        input.perLot = input.total = {
            model: 60,
            search: 0,
            acquisition: 0,
            costUsd: 3,
        };
        for (const scenario of input.scenarios)
            scenario.framingReplay = {
                materialPath,
                materialHash,
                case: scenario.id.startsWith("nvidia-")
                    ? "nvidia"
                    : scenario.id === "lookup-unavailable"
                      ? "lookupUnavailable"
                      : scenario.id === "insufficient-dated-support"
                        ? "insufficientDatedSupport"
                        : "ccc",
            };
        const path = join(root, "input.json");
        writeFileSync(path, JSON.stringify(input));
        await runCampaign(
            "prepare",
            join(root, "prepared"),
            { manifest: path },
            undefined,
            {
                connect: async () => {
                    throw new Error("Preparation must not connect");
                },
            },
        );
        const prepared = JSON.parse(
            readFileSync(join(root, "prepared", "campaign.json"), "utf8"),
        );
        assert.equal(prepared.boundary, "prepared_without_authorization");
        const scenarios = prepared.manifest.scenarios;
        assert.equal(
            scenarios[0].framingRequest.text,
            "will it survive after the recent crisis ?",
        );
        assert(!scenarios[0].framingRequest.text.includes("Huang"));
        assert(
            scenarios[0].framingReplay.documents.some((doc) =>
                doc.url.includes("20261111"),
            ),
        );
        const ccc = scenarios.filter((s) => s.id.startsWith("ccc-"));
        assert.equal(
            new Set(ccc.map((s) => JSON.stringify(s.framingReplay))).size,
            1,
        );
        assert.equal(
            scenarios.find((s) => s.id === "lookup-unavailable").framingReplay
                .unavailable,
            true,
        );
        assert(
            scenarios
                .find((s) => s.id === "insufficient-dated-support")
                .framingReplay.documents.every((doc) => !doc.publishedAt),
        );
        assert(
            scenarios.every(
                (s) =>
                    s.framingReplay.materialHash === materialHash &&
                    !s.framingReplay.materialPath,
            ),
        );
        input.scenarios[0].framingReplay.materialHash = "0".repeat(64);
        writeFileSync(path, JSON.stringify(input));
        await assert.rejects(
            runCampaign("prepare", join(root, "tampered"), { manifest: path }),
            /hash|changed/i,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
