import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { basename } from "node:path";

export type LocalProcess = {
    pid: number;
    startTime: string;
    parentPid: number;
    command: string;
    cwd: string | null;
    runtimeRoot?: string;
    runId?: string;
};

export type LocalPortListener = {
    address: string;
    port: number;
    processes: LocalProcess[];
};

export class LocalProcessError extends Error {
    override name = "LocalProcessError";
}

function procValue(read: () => string): string | undefined {
    try {
        return read();
    } catch (error) {
        if (
            error instanceof Error &&
            "code" in error &&
            ["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(String(error.code))
        )
            return undefined;
        throw error;
    }
}

/** Capture a kernel process identity without exposing command arguments or its environment. */
export function readLocalProcess(pid: number): LocalProcess | null {
    if (!Number.isInteger(pid) || pid < 2) return null;
    const stat = procValue(() => readFileSync(`/proc/${pid}/stat`, "utf8"));
    if (!stat) return null;
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (fields[0] === "Z" || fields[0] === "X") return null;
    const startTime = fields[19];
    const parentPid = Number(fields[1]);
    if (!startTime || !/^\d+$/.test(startTime) || !Number.isInteger(parentPid))
        throw new LocalProcessError("The kernel process identity is invalid.");
    const executable = procValue(() => readlinkSync(`/proc/${pid}/exe`));
    const cwd = procValue(() => readlinkSync(`/proc/${pid}/cwd`)) ?? null;
    const environment = procValue(() =>
        readFileSync(`/proc/${pid}/environ`, "utf8"),
    );
    const runtimeRoot = environment
        ?.split("\0")
        .find((entry) => entry.startsWith("LOCAL_RUNTIME_ROOT="))
        ?.slice("LOCAL_RUNTIME_ROOT=".length);
    const runId = environment
        ?.split("\0")
        .find((entry) => entry.startsWith("LOCAL_RUNTIME_RUN_ID="))
        ?.slice("LOCAL_RUNTIME_RUN_ID=".length);
    return {
        pid,
        startTime,
        parentPid,
        command: executable ? basename(executable) : "unidentified",
        cwd,
        ...(runtimeRoot ? { runtimeRoot } : {}),
        ...(runId ? { runId } : {}),
    };
}

/** Inspect actual TCP listeners, retaining occupied sockets even when their PID is inaccessible. */
export function inspectLocalPorts(
    ports: readonly number[],
): LocalPortListener[] {
    const selected = new Set(ports);
    const result = spawnSync("ss", ["-H", "-ltnp"], {
        encoding: "utf8",
        timeout: 5_000,
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.status !== 0)
        throw new LocalProcessError(
            "Could not inspect listening ports. Local runtime control requires Linux ss and /proc.",
        );
    const listeners: LocalPortListener[] = [];
    for (const line of result.stdout.trim().split("\n")) {
        if (!line.trim()) continue;
        const address = line.trim().split(/\s+/)[3];
        const match = address && /:(\d+)$/.exec(address);
        if (!match)
            throw new LocalProcessError(
                "The listening-port inspection returned an invalid address.",
            );
        const port = Number(match[1]);
        if (!selected.has(port)) continue;
        const processes: LocalProcess[] = [];
        for (const pid of new Set(
            [...line.matchAll(/pid=(\d+)/g)].map((entry) => Number(entry[1])),
        )) {
            const process = readLocalProcess(pid);
            if (process) processes.push(process);
        }
        listeners.push({ address, port, processes });
    }
    return listeners;
}

function readLocalProcesses(): LocalProcess[] {
    return readdirSync("/proc")
        .filter((name) => /^\d+$/.test(name))
        .map((name) => readLocalProcess(Number(name)))
        .filter((entry): entry is LocalProcess => entry !== null);
}

/** Find surviving children of one invocation, including processes reparented after a crash. */
export function findLocalInvocationProcesses(
    root: string,
    runId: string,
): LocalProcess[] {
    if (!runId)
        throw new LocalProcessError(
            "An invocation identity is required for cleanup.",
        );
    return readLocalProcesses().filter(
        (entry) => entry.runtimeRoot === root && entry.runId === runId,
    );
}

/** Stop the captured process and its descendants, checking kernel birth identities before each signal. */
export async function stopLocalProcessTree(
    target: LocalProcess,
): Promise<void> {
    const current = readLocalProcess(target.pid);
    if (!current) return;
    if (current.startTime !== target.startTime)
        throw new LocalProcessError(
            "The selected process identity changed. Inspect the port again.",
        );
    let ancestor: LocalProcess | null = readLocalProcess(process.pid);
    while (ancestor) {
        if (ancestor.pid === target.pid)
            throw new LocalProcessError(
                "Refusing to stop this command or one of its ancestors.",
            );
        ancestor = readLocalProcess(ancestor.parentPid);
    }
    const snapshot = readLocalProcesses();
    const tree = [target];
    const members = new Set([target.pid]);
    let previousSize = 0;
    while (previousSize !== members.size) {
        previousSize = members.size;
        for (const entry of snapshot) {
            if (members.has(entry.parentPid) && !members.has(entry.pid)) {
                members.add(entry.pid);
                tree.push(entry);
            }
        }
    }
    const alive = () =>
        tree.filter(
            (entry) =>
                readLocalProcess(entry.pid)?.startTime === entry.startTime,
        );
    const signal = (entries: LocalProcess[], value: NodeJS.Signals) => {
        for (const entry of entries) {
            if (readLocalProcess(entry.pid)?.startTime !== entry.startTime)
                continue;
            try {
                process.kill(entry.pid, value);
            } catch (error) {
                if (
                    !(
                        error instanceof Error &&
                        "code" in error &&
                        error.code === "ESRCH"
                    )
                )
                    throw new LocalProcessError(
                        `Could not stop PID ${entry.pid}.`,
                    );
            }
        }
    };
    const wait = async (timeout: number) => {
        const deadline = Date.now() + timeout;
        while (alive().length && Date.now() < deadline)
            await new Promise((done) => setTimeout(done, 25));
    };
    signal([target], "SIGINT");
    await wait(1_500);
    signal(alive(), "SIGTERM");
    await wait(1_000);
    signal(alive(), "SIGKILL");
    await wait(500);
    if (alive().length)
        throw new LocalProcessError("The selected process tree did not stop.");
}
