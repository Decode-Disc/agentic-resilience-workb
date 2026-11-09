import {
    closeSync,
    existsSync,
    fsyncSync,
    openSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";

type AnalysisIdentity = {
    campaignId: string;
    lotId: string;
    mandateHash: string;
    candidateHash: string;
    evidenceHash: string;
    provider: "openai" | "opencode-go";
    model: string;
    attemptKey: string;
};
type AnalysisReceipt = {
    input: number;
    output: number;
    costMicros: number;
    observationHash?: string;
};
const identityKeys = [
    "campaignId",
    "lotId",
    "mandateHash",
    "candidateHash",
    "evidenceHash",
    "provider",
    "model",
    "attemptKey",
] as const;
const receiptKeys = ["input", "output", "costMicros"] as const;
function sameFields<T>(left: T, right: T, keys: readonly (keyof T)[]) {
    return keys.every((key) => left[key] === right[key]);
}
function validateAnalysisIdentity(identity: AnalysisIdentity) {
    if (
        !identity ||
        ![
            identity.campaignId,
            identity.lotId,
            identity.model,
            identity.attemptKey,
        ].every(
            (value) =>
                typeof value === "string" &&
                value.length > 0 &&
                value.length <= 200,
        ) ||
        ![
            identity.mandateHash,
            identity.candidateHash,
            identity.evidenceHash,
        ].every(
            (value) =>
                typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
        ) ||
        !["openai", "opencode-go"].includes(identity.provider)
    )
        throw new Error("Invalid analysis attempt identity");
}
function validateAnalysisReceipt(receipt: AnalysisReceipt) {
    if (
        !receipt ||
        !receiptKeys.every(
            (key) => Number.isSafeInteger(receipt[key]) && receipt[key] >= 0,
        ) ||
        (receipt.observationHash !== undefined &&
            !/^[a-f0-9]{64}$/.test(receipt.observationHash))
    )
        throw new Error("Invalid analysis receipt");
}

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
    let entries: Array<Record<string, unknown>>;
    try {
        entries = existsSync(path)
            ? readFileSync(path, "utf8")
                  .trim()
                  .split("\n")
                  .filter(Boolean)
                  .map((line) => JSON.parse(line))
            : [];
    } catch (error) {
        throw new Error("Qualification journal unavailable or invalid", {
            cause: error,
        });
    }
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
    const analysisAttempts = () => {
        const attempts = new Map<
            string,
            {
                identity: AnalysisIdentity;
                status: "unknown" | "completed";
                receipt?: AnalysisReceipt;
            }
        >();
        for (const entry of entries) {
            if (entry.event === "analysis_started") {
                const identity = entry.identity as AnalysisIdentity;
                validateAnalysisIdentity(identity);
                if (attempts.has(identity.attemptKey))
                    throw new Error("Analysis journal conflict");
                attempts.set(identity.attemptKey, {
                    identity,
                    status: "unknown",
                });
            } else if (entry.event === "analysis_finished") {
                const identity = entry.identity as AnalysisIdentity;
                const receipt = entry.receipt as AnalysisReceipt;
                validateAnalysisIdentity(identity);
                validateAnalysisReceipt(receipt);
                const previous = attempts.get(identity.attemptKey);
                if (
                    previous?.status !== "unknown" ||
                    !sameFields(previous.identity, identity, identityKeys)
                )
                    throw new Error("Analysis journal conflict");
                attempts.set(identity.attemptKey, {
                    identity,
                    status: "completed",
                    receipt,
                });
            }
        }
        return [...attempts.values()];
    };
    return {
        analysisAttempts,
        beginAnalysis(identity: AnalysisIdentity) {
            validateAnalysisIdentity(identity);
            const previous = analysisAttempts().find(
                (item) => item.identity.attemptKey === identity.attemptKey,
            );
            if (previous) {
                if (!sameFields(previous.identity, identity, identityKeys))
                    throw new Error("Analysis attempt identity conflict");
                throw new Error(
                    previous.status === "unknown"
                        ? "Analysis outcome unknown"
                        : "Analysis already completed",
                );
            }
            append({ event: "analysis_started", identity });
        },
        finishAnalysis(identity: AnalysisIdentity, receipt: AnalysisReceipt) {
            validateAnalysisIdentity(identity);
            validateAnalysisReceipt(receipt);
            const previous = analysisAttempts().find(
                (item) => item.identity.attemptKey === identity.attemptKey,
            );
            if (
                !previous ||
                !sameFields(previous.identity, identity, identityKeys)
            )
                throw new Error("Analysis attempt identity conflict");
            if (previous.status === "completed") {
                if (
                    !previous.receipt ||
                    !sameFields(previous.receipt, receipt, [
                        ...receiptKeys,
                        "observationHash",
                    ])
                )
                    throw new Error("Analysis receipt conflict");
                return;
            }
            append({ event: "analysis_finished", identity, receipt });
        },
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
