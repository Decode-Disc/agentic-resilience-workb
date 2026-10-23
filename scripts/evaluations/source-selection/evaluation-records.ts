import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const EVALUATION_ATTEMPT_RESERVATION_USD = 0.04;
export const EVALUATION_BUDGET_USD = 1;

type AccountingEntry = {
    event: string;
    key: string;
    reservation?: number;
    costUsd?: number;
};

/** Counts actual historical starts across runs, retaining reservations for unknown charges. */
export function readEvaluationHistory(runsDirectory: string, names: string[]) {
    assert(
        names.length > 0 && new Set(names).size === names.length,
        "Supply distinct historical runs",
    );
    const journals = names.map((name) => {
        assert(/^[a-zA-Z0-9_-]+$/.test(name), "Invalid historical run name");
        return {
            name,
            bytes: readFileSync(
                join(runsDirectory, name, "calls.jsonl"),
                "utf8",
            ),
        };
    });
    const events = journals.flatMap(({ name, bytes }) =>
        bytes
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => {
                const event = JSON.parse(line) as AccountingEntry;
                assert(
                    typeof event.key === "string",
                    "Invalid historical entry identity",
                );
                return { ...event, key: `${name}:${event.key}` };
            }),
    );
    const starts = events.filter((event) => event.event === "started");
    const results = events.filter((event) => event.event === "result");
    assert(
        new Set(starts.map((event) => event.key)).size === starts.length,
        "Duplicate historical start",
    );
    assert(
        new Set(results.map((event) => event.key)).size === results.length &&
            results.every((result) =>
                starts.some((start) => start.key === result.key),
            ),
        "Orphaned or duplicate historical result",
    );
    const conservativeCostUsd = starts.reduce((cost, start) => {
        assert(
            typeof start.reservation === "number" &&
                Number.isFinite(start.reservation) &&
                start.reservation >= 0,
            "Invalid historical reservation",
        );
        const result = results.find((item) => item.key === start.key);
        const amount = result?.costUsd ?? start.reservation;
        assert(
            Number.isFinite(amount) && amount >= 0,
            "Invalid historical cost",
        );
        return cost + amount;
    }, 0);
    const hash = (text: string) =>
        createHash("sha256").update(text).digest("hex");
    return {
        attempts: starts.length,
        conservativeCostUsd,
        journalSha256: hash(journals.map((item) => item.bytes).join("\n")),
        journals: journals.map(({ name, bytes }) => ({
            name,
            sha256: hash(bytes),
        })),
    };
}

/** Redacts credentials before an evaluation persists provider diagnostics. */
export function redactEvaluationResponse(body: string, apiKey: string) {
    assert(
        apiKey.length > 0,
        "Diagnostic redaction requires the configured credential",
    );
    return body
        .replaceAll(apiKey, "[redacted]")
        .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
        .replace(/sk-or-v1-[A-Za-z0-9_-]+/g, "[redacted]");
}
