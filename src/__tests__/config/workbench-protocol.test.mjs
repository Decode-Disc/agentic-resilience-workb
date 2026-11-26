import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
    planQualification,
    qualificationFingerprints,
    readQualificationBattery,
    sha256,
    sourcesBatterySchema,
    verifyQualificationCandidate,
} from "../../../scripts/evaluations/workbench-browser/protocol.ts";

test("candidate identity includes authored policy enforcement and generated preview policy", () => {
    const fingerprints = qualificationFingerprints();
    for (const path of [
        "convex/resourcePolicy.ts",
        "scripts/check-resource-policy.ts",
        "scripts/sync-resource-policy.ts",
        "services/playwright-browser/src/resource-policy.generated.json",
    ]) {
        assert.equal(
            fingerprints[path],
            createHash("sha256").update(readFileSync(path)).digest("hex"),
            path,
        );
    }
});

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
test("one failed prerequisite aborts sibling checks and blocks validation", async () => {
    const f = fixture();
    let started = 0;
    let siblingAborted = false;
    try {
        await assert.rejects(
            () =>
                verifyQualificationCandidate(
                    f.root,
                    f.fingerprints,
                    (_binary, _args, signal) => {
                        const index = ++started;
                        if (index === 2)
                            return Promise.resolve({
                                status: 1,
                                stderr: "diagnostic",
                            });
                        return new Promise((resolve) => {
                            if (signal?.aborted) {
                                siblingAborted = true;
                                resolve({ status: null });
                                return;
                            }
                            signal?.addEventListener(
                                "abort",
                                () => {
                                    siblingAborted = true;
                                    resolve({ status: null });
                                },
                                { once: true },
                            );
                        });
                    },
                ),
            /prerequisite failed/,
        );
        assert.equal(siblingAborted, true);
        assert.equal(
            JSON.parse(readFileSync(join(f.root, "validation.json"))).status,
            "failed",
        );
    } finally {
        rmSync(f.root, { recursive: true });
    }
});
test("source changes while checks run invalidate their result", async () => {
    const f = fixture();
    try {
        await assert.rejects(
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
test("validation runs all six read-only checks concurrently and returns only after all pass", async () => {
    const f = fixture();
    try {
        let checks = 0;
        let inFlight = 0;
        let peakConcurrency = 0;
        let releaseBarrier;
        const barrier = new Promise((resolve) => {
            releaseBarrier = resolve;
        });
        const r = await verifyQualificationCandidate(
            f.root,
            f.fingerprints,
            async () => {
                checks++;
                inFlight++;
                peakConcurrency = Math.max(peakConcurrency, inFlight);
                if (checks >= 2) releaseBarrier();
                await Promise.race([
                    barrier,
                    new Promise((_, reject) =>
                        setTimeout(
                            () =>
                                reject(
                                    new Error(
                                        "Checks did not run concurrently",
                                    ),
                                ),
                            1000,
                        ),
                    ),
                ]);
                inFlight--;
                return { status: 0 };
            },
        );
        assert.equal(r.status, "passed");
        assert.equal(checks, 6);
        assert(peakConcurrency >= 2);
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

test("repeated validation of identical source bytes and tools reuses its successful checks", async () => {
    const f = fixture();
    try {
        let checks = 0;
        const execute = () => {
            checks++;
            return { status: 0 };
        };
        await verifyQualificationCandidate(f.root, f.fingerprints, execute);
        await verifyQualificationCandidate(f.root, f.fingerprints, execute);
        assert.equal(checks, 6);
    } finally {
        rmSync(f.root, { recursive: true });
    }
});

test("Sources simulation requires an explicit zero-provider battery; live defaults cannot accept zero allowances", () => {
    const base = JSON.parse(
        readFileSync(
            "scripts/evaluations/workbench-browser/sources-cases.json",
            "utf8",
        ),
    );
    const zero = {
        ...base,
        maximumModelAttempts: 0,
        maximumSearchAttempts: 0,
        maximumAcquisitions: 0,
        maximumCostUsd: 0,
    };
    assert.equal(sourcesBatterySchema.safeParse(zero).success, false);
    assert.equal(
        sourcesBatterySchema.safeParse({ ...zero, mode: "deterministic" })
            .success,
        true,
    );
    assert.equal(
        sourcesBatterySchema.safeParse({
            ...zero,
            mode: "deterministic",
            maximumSearchAttempts: 1,
        }).success,
        false,
    );
});

import { collectSourcesTranscripts } from "../../../scripts/evaluations/workbench-browser/sources.ts";

test("zero paid attempts still permit bounded inspection of simulated invocations", async () => {
    const invocation = { _id: "simulated-invocation" };
    const readPage = async () => ({
        page: [invocation],
        payloads: [],
        isDone: true,
        continueCursor: "",
    });
    await assert.rejects(
        collectSourcesTranscripts(readPage, 0),
        /Invalid transcript inspection bound/,
    );
    assert.deepEqual(
        await collectSourcesTranscripts(readPage, 0, "deterministic"),
        { invocations: [invocation], payloads: [] },
    );
});
