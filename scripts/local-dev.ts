import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import {
    assertRuntimeStartupLock,
    getLocalRuntimeIdentity,
    getPreferredRuntimePort,
    getRuntimeStartupLockPath,
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
    120_000,
);

async function main(): Promise<number> {
    const args = process.argv.slice(2);
    const lockedIndex = args.indexOf("--startup-lock-held");
    if (lockedIndex !== -1) {
        const mode = args[lockedIndex + 1];
        if (!mode)
            throw new LocalDevError(
                "The locked local runtime command is missing.",
            );
        assertRuntimeStartupLock(process.cwd());
        return runLockedMode(process.cwd(), mode);
    }

    const mode = args[0];
    const root = process.cwd();
    if (!mode)
        throw new LocalDevError(
            "Choose dev, dev:web, convex:dev, dev:browser, dev:all, or test:e2e.",
        );
    if (mode === "dev" || mode === "convex:dev" || mode === "test:e2e")
        return runWithStartupLock(root, mode);
    if (mode === "dev:web") return runWeb(root);
    if (mode === "dev:browser") return runPreview(root);
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

async function runWithStartupLock(root: string, mode: string): Promise<number> {
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
        ],
        {
            cwd: identity.root,
            env: { ...process.env, LOCAL_RUNTIME_ROOT: identity.root },
            stdio: "inherit",
        },
    );
    return runUntilExit(child, async () => {});
}

async function runLockedMode(root: string, mode: string): Promise<number> {
    if (mode === "dev" || mode === "convex:dev" || mode === "test:e2e")
        return runNativeWatcher(
            root,
            mode !== "convex:dev",
            mode === "test:e2e",
        );
    throw new LocalDevError("Unknown locked local runtime command.");
}

async function runNativeWatcher(
    root: string,
    startWeb: boolean,
    runE2e: boolean,
): Promise<number> {
    const deploymentName = selectedLocalDeployment(root);
    const cli = resolve(root, "node_modules/convex/bin/main.js");
    if (!existsSync(cli))
        throw new LocalDevError("The installed Convex CLI is missing.");

    const runId = randomUUID();
    const child = spawn(
        process.execPath,
        [cli, "dev", ...(startWeb ? ["--start", "pnpm exec vite dev"] : [])],
        {
            cwd: root,
            env: nativeEnvironment(root, runId),
            stdio: "inherit",
        },
    );
    const exit = trackExit(child);
    const removeSignals = forwardSignals(child);
    try {
        await waitForBackend(root, deploymentName, child, runId, exit);
        releaseRuntimeStartupLock();
        if (!runE2e) return (await exit).code;

        await waitForOrigin(root, "web", child, exit, STARTUP_TIMEOUT_MS);
        const runtime = await resolveLocalRuntime(root, {
            requiredOrigins: ["convex", "web"],
        });
        return await runCommand("pnpm", ["exec", "playwright", "test"], root, {
            ...process.env,
            PLAYWRIGHT_BASE_URL: runtime.origins.web,
            LOCAL_RUNTIME_CONVEX_ORIGIN: runtime.origins.convex,
            LOCAL_RUNTIME_WORKTREE_ID: runtime.identity.worktreeId,
        });
    } catch (error) {
        await stopChild(child);
        throw error;
    } finally {
        removeSignals();
        if (runE2e) await stopChild(child);
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
            try {
                await resolveLocalRuntime(root, {
                    requiredOrigins: ["convex"],
                });
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

async function runWeb(root: string): Promise<number> {
    await resolveLocalRuntime(root, { requiredOrigins: ["convex"] });
    return runTrackedService(
        root,
        "web",
        "pnpm",
        ["exec", "vite", "dev"],
        root,
        STARTUP_TIMEOUT_MS,
    );
}

async function runPreview(root: string): Promise<number> {
    const serviceRoot = join(root, "services/playwright-browser");
    const build = await runCommand("npm", ["run", "build"], serviceRoot);
    if (build !== 0) return build;

    const runId = randomUUID();
    const preferredPort = getPreferredRuntimePort(root, "preview");
    let started: PreviewStart;
    try {
        started = await startPreviewService(
            root,
            serviceRoot,
            preferredPort ?? 0,
            runId,
        );
    } catch (error) {
        if (hasNativeRuntimeConfig(root)) await removeRuntimeRun(root, runId);
        throw error;
    }
    if (
        preferredPort &&
        started.status !== null &&
        started.stderr.includes("EADDRINUSE")
    )
        started = await startPreviewService(root, serviceRoot, 0, runId);
    if (started.status !== null) {
        await removeRuntimeRun(root, runId);
        return started.status;
    }
    if (!started.origin)
        throw new LocalDevError(
            "The local preview service did not publish its bound address.",
        );
    return runUntilExit(started.child, async () => {
        await removeRuntimeRun(root, runId);
    });
}

type PreviewStart = {
    child: Child;
    origin?: string;
    status: number | null;
    stderr: string;
};

async function startPreviewService(
    root: string,
    serviceRoot: string,
    port: number,
    runId: string,
): Promise<PreviewStart> {
    const child = spawn("npm", ["run", "dev"], {
        cwd: serviceRoot,
        env: {
            ...process.env,
            PORT: String(port),
            PREVIEW_SERVICE_HOST: "127.0.0.1",
            LOCAL_RUNTIME_ROOT: root,
            LOCAL_RUNTIME_RUN_ID: runId,
        },
        stdio: ["inherit", "inherit", "pipe"],
    });
    let stderr = "";
    let pending = "";
    const exit = trackExit(child);
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
        stderr += text;
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
        return { child, origin: boundOrigin, status: null, stderr };
    } catch (error) {
        if (child.exitCode === null && child.signalCode === null)
            await stopChild(child);
        const status = await exit;
        if (error instanceof ChildEndedError)
            return { child, status: status.code, stderr };
        throw error;
    } finally {
        if (timeout) clearTimeout(timeout);
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
    await publishRuntimeProcess(root, { role, pid: child.pid, runId });
    const removeSignals = forwardSignals(child);
    try {
        await waitForOrigin(root, "web", child, exit, timeoutMs);
        return (await exit).code;
    } catch (error) {
        await stopChild(child);
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

function forwardSignals(child: Child): () => void {
    const forward = (signal: NodeJS.Signals) => {
        if (child.exitCode === null && child.signalCode === null)
            child.kill(signal);
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

async function stopChild(child: Child): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exit = trackExit(child);
    child.kill("SIGTERM");
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
            process.env.CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS ?? "120",
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
                    error instanceof LocalDevError
                        ? error.message
                        : "Local runtime command failed.",
                );
                process.exitCode = 1;
            }
        });
}
