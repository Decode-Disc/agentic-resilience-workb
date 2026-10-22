// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
    symlinkSync,
    utimesSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

function fixture() {
    const root = mkdtempSync(join(tmpdir(), "design-sync-"));
    roots.push(root);
    for (const path of [
        "DESIGN.md",
        ".impeccable/design.json",
        "src/assets/styles/themes/evidence-workbench.css",
        "src/assets/styles/base-preset.css",
        "src/styles.css",
        "src/components/ui/motion-animate-presence.tsx",
        "src/components/ui/liquid-glass.tsx",
        "src/components/workspace/workspace-navigation-rail.tsx",
        "node_modules/tailwindcss/theme.css",
    ]) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        copyFileSync(resolve(path), join(root, path));
    }
    mkdirSync(join(root, "scripts"));
    // Execute the real CLI with its import-relative inputs in an isolated checkout.
    symlinkSync(
        resolve("scripts/sync-design-context.ts"),
        join(root, "scripts/sync-design-context.ts"),
    );
    writeFileSync(join(root, "package.json"), '{"type":"module"}\n');
    writeFileSync(
        join(root, "PRODUCT.md"),
        "Product context must stay untouched.\n",
    );
    const old = new Date("2020-01-01T00:00:00.000Z");
    for (const path of ["DESIGN.md", ".impeccable/design.json"]) {
        utimesSync(join(root, path), old, old);
    }
    return root;
}

function run(root: string, ...args: string[]) {
    const result = spawnSync(
        process.execPath,
        [
            "--experimental-strip-types",
            "--preserve-symlinks-main",
            join(root, "scripts/sync-design-context.ts"),
            ...args,
        ],
        { cwd: root, encoding: "utf8", timeout: 10_000 },
    );
    if (result.error) throw result.error;
    expect(result.signal).toBeNull();
    return { status: result.status, output: result.stdout + result.stderr };
}

function snapshot(root: string) {
    return Object.fromEntries(
        ["DESIGN.md", ".impeccable/design.json", "PRODUCT.md"].map((path) => [
            path,
            {
                text: readFileSync(join(root, path), "utf8"),
                modified: statSync(join(root, path)).mtimeMs,
            },
        ]),
    );
}

afterEach(() => {
    for (const root of roots.splice(0))
        rmSync(root, { recursive: true, force: true });
});

describe("design synchronization", () => {
    it("refreshes the export after prose changes without altering the capture date", () => {
        const root = fixture();
        const design = join(root, "DESIGN.md");
        const exportPath = join(root, ".impeccable/design.json");
        const before = JSON.parse(readFileSync(exportPath, "utf8"));
        const edited = readFileSync(design, "utf8").replace(
            "## Layout\n",
            "## Layout\n\nAdditional layout guidance.\n",
        );
        writeFileSync(design, edited);
        const started = Date.now();
        const result = run(root);
        expect(result.status, result.output).toBe(0);
        const after = JSON.parse(readFileSync(exportPath, "utf8"));
        expect(Date.parse(after.generatedAt)).toBeGreaterThanOrEqual(started);
        expect(Date.parse(after.generatedAt)).toBeLessThanOrEqual(Date.now());
        expect({ ...after, generatedAt: before.generatedAt }).toEqual(before);
        expect(statSync(exportPath).mtimeMs).toBeGreaterThanOrEqual(
            statSync(design).mtimeMs,
        );
        expect(readFileSync(design, "utf8")).toBe(edited);
        expect(readFileSync(join(root, "PRODUCT.md"), "utf8")).toBe(
            "Product context must stay untouched.\n",
        );

        const refreshed = snapshot(root);
        expect(run(root, "--check").status).toBe(0);
        expect(run(root).status).toBe(0);
        expect(snapshot(root)).toEqual(refreshed);
    });

    it("checks content without writing or rejecting checkout timestamp order", () => {
        const root = fixture();
        const later = new Date("2021-01-01T00:00:00.000Z");
        utimesSync(join(root, "DESIGN.md"), later, later);
        const before = snapshot(root);
        const result = run(root, "--check");
        expect(result.status, result.output).toBe(0);
        expect(snapshot(root)).toEqual(before);
    });

    it("reports real token drift without writing, then regenerates both exports", () => {
        const root = fixture();
        const theme = join(
            root,
            "src/assets/styles/themes/evidence-workbench.css",
        );
        const original = readFileSync(theme, "utf8");
        const changed = original.replace(
            /--primary: [^;]+;/,
            "--primary: oklch(0.42 0.05 300);",
        );
        expect(changed).not.toBe(original);
        writeFileSync(theme, changed);
        const before = snapshot(root);
        const check = run(root, "--check");
        expect(check.status).toBe(1);
        expect(check.output).toContain("Out of date: DESIGN.md");
        expect(check.output).toContain("Out of date: .impeccable/design.json");
        expect(snapshot(root)).toEqual(before);

        const sync = run(root);
        expect(sync.status, sync.output).toBe(0);
        const design = readFileSync(join(root, "DESIGN.md"), "utf8");
        expect(JSON.parse(design.split("---")[1] ?? "").colors.primary).toBe(
            "oklch(0.42 0.05 300)",
        );
        const after = snapshot(root);
        expect(after["PRODUCT.md"]).toEqual(before["PRODUCT.md"]);
        expect(run(root, "--check").status).toBe(0);
        expect(run(root).status).toBe(0);
        expect(snapshot(root)).toEqual(after);
    });

    it("recreates a missing export with its actual generation date", () => {
        const root = fixture();
        const path = join(root, ".impeccable/design.json");
        rmSync(path);
        expect(run(root, "--check").status).toBe(1);
        const started = Date.now();
        const result = run(root);
        expect(result.status, result.output).toBe(0);
        expect(
            Date.parse(JSON.parse(readFileSync(path, "utf8")).generatedAt),
        ).toBeGreaterThanOrEqual(started);
        expect(run(root, "--check").status).toBe(0);
    });

    it("does not refresh the export when source validation fails", () => {
        const root = fixture();
        writeFileSync(join(root, "DESIGN.md"), "---\ninvalid JSON\n---\n");
        const before = snapshot(root);
        expect(run(root).status).toBe(1);
        expect(snapshot(root)).toEqual(before);
    });

    it("can repair a malformed generated export from valid sources", () => {
        const root = fixture();
        const path = join(root, ".impeccable/design.json");
        writeFileSync(path, "invalid generated JSON\n");
        const before = snapshot(root);
        expect(run(root, "--check").status).toBe(1);
        expect(snapshot(root)).toEqual(before);
        const result = run(root);
        expect(result.status, result.output).toBe(0);
        expect(JSON.parse(readFileSync(path, "utf8")).schemaVersion).toBe(2);
        expect(run(root, "--check").status).toBe(0);
    });
});
