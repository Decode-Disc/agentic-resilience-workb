import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import {
    assertRuntimeStartupLock,
    getLocalRuntimeIdentity,
    getLocalRuntimePorts,
    getRuntimeStartupLockPath,
    LocalRuntimeError,
    type LocalRuntimeRole,
    publishRuntimeOrigin,
    publishRuntimeProcess,
    readNativeLocalDeployment,
    releaseRuntimeStartupLock,
    removeRuntimeRun,
    resolveLocalRuntime,
} from "./local-runtime.ts";

class LocalDevError extends Error {
    override name = "LocalDevError";
}

type ChildStatus = { code: number; signal: NodeJS.Signals | null };
type Child = ReturnType<typeof spawn>;

const STARTUP_TIMEOUT_MS = positiveInteger(
    process.env.LOCAL_RUNTIME_STARTUP_TIMEOUT_MS,
    600_000,
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
    if (!mode)
        throw new LocalDevError(
            "Choose dev, dev:web, convex:dev, dev:browser, dev:all, or test:e2e.",
        );
    if (mode === "dev" || mode === "convex:dev" || mode === "test:e2e")
        return runWithStartupLock(root, mode, forwardedArgs);
    if (mode === "dev:web") return runWeb(root, forwardedArgs);
    if (mode === "dev:browser") return runPreview(root, forwardedArgs);
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

    const runId = randomUUID();
    const child = spawn(
        process.execPath,
        [
            cli,
            "dev",
            "--local-cloud-port",
            String(ports.convex),
            "--local-site-port",
            String(ports.site),
            ...(startWeb ? ["--start", "pnpm exec vite dev"] : []),
            ...(!runE2e ? args : []),
        ],
        {
            cwd: root,
            env: nativeEnvironment(root, runId),
            stdio: "inherit",
        },
    );
    const exit = trackExit(child);
    // The native CLI's SIGINT handler shuts down the backend it started.
    const removeSignals = forwardSignals(child, undefined, "SIGINT");
    try {
        await waitForBackend(root, deploymentName, child, runId, exit);
        releaseRuntimeStartupLock();
        if (!runE2e) return (await exit).code;

        await waitForOrigin(root, "web", child, exit, STARTUP_TIMEOUT_MS);
        const runtime = await resolveLocalRuntime(root, {
            requiredOrigins: ["convex", "web"],
        });
        return await runCommand(
            "pnpm",
            ["exec", "playwright", "test", ...args],
            root,
            {
                ...process.env,
                PLAYWRIGHT_BASE_URL: runtime.origins.web,
                LOCAL_RUNTIME_CONVEX_ORIGIN: runtime.origins.convex,
                LOCAL_RUNTIME_WORKTREE_ID: runtime.identity.worktreeId,
            },
        );
    } catch (error) {
        await stopChild(child, "SIGINT");
        throw error;
    } finally {
        removeSignals();
        if (runE2e) await stopChild(child, "SIGINT");
        await exit;
        await removeRuntimeRun(root, runId);
    }
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
                    await delay(250);
                    continue;
                }
                throw error;
            }
        }
        await delay(250);
    }
    throw new LocalDevError(
        "The native local Convex backend did not become ready before the startup timeout.",
    );
}

async function runWeb(root: string, args: string[]): Promise<number> {
    const port = portArgument(args, "--port");
    getLocalRuntimePorts(root, port === undefined ? {} : { web: port });
    await resolveLocalRuntime(root, { requiredOrigins: ["convex"] });
    return runTrackedService(
        root,
        "web",
        "pnpm",
        ["exec", "vite", "dev", ...args],
        root,
        STARTUP_TIMEOUT_MS,
    );
}

async function runPreview(root: string, args: string[]): Promise<number> {
    const serviceRoot = join(root, "services/playwright-browser");
    const explicitPort = configuredPreviewPort(process.env.PORT, serviceRoot);
    const ports = getLocalRuntimePorts(
        root,
        explicitPort === undefined ? {} : { preview: explicitPort },
    );
    const build = await runCommand("npm", ["run", "build"], serviceRoot);
    if (build !== 0) return build;

    const runId = randomUUID();
    let started: PreviewStart;
    try {
        started = await startPreviewService(
            root,
            serviceRoot,
            ports.preview,
            runId,
            args,
        );
    } catch (error) {
        if (hasNativeRuntimeConfig(root)) await removeRuntimeRun(root, runId);
        throw error;
    }
    if (started.status !== null) {
        await removeRuntimeRun(root, runId);
        return started.status;
    }
    if (!started.origin)
        throw new LocalDevError(
            "The local preview service did not publish its bound address.",
        );
    process.stdout.write(
        `Local preview service listening at ${started.origin}\n`,
    );
    return runUntilExit(started.child, async () => {
        await removeRuntimeRun(root, runId);
    });
}

type PreviewStart = {
    child: Child;
    origin?: string;
    status: number | null;
};

async function startPreviewService(
    root: string,
    serviceRoot: string,
    port: number,
    runId: string,
    args: string[],
): Promise<PreviewStart> {
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
        return { child, origin: boundOrigin, status: null };
    } catch (error) {
        if (child.exitCode === null && child.signalCode === null)
            await stopChild(child);
        const status = await exit;
        if (stopping || error instanceof ChildEndedError)
            return { child, status: status.code };
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
                signal: AbortSignal.timeout(1_000),
            });
            if (response.ok) return;
        } catch {
            // Wait for the newly bound HTTP listener to accept requests.
        }
        await delay(100);
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
        return (await exit).code;
    } catch (error) {
        await stopChild(child);
        if (stopping) return (await exit).code;
        if (error instanceof ChildEndedError) return error.status.code;
        throw error;
    } finally {
        removeSignals();
        await removeRuntimeRun(root, runId);
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
                await delay(150);
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

async function waitForChild(child: Child): Promise<number> {
    return (await trackExit(child)).code;
}

async function runCommand(
    executable: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
    const child = spawn(executable, args, { cwd, env, stdio: "inherit" });
    return waitForChild(child);
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
        ? Math.min(parsed, 600_000)
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
                        error instanceof LocalRuntimeError
                        ? error.message
                        : "Local runtime command failed.",
                );
                process.exitCode = 1;
            }
        });
}
