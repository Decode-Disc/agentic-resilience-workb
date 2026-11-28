import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
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

test("separate campaigns reuse checks with the exact sanitized child environment", async () => {
    const f = fixture();
    const second = mkdtempSync(join(tmpdir(), "workbench-protocol-"));
    const sharedCacheRoot = join(f.root, "shared");
    const envKey = "QUALIFICATION_TEST_NON_CHILD_SECRET";
    const previous = process.env[envKey];
    const previousTz = process.env.TZ;
    try {
        process.env.TZ = "Etc/UTC";
        writeFileSync(
            join(second, "fingerprints.json"),
            JSON.stringify(f.fingerprints),
        );
        process.env[envKey] = "first";
        const envs = [];
        await verifyQualificationCandidate(
            f.root,
            f.fingerprints,
            (_binary, _args, _signal, env) => {
                envs.push(env);
                return { status: 0, stdout: "verified" };
            },
            { sharedCacheRoot },
        );
        assert.equal(envs.length, 6);
        for (const env of envs) {
            assert.equal(env.PATH, process.env.PATH);
            assert.equal(env[envKey], undefined);
        }
        process.env[envKey] = "second";
        await verifyQualificationCandidate(
            second,
            f.fingerprints,
            () => {
                assert.fail(
                    "The second campaign must load the verified checks",
                );
            },
            { sharedCacheRoot },
        );
        assert.equal(
            readFileSync(join(second, "checks", "domain-tests.log"), "utf8"),
            "verified\n",
        );
        process.env.TZ = "America/New_York";
        await verifyQualificationCandidate(
            second,
            f.fingerprints,
            (_binary, _args, _signal, env) => {
                assert.equal(env.TZ, "America/New_York");
                envs.push(env);
                return { status: 0, stdout: "new environment" };
            },
            { sharedCacheRoot },
        );
        assert.equal(envs.length, 12);
    } finally {
        if (previousTz === undefined) delete process.env.TZ;
        else process.env.TZ = previousTz;
        if (previous === undefined) delete process.env[envKey];
        else process.env[envKey] = previous;
        rmSync(f.root, { recursive: true, force: true });
        rmSync(second, { recursive: true, force: true });
    }
});

test("a checked script added, edited, or removed outside the campaign archive invalidates preflight", async () => {
    const f = fixture();
    const source = join(f.root, "checkout");
    const originalDirectory = process.cwd();
    try {
        mkdirSync(join(source, "scripts"), { recursive: true });
        execFileSync("git", ["init", "-q", source]);
        process.chdir(source);
        const sharedCacheRoot = join(f.root, "shared");
        let calls = 0;
        const campaign = async () => {
            const root = mkdtempSync(join(f.root, "campaign-"));
            const fingerprints = qualificationFingerprints();
            writeFileSync(
                join(root, "fingerprints.json"),
                JSON.stringify(fingerprints),
            );
            await verifyQualificationCandidate(
                root,
                fingerprints,
                () => {
                    calls++;
                    return { status: 0 };
                },
                { sharedCacheRoot },
            );
        };
        await campaign();
        const script = "scripts/sync-local-convex.ts";
        writeFileSync(script, "export const enabled = true;");
        await campaign();
        writeFileSync(script, "export const enabled = false;");
        await campaign();
        rmSync(script);
        await campaign();
        // Deletion restores the first validated tree.
        assert.equal(calls, 18);
    } finally {
        process.chdir(originalDirectory);
        rmSync(f.root, { recursive: true, force: true });
    }
});

test("an in-checkout cache does not fingerprint its own entries", async () => {
    const f = fixture();
    const originalDirectory = process.cwd();
    const checkout = join(f.root, "checkout");
    try {
        mkdirSync(checkout);
        execFileSync("git", ["init", "-q", checkout]);
        process.chdir(checkout);
        const sharedCacheRoot = join(checkout, "cache");
        let calls = 0;
        for (const name of ["first", "second"]) {
            const root = join(f.root, name);
            mkdirSync(root);
            writeFileSync(
                join(root, "fingerprints.json"),
                JSON.stringify(f.fingerprints),
            );
            await verifyQualificationCandidate(
                root,
                f.fingerprints,
                () => {
                    calls++;
                    return { status: 0, stdout: "verified" };
                },
                { sharedCacheRoot },
            );
        }
        assert.equal(calls, 6);
    } finally {
        process.chdir(originalDirectory);
        rmSync(f.root, { recursive: true, force: true });
    }
});

test("shared preflight rejects corrupted or symlinked artifacts and separates fingerprint encodings", async () => {
    const f = fixture();
    const sharedCacheRoot = join(f.root, "shared");
    const options = { sharedCacheRoot };
    let calls = 0;
    const execute = () => {
        calls++;
        return { status: 0, stdout: `verified check ${calls}` };
    };
    let runs = 0;
    const campaign = async (serialization = JSON.stringify(f.fingerprints)) => {
        const root = join(f.root, `campaign-${++runs}`);
        mkdirSync(root);
        writeFileSync(join(root, "fingerprints.json"), serialization);
        return verifyQualificationCandidate(
            root,
            f.fingerprints,
            execute,
            options,
        );
    };
    try {
        const first = await campaign();
        const candidate = join(sharedCacheRoot, first.candidateHash);
        const entry = join(candidate, first.validationIdentity);
        const log = join(entry, "checks", "domain-tests.log");
        rmSync(log);
        symlinkSync(f.file, log);
        assert.equal((await campaign()).status, "passed");
        assert.equal(calls, 12);
        const freshLogs = join(f.root, "campaign-2", "checks");
        assert.equal(readdirSync(freshLogs).length, 6);
        assert.deepEqual(
            readdirSync(freshLogs)
                .map((name) => readFileSync(join(freshLogs, name), "utf8"))
                .sort(),
            [7, 8, 9, 10, 11, 12].map((n) => `verified check ${n}\n`).sort(),
        );

        writeFileSync(join(entry, "validation.json"), "{broken");
        assert.equal((await campaign()).status, "passed");
        assert.equal(calls, 18);

        const changed = await campaign(JSON.stringify(f.fingerprints, null, 2));
        assert.notEqual(first.validationIdentity, changed.validationIdentity);
        assert.equal(calls, 24);

        rmSync(candidate, { recursive: true });
        symlinkSync(f.root, candidate, "dir");
        assert.equal((await campaign()).status, "passed");
        assert.equal(calls, 30);
    } finally {
        rmSync(f.root, { recursive: true, force: true });
    }
});

test("concurrent preflight publication leaves a complete winner and two usable archives", async () => {
    const f = fixture();
    const sharedCacheRoot = join(f.root, "shared");
    const second = join(f.root, "second");
    mkdirSync(second);
    writeFileSync(
        join(second, "fingerprints.json"),
        JSON.stringify(f.fingerprints),
    );
    let release;
    const bothStarted = new Promise((resolve) => {
        release = resolve;
    });
    let calls = 0;
    const execute = async () => {
        if (++calls === 12) release();
        await bothStarted;
        return { status: 0, stdout: "verified" };
    };
    try {
        const [first, other] = await Promise.all(
            [f.root, second].map((root) =>
                verifyQualificationCandidate(root, f.fingerprints, execute, {
                    sharedCacheRoot,
                }),
            ),
        );
        assert.deepEqual(first, other);
        const candidate = join(sharedCacheRoot, first.candidateHash);
        assert.deepEqual(readdirSync(candidate), [first.validationIdentity]);
        for (const root of [
            f.root,
            second,
            join(candidate, first.validationIdentity),
        ]) {
            assert.equal(readdirSync(join(root, "checks")).length, 6);
            assert.equal(
                JSON.parse(readFileSync(join(root, "validation.json"), "utf8"))
                    .status,
                "passed",
            );
        }
    } finally {
        rmSync(f.root, { recursive: true, force: true });
    }
});
