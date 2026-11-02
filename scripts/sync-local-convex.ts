import { execFile, spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import type { internal } from "@convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import {
    type FunctionArgs,
    type FunctionReturnType,
    makeFunctionReference,
} from "convex/server";

// Codegen and backend typechecking share this publisher process budget.
const PUBLICATION_TIMEOUT_MS = 10 * 60_000;
const GUARD_TIMEOUT_MS = 5_000;
// The lock-owning parent also covers identity, guard RPCs and child startup.
const COMMAND_TIMEOUT_MS = PUBLICATION_TIMEOUT_MS + 6 * GUARD_TIMEOUT_MS;

class LocalSyncError extends Error {}

async function main(): Promise<number> {
    const { values } = parseArgs({
        options: {
            url: { type: "string" },
            hold: { type: "boolean" },
            release: { type: "boolean" },
            recover: { type: "boolean" },
            "lock-held": { type: "boolean" },
        },
    });
    if (
        [values.hold, values.release, values.recover].filter(Boolean).length > 1
    )
        throw new LocalSyncError(
            "Choose one of --hold, --release or --recover.",
        );
    if (!values.url)
        throw new LocalSyncError(
            "Usage: pnpm convex:sync --url http://127.0.0.1:<port> [--hold | --release | --recover]",
        );
    const target = new URL(values.url);
    if (
        target.protocol !== "http:" ||
        target.hostname !== "127.0.0.1" ||
        target.username ||
        target.password ||
        target.pathname !== "/" ||
        target.search ||
        target.hash
    ) {
        throw new LocalSyncError(
            "Synchronization requires an explicit numeric loopback HTTP origin.",
        );
    }

    let config: Record<string, unknown>;
    let selector: string | undefined;
    try {
        config = JSON.parse(
            readFileSync(".convex/local/default/config.json", "utf8"),
        );
        const env = parseEnv(readFileSync(".env.local", "utf8"));
        if (
            process.env.CONVEX_DEPLOYMENT &&
            process.env.CONVEX_DEPLOYMENT !== env.CONVEX_DEPLOYMENT
        ) {
            throw new LocalSyncError("Conflicting deployment selectors");
        }
        selector = env.CONVEX_DEPLOYMENT;
    } catch {
        throw new LocalSyncError(
            "Local deployment configuration is missing, invalid, or conflicts with the environment.",
        );
    }
    if (
        !config ||
        typeof config !== "object" ||
        !selector ||
        !/^(local|anonymous):[\w-]+$/.test(selector) ||
        config.deploymentName !== selector.slice(selector.indexOf(":") + 1) ||
        typeof config.adminKey !== "string" ||
        !config.adminKey ||
        /[\r\n]/.test(config.adminKey) ||
        !config.ports ||
        typeof config.ports !== "object" ||
        !("cloud" in config.ports) ||
        !Number.isInteger(config.ports.cloud) ||
        Number(target.port || 80) !== config.ports.cloud
    ) {
        throw new LocalSyncError(
            "The requested origin must match the project's configured local deployment.",
        );
    }
    const cli = resolve("node_modules/convex/bin/main.js");
    if (!existsSync(cli))
        throw new LocalSyncError("The installed Convex CLI is missing.");
    const lockDirectory = resolve(".local-runtime");
    mkdirSync(lockDirectory, { recursive: true, mode: 0o700 });
    const lock = join(lockDirectory, "pi-publication.lock");
    if (!values["lock-held"]) {
        return new Promise<number>((done) => {
            let cancelled = false;
            const child = execFile(
                "flock",
                [
                    "--nonblock",
                    "--no-fork",
                    lock,
                    process.execPath,
                    "--experimental-strip-types",
                    fileURLToPath(import.meta.url),
                    ...process.argv.slice(2),
                    "--lock-held",
                ],
                {
                    timeout: COMMAND_TIMEOUT_MS,
                    maxBuffer: 4 * 1024 * 1024,
                },
                (error, stdout, stderr) => {
                    process.removeListener("SIGINT", cancel);
                    process.removeListener("SIGTERM", cancel);
                    process.stdout.write(
                        stdout.replaceAll(
                            String(config.adminKey),
                            "[redacted]",
                        ),
                    );
                    process.stderr.write(
                        stderr.replaceAll(
                            String(config.adminKey),
                            "[redacted]",
                        ),
                    );
                    if (error && !stdout && !stderr)
                        console.error(
                            "Another local publication command is active, or its lock is unavailable.",
                        );
                    done(
                        cancelled
                            ? 130
                            : error
                              ? typeof error.code === "number"
                                  ? error.code
                                  : 1
                              : 0,
                    );
                },
            );
            const cancel = () => {
                cancelled = true;
                child.kill("SIGTERM");
            };
            process.once("SIGINT", cancel);
            process.once("SIGTERM", cancel);
        });
    }
    if (spawnSync("flock", ["--nonblock", lock, "true"]).status !== 1)
        throw new LocalSyncError("The local publication lock must be held.");
    console.log(`target: local (${config.deploymentName}, ${target.origin})`);
    let instance: string;
    try {
        const response = await fetch(`${target.origin}/instance_name`, {
            redirect: "error",
            signal: AbortSignal.timeout(GUARD_TIMEOUT_MS),
        });
        if (!response.ok) throw new LocalSyncError("Unavailable instance");
        instance = await response.text();
    } catch {
        throw new LocalSyncError(
            "The local backend is unavailable. Keep or start its development watcher before synchronizing.",
        );
    }
    if (instance !== config.deploymentName)
        throw new LocalSyncError(
            "The running backend does not match the project's local deployment.",
        );

    const client = new ConvexHttpClient(target.origin, {
        logger: false,
        fetch: (input, init) =>
            fetch(input, {
                ...init,
                redirect: "error",
                signal: AbortSignal.timeout(GUARD_TIMEOUT_MS),
            }),
    });
    (
        client as ConvexHttpClient & { setAdminAuth(key: string): void }
    ).setAdminAuth(config.adminKey);
    const status = makeFunctionReference<
        "query",
        Record<string, never>,
        FunctionReturnType<
            typeof internal.execution.piControl.publicationStatus
        >
    >("execution/piControl:publicationStatus");
    const hold = makeFunctionReference<
        "mutation",
        FunctionArgs<typeof internal.execution.piControl.holdPublication>,
        FunctionReturnType<typeof internal.execution.piControl.holdPublication>
    >("execution/piControl:holdPublication");
    let prior: FunctionReturnType<
        typeof internal.execution.piControl.publicationStatus
    >;
    try {
        prior = await client.query(status, {});
    } catch {
        throw new LocalSyncError(
            "The publication guard is unavailable. Initialize it only on a verified quiet backend; publication was refused.",
        );
    }
    if (values.recover) {
        await client.mutation(
            makeFunctionReference<"mutation", Record<string, never>, null>(
                "execution/piControl:recoverPublicationWorkers",
            ),
            {},
        );
        console.log(
            "Expired admitted workers fenced; publication admission remains held.",
        );
        return 0;
    }
    if (values.release) {
        if (prior.hasActiveWorkers)
            throw new LocalSyncError(
                "Workers are still draining; admission remains held.",
            );
        await client.mutation(hold, { held: false });
        console.log("Pi worker admission released.");
        return 0;
    }
    await client.mutation(hold, { held: true });
    const quiet = await client.query(status, {});
    if (!quiet.held || quiet.hasActiveWorkers)
        throw new LocalSyncError(
            "Workers are still draining; publication was refused and admission remains held. Retry after they close.",
        );
    if (values.hold) {
        console.log(
            "Pi worker admission held; no active writer or live lease remains. Automatic watcher publications are safe while this hold remains set.",
        );
        return 0;
    }

    // An explicit credential file selects the existing server without invoking
    // the dev command's backend lifecycle or rewriting the project's env files.
    const secret = config.adminKey;
    const directory = mkdtempSync(join(tmpdir(), "convex-local-sync-"));
    try {
        const credentials = join(directory, "deployment.env");
        writeFileSync(
            credentials,
            `CONVEX_SELF_HOSTED_URL=${target.origin}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${JSON.stringify(secret)}\n`,
            { mode: 0o600 },
        );
        const env: NodeJS.ProcessEnv = {
            ...process.env,
            CONVEX_TMPDIR: tmpdir(),
        };
        for (const key of [
            "CONVEX_DEPLOY_KEY",
            "CONVEX_DEPLOYMENT",
            "CONVEX_SELF_HOSTED_URL",
            "CONVEX_SELF_HOSTED_ADMIN_KEY",
        ])
            delete env[key];
        const result = await new Promise<number>((done) => {
            let cancelled = false;
            const child = execFile(
                process.execPath,
                [cli, "deploy", "--env-file", credentials],
                {
                    env,
                    timeout: PUBLICATION_TIMEOUT_MS,
                    maxBuffer: 4 * 1024 * 1024,
                    encoding: "utf8",
                },
                (error, stdout, stderr) => {
                    process.removeListener("SIGINT", cancel);
                    process.removeListener("SIGTERM", cancel);
                    process.stdout.write(
                        stdout.replaceAll(secret, "[redacted]"),
                    );
                    process.stderr.write(
                        stderr.replaceAll(secret, "[redacted]"),
                    );
                    if (error)
                        console.error(
                            !cancelled && error.killed && !error.code
                                ? "Local publication timed out; no backend restart was attempted."
                                : "Local synchronization failed; no backend restart was attempted.",
                        );
                    done(
                        cancelled
                            ? 130
                            : error
                              ? typeof error.code === "number"
                                  ? error.code
                                  : 1
                              : 0,
                    );
                },
            );
            const cancel = () => {
                cancelled = true;
                child.kill("SIGTERM");
            };
            process.once("SIGINT", cancel);
            process.once("SIGTERM", cancel);
        });
        if (result === 0 && !prior.held)
            await client.mutation(hold, { held: false });
        if (result !== 0 || prior.held)
            console.log(
                "Pi worker admission remains held; inspect or retry, then use --release.",
            );
        return result;
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

try {
    process.exitCode = await main();
} catch (error) {
    console.error(
        error instanceof LocalSyncError
            ? error.message
            : "Local synchronization failed: invalid arguments or configuration.",
    );
    process.exitCode = 1;
}
