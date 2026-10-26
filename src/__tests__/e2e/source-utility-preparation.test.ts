// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

// Each child has a 30-second bound; this integration check covers two real CLI invocations.
test("the recorded utility producer validates a selected viewport without seeding or overwriting an archive", () => {
    const out = mkdtempSync(join(tmpdir(), "utility-replay-inputs-"));
    try {
        const result = spawnSync(
            process.execPath,
            [
                "--experimental-strip-types",
                "scripts/evaluations/source-selection/source-utility.ts",
                "--phase",
                "audit",
                "--out-dir",
                out,
                "--scenario",
                "adobe-overview",
                "--viewport",
                "desktop",
            ],
            { encoding: "utf8", timeout: 30_000 },
        );
        expect(result.status, result.stderr).toBe(0);
        const audit = JSON.parse(
            readFileSync(join(out, "audit-audit.json"), "utf8"),
        );
        expect(
            audit.scenarios.map((scenario: { id: string }) => scenario.id),
        ).toEqual(["adobe-overview"]);
        expect(audit.newProviderCalls).toBe(0);
        const invalid = spawnSync(
            process.execPath,
            [
                "--experimental-strip-types",
                "scripts/evaluations/source-selection/source-utility.ts",
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
}, 65_000);
