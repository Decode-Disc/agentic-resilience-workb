// @vitest-environment node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

// Each child has a 30-second bound; this check invokes the CLI three times.
test("the recorded utility audits a selected scenario without changing input or existing output archives", () => {
    const replayPath =
        "src/__tests__/fixtures/source-utility/adobe-recorded-replay.json.gz";
    const originalReplay = readFileSync(replayPath);
    const out = mkdtempSync(join(tmpdir(), "utility-replay-inputs-"));
    try {
        const command = [
            "--experimental-strip-types",
            "scripts/evaluations/source-selection/source-utility.ts",
            "--recorded-replay",
            "src/__tests__/fixtures/source-utility/adobe-recorded-replay.json.gz",
            "--phase",
            "audit",
            "--out-dir",
            out,
            "--scenario",
            "adobe-overview",
            "--viewport",
            "desktop",
        ];
        const result = spawnSync(process.execPath, command, {
            encoding: "utf8",
            timeout: 30_000,
        });
        expect(result.status, result.stderr).toBe(0);
        const audit = JSON.parse(
            readFileSync(join(out, "audit-audit.json"), "utf8"),
        );
        expect(
            audit.scenarios.map((scenario: { id: string }) => scenario.id),
        ).toEqual(["adobe-overview"]);
        expect(audit.newProviderCalls).toBe(0);
        expect(readFileSync(replayPath)).toEqual(originalReplay);
        const archivePath = join(out, "audit-audit.json");
        const originalArchive = readFileSync(archivePath);
        const repeated = spawnSync(process.execPath, command, {
            encoding: "utf8",
            timeout: 30_000,
        });
        expect(repeated.status).not.toBe(0);
        expect(repeated.stderr).toContain("EEXIST");
        expect(readFileSync(archivePath)).toEqual(originalArchive);
        const invalid = spawnSync(
            process.execPath,
            [
                "--experimental-strip-types",
                "scripts/evaluations/source-selection/source-utility.ts",
                "--recorded-replay",
                "src/__tests__/fixtures/source-utility/adobe-recorded-replay.json.gz",
                "--phase",
                "audit",
                "--out-dir",
                out,
                "--viewport",
                "unknown",
            ],
            { encoding: "utf8", timeout: 30_000 },
        );
        expect(invalid.status).not.toBe(0);
        expect(invalid.stderr).toContain("Unknown utility viewport");
    } finally {
        rmSync(out, { recursive: true, force: true });
    }
}, 95_000);

test("recorded replay refuses seeding before loading backend configuration", () => {
    const out = mkdtempSync(join(tmpdir(), "utility-replay-no-seed-"));
    try {
        const result = spawnSync(
            process.execPath,
            [
                "--experimental-strip-types",
                resolve(
                    "scripts/evaluations/source-selection/source-utility.ts",
                ),
                "--recorded-replay",
                resolve(
                    "src/__tests__/fixtures/source-utility/adobe-recorded-replay.json.gz",
                ),
                "--phase",
                "seed",
                "--out-dir",
                out,
            ],
            // Even a broken guard cannot load this checkout's local backend credentials.
            { cwd: out, encoding: "utf8", timeout: 30_000 },
        );
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("Recorded replay is audit-only");
        expect(existsSync(join(out, "seed-audit.json"))).toBe(false);
        expect(existsSync(join(out, "seeded.json"))).toBe(false);
    } finally {
        rmSync(out, { recursive: true, force: true });
    }
}, 35_000);
