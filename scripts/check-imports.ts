import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const IGNORE = new Set([
    "node_modules",
    "_generated",
    ".git",
    ".agents",
    "dist",
    "build",
]);

/**
 * Flags relative PARENT path segments inside import.meta.glob() or
 * dynamic import() string arguments. Matches `../`, `../../` etc. but
 * allows `./` (same dir) and aliased imports like `@convex/...`.
 */
const RELATIVE_PARENT = /(?:import\.meta\.glob|import\s*\()\s*['"]\.\.+/;

/**
 * Flags `import.meta.glob()` patterns whose first non-quote character is
 * neither `/` (project root) nor `.` (relative). Vite's glob plugin refuses
 * anything else, including aliases like `@convex/...`, because it expands
 * the filesystem pattern before alias resolution runs. Catching this lint-side
 * avoids the cryptic `Invalid glob ... It must start with '/' or './'` runtime
 * failure.
 *
 * Capture group 1 holds the offending prefix character.
 */
const INVALID_GLOB_PREFIX = /import\.meta\.glob\(\s*['"]([^'"/.][^'"]*)/;

/**
 * Matches a non-Route, non-type `export` in a route file. TanStack Router
 * requires route files to export ONLY `export const Route`. Any additional
 * export — default, named, re-export — breaks code-splitting and triggers
 * the console warning: "These exports … will not be code-split …".
 *
 * Allowed: `export const Route = …`, `export type …`, `export interface …`.
 * Flagged: `export default …`, `export const X = …`, `export function …`,
 * `export class …`, `export { … }`.
 */
const EXTRA_ROUTE_EXPORT = /^export\s+(?!const\s+Route\b|type\s|interface\s)/;

/** Only files whose relative path starts with this are checked. */
const ROUTES_DIR = "src/routes/";

/**
 * Matches a TypeScript static `import ... from '...'` or `export ... from '...'`
 * with an explicit `.js` extension on a relative path. Returns the captured
 * specifier or null.
 *
 * Excludes aliased imports (no `.`/`/` separator before the path) since those
 * are package-style and TypeScript's bundler resolution doesn't require
 * extensions there.
 */
const JS_EXTENSION_IN_TS =
    /(?:^|\s)(?:from|export\s+[^\n]*from)\s+['"](\.{1,2}\/[^'"]+\.js)(?:['"]|\?)/;

/**
 * Match relative passage of `.js` imports *without* an accompanying `.js`
 * file on disk. Catches the case where `.js` is mandatory (paired
 * runtime+declaration files).
 */
function jsExtensionNeedsJs(file: string, dir: string): boolean {
    // Resolve the .js path relative to the importing file's directory.
    const resolved = join(dir, file);
    return existsSync(resolved);
}

function* walk(dir: string): Generator<string> {
    let entries: Dirent[];
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (IGNORE.has(entry.name)) {
            continue;
        }
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            yield* walk(full);
        } else if (
            entry.isFile() &&
            (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
        ) {
            yield full;
        }
    }
}

let failed = false;

for (const file of walk(ROOT)) {
    if (!existsSync(file)) {
        continue;
    }
    const rel = relative(ROOT, file);
    const dir = dirname(file);
    const isRouteFile = rel.startsWith(ROUTES_DIR);
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined) {
            continue;
        }
        if (RELATIVE_PARENT.test(line)) {
            console.error(
                `${rel}:${i + 1} relative parent path in import.meta.glob/import() — use alias`,
            );
            failed = true;
        }
        const globMatch = line.match(INVALID_GLOB_PREFIX);
        if (globMatch?.[1] !== undefined) {
            console.error(
                `${rel}:${i + 1} import.meta.glob pattern must start with '/' or './' — Vite rejects ${JSON.stringify(globMatch[1])}`,
            );
            failed = true;
        }
        const jsMatch = line.match(JS_EXTENSION_IN_TS);
        const specifier = jsMatch?.[1];
        if (specifier !== undefined && !jsExtensionNeedsJs(specifier, dir)) {
            console.error(
                `${rel}:${i + 1} '.js' extension in TypeScript import with no matching '.js' file — drop it or rename source to '.ts'`,
            );
            failed = true;
        }
        if (isRouteFile && EXTRA_ROUTE_EXPORT.test(line)) {
            console.error(
                `${rel}:${i + 1} route files must only export 'Route'. Move this export to a separate file so TanStack Router can code-split it`,
            );
            failed = true;
        }
    }
}

process.exit(failed ? 1 : 0);
