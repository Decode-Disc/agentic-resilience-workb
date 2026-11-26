import { globSync } from "node:fs";
import { join } from "node:path";

export const E2E_TEST_MATCH = [
    "e2e/**/*.spec.ts",
    "src/__tests__/e2e/**/*.spec.ts",
] as const;
export const E2E_TEST_IGNORE = ["archive/**"] as const;
/** Playwright ORs positional filters, so an empty shard needs a filter that matches nothing. */
const NO_SPEC_PATTERN = "(?!)";
/** Options whose next argument is a value, not a positional spec filter. */
const VALUE_OPTIONS = new Set(["--config", "--project"]);

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** POSIX-relative spec paths, sorted so shard membership does not depend on directory order. */
export function discoverE2eSpecFiles(root: string): string[] {
    const files = new Set<string>();
    for (const pattern of E2E_TEST_MATCH) {
        for (const match of globSync(pattern, {
            cwd: root,
            exclude: [...E2E_TEST_IGNORE],
        })) {
            files.add(match.replaceAll("\\", "/"));
        }
    }
    return [...files].sort();
}

/**
 * Playwright treats positional spec arguments as regular expressions matched
 * against absolute file paths. Each pattern is anchored to one absolute path
 * so a filename present in both spec trees cannot select two files.
 */
export function selectE2eShardPatterns(
    root: string,
    shard: number,
    total: number,
): string[] {
    if (
        !Number.isInteger(shard) ||
        !Number.isInteger(total) ||
        total < 1 ||
        shard < 1 ||
        shard > total
    )
        throw new Error(`Invalid round-robin shard "${shard}/${total}".`);
    return discoverE2eSpecFiles(root)
        .filter((_file, index) => index % total === shard - 1)
        .map(
            (relativePath) =>
                `^${escapeRegExp(join(root, relativePath).replaceAll("\\", "/"))}$`,
        );
}

function parseShardPair(value: string): [number, number] {
    const match = /^(\d+)\/(\d+)$/.exec(value);
    if (!match) throw new Error(`Invalid round-robin shard "${value}".`);
    return [Number(match[1]), Number(match[2])];
}

/** Replaces the shard flag with explicit spec patterns before Playwright is invoked. */
export function expandRoundRobinShardArgs(
    root: string,
    args: string[],
): string[] {
    let shard: number | undefined;
    let total: number | undefined;
    let expectingValue = false;
    const rest: string[] = [];
    const positional: string[] = [];
    for (let index = 0; index < args.length; index++) {
        const argument = args[index] ?? "";
        if (expectingValue) {
            rest.push(argument);
            expectingValue = false;
        } else if (argument === "--round-robin-shard") {
            const value = args[index + 1];
            if (value === undefined)
                throw new Error("Missing round-robin shard selection.");
            [shard, total] = parseShardPair(value);
            index++;
        } else if (argument.startsWith("--round-robin-shard=")) {
            [shard, total] = parseShardPair(
                argument.slice("--round-robin-shard=".length),
            );
        } else {
            if (VALUE_OPTIONS.has(argument)) expectingValue = true;
            if (!argument.startsWith("-")) positional.push(argument);
            rest.push(argument);
        }
    }
    if (shard === undefined || total === undefined) return args;
    if (positional.length)
        throw new Error(
            "Round-robin sharding cannot be combined with positional Playwright file filters.",
        );
    const patterns = selectE2eShardPatterns(root, shard, total);
    return [
        "--pass-with-no-tests",
        ...(patterns.length ? patterns : [NO_SPEC_PATTERN]),
        ...rest,
    ];
}
