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
