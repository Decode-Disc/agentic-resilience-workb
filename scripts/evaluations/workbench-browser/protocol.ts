import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readlinkSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { reasoningPreferenceValues } from "../../../convex/modelConfigurationValues.ts";
import {
    type CampaignManifest,
    framingReplayDocumentsContent,
    sourcesReplayContent,
    sourcesReplaySchema,
} from "../../../convex/qualificationCampaignPolicy.ts";

import { QUALIFICATION_TOOLING_POLICY as TOOLING_POLICY } from "../../../convex/resourcePolicy.ts";
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

function checkoutFingerprints(
    paths: readonly string[] = [],
    cacheRoot?: string,
) {
    const list = (flags: string[], excludedPaths: string[] = []) => {
        const result = spawnSync(
            "git",
            ["ls-files", "-z", ...flags, "--", ...paths, ...excludedPaths],
            { encoding: "utf8" },
        );
        assert.equal(result.status, 0, "Candidate listing failed");
        return result.stdout.split("\0");
    };
    const cache = cacheRoot && relative(process.cwd(), resolve(cacheRoot));
    const localCache =
        cache &&
        !isAbsolute(cache) &&
        cache !== ".." &&
        !cache.startsWith(`..${sep}`);
    const inputs = localCache
        ? [
              ...list(["--cached"]),
              ...list(
                  ["--others", "--exclude-standard"],
                  [`:(exclude,literal)${cache}`],
              ),
          ]
        : list(["--cached", "--others", "--exclude-standard"]);
    return Object.fromEntries(
        [...new Set(inputs)].flatMap((path) => {
            if (!path) return [];
            const entry = lstatSync(path, { throwIfNoEntry: false });
            if (!entry) return [];
            if (
                entry.isFile() ||
                (entry.isSymbolicLink() &&
                    statSync(path, { throwIfNoEntry: false })?.isFile())
            )
                return [[path, sha256(readFileSync(path))]];
            return entry.isSymbolicLink()
                ? [[path, sha256(readlinkSync(path))]]
                : [];
        }),
    );
}

/** Canonical archive scope shared by both browser runners and campaigns. */
export function qualificationFingerprints() {
    return checkoutFingerprints([
        "convex",
        "src",
        "e2e",
        "scripts/evaluations/workbench-browser",
        "scripts/evaluations/workbench/continuity-cases.json",
        "scripts/check-imports.ts",
        "scripts/check-execution-boundaries.ts",
        "scripts/check-resource-policy.ts",
        "scripts/sync-resource-policy.ts",
        "services/playwright-browser/src/resource-policy.generated.json",
        "scripts/archive-evaluation.ts",
        "scripts/local-runtime.ts",
        "package.json",
        "pnpm-lock.yaml",
        "tsconfig.json",
        "biome.json",
        "vitest.config.ts",
        "vite.config.ts",
    ]);
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
            "convex/execution/tableValidators.ts",
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
type CheckResult = {
    status: number | null;
    stdout?: string | null;
    stderr?: string | null;
    error?: Error | undefined;
};
export type CheckExecutor = (
    binary: string,
    args: string[],
    signal: AbortSignal,
    env?: Record<string, string>,
) => CheckResult | Promise<CheckResult>;
const executeCheck: CheckExecutor = (binary, args, signal, env) =>
    new Promise((resolve) => {
        const timeout = AbortSignal.timeout(
            TOOLING_POLICY.candidateValidationTimeoutMs,
        );
        const effectiveSignal = signal
            ? AbortSignal.any([signal, timeout])
            : timeout;
        const child = spawn(binary, args, {
            stdio: ["ignore", "pipe", "pipe"],
            signal: effectiveSignal,
            env,
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        const finish = (result: CheckResult) => {
            if (settled) return;
            settled = true;
            resolve(result);
        };
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
            stdout += chunk;
        });
        child.stderr?.on("data", (chunk: string) => {
            stderr += chunk;
        });
        child.on("error", (error) =>
            finish({ status: null, stdout, stderr, error }),
        );
        child.on("close", (status) => finish({ status, stdout, stderr }));
    });

export const PREFLIGHT_ENV_ALLOWLIST = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "USER",
    "SHELL",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_CONFIG_HOME",
    "NODE_ENV",
    "NODE_OPTIONS",
    "TZ",
    "LC_ALL",
    "LANG",
    "CI",
    "SOURCES_PREPARATION_WINDOW_MINUTES",
    "SOURCES_MISSION_ENABLED",
    "SOURCES_REPLAY_INPUT",
    "SOURCES_REPLAY_METRICS",
    "WORKBENCH_REVIEW_REASONING",
    "PI_CODING_AGENT_DIR",
] as const;
const preflightEnvKeys = new Set<string>(PREFLIGHT_ENV_ALLOWLIST);
const preflightEnvPrefixes = ["VITEST_", "PNPM_", "npm_config_"];

export function buildPreflightChildEnv(
    source = process.env,
): Record<string, string> {
    const selected: [string, string][] = [];
    for (const [key, value] of Object.entries(source)) {
        if (
            value !== undefined &&
            (preflightEnvKeys.has(key) ||
                preflightEnvPrefixes.some((prefix) => key.startsWith(prefix)))
        )
            selected.push([key, value]);
    }
    return Object.fromEntries(
        selected.sort(([left], [right]) => left.localeCompare(right)),
    );
}

export function defaultPreflightCacheRoot(env = process.env): string {
    return join(
        env.XDG_CACHE_HOME || join(env.HOME || homedir(), ".cache"),
        "agentic-resilience-workbench",
        "qualification-preflight",
    );
}

type ValidationRecord = {
    status: "running" | "passed" | "failed";
    candidateHash: string;
    fingerprintsSha256: string;
    validationIdentity: string;
    checks: Array<{ id: string; status: "passed" | "failed" }>;
};

function isDirectory(path: string) {
    return lstatSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
}

function readVerifiedCacheHit(directory: string, expected: ValidationRecord) {
    try {
        const logs = join(directory, "checks");
        const manifest = join(directory, "validation.json");
        if (
            !isDirectory(directory) ||
            !isDirectory(logs) ||
            !lstatSync(manifest).isFile()
        )
            return undefined;
        const record: ValidationRecord = JSON.parse(
            readFileSync(manifest, "utf8"),
        );
        if (
            record.status !== "passed" ||
            record.candidateHash !== expected.candidateHash ||
            record.fingerprintsSha256 !== expected.fingerprintsSha256 ||
            record.validationIdentity !== expected.validationIdentity ||
            !Array.isArray(record.checks) ||
            record.checks.length !== checks.length ||
            !checks.every(
                ({ id }) =>
                    record.checks.some(
                        (check) => check.id === id && check.status === "passed",
                    ) && lstatSync(join(logs, `${id}.log`)).isFile(),
            )
        )
            return undefined;
        return record;
    } catch {
        return undefined;
    }
}

function writeValidationArtifacts(
    root: string,
    record: ValidationRecord,
    source: string,
) {
    const logDirectory = join(root, "checks");
    if (lstatSync(logDirectory, { throwIfNoEntry: false })?.isSymbolicLink())
        rmSync(logDirectory);
    mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
    const replace = (path: string, body: string | Buffer) => {
        const temporary = join(
            dirname(path),
            `.tmp-${process.pid}-${randomUUID()}`,
        );
        try {
            writeFileSync(temporary, body, { flag: "wx", mode: 0o600 });
            renameSync(temporary, path);
        } finally {
            rmSync(temporary, { force: true });
        }
    };
    for (const check of record.checks) {
        const name = `${check.id}.log`;
        const path = join(source, "checks", name);
        if (existsSync(path))
            replace(join(logDirectory, name), readFileSync(path));
    }
    replace(
        join(root, "validation.json"),
        `${JSON.stringify(record, null, 2)}\n`,
    );
}

/** No setup or paid admission may follow unless every read-only check passed on these exact source bytes. */
export async function verifyQualificationCandidate(
    root: string,
    fingerprints: Record<string, string>,
    execute: CheckExecutor = executeCheck,
    { sharedCacheRoot }: { sharedCacheRoot?: string } = {},
) {
    const verify = () => {
        for (const [file, hash] of Object.entries(fingerprints))
            assert.equal(
                sha256(readFileSync(file)),
                hash,
                "Candidate changed during validation",
            );
    };
    verify();
    // Project-wide prerequisites may read authored files outside the retained campaign archive.
    const checkoutHash = () =>
        candidateHash(checkoutFingerprints([], sharedCacheRoot));
    const validationInputs = checkoutHash();
    const verifyInputs = () => {
        verify();
        assert.equal(
            checkoutHash(),
            validationInputs,
            "Candidate changed during validation",
        );
    };
    const childEnv = buildPreflightChildEnv();
    const candidate = candidateHash(fingerprints);
    const fingerprintsSha256 = sha256(
        readFileSync(join(root, "fingerprints.json")),
    );
    const record: ValidationRecord = {
        status: "running",
        candidateHash: candidate,
        fingerprintsSha256,
        checks: [],
        validationIdentity: sha256(
            JSON.stringify({
                candidate,
                fingerprintsSha256,
                validationInputs,
                checks,
                node: process.version,
                executable: process.execPath,
                childEnv,
                tools: [
                    "node_modules/typescript/package.json",
                    "node_modules/@biomejs/biome/package.json",
                    "node_modules/vitest/package.json",
                    "node_modules/convex/package.json",
                    "node_modules/.modules.yaml",
                    "package.json",
                ].map((path) => [
                    path,
                    existsSync(path) ? sha256(readFileSync(path)) : null,
                ]),
            }),
        ),
    };
    const local = readVerifiedCacheHit(root, record);
    if (local) {
        verifyInputs();
        return local;
    }

    let candidateDir: string | undefined;
    if (sharedCacheRoot) {
        if (!lstatSync(sharedCacheRoot, { throwIfNoEntry: false }))
            mkdirSync(sharedCacheRoot, { recursive: true, mode: 0o700 });
        if (isDirectory(sharedCacheRoot)) {
            const path = join(sharedCacheRoot, candidate);
            if (!lstatSync(path, { throwIfNoEntry: false }))
                mkdirSync(path, { recursive: true, mode: 0o700 });
            if (isDirectory(path)) candidateDir = path;
        }
    }
    const cache = candidateDir && join(candidateDir, record.validationIdentity);
    const hit = cache ? readVerifiedCacheHit(cache, record) : undefined;
    if (hit && cache) {
        verifyInputs();
        writeValidationArtifacts(root, hit, cache);
        return hit;
    }

    const staging = mkdtempSync(
        join(candidateDir ?? root, `.tmp-${process.pid}-`),
    );
    try {
        const logs = join(staging, "checks");
        mkdirSync(logs, { mode: 0o700 });
        const controller = new AbortController();
        const outcomes = new Map<string, "passed" | "failed">();
        let firstError: unknown;
        await Promise.all(
            checks.map(async (check) => {
                try {
                    const result = await execute(
                        "pnpm",
                        check.args,
                        controller.signal,
                        childEnv,
                    );
                    writeFileSync(
                        join(logs, `${check.id}.log`),
                        `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
                        { mode: 0o600 },
                    );
                    if (result.status !== 0 || result.error)
                        throw new assert.AssertionError({
                            message: `Qualification prerequisite failed: ${check.id}`,
                        });
                    verify();
                    outcomes.set(check.id, "passed");
                } catch (error) {
                    outcomes.set(check.id, "failed");
                    if (!firstError) firstError = error;
                    controller.abort();
                }
            }),
        );
        for (const { id } of checks) {
            const status = outcomes.get(id);
            if (status) record.checks.push({ id, status });
        }
        try {
            if (firstError) throw firstError;
            verifyInputs();
        } catch (error) {
            record.status = "failed";
            writeValidationArtifacts(root, record, staging);
            throw error;
        }
        record.status = "passed";
        let source = staging;
        if (cache) {
            writeFileSync(
                join(staging, "validation.json"),
                `${JSON.stringify(record, null, 2)}\n`,
                { mode: 0o600 },
            );
            try {
                renameSync(staging, cache);
                source = cache;
            } catch (error) {
                const collision = (error as NodeJS.ErrnoException).code;
                if (
                    collision !== "EEXIST" &&
                    collision !== "ENOTEMPTY" &&
                    collision !== "ENOTDIR"
                )
                    throw error;
                if (
                    candidateDir &&
                    isDirectory(candidateDir) &&
                    readVerifiedCacheHit(cache, record)
                )
                    source = cache;
            }
        }
        writeValidationArtifacts(root, record, source);
        verifyInputs();
        return record;
    } finally {
        rmSync(staging, { recursive: true, force: true });
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

/** Keeps repeated full replay documents once in the immutable mandate, without changing scenario identity. */
export function compactFramingReplayDocuments(
    manifest: CampaignManifest,
): CampaignManifest {
    if (manifest.version === 1) return manifest;
    const shared = { ...manifest.sharedFramingDocuments };
    for (const [key, documents] of Object.entries(shared))
        assert.equal(
            sha256(framingReplayDocumentsContent(documents)),
            key,
            "Frozen framing documents hash changed",
        );
    const counts = new Map<string, number>();
    for (const scenario of manifest.scenarios) {
        const replay = scenario.framingReplay;
        if (!replay || !("documents" in replay) || !replay.documents.length)
            continue;
        const key = sha256(framingReplayDocumentsContent(replay.documents));
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const scenarios = manifest.scenarios.map((scenario) => {
        const replay = scenario.framingReplay;
        if (!replay || !("documents" in replay)) return scenario;
        const key = sha256(framingReplayDocumentsContent(replay.documents));
        if ((counts.get(key) ?? 0) < 2) return scenario;
        shared[key] = replay.documents;
        const { documents: _documents, ...metadata } = replay;
        return {
            ...scenario,
            framingReplay: { ...metadata, documentsRef: key },
        };
    });
    return Object.keys(shared).length
        ? { ...manifest, scenarios, sharedFramingDocuments: shared }
        : manifest;
}

/** Resolves and hash-checks replay bytes before the immutable mandate is prepared; assessor judgments never enter model context. */
export function prepareFramingReplay(input: unknown) {
    if (!input || typeof input !== "object" || !("materialPath" in input))
        return input;
    const descriptor = z
        .object({
            materialPath: z.string().min(1),
            materialHash: z.string().regex(/^[a-f0-9]{64}$/),
            case: z.enum([
                "nvidia",
                "ccc",
                "lookupUnavailable",
                "insufficientDatedSupport",
            ]),
        })
        .strict()
        .parse(input);
    const path = resolve(descriptor.materialPath);
    const bytes = readFileSync(path);
    assert.equal(
        sha256(bytes),
        descriptor.materialHash,
        "Frozen framing material hash changed",
    );
    const material = z
        .object({
            documents: z.array(
                z.object({
                    id: z.string(),
                    url: z.url(),
                    file: z.string(),
                    sha256: z.string(),
                    publishedAt: z.iso.datetime(),
                }),
            ),
            ccc: z.object({
                results: z.array(
                    z.object({
                        url: z.url(),
                        title: z.string(),
                        text: z.string(),
                        publishedDate: z.string().optional(),
                    }),
                ),
            }),
            failures: z.object({
                lookupUnavailable: z.object({
                    status: z.literal("missing_configuration"),
                }),
                insufficientDatedSupport: z.object({
                    results: z.array(
                        z.object({
                            url: z.url(),
                            title: z.string(),
                            text: z.string(),
                        }),
                    ),
                }),
            }),
        })
        .parse(JSON.parse(bytes.toString("utf8")));
    const documents =
        descriptor.case === "nvidia"
            ? material.documents.map((doc) => {
                  assert(
                      !isAbsolute(doc.file) &&
                          !doc.file.split(/[\\/]/u).includes(".."),
                      "Replay document path must stay in corpus",
                  );
                  const raw = readFileSync(join(dirname(path), doc.file));
                  assert.equal(
                      sha256(raw),
                      doc.sha256,
                      "Frozen document hash changed",
                  );
                  return {
                      url: doc.url,
                      title: `NVIDIA SEC filing: ${doc.id}`,
                      text: raw.toString("utf8"),
                      publishedAt: doc.publishedAt,
                  };
              })
            : (descriptor.case === "ccc"
                  ? material.ccc.results
                  : descriptor.case === "insufficientDatedSupport"
                    ? material.failures.insufficientDatedSupport.results
                    : []
              ).map((doc) => ({
                  url: doc.url,
                  title: doc.title,
                  text: doc.text,
                  ...("publishedDate" in doc &&
                  typeof doc.publishedDate === "string"
                      ? {
                            publishedAt: new Date(
                                doc.publishedDate,
                            ).toISOString(),
                        }
                      : {}),
              }));
    return {
        materialHash: descriptor.materialHash,
        case: descriptor.case,
        unavailable: descriptor.case === "lookupUnavailable",
        documents,
    };
}

/** Freezes documentary replay at preparation; source files and canonical bytes are both checked. */
export function prepareSourcesReplay(input: unknown) {
    if (!input || typeof input !== "object") return input;
    let replay = input;
    if ("materialPath" in input) {
        const descriptor = z
            .object({
                materialPath: z.string().min(1),
                materialHash: z.string().regex(/^[a-f0-9]{64}$/),
            })
            .strict()
            .parse(input);
        const bytes = readFileSync(resolve(descriptor.materialPath));
        assert.equal(
            sha256(bytes),
            descriptor.materialHash,
            "Frozen Sources material hash changed",
        );
        const material = z
            .object({ documents: sourcesReplaySchema.shape.documents })
            .strict()
            .parse(JSON.parse(bytes.toString("utf8")));
        replay = {
            ...material,
            materialHash: sha256(
                sourcesReplayContent({
                    ...material,
                    materialHash: "0".repeat(64),
                }),
            ),
        };
    }
    const parsed = sourcesReplaySchema.parse(replay);
    assert.equal(
        sha256(sourcesReplayContent(parsed)),
        parsed.materialHash,
        "Frozen Sources content hash changed",
    );
    return parsed;
}
