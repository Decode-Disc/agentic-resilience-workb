import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";

const FIELD_OWNERS: Record<string, readonly string[]> = {
    progressKeys: ["operations", "missions"],
    noProgressTurns: ["missions", "invocationLifecycle"],
    recoveryRead: ["invocationLifecycle"],
    lastSettledInvocationId: ["missions", "invocationLifecycle"],
    historyRead: ["operations"],
    historySourceSequence: ["authority", "journal"],
    historyMaterialSequence: ["authority"],
    historyProjection: ["missions", "journal", "history"],
};
const TABLE_OWNERS: Record<string, readonly string[]> = {
    agentOperationRequests: ["operations", "handoffs"],
    agentInvocationPayloads: ["journal"],
    retainedTexts: ["retainedText"],
    retainedTextFragments: ["retainedText"],
};
// These are the existing driver/transaction boundaries, not an exemption for all execution modules.
const FUNCTION_OWNERS: Record<string, readonly string[]> = {
    "execution.retainedText.stageRetainedText": [
        "journal",
        "piStore",
        "invocationLifecycle",
    ],
    "execution.operations.recordResult": [
        "operations",
        "handoffs",
        "missionWorkflow",
    ],
    "execution.operations.persistOperationRequest": [
        "operations",
        "invocationLifecycle",
    ],
    "execution.operations.settleDispatchFailure": ["operations"],
    "execution.progress.adoptProgress": ["operations"],
    "execution.journal.retainExecutionEventPayload": [
        "operations",
        "authority",
    ],
    "execution.journal.retainInvocationPayload": ["invocationLifecycle"],
};
const executionFile = (name: string) => `convex/execution/${name}.ts`;
function* sources(directory: string): Generator<string> {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === "_generated") continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) yield* sources(path);
        else if (entry.name.endsWith(".ts")) yield path;
    }
}
function unwrap(node: ts.Node): ts.Node {
    return ts.isAsExpression(node) ||
        ts.isParenthesizedExpression(node) ||
        ts.isNonNullExpression(node) ||
        ts.isSatisfiesExpression(node)
        ? unwrap(node.expression)
        : node;
}
function enclosingBinding(
    node: ts.Node,
    source: ts.SourceFile,
): string | undefined {
    // Node parent links are not required: the traversal records lexical owners separately.
    const statement = source.statements.find(
        (statement) => statement.pos <= node.pos && statement.end >= node.end,
    );
    if (statement && ts.isFunctionDeclaration(statement))
        return statement.name?.text;
    return source.statements
        .find(
            (statement) =>
                ts.isVariableStatement(statement) &&
                statement.pos <= node.pos &&
                statement.end >= node.end &&
                statement.declarationList.declarations.length === 1,
        )
        ?.getText(source)
        .match(/^(?:export\s+)?const\s+(\w+)/)?.[1];
}

/** Enforce supported AST write/reference patterns; runtime contracts remain mandatory for arbitrary JavaScript. */
export function checkExecutionBoundaries(
    root: string,
): readonly { file: string; line: number; rule: string; message: string }[] {
    const files = [...sources(resolve(root, "convex"))];
    const api = new API({ cwd: root });
    const findings: {
        file: string;
        line: number;
        rule: string;
        message: string;
    }[] = [];
    try {
        const snapshot = api.updateSnapshot({ openFiles: files });
        for (const path of files) {
            const project = snapshot.getDefaultProjectForFile(path);
            const source = project?.program.getSourceFile(path);
            if (!source || !project) throw new Error(`Cannot parse ${path}`);
            const file = relative(root, path).replaceAll("\\", "/");
            const identifiers: ts.Identifier[] = [];
            const collectIdentifiers = (node: ts.Node) => {
                if (ts.isIdentifier(node)) identifiers.push(node);
                node.forEachChild(collectIdentifiers);
            };
            collectIdentifiers(source);
            const symbols = project.checker.getSymbolAtLocation(identifiers);
            const identities = new Map(
                identifiers.map((node, index) => [
                    node,
                    symbols[index]?.id.toString() ?? node.text,
                ]),
            );
            const identity = (node: ts.Identifier) =>
                identities.get(node) ?? node.text;
            const aliases = new Map<string, string>();
            const values = new Map<string, ts.Node>();
            const report = (node: ts.Node, rule: string, message: string) =>
                findings.push({
                    file,
                    line:
                        source.getLineAndCharacterOfPosition(
                            node.getStart(source),
                        ).line + 1,
                    rule,
                    message,
                });
            let directivePrologue = true;
            for (const statement of source.statements) {
                const expression = ts.isExpressionStatement(statement)
                    ? unwrap(statement.expression)
                    : undefined;
                const directive =
                    ts.isExpressionStatement(statement) &&
                    ts.isStringLiteral(statement.expression);
                if (
                    expression &&
                    ts.isStringLiteral(expression) &&
                    expression.text === "use node" &&
                    (!directive || !directivePrologue)
                )
                    report(
                        statement,
                        "runtime-directive",
                        "Node runtime selection must be an unparenthesized directive before imports or other statements",
                    );
                directivePrologue = directivePrologue && directive;
            }
            for (const statement of source.statements) {
                if (
                    !ts.isImportDeclaration(statement) ||
                    !ts.isStringLiteral(statement.moduleSpecifier) ||
                    statement.importClause?.phaseModifier ===
                        ts.SyntaxKind.TypeKeyword
                )
                    continue;
                const specifier = statement.moduleSpecifier.text;
                const module =
                    specifier === "@convex/_generated/api" ||
                    /_generated\/api$/.test(specifier)
                        ? "generated"
                        : specifier.startsWith("@convex/")
                          ? specifier.slice(8).replaceAll("/", ".")
                          : specifier.startsWith(".")
                            ? relative(
                                  join(root, "convex"),
                                  resolve(dirname(path), specifier),
                              )
                                  .replaceAll("/", ".")
                                  .replace(/\.ts$/, "")
                            : specifier;
                const bindings = statement.importClause?.namedBindings;
                if (bindings && ts.isNamedImports(bindings))
                    for (const element of bindings.elements) {
                        if (element.isTypeOnly) continue;
                        const name = (element.propertyName ?? element.name)
                            .text;
                        aliases.set(
                            identity(element.name),
                            module === "generated" ? name : `${module}.${name}`,
                        );
                    }
                else if (bindings && ts.isNamespaceImport(bindings))
                    aliases.set(identity(bindings.name), module);
            }
            const chain = (
                input: ts.Node,
                seen = new Set<string>(),
            ): string | undefined => {
                const node = unwrap(input);
                if (ts.isIdentifier(node)) {
                    if (seen.has(identity(node))) return undefined;
                    seen.add(identity(node));
                    if (aliases.has(identity(node)))
                        return aliases.get(identity(node));
                    const value = values.get(identity(node));
                    return value ? chain(value, seen) : node.text;
                }
                if (ts.isPropertyAccessExpression(node)) {
                    const base = chain(node.expression, seen);
                    return base ? `${base}.${node.name.text}` : undefined;
                }
                if (
                    ts.isElementAccessExpression(node) &&
                    ts.isStringLiteral(node.argumentExpression)
                ) {
                    const base = chain(node.expression, seen);
                    return base
                        ? `${base}.${node.argumentExpression.text}`
                        : undefined;
                }
                return undefined;
            };
            const resolveValue = (
                node: ts.Node,
                seen = new Set<string>(),
            ): ts.Node => {
                node = unwrap(node);
                if (
                    ts.isIdentifier(node) &&
                    values.has(identity(node)) &&
                    !seen.has(identity(node))
                ) {
                    seen.add(identity(node));
                    const value = values.get(identity(node));
                    if (value) return resolveValue(value, seen);
                }
                return node;
            };
            const register = (node: ts.Node) => {
                if (ts.isVariableDeclaration(node) && node.initializer) {
                    if (ts.isIdentifier(node.name))
                        values.set(identity(node.name), node.initializer);
                    else if (ts.isObjectBindingPattern(node.name))
                        for (const binding of node.name.elements) {
                            if (binding.name && ts.isIdentifier(binding.name)) {
                                const base = chain(node.initializer);
                                const key = (
                                    binding.propertyName ?? binding.name
                                ).getText(source);
                                if (base)
                                    aliases.set(
                                        identity(binding.name),
                                        `${base}.${key}`,
                                    );
                            }
                        }
                }
                node.forEachChild(register);
            };
            register(source);
            const permitted = (owners: readonly string[] | undefined) =>
                owners?.some((name) => file === executionFile(name)) ?? false;
            const visit = (node: ts.Node) => {
                const name = chain(node)
                    ?.replace(/^internal\./, "")
                    .replace(/^generated\.internal\./, "");
                if (
                    name &&
                    Object.hasOwn(FUNCTION_OWNERS, name) &&
                    !permitted(FUNCTION_OWNERS[name])
                ) {
                    const deferred =
                        name === "execution.operations.recordResult" &&
                        file === "convex/domain/conversationValidation.ts" &&
                        enclosingBinding(node, source) === "completeDeferred";
                    if (!deferred)
                        report(
                            node,
                            "executor-owner",
                            `Only the execution owner may reference ${name}`,
                        );
                }
                if (
                    ts.isPropertyAssignment(node) &&
                    node.name.getText(source).replaceAll(/["']/g, "") ===
                        "historyRead" &&
                    !permitted([
                        "operations",
                        "history",
                        "schema",
                        "executionProtocol",
                    ])
                )
                    report(
                        node,
                        "private-receipt",
                        "History receipts belong to the shared reader and recorder",
                    );
                if (
                    ts.isCallExpression(node) &&
                    /\.db\.(patch|replace|insert|delete)$/.test(
                        chain(node.expression) ?? "",
                    )
                ) {
                    const first = node.arguments[0];
                    const literalTable =
                        first && ts.isStringLiteral(first)
                            ? first.text
                            : undefined;
                    const idType =
                        first && !literalTable
                            ? project.checker.getTypeAtLocation(first)
                            : undefined;
                    const typeText = idType
                        ? project.checker.typeToString(idType)
                        : "";
                    for (const [table, owners] of Object.entries(TABLE_OWNERS))
                        if (
                            (literalTable === table ||
                                typeText.includes(`"${table}"`)) &&
                            !permitted(owners) &&
                            !(
                                table === "agentOperationRequests" &&
                                [
                                    ["missions", "resume"],
                                    ["piControl", "rebind"],
                                    ["cancellation", "cancelMission"],
                                ].some(
                                    ([owner, binding]) =>
                                        file === executionFile(owner ?? "") &&
                                        enclosingBinding(node, source) ===
                                            binding,
                                )
                            )
                        )
                            report(
                                node,
                                "table-owner",
                                `Writes to ${table} belong to ${owners.join(", ")}`,
                            );
                    const update = node.arguments.at(-1);
                    if (
                        update &&
                        !/\.delete$/.test(chain(node.expression) ?? "")
                    ) {
                        const object = resolveValue(update);
                        const knownOtherTable = literalTable
                            ? ![
                                  "agentOperationRequests",
                                  "agentMissions",
                                  "agentExecutionEvents",
                                  "agentInvocationPayloads",
                              ].includes(literalTable)
                            : /(?:Id<|__tableName)/.test(typeText) &&
                              ![
                                  "agentOperationRequests",
                                  "agentMissions",
                                  "agentExecutionEvents",
                                  "agentInvocationPayloads",
                              ].some((table) =>
                                  typeText.includes(`"${table}"`),
                              );
                        const domain =
                            file.startsWith("convex/domain/") &&
                            !knownOtherTable;
                        if (!ts.isObjectLiteralExpression(object)) {
                            if (domain)
                                report(
                                    node,
                                    "unresolved-write",
                                    "Domain writes must expose their fields for ownership checking",
                                );
                        } else
                            for (const property of object.properties) {
                                if (
                                    ts.isSpreadAssignment(property) ||
                                    (property.name &&
                                        ts.isComputedPropertyName(
                                            property.name,
                                        ) &&
                                        !ts.isStringLiteral(
                                            property.name.expression,
                                        ))
                                ) {
                                    if (domain)
                                        report(
                                            property,
                                            "unresolved-write",
                                            "Computed/spread domain writes cannot hide executor fields",
                                        );
                                    continue;
                                }
                                const key = property.name
                                    ?.getText(source)
                                    .replaceAll(/["'[\]]/g, "");
                                if (
                                    key &&
                                    Object.hasOwn(FIELD_OWNERS, key) &&
                                    !permitted(FIELD_OWNERS[key])
                                )
                                    report(
                                        property,
                                        "field-owner",
                                        `${key} is owned by shared execution`,
                                    );
                                if (
                                    key === "payload" &&
                                    typeText.includes(
                                        '"agentExecutionEvents"',
                                    ) &&
                                    !permitted(["journal"])
                                )
                                    report(
                                        property,
                                        "journal-owner",
                                        "Immutable event payloads belong to journal",
                                    );
                            }
                    }
                }
                node.forEachChild(visit);
            };
            visit(source);
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
    const findings = checkExecutionBoundaries(process.cwd());
    for (const finding of findings)
        console.error(
            `${finding.file}:${finding.line} [${finding.rule}] ${finding.message}`,
        );
    if (findings.length) process.exitCode = 1;
    else console.log("Execution ownership checks passed.");
}
