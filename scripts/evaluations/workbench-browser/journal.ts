import {
    closeSync,
    existsSync,
    fsyncSync,
    openSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** Retains phase intent before effects; reopening cannot silently replay unfinished work. */
export function openQualificationJournal(
    root: string,
    protocol: Record<string, unknown>,
) {
    const protocolPath = join(root, "protocol.json");
    const serialized = `${JSON.stringify(protocol, null, 2)}\n`;
    if (existsSync(protocolPath)) {
        if (readFileSync(protocolPath, "utf8") !== serialized)
            throw new Error(
                "Protocol changed; use a separately authorized lot",
            );
    } else writeFileSync(protocolPath, serialized, { flag: "wx", mode: 0o600 });
    const path = join(root, "progress.jsonl");
    const entries: Array<Record<string, unknown>> = existsSync(path)
        ? readFileSync(path, "utf8")
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line))
        : [];
    const append = (entry: Record<string, unknown>) => {
        const fd = openSync(path, "a", 0o600);
        try {
            writeFileSync(
                fd,
                `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`,
            );
            fsyncSync(fd);
        } finally {
            closeSync(fd);
        }
        entries.push(entry);
    };
    return {
        begin(scenario: string) {
            const previous = entries.filter((e) => e.scenario === scenario);
            if (previous.some((e) => e.event === "finished")) return false;
            if (previous.length)
                throw new Error(
                    "Unfinished scenario; inspect retained evidence before any continuation",
                );
            append({ event: "started", scenario });
            return true;
        },
        finish(scenario: string, result: Record<string, unknown>) {
            if (
                !entries.some(
                    (e) => e.scenario === scenario && e.event === "started",
                ) ||
                entries.some(
                    (e) => e.scenario === scenario && e.event === "finished",
                )
            )
                throw new Error("Scenario is not pending");
            append({ ...result, event: "finished", scenario });
        },
        results() {
            return entries.filter((e) => e.event === "finished");
        },
    };
}
