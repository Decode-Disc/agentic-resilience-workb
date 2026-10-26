import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const EVALUATION_ATTEMPT_RESERVATION_USD = 0.04;
export const EVALUATION_BUDGET_USD = 1;

export type EvaluationBudgetPolicy = "whole_lot" | "stop_at_budget";

export class EvaluationBudgetStop extends Error {
    readonly reason: "budget_exhausted" | "attempt_limit";
    constructor(reason: "budget_exhausted" | "attempt_limit") {
        super(reason);
        this.reason = reason;
        this.name = "EvaluationBudgetStop";
    }
}

type ReservedAttempt = {
    id: string;
    reservationUsd: number;
    costUsd?: number;
    settled: boolean;
};

/** Owns local evaluation exposure, including in-flight and unknown-charge reservations. */
export class EvaluationBudget {
    private readonly calls = new Map<string, ReservedAttempt>();
    private readonly waiters = new Set<() => void>();
    private stopped?: EvaluationBudgetStop;
    private readonly queue: string[] = [];

    private readonly limits: { budgetUsd: number; maximumAttempts: number };
    constructor(limits: {
        budgetUsd: number;
        maximumAttempts: number;
        history?: ReservedAttempt[];
    }) {
        this.limits = limits;
        assert(
            Number.isFinite(limits.budgetUsd) && limits.budgetUsd > 0,
            "Invalid evaluation budget",
        );
        assert(
            Number.isSafeInteger(limits.maximumAttempts) &&
                limits.maximumAttempts > 0,
            "Invalid attempt ceiling",
        );
        for (const call of limits.history ?? []) {
            assert(!this.calls.has(call.id), "Duplicate historical start");
            this.checkAmount(call.reservationUsd);
            if (call.costUsd !== undefined) this.checkAmount(call.costUsd);
            this.calls.set(call.id, { ...call });
        }
        assert(
            this.calls.size <= limits.maximumAttempts,
            "Historical attempt ceiling exceeded",
        );
    }

    async reserve(id: string, reservationUsd: number, signal?: AbortSignal) {
        this.checkAmount(reservationUsd);
        assert(
            !this.calls.has(id) && !this.queue.includes(id),
            "Duplicate evaluation attempt",
        );
        this.queue.push(id);
        try {
            for (;;) {
                signal?.throwIfAborted();
                if (this.stopped) throw this.stopped;
                if (this.queue[0] === id) {
                    if (this.calls.size >= this.limits.maximumAttempts) {
                        this.stopped = new EvaluationBudgetStop(
                            "attempt_limit",
                        );
                        throw this.stopped;
                    }
                    const summary = this.summary();
                    if (
                        summary.reportedCostUsd +
                            summary.unknownChargeReservedUsd +
                            reservationUsd <=
                        this.limits.budgetUsd
                    ) {
                        this.calls.set(id, {
                            id,
                            reservationUsd,
                            settled: false,
                        });
                        return;
                    }
                    if (
                        ![...this.calls.values()].some((call) => !call.settled)
                    ) {
                        this.stopped = new EvaluationBudgetStop(
                            "budget_exhausted",
                        );
                        throw this.stopped;
                    }
                }
                await new Promise<void>((resolve) => {
                    const wake = () => {
                        this.waiters.delete(wake);
                        signal?.removeEventListener("abort", wake);
                        resolve();
                    };
                    this.waiters.add(wake);
                    signal?.addEventListener("abort", wake, { once: true });
                });
            }
        } finally {
            this.queue.splice(this.queue.indexOf(id), 1);
            this.notifyWaiters();
        }
    }

    settle(id: string, costUsd?: number) {
        const call = this.calls.get(id);
        assert(call, "Unreserved evaluation result");
        if (costUsd !== undefined) {
            this.checkAmount(costUsd);
            assert(
                call.costUsd === undefined || call.costUsd === costUsd,
                "Conflicting evaluation charge",
            );
            call.costUsd = costUsd;
        }
        call.settled = true;
        this.notifyWaiters();
    }

    private notifyWaiters() {
        for (const wake of this.waiters) wake();
    }

    summary() {
        let reportedCostUsd = 0;
        let unknownChargeReservedUsd = 0;
        for (const call of this.calls.values()) {
            if (call.costUsd === undefined)
                unknownChargeReservedUsd += call.reservationUsd;
            else reportedCostUsd += call.costUsd;
        }
        return {
            attempts: this.calls.size,
            reportedCostUsd,
            unknownChargeReservedUsd,
        };
    }

    private checkAmount(amount: number) {
        assert(
            Number.isFinite(amount) && amount >= 0,
            "Invalid evaluation amount",
        );
    }
}

type AccountingEntry = {
    event: string;
    key: string;
    reservation?: number;
    costUsd?: number;
    costBasis?: string;
};

/** A tariff-based estimate is not a known charge, including in historical journals. */
export function knownEvaluationCharge(result?: {
    costUsd?: number;
    costBasis?: string;
}) {
    if (
        !result ||
        result.costBasis === "unknown_charge_reservation" ||
        result.costBasis === "usage_at_frozen_tariff"
    )
        return undefined;
    if (result.costUsd !== undefined)
        assert(
            Number.isFinite(result.costUsd) && result.costUsd >= 0,
            "Invalid historical cost",
        );
    return result.costUsd;
}

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
    let reportedCostUsd = 0;
    let unknownChargeReservedUsd = 0;
    const conservativeCostUsd = starts.reduce((cost, start) => {
        assert(
            typeof start.reservation === "number" &&
                Number.isFinite(start.reservation) &&
                start.reservation >= 0,
            "Invalid historical reservation",
        );
        const result = results.find((item) => item.key === start.key);
        const reported = knownEvaluationCharge(result);
        if (reported === undefined)
            unknownChargeReservedUsd += start.reservation;
        else reportedCostUsd += reported;
        const amount = reported ?? start.reservation;
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
        reportedCostUsd,
        unknownChargeReservedUsd,
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

type UsageReferenceEvent = {
    event: string;
    key: string;
    requestHash?: string;
    response?: {
        model?: string;
        usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            input_tokens?: number;
            output_tokens?: number;
        };
    };
};

/** Reprices exact retained requests without cache discounts; never supplies dispatch authority. */
export function estimateUncachedEvaluation(args: {
    calls: Array<{ requestHash: string; model: string }>;
    catalog?: {
        models: Array<{
            id: string;
            inputPricePerToken: number;
            outputPricePerToken: number;
        }>;
    };
    referenceFile?: string;
}) {
    if (!args.referenceFile)
        return { indicativeUncachedUsd: null, costReferenceSha256: null };
    const bytes = readFileSync(args.referenceFile, "utf8");
    const events = bytes
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as UsageReferenceEvent);
    const starts = events.filter((entry) => entry.event === "started");
    assert(
        new Set(starts.map((entry) => entry.key)).size === starts.length,
        "Duplicate cost reference start",
    );
    const costReferenceSha256 = createHash("sha256")
        .update(bytes)
        .digest("hex");
    let cost = 0;
    for (const call of args.calls) {
        const tariff = args.catalog?.models.find(
            (price) => price.id === call.model,
        );
        const matches = starts
            .filter((entry) => entry.requestHash === call.requestHash)
            .map(
                (start) =>
                    events.find(
                        (entry) =>
                            entry.event === "result" && entry.key === start.key,
                    )?.response,
            )
            .filter((response) => response?.model === call.model);
        if (!tariff || !matches.length)
            return { indicativeUncachedUsd: null, costReferenceSha256 };
        let total = 0;
        for (const response of matches) {
            const input =
                response?.usage?.prompt_tokens ?? response?.usage?.input_tokens;
            const output =
                response?.usage?.completion_tokens ??
                response?.usage?.output_tokens;
            if (
                typeof input !== "number" ||
                !Number.isSafeInteger(input) ||
                input < 0 ||
                typeof output !== "number" ||
                !Number.isSafeInteger(output) ||
                output < 0
            )
                return { indicativeUncachedUsd: null, costReferenceSha256 };
            total +=
                input * tariff.inputPricePerToken +
                output * tariff.outputPricePerToken;
        }
        cost += total / matches.length;
    }
    return { indicativeUncachedUsd: cost, costReferenceSha256 };
}
