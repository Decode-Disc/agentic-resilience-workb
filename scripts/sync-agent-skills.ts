import { createHash } from "node:crypto";
import {
    existsSync,
    lstatSync,
    readdirSync,
    readFileSync,
    realpathSync,
    writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
    formatSkillsForPrompt,
    loadSkills,
} from "@earendil-works/pi-coding-agent";

const argument = (name: string, fallback: string) => {
    const index = process.argv.indexOf(name);
    if (index < 0) return fallback;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${name}`);
    return value;
};
const root = resolve(argument("--root", "agent-skills"));
const output = resolve(
    argument("--output", "convex/integrations/agentSkillPackages.json"),
);
const id = argument("--package-id", "research-methods-v1");
if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Invalid package identity");
const virtualRoot = `/agent-skills/${id}/`;
const digest = (text: string) =>
    createHash("sha256").update(text).digest("hex");
const names = ["source-preparation", "workbench-framing"];
const resources: { path: string; content: string; hash: string }[] = [];
function collect(directory: string) {
    const contained = relative(realpathSync(root), realpathSync(directory));
    if (
        lstatSync(root).isSymbolicLink() ||
        lstatSync(directory).isSymbolicLink() ||
        contained === ".." ||
        contained.startsWith(`..${sep}`) ||
        isAbsolute(contained)
    )
        throw new Error(
            `Resource directory escapes authored root: ${directory}`,
        );
    for (const entry of readdirSync(directory).sort()) {
        const path = join(directory, entry);
        if (lstatSync(path).isSymbolicLink())
            throw new Error(`Symlinks are not admitted: ${path}`);
        if (lstatSync(path).isDirectory()) collect(path);
        else {
            if (!path.endsWith(".md"))
                throw new Error(`Non-Markdown resource: ${path}`);
            const content = readFileSync(path, "utf8");
            resources.push({
                path: virtualRoot + relative(root, path),
                content,
                hash: digest(content),
            });
        }
    }
}
for (const name of [...names, "references"]) collect(join(root, name));
resources.sort((a, b) => a.path.localeCompare(b.path));
for (const resource of resources)
    for (const match of resource.content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = match[1]?.split("#")[0];
        if (!target || /^[a-z]+:/i.test(target)) continue;
        const path = resolve(dirname(resource.path), target);
        if (isAbsolute(target) || !resources.some((item) => item.path === path))
            throw new Error(`Unadmitted reference: ${target}`);
    }
const discovered = loadSkills({
    cwd: root,
    agentDir: root,
    skillPaths: names.map((name) => join(root, name)),
    includeDefaults: false,
});
if (
    discovered.diagnostics.length ||
    discovered.skills.length !== 2 ||
    new Set(discovered.skills.map((skill) => skill.name)).size !== 2
)
    throw new Error(
        `Invalid native skill metadata: ${JSON.stringify(discovered.diagnostics)}`,
    );
const skills = Object.fromEntries(
    names.map((name) => {
        const skill = discovered.skills.find((item) => item.name === name);
        if (
            !skill ||
            realpathSync(skill.baseDir) !== realpathSync(join(root, name))
        )
            throw new Error(`Missing native skill ${name}`);
        return [
            name,
            {
                catalogue: formatSkillsForPrompt(
                    [
                        {
                            ...skill,
                            filePath: `${virtualRoot}${name}/SKILL.md`,
                            baseDir: `${virtualRoot}${name}`,
                        },
                    ],
                    "read",
                ),
                paths: resources
                    .filter(
                        (item) =>
                            item.path.startsWith(`${virtualRoot}${name}/`) ||
                            item.path.startsWith(`${virtualRoot}references/`),
                    )
                    .map((item) => item.path),
            },
        ];
    }),
);
const content = { id, skills, resources };
const pkg = { ...content, hash: digest(JSON.stringify(content)) };
const existing = existsSync(output)
    ? JSON.parse(readFileSync(output, "utf8"))
    : { formatVersion: 1, packages: [] };
if (existing.formatVersion !== 1) throw new Error("Unsupported package format");
const retained = existing.packages.find(
    (item: { id: string }) => item.id === id,
);
if (retained && JSON.stringify(retained) !== JSON.stringify(pkg))
    throw new Error("Immutable package changed; select a new package ID");
const result = `${JSON.stringify(
    {
        formatVersion: 1,
        packages: retained ? existing.packages : [...existing.packages, pkg],
    },
    null,
    4,
)}\n`;
if (process.argv.includes("--check")) {
    if (!existsSync(output) || readFileSync(output, "utf8") !== result)
        throw new Error("Skill packages are stale");
} else writeFileSync(output, result);
