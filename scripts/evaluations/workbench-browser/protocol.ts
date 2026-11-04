import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { qualificationDecision } from "./qualification.ts";

const mode = z.enum(["deterministic", "live"]);
const caseSchema = z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    prompt: z.string().nullable(),
    modes: z.array(mode).min(1),
    minimumInferenceRequests: z.number().int().nonnegative(),
    expectations: z.array(z.string()).min(1),
    taskReviewRequired: z.boolean(),
});
export const batterySchema = z.object({
    version: z.literal(1),
    capability: z.literal("browser-execution"),
    cases: z.array(caseSchema).min(1),
    unavailableCapabilities: z.array(
        z.object({ id: z.string(), reference: z.string(), reason: z.string() }),
    ),
});
export type Battery = z.infer<typeof batterySchema>;
export const browserBatteryPath =
    "scripts/evaluations/workbench-browser/browser-cases.json";
export const sha256 = (bytes: string | Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");
export const candidateHash = (fingerprints: Record<string, string>) =>
    sha256(
        JSON.stringify(
            Object.entries(fingerprints).sort(([a], [b]) => a.localeCompare(b)),
        ),
    );
export function readQualificationBattery() {
    const bytes = readFileSync(browserBatteryPath);
    const battery = batterySchema.parse(JSON.parse(bytes.toString("utf8")));
    assert(
        new Set(battery.cases.map((c) => c.id)).size === battery.cases.length,
        "Duplicate battery cases",
    );
    return { battery, hash: sha256(bytes) };
}

/** Budget admission is a lower bound, never a promise that variable model turns will all fit. */
export function planQualification(
    battery: Battery,
    selectedMode: z.infer<typeof mode>,
    maximumRequests: number,
) {
    const required = battery.cases.filter((c) =>
        c.modes.includes(selectedMode),
    );
    const minimum =
        selectedMode === "live"
            ? required.reduce((n, c) => n + c.minimumInferenceRequests, 0)
            : 0;
    assert(
        maximumRequests >= minimum,
        "Allowance cannot cover even one inference per mandatory turn",
    );
    return {
        required: required.map((c) => c.id),
        minimumRequests: minimum,
        excluded: battery.cases
            .filter((c) => !c.modes.includes(selectedMode))
            .map((c) => c.id),
        stoppingRule:
            "Stop at the request/cost ceiling; missing or unproven mandatory cases remain inconclusive; no automatic new lot.",
    };
}

const checks = [
    { id: "types", args: ["typecheck"] },
    {
        id: "protocol-tests",
        args: [
            "exec",
            "node",
            "--experimental-strip-types",
            "--test",
            "src/__tests__/config/workbench-protocol.test.mjs",
            "src/__tests__/config/workbench-qualification.test.mjs",
            "src/__tests__/config/workbench-relay.test.mjs",
            "src/__tests__/config/workbench-model-preparation.test.mjs",
        ],
    },
    {
        id: "domain-tests",
        args: [
            "exec",
            "vitest",
            "run",
            "src/__tests__/convex/execution/browser-qualification.test.ts",
            "src/__tests__/convex/execution/sources-qualification.test.ts",
            "src/__tests__/convex/sources/sources-completion-freshness.test.ts",
            "src/__tests__/convex/sources/sources-boundaries.test.ts",
            "src/__tests__/convex/sources/sources-recovery.test.ts",
            "src/__tests__/convex/execution/workbench-continuity.test.ts",
            "src/__tests__/convex/execution/workbench-status-publication.test.ts",
        ],
    },
    {
        id: "lint",
        args: [
            "exec",
            "biome",
            "check",
            "scripts/evaluations/workbench-browser",
            "src/__tests__/config/workbench-protocol.test.mjs",
            "src/__tests__/config/workbench-qualification.test.mjs",
            "src/__tests__/config/workbench-relay.test.mjs",
            "src/__tests__/config/workbench-model-preparation.test.mjs",
        ],
    },
    {
        id: "imports",
        args: [
            "exec",
            "node",
            "--experimental-strip-types",
            "scripts/check-imports.ts",
        ],
    },
    {
        id: "ownership",
        args: [
            "exec",
            "node",
            "--experimental-strip-types",
            "scripts/check-execution-boundaries.ts",
        ],
    },
];
type CheckExecutor = (
    binary: string,
    args: string[],
) => {
    status: number | null;
    stdout?: string | null;
    stderr?: string | null;
    error?: Error | undefined;
};
const executeCheck: CheckExecutor = (binary, args) =>
    spawnSync(binary, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 300_000,
    });

/** No setup or paid admission may follow unless every sequential check passed on these exact source bytes. */
export function verifyQualificationCandidate(
    root: string,
    fingerprints: Record<string, string>,
    execute: CheckExecutor = executeCheck,
) {
    const verify = () => {
        for (const [file, hash] of Object.entries(fingerprints))
            assert.equal(
                sha256(readFileSync(file)),
                hash,
                "Candidate changed during validation",
            );
    };
    const path = join(root, "validation.json");
    const record = {
        status: "running",
        candidateHash: candidateHash(fingerprints),
        fingerprintsSha256: sha256(
            readFileSync(join(root, "fingerprints.json")),
        ),
        checks: [] as Array<{ id: string; status: "passed" | "failed" }>,
    };
    const persist = () =>
        writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, {
            mode: 0o600,
        });
    mkdirSync(join(root, "checks"), { recursive: true, mode: 0o700 });
    try {
        verify();
        persist();
        for (const check of checks) {
            const result = execute("pnpm", check.args);
            writeFileSync(
                join(root, "checks", `${check.id}.log`),
                `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
                { mode: 0o600 },
            );
            const passed = result.status === 0 && !result.error;
            record.checks.push({
                id: check.id,
                status: passed ? "passed" : "failed",
            });
            persist();
            assert(passed, `Qualification prerequisite failed: ${check.id}`);
            verify();
        }
        record.status = "passed";
        persist();
        return record;
    } catch (error) {
        record.status = "failed";
        persist();
        throw error;
    }
}

const storedProtocol = z.object({
    version: z.literal(2),
    mode,
    battery: batterySchema,
    batteryHash: z.string(),
    plan: z.object({ required: z.array(z.string()) }),
});
const storedReport = z.object({
    status: z.string(),
    batteryHash: z.string(),
    candidateHash: z.string(),
    executionIntegrity: z.string(),
    unknownCharges: z.number().int().nonnegative(),
    costReconciliation: z.enum(["matched_known_charges", "unreconciled"]),
    scenarios: z.array(
        z.object({
            scenario: z.string(),
            executionIntegrity: z.string(),
            semanticTask: z.string(),
        }),
    ),
    cleanup: z.object({ completed: z.boolean() }),
});
const outcome = z.enum(["passed", "failed", "inconclusive"]);
const reviewSchema = z
    .object({
        batteryHash: z.string(),
        candidateHash: z.string(),
        evidenceHash: z.string(),
        cases: z.array(
            z.object({
                id: z.string(),
                checks: z.record(z.string(), outcome),
                finding: z.string().min(10).max(2000),
            }),
        ),
    })
    .strict();

/** Reviews are tied to the preserved source identity and actual before/after/published evidence, not today's checkout. */
export function qualificationReviewTemplate(root: string) {
    const protocol = storedProtocol.parse(
        JSON.parse(readFileSync(join(root, "protocol.json"), "utf8")),
    );
    const report = storedReport.parse(
        JSON.parse(readFileSync(join(root, "report.json"), "utf8")),
    );
    const fingerprints = z
        .record(z.string(), z.string())
        .parse(
            JSON.parse(readFileSync(join(root, "fingerprints.json"), "utf8")),
        );
    for (const [file, hash] of Object.entries(fingerprints)) {
        assert(
            !isAbsolute(file) && !file.split(/[\\/]/).includes(".."),
            "Invalid preserved source path",
        );
        assert.equal(
            sha256(readFileSync(join(root, "code", file))),
            hash,
            "Preserved source changed",
        );
    }
    assert.equal(
        fingerprints[browserBatteryPath],
        protocol.batteryHash,
        "Preserved battery mismatch",
    );
    assert.deepEqual(
        batterySchema.parse(
            JSON.parse(
                readFileSync(join(root, "code", browserBatteryPath), "utf8"),
            ),
        ),
        protocol.battery,
        "Protocol battery changed",
    );
    assert.equal(
        report.candidateHash,
        candidateHash(fingerprints),
        "Candidate identity mismatch",
    );
    assert.equal(
        report.batteryHash,
        protocol.batteryHash,
        "Battery identity mismatch",
    );
    const files: Record<string, string> = {};
    for (const file of [
        "protocol.json",
        "report.json",
        "fingerprints.json",
        "progress.jsonl",
    ])
        files[file] = sha256(readFileSync(join(root, file)));
    for (const c of protocol.battery.cases.filter((c) =>
        protocol.plan.required.includes(c.id),
    )) {
        const result = report.scenarios.find((r) => r.scenario === c.id);
        if (result?.executionIntegrity !== "passed") continue;
        for (const suffix of c.taskReviewRequired
            ? ["before", "after", "published"]
            : ["before", "after"]) {
            const file = `${c.id}-${suffix}.json`;
            files[file] = sha256(readFileSync(join(root, file)));
        }
    }
    return {
        batteryHash: report.batteryHash,
        candidateHash: report.candidateHash,
        evidenceHash: candidateHash(files),
        cases: protocol.battery.cases
            .filter(
                (c) =>
                    protocol.plan.required.includes(c.id) &&
                    c.taskReviewRequired,
            )
            .map((c) => ({
                id: c.id,
                checks: Object.fromEntries(
                    c.expectations.map((id) => [id, "inconclusive" as const]),
                ),
                finding: "",
            })),
    };
}

/** Adds an immutable assessment; original captures and the original mechanical report are never rewritten. */
export function assessQualification(root: string, input: unknown) {
    const review = reviewSchema.parse(input);
    const expected = qualificationReviewTemplate(root);
    assert.equal(
        review.batteryHash,
        expected.batteryHash,
        "Stale battery review",
    );
    assert.equal(
        review.candidateHash,
        expected.candidateHash,
        "Stale candidate review",
    );
    assert.equal(
        review.evidenceHash,
        expected.evidenceHash,
        "Stale evidence review",
    );
    const protocol = storedProtocol.parse(
        JSON.parse(readFileSync(join(root, "protocol.json"), "utf8")),
    );
    const report = storedReport.parse(
        JSON.parse(readFileSync(join(root, "report.json"), "utf8")),
    );
    assert.equal(
        new Set(review.cases.map((c) => c.id)).size,
        review.cases.length,
        "Duplicate case reviews",
    );
    assert.deepEqual(
        review.cases.map((c) => c.id).sort(),
        expected.cases.map((c) => c.id).sort(),
        "Review must cover the frozen mandatory cases",
    );
    for (const item of review.cases) {
        const required = expected.cases.find((c) => c.id === item.id);
        assert(required);
        assert.deepEqual(
            Object.keys(item.checks).sort(),
            Object.keys(required.checks).sort(),
            "Review expectations changed",
        );
    }
    const scenarios = report.scenarios.map((result) => {
        const item = review.cases.find((c) => c.id === result.scenario);
        const required = protocol.battery.cases.find(
            (c) => c.id === result.scenario,
        );
        const verdict = !required?.taskReviewRequired
            ? "not_required"
            : !item
              ? "not_assessed"
              : Object.values(item.checks).includes("failed")
                ? "failed"
                : Object.values(item.checks).every((v) => v === "passed")
                  ? "passed"
                  : "inconclusive";
        return { ...result, semanticTask: verdict };
    });
    const assessment = {
        status: qualificationDecision(
            report.executionIntegrity === "failed" || !report.cleanup.completed,
            protocol.plan.required,
            scenarios,
            {
                unknownCharges: report.unknownCharges,
                reconciled:
                    report.costReconciliation === "matched_known_charges",
            },
        ),
        capability: protocol.battery.capability,
        boundary: protocol.mode,
        batteryHash: expected.batteryHash,
        candidateHash: expected.candidateHash,
        evidenceHash: expected.evidenceHash,
        modelTaskQuality:
            protocol.mode === "deterministic"
                ? "not_applicable_simulation"
                : "not_evaluated_beyond_declared_material_expectations",
        unavailableCapabilities: protocol.battery.unavailableCapabilities,
        scenarios,
        review,
    };
    const name = `assessment-${sha256(JSON.stringify(review)).slice(0, 16)}.json`;
    writeFileSync(
        join(root, name),
        `${JSON.stringify(assessment, null, 2)}\n`,
        { flag: "wx", mode: 0o600 },
    );
    return { file: join(root, name), ...assessment };
}
