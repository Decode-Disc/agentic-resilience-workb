import {
    closeSync,
    existsSync,
    fsyncSync,
    openSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
    type AnalysisProvider,
    type AnalysisReceipt,
    analysisProviderSchema,
    analysisReceiptSchema,
} from "../../../convex/qualificationCampaignPolicy.ts";

export const analysisCallPurposes = ["investigation", "compaction"] as const;
export type AnalysisCallPurpose = (typeof analysisCallPurposes)[number];

type AnalysisIdentity = {
    campaignId: string;
    lotId: string;
    mandateHash: string;
    candidateHash: string;
    evidenceHash: string;
    provider: AnalysisProvider;
    model: string;
    attemptKey: string;
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
const receiptKeys = [
    "input",
    "output",
    "costMicros",
    "accounting",
    "cacheRead",
    "cacheWrite",
    "costUsd",
    "costBasis",
    "pricingHash",
] as const;
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
        !analysisProviderSchema.safeParse(identity.provider).success
    )
        throw new Error("Invalid analysis attempt identity");
}
function validateAnalysisReceipt(receipt: AnalysisReceipt) {
    if (!analysisReceiptSchema.safeParse(receipt).success)
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
                purpose?: AnalysisCallPurpose;
                receipt?: AnalysisReceipt;
                settled?: true;
            }
        >();
        for (const entry of entries) {
            if (entry.event === "analysis_started") {
                const identity = entry.identity as AnalysisIdentity;
                validateAnalysisIdentity(identity);
                const purpose = analysisCallPurposes.find(
                    (value) => value === entry.purpose,
                );
                if (entry.purpose !== undefined && purpose === undefined)
                    throw new Error("Invalid analysis call purpose");
                if (attempts.has(identity.attemptKey))
                    throw new Error("Analysis journal conflict");
                attempts.set(identity.attemptKey, {
                    identity,
                    ...(purpose ? { purpose } : {}),
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
                    ...(previous.purpose ? { purpose: previous.purpose } : {}),
                    status: "completed",
                    receipt,
                });
            } else if (entry.event === "analysis_settled") {
                const identity = entry.identity as AnalysisIdentity;
                validateAnalysisIdentity(identity);
                const previous = attempts.get(identity.attemptKey);
                if (
                    previous?.status !== "completed" ||
                    previous.settled ||
                    !sameFields(previous.identity, identity, identityKeys) ||
                    !previous.receipt?.observationHash ||
                    previous.receipt.observationHash !== entry.observationHash
                )
                    throw new Error(
                        "Analysis settlement acknowledgement conflict",
                    );
                attempts.set(identity.attemptKey, {
                    ...previous,
                    settled: true,
                });
            }
        }
        return [...attempts.values()];
    };
    return {
        analysisAttempts,
        beginAnalysis(
            identity: AnalysisIdentity,
            purpose?: AnalysisCallPurpose,
        ) {
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
            if (
                purpose !== undefined &&
                !analysisCallPurposes.some((value) => value === purpose)
            )
                throw new Error("Invalid analysis call purpose");
            append({
                event: "analysis_started",
                identity,
                ...(purpose ? { purpose } : {}),
            });
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
        /** Local receipt completion and acknowledged backend settlement are distinct facts. */
        acknowledgeAnalysisSettlement(identity: AnalysisIdentity) {
            validateAnalysisIdentity(identity);
            const previous = analysisAttempts().find(
                (item) => item.identity.attemptKey === identity.attemptKey,
            );
            if (
                previous?.status !== "completed" ||
                !sameFields(previous.identity, identity, identityKeys) ||
                !previous.receipt?.observationHash
            )
                throw new Error("Analysis settlement acknowledgement conflict");
            if (previous.settled) return;
            append({
                event: "analysis_settled",
                identity,
                observationHash: previous.receipt.observationHash,
            });
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
