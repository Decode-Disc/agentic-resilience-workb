// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
    closeSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const checker = resolve("scripts/check-documentation.ts");
const roots: string[] = [];
const policy = `# Agent instructions

<!-- documentation-policy:start -->
| Path | Role | Word warning | Responsibility |
| --- | --- | --- | --- |
| \`AGENTS.md\` | reference | - | Working rules. |
| \`context/TECH.md\` | reference | 20 | Technical contract. |
| \`docs/brainstorming/**\` | history | - | Exploration. |
| \`scripts/evaluations/source-selection/fixtures/*/README.md\` | evidence | - | Provenance. |
| \`scripts/evaluations/source-selection/fixtures/**\` | excluded | - | Raw material. |
| \`docs/designs/**\` | retired | - | Former location. |
<!-- documentation-policy:end -->
`;

function put(root: string, path: string, contents: string) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
}

function fixture() {
    const root = mkdtempSync(join(tmpdir(), "documentation-test-"));
    roots.push(root);
    put(root, "AGENTS.md", policy);
    put(root, "context/TECH.md", "# Technical contract\n");
    return root;
}

function check(root: string) {
    // File descriptors also work in sandboxes that deny subprocess pipes.
    const logRoot = mkdtempSync(join(tmpdir(), "documentation-output-"));
    roots.push(logRoot);
    const log = join(logRoot, "output.txt");
    const descriptor = openSync(log, "w");
    let result: ReturnType<typeof spawnSync>;
    try {
        result = spawnSync(
            process.execPath,
            ["--experimental-strip-types", checker],
            {
                cwd: root,
                stdio: ["ignore", descriptor, descriptor],
                timeout: 10_000,
            },
        );
    } finally {
        closeSync(descriptor);
    }
    if (result.error) throw result.error;
    expect(result.signal).toBeNull();
    return { status: result.status, output: readFileSync(log, "utf8") };
}

function contents(root: string): Record<string, string> {
    return Object.fromEntries(
        readdirSync(root, { recursive: true, withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => {
                const path = join(entry.parentPath, entry.name);
                return [path, readFileSync(path, "utf8")];
            }),
    );
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe("documentation CLI", () => {
    it("checks local paths, references and anchors without writing", () => {
        const root = fixture();
        put(
            root,
            "docs/brainstorming/note (draft).md",
            `# Référence & API

## Same
## Same
## Same-1
## Same
Setext heading
==============
<a id="explicit-anchor"></a>
`,
        );
        put(
            root,
            "context/TECH.md",
            `# Contract
[relative](../docs/brainstorming/note%20(draft).md#référence--api)
[angle](<../docs/brainstorming/note (draft).md#same-1> "title")
[duplicate](../docs/brainstorming/note%20(draft).md#same-2)
[root](/docs/brainstorming/)
[named][target]
[collapsed][]
[shortcut]
[anchor](#contract)
[html](../docs/brainstorming/note%20(draft).md#explicit-anchor)
[external](https://invalid.example/missing)
[mail](mailto:analyst@example.com)

[target]: ../docs/brainstorming/note%20(draft).md#setext-heading
[collapsed]: ../docs/brainstorming/note%20(draft).md#same
[shortcut]: ../docs/brainstorming/note%20(draft).md#same-1-1

\`[inline example](missing.md)\`
\`\`\`md
[fenced example](missing.md)
\`\`\`
<!-- [comment](missing.md) -->
`,
        );
        const before = contents(root);
        const result = check(root);
        expect(result.status, result.output).toBe(0);
        expect(result.output).toContain("local links");
        expect(contents(root)).toEqual(before);
    });

    it("reports missing files and headings with source locations", () => {
        const root = fixture();
        put(
            root,
            "context/TECH.md",
            "# Contract\n[missing](absent.md)\n[heading](#absent)\n",
        );
        const result = check(root);
        expect(result.status).toBe(1);
        expect(result.output).toContain("context/TECH.md:2");
        expect(result.output).toContain("missing target");
        expect(result.output).toContain("missing heading #absent");
    });

    it("rejects undefined explicit references and malformed escapes", () => {
        const root = fixture();
        put(root, "context/TECH.md", "[ref][unknown]\n[escape](bad%ZZ.md)\n");
        const result = check(root);
        expect(result.status).toBe(1);
        expect(result.output).toContain("undefined reference unknown");
        expect(result.output).toContain("invalid URL encoding");
    });

    it("rejects paths and symlinks escaping the repository", () => {
        const root = fixture();
        const outside = fixture();
        symlinkSync(join(outside, "AGENTS.md"), join(root, "external.txt"));
        put(
            root,
            "context/TECH.md",
            "[escape](../../outside.md)\n[symlink](../external.txt)\n",
        );
        const result = check(root);
        expect(result.status).toBe(1);
        expect(result.output.match(/outside repository/g)).toHaveLength(2);
    });

    it("rejects unknown documents and retired locations, including empty directories", () => {
        const root = fixture();
        put(root, "docs/new-contract.md", "# Another owner\n");
        mkdirSync(join(root, "docs/designs"));
        const result = check(root);
        expect(result.status).toBe(1);
        expect(result.output).toContain(
            "docs/new-contract.md: unregistered documentation location",
        );
        expect(result.output).toContain(
            "docs/designs: retired documentation location",
        );
    });

    it("uses first-match policy and excludes raw captures", () => {
        const root = fixture();
        put(
            root,
            "scripts/evaluations/source-selection/fixtures/sample/capture.md",
            "[raw](absent.md)",
        );
        put(
            root,
            "scripts/evaluations/source-selection/fixtures/sample/README.md",
            "[authored](absent.md)",
        );
        const result = check(root);
        expect(result.status).toBe(1);
        expect(result.output).toContain("sample/README.md:1");
        expect(result.output).not.toContain("capture.md:");
    });

    it("reports word counts and keeps size limits advisory", () => {
        const root = fixture();
        put(root, "context/TECH.md", "word ".repeat(21));
        const result = check(root);
        expect(result.status, result.output).toBe(0);
        expect(result.output).toContain("context/TECH.md: 21 words");
        expect(result.output).toContain("advisory limit 20");
    });

    it("requires reference files and rejects malformed policy", () => {
        const root = fixture();
        rmSync(join(root, "context/TECH.md"));
        const missing = check(root);
        expect(missing.status).toBe(1);
        expect(missing.output).toContain("required reference is missing");
        put(root, "AGENTS.md", policy.replace("| history |", "| invented |"));
        const result = check(root);
        expect(result.status).toBe(1);
        expect(result.output).toContain("invalid policy row");
    });

    it("rejects links targeting gitignored paths inside a git repository", () => {
        const root = fixture();
        const init = spawnSync("git", ["init"], {
            cwd: root,
            encoding: "utf8",
        });
        expect(init.status, init.stderr).toBe(0);
        put(root, ".gitignore", ".implementation-plans/\n");
        put(root, ".implementation-plans/plan.md", "# Local scratch\n");
        put(root, "docs/brainstorming/allowed.md", "# Allowed\n");
        put(
            root,
            "context/TECH.md",
            [
                "# Technical contract",
                "[ignored](../.implementation-plans/plan.md)",
                "[allowed](../docs/brainstorming/allowed.md)",
            ].join("\n"),
        );
        const result = check(root);
        expect(result.status, result.output).toBe(1);
        expect(result.output).toContain(
            "context/TECH.md:2: target is gitignored: ../.implementation-plans/plan.md",
        );
        expect(result.output).not.toContain("allowed.md");
    });
});
