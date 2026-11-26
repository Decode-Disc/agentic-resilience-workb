// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    discoverE2eSpecFiles,
    expandRoundRobinShardArgs,
    selectE2eShardPatterns,
} from "@scripts/e2e-shards";
import { expect, test } from "vitest";

function specFixture(
    relatives: string[] = [
        "e2e/z.spec.ts",
        "e2e/a.spec.ts",
        "e2e/nested/m.spec.ts",
        "src/__tests__/e2e/b.spec.ts",
        "src/__tests__/e2e/c.spec.ts",
        "archive/retired.spec.ts",
        "src/__tests__/design-system/workbench-ui/browser/a.spec.ts",
    ],
): string {
    const root = mkdtempSync(join(tmpdir(), "e2e-shards-"));
    for (const relative of relatives) {
        const path = join(root, relative);
        mkdirSync(join(path, ".."), { recursive: true });
        writeFileSync(path, "");
    }
    return root;
}

test("discovers both E2E spec trees in sorted order and ignores retired archives", () => {
    const root = specFixture();
    try {
        expect(discoverE2eSpecFiles(root)).toEqual([
            "e2e/a.spec.ts",
            "e2e/nested/m.spec.ts",
            "e2e/z.spec.ts",
            "src/__tests__/e2e/b.spec.ts",
            "src/__tests__/e2e/c.spec.ts",
        ]);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("partitions discovered specs into disjoint, balanced shards that match their absolute files", () => {
    const root = specFixture();
    try {
        const files = discoverE2eSpecFiles(root);
        const shards = [1, 2, 3, 4].map((shard) =>
            selectE2eShardPatterns(root, shard, 4),
        );
        const counts = shards.map((shard) => shard.length);
        expect(Math.max(...counts) - Math.min(...counts)).toBe(1);
        const matched = new Map<string, number>();
        for (const pattern of shards.flat()) {
            const hits = files.filter((file) =>
                new RegExp(pattern).test(join(root, file)),
            );
            expect(hits).toHaveLength(1);
            matched.set(hits[0] ?? "", (matched.get(hits[0] ?? "") ?? 0) + 1);
        }
        expect([...matched.keys()].sort()).toEqual([...files].sort());
        expect([...matched.values()].every((count) => count === 1)).toBe(true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("a shard pattern cannot match the same filename in the other spec tree", () => {
    const root = specFixture(["e2e/a.spec.ts", "src/__tests__/e2e/a.spec.ts"]);
    try {
        const shardPatterns = [1, 2].map(
            (shard) => selectE2eShardPatterns(root, shard, 2)[0] ?? "",
        );
        const first = shardPatterns[0] ?? "";
        const second = shardPatterns[1] ?? "";
        expect(new RegExp(first).test(join(root, "e2e/a.spec.ts"))).toBe(true);
        expect(
            new RegExp(first).test(join(root, "src/__tests__/e2e/a.spec.ts")),
        ).toBe(false);
        expect(
            new RegExp(second).test(join(root, "src/__tests__/e2e/a.spec.ts")),
        ).toBe(true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("escapes regex metacharacters so a shard selects only its own spec", () => {
    const root = specFixture([
        "e2e/a.b.spec.ts",
        "e2e/aXb.spec.ts",
        "e2e/axb.spec.ts",
    ]);
    try {
        const pattern = selectE2eShardPatterns(root, 1, 3)[0] ?? "";
        expect(new RegExp(pattern).test(join(root, "e2e/a.b.spec.ts"))).toBe(
            true,
        );
        expect(new RegExp(pattern).test(join(root, "e2e/aXb.spec.ts"))).toBe(
            false,
        );
        expect(new RegExp(pattern).test(join(root, "e2e/axb.spec.ts"))).toBe(
            false,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("an empty shard selects no spec instead of the entire suite", () => {
    const root = specFixture();
    try {
        expect(selectE2eShardPatterns(root, 6, 8)).toEqual([]);
        const args = expandRoundRobinShardArgs(root, [
            "--round-robin-shard=6/8",
        ]);
        expect(args[0]).toBe("--pass-with-no-tests");
        expect(args).toHaveLength(2);
        expect(
            discoverE2eSpecFiles(root).some((file) =>
                new RegExp(args[1] ?? "").test(join(root, file)),
            ),
        ).toBe(false);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("rejects positional Playwright filters that would OR into the shard selection", () => {
    const root = specFixture();
    try {
        expect(() =>
            expandRoundRobinShardArgs(root, [
                "e2e/a.spec.ts",
                "--round-robin-shard=1/4",
            ]),
        ).toThrow(/cannot be combined/i);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("preserves option values alongside a round-robin shard", () => {
    const root = specFixture();
    try {
        const args = expandRoundRobinShardArgs(root, [
            "--round-robin-shard=1/2",
            "--config",
            "playwright.harness.config.ts",
        ]);
        expect(args.at(-2)).toBe("--config");
        expect(args.at(-1)).toBe("playwright.harness.config.ts");
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("rejects a malformed round-robin shard selection", () => {
    const root = specFixture();
    try {
        expect(() =>
            expandRoundRobinShardArgs(root, ["--round-robin-shard=1/bad"]),
        ).toThrow(/invalid round-robin shard/i);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test.each([
    "--round-robin-shard=2/5",
    "--round-robin-shard",
])("expands %s and preserves the remaining Playwright arguments", (flag) => {
    const root = specFixture();
    try {
        const args =
            flag === "--round-robin-shard"
                ? [flag, "2/5", "--list"]
                : [flag, "--list"];
        const expanded = expandRoundRobinShardArgs(root, args);
        expect(expanded[0]).toBe("--pass-with-no-tests");
        expect(expanded.at(-1)).toBe("--list");
        expect(expanded).toHaveLength(3);
        expect(
            new RegExp(expanded[1] ?? "").test(
                join(root, "e2e/nested/m.spec.ts"),
            ),
        ).toBe(true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("leaves arguments unchanged when no round-robin shard is requested", () => {
    const root = specFixture();
    try {
        expect(expandRoundRobinShardArgs(root, ["--shard=1/4"])).toEqual([
            "--shard=1/4",
        ]);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test.each([
    ["shard below one", 0, 4],
    ["shard above total", 5, 4],
    ["non-integer shard", 1.5, 4],
    ["total below one", 1, 0],
])("rejects %s", (_reason, shard, total) => {
    const root = specFixture();
    try {
        expect(() => selectE2eShardPatterns(root, shard, total)).toThrow(
            /invalid round-robin shard/i,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
