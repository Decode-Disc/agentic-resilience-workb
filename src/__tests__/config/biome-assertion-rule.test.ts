import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = process.cwd();
const input = `declare const input: unknown;
declare function inspect(value: unknown): unknown;
export const direct = input as unknown as string;
export const parenthesized = (input as unknown) as string;
export const angle = <string><unknown>input;
export const mixed = (<unknown>input) as string;
export const reverse = <string>(input as unknown);
export const deep = (((input as unknown))) as string;
export const single = input as string;
export const nested = inspect(input as string) as string;
export const constant = ({ value: 1 } as const) as const;
export const deepConstant = ((({ value: 1 } as const))) as const;
`;

function lintFixture(parent: string) {
    const directory = mkdtempSync(join(root, parent, "biome-assertion-"));
    const file = join(directory, "fixture.ts");
    try {
        writeFileSync(file, input);
        const result = spawnSync(
            join(root, "node_modules/.bin/biome"),
            ["lint", file, "--reporter=json", "--max-diagnostics=none"],
            { cwd: root, encoding: "utf8" },
        );
        if (result.error) throw result.error;
        const report: {
            diagnostics: Array<{
                category: string;
                severity: string;
                location: { start: { line: number } };
            }>;
        } = JSON.parse(result.stdout);
        return {
            status: result.status,
            diagnostics: report.diagnostics.filter(
                (item) => item.category === "plugin",
            ),
        };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

test("reports the same assertion chains as errors in application code and warnings in tests", () => {
    const production = lintFixture("src");
    const tests = lintFixture("src/__tests__");
    expect(production.status).toBe(1);
    expect(tests.status).toBe(0);
    expect(
        production.diagnostics.map((item) => [
            item.location.start.line,
            item.severity,
        ]),
    ).toEqual([3, 4, 5, 6, 7, 8].map((line) => [line, "error"]));
    expect(
        tests.diagnostics.map((item) => [
            item.location.start.line,
            item.severity,
        ]),
    ).toEqual([3, 4, 5, 6, 7, 8].map((line) => [line, "warning"]));
});
