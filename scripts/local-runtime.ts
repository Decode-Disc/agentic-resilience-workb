import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    renameSync,
    writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export type LocalRuntimeRole = "convex" | "web" | "preview";
export type LocalRuntimeOrigin = "convex" | "site" | "web" | "preview";

export type LocalRuntimeIdentity = {
    root: string;
    gitCommonDir: string;
    worktreeId: string;
    deploymentName: string;
    deploymentSelector: string;
};

export type OwnedRuntimeProcess = {
    role: LocalRuntimeRole;
    pid: number;
    runId: string;
};

export type RuntimeOrigins = {
    convex: string;
    site: string;
    web?: string;
    preview?: string;
};

export type LocalRuntimeManifest = {
    version: 1;
    identity: LocalRuntimeIdentity;
    ownedPids: OwnedRuntimeProcess[];
    origins: RuntimeOrigins;
    originOwners: Partial<
        Record<"web" | "preview", { pid: number; runId: string }>
    >;
    updatedAt: string;
};

export type LocalRuntimeReadiness = {
    status: "ready";
    identity: LocalRuntimeIdentity;
    deploymentName: string;
    deploymentSelector: string;
    origins: RuntimeOrigins;
    ownedPids: OwnedRuntimeProcess[];
};

export type ResolveLocalRuntimeOptions = {
    requiredOrigins?: readonly LocalRuntimeOrigin[];
};

type RuntimeProjectionUpdate =
    | { kind: "process-start"; process: OwnedRuntimeProcess }
    | {
          kind: "listener-ready";
          role: "web" | "preview";
          origin: string;
          pid: number;
          runId: string;
      }
    | { kind: "run-stop"; runId: string };

type NativeLocalDeployment = {
    deploymentName: string;
    selector: string;
    cloudPort: number;
    sitePort: number;
};

const MANIFEST_VERSION = 1;
const MANIFEST_RELATIVE_PATH = ".local-runtime/manifest.json";
const MANIFEST_LOCK_RELATIVE_PATH = ".local-runtime/manifest.lock";
const STARTUP_LOCK_NAME = "local-runtime-startup.lock";

export class LocalRuntimeError extends Error {
    override name = "LocalRuntimeError";
}

/** Resolve a canonical Git worktree identity for this checkout. */
export function getLocalRuntimeIdentity(
    root: string,
): Omit<LocalRuntimeIdentity, "deploymentName" | "deploymentSelector"> {
    const canonicalRoot = canonicalDirectory(root);
    const topLevel = gitValue(canonicalRoot, ["rev-parse", "--show-toplevel"]);
    if (realpathSync(topLevel) !== canonicalRoot)
        throw new LocalRuntimeError(
            "Local runtime commands must run from the Git worktree root.",
        );
    const commonPath = gitValue(canonicalRoot, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
    ]);
    const gitCommonDir = canonicalDirectory(resolve(canonicalRoot, commonPath));
    const worktreeId = createHash("sha256")
        .update(canonicalRoot)
        .update("\0")
        .update(gitCommonDir)
        .digest("hex")
        .slice(0, 24);
    return { root: canonicalRoot, gitCommonDir, worktreeId };
}

/** Read and verify the current local deployment and its actual listener origins. */
export async function resolveLocalRuntime(
    root: string,
    options: ResolveLocalRuntimeOptions = {},
): Promise<LocalRuntimeReadiness> {
    const deployment = readNativeLocalDeployment(root);
    const identity = {
        ...getLocalRuntimeIdentity(root),
        deploymentName: deployment.deploymentName,
        deploymentSelector: deployment.selector,
    };
    const manifestPath = join(identity.root, MANIFEST_RELATIVE_PATH);
    let manifest: LocalRuntimeManifest;
    if (!existsSync(manifestPath)) {
        manifest = createManifest(identity, deployment);
        await writeProjection(identity.root, { kind: "adopt" });
    } else {
        manifest = readManifest(manifestPath);
        assertManifestIdentity(manifest, identity);
        assertManifestOrigins(manifest, deployment);
        assertOwnedProcessesAreLive(manifest);
    }

    await verifyBackendOrigin(
        manifest.origins.convex,
        deployment.deploymentName,
    );
    if (manifest.origins.web) {
        const owner = manifest.originOwners.web;
        if (!owner)
            throw new LocalRuntimeError("The local web listener has no owner.");
        await verifyWebOrigin(manifest.origins.web, identity.worktreeId, owner);
    }
    if (manifest.origins.preview)
        await verifyPreviewOrigin(manifest.origins.preview);

    const required = options.requiredOrigins ?? [];
    for (const origin of required) {
        if (!manifest.origins[origin])
            throw new LocalRuntimeError(
                "The local runtime is missing its required " +
                    origin +
                    " listener.",
            );
    }
    return {
        status: "ready",
        identity,
        deploymentName: deployment.deploymentName,
        deploymentSelector: deployment.selector,
        origins: { ...manifest.origins },
        ownedPids: manifest.ownedPids.map((process) => ({ ...process })),
    };
}

/** Return a previously published port so Vite can reuse it when available. */
export function getPreferredRuntimePort(
    root: string,
    role: "web" | "preview",
): number | undefined {
    const rootPath = canonicalDirectory(root);
    const manifestPath = join(rootPath, MANIFEST_RELATIVE_PATH);
    if (!existsSync(manifestPath)) return undefined;
    try {
        const manifest = readManifest(manifestPath);
        const identity = getLocalRuntimeIdentity(rootPath);
        if (
            manifest.identity.root !== identity.root ||
            manifest.identity.gitCommonDir !== identity.gitCommonDir ||
            manifest.identity.worktreeId !== identity.worktreeId
        )
            return undefined;
        const value = manifest.origins[role];
        if (!value) return undefined;
        const port = Number(new URL(value).port);
        return Number.isInteger(port) && port > 0 && port <= 65535
            ? port
            : undefined;
    } catch {
        return undefined;
    }
}

/** Record a child process owned by the current local runtime invocation. */
export async function publishRuntimeProcess(
    root: string,
    process: OwnedRuntimeProcess,
): Promise<void> {
    validateOwnedProcess(process);
    await writeProjection(root, { kind: "process-start", process });
}

/** Record the address actually bound by Vite or the preview service. */
export async function publishRuntimeOrigin(
    root: string,
    role: "web" | "preview",
    origin: string,
    pid: number,
    runId: string,
): Promise<void> {
    const parsed = validateLoopbackOrigin(origin);
    if (!Number.isInteger(pid) || pid < 2 || !runId)
        throw new LocalRuntimeError("Invalid local runtime listener owner.");
    await writeProjection(root, {
        kind: "listener-ready",
        role,
        origin: parsed.origin,
        pid,
        runId,
    });
}

/** Remove only the manifest entries owned by one completed runtime invocation. */
export async function removeRuntimeRun(
    root: string,
    runId: string,
): Promise<void> {
    if (!runId || !existsSync(getRuntimeManifestPath(root))) return;
    await writeProjection(root, { kind: "run-stop", runId });
}

/** Check whether a recorded PID still refers to a live process. */
export function isRuntimeProcessAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid < 2) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (
            error instanceof Error && "code" in error && error.code === "EPERM"
        );
    }
}

export function getRuntimeManifestPath(root: string): string {
    return join(canonicalDirectory(root), MANIFEST_RELATIVE_PATH);
}

export function getRuntimeStartupLockPath(root: string): string {
    const identity = getLocalRuntimeIdentity(root);
    return join(identity.gitCommonDir, STARTUP_LOCK_NAME);
}

export function releaseRuntimeStartupLock(fd = 3): void {
    const result = spawnSync("flock", ["--unlock", String(fd)], {
        encoding: "utf8",
        stdio: ["ignore", "ignore", "ignore", fd],
        timeout: 2_000,
    });
    if (result.error || result.status !== 0)
        throw new LocalRuntimeError(
            "Could not release the local runtime startup lock.",
        );
}

export function assertRuntimeStartupLock(root: string, fd = 3): void {
    const expected = getRuntimeStartupLockPath(root);
    try {
        const actual = realpathSync(`/proc/self/fd/${fd}`);
        if (actual !== realpathSync(expected))
            throw new LocalRuntimeError(
                "The local runtime startup lock is not held.",
            );
    } catch (error) {
        if (error instanceof LocalRuntimeError) throw error;
        throw new LocalRuntimeError(
            "The local runtime startup lock is not held.",
        );
    }
}

export function readNativeLocalDeployment(root: string): NativeLocalDeployment {
    const canonicalRoot = canonicalDirectory(root);
    const envPath = join(canonicalRoot, ".env.local");
    const configPath = join(canonicalRoot, ".convex/local/default/config.json");
    if (!existsSync(envPath) || !existsSync(configPath))
        throw new LocalRuntimeError(
            "The native local deployment configuration is missing.",
        );

    let env: Record<string, string | undefined>;
    let config: Record<string, unknown>;
    try {
        env = parseEnv(readFileSync(envPath, "utf8"));
        config = JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
        throw new LocalRuntimeError(
            "The native local deployment configuration is invalid.",
        );
    }

    const selector = env.CONVEX_DEPLOYMENT;
    const match =
        typeof selector === "string"
            ? /^(local|anonymous):([\w-]+)$/.exec(selector)
            : null;
    const deploymentName = config.deploymentName;
    const ports =
        config.ports && typeof config.ports === "object"
            ? (config.ports as Record<string, unknown>)
            : {};
    const cloudPort = ports.cloud;
    const sitePort = ports.site;
    if (
        typeof selector !== "string" ||
        !match ||
        typeof deploymentName !== "string" ||
        deploymentName !== match[2] ||
        !isPort(cloudPort) ||
        !isPort(sitePort)
    )
        throw new LocalRuntimeError(
            "The native deployment does not match .env.local selection.",
        );

    if (
        process.env.CONVEX_DEPLOYMENT &&
        process.env.CONVEX_DEPLOYMENT !== selector
    )
        throw new LocalRuntimeError(
            "The process deployment selection conflicts with .env.local.",
        );

    return {
        deploymentName,
        selector,
        cloudPort,
        sitePort,
    };
}

function createManifest(
    identity: LocalRuntimeIdentity,
    deployment: NativeLocalDeployment,
): LocalRuntimeManifest {
    return {
        version: MANIFEST_VERSION,
        identity,
        ownedPids: [],
        origins: {
            convex: originForPort(deployment.cloudPort),
            site: originForPort(deployment.sitePort),
        },
        originOwners: {},
        updatedAt: new Date().toISOString(),
    };
}

function readManifest(path: string): LocalRuntimeManifest {
    let value: unknown;
    try {
        value = JSON.parse(readFileSync(path, "utf8"));
    } catch {
        throw new LocalRuntimeError(
            "The local runtime manifest is invalid or unreadable.",
        );
    }
    if (
        !value ||
        typeof value !== "object" ||
        !("version" in value) ||
        value.version !== MANIFEST_VERSION ||
        !("identity" in value) ||
        !("ownedPids" in value) ||
        !Array.isArray(value.ownedPids) ||
        !("origins" in value) ||
        !value.origins ||
        typeof value.origins !== "object"
    )
        throw new LocalRuntimeError(
            "The local runtime manifest is invalid or unsupported.",
        );
    const manifest = value as LocalRuntimeManifest;
    if (
        typeof manifest.identity !== "object" ||
        manifest.identity === null ||
        typeof manifest.identity.root !== "string" ||
        typeof manifest.identity.gitCommonDir !== "string" ||
        typeof manifest.identity.worktreeId !== "string" ||
        typeof manifest.identity.deploymentName !== "string" ||
        typeof manifest.identity.deploymentSelector !== "string" ||
        typeof manifest.origins.convex !== "string" ||
        typeof manifest.origins.site !== "string" ||
        !manifest.originOwners ||
        typeof manifest.originOwners !== "object" ||
        !Array.isArray(manifest.ownedPids) ||
        !manifest.ownedPids.every(isOwnedRuntimeProcess)
    )
        throw new LocalRuntimeError(
            "The local runtime manifest is invalid or incomplete.",
        );
    return manifest;
}

function isOwnedRuntimeProcess(value: unknown): value is OwnedRuntimeProcess {
    if (!value || typeof value !== "object") return false;
    const processInfo = value as Record<string, unknown>;
    return (
        (processInfo.role === "convex" ||
            processInfo.role === "web" ||
            processInfo.role === "preview") &&
        Number.isInteger(processInfo.pid) &&
        Number(processInfo.pid) > 1 &&
        typeof processInfo.runId === "string" &&
        processInfo.runId.length > 0
    );
}

function assertManifestIdentity(
    manifest: LocalRuntimeManifest,
    identity: LocalRuntimeIdentity,
): void {
    if (
        manifest.identity.root !== identity.root ||
        manifest.identity.gitCommonDir !== identity.gitCommonDir ||
        manifest.identity.worktreeId !== identity.worktreeId
    )
        throw new LocalRuntimeError(
            "The local runtime manifest belongs to another worktree.",
        );
    if (
        manifest.identity.deploymentName !== identity.deploymentName ||
        manifest.identity.deploymentSelector !== identity.deploymentSelector
    )
        throw new LocalRuntimeError(
            "The local runtime manifest belongs to another deployment selection.",
        );
}

function assertManifestOrigins(
    manifest: LocalRuntimeManifest,
    deployment: NativeLocalDeployment,
): void {
    if (
        manifest.origins.convex !== originForPort(deployment.cloudPort) ||
        manifest.origins.site !== originForPort(deployment.sitePort)
    )
        throw new LocalRuntimeError(
            "The local runtime manifest has stale native deployment origins.",
        );
    for (const role of ["web", "preview"] as const) {
        const origin = manifest.origins[role];
        if (!origin) continue;
        const owner = manifest.originOwners?.[role];
        if (
            !owner ||
            !isOriginOwner(owner) ||
            !manifest.ownedPids.some(
                (processInfo) =>
                    processInfo.role === role &&
                    processInfo.pid === owner.pid &&
                    processInfo.runId === owner.runId,
            )
        )
            throw new LocalRuntimeError(
                "The local runtime manifest has an unowned " +
                    role +
                    " origin.",
            );
        validateLoopbackOrigin(origin);
    }
}

function assertOwnedProcessesAreLive(manifest: LocalRuntimeManifest): void {
    for (const processInfo of manifest.ownedPids) {
        if (!isRuntimeProcessAlive(processInfo.pid))
            throw new LocalRuntimeError(
                "The local runtime manifest has stale readiness for a stopped " +
                    processInfo.role +
                    " process.",
            );
    }
}

async function verifyBackendOrigin(
    origin: string,
    expectedInstanceName: string,
): Promise<void> {
    let response: Response;
    try {
        response = await fetch(`${origin}/instance_name`, {
            redirect: "error",
            signal: AbortSignal.timeout(3_000),
        });
    } catch {
        throw new LocalRuntimeError(
            "The configured local Convex backend is unavailable.",
        );
    }
    if (!response.ok)
        throw new LocalRuntimeError(
            "The configured local Convex backend is unavailable.",
        );
    const instanceName = (await response.text()).trim();
    if (instanceName !== expectedInstanceName)
        throw new LocalRuntimeError(
            "The local Convex backend belongs to another deployment.",
        );
}

async function verifyWebOrigin(
    origin: string,
    worktreeId: string,
    owner: { pid: number; runId: string },
): Promise<void> {
    try {
        const response = await fetch(new URL("/__local_runtime", origin), {
            redirect: "error",
            signal: AbortSignal.timeout(2_000),
        });
        const identity: unknown = await response.json();
        if (
            !response.ok ||
            !identity ||
            typeof identity !== "object" ||
            !("worktreeId" in identity) ||
            identity.worktreeId !== worktreeId ||
            !("runId" in identity) ||
            identity.runId !== owner.runId
        )
            throw new Error("listener identity mismatch");
    } catch {
        throw new LocalRuntimeError(
            "The local runtime manifest points to a stale or foreign web listener.",
        );
    }
}

function isOriginOwner(
    value: unknown,
): value is { pid: number; runId: string } {
    if (!value || typeof value !== "object") return false;
    const owner = value as Record<string, unknown>;
    return (
        Number.isInteger(owner.pid) &&
        Number(owner.pid) > 1 &&
        typeof owner.runId === "string" &&
        owner.runId.length > 0
    );
}

async function verifyPreviewOrigin(origin: string): Promise<void> {
    try {
        const response = await fetch(new URL("/health", origin), {
            redirect: "error",
            signal: AbortSignal.timeout(2_000),
        });
        if (!response.ok) throw new Error("unhealthy listener");
        const body: unknown = await response.json();
        if (
            !body ||
            typeof body !== "object" ||
            !("status" in body) ||
            body.status !== "ok"
        )
            throw new Error("unhealthy listener");
    } catch {
        throw new LocalRuntimeError(
            "The local runtime manifest points to a stale preview listener.",
        );
    }
}

function validateLoopbackOrigin(raw: string): URL {
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        throw new LocalRuntimeError("The local runtime origin is invalid.");
    }
    if (
        parsed.protocol !== "http:" ||
        !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
        !parsed.port ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash
    )
        throw new LocalRuntimeError(
            "Local runtime origins must be explicit loopback HTTP origins.",
        );
    return parsed;
}

function validateOwnedProcess(processInfo: OwnedRuntimeProcess): void {
    if (!isOwnedRuntimeProcess(processInfo))
        throw new LocalRuntimeError("Invalid owned local runtime process.");
}

function isPort(value: unknown): value is number {
    return (
        Number.isInteger(value) && Number(value) > 0 && Number(value) <= 65535
    );
}

function originForPort(port: number): string {
    return `http://127.0.0.1:${port}`;
}

function canonicalDirectory(root: string): string {
    try {
        return realpathSync(resolve(root));
    } catch {
        throw new LocalRuntimeError("The local runtime root is unavailable.");
    }
}

function gitValue(root: string, args: string[]): string {
    const result = spawnSync("git", ["-C", root, ...args], {
        encoding: "utf8",
        timeout: 5_000,
        stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.error || result.status !== 0 || !result.stdout?.trim())
        throw new LocalRuntimeError(
            "The local runtime root is not a valid Git worktree.",
        );
    return result.stdout.trim();
}

async function writeProjection(
    root: string,
    update: RuntimeProjectionUpdate | { kind: "adopt" },
): Promise<void> {
    const canonicalRoot = canonicalDirectory(root);
    const lockPath = join(canonicalRoot, MANIFEST_LOCK_RELATIVE_PATH);
    mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
    const result = spawnSync(
        "flock",
        [
            "--exclusive",
            lockPath,
            process.execPath,
            "--experimental-strip-types",
            fileURLToPath(import.meta.url),
            "--write-projection",
            JSON.stringify(update),
        ],
        {
            cwd: canonicalRoot,
            encoding: "utf8",
            timeout: 5_000,
            stdio: ["ignore", "ignore", "ignore"],
            env: { ...process.env, LOCAL_RUNTIME_ROOT: canonicalRoot },
        },
    );
    if (result.error || result.status !== 0)
        throw new LocalRuntimeError(
            "Could not update the local runtime manifest.",
        );
}

function writeProjectionUnlocked(
    root: string,
    update: RuntimeProjectionUpdate | { kind: "adopt" },
): void {
    const deployment = readNativeLocalDeployment(root);
    const identity = {
        ...getLocalRuntimeIdentity(root),
        deploymentName: deployment.deploymentName,
        deploymentSelector: deployment.selector,
    };
    const manifestPath = getRuntimeManifestPath(root);
    let manifest: LocalRuntimeManifest;
    if (existsSync(manifestPath)) {
        manifest = readManifest(manifestPath);
        assertManifestIdentity(manifest, identity);
    } else {
        manifest = createManifest(identity, deployment);
    }
    manifest.origins.convex = originForPort(deployment.cloudPort);
    manifest.origins.site = originForPort(deployment.sitePort);
    if (update.kind === "process-start") {
        validateOwnedProcess(update.process);
        manifest.ownedPids = [
            ...manifest.ownedPids.filter(
                (item) =>
                    item.pid !== update.process.pid &&
                    !(
                        item.role === update.process.role &&
                        item.runId === update.process.runId
                    ),
            ),
            { ...update.process },
        ];
    } else if (update.kind === "listener-ready") {
        const origin = validateLoopbackOrigin(update.origin).origin;
        if (
            !manifest.ownedPids.some(
                (item) =>
                    item.pid === update.pid && item.runId === update.runId,
            )
        )
            manifest.ownedPids.push({
                role: update.role,
                pid: update.pid,
                runId: update.runId,
            });
        manifest.origins[update.role] = origin;
        manifest.originOwners[update.role] = {
            pid: update.pid,
            runId: update.runId,
        };
    } else if (update.kind === "run-stop") {
        manifest.ownedPids = manifest.ownedPids.filter(
            (item) => item.runId !== update.runId,
        );
        for (const role of ["web", "preview"] as const) {
            if (manifest.originOwners[role]?.runId === update.runId) {
                delete manifest.origins[role];
                delete manifest.originOwners[role];
            }
        }
    }
    manifest.updatedAt = new Date().toISOString();
    const tempPath = `${manifestPath}.${process.pid}.${randomUUID()}.tmp`;
    mkdirSync(dirname(manifestPath), { recursive: true, mode: 0o700 });
    writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, {
        mode: 0o600,
    });
    renameSync(tempPath, manifestPath);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args[0] === "--write-projection") {
        const root = process.env.LOCAL_RUNTIME_ROOT;
        if (!root) throw new LocalRuntimeError("Missing local runtime root.");
        writeProjectionUnlocked(
            root,
            JSON.parse(args[1] ?? "null") as RuntimeProjectionUpdate,
        );
        return;
    }
    const root = process.cwd();
    if (args.includes("--verify-convex")) {
        await resolveLocalRuntime(root, { requiredOrigins: ["convex"] });
        return;
    }
    const readiness = await resolveLocalRuntime(root);
    process.stdout.write(
        `${JSON.stringify(readiness, null, args.includes("--json") ? 2 : 0)}\n`,
    );
}

const entry = process.argv[1];
if (entry && fileURLToPath(import.meta.url) === resolve(entry)) {
    main().catch((error: unknown) => {
        console.error(
            error instanceof LocalRuntimeError
                ? error.message
                : "Local runtime verification failed.",
        );
        process.exitCode = 1;
    });
}
