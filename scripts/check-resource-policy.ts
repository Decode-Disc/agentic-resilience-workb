import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";

export type ResourcePolicyFinding = {
    file: string;
    line: number;
    rule: string;
    message: string;
};
type Scope = { parent?: Scope; values: Map<string, ts.Node | undefined> };
const excluded = new Set([
    "node_modules",
    "_generated",
    "__tests__",
    "fixtures",
    "runs",
    "archives",
    "dist",
    ".git",
    ".pi",
    ".agents",
]);
function* sources(directory: string): Generator<string> {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (excluded.has(entry.name)) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) yield* sources(path);
        else if (
            entry.isFile() &&
            /\.(?:ts|tsx|mjs)$/.test(entry.name) &&
            !/\.(?:test|spec|gen|generated|d)\./.test(entry.name)
        )
            yield path;
    }
}
const resourceProperties = new Set([
    "timeout",
    "timeoutMs",
    "maxBuffer",
    "maxBytes",
    "maxTokens",
    "maxInputTokens",
    "maxOutputTokens",
    "maxCompletionTokens",
    "max_tokens",
    "max_completion_tokens",
    "initialNumItems",
    "numItems",
]);
const lexicalKinds = new Set([
    ts.SyntaxKind.Block,
    ts.SyntaxKind.FunctionDeclaration,
    ts.SyntaxKind.FunctionExpression,
    ts.SyntaxKind.ArrowFunction,
    ts.SyntaxKind.MethodDeclaration,
    ts.SyntaxKind.Constructor,
    ts.SyntaxKind.GetAccessor,
    ts.SyntaxKind.SetAccessor,
]);
function unwrap(node: ts.Node): ts.Node {
    return ts.isParenthesizedExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isSatisfiesExpression(node) ||
        ts.isNonNullExpression(node)
        ? unwrap(node.expression)
        : node;
}

function propertyKey(name: ts.PropertyName): string | undefined {
    if (ts.isComputedPropertyName(name))
        return ts.isStringLiteral(name.expression)
            ? name.expression.text
            : undefined;
    return ts.isIdentifier(name) || ts.isStringLiteral(name)
        ? name.text
        : undefined;
}

/** Checks known resource sinks; dynamic computation is still protected by runtime authority checks. */
export function checkResourcePolicy(root: string): ResourcePolicyFinding[] {
    const files = ["convex", "src", "scripts", "services"].flatMap((path) => [
        ...sources(resolve(root, path)),
    ]);
    const api = new API({ cwd: root });
    const findings: ResourcePolicyFinding[] = [];
    try {
        const snapshot = api.updateSnapshot({ openFiles: files });
        for (const path of files) {
            if (path === resolve(root, "convex/resourcePolicy.ts")) continue;
            const source = snapshot
                .getDefaultProjectForFile(path)
                ?.program.getSourceFile(path);
            if (!source) throw new Error(`Cannot parse ${path}`);
            const scopes = new Map<ts.Node, Scope>();
            const parents = new Map<ts.Node, ts.Node>();
            const top: Scope = { values: new Map() };
            const index = (node: ts.Node, outer: Scope) => {
                const scope: Scope = lexicalKinds.has(node.kind)
                    ? { parent: outer, values: new Map() }
                    : outer;
                scopes.set(node, scope);
                if (
                    (ts.isVariableDeclaration(node) ||
                        ts.isParameterDeclaration(node)) &&
                    ts.isIdentifier(node.name)
                )
                    scope.values.set(node.name.text, node.initializer);
                node.forEachChild((child) => {
                    parents.set(child, node);
                    index(child, scope);
                });
            };
            index(source, top);
            const bindingScope = (node: ts.Identifier) => {
                let scope = scopes.get(node);
                while (scope && !scope.values.has(node.text))
                    scope = scope.parent;
                return scope;
            };
            const callName = (
                input: ts.Node,
                seen = new Set<ts.Node>(),
            ): string | undefined => {
                const node = unwrap(input);
                if (seen.has(node)) return undefined;
                const next = new Set(seen).add(node);
                if (ts.isIdentifier(node)) {
                    const scope = bindingScope(node);
                    const initializer = scope?.values.get(node.text);
                    return scope
                        ? initializer
                            ? callName(initializer, next)
                            : undefined
                        : node.text;
                }
                if (ts.isPropertyAccessExpression(node)) {
                    const base = callName(node.expression, next);
                    return base ? `${base}.${node.name.text}` : undefined;
                }
                return undefined;
            };
            const localValue = (
                input: ts.Node,
                seen = new Set<ts.Node>(),
            ): ts.Node | undefined => {
                const node = unwrap(input);
                if (seen.has(node)) return undefined;
                const next = new Set(seen).add(node);
                if (ts.isIdentifier(node)) {
                    const initializer = bindingScope(node)?.values.get(
                        node.text,
                    );
                    return initializer ? localValue(initializer, next) : node;
                }
                if (ts.isPropertyAccessExpression(node)) {
                    const object = localValue(node.expression, next);
                    if (object && ts.isObjectLiteralExpression(object)) {
                        const property = object.properties.find(
                            (p) =>
                                ts.isPropertyAssignment(p) &&
                                propertyKey(p.name) === node.name.text,
                        );
                        if (property && ts.isPropertyAssignment(property))
                            return localValue(property.initializer, next);
                    }
                }
                return node;
            };
            const value = (
                input: ts.Node,
                seen = new Set<ts.Node>(),
            ): number | undefined => {
                const node = localValue(input);
                if (!node) return undefined;
                if (seen.has(node)) return undefined;
                const next = new Set(seen).add(node);
                if (ts.isNumericLiteral(node))
                    return Number(node.text.replaceAll("_", ""));
                if (ts.isIdentifier(node)) {
                    const initializer = bindingScope(node)?.values.get(
                        node.text,
                    );
                    return initializer ? value(initializer, next) : undefined;
                }
                if (ts.isBinaryExpression(node)) {
                    const left = value(node.left, next),
                        right = value(node.right, next);
                    if (left === undefined || right === undefined)
                        return undefined;
                    switch (node.operatorToken.kind) {
                        case ts.SyntaxKind.AsteriskToken:
                            return left * right;
                        case ts.SyntaxKind.PlusToken:
                            return left + right;
                        case ts.SyntaxKind.MinusToken:
                            return left - right;
                        case ts.SyntaxKind.SlashToken:
                            return left / right;
                    }
                }
                return undefined;
            };
            const hasLocalNumber = (
                input: ts.Node,
                seen = new Set<ts.Node>(),
            ): boolean => {
                const node = localValue(input);
                if (!node || seen.has(node)) return false;
                const next = new Set(seen).add(node);
                if (
                    ts.isPropertyAccessExpression(node) ||
                    lexicalKinds.has(node.kind)
                )
                    return false;
                const numeric = value(node);
                if (numeric !== undefined) return numeric > 0;
                if (
                    ts.isBinaryExpression(node) &&
                    node.operatorToken.kind === ts.SyntaxKind.AsteriskToken
                ) {
                    if (
                        value(node.left) === 1000 &&
                        value(node.right) === undefined
                    )
                        return hasLocalNumber(node.right, next);
                    if (
                        value(node.right) === 1000 &&
                        value(node.left) === undefined
                    )
                        return hasLocalNumber(node.left, next);
                }
                if (ts.isCallExpression(node)) {
                    if (
                        ["Number.parseInt", "parseInt"].includes(
                            callName(node.expression) ?? "",
                        )
                    )
                        return (
                            !!node.arguments[0] &&
                            hasLocalNumber(node.arguments[0], next)
                        );
                    if (
                        callName(node.expression) === "Math.max" &&
                        node.arguments.some((arg) => value(arg) === undefined)
                    )
                        return node.arguments.some(
                            (arg) =>
                                value(arg) !== 1 && hasLocalNumber(arg, next),
                        );
                    return (
                        node.arguments.some((arg) =>
                            hasLocalNumber(arg, next),
                        ) ||
                        (ts.isPropertyAccessExpression(node.expression) &&
                            ts.isCallExpression(node.expression.expression) &&
                            hasLocalNumber(node.expression.expression, next))
                    );
                }
                let found = false;
                node.forEachChild((child) => {
                    if (hasLocalNumber(child, next)) found = true;
                });
                return found;
            };
            const hasUnit = (
                input: ts.Node,
                unit: "bytes" | "tokens",
                seen = new Set<ts.Node>(),
            ): boolean => {
                const node = unwrap(input);
                if (seen.has(node)) return false;
                const next = new Set(seen).add(node);
                const name = ts.isIdentifier(node)
                    ? node.text
                    : ts.isPropertyAccessExpression(node)
                      ? node.name.text
                      : undefined;
                if (
                    name &&
                    (unit === "bytes"
                        ? /(?:^bytes$|Bytes$|byteLength$)/i
                        : /(?:Tokens$|^tokens$|contextWindow$|contextLength$)/i
                    ).test(name)
                )
                    return true;
                if (ts.isCallExpression(node))
                    return (
                        unit === "bytes" &&
                        callName(node.expression) === "Buffer.byteLength"
                    );
                if (
                    ts.isBinaryExpression(node) &&
                    ![
                        ts.SyntaxKind.PlusToken,
                        ts.SyntaxKind.MinusToken,
                        ts.SyntaxKind.AsteriskToken,
                        ts.SyntaxKind.SlashToken,
                    ].includes(node.operatorToken.kind)
                )
                    return false;
                if (lexicalKinds.has(node.kind)) return false;
                if (ts.isIdentifier(node)) {
                    const initializer = bindingScope(node)?.values.get(
                        node.text,
                    );
                    if (initializer && hasUnit(initializer, unit, next))
                        return true;
                }
                if (
                    ts.isPropertyAccessExpression(node) ||
                    ts.isObjectLiteralExpression(node) ||
                    ts.isArrayLiteralExpression(node)
                )
                    return false;
                let found = false;
                node.forEachChild((child) => {
                    if (hasUnit(child, unit, next)) found = true;
                });
                return found;
            };
            const file = relative(root, path).replaceAll("\\", "/");
            const exceptions = new Map<
                number,
                { reason: string; used: boolean }
            >();
            source.text.split("\n").forEach((line, index) => {
                const match =
                    /^\s*\/\/\s*resource-policy-exception(?::(.*))?$/.exec(
                        line,
                    );
                if (match)
                    exceptions.set(index + 1, {
                        reason: match[1]?.trim() ?? "",
                        used: false,
                    });
            });
            const report = (
                node: ts.Node,
                message: string,
                rule = "resource-default",
            ) => {
                const line =
                    source.getLineAndCharacterOfPosition(node.getStart(source))
                        .line + 1;
                const exception = exceptions.get(line - 1);
                if (rule === "resource-default" && exception?.reason) {
                    exception.used = true;
                    return;
                }
                findings.push({ file, line, rule, message });
            };
            const visit = (node: ts.Node) => {
                if (ts.isCallExpression(node)) {
                    const name = callName(node.expression);
                    const argument =
                        name === "AbortSignal.timeout" ||
                        name?.endsWith(".setDefaultTimeout") ||
                        name?.endsWith(".setDefaultNavigationTimeout")
                            ? node.arguments[0]
                            : !path.startsWith(`${resolve(root, "src")}/`) &&
                                [
                                    "setTimeout",
                                    "setInterval",
                                    "globalThis.setTimeout",
                                    "globalThis.setInterval",
                                ].includes(name ?? "")
                              ? node.arguments[1]
                              : undefined;
                    if (argument && hasLocalNumber(argument))
                        report(
                            node,
                            "Use canonical resource policy or remaining immutable authority, not a caller-local timeout.",
                        );
                }
                if (
                    ts.isParameterDeclaration(node) &&
                    node.initializer &&
                    ts.isIdentifier(node.name) &&
                    resourceProperties.has(node.name.text) &&
                    hasLocalNumber(node.initializer)
                )
                    report(
                        node,
                        "Resource parameter defaults must consume canonical policy.",
                    );
                if (
                    ts.isPropertyAssignment(node) ||
                    ts.isShorthandPropertyAssignment(node)
                ) {
                    const key = propertyKey(node.name);
                    const initializer = ts.isShorthandPropertyAssignment(node)
                        ? node.name
                        : node.initializer;
                    if (
                        key &&
                        /(?:Tokens$|^max_tokens$|^max_completion_tokens$)/i.test(
                            key,
                        ) &&
                        hasUnit(initializer, "bytes")
                    )
                        report(
                            node,
                            "Byte measurements cannot substitute for token capacity.",
                            "resource-units",
                        );
                    const object = parents.get(node);
                    const capability =
                        key === "maxTokens" &&
                        object &&
                        ts.isObjectLiteralExpression(object) &&
                        object.properties.some(
                            (p) =>
                                (ts.isPropertyAssignment(p) ||
                                    ts.isShorthandPropertyAssignment(p)) &&
                                p.name.getText(source) === "contextWindow",
                        );
                    if (
                        key &&
                        resourceProperties.has(key) &&
                        !(key === "numItems" && value(initializer) === 1) &&
                        !capability &&
                        hasLocalNumber(initializer)
                    )
                        report(
                            node,
                            `${key} must consume shared policy or authoritative inputs, not a caller-local default.`,
                        );
                }
                if (
                    ts.isBinaryExpression(node) &&
                    [
                        ts.SyntaxKind.PlusToken,
                        ts.SyntaxKind.LessThanToken,
                        ts.SyntaxKind.LessThanEqualsToken,
                        ts.SyntaxKind.GreaterThanToken,
                        ts.SyntaxKind.GreaterThanEqualsToken,
                    ].includes(node.operatorToken.kind)
                ) {
                    if (
                        (hasUnit(node.left, "bytes") &&
                            hasUnit(node.right, "tokens")) ||
                        (hasUnit(node.right, "bytes") &&
                            hasUnit(node.left, "tokens"))
                    )
                        report(
                            node,
                            "Byte measurements cannot substitute for or be added to token capacity.",
                            "resource-units",
                        );
                }
                node.forEachChild(visit);
            };
            visit(source);
            for (const [line, exception] of exceptions)
                if (!exception.reason || !exception.used)
                    findings.push({
                        file,
                        line,
                        rule: "resource-exception",
                        message:
                            "Resource exception needs a nonblank reason and a resource-default finding on the immediately following line.",
                    });
        }
    } finally {
        api.close();
    }
    return findings;
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    const findings = checkResourcePolicy(process.cwd());
    for (const finding of findings)
        console.error(
            `${finding.file}:${finding.line} [${finding.rule}] ${finding.message}`,
        );
    if (findings.length) process.exitCode = 1;
    else console.log("Resource policy checks passed.");
}
