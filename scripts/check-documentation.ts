import { spawnSync } from "node:child_process";
import {
    existsSync,
    readdirSync,
    readFileSync,
    realpathSync,
    statSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

type Role =
    | "reference"
    | "context"
    | "history"
    | "evidence"
    | "excluded"
    | "retired";
type Rule = {
    path: string;
    role: Role;
    warning: number | null;
    pattern: RegExp;
};
type Link = { target: string; offset: number };
type LocalTarget = { at: string; target: string; paths: string[] };

const root = realpathSync(process.cwd());
const errors: string[] = [];
const documents: string[] = [];
const localTargets: LocalTarget[] = [];
const headingCache = new Map<string, Set<string>>();
let localLinks = 0;

function patternFor(path: string) {
    const pattern = path
        .split(/(\*\*|\*)/)
        .map((part) => {
            if (part === "**") return ".*";
            if (part === "*") return "[^/]*";
            return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("");
    return new RegExp(
        `^${path.endsWith("/**") ? `${pattern.slice(0, -3)}(?:/.*)?` : pattern}$`,
    );
}

function readPolicy(): Rule[] {
    const content = readFileSync(resolve(root, "AGENTS.md"), "utf8");
    const tables = [
        ...content.matchAll(
            /<!-- documentation-policy:start -->([\s\S]*?)<!-- documentation-policy:end -->/g,
        ),
    ];
    if (tables.length !== 1)
        throw new Error("AGENTS.md: expected one documentation policy table");
    const rows = tables[0]?.[1]?.trim().split("\n").slice(2) ?? [];
    const rules: Rule[] = [];
    const roles = new Set([
        "reference",
        "context",
        "history",
        "evidence",
        "excluded",
        "retired",
    ]);
    for (const row of rows) {
        const cells = row
            .split("|")
            .slice(1, -1)
            .map((cell) => cell.trim());
        const path = cells[0]?.match(/^`([^`]+)`$/)?.[1];
        const role = cells[1];
        const warning = cells[2];
        if (
            cells.length !== 4 ||
            !path ||
            !role ||
            !roles.has(role) ||
            !warning ||
            !/^(?:-|[1-9]\d*)$/.test(warning) ||
            isAbsolute(path) ||
            path.includes("\\") ||
            path
                .split("/")
                .some((part) => part === ".." || part === "." || !part) ||
            rules.some((rule) => rule.path === path) ||
            ((role === "reference" || role === "context") && path.includes("*"))
        )
            throw new Error(`AGENTS.md: invalid policy row: ${row}`);
        rules.push({
            path,
            role: role as Role,
            warning: warning === "-" ? null : Number(warning),
            pattern: patternFor(path),
        });
    }
    if (
        !rules.some(
            (rule) => rule.path === "AGENTS.md" && rule.role === "reference",
        )
    ) {
        throw new Error("AGENTS.md: policy must identify its own reference");
    }
    return rules;
}

function insideRoot(path: string) {
    const local = relative(root, path);
    return (
        local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local)
    );
}

function collect(directory: string, rules: Rule[], rootOnly = false) {
    if (!insideRoot(realpathSync(resolve(root, directory)))) {
        errors.push(`${directory}: documentation directory outside repository`);
        return;
    }
    for (const entry of readdirSync(resolve(root, directory), {
        withFileTypes: true,
    }).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = directory ? `${directory}/${entry.name}` : entry.name;
        if (rootOnly && !entry.name.endsWith(".md")) continue;
        const rule = rules.find((candidate) => candidate.pattern.test(path));
        if (rule?.role === "excluded" && !entry.isDirectory()) continue;
        if (rule?.role === "retired") {
            errors.push(`${path}: retired documentation location`);
        } else if (entry.isDirectory()) {
            if (!rootOnly) collect(path, rules);
        } else if (entry.isSymbolicLink()) {
            errors.push(`${path}: symlinks are not authored documentation`);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
            if (!rule)
                errors.push(`${path}: unregistered documentation location`);
            else documents.push(path);
        }
    }
}

/** Preserve offsets for diagnostics while ignoring code examples and comments. */
function prose(content: string) {
    let fence: { character: string; length: number } | undefined;
    return content
        .replace(/<!--[\s\S]*?-->/g, (match) => match.replace(/[^\n]/g, " "))
        .split("\n")
        .map((line) => {
            const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
            if (fence) {
                if (
                    marker?.[1]?.[0] === fence.character &&
                    marker[1].length >= fence.length &&
                    !marker[2]?.trim()
                )
                    fence = undefined;
                return " ".repeat(line.length);
            }
            if (marker?.[1]) {
                fence = {
                    character: marker[1][0] ?? "`",
                    length: marker[1].length,
                };
                return " ".repeat(line.length);
            }
            return line;
        })
        .join("\n");
}

function headings(path: string) {
    const cached = headingCache.get(path);
    if (cached) return cached;
    const content = prose(readFileSync(path, "utf8"));
    const anchors = new Set<string>();
    const lines = content.split("\n");
    for (const [index, line] of lines.entries()) {
        const heading =
            line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/)?.[1] ??
            (/^ {0,3}(?:=+|-+)\s*$/.test(lines[index + 1] ?? "") && line.trim()
                ? line.trim()
                : undefined);
        if (!heading) continue;
        const slug = heading
            .replace(/<[^>]*>/g, "")
            .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
            .toLowerCase()
            .replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, "")
            .replace(/\s/g, "-");
        let unique = slug;
        for (let suffix = 1; anchors.has(unique); suffix++)
            unique = `${slug}-${suffix}`;
        anchors.add(unique);
    }
    for (const match of content.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) {
        if (match[1]) anchors.add(match[1]);
    }
    headingCache.set(path, anchors);
    return anchors;
}

/** Read a Markdown destination, including balanced parentheses or angle brackets. */
function destination(text: string, start: number) {
    let index = start;
    while (/\s/.test(text[index] ?? "")) index++;
    const angle = text[index] === "<";
    if (angle) index++;
    const from = index;
    let depth = 0;
    for (; index < text.length; index++) {
        const character = text[index];
        if (character === "\\") {
            index++;
            continue;
        }
        if (angle) {
            if (character === ">")
                return { target: text.slice(from, index), end: index + 1 };
            if (character === "\n") break;
        } else {
            if (character === "(") depth++;
            else if (character === ")") {
                if (!depth) break;
                depth--;
            } else if (/\s/.test(character ?? "")) break;
        }
    }
    return { target: text.slice(from, index), end: index };
}

function location(path: string, content: string, offset: number) {
    return `${path}:${content.slice(0, offset).split("\n").length}`;
}

function links(path: string, content: string): Link[] {
    let text = prose(content).replace(/(`+)([\s\S]*?)\1/g, (match) =>
        match.replace(/[^\n]/g, " "),
    );
    const result: Link[] = [];
    const definitions = new Map<string, string>();
    const key = (label: string) =>
        label.trim().replace(/\s+/g, " ").toLowerCase();
    text = text.replace(
        /^ {0,3}\[([^\]\n]+)\]:[^\n]*$/gm,
        (match: string, label: string, offset: number) => {
            const target = destination(match, match.indexOf(":") + 1).target;
            if (!definitions.has(key(label)))
                definitions.set(key(label), target);
            result.push({ target, offset });
            return " ".repeat(match.length);
        },
    );
    const inline = /!?\[[^\]\n]*\]\(\s*/g;
    const spans: [number, number][] = [];
    for (let match = inline.exec(text); match; match = inline.exec(text)) {
        const found = destination(text, inline.lastIndex);
        const close = text
            .slice(found.end)
            .match(
                /^\s*(?:(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\([^)]*\))\s*)?\)/,
            );
        if (!close) {
            errors.push(
                `${location(path, content, match.index)}: malformed Markdown link`,
            );
            continue;
        }
        result.push({ target: found.target, offset: match.index });
        inline.lastIndex = found.end + close[0].length;
        spans.push([match.index, inline.lastIndex]);
    }
    for (const [start, end] of spans.reverse())
        text =
            text.slice(0, start) +
            text.slice(start, end).replace(/[^\n]/g, " ") +
            text.slice(end);
    for (const match of text.matchAll(/!?\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g)) {
        const label = key(match[2] || match[1] || "");
        const target = definitions.get(label);
        if (target !== undefined) result.push({ target, offset: match.index });
        else if (match[2] !== undefined)
            errors.push(
                `${location(path, content, match.index)}: undefined reference ${label}`,
            );
    }
    return result;
}

function repoPath(resolved: string) {
    return relative(root, resolved).split(sep).join("/");
}

function gitIgnoredPaths(paths: string[]): Set<string> {
    if (!paths.length) return new Set();
    const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: root,
        encoding: "utf8",
    });
    if (
        inside.error ||
        inside.status !== 0 ||
        inside.stdout.trim() !== "true"
    ) {
        return new Set();
    }
    const result = spawnSync("git", ["check-ignore", "-z", "--stdin"], {
        cwd: root,
        input: `${paths.join("\0")}\0`,
        encoding: "utf8",
    });
    if (result.error) throw result.error;
    if (result.status !== 0 && result.status !== 1) {
        throw new Error(
            `git check-ignore failed (${result.status}): ${result.stderr.trim()}`,
        );
    }
    return new Set(result.stdout.split("\0").filter(Boolean));
}

function checkLink(path: string, content: string, link: Link) {
    const target = link.target.replace(/\\([^\w])/g, "$1");
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return;
    localLinks++;
    const at = location(path, content, link.offset);
    let file: string;
    let anchor: string;
    try {
        const hash = target.indexOf("#");
        file = decodeURIComponent(
            (hash < 0 ? target : target.slice(0, hash)).split("?")[0] ?? "",
        );
        anchor = hash < 0 ? "" : decodeURIComponent(target.slice(hash + 1));
    } catch {
        errors.push(`${at}: invalid URL encoding in ${target}`);
        return;
    }
    const resolved = file
        ? resolve(
              file.startsWith("/") ? root : dirname(resolve(root, path)),
              file.replace(/^\//, ""),
          )
        : resolve(root, path);
    const real = existsSync(resolved) ? realpathSync(resolved) : undefined;
    if (!insideRoot(resolved) || (real && !insideRoot(real))) {
        errors.push(`${at}: target outside repository: ${target}`);
    } else if (!real) {
        errors.push(`${at}: missing target ${target}`);
    } else {
        const paths = [
            ...new Set([repoPath(resolved), repoPath(real)].filter(Boolean)),
        ];
        if (paths.length) localTargets.push({ at, target, paths });
        if (
            anchor &&
            resolved.endsWith(".md") &&
            statSync(resolved).isFile() &&
            !headings(resolved).has(anchor)
        ) {
            errors.push(`${at}: missing heading #${anchor} in ${file || path}`);
        }
    }
}

try {
    const rules = readPolicy();
    collect("", rules, true);
    for (const directory of ["context", "docs", "scripts/evaluations"]) {
        if (existsSync(resolve(root, directory))) collect(directory, rules);
    }
    for (const rule of rules.filter(
        (entry) => entry.role === "reference" || entry.role === "context",
    )) {
        if (!documents.includes(rule.path))
            errors.push(`${rule.path}: required ${rule.role} is missing`);
    }
    for (const path of documents.sort()) {
        const content = readFileSync(resolve(root, path), "utf8");
        const rule = rules.find((entry) => entry.pattern.test(path));
        if (rule?.role === "reference") {
            const words = content.match(/\S+/g)?.length ?? 0;
            console.log(
                `${path}: ${words} words${rule.warning !== null && words > rule.warning ? ` (WARNING: advisory limit ${rule.warning})` : ""}`,
            );
        }
        for (const link of links(path, content)) checkLink(path, content, link);
    }
    const ignored = gitIgnoredPaths([
        ...new Set(localTargets.flatMap((entry) => entry.paths)),
    ]);
    for (const entry of localTargets) {
        if (entry.paths.some((path) => ignored.has(path))) {
            errors.push(`${entry.at}: target is gitignored: ${entry.target}`);
        }
    }
    for (const error of errors) console.error(error);
    console.log(
        `Documentation: ${documents.length} Markdown files, ${localLinks} local links, ${errors.length} errors.`,
    );
    if (errors.length) process.exitCode = 1;
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
