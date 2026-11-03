import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
    planQualification,
    readQualificationBattery,
    sha256,
    verifyQualificationCandidate,
} from "../../../scripts/evaluations/workbench-browser/protocol.ts";

function fixture() {
    const root = mkdtempSync(join(tmpdir(), "workbench-protocol-"));
    const file = join(root, "candidate.ts");
    writeFileSync(file, "export const current = true;\n");
    const fingerprints = { [file]: sha256(readFileSync(file)) };
    writeFileSync(
        join(root, "fingerprints.json"),
        JSON.stringify(fingerprints),
    );
    return { root, file, fingerprints };
}
test("one failed prerequisite blocks validation before later checks can run", () => {
    const f = fixture();
    let checks = 0;
    try {
        assert.throws(
            () =>
                verifyQualificationCandidate(f.root, f.fingerprints, () => ({
                    status: ++checks === 2 ? 1 : 0,
                    stderr: "diagnostic",
                })),
            /prerequisite failed/,
        );
        assert.equal(checks, 2);
        assert.equal(
            JSON.parse(readFileSync(join(f.root, "validation.json"))).status,
            "failed",
        );
    } finally {
        rmSync(f.root, { recursive: true });
    }
});
test("source changes while checks run invalidate their result", () => {
    const f = fixture();
    try {
        assert.throws(
            () =>
                verifyQualificationCandidate(f.root, f.fingerprints, () => {
                    writeFileSync(f.file, "changed");
                    return { status: 0 };
                }),
            /Candidate changed/,
        );
        assert.equal(
            JSON.parse(readFileSync(join(f.root, "validation.json"))).status,
            "failed",
        );
    } finally {
        rmSync(f.root, { recursive: true });
    }
});
test("validation returns only after all checks passed on the frozen candidate", () => {
    const f = fixture();
    try {
        let checks = 0;
        const r = verifyQualificationCandidate(f.root, f.fingerprints, () => {
            checks++;
            return { status: 0 };
        });
        assert.equal(r.status, "passed");
        assert.equal(checks, 6);
        assert(r.checks.every((c) => c.status === "passed"));
    } finally {
        rmSync(f.root, { recursive: true });
    }
});
test("the actual browser battery preserves ten unique cases and identifies unavailable continuity coverage", () => {
    const { battery, hash } = readQualificationBattery();
    assert.equal(battery.cases.length, 10);
    assert.equal(hash.length, 64);
    assert.equal(
        battery.unavailableCapabilities[0].id,
        "conversation-continuity",
    );
    assert.equal(
        planQualification(battery, "deterministic", 0).required.length,
        8,
    );
    assert.equal(planQualification(battery, "live", 20).required.length, 10);
    assert.throws(
        () => planQualification(battery, "live", 1),
        /Allowance cannot cover/,
    );
});

const {
    candidateHash,
    qualificationReviewTemplate,
    assessQualification,
    browserBatteryPath,
} = await import("../../../scripts/evaluations/workbench-browser/protocol.ts");
const { mkdirSync } = await import("node:fs");
const { dirname } = await import("node:path");
function preservedRun() {
    const root = mkdtempSync(join(tmpdir(), "qualification-review-"));
    const { battery, hash } = readQualificationBattery(),
        plan = planQualification(battery, "deterministic", 0);
    const target = join(root, "code", browserBatteryPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(browserBatteryPath));
    const fingerprints = { [browserBatteryPath]: hash };
    const protocol = {
        version: 2,
        mode: "deterministic",
        battery,
        batteryHash: hash,
        plan,
    };
    const report = {
        status: "inconclusive",
        batteryHash: hash,
        candidateHash: candidateHash(fingerprints),
        executionIntegrity: "passed",
        unknownCharges: 0,
        costReconciliation: "matched_known_charges",
        cleanup: { completed: true },
        scenarios: battery.cases.map((c) => ({
            scenario: c.id,
            executionIntegrity: plan.required.includes(c.id)
                ? "passed"
                : "not_run",
            semanticTask: "manual_review_required",
        })),
    };
    for (const [name, value] of Object.entries({
        protocol,
        report,
        fingerprints,
    }))
        writeFileSync(join(root, `${name}.json`), JSON.stringify(value));
    writeFileSync(join(root, "progress.jsonl"), "retained fixture evidence\n");
    for (const c of battery.cases.filter((c) => plan.required.includes(c.id)))
        for (const suffix of c.taskReviewRequired
            ? ["before", "after", "published"]
            : ["before", "after"])
            writeFileSync(
                join(root, `${c.id}-${suffix}.json`),
                JSON.stringify({ fixture: true, phase: "framing" }),
            );
    const review = qualificationReviewTemplate(root);
    for (const c of review.cases) {
        for (const key of Object.keys(c.checks)) c.checks[key] = "passed";
        c.finding =
            "Fixture observations meet the declared material expectations.";
    }
    return { root, review };
}
test("offline assessment covers all expectations and preserves the original result", () => {
    const f = preservedRun();
    try {
        const original = readFileSync(join(f.root, "report.json"), "utf8");
        const r = assessQualification(f.root, f.review);
        assert.equal(r.status, "passed");
        assert.equal(r.modelTaskQuality, "not_applicable_simulation");
        assert.equal(
            r.unavailableCapabilities[0].id,
            "conversation-continuity",
        );
        assert.equal(
            readFileSync(join(f.root, "report.json"), "utf8"),
            original,
        );
        assert.throws(() => assessQualification(f.root, f.review), /EEXIST/);
    } finally {
        rmSync(f.root, { recursive: true });
    }
});
test("a changed response or missing review criterion cannot reuse an approval", () => {
    const f = preservedRun();
    try {
        const bad = structuredClone(f.review);
        delete bad.cases[0].checks[Object.keys(bad.cases[0].checks)[0]];
        assert.throws(
            () => assessQualification(f.root, bad),
            /expectations changed/,
        );
        writeFileSync(
            join(f.root, "refinement-published.json"),
            "changed response",
        );
        assert.throws(
            () => assessQualification(f.root, f.review),
            /Stale evidence/,
        );
    } finally {
        rmSync(f.root, { recursive: true });
    }
});
test("a material failed expectation blocks acceptance despite completed missions", () => {
    const f = preservedRun();
    try {
        const c = f.review.cases[0];
        c.checks[Object.keys(c.checks)[0]] = "failed";
        assert.equal(assessQualification(f.root, f.review).status, "failed");
    } finally {
        rmSync(f.root, { recursive: true });
    }
});
