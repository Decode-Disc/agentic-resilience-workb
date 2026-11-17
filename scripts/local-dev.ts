import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { LOCAL_RUNTIME_POLICY } from "../convex/resourcePolicy.ts";
import { LocalProcessError } from "./local-processes.ts";
import {
    assertRuntimeStartupLock,
    formatLocalRuntimeStatus,
    getLocalRuntimeIdentity,
    getLocalRuntimePorts,
    getRuntimeStartupLockPath,
    inspectLocalRuntime,
    inspectLocalRuntimeStartup,
    LocalRuntimeError,
    type LocalRuntimePorts,
    type LocalRuntimeRole,
    publishRuntimeOrigin,
    publishRuntimeProcess,
    readNativeLocalDeployment,
    releaseRuntimeStartupLock,
    resolveLocalRuntime,
    stopLocalRuntime,
    stopLocalRuntimeInvocation,
    stopLocalRuntimeListener,
} from "./local-runtime.ts";
import { syncResourcePolicy } from "./sync-resource-policy.ts";

class LocalDevError extends Error {
    override name = "LocalDevError";
}

type ChildStatus = { code: number; signal: NodeJS.Signals | null };
type Child = ReturnType<typeof spawn>;

const STARTUP_TIMEOUT_MS = positiveInteger(
    process.env.LOCAL_RUNTIME_STARTUP_TIMEOUT_MS,
    LOCAL_RUNTIME_POLICY.maxStartupTimeoutMs,
);

async function main(): Promise<number> {
    const args = process.argv.slice(2);
    if (args[0] === "--startup-lock-held") {
        const mode = args[1];
        if (!mode)
            throw new LocalDevError(
                "The locked local runtime command is missing.",
            );
        assertRuntimeStartupLock(process.cwd());
        return runLockedMode(process.cwd(), mode, args.slice(2));
    }

    const mode = args[0];
    const forwardedArgs = args.slice(1);
    const root = process.cwd();
    if (mode === "dev:status") {
        const status = inspectLocalRuntime(root);
        if (forwardedArgs.includes("--json"))
            console.log(JSON.stringify(status, null, 2));
        else console.log(formatLocalRuntimeStatus(status));
        return 0;
    }
    if (!mode)
        throw new LocalDevError(
            "Choose dev, dev:web, convex:dev, dev:browser, dev:all, or test:e2e.",
        );
    if (
        [
            "dev",
            "convex:dev",
            "test:e2e",
            "dev:stop",
            "dev:restart",
            "dev:web",
            "dev:browser",
        ].includes(mode)
    )
        return runWithStartupLock(root, mode, forwardedArgs);
    if (mode === "dev:all")
        return runCommand(
            "pnpm",
            [
                "exec",
                "concurrently",
                "-k",
                "-n",
                "web,browser",
                "pnpm dev",
                "pnpm dev:browser",
            ],
            root,
        );
    throw new LocalDevError("Unknown local runtime command.");
}

async function runWithStartupLock(
    root: string,
    mode: string,
    args: string[],
): Promise<number> {
    const identity = getLocalRuntimeIdentity(root);
    const child = spawn(
        "flock",
        [
            "--no-fork",
            getRuntimeStartupLockPath(root),
            process.execPath,
            "--experimental-strip-types",
            fileURLToPath(import.meta.url),
            "--startup-lock-held",
            mode,
            ...args,
        ],
        {
            cwd: identity.root,
            env: { ...process.env, LOCAL_RUNTIME_ROOT: identity.root },
            // Forward Ctrl+C once instead of delivering it to every child in the terminal's process group.
            detached: true,
            stdio: "inherit",
        },
    );
    return runUntilExit(child, async () => {});
}

async function runLockedMode(
    root: string,
    mode: string,
    args: string[],
): Promise<number> {
    if (mode === "dev:web") return runWeb(root, args);
    if (mode === "dev:browser") return runPreview(root, args);
    if (mode === "dev:restart") {
        await stopLocalRuntime(root, ["web", "convex"]);
        return runNativeWatcher(root, true, false, args);
    }
    if (mode === "dev:stop") {
        const seen = new Set<string>();
        let jsonOutput = false;
        for (let index = 0; index < args.length; index++) {
            const argument = args[index] ?? "";
            if (argument === "--json") {
                if (jsonOutput)
                    throw new LocalDevError(
                        "Unknown stop option or repeated selection: --json",
                    );
                jsonOutput = true;
                continue;
            }
            const name = argument.split("=")[0] ?? "";
            if (!["--port", "--pid"].includes(name) || seen.has(name))
                throw new LocalDevError(
                    `Unknown stop option or repeated selection: ${name}`,
                );
            seen.add(name);
            if (!argument.includes("=")) index++;
        }
        const port = portArgument(args, "--port");
        const pid = pidArgument(args);
        if (port !== undefined || pid !== undefined) {
            if (port === undefined || pid === undefined)
                throw new LocalDevError(
                    "Select both --port and --pid to stop an unmanaged listener.",
                );
            const selected = inspectLocalRuntime(root).ports.find(
                (entry) => entry.port === port,
            );
            if (!selected)
                throw new LocalDevError(
                    "The selected port is not assigned to this worktree.",
                );
            await stopLocalRuntimeListener(root, selected, pid);
            const status = inspectLocalRuntime(root);
            if (jsonOutput) {
                console.log(
                    JSON.stringify(
                        {
                            action: "stopped-listener",
                            port,
                            pid,
                            ...status,
                        },
                        null,
                        2,
                    ),
                );
            } else {
                console.log(
                    `Stopped the selected owner of port ${port} (PID ${pid}). Port reservations are preserved.\n`,
                );
                console.log(formatLocalRuntimeStatus(status));
            }
            return 0;
        }
        await stopLocalRuntime(root);
        const status = inspectLocalRuntime(root);
        if (jsonOutput) {
            console.log(
                JSON.stringify({ action: "stopped", ...status }, null, 2),
            );
        } else {
            console.log(
                "Verified runtime processes have stopped. Unmanaged listeners and port reservations are preserved.\n",
            );
            console.log(formatLocalRuntimeStatus(status));
        }
        return 0;
    }
    if (mode === "dev" || mode === "convex:dev" || mode === "test:e2e")
        return runNativeWatcher(
            root,
            mode !== "convex:dev",
            mode === "test:e2e",
            args,
        );
    throw new LocalDevError("Unknown locked local runtime command.");
}

async function runNativeWatcher(
    root: string,
    startWeb: boolean,
    runE2e: boolean,
    args: string[],
): Promise<number> {
    const deploymentName = selectedLocalDeployment(root);
    const ports = getLocalRuntimePorts(root);
    for (const [flag, fixed] of [
        ["--local-cloud-port", ports.convex],
        ["--local-site-port", ports.site],
    ] as const) {
        const requested = portArgument(args, flag);
        if (requested !== undefined && requested !== fixed)
            throw new LocalDevError(
                `${flag} conflicts with this worktree's fixed port ${fixed}.`,
            );
    }
    const cli = resolve(root, "node_modules/convex/bin/main.js");
    if (!existsSync(cli))
        throw new LocalDevError("The installed Convex CLI is missing.");

    const nativeArgs = runE2e ? [] : args;
    const explicitBackendVersion = nativeArgs.some(
        (argument) =>
            argument === "--local-backend-version" ||
            argument.startsWith("--local-backend-version="),
    );
    let backendVersionArgs: string[] = [];
    if (
        !explicitBackendVersion &&
        existsSync(join(root, ".convex/local/default/config.json"))
    ) {
        const { backendVersion } = readNativeLocalDeployment(root);
        if (!backendVersion)
            throw new LocalDevError(
                "The existing local deployment has no configured backend version. Refusing an automatic backend upgrade.",
            );
        backendVersionArgs = ["--local-backend-version", backendVersion];
    }

    const startup = await prepareStartup(
        root,
        startWeb ? ["convex", "site", "web"] : ["convex", "site"],
    );
    if (
        startup.ready.has("convex") &&
        startup.status.processes.some(
            (owner) => owner.role === "convex" && owner.verified,
        )
    ) {
        if (!runE2e && args.length)
            throw new LocalDevError(
                "The native watcher is already running. Use dev:restart to apply different Convex arguments.",
            );
        if (
            !runE2e &&
            (await existingRuntimeChoice(
                `http://127.0.0.1:${startWeb && startup.ready.has("web") ? ports.web : ports.convex}`,
            )) === "restart"
        ) {
            await stopLocalRuntime(
                root,
                startWeb ? ["web", "convex"] : ["convex"],
            );
            return runNativeWatcher(root, startWeb, runE2e, args);
        }
        if (startWeb && !startup.ready.has("web"))
            return runWeb(
                root,
                [],
                runE2e ? () => runE2eTests(root, args) : undefined,
            );
        releaseRuntimeStartupLock();
        if (runE2e) return runE2eTests(root, args);
        console.log(
            `Reusing this worktree's runtime at http://127.0.0.1:${startWeb ? ports.web : ports.convex}`,
        );
        return 0;
    }

    const runId = randomUUID();
    const queueWaitMs = process.env.ISOLATE_QUEUE_IDLE_TIMEOUT_MS ?? "10000";
    const child = spawn(
        process.execPath,
        [
            cli,
            "dev",
            ...backendVersionArgs,
            "--local-cloud-port",
            String(ports.convex),
            "--local-site-port",
            String(ports.site),
            ...(startWeb && !startup.ready.has("web")
                ? ["--start", "pnpm exec vite dev"]
                : []),
            ...nativeArgs,
        ],
        {
            cwd: root,
            env: {
                ...nativeEnvironment(root, runId),
                DATABASE_UDF_USER_TIMEOUT_SECONDS:
                    process.env.DATABASE_UDF_USER_TIMEOUT_SECONDS ?? "10",
                ISOLATE_QUEUE_IDLE_TIMEOUT_MS: queueWaitMs,
                ISOLATE_QUEUE_CONGESTED_TIMEOUT_MS:
                    process.env.ISOLATE_QUEUE_CONGESTED_TIMEOUT_MS ??
                    queueWaitMs,
            },
            stdio: "inherit",
        },
    );
    const exit = trackExit(child);
    // The native CLI's SIGINT handler shuts down the backend it started.
    let stopping = false;
    const removeSignals = forwardSignals(
        child,
        () => {
            stopping = true;
        },
        "SIGINT",
    );
    try {
        await waitForBackend(root, deploymentName, child, runId, exit);
        if (startWeb)
            await waitForOrigin(root, "web", child, exit, STARTUP_TIMEOUT_MS);
        releaseRuntimeStartupLock();
        if (!runE2e) return (await exit).code;
        return await runE2eTests(root, args);
    } catch (error) {
        await stopChild(child, "SIGINT");
        if (stopping) return (await exit).code;
        throw error;
    } finally {
        removeSignals();
        if (runE2e) await stopChild(child, "SIGINT");
        await exit;
        await stopLocalRuntimeInvocation(root, runId);
    }
}

async function runE2eTests(root: string, args: string[]): Promise<number> {
    const runtime = await resolveLocalRuntime(root, {
        requiredOrigins: ["convex", "web"],
    });
    return runCommand("pnpm", ["exec", "playwright", "test", ...args], root, {
        ...process.env,
        PLAYWRIGHT_BASE_URL: runtime.origins.web,
        LOCAL_RUNTIME_CONVEX_ORIGIN: runtime.origins.convex,
        LOCAL_RUNTIME_WORKTREE_ID: runtime.identity.worktreeId,
    });
}

async function prepareStartup(
    root: string,
    roles: readonly (keyof LocalRuntimePorts)[],
) {
    for (;;) {
        const startup = await inspectLocalRuntimeStartup(root, roles);
        const conflict = startup.conflicts[0];
        if (!conflict) return startup;
        const owners = conflict.listeners.flatMap(
            (listener) => listener.processes,
        );
        const detail = owners.length
            ? owners
                  .map(
                      (owner) =>
                          `${owner.command}, PID ${owner.pid}, ${owner.cwd ?? "directory unavailable"}`,
                  )
                  .join("; ")
            : "owner unavailable";
        const diagnostic = `${conflict.role} port ${conflict.port}: address already in use (${detail}).`;
        if (!process.stdin.isTTY || !process.stdout.isTTY || !owners.length)
            throw new LocalDevError(
                `${diagnostic} Inspect pnpm dev:status; use pnpm dev:stop --port ${conflict.port} --pid <PID> to stop an explicitly selected process.`,
            );
        console.log(diagnostic);
        const choice = await terminalChoice(
            "Stop the listed process tree(s) and retry? [s]top / [c]ancel [c]: ",
            "c",
        );
        if (choice !== "s") throw new LocalDevError("Startup cancelled.");
        await stopLocalRuntimeListener(root, conflict);
    }
}

async function terminalChoice(
    question: string,
    fallback: string,
): Promise<string> {
    const terminal = createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    try {
        return (
            (await terminal.question(question)).trim().toLowerCase() || fallback
        );
    } catch (error) {
        if (
            error instanceof Error &&
            (error.name === "AbortError" ||
                ("code" in error && error.code === "ERR_USE_AFTER_CLOSE"))
        )
            throw new LocalDevError("Startup cancelled.");
        throw new LocalDevError(
            "Could not read the terminal selection. Startup stopped.",
        );
    } finally {
        terminal.close();
    }
}

async function existingRuntimeChoice(
    origin: string,
): Promise<"reuse" | "restart"> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return "reuse";
    const choice = await terminalChoice(
        `This worktree already has a healthy service at ${origin}. [r]euse / [s]restart / [c]ancel [r]: `,
        "r",
    );
    if (choice === "s") return "restart";
    if (choice === "r") return "reuse";
    throw new LocalDevError("Startup cancelled.");
}

async function waitForBackend(
    root: string,
    deploymentName: string,
    child: Child,
    runId: string,
    exit: Promise<ChildStatus>,
): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    let processPublished = false;
    while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) {
            const status = await exit;
            throw new ChildEndedError(
                status,
                "The native Convex watcher exited before readiness.",
            );
        }
        if (existsSync(join(root, ".convex/local/default/config.json"))) {
            const deployment = readNativeLocalDeployment(root);
            if (deployment.deploymentName !== deploymentName)
                throw new LocalDevError(
                    "The native Convex watcher selected another local deployment.",
                );
            try {
                await resolveLocalRuntime(root, {
                    requiredOrigins: ["convex"],
                });
                if (!processPublished) {
                    if (!child.pid)
                        throw new LocalDevError(
                            "The native Convex watcher did not expose its process identity.",
                        );
                    await publishRuntimeProcess(root, {
                        role: "convex",
                        pid: child.pid,
                        runId,
                    });
                    processPublished = true;
                }
                return;
            } catch (error) {
                if (
                    error instanceof Error &&
                    error.message ===
                        "The configured local Convex backend is unavailable."
                ) {
                    await delay(LOCAL_RUNTIME_POLICY.backendReadinessPollMs);
                    continue;
                }
                throw error;
            }
        }
        await delay(LOCAL_RUNTIME_POLICY.backendReadinessPollMs);
    }
    throw new LocalDevError(
        "The native local Convex backend did not become ready before the startup timeout.",
    );
}

async function runWeb(
    root: string,
    args: string[],
    onReady?: () => Promise<number>,
): Promise<number> {
    const port = portArgument(args, "--port");
    const ports = getLocalRuntimePorts(
        root,
        port === undefined ? {} : { web: port },
    );
    const startup = await prepareStartup(root, ["web"]);
    await resolveLocalRuntime(root, { requiredOrigins: ["convex"] });
    if (startup.ready.has("web")) {
        if (
            !onReady &&
            (await existingRuntimeChoice(`http://127.0.0.1:${ports.web}`)) ===
                "restart"
        ) {
            await stopLocalRuntime(root, ["web"]);
            return runWeb(root, args);
        }
        releaseRuntimeStartupLock();
        if (onReady) return onReady();
        console.log(
            `Reusing this worktree's web service at http://127.0.0.1:${ports.web}`,
        );
        return 0;
    }
    return runTrackedService(
        root,
        "web",
        "pnpm",
        ["exec", "vite", "dev", ...args],
        root,
        STARTUP_TIMEOUT_MS,
        onReady,
    );
}

async function runPreview(root: string, args: string[]): Promise<number> {
    const serviceRoot = join(root, "services/playwright-browser");
    const explicitPort = configuredPreviewPort(process.env.PORT, serviceRoot);
    const ports = getLocalRuntimePorts(
        root,
        explicitPort === undefined ? {} : { preview: explicitPort },
    );
    const startup = await prepareStartup(root, ["preview"]);
    if (startup.ready.has("preview")) {
        if (
            (await existingRuntimeChoice(
                `http://127.0.0.1:${ports.preview}`,
            )) === "restart"
        ) {
            await stopLocalRuntime(root, ["preview"]);
            return runPreview(root, args);
        }
        releaseRuntimeStartupLock();
        console.log(
            `Reusing this worktree's preview service at http://127.0.0.1:${ports.preview}`,
        );
        return 0;
    }
    syncResourcePolicy(root, true);
    const build = await runCommand("npm", ["run", "build"], serviceRoot);
    if (build !== 0) return build;

    const runId = randomUUID();
    try {
        return await runPreviewService(
            root,
            serviceRoot,
            ports.preview,
            runId,
            args,
        );
    } finally {
        await stopLocalRuntimeInvocation(root, runId);
    }
}

async function runPreviewService(
    root: string,
    serviceRoot: string,
    port: number,
    runId: string,
    args: string[],
): Promise<number> {
    const child = spawn(
        "npm",
        ["run", "dev", ...(args.length > 0 ? ["--", ...args] : [])],
        {
            cwd: serviceRoot,
            env: {
                ...process.env,
                PORT: String(port),
                PREVIEW_SERVICE_HOST: "127.0.0.1",
                LOCAL_RUNTIME_ROOT: root,
                LOCAL_RUNTIME_RUN_ID: runId,
            },
            stdio: ["inherit", "inherit", "pipe"],
        },
    );
    let pending = "";
    const exit = trackExit(child);
    let stopping = false;
    const removeSignals = forwardSignals(child, () => {
        stopping = true;
    });
    let resolveReady!: (value: string) => void;
    let rejectReady!: (reason: Error) => void;
    const ready = new Promise<string>(
        (resolveReadyPromise, rejectReadyPromise) => {
            resolveReady = resolveReadyPromise;
            rejectReady = rejectReadyPromise;
        },
    );
    child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        process.stderr.write(text);
        pending += text;
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
            let entry: { event?: unknown; origin?: unknown; port?: unknown };
            try {
                entry = JSON.parse(line) as typeof entry;
            } catch {
                continue;
            }
            if (
                entry.event !== "server_started" ||
                typeof entry.origin !== "string" ||
                typeof entry.port !== "number"
            )
                continue;
            const listenerOrigin = entry.origin;
            if (hasNativeRuntimeConfig(root)) {
                void publishRuntimeOrigin(
                    root,
                    "preview",
                    listenerOrigin,
                    child.pid ?? -1,
                    runId,
                )
                    .then(() => resolveReady(listenerOrigin))
                    .catch(rejectReady);
            } else {
                resolveReady(listenerOrigin);
            }
        }
    });

    let timeout: NodeJS.Timeout | undefined;
    try {
        const boundOrigin = await Promise.race([
            ready,
            exit.then((status) => {
                throw new ChildEndedError(
                    status,
                    "The local preview service exited before readiness.",
                );
            }),
            new Promise<string>((_resolve, reject) => {
                timeout = setTimeout(
                    () =>
                        reject(
                            new LocalDevError(
                                "The local preview service did not become ready before the startup timeout.",
                            ),
                        ),
                    STARTUP_TIMEOUT_MS,
                );
            }),
        ]);
        await waitForPreviewHealth(boundOrigin, child, exit);
        if (timeout) clearTimeout(timeout);
        timeout = undefined;
        process.stdout.write(
            `Local preview service listening at ${boundOrigin}\n`,
        );
        releaseRuntimeStartupLock();
        return (await exit).code;
    } catch (error) {
        if (child.exitCode === null && child.signalCode === null)
            await stopChild(child);
        const status = await exit;
        if (stopping || error instanceof ChildEndedError) return status.code;
        throw error;
    } finally {
        if (timeout) clearTimeout(timeout);
        removeSignals();
    }
}

async function waitForPreviewHealth(
    origin: string,
    child: Child,
    exit: Promise<ChildStatus>,
): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) {
            const status = await exit;
            throw new ChildEndedError(
                status,
                "The local preview service exited during startup.",
            );
        }
        try {
            const response = await fetch(new URL("/health", origin), {
                signal: AbortSignal.timeout(
                    LOCAL_RUNTIME_POLICY.previewReadinessProbeTimeoutMs,
                ),
            });
            if (response.ok) return;
        } catch {
            // Wait for the newly bound HTTP listener to accept requests.
        }
        await delay(LOCAL_RUNTIME_POLICY.previewReadinessPollMs);
    }
    throw new LocalDevError(
        "The local preview service failed its health check.",
    );
}

async function runTrackedService(
    root: string,
    role: LocalRuntimeRole,
    executable: string,
    args: string[],
    cwd: string,
    timeoutMs: number,
    onReady?: () => Promise<number>,
): Promise<number> {
    const runId = randomUUID();
    const child = spawn(executable, args, {
        cwd,
        env: {
            ...process.env,
            LOCAL_RUNTIME_ROOT: root,
            LOCAL_RUNTIME_RUN_ID: runId,
        },
        stdio: "inherit",
    });
    if (!child.pid) throw new LocalDevError("The local service did not start.");
    const exit = trackExit(child);
    let stopping = false;
    const removeSignals = forwardSignals(child, () => {
        stopping = true;
    });
    try {
        await publishRuntimeProcess(root, { role, pid: child.pid, runId });
        await waitForOrigin(root, "web", child, exit, timeoutMs);
        releaseRuntimeStartupLock();
        if (onReady) return await onReady();
        return (await exit).code;
    } catch (error) {
        await stopChild(child);
        if (stopping) return (await exit).code;
        if (error instanceof ChildEndedError) return error.status.code;
        throw error;
    } finally {
        removeSignals();
        if (onReady) await stopChild(child);
        await stopLocalRuntimeInvocation(root, runId);
    }
}

async function waitForOrigin(
    root: string,
    role: "web",
    child: Child,
    exit: Promise<ChildStatus>,
    timeoutMs: number,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) {
            const status = await exit;
            throw new ChildEndedError(
                status,
                "The local web service exited before readiness.",
            );
        }
        try {
            await resolveLocalRuntime(root, { requiredOrigins: [role] });
            return;
        } catch (error) {
            if (
                error instanceof Error &&
                (error.message ===
                    "The local runtime is missing its required web listener." ||
                    error.message ===
                        "The local runtime manifest points to a stale web listener.")
            ) {
                await delay(LOCAL_RUNTIME_POLICY.webReadinessPollMs);
                continue;
            }
            throw error;
        }
    }
    throw new LocalDevError(
        "The local web listener did not become ready before the startup timeout.",
    );
}

async function runUntilExit(
    child: Child,
    onExit: () => Promise<void>,
): Promise<number> {
    const removeSignals = forwardSignals(child);
    try {
        return (await trackExit(child)).code;
    } finally {
        removeSignals();
        await onExit();
    }
}

async function runCommand(
    executable: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
    const child = spawn(executable, args, { cwd, env, stdio: "inherit" });
    return runUntilExit(child, () => stopChild(child));
}

function forwardSignals(
    child: Child,
    onSignal?: () => void,
    gracefulSignal?: NodeJS.Signals,
): () => void {
    const forward = (signal: NodeJS.Signals) => {
        onSignal?.();
        if (child.exitCode === null && child.signalCode === null)
            child.kill(gracefulSignal ?? signal);
    };
    const onInt = () => forward("SIGINT");
    const onTerm = () => forward("SIGTERM");
    process.once("SIGINT", onInt);
    process.once("SIGTERM", onTerm);
    return () => {
        process.removeListener("SIGINT", onInt);
        process.removeListener("SIGTERM", onTerm);
    };
}

function trackExit(child: Child): Promise<ChildStatus> {
    return new Promise((done, fail) => {
        if (child.exitCode !== null || child.signalCode !== null) {
            done({
                code: child.exitCode ?? signalExitCode(child.signalCode),
                signal: child.signalCode,
            });
            return;
        }
        child.once("error", fail);
        child.once("close", (code, signal) =>
            done({ code: code ?? signalExitCode(signal), signal }),
        );
    });
}

function signalExitCode(signal: NodeJS.Signals | null): number {
    return signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1;
}

async function stopChild(
    child: Child,
    signal: NodeJS.Signals = "SIGTERM",
): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exit = trackExit(child);
    if (!child.killed) child.kill(signal);
    await Promise.race([
        exit,
        delay(3_000).then(() => {
            if (child.exitCode === null && child.signalCode === null)
                child.kill("SIGKILL");
        }),
    ]);
}

function selectedLocalDeployment(root: string): string {
    const envPath = join(root, ".env.local");
    if (!existsSync(envPath))
        throw new LocalDevError(
            "The native local deployment is not configured.",
        );
    let selector: string | undefined;
    try {
        selector = parseEnv(readFileSync(envPath, "utf8")).CONVEX_DEPLOYMENT;
    } catch {
        throw new LocalDevError(
            "The native local deployment configuration is invalid.",
        );
    }
    if (!selector || !/^(local|anonymous):[\w-]+$/.test(selector))
        throw new LocalDevError(
            "Select a native local deployment in .env.local before starting.",
        );
    if (
        process.env.CONVEX_DEPLOYMENT &&
        process.env.CONVEX_DEPLOYMENT !== selector
    )
        throw new LocalDevError(
            "The process deployment selection conflicts with .env.local.",
        );
    if (existsSync(join(root, ".convex/local/default/config.json")))
        return readNativeLocalDeployment(root).deploymentName;
    return selector.slice(selector.indexOf(":") + 1);
}

function nativeEnvironment(root: string, runId: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        CONVEX_TMPDIR: process.env.CONVEX_TMPDIR ?? "/tmp",
        CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS:
            process.env.CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS ??
            String(Math.ceil(STARTUP_TIMEOUT_MS / 1000)),
        LOCAL_RUNTIME_ROOT: root,
        LOCAL_RUNTIME_RUN_ID: runId,
    };
    for (const key of [
        "CONVEX_DEPLOYMENT",
        "CONVEX_DEPLOY_KEY",
        "CONVEX_SELF_HOSTED_URL",
        "CONVEX_SELF_HOSTED_ADMIN_KEY",
    ])
        delete env[key];
    return env;
}

function hasNativeRuntimeConfig(root: string): boolean {
    return (
        existsSync(join(root, ".env.local")) &&
        existsSync(join(root, ".convex/local/default/config.json"))
    );
}

async function delay(ms: number): Promise<void> {
    await new Promise((done) => setTimeout(done, ms));
}

function positiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0
        ? Math.min(parsed, LOCAL_RUNTIME_POLICY.maxStartupTimeoutMs)
        : fallback;
}

function configuredPreviewPort(
    value: string | undefined,
    serviceRoot: string,
): number | undefined {
    if (value === undefined) {
        const envPath = join(serviceRoot, ".env");
        if (existsSync(envPath)) {
            try {
                value = parseEnv(readFileSync(envPath, "utf8")).PORT;
            } catch {
                throw new LocalDevError(
                    "The preview service environment file is invalid.",
                );
            }
        }
    }
    if (value === undefined) return undefined;
    return fixedPort(value);
}

function fixedPort(value: string): number {
    if (!/^\d+$/.test(value))
        throw new LocalDevError(
            "PORT must be a whole number between 1 and 65535.",
        );
    const port = Number(value);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
        throw new LocalDevError(
            "PORT must be a whole number between 1 and 65535.",
        );
    return port;
}

function portArgument(args: string[], name: string): number | undefined {
    let port: number | undefined;
    for (const [index, arg] of args.entries()) {
        if (arg === name) port = fixedPort(args[index + 1] ?? "");
        else if (arg.startsWith(`${name}=`))
            port = fixedPort(arg.slice(name.length + 1));
    }
    return port;
}

function pidArgument(args: string[]): number | undefined {
    const value =
        args.find((arg) => arg.startsWith("--pid="))?.slice(6) ??
        (args.includes("--pid") ? args[args.indexOf("--pid") + 1] : undefined);
    if (value === undefined && !args.includes("--pid")) return undefined;
    if (
        !value ||
        !/^\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) < 2
    )
        throw new LocalDevError(
            "--pid must identify a process greater than 1.",
        );
    return Number(value);
}

class ChildEndedError extends LocalDevError {
    readonly status: ChildStatus;

    constructor(status: ChildStatus, message: string) {
        super(message);
        this.status = status;
    }
}

const entry = process.argv[1];
if (entry && fileURLToPath(import.meta.url) === resolve(entry)) {
    main()
        .then((code) => {
            process.exitCode = code;
        })
        .catch((error: unknown) => {
            if (error instanceof ChildEndedError)
                process.exitCode = error.status.code;
            else {
                console.error(
                    error instanceof LocalDevError ||
                        error instanceof LocalRuntimeError ||
                        error instanceof LocalProcessError
                        ? error.message
                        : "Local runtime command failed.",
                );
                process.exitCode = 1;
            }
        });
}
