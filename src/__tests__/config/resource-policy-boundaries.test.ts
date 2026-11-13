// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkResourcePolicy } from "@scripts/check-resource-policy";
import { afterEach, expect, test } from "vitest";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0))
        rmSync(root, { recursive: true, force: true });
});
function fixture(files: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), "resource-policy-boundaries-"));
    roots.push(root);
    const sources = {
        "tsconfig.json": JSON.stringify({
            compilerOptions: {
                target: "ESNext",
                module: "ESNext",
                allowJs: true,
            },
            include: ["**/*.ts", "**/*.mjs"],
        }),
        "convex/resourcePolicy.ts":
            "export const IO = { timeoutMs: 120000, maxBytes: 65536 };",
        ...files,
    };
    for (const [file, text] of Object.entries(sources)) {
        const path = join(root, file);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
    }
    return root;
}

test("new transport capacities and client page defaults cannot become independent policy owners", () => {
    const files = {
        "convex/new-request.ts":
            "export const options = { maxBytes: 64 * 1024, maxOutputTokens: 6144 };",
        "src/hooks/new-pagination.ts":
            "export const options = { initialNumItems: 12 };",
    };
    const findings = checkResourcePolicy(fixture(files));
    for (const file of Object.keys(files))
        expect(findings).toContainEqual(
            expect.objectContaining({ file, rule: "resource-default" }),
        );
});

test("shorthand resource settings reject local defaults but preserve authoritative inputs", () => {
    const findings = checkResourcePolicy(
        fixture({
            "convex/shorthand.ts": `const timeout = 60000;
const maxOutputTokens = 6144;
const initialNumItems = 12;
export const request = { timeout, maxOutputTokens, initialNumItems };`,
            "convex/authoritative.ts": `import { IO } from './resourcePolicy';
const timeout = IO.timeoutMs;
export const options = { timeout };
const numItems = 1;
export const singleton = { numItems };
const contextWindow = 32768;
const maxTokens = 4096;
export const descriptor = { contextWindow, maxTokens };
export function granted(maxOutputTokens: number, initialNumItems: number) {
return { maxOutputTokens, initialNumItems };
}`,
        }),
    );
    expect(
        findings.filter((finding) => finding.file === "convex/shorthand.ts"),
    ).toEqual([
        expect.objectContaining({
            rule: "resource-default",
            message: expect.stringContaining("timeout must consume"),
        }),
        expect.objectContaining({
            rule: "resource-default",
            message: expect.stringContaining("maxOutputTokens must consume"),
        }),
        expect.objectContaining({
            rule: "resource-default",
            message: expect.stringContaining("initialNumItems must consume"),
        }),
    ]);
    expect(
        findings.filter(
            (finding) => finding.file === "convex/authoritative.ts",
        ),
    ).toEqual([]);
});

test("timer aliases and new operational schedulers cannot bypass timeout ownership", () => {
    const files = {
        "convex/renamed-clock.ts":
            "const clock = AbortSignal.timeout; export const signal = clock(60000);",
        "scripts/new-poll.ts":
            "const later = setTimeout; export function poll() { return later(() => {}, 5000); }",
    };
    const findings = checkResourcePolicy(fixture(files));
    for (const file of Object.keys(files))
        expect(findings).toContainEqual(
            expect.objectContaining({ file, rule: "resource-default" }),
        );
});

test("shared policy, immutable authority, singleton reads, capabilities and UI timing remain valid", () => {
    const root = fixture({
        "convex/allowed.ts": `import { IO as policy } from "@convex/resourcePolicy";
const wait = 60000;
export function supplied(wait: number) { return AbortSignal.timeout(wait); }
export function granted(grant: { deadlineAt: number }) { return AbortSignal.timeout(Math.max(1, grant.deadlineAt - Date.now())); }
export function seconds(seconds: number) { return AbortSignal.timeout(seconds * 1000); }
export const request = { timeoutMs: policy.timeoutMs, maxBytes: policy.maxBytes, maxRetries: 0 };
export const singleton = { numItems: 1 };
export const descriptor = { contextWindow: 32768, maxTokens: 4096 };
export const noOutput = { maxOutputTokens: 0 };
export const decoded = { timeoutMs: Number.parseInt(process.env.TIMEOUT_MS ?? String(policy.timeoutMs), 10) };`,
        "src/components/animation.ts":
            "export function animate() { return setTimeout(() => {}, 300); }",
        "convex/domain/questions.ts":
            "const dimensions = ['a', 'b']; export const MAX_QUESTIONS = dimensions.length + 1;",
        "convex/_generated/frozen.ts":
            "export const options = { timeoutMs: 60000 };",
        "scripts/evaluations/runs/captured.ts":
            "export const options = { timeoutMs: 60000 };",
    });
    expect(checkResourcePolicy(root)).toEqual([]);
});

test("byte measurements cannot stand in for token admission or be added to output tokens", () => {
    const files = {
        "scripts/reviewer-admission.ts":
            "export function admit(context: unknown, limits: { maxInputTokens: number }) { const bytes = Buffer.byteLength(JSON.stringify(context)); return bytes <= limits.maxInputTokens; }",
        "scripts/study-admission.ts":
            "export function admit(context: unknown, model: { contextLength: number; maxOutputTokens: number }) { const bytes = Buffer.byteLength(JSON.stringify(context)); return bytes + model.maxOutputTokens < model.contextLength; }",
        "convex/assigned-tokens.ts":
            "export function settings(context: string) { return { maxInputTokens: Buffer.byteLength(context) }; }",
        "convex/shorthand-tokens.ts":
            "export function settings(context: string) { const maxInputTokens = Buffer.byteLength(context); return { maxInputTokens }; }",
    };
    const findings = checkResourcePolicy(fixture(files));
    for (const file of Object.keys(files))
        expect(findings).toContainEqual(
            expect.objectContaining({ file, rule: "resource-units" }),
        );
});

test("matching byte bounds, token capacity and financial exposure remain distinct", () => {
    const root = fixture({
        "convex/units.ts": `export function admit(bytes: number, inputTokens: number, outputTokens: number, limits: {maxBytes: number;contextWindow: number;remainingUsd: number;inputPrice: number}) {
return bytes <= limits.maxBytes && inputTokens + outputTokens <= limits.contextWindow && bytes * limits.inputPrice / 1e6 <= limits.remainingUsd;
}`,
    });
    expect(checkResourcePolicy(root)).toEqual([]);
});

test("unit labels do not leak through Boolean conditions, opaque calls or callback bodies", () => {
    const root = fixture({
        "scripts/units.ts": `const bytes = 10; declare const outputTokens: number;
export const valid = bytes > 0 && outputTokens > 0;
export const finite = Number.isSafeInteger(outputTokens) && outputTokens >= 0;
export function retain(read: () => string, limits: { maxBytes: number }) {
const text = read(); return Buffer.byteLength(text) <= limits.maxBytes;
}
const template = { maxInputTokens: outputTokens };
export const text = JSON.stringify(template);
export const fits = Buffer.byteLength(text) <= bytes;
export const exposure = bytes * 0.1 + Number(template.maxInputTokens) * 0.2;`,
    });
    expect(checkResourcePolicy(root)).toEqual([]);
});

test("a justified frozen-study exception is local and cannot become a file-wide ignore", () => {
    const root = fixture({
        "scripts/study.ts": `// resource-policy-exception: Frozen v1 comparison condition, not an application generation default.
export const old = { maxOutputTokens: 1024 };
export const drift = { maxOutputTokens: 2048 };`,
    });
    const findings = checkResourcePolicy(root);
    expect(findings).toEqual([
        expect.objectContaining({
            file: "scripts/study.ts",
            line: 3,
            rule: "resource-default",
        }),
    ]);
});

test("blank and redundant resource exceptions fail instead of hiding unrelated code", () => {
    const root = fixture({
        "scripts/blank.ts":
            "// resource-policy-exception:\nexport const options = { timeoutMs: 60000 };",
        "scripts/unused.ts":
            "// resource-policy-exception: Former fixed study bound, now removed.\nexport const options = { maxRetries: 0 };",
    });
    const findings = checkResourcePolicy(root);
    for (const file of ["scripts/blank.ts", "scripts/unused.ts"])
        expect(findings).toContainEqual(
            expect.objectContaining({
                file,
                line: 1,
                rule: "resource-exception",
            }),
        );
    expect(findings).toContainEqual(
        expect.objectContaining({
            file: "scripts/blank.ts",
            line: 2,
            rule: "resource-default",
        }),
    );
});

test("local record aliases and resource parameter defaults cannot hide new capacities", () => {
    const files = {
        "convex/record.ts":
            "const values = { size: 65536 }; const alias = values; export const request = { maxBytes: alias.size };",
        "scripts/parameter.ts":
            "export function request(maxBytes = 65536) { return maxBytes; }",
        "convex/aliased-clamp.ts":
            "declare const remaining: number; const clamp = Math.min(60000, remaining); export const signal = AbortSignal.timeout(clamp);",
    };
    const findings = checkResourcePolicy(fixture(files));
    for (const file of Object.keys(files))
        expect(findings).toContainEqual(
            expect.objectContaining({ file, rule: "resource-default" }),
        );
});

test("a capability alias sharing its property name does not recursively resolve itself", () => {
    const root = fixture({
        "convex/capability.ts": `declare const route: { descriptor: { maxTokens: number } };
const maxTokens = route.descriptor.maxTokens;
export const request = { maxOutputTokens: maxTokens };`,
    });
    expect(checkResourcePolicy(root)).toEqual([]);
});

test("a local cutoff cannot hide inside a remaining-authority clamp", () => {
    const root = fixture({
        "convex/integrations/new-provider.ts":
            "export function dispatch(grant: { deadlineAt: number }) { return AbortSignal.timeout(Math.min(60000, grant.deadlineAt - Date.now())); }",
    });
    expect(checkResourcePolicy(root)).toContainEqual(
        expect.objectContaining({
            file: "convex/integrations/new-provider.ts",
            rule: "resource-default",
        }),
    );
});

test("the real checker rejects a caller-local generation timeout through a constant alias", () => {
    const root = fixture({
        "convex/integrations/new-provider.ts":
            "const wait = 60 * 1000; const cutoff = wait; export function dispatch() { return AbortSignal.timeout(cutoff); }",
    });
    expect(checkResourcePolicy(root)).toContainEqual(
        expect.objectContaining({
            file: "convex/integrations/new-provider.ts",
            rule: "resource-default",
            line: 1,
        }),
    );
});
