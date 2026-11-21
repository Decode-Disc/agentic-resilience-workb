import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("native skill packaging is deterministic and excludes developer resources", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-skills-"));
    try {
        const output = join(dir, "packages.json");
        const run = () =>
            spawnSync(
                process.execPath,
                [
                    "--experimental-strip-types",
                    "scripts/sync-agent-skills.ts",
                    "--output",
                    output,
                ],
                { encoding: "utf8" },
            );
        const first = run();
        assert.equal(first.status, 0, first.stderr);
        const bytes = readFileSync(output, "utf8");
        assert.equal(run().status, 0);
        assert.equal(readFileSync(output, "utf8"), bytes);
        const { cpSync } = await import("node:fs");
        const otherRoot = join(dir, "other-checkout", "agent-skills");
        cpSync("agent-skills", otherRoot, { recursive: true });
        const otherOutput = join(dir, "other.json");
        const relocated = spawnSync(
            process.execPath,
            [
                "--experimental-strip-types",
                "scripts/sync-agent-skills.ts",
                "--root",
                otherRoot,
                "--output",
                otherOutput,
            ],
            { encoding: "utf8" },
        );
        assert.equal(relocated.status, 0, relocated.stderr);
        assert.equal(readFileSync(otherOutput, "utf8"), bytes);

        const data = JSON.parse(bytes);
        assert.equal(data.formatVersion, 1);
        assert.deepEqual(Object.keys(data.packages[0].skills), [
            "source-preparation",
            "workbench-framing",
        ]);
        assert.ok(!bytes.includes(".agents/skills"));
        assert.equal(data.packages[0].id, "research-methods-v2");
        assert.ok(bytes.includes("/agent-skills/research-methods-v2/"));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("packaging rejects metadata, resource escapes and immutable package replacement", async () => {
    const { cpSync, appendFileSync, unlinkSync, symlinkSync, writeFileSync } =
        await import("node:fs");
    for (const mutation of [
        "metadata",
        "duplicate",
        "missing",
        "escape",
        "symlink",
        "root-symlink",
        "immutable",
    ]) {
        const dir = mkdtempSync(join(tmpdir(), "agent-skills-invalid-"));
        try {
            const root = join(dir, "authored");
            cpSync("agent-skills", root, { recursive: true });
            const output = join(dir, "packages.json");
            const run = () =>
                spawnSync(
                    process.execPath,
                    [
                        "--experimental-strip-types",
                        "scripts/sync-agent-skills.ts",
                        "--root",
                        root,
                        "--output",
                        output,
                    ],
                    { encoding: "utf8" },
                );
            if (mutation === "immutable") assert.equal(run().status, 0);
            const skill = join(root, "workbench-framing/SKILL.md");
            if (mutation === "metadata")
                writeFileSync(
                    skill,
                    "---\nname: wrong\n---\nMissing description",
                );
            if (mutation === "duplicate")
                writeFileSync(
                    skill,
                    readFileSync(skill, "utf8").replace(
                        "name: workbench-framing",
                        "name: source-preparation",
                    ),
                );
            if (mutation === "missing")
                unlinkSync(
                    join(root, "workbench-framing/examples/worked-cases.md"),
                );
            if (mutation === "escape")
                appendFileSync(skill, "\n[host](../../../host.md)\n");
            if (mutation === "symlink") {
                unlinkSync(skill);
                symlinkSync("/etc/passwd", skill);
            }
            if (mutation === "root-symlink") {
                const outside = join(dir, "outside");
                cpSync(join(root, "workbench-framing"), outside, {
                    recursive: true,
                });
                rmSync(join(root, "workbench-framing"), { recursive: true });
                symlinkSync(outside, join(root, "workbench-framing"));
            }
            if (mutation === "immutable")
                appendFileSync(skill, "\nChanged immutable method.\n");
            assert.notEqual(run().status, 0, mutation);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }
});
