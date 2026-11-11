import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PREVIEW_POLICY } from "../convex/resourcePolicy.ts";

/** Keep the standalone Docker service's checked-in subset identical to its authored policy. */
export function syncResourcePolicy(root: string, check = false) {
    const path = resolve(
        root,
        "services/playwright-browser/src/resource-policy.generated.json",
    );
    const expected = `${JSON.stringify(PREVIEW_POLICY, null, 4)}\n`;
    if (existsSync(path) && readFileSync(path, "utf8") === expected) return;
    if (check)
        throw new Error(
            "Generated preview resource policy is stale. Run pnpm resource-policy:sync.",
        );
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, expected);
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    if (process.argv.slice(2).some((arg) => arg !== "--check"))
        throw new Error("Usage: pnpm resource-policy:sync [--check]");
    syncResourcePolicy(
        fileURLToPath(new URL("../", import.meta.url)),
        process.argv.includes("--check"),
    );
}
