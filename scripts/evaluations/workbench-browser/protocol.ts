import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { reasoningPreferenceValues } from "../../../convex/modelConfigurationValues.ts";
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
export const sourcesBatterySchema = z
    .object({
        version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        mode: mode.optional(),
        modelRole: z.enum(["harness_stress", "quality"]).optional(),
        capability: z.literal("sources_mission_v1"),
        model: z.string().min(1).max(200),
        workbenchModel: z.string().min(1).max(200).optional(),
        provider: z.string().min(1).max(200).optional(),
        responseControllerModel: z.string().min(1).max(200).optional(),
        reasoningEffort: z.literal("low").optional(),
        reasoningByRole: z
            .object({
                workbench: z.enum(reasoningPreferenceValues),
                sources: z.enum(reasoningPreferenceValues),
            })
            .optional(),
        maximumModelAttempts: z.number().int().min(0).max(40),
        maximumSearchAttempts: z.number().int().min(0).max(4),
        maximumAcquisitions: z.number().int().min(0).max(12),
        maximumCostUsd: z.number().nonnegative().max(2),
        cases: z
            .array(
                z.object({
                    id: z.enum(["ccc", "adobe"]),
                    companyName: z.string(),
                    companyCik: z.string(),
                    ticker: z.string(),
                    websiteUrl: z.string().url(),
                    scope: z.string(),
                    questions: z.array(
                        z.object({
                            id: z.string(),
                            text: z.string(),
                            shortLabel: z.string(),
                            rationale: z.string(),
                        }),
                    ),
                }),
            )
            .length(2),
    })
    .superRefine((battery, ctx) => {
        if (
            battery.mode === "deterministic"
                ? [
                      battery.maximumModelAttempts,
                      battery.maximumSearchAttempts,
                      battery.maximumAcquisitions,
                      battery.maximumCostUsd,
                  ].some((v) => v !== 0) || !!battery.responseControllerModel
                : battery.maximumModelAttempts < 1 ||
                  battery.maximumCostUsd <= 0
        )
            ctx.addIssue({
                code: "custom",
                message:
                    "Explicit live allowance or zero simulated allowance required",
            });
        if (
            battery.version === 3 &&
            (!battery.reasoningByRole ||
                !battery.modelRole ||
                !battery.workbenchModel ||
                battery.reasoningEffort !== undefined)
        )
            ctx.addIssue({
                code: "custom",
                message:
                    "Version 3 requires per-role reasoning choices and an explicit evaluation purpose.",
            });
        if (battery.version !== 3 && battery.reasoningByRole)
            ctx.addIssue({
                code: "custom",
                message: "Per-role reasoning requires version 3.",
            });
        if (
            battery.version === 3 &&
            battery.modelRole === "quality" &&
            Object.values(battery.reasoningByRole ?? {}).some(
                (effort) => effort !== "recommended",
            )
        )
            ctx.addIssue({
                code: "custom",
                message:
                    "Quality qualification uses the capability-aware recommendation; explicit efforts belong to a stress lot.",
            });
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

/** Canonical source and configuration scope shared by both browser runners and campaigns. */
export function qualificationFingerprints() {
    const result = spawnSync(
        "git",
        [
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
            "convex",
            "src",
            "e2e",
            "scripts/evaluations/workbench-browser",
            "scripts/evaluations/workbench/continuity-cases.json",
            "scripts/check-imports.ts",
            "scripts/check-execution-boundaries.ts",
            "scripts/archive-evaluation.ts",
            "scripts/local-runtime.ts",
            "package.json",
            "pnpm-lock.yaml",
            "tsconfig.json",
            "biome.json",
            "vitest.config.ts",
            "vite.config.ts",
        ],
        { encoding: "utf8" },
    );
    assert.equal(result.status, 0, "Candidate listing failed");
    return Object.fromEntries(
        result.stdout
            .split("\0")
            .filter((path) => path && existsSync(path))
            .map((path) => [path, sha256(readFileSync(path))]),
    );
}
/** Retains the real modules rather than reconstructing their behavior in an evaluation script. */
export function preserveQualificationCandidate(root: string) {
    const fingerprints = qualificationFingerprints();
    for (const path of Object.keys(fingerprints)) {
        const target = join(root, "code", path);
        mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
        writeFileSync(target, readFileSync(path), { mode: 0o600 });
    }
    writeFileSync(
        join(root, "fingerprints.json"),
        `${JSON.stringify(fingerprints, null, 2)}\n`,
        { mode: 0o600 },
    );
    return fingerprints;
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
            "src/__tests__/config/qualification-campaign.test.mjs",
            "src/__tests__/config/qualification-v2.test.mjs",
        ],
    },
    {
        id: "domain-tests",
        args: [
            "exec",
            "vitest",
            "run",
            "src/__tests__/config/qualification-backend-keys.test.ts",
            "src/__tests__/convex/execution/browser-qualification.test.ts",
            "src/__tests__/convex/execution/qualification-campaign.test.ts",
            "src/__tests__/convex/execution/qualification-v2.test.ts",
            "src/__tests__/convex/execution/qualification-audit.test.ts",
            "src/__tests__/convex/execution/separated-agent-context.test.ts",
            "src/__tests__/convex/execution/sources-compaction.test.ts",
            "src/__tests__/convex/execution/sources-qualification.test.ts",
            "src/__tests__/convex/execution/sources-simulation.test.ts",
            "src/__tests__/convex/sources/sources-completion-freshness.test.ts",
            "src/__tests__/convex/sources/sources-boundaries.test.ts",
            "src/__tests__/convex/sources/sources-recovery.test.ts",
            "src/__tests__/convex/execution/workbench-continuity.test.ts",
            "src/__tests__/convex/execution/workbench-status-publication.test.ts",
            "src/__tests__/convex/execution/qualification-initial-fixtures.test.ts",
            "src/__tests__/convex/execution/workbench-prepared-material.test.ts",
            "src/__tests__/convex/sources/sources-observed-evidence.test.ts",
            "src/__tests__/convex/sources/sources-observed-qualification.test.ts",
            "src/__tests__/lib/presentation/workbench.test.ts",
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
            "src/__tests__/config/qualification-campaign.test.mjs",
            "src/__tests__/config/qualification-v2.test.mjs",
            "src/__tests__/config/qualification-backend-keys.test.ts",
            "convex/qualificationCampaignPolicy.ts",
            "convex/qualificationCampaigns.ts",
            "convex/qualificationUsage.ts",
            "convex/execution/fixtures.ts",
            "src/__tests__/convex/execution/qualification-v2.test.ts",
            "src/__tests__/convex/execution/qualification-audit.test.ts",
            "src/__tests__/convex/execution/sources-compaction.test.ts",
            "src/__tests__/convex/execution/separated-agent-context.test.ts",
            "convex/domain/sourceUsage.ts",
            "convex/domain/sources.ts",
            "convex/domain/sourcesAgent.ts",
            "convex/execution/schema.ts",
            "convex/runWorkspace.ts",
            "src/__tests__/setup/qualification-v2.ts",
            "convex/sourcesSimulation.ts",
            "convex/domain/sourcesSimulation.ts",
            "src/__tests__/convex/execution/sources-simulation.test.ts",
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
        validationIdentity: sha256(
            JSON.stringify({
                candidate: candidateHash(fingerprints),
                checks,
                node: process.version,
                executable: process.execPath,
                environment: sha256(
                    JSON.stringify(
                        Object.entries(process.env).sort(([left], [right]) =>
                            left.localeCompare(right),
                        ),
                    ),
                ),
                tools: [
                    "typescript",
                    "@biomejs/biome",
                    "vitest",
                    "convex",
                    ".modules.yaml",
                ].map((name) => {
                    const path =
                        name === ".modules.yaml"
                            ? "node_modules/.modules.yaml"
                            : `node_modules/${name}/package.json`;
                    return [
                        path,
                        existsSync(path) ? sha256(readFileSync(path)) : null,
                    ];
                }),
            }),
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
        if (existsSync(path)) {
            const cached = JSON.parse(readFileSync(path, "utf8"));
            if (
                cached.status === "passed" &&
                cached.validationIdentity === record.validationIdentity &&
                cached.checks?.length === checks.length &&
                cached.checks.every(
                    (c: { status: string }) => c.status === "passed",
                )
            )
                return cached as typeof record;
        }
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
