import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";

test("the real architecture checker rejects aliases, protected writes and private receipts", async () => {
    const { checkExecutionBoundaries } = await import(
        /* @vite-ignore */ pathToFileURL(
            resolve("scripts/check-execution-boundaries.ts"),
        ).href
    );
    const root = mkdtempSync(join(tmpdir(), "execution-boundaries-"));
    const cases: Record<string, string> = {
        imported:
            'import { recordResult as write } from "@convex/execution/operations"; export const x = write;',
        generated:
            'import { internal as executor } from "@convex/_generated/api"; const op = executor.execution.operations; const write = op.recordResult; export const x = write;',
        namespace:
            'import * as executor from "@convex/execution/operations"; export const x = executor["recordResult"];',
        accounting:
            'export function x(ctx: unknown, id: unknown) { return ctx.db.patch(id, { progressKeys: ["fake"], noProgressTurns: 0 }); }',
        hiddenWrite:
            "export function x(ctx: unknown, id: unknown) { const update = { historyRead: {} }; const save = ctx.db.patch; return save(id, update); }",
        receipt:
            'export const execute = () => ({ outcome: {kind:"success",valueJson:"{}"}, historyRead: {version:1,fragmentIds:[]} });',
        computed:
            "export function x(ctx: unknown, id: unknown, key: string) { return ctx.db.patch(id, {[key]:0}); }",
        directTable:
            'export function x(ctx: unknown) { return ctx.db.insert("agentOperationRequests", {status:"completed"}); }',
    };
    try {
        mkdirSync(join(root, "convex/domain"), { recursive: true });
        writeFileSync(
            join(root, "tsconfig.json"),
            JSON.stringify({
                compilerOptions: {
                    target: "ESNext",
                    module: "ESNext",
                    skipLibCheck: true,
                },
                include: ["convex/**/*.ts"],
            }),
        );
        for (const [name, code] of Object.entries(cases))
            writeFileSync(join(root, `convex/domain/${name}.ts`), code);
        writeFileSync(
            join(root, "convex/domain/allowed.ts"),
            'import type { Doc } from "@convex/_generated/dataModel"; import { retainOperationEffect } from "@convex/execution/operations"; export const x = retainOperationEffect; export const read = (ctx:unknown) => ctx.db.get("id");',
        );
        const findings = checkExecutionBoundaries(root);
        for (const name of Object.keys(cases))
            expect(findings).toContainEqual(
                expect.objectContaining({
                    file: `convex/domain/${name}.ts`,
                    line: 1,
                    rule: expect.any(String),
                }),
            );
        expect(
            findings.filter((f: { file: string }) =>
                f.file.endsWith("allowed.ts"),
            ),
        ).toEqual([]);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
