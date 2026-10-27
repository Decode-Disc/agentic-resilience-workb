import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const check = process.argv.includes("--check");
if (process.argv.slice(2).some((argument) => argument !== "--check")) {
    throw new Error("Usage: pnpm design:sync [--check]");
}
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

function object(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`Expected an object for ${label}`);
    }
    return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
    if (typeof value !== "string") {
        throw new Error(`Expected text for ${label}`);
    }
    return value;
}

function match(text: string, pattern: RegExp, label: string): string {
    const value = text.match(pattern)?.[1];
    if (value === undefined) throw new Error(`Cannot locate ${label}`);
    return value;
}

function declarations(css: string, selector: string): Record<string, string> {
    const start = css.indexOf(`${selector} {`);
    if (start === -1) throw new Error(`Cannot locate CSS block ${selector}`);
    const end = css.indexOf("\n}", start);
    if (end === -1) throw new Error(`Unclosed CSS block ${selector}`);
    const block = css.slice(start, end);
    return Object.fromEntries(
        [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((entry) => [
            entry[1],
            entry[2]?.replace(/\s+/g, " ").trim(),
        ]),
    ) as Record<string, string>;
}

const design = read("DESIGN.md");
const end = design.indexOf("\n---\n", 4);
if (!design.startsWith("---\n") || end === -1) {
    throw new Error("DESIGN.md needs JSON-compatible YAML frontmatter");
}
const tokens = object(JSON.parse(design.slice(4, end)), "design frontmatter");
const body = design.slice(end + 5);
const theme = read("src/assets/styles/themes/evidence-workbench.css");
const preset = read("src/assets/styles/base-preset.css");
const stylesheet = read("src/styles.css");
const modes = {
    light: {
        ...declarations(preset, ":root"),
        ...declarations(theme, ":root"),
    },
    dark: { ...declarations(preset, ".dark"), ...declarations(theme, ".dark") },
};
const themeAliases = declarations(theme, "@theme");
const localAliases = declarations(stylesheet, "@theme inline");

const colors = Object.fromEntries(
    Object.keys(object(tokens.colors, "colors")).map((key) => {
        const mode = key.startsWith("dark-") ? "dark" : "light";
        const property = `--${key.replace(/^dark-/, "")}`;
        const value = modes[mode][property];
        if (value === undefined) throw new Error(`Missing theme token ${key}`);
        return [key, value];
    }),
);
tokens.colors = colors;
for (const [role, value] of Object.entries(
    object(tokens.typography, "typography"),
)) {
    const entry = object(value, `typography.${role}`);
    const family = ["label", "chip", "meta"].includes(role)
        ? "mono"
        : /^(display|title)/.test(role)
          ? "heading"
          : "sans";
    entry.fontFamily = string(
        themeAliases[`--font-${family}`],
        `font-${family}`,
    );
    for (const [property, suffix] of [
        ["fontSize", ""],
        ["lineHeight", "--line-height"],
        ["fontWeight", "--font-weight"],
        ["letterSpacing", "--letter-spacing"],
    ] as const) {
        const value = themeAliases[`--text-${role}${suffix}`];
        if (value !== undefined)
            entry[property] = property === "fontWeight" ? Number(value) : value;
    }
}
const radius = Number(
    match(
        string(modes.light["--radius"], "radius"),
        /^([\d.]+)rem$/,
        "base radius in rem",
    ),
);
const rounded = object(tokens.rounded, "rounded");
for (const name of Object.keys(rounded)) {
    const expression =
        themeAliases[`--radius-${name}`] ?? localAliases[`--radius-${name}`];
    if (expression && /^[\d.]+(?:rem|px)$/.test(expression)) {
        rounded[name] = expression;
    } else if (expression === "var(--radius)") {
        rounded[name] = `${radius}rem`;
    } else {
        const operation = expression?.match(
            /^calc\(var\(--radius\) ([*-]) ([\d.]+)(rem)?\)$/,
        );
        if (!operation)
            throw new Error(`Unsupported radius expression for ${name}`);
        const amount = Number(operation[2]);
        const value = operation[1] === "*" ? radius * amount : radius - amount;
        rounded[name] = `${Number(value.toFixed(4))}rem`;
    }
}

const previewData: unknown = JSON.parse(
    match(
        body,
        /<!-- impeccable:previews -->\s*```json\n([\s\S]*?)\n```/,
        "component preview definitions",
    ),
);
if (!Array.isArray(previewData))
    throw new Error("Component previews must be an array");
const componentTokens = object(tokens.components, "component tokens");
const components = previewData.map((value: unknown) => {
    const entry = object(value, "component preview");
    for (const key of [
        "name",
        "kind",
        "refersTo",
        "description",
        "html",
        "css",
    ]) {
        string(entry[key], `preview.${key}`);
    }
    if (
        !Object.hasOwn(
            componentTokens,
            string(entry.refersTo, "preview reference"),
        )
    ) {
        throw new Error(`Unknown component reference ${entry.refersTo}`);
    }
    return entry;
});

function colorCoordinates(
    value: string,
    mode: Record<string, string>,
): [number, number, number] {
    const reference = value.match(/^var\((--[\w-]+)\)$/)?.[1];
    if (reference)
        return colorCoordinates(string(mode[reference], reference), mode);
    const direct = value.match(
        /^oklch\(([\d.]+)(%)? ([\d.]+) ([\d.]+)(?: \/ [^)]+)?\)$/,
    );
    if (direct)
        return [
            Number(direct[1]) / (direct[2] ? 100 : 1),
            Number(direct[3]),
            Number(direct[4]),
        ];
    const mix = value.match(
        /^color-mix\(in oklab, var\((--[\w-]+)\) ([\d.]+)%, (white|black)\)$/,
    );
    if (!mix) throw new Error(`Unsupported preview color ${value}`);
    const original = string(mode[string(mix[1], "mix token")], "mixed color");
    const [lightness, chroma, hue] = colorCoordinates(original, mode);
    const weight = Number(mix[2]) / 100;
    return [
        lightness * weight + (mix[3] === "white" ? 1 - weight : 0),
        chroma * weight,
        hue,
    ];
}

const displayNames = Object.fromEntries(
    [...body.matchAll(/\*\*([^*]+)\*\* \(`([^`]+)`\)/g)].map((entry) => [
        entry[2],
        entry[1],
    ]),
);
const colorMeta = Object.fromEntries(
    Object.entries(colors).map(([key, value]) => {
        const dark = key.startsWith("dark-");
        const name = key.replace(/^dark-/, "");
        const [, chroma, hue] = colorCoordinates(
            value,
            modes[dark ? "dark" : "light"],
        );
        const alpha = value.match(/ \/ ([^)]+)\)/)?.[1];
        return [
            key,
            {
                role: name.startsWith("primary")
                    ? "primary"
                    : /brand-green|approved|sidebar-accent/.test(name)
                      ? "tertiary"
                      : /brand-purple|ring|accent|evidence-|counter-evidence|review|destructive/.test(
                              name,
                          )
                        ? "secondary"
                        : "neutral",
                displayName: `${dark ? "Dark · " : ""}${displayNames[name] ?? name.replaceAll("-", " ")}`,
                tonalRamp: [0.15, 0.25, 0.35, 0.45, 0.6, 0.72, 0.84, 0.95].map(
                    (step) =>
                        `oklch(${step} ${Number(chroma.toFixed(6))} ${hue}${alpha ? ` / ${alpha}` : ""})`,
                ),
            },
        ];
    }),
);

const overview = match(
    body,
    /\*\*Creative North Star: "[^"]+"\*\*\s*([\s\S]*?)\n\*\*Key Characteristics:\*\*/,
    "overview",
).trim();
const bullets = (text: string) =>
    [...text.matchAll(/^- (.+)$/gm)].map((entry) => entry[1]);
const typePurposes = Object.fromEntries(
    [...body.matchAll(/- \*\*([\w-]+):\*\* (.+)/g)].map((entry) => [
        entry[1]?.toLowerCase(),
        entry[2]?.replaceAll("`", ""),
    ]),
);
const typographyMeta = Object.fromEntries(
    Object.keys(object(tokens.typography, "typography")).map((key) => [
        key,
        {
            displayName: key.replaceAll("-", " "),
            purpose: string(
                typePurposes[key.split("-")[0] ?? ""],
                `typography purpose for ${key}`,
            ),
        },
    ]),
);
const motionUtility = read("src/components/ui/motion-animate-presence.tsx");
const glass = read("src/components/ui/liquid-glass.tsx");
const tailwind = read("node_modules/tailwindcss/theme.css");
const sidecarPath = ".impeccable/design.json";
const timestamp = existsSync(resolve(root, sidecarPath))
    ? read(sidecarPath).match(/"generatedAt":\s*"([^"]+)"/)?.[1]
    : null;
const previousGeneratedAt =
    typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp))
        ? timestamp
        : null;
const sidecar = {
    schemaVersion: 2,
    generatedAt: previousGeneratedAt,
    title: match(body, /^# (.+)$/m, "design title"),
    extensions: {
        colorMeta,
        typographyMeta,
        shadows: Object.entries(modes).flatMap(([mode, values]) =>
            Object.keys(values)
                .filter((name) => name.startsWith("surface-shadow-"))
                .map((name) => ({
                    name: `${mode === "dark" ? "dark-" : ""}${name}`,
                    value: string(values[`--${name}`], name),
                    purpose: "Theme-owned surface depth.",
                })),
        ),
        motion: [
            {
                name: "organic-curve",
                value: `cubic-bezier(${match(glass, /ease:\s*\[([^\]]+)\]/, "glass easing")})`,
                purpose: "Existing glass transition curve.",
            },
            {
                name: "glass-transition",
                value: `${Number(match(glass, /transition=\{\{ duration: ([\d.]+)/, "glass timing")) * 1000}ms`,
                purpose: "Existing glass transition duration.",
            },
            {
                name: "motion-preset-curve",
                value: `cubic-bezier(${match(motionUtility, /const defaultEase: Easing = \[([^\]]+)\]/, "preset easing")})`,
                purpose: "Existing shared motion preset curve.",
            },
        ],
        breakpoints: ["sm", "md", "lg", "xl", "2xl"].map((name) => ({
            name,
            value: `${Number(match(tailwind, new RegExp(`--breakpoint-${name}: ([\\d.]+)rem;`), name)) * 16}px`,
        })),
    },
    components,
    narrative: {
        northStar: match(
            body,
            /\*\*Creative North Star: "([^"]+)"\*\*/,
            "north star",
        ),
        overview,
        keyCharacteristics: bullets(
            match(
                body,
                /\*\*Key Characteristics:\*\*\s*([\s\S]*?)\n\n/,
                "characteristics",
            ),
        ),
        rules: [...body.matchAll(/\*\*(The [^*]+ Rule)\.\*\* (.+)/g)].map(
            (entry) => {
                const section = body
                    .slice(0, entry.index)
                    .match(/## (Colors|Typography|Elevation & Depth)\n/g)
                    ?.at(-1);
                return {
                    name: entry[1],
                    body: entry[2],
                    section: section?.includes("Typography")
                        ? "typography"
                        : section?.includes("Elevation")
                          ? "elevation"
                          : "colors",
                };
            },
        ),
        dos: bullets(
            match(body, /### Do:\s*([\s\S]*?)\n### Don't:/, "do list"),
        ),
        donts: bullets(match(body, /### Don't:\s*([\s\S]*)$/, "do not list")),
    },
};

const outputs = [
    ["DESIGN.md", `---\n${JSON.stringify(tokens, null, 2)}\n---\n${body}`],
    [sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`],
] as const;
let stale = false;
for (const [path, content] of outputs) {
    const destination = resolve(root, path);
    // Impeccable compares file mtimes. Refresh them on sync, but keep check
    // content-based so checkout order cannot create a false CI failure.
    const refreshSidecar =
        path === sidecarPath &&
        (previousGeneratedAt === null ||
            (!check &&
                statSync(resolve(root, "DESIGN.md")).mtimeMs >
                    statSync(destination).mtimeMs));
    if (
        !refreshSidecar &&
        existsSync(destination) &&
        readFileSync(destination, "utf8") === content
    )
        continue;
    stale = true;
    if (check) console.error(`Out of date: ${path}. Run pnpm design:sync.`);
    else {
        const output =
            path === sidecarPath
                ? `${JSON.stringify({ ...sidecar, generatedAt: new Date().toISOString() }, null, 2)}\n`
                : content;
        writeFileSync(destination, output);
    }
}
if (check && stale) process.exitCode = 1;
else
    console.log(
        check
            ? "Design documentation is up to date."
            : "Design documentation synchronized.",
    );
