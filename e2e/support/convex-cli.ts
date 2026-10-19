/// <reference types="node" />
import { spawnSync } from "node:child_process";

export const CONVEX_CLI_ERROR =
    "Local Convex CLI command failed. No command, arguments, or captured output are exposed.";

export type ConvexCliResult = {
    status: number | null;
    stdout: string | null;
    stderr: string | null;
    /** Present only when the process could not be spawned at all. */
    error?: Error;
};

export type ConvexCliExecutor = (
    args: ReadonlyArray<string>,
) => ConvexCliResult;

/** Non-throwing child-process executor: spawnSync never rethrows child
 *  errors, and stdio is fully piped so nothing child-produced reaches the
 *  outer console. */
export const defaultConvexCliExecutor: ConvexCliExecutor = (args) => {
    const result = spawnSync("pnpm", ["exec", "convex", ...args], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error,
    };
};

/** Runs a bounded Convex CLI command and returns its trimmed stdout.
 *  Every failure path throws the single constant {@link CONVEX_CLI_ERROR}
 *  with no command, argv, stdout, stderr, original error, cause, or secret
 *  attached. Nothing is logged. */
export function runConvexCli(
    args: ReadonlyArray<string>,
    executor: ConvexCliExecutor = defaultConvexCliExecutor,
): string {
    const result = executor(args);
    const output = result.stdout;
    if (
        result.status !== 0 ||
        output === null ||
        result.error !== undefined
    ) {
        throw new Error(CONVEX_CLI_ERROR);
    }
    return output.trim();
}

/** Runs a Convex CLI function and parses its output as JSON. Invalid JSON is
 *  sanitized exactly like any other child failure. */
export function runConvexJson<TResult>(
    functionName: string,
    args: Record<string, unknown>,
    executor: ConvexCliExecutor = defaultConvexCliExecutor,
): TResult {
    const output = runConvexCli(
        [
            "run",
            functionName,
            JSON.stringify(args),
            "--deployment",
            "local",
        ],
        executor,
    );
    try {
        return JSON.parse(output) as TResult;
    } catch {
        throw new Error(CONVEX_CLI_ERROR);
    }
}