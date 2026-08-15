import { execFileSync } from "node:child_process";

export function runConvexCli(args: ReadonlyArray<string>): string {
    return execFileSync("pnpm", ["exec", "convex", ...args], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

export function runConvexJson<TResult>(
    functionName: string,
    args: Record<string, unknown>,
): TResult {
    const output = runConvexCli([
        "run",
        functionName,
        JSON.stringify(args),
        "--deployment",
        "local",
    ]);
    return JSON.parse(output) as TResult;
}