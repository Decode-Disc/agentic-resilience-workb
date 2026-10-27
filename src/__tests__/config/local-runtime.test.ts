// @vitest-environment node

import { spawn, spawnSync } from "node:child_process";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";

const roots: string[] = [];
const servers: Server[] = [];
const testProcesses: ReturnType<typeof spawn>[] = [];
const runtimeModule = await import(
    pathToFileURL(resolve(process.cwd(), "scripts/local-runtime.ts")).href
);

afterEach(async () => {
    for (const child of testProcesses.splice(0)) {
        if (child.exitCode === null && child.signalCode === null)
            child.kill("SIGTERM");
        if (child.exitCode === null && child.signalCode === null)
            await Promise.race([
                processExit(child),
                new Promise((done) => setTimeout(done, 3_000)),
            ]);
    }
    await Promise.all(
        servers
            .splice(0)
            .filter((server) => server.listening)
            .map(
                (server) =>
                    new Promise<void>((done, fail) =>
                        server.close((error) => (error ? fail(error) : done())),
                    ),
            ),
    );
    for (const root of roots.splice(0))
        rmSync(root, { recursive: true, force: true });
});

function createProjectRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "local-runtime-test-"));
    roots.push(root);
    const git = spawnSync("git", ["init", "--quiet", root], {
        encoding: "utf8",
    });
    if (git.status !== 0) throw new Error(git.stderr);
    mkdirSync(join(root, ".convex/local/default"), { recursive: true });
    writeFileSync(join(root, "package.json"), '{"type":"module"}\n');
    writeFileSync(
        join(root, ".env.local"),
        "CONVEX_DEPLOYMENT=local:runtime-fixture\nVITE_CONVEX_URL=preserve-me\n",
    );
    return root;
}

async function backend(instanceName: string) {
    const state = { requests: 0 };
    const server = createServer((request, response) => {
        state.requests++;
        if (request.url !== "/instance_name") {
            response.writeHead(404).end();
            return;
        }
        response.end(instanceName);
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("Missing fixture backend address");
    return {
        origin: `http://127.0.0.1:${address.port}`,
        state,
    };
}

async function freePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("Missing fixture port address");
    const port = address.port;
    await new Promise<void>((done, fail) =>
        server.close((error) => (error ? fail(error) : done())),
    );
    return port;
}

function writeNativeConfig(
    root: string,
    deploymentName: string,
    origin: string,
) {
    const cloud = Number(new URL(origin).port);
    writeFileSync(
        join(root, ".convex/local/default/config.json"),
        JSON.stringify({
            deploymentName,
            ports: { cloud, site: cloud + 1 },
            adminKey: "fixture-secret-must-never-be-projected",
        }),
    );
}

it("resolves only the worktree's selected native local deployment and projects verified readiness", async () => {
    const root = createProjectRoot();
    const server = await backend("runtime-fixture");
    writeNativeConfig(root, "runtime-fixture", server.origin);

    const runtime = await runtimeModule.resolveLocalRuntime(root);

    expect(runtime.deploymentName).toBe("runtime-fixture");
    expect(runtime.origins.convex).toBe(server.origin);
    expect(server.state.requests).toBe(1);
    const manifestPath = join(root, ".local-runtime/manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = readFileSync(manifestPath, "utf8");
    expect(manifest).toContain(root);
    expect(manifest).toContain("runtime-fixture");
    expect(manifest).not.toContain("fixture-secret-must-never-be-projected");
});

it("rejects a stale manifest identity instead of trusting its saved origins", async () => {
    const root = createProjectRoot();
    const server = await backend("runtime-fixture");
    writeNativeConfig(root, "runtime-fixture", server.origin);
    mkdirSync(join(root, ".local-runtime"), { recursive: true });
    const identity = runtimeModule.getLocalRuntimeIdentity(root);
    writeFileSync(
        join(root, ".local-runtime/manifest.json"),
        JSON.stringify({
            version: 1,
            identity: {
                ...identity,
                root: "/a-different-worktree",
                deploymentName: "runtime-fixture",
                deploymentSelector: "local:runtime-fixture",
            },
            ownedPids: [],
            origins: { convex: server.origin, site: server.origin },
            originOwners: {},
            updatedAt: new Date().toISOString(),
        }),
    );

    await expect(runtimeModule.resolveLocalRuntime(root)).rejects.toThrow(
        /manifest.*worktree|worktree.*manifest/i,
    );
    expect(server.state.requests).toBe(0);
});

it("rejects a deployment identity mismatch before probing the configured port", async () => {
    const root = createProjectRoot();
    const server = await backend("foreign-deployment");
    writeNativeConfig(root, "foreign-deployment", server.origin);

    await expect(runtimeModule.resolveLocalRuntime(root)).rejects.toThrow(
        /deployment.*selection|selection.*deployment/i,
    );
    expect(server.state.requests).toBe(0);
});

function runGit(root: string, args: string[]) {
    const result = spawnSync("git", ["-C", root, ...args], {
        encoding: "utf8",
        timeout: 10_000,
    });
    if (result.error || result.status !== 0)
        throw new Error(result.stderr || "Git fixture setup failed.");
    return result.stdout.trim();
}

function initializeRuntimeFixture(root: string, selector: string) {
    mkdirSync(join(root, ".convex/local/default"), { recursive: true });
    mkdirSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "node_modules/convex/bin"), { recursive: true });
    writeFileSync(join(root, "package.json"), '{"type":"module"}\n');
    writeFileSync(
        join(root, ".env.local"),
        `CONVEX_DEPLOYMENT=${selector}\nVITE_CONVEX_URL=fixture\n`,
    );
    copyFileSync(
        resolve(process.cwd(), "scripts/local-runtime.ts"),
        join(root, "scripts/local-runtime.ts"),
    );
    copyFileSync(
        resolve(process.cwd(), "scripts/local-dev.ts"),
        join(root, "scripts/local-dev.ts"),
    );
    writeFileSync(
        join(root, "node_modules/convex/bin/main.js"),
        `import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

if (process.env.LOCAL_RUNTIME_FIXTURE_FAIL === "yes") process.exit(17);
if (process.env.LOCAL_RUNTIME_CONVEX_ARGS_FILE) {
    writeFileSync(process.env.LOCAL_RUNTIME_CONVEX_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
}
const root = process.cwd();
const deploymentName = parseEnv(readFileSync(".env.local", "utf8")).CONVEX_DEPLOYMENT.split(":")[1];
const commonDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
const marker = join(commonDir, "local-runtime-fixture-starting");
const overlap = join(commonDir, "local-runtime-fixture-overlap");
try {
    writeFileSync(marker, String(process.pid), { flag: "wx" });
} catch {
    writeFileSync(overlap, "concurrent native startup");
    process.exit(51);
}
await new Promise((done) => setTimeout(done, 120));
const server = createServer((request, response) => {
    response.end(request.url === "/instance_name" ? deploymentName : "not found");
});
let webProcess;
if (process.argv.includes("--start")) {
    webProcess = spawn("pnpm", ["exec", "vite", "dev"], { cwd: root, env: process.env, stdio: "inherit" });
}
server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") process.exit(52);
    if (process.env.LOCAL_RUNTIME_FIXTURE_KEEP_CONFIG !== "yes") {
        const directory = join(root, ".convex/local/default");
        mkdirSync(directory, { recursive: true });
        writeFileSync(join(directory, "config.json"), JSON.stringify({
            deploymentName,
            ports: { cloud: address.port, site: address.port },
            adminKey: "fixture-secret",
        }));
    }
    unlinkSync(marker);
});
const shutdown = () => {
    if (webProcess && webProcess.exitCode === null && webProcess.signalCode === null) webProcess.kill("SIGTERM");
    server.close(() => process.exit(0));
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
`,
    );
}

function createWorktreePair() {
    const parent = mkdtempSync(join(tmpdir(), "local-runtime-worktrees-"));
    roots.push(parent);
    const first = join(parent, "first");
    const second = join(parent, "second");
    mkdirSync(first);
    runGit(first, ["init", "--quiet"]);
    writeFileSync(join(first, "README.md"), "runtime fixture\n");
    runGit(first, ["add", "README.md"]);
    const commit = spawnSync(
        "git",
        [
            "-C",
            first,
            "-c",
            "user.name=Runtime Fixture",
            "-c",
            "user.email=runtime-fixture@example.test",
            "commit",
            "--quiet",
            "-m",
            "runtime fixture",
        ],
        { encoding: "utf8", timeout: 10_000 },
    );
    if (commit.error || commit.status !== 0)
        throw new Error(commit.stderr || "Git fixture commit failed.");
    runGit(first, ["worktree", "add", "--quiet", "--detach", second, "HEAD"]);
    initializeRuntimeFixture(first, "local:runtime-first");
    initializeRuntimeFixture(second, "local:runtime-second");
    return { first, second };
}

function spawnLocalDev(
    root: string,
    mode: string,
    overrides: NodeJS.ProcessEnv = {},
    args: string[] = [],
    stdio: "ignore" | "pipe" = "ignore",
) {
    const env = { ...process.env, ...overrides };
    if (Object.hasOwn(overrides, "PORT") && overrides.PORT === undefined)
        delete env.PORT;
    delete env.CONVEX_DEPLOYMENT;
    delete env.CONVEX_DEPLOY_KEY;
    delete env.CONVEX_SELF_HOSTED_URL;
    delete env.CONVEX_SELF_HOSTED_ADMIN_KEY;
    const child = spawn(
        process.execPath,
        [
            "--experimental-strip-types",
            join(root, "scripts/local-dev.ts"),
            mode,
            ...args,
        ],
        { cwd: root, env, stdio },
    );
    testProcesses.push(child);
    return child;
}

async function waitForRuntimeManifest(root: string) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        const path = join(root, ".local-runtime/manifest.json");
        if (existsSync(path)) {
            const manifest = JSON.parse(readFileSync(path, "utf8"));
            if (
                manifest.ownedPids.some(
                    (entry: { role: string }) => entry.role === "convex",
                )
            )
                return manifest;
        }
        await new Promise((done) => setTimeout(done, 25));
    }
    throw new Error("Timed out waiting for owned runtime readiness.");
}

function processExit(child: ReturnType<typeof spawn>): Promise<number | null> {
    return new Promise((done) => {
        if (child.exitCode !== null) return done(child.exitCode);
        child.once("exit", (code) => done(code));
    });
}

async function stoppedPid(): Promise<number> {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    if (!child.pid) throw new Error("The dead-process fixture did not start");
    const pid = child.pid;
    await processExit(child);
    expect(() => process.kill(pid, 0)).toThrow();
    return pid;
}

async function waitForManifest(
    root: string,
    role: "web" | "preview",
    ignoredRunId?: string,
) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        const path = join(root, ".local-runtime/manifest.json");
        if (existsSync(path)) {
            const manifest = JSON.parse(readFileSync(path, "utf8"));
            if (
                manifest.origins[role] &&
                manifest.originOwners[role] &&
                manifest.originOwners[role].runId !== ignoredRunId
            )
                return manifest;
        }
        await new Promise((done) => setTimeout(done, 25));
    }
    throw new Error("Timed out waiting for local listener readiness.");
}

function configureNativeRuntime(root: string, name: string, origin: string) {
    writeFileSync(
        join(root, ".env.local"),
        `CONVEX_DEPLOYMENT=local:${name}\nVITE_CONVEX_URL=fixture\n`,
    );
    writeNativeConfig(root, name, origin);
}

function fakeWebPnpm(root: string) {
    const bin = join(root, "fixture-bin");
    mkdirSync(bin, { recursive: true });
    const runtimeUrl = pathToFileURL(
        resolve(process.cwd(), "scripts/local-runtime.ts"),
    ).href;
    const entry = join(bin, "fake-web.mjs");
    writeFileSync(
        entry,
        `import { createServer } from "node:http";
if (process.argv[2] === "exec" && process.argv[3] === "playwright" && process.argv[4] === "test") {
    writeFileSync(process.env.LOCAL_RUNTIME_PLAYWRIGHT_ARGS_FILE, JSON.stringify(process.argv.slice(5)));
    process.exit(0);
}
import { writeFileSync } from "node:fs";
if (process.argv[2] === "exec" && process.argv[3] === "vite" && process.argv[4] === "dev" && process.env.LOCAL_RUNTIME_VITE_ARGS_FILE) {
    writeFileSync(process.env.LOCAL_RUNTIME_VITE_ARGS_FILE, JSON.stringify(process.argv.slice(5)));
}
import { getLocalRuntimeIdentity, publishRuntimeOrigin } from ${JSON.stringify(runtimeUrl)};
const root = process.env.LOCAL_RUNTIME_ROOT;
const runId = process.env.LOCAL_RUNTIME_RUN_ID;
const identity = getLocalRuntimeIdentity(root);
const server = createServer((request, response) => {
    if (request.url?.startsWith("/__local_runtime")) {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ worktreeId: identity.worktreeId, runId }));
        return;
    }
    response.end("fixture web");
});
server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") process.exit(52);
    void publishRuntimeOrigin(root, "web", "http://127.0.0.1:" + address.port, process.pid, runId)
        .catch(() => process.exit(53));
});
const shutdown = () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
`,
    );
    writeFileSync(
        join(bin, "pnpm"),
        '#!/bin/sh\nexec "$LOCAL_RUNTIME_NODE" --experimental-strip-types "$LOCAL_RUNTIME_WEB_ENTRY" "$@"\n',
        { mode: 0o755 },
    );
    return {
        PATH: `${bin}:${process.env.PATH}`,
        LOCAL_RUNTIME_NODE: process.execPath,
        LOCAL_RUNTIME_WEB_ENTRY: entry,
    };
}

function fakePreviewNpm(root: string) {
    const serviceRoot = join(root, "services/playwright-browser");
    mkdirSync(serviceRoot, { recursive: true });
    writeFileSync(
        join(serviceRoot, "package.json"),
        '{"name":"preview-fixture"}\n',
    );
    const bin = join(root, "fixture-preview-bin");
    mkdirSync(bin, { recursive: true });
    const entry = join(bin, "fake-preview.mjs");
    writeFileSync(
        entry,
        `import { createServer } from "node:http";
if (process.argv[2] === "run" && process.argv[3] === "build") process.exit(0);
const port = Number(process.env.PORT);
const server = createServer((request, response) => {
    if (request.url === "/health") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ status: "ok" }));
        return;
    }
    response.writeHead(404).end();
});
server.once("error", (error) => { process.stderr.write(String(error) + "\\n"); process.exit(1); });
server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") process.exit(52);
    process.stderr.write(JSON.stringify({ event: "server_started", origin: "http://127.0.0.1:" + address.port, port: address.port }) + "\\n");
});
const shutdown = () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
`,
    );
    writeFileSync(
        join(bin, "npm"),
        '#!/bin/sh\nexec "$LOCAL_RUNTIME_NODE" "$LOCAL_RUNTIME_PREVIEW_ENTRY" "$@"\n',
        { mode: 0o755 },
    );
    return {
        PATH: `${bin}:${process.env.PATH}`,
        LOCAL_RUNTIME_NODE: process.execPath,
        LOCAL_RUNTIME_PREVIEW_ENTRY: entry,
        PREVIEW_SERVICE_SECRET: "fixture-secret",
    };
}

it("forwards e2e arguments through the startup lock to Playwright", async () => {
    const { first } = createWorktreePair();
    const argsPath = join(first, "playwright-args.json");
    const convexArgsPath = join(first, "convex-args.json");
    const child = spawnLocalDev(
        first,
        "test:e2e",
        {
            ...fakeWebPnpm(first),
            LOCAL_RUNTIME_PLAYWRIGHT_ARGS_FILE: argsPath,
            LOCAL_RUNTIME_CONVEX_ARGS_FILE: convexArgsPath,
            LOCAL_RUNTIME_STARTUP_TIMEOUT_MS: "5000",
        },
        ["--config", "playwright.harness.config.ts", "--list"],
        "pipe",
    );
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));

    expect(await processExit(child)).toBe(0);
    expect(JSON.parse(readFileSync(argsPath, "utf8"))).toEqual([
        "--config",
        "playwright.harness.config.ts",
        "--list",
    ]);
    expect(JSON.parse(readFileSync(convexArgsPath, "utf8"))).toEqual([
        "dev",
        "--start",
        "pnpm exec vite dev",
    ]);
    expect(output).not.toMatch(/startup-lock-held/);
}, 20_000);

it("forwards Convex CLI arguments through the startup lock", async () => {
    const { first } = createWorktreePair();
    const argsPath = join(first, "convex-args.json");
    const child = spawnLocalDev(
        first,
        "convex:dev",
        {
            LOCAL_RUNTIME_CONVEX_ARGS_FILE: argsPath,
            LOCAL_RUNTIME_STARTUP_TIMEOUT_MS: "5000",
        },
        ["--port", "4321", "--no-color"],
    );

    await waitForRuntimeManifest(first);
    expect(JSON.parse(readFileSync(argsPath, "utf8"))).toEqual([
        "dev",
        "--port",
        "4321",
        "--no-color",
    ]);
    child.kill("SIGTERM");
    expect(await processExit(child)).toBe(0);
}, 20_000);

it("forwards dev arguments to Convex while preserving its Vite start command", async () => {
    const { first } = createWorktreePair();
    const backendServer = await backend("runtime-first");
    configureNativeRuntime(first, "runtime-first", backendServer.origin);
    const argsPath = join(first, "convex-args.json");
    const viteArgsPath = join(first, "vite-args.json");
    const child = spawnLocalDev(
        first,
        "dev",
        {
            ...fakeWebPnpm(first),
            LOCAL_RUNTIME_FIXTURE_KEEP_CONFIG: "yes",
            LOCAL_RUNTIME_CONVEX_ARGS_FILE: argsPath,
            LOCAL_RUNTIME_VITE_ARGS_FILE: viteArgsPath,
            LOCAL_RUNTIME_STARTUP_TIMEOUT_MS: "5000",
        },
        ["--once", "--no-color"],
        "pipe",
    );
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));

    await waitForRuntimeManifest(first);
    await waitForManifest(first, "web");
    await runtimeModule.resolveLocalRuntime(first, {
        requiredOrigins: ["web"],
    });
    expect(JSON.parse(readFileSync(argsPath, "utf8"))).toEqual([
        "dev",
        "--start",
        "pnpm exec vite dev",
        "--once",
        "--no-color",
    ]);
    expect(JSON.parse(readFileSync(viteArgsPath, "utf8"))).toEqual([]);
    child.kill("SIGTERM");
    expect(await processExit(child), output).toBe(0);
}, 20_000);

it("reconciles dead owned processes on process start and retains live owners", async () => {
    const { first } = createWorktreePair();
    const backendServer = await backend("runtime-first");
    configureNativeRuntime(first, "runtime-first", backendServer.origin);
    const deadPid = await stoppedPid();
    const identity = runtimeModule.getLocalRuntimeIdentity(first);
    const staleRunId = "stopped-preview-run";
    const liveOwnerProcess = spawn(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        { stdio: "ignore" },
    );
    if (!liveOwnerProcess.pid)
        throw new Error("The live-process fixture did not start.");
    testProcesses.push(liveOwnerProcess);
    const liveOwner = {
        role: "web",
        pid: liveOwnerProcess.pid,
        runId: "live-run",
    };
    mkdirSync(join(first, ".local-runtime"), { recursive: true });
    writeFileSync(
        join(first, ".local-runtime/manifest.json"),
        JSON.stringify({
            version: 1,
            identity: {
                ...identity,
                deploymentName: "runtime-first",
                deploymentSelector: "local:runtime-first",
            },
            ownedPids: [
                { role: "preview", pid: deadPid, runId: staleRunId },
                liveOwner,
            ],
            origins: {
                convex: backendServer.origin,
                site: `http://127.0.0.1:${Number(new URL(backendServer.origin).port) + 1}`,
                preview: backendServer.origin,
            },
            originOwners: {
                preview: { pid: deadPid, runId: staleRunId },
            },
            updatedAt: new Date().toISOString(),
        }),
    );

    await runtimeModule.publishRuntimeProcess(first, {
        role: "convex",
        pid: process.pid,
        runId: "restart-run",
    });
    const runtime = await runtimeModule.resolveLocalRuntime(first);
    const manifest = JSON.parse(
        readFileSync(join(first, ".local-runtime/manifest.json"), "utf8"),
    );

    expect(manifest.ownedPids).toContainEqual(liveOwner);
    expect(manifest.ownedPids).not.toContainEqual(
        expect.objectContaining({ pid: deadPid, runId: staleRunId }),
    );
    expect(runtime.origins.preview).toBeUndefined();
});

it("reconciles a stopped listener before dev web readiness validation", async () => {
    const root = createProjectRoot();
    initializeRuntimeFixture(root, "local:runtime-fixture");
    const backendServer = await backend("runtime-fixture");
    configureNativeRuntime(root, "runtime-fixture", backendServer.origin);
    const deadPid = await stoppedPid();
    const identity = runtimeModule.getLocalRuntimeIdentity(root);
    const staleRunId = "stopped-web-run";
    const liveOwner = {
        role: "preview",
        pid: process.pid,
        runId: "live-preview-run",
    };
    mkdirSync(join(root, ".local-runtime"), { recursive: true });
    writeFileSync(
        join(root, ".local-runtime/manifest.json"),
        JSON.stringify({
            version: 1,
            identity: {
                ...identity,
                deploymentName: "runtime-fixture",
                deploymentSelector: "local:runtime-fixture",
            },
            ownedPids: [
                { role: "web", pid: deadPid, runId: staleRunId },
                liveOwner,
            ],
            origins: {
                convex: backendServer.origin,
                site: `http://127.0.0.1:${Number(new URL(backendServer.origin).port) + 1}`,
                web: backendServer.origin,
            },
            originOwners: { web: { pid: deadPid, runId: staleRunId } },
            updatedAt: new Date().toISOString(),
        }),
    );

    const child = spawnLocalDev(
        root,
        "dev:web",
        {
            ...fakeWebPnpm(root),
            LOCAL_RUNTIME_STARTUP_TIMEOUT_MS: "5000",
        },
        [],
        "pipe",
    );
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const result = await Promise.race([
        waitForManifest(root, "web", staleRunId).then((manifest) => ({
            manifest,
        })),
        processExit(child).then((code) => ({ code })),
    ]);

    expect(result, output).toHaveProperty("manifest");
    if (!("manifest" in result)) return;
    await runtimeModule.resolveLocalRuntime(root, {
        requiredOrigins: ["web"],
    });
    expect(result.manifest.ownedPids).toContainEqual(liveOwner);
    expect(result.manifest.ownedPids).not.toContainEqual(
        expect.objectContaining({ pid: deadPid, runId: staleRunId }),
    );
    expect(result.manifest.originOwners.web.runId).not.toBe(staleRunId);
    child.kill("SIGTERM");
    expect(await processExit(child)).toBe(0);
}, 20_000);

it("forwards dev web arguments to Vite", async () => {
    const root = createProjectRoot();
    initializeRuntimeFixture(root, "local:runtime-fixture");
    const backendServer = await backend("runtime-fixture");
    configureNativeRuntime(root, "runtime-fixture", backendServer.origin);
    const argsPath = join(root, "vite-args.json");
    const child = spawnLocalDev(
        root,
        "dev:web",
        {
            ...fakeWebPnpm(root),
            LOCAL_RUNTIME_VITE_ARGS_FILE: argsPath,
            LOCAL_RUNTIME_STARTUP_TIMEOUT_MS: "5000",
        },
        ["--host", "127.0.0.1"],
        "pipe",
    );
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));

    await waitForManifest(root, "web");
    await runtimeModule.resolveLocalRuntime(root, { requiredOrigins: ["web"] });
    expect(JSON.parse(readFileSync(argsPath, "utf8"))).toEqual([
        "--host",
        "127.0.0.1",
    ]);
    child.kill("SIGTERM");
    expect(await processExit(child), output).toBe(0);
}, 20_000);

it("serializes native starts across worktrees while each CLI chooses its own free backend port", async () => {
    const { first, second } = createWorktreePair();
    const firstChild = spawnLocalDev(first, "convex:dev");
    const secondChild = spawnLocalDev(second, "convex:dev");

    const [firstManifest, secondManifest] = await Promise.all([
        waitForRuntimeManifest(first),
        waitForRuntimeManifest(second),
    ]);
    const firstRuntime = await runtimeModule.resolveLocalRuntime(first);
    const secondRuntime = await runtimeModule.resolveLocalRuntime(second);

    expect(firstRuntime.origins.convex).not.toBe(secondRuntime.origins.convex);
    expect(firstManifest.ownedPids).toContainEqual(
        expect.objectContaining({ role: "convex" }),
    );
    expect(secondManifest.ownedPids).toContainEqual(
        expect.objectContaining({ role: "convex" }),
    );
    expect(
        existsSync(
            join(
                firstRuntime.identity.gitCommonDir,
                "local-runtime-fixture-overlap",
            ),
        ),
    ).toBe(false);

    firstChild.kill("SIGTERM");
    expect(await processExit(firstChild)).toBe(0);
    await expect(runtimeModule.resolveLocalRuntime(first)).rejects.toThrow(
        /backend is unavailable|stale readiness/i,
    );
    await expect(
        runtimeModule.resolveLocalRuntime(second),
    ).resolves.toMatchObject({
        status: "ready",
        deploymentName: "runtime-second",
    });
    expect(secondChild.exitCode).toBeNull();
}, 20_000);

it("starts concurrent web listeners on disjoint ports and verifies their worktree identities", async () => {
    const { first, second } = createWorktreePair();
    const firstBackend = await backend("runtime-first");
    const secondBackend = await backend("runtime-second");
    configureNativeRuntime(first, "runtime-first", firstBackend.origin);
    configureNativeRuntime(second, "runtime-second", secondBackend.origin);
    const firstChild = spawnLocalDev(first, "dev:web", fakeWebPnpm(first));
    const secondChild = spawnLocalDev(second, "dev:web", fakeWebPnpm(second));

    const [firstManifest, secondManifest] = await Promise.all([
        waitForManifest(first, "web"),
        waitForManifest(second, "web"),
    ]);
    const [firstRuntime, secondRuntime] = await Promise.all([
        runtimeModule.resolveLocalRuntime(first, { requiredOrigins: ["web"] }),
        runtimeModule.resolveLocalRuntime(second, { requiredOrigins: ["web"] }),
    ]);

    expect(firstRuntime.origins.web).not.toBe(secondRuntime.origins.web);
    expect(firstManifest.originOwners.web.runId).not.toBe(
        secondManifest.originOwners.web.runId,
    );
    expect(firstChild.exitCode).toBeNull();
    expect(secondChild.exitCode).toBeNull();
}, 20_000);

it("retries the preview listener on a free port when its saved port is occupied", async () => {
    const root = createProjectRoot();
    initializeRuntimeFixture(root, "local:runtime-fixture");
    const backendServer = await backend("runtime-fixture");
    configureNativeRuntime(root, "runtime-fixture", backendServer.origin);
    const occupied = await backend("occupied-port-fixture");
    const identity = runtimeModule.getLocalRuntimeIdentity(root);
    mkdirSync(join(root, ".local-runtime"), { recursive: true });
    const port = Number(new URL(occupied.origin).port);
    const runId = "previous-preview-owner";
    writeFileSync(
        join(root, ".local-runtime/manifest.json"),
        JSON.stringify({
            version: 1,
            identity: {
                ...identity,
                deploymentName: "runtime-fixture",
                deploymentSelector: "local:runtime-fixture",
            },
            ownedPids: [{ role: "preview", pid: process.pid, runId }],
            origins: {
                convex: backendServer.origin,
                site: `http://127.0.0.1:${port + 2}`,
                preview: occupied.origin,
            },
            originOwners: { preview: { pid: process.pid, runId } },
            updatedAt: new Date().toISOString(),
        }),
    );

    const child = spawnLocalDev(
        root,
        "dev:browser",
        fakePreviewNpm(root),
        [],
        "pipe",
    );
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const manifest = await waitForManifest(root, "preview", runId);
    const previewPort = Number(new URL(manifest.origins.preview).port);
    const readinessLine = `Local preview service listening at ${manifest.origins.preview}`;
    const outputDeadline = Date.now() + 2_000;
    while (!output.includes(readinessLine) && Date.now() < outputDeadline)
        await new Promise((done) => setTimeout(done, 20));

    expect(previewPort).not.toBe(port);
    expect(output).toContain(readinessLine);
    expect(
        await runtimeModule.resolveLocalRuntime(root, {
            requiredOrigins: ["preview"],
        }),
    ).toMatchObject({
        origins: { preview: manifest.origins.preview },
    });
    expect(child.exitCode).toBeNull();
}, 20_000);

it("binds the preview service to a valid explicit PORT instead of its saved port", async () => {
    const root = createProjectRoot();
    initializeRuntimeFixture(root, "local:runtime-fixture");
    const backendServer = await backend("runtime-fixture");
    configureNativeRuntime(root, "runtime-fixture", backendServer.origin);
    const savedPortServer = await backend("saved-preview-port");
    const explicitPort = await freePort();
    const identity = runtimeModule.getLocalRuntimeIdentity(root);
    const runId = "previous-preview-owner";
    mkdirSync(join(root, ".local-runtime"), { recursive: true });
    writeFileSync(
        join(root, ".local-runtime/manifest.json"),
        JSON.stringify({
            version: 1,
            identity: {
                ...identity,
                deploymentName: "runtime-fixture",
                deploymentSelector: "local:runtime-fixture",
            },
            ownedPids: [{ role: "preview", pid: process.pid, runId }],
            origins: {
                convex: backendServer.origin,
                site: backendServer.origin,
                preview: savedPortServer.origin,
            },
            originOwners: { preview: { pid: process.pid, runId } },
            updatedAt: new Date().toISOString(),
        }),
    );

    const child = spawnLocalDev(root, "dev:browser", {
        ...fakePreviewNpm(root),
        PORT: String(explicitPort),
        LOCAL_RUNTIME_STARTUP_TIMEOUT_MS: "5000",
    });
    const manifest = await waitForManifest(root, "preview", runId);

    expect(Number(new URL(manifest.origins.preview).port)).toBe(explicitPort);
    expect(child.exitCode).toBeNull();
}, 20_000);

it("honors the preview service dotenv PORT when the parent environment leaves it unset", async () => {
    const root = createProjectRoot();
    initializeRuntimeFixture(root, "local:runtime-fixture");
    const backendServer = await backend("runtime-fixture");
    configureNativeRuntime(root, "runtime-fixture", backendServer.origin);
    const explicitPort = await freePort();
    const serviceEnv = fakePreviewNpm(root);
    writeFileSync(
        join(root, "services/playwright-browser/.env"),
        `PORT=${explicitPort}\n`,
    );

    const child = spawnLocalDev(root, "dev:browser", {
        ...serviceEnv,
        PORT: undefined,
        LOCAL_RUNTIME_STARTUP_TIMEOUT_MS: "5000",
    });
    const manifest = await waitForManifest(root, "preview");

    expect(Number(new URL(manifest.origins.preview).port)).toBe(explicitPort);
    expect(child.exitCode).toBeNull();
}, 20_000);

it("rejects an invalid preview PORT before invoking the service", async () => {
    const root = createProjectRoot();
    initializeRuntimeFixture(root, "local:runtime-fixture");
    const child = spawnLocalDev(
        root,
        "dev:browser",
        {
            ...fakePreviewNpm(root),
            PORT: "123x",
        },
        [],
        "pipe",
    );
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));

    expect(await processExit(child)).toBe(1);
    expect(output).toMatch(/PORT must be a whole number between 0 and 65535/i);
}, 20_000);

it("reports an occupied explicit preview port without falling back to another port", async () => {
    const root = createProjectRoot();
    initializeRuntimeFixture(root, "local:runtime-fixture");
    const backendServer = await backend("runtime-fixture");
    configureNativeRuntime(root, "runtime-fixture", backendServer.origin);
    const savedPortServer = await backend("saved-preview-port");
    const explicitPortServer = await backend("explicit-preview-port");
    const identity = runtimeModule.getLocalRuntimeIdentity(root);
    const explicitPort = Number(new URL(explicitPortServer.origin).port);
    const runId = "previous-preview-owner";
    mkdirSync(join(root, ".local-runtime"), { recursive: true });
    writeFileSync(
        join(root, ".local-runtime/manifest.json"),
        JSON.stringify({
            version: 1,
            identity: {
                ...identity,
                deploymentName: "runtime-fixture",
                deploymentSelector: "local:runtime-fixture",
            },
            ownedPids: [{ role: "preview", pid: process.pid, runId }],
            origins: {
                convex: backendServer.origin,
                site: backendServer.origin,
                preview: savedPortServer.origin,
            },
            originOwners: { preview: { pid: process.pid, runId } },
            updatedAt: new Date().toISOString(),
        }),
    );

    const child = spawnLocalDev(
        root,
        "dev:browser",
        {
            ...fakePreviewNpm(root),
            PORT: String(explicitPort),
            LOCAL_RUNTIME_STARTUP_TIMEOUT_MS: "5000",
        },
        [],
        "pipe",
    );
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const exitCode = await Promise.race([
        processExit(child),
        new Promise<null>((done) => setTimeout(() => done(null), 5_000)),
    ]);
    if (exitCode === null) {
        child.kill("SIGTERM");
        await processExit(child);
    }

    expect(exitCode).toBe(1);
    expect(output).toMatch(/EADDRINUSE|address already in use/i);
    expect(
        JSON.parse(
            readFileSync(join(root, ".local-runtime/manifest.json"), "utf8"),
        ).origins.preview,
    ).toBe(savedPortServer.origin);
}, 20_000);

it("reports native startup failure and does not leave a readiness projection", async () => {
    const { first } = createWorktreePair();
    const child = spawnLocalDev(first, "convex:dev", {
        LOCAL_RUNTIME_FIXTURE_FAIL: "yes",
        LOCAL_RUNTIME_STARTUP_TIMEOUT_MS: "800",
    });

    expect(await processExit(child)).toBe(17);
    expect(existsSync(join(first, ".local-runtime/manifest.json"))).toBe(false);
}, 20_000);

it("does not terminate a process outside the local runtime run", async () => {
    const { first } = createWorktreePair();
    const runtime = spawnLocalDev(first, "convex:dev");
    const manifest = await waitForRuntimeManifest(first);
    const ownedPid = manifest.ownedPids.find(
        (entry: { role: string }) => entry.role === "convex",
    )?.pid;
    if (!ownedPid) throw new Error("Missing owned native CLI pid");
    const unrelated = spawn(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        { stdio: "ignore" },
    );
    const unrelatedPid = unrelated.pid;
    if (!unrelatedPid)
        throw new Error("The unrelated child process did not start");

    runtime.kill("SIGTERM");
    expect(await processExit(runtime)).toBe(0);
    expect(() => process.kill(ownedPid, 0)).toThrow();
    expect(() => process.kill(unrelatedPid, 0)).not.toThrow();
    unrelated.kill("SIGTERM");
}, 20_000);
