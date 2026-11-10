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

for (const accounting of ["api_cost", "native_subscription"])
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
