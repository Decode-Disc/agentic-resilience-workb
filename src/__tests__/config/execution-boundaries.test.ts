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
        shadowed:
            'import { internal as api } from "@convex/_generated/api"; export function bad() { const target = api.execution.operations; return target.recordResult; } export function ordinary() { const target = { recordResult: "ordinary" }; return target.recordResult; }',
        namespace:
            'import * as executor from "@convex/execution/operations"; export const x = executor["recordResult"];',
        accounting:
            'export function x(ctx: unknown, id: unknown) { return ctx.db.patch(id, { progressKeys: ["fake"], noProgressTurns: 0 }); }',
        recovery:
            "export function x(ctx: unknown, id: unknown) { return ctx.db.patch(id, { recoveryRead: undefined }); }",
        hiddenWrite:
            "export function x(ctx: unknown, id: unknown) { const update = { historyRead: {} }; const save = ctx.db.patch; return save(id, update); }",
        receipt:
            'export const execute = () => ({ outcome: {kind:"success",valueJson:"{}"}, historyRead: {version:1,fragmentIds:[]} });',
        computed:
            "export function x(ctx: unknown, id: unknown, key: string) { return ctx.db.patch(id, {[key]:0}); }",
        directTable:
            'export function x(ctx: unknown) { return ctx.db.insert("agentOperationRequests", {status:"completed"}); }',
        retainedTextStage:
            'import { stageRetainedText as save } from "@convex/execution/retainedText"; export const x = save;',
        retainedTextWrite:
            'export function x(ctx: unknown) { return ctx.db.insert("retainedTextFragments", {textId:"foreign",index:0,content:"forged"}); }',
        providerReceiptOwner:
            'import { internal } from "@convex/_generated/api"; export const receipt = internal.execution.providerCallReceipts.requestBilling;',
        localExecutorOwner:
            'import { internal } from "@convex/_generated/api"; export const execute = internal.execution.operations.executeLocal;',
        misplacedRuntime:
            'import { x } from "./allowed"; "use node"; export const value = x;',
        parenthesizedRuntime: '("use node"); export const value = 1;',
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
            '"use node"; import type { Doc } from "@convex/_generated/dataModel"; import { retainOperationEffect } from "@convex/execution/operations"; export const x = retainOperationEffect; export const read = (ctx:unknown) => ctx.db.get("id");',
        );
        const findings = checkExecutionBoundaries(root);
        const expectedRules: Record<string, string[]> = {
            imported: ["executor-owner"],
            generated: ["executor-owner"],
            shadowed: ["executor-owner"],
            namespace: ["executor-owner"],
            accounting: ["field-owner"],
            recovery: ["field-owner"],
            hiddenWrite: ["private-receipt", "field-owner"],
            receipt: ["private-receipt"],
            computed: ["unresolved-write"],
            directTable: ["table-owner"],
            retainedTextStage: ["executor-owner"],
            retainedTextWrite: ["table-owner"],
            providerReceiptOwner: ["executor-owner"],
            localExecutorOwner: ["executor-owner"],
            misplacedRuntime: ["runtime-directive"],
            parenthesizedRuntime: ["runtime-directive"],
        };
        for (const name of Object.keys(cases)) {
            const actual = findings.filter(
                (finding: { file: string }) =>
                    finding.file === `convex/domain/${name}.ts`,
            );
            expect(actual, name).not.toHaveLength(0);
            expect(
                new Set(
                    actual.map((finding: { rule: string }) => finding.rule),
                ),
                name,
            ).toEqual(new Set(expectedRules[name]));
            expect(
                actual.every((finding: { line: number }) => finding.line === 1),
                name,
            ).toBe(true);
        }
        expect(
            findings.filter((f: { file: string }) =>
                f.file.endsWith("allowed.ts"),
            ),
        ).toEqual([]);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("execution import tiers distinguish heavy dependencies, runtime Zod, and type imports", async () => {
    const { checkExecutionBoundaries } = await import(
        /* @vite-ignore */ pathToFileURL(
            resolve("scripts/check-execution-boundaries.ts"),
        ).href
    );
    const root = mkdtempSync(join(tmpdir(), "execution-imports-"));
    try {
        mkdirSync(join(root, "convex/execution"), { recursive: true });
        writeFileSync(join(root, "tsconfig.json"), "{}");
        writeFileSync(
            join(root, "convex/execution/piStore.ts"),
            'export { value } from "./bridge"; import type { ZodType } from "zod";',
        );
        writeFileSync(
            join(root, "convex/execution/bridge.ts"),
            'export { type ZodType, z as value } from "zod";',
        );
        writeFileSync(
            join(root, "convex/execution/operations.ts"),
            'import "./tier2"; import { z } from "zod"; export const runtime = z;',
        );
        writeFileSync(
            join(root, "convex/execution/tier2.ts"),
            'export { Type } from "@earendil-works/pi-ai"; import type { Doc } from "@convex/schema";',
        );
        writeFileSync(
            join(root, "convex/execution/piControlReads.ts"),
            'export { z } from "zod";',
        );
        writeFileSync(
            join(root, "convex/execution/piControl.ts"),
            'import value = require("./bridge"); import("./missing"); import(String(value));',
        );
        expect(checkExecutionBoundaries(root)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    file: "convex/execution/piStore.ts",
                    rule: "execution-import",
                    message: expect.stringMatching(/bridge.*zod/),
                }),
                expect.objectContaining({
                    file: "convex/execution/operations.ts",
                    rule: "execution-import",
                    message: expect.stringMatching(/tier2.*pi-ai/),
                }),
                expect.objectContaining({
                    file: "convex/execution/piControlReads.ts",
                    rule: "execution-import",
                    message: expect.stringMatching(/zod/),
                }),
                expect.objectContaining({
                    file: "convex/execution/piControl.ts",
                    rule: "execution-import",
                    message: expect.stringMatching(/import equals/),
                }),
                expect.objectContaining({
                    file: "convex/execution/piControl.ts",
                    rule: "execution-import",
                    message: expect.stringMatching(/unresolved.*missing/),
                }),
                expect.objectContaining({
                    file: "convex/execution/piControl.ts",
                    rule: "execution-import",
                    message: expect.stringMatching(/non-literal/),
                }),
            ]),
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
