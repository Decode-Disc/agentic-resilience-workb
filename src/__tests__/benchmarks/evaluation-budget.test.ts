// @vitest-environment node
import { expect, test } from "vitest";

const { EvaluationBudget } = (await import(
    new URL(
        "../../../scripts/evaluations/source-selection/evaluation-records.ts",
        import.meta.url,
    ).href
)) as typeof import("../../../scripts/evaluations/source-selection/evaluation-records");

test("a pending reservation waits for a known cost before admitting the next request", async () => {
    const budget = new EvaluationBudget({ budgetUsd: 0.1, maximumAttempts: 3 });
    await budget.reserve("first", 0.08);
    let admitted = false;
    const next = budget.reserve("second", 0.08).then(() => {
        admitted = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(admitted).toBe(false);
    budget.settle("first", 0.01);
    await next;
    expect(budget.summary()).toMatchObject({
        attempts: 2,
        reportedCostUsd: 0.01,
        unknownChargeReservedUsd: 0.08,
    });
    budget.settle("second", 0);
    budget.settle("second", 0);
    expect(budget.summary()).toMatchObject({
        reportedCostUsd: 0.01,
        unknownChargeReservedUsd: 0,
    });
});

test("unknown charges stay reserved across reconstruction and cannot be dispatched twice", async () => {
    const budget = new EvaluationBudget({
        budgetUsd: 0.1,
        maximumAttempts: 3,
        history: [{ id: "first", reservationUsd: 0.08, settled: true }],
    });
    await expect(budget.reserve("next", 0.08)).rejects.toMatchObject({
        reason: "budget_exhausted",
    });
    await expect(budget.reserve("first", 0.01)).rejects.toThrow("Duplicate");
    expect(budget.summary()).toMatchObject({
        attempts: 1,
        reportedCostUsd: 0,
        unknownChargeReservedUsd: 0.08,
    });
});

test("an exhausted budget wakes waiters without freeing an unknown charge", async () => {
    const budget = new EvaluationBudget({ budgetUsd: 0.1, maximumAttempts: 3 });
    await budget.reserve("first", 0.08);
    const next = budget.reserve("second", 0.08);
    const checked = expect(next).rejects.toMatchObject({
        reason: "budget_exhausted",
    });
    budget.settle("first");
    await checked;
    expect(budget.summary().attempts).toBe(1);
});

test("reported overruns block subsequent requests and remain visible", async () => {
    const budget = new EvaluationBudget({ budgetUsd: 0.1, maximumAttempts: 3 });
    await budget.reserve("first", 0.08);
    budget.settle("first", 0.11);
    await expect(budget.reserve("second", 0)).rejects.toMatchObject({
        reason: "budget_exhausted",
    });
    expect(budget.summary().reportedCostUsd).toBe(0.11);
});

test("a historical tariff estimate cannot release an unknown-charge reservation", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import(
        "node:fs"
    );
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { readEvaluationHistory } = await import(
        "../../../scripts/evaluations/source-selection/evaluation-records"
    );
    const root = mkdtempSync(join(tmpdir(), "budget-history-"));
    try {
        mkdirSync(join(root, "retained"));
        writeFileSync(
            join(root, "retained", "calls.jsonl"),
            [
                { event: "started", key: "request", reservation: 0.08 },
                {
                    event: "result",
                    key: "request",
                    costUsd: 0.001,
                    costBasis: "usage_at_frozen_tariff",
                },
            ]
                .map((entry) => JSON.stringify(entry))
                .join("\n"),
        );
        expect(
            readEvaluationHistory(root, ["retained"]).conservativeCostUsd,
        ).toBe(0.08);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("new arrivals cannot take released budget ahead of an already waiting request", async () => {
    const budget = new EvaluationBudget({ budgetUsd: 0.1, maximumAttempts: 3 });
    await budget.reserve("first", 0.08);
    const order: string[] = [];
    const second = budget.reserve("second", 0.08).then(() => {
        order.push("second");
        budget.settle("second", 0.01);
    });
    budget.settle("first", 0.01);
    const third = budget.reserve("third", 0.08).then(() => {
        order.push("third");
        budget.settle("third", 0);
    });
    await Promise.all([second, third]);
    expect(order).toEqual(["second", "third"]);
});
