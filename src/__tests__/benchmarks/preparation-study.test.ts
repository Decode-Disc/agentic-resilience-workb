// @vitest-environment node
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

const { buildPreparationStudyConditions, runPreparationStudy } = await import(
    new URL(
        "../../../scripts/evaluations/source-selection/preparation-study.ts",
        import.meta.url,
    ).href
);

test("native preparation studies freeze a balanced matrix and separate warmups", () => {
    const conditions = buildPreparationStudyConditions({
        phase: "replay",
        plans: ["inline_controls_v2", "source_actions_v3"],
        concurrencies: [2, 4],
        repetitions: 3,
        warmups: 1,
    });
    expect(conditions).toHaveLength(16);
    expect(
        conditions.slice(0, 4).every((c: { warmup: boolean }) => c.warmup),
    ).toBe(true);
    const measured = conditions.filter((c: { warmup: boolean }) => !c.warmup);
    expect(measured).toHaveLength(12);
    expect(
        measured
            .slice(4, 8)
            .map((c: { version: string; concurrency: number }) => [
                c.version,
                c.concurrency,
            ]),
    ).toEqual(
        measured
            .slice(0, 4)
            .map((c: { version: string; concurrency: number }) => [
                c.version,
                c.concurrency,
            ])
            .reverse(),
    );
});

test("paid preparation lots cannot silently exceed their existing attempt envelope", () => {
    expect(() =>
        buildPreparationStudyConditions({
            phase: "reading",
            plans: ["source_actions_v3"],
            concurrencies: [2, 4],
            repetitions: 2,
            warmups: 0,
        }),
    ).toThrow("Split paid conditions into separate approved lots");
    expect(
        buildPreparationStudyConditions({
            phase: "reading",
            plans: ["source_actions_v3"],
            concurrencies: [4, 2],
            repetitions: 1,
            warmups: 0,
        }).map((c: { concurrency: number }) => c.concurrency),
    ).toEqual([4, 2]);
});

test("comparison lots count only sources that can dispatch model work", () => {
    const conditions = buildPreparationStudyConditions({
        phase: "comparison",
        plans: ["source_actions_v3"],
        concurrencies: [2, 4],
        repetitions: 2,
        warmups: 0,
        modelSourceCount: 7,
    });
    expect(conditions).toHaveLength(4);
});

test.each([
    "--prepare",
    "--offline",
    "--live",
])("retired study mode %s refuses before network or output", async (mode) => {
    const dir = await mkdtemp(join(tmpdir(), "retired-preparation-study-"));
    const fetch = vi.fn(() => {
        throw new Error("Unexpected network dispatch");
    });
    vi.stubGlobal("fetch", fetch);
    try {
        await expect(runPreparationStudy([mode, "--out", dir])).rejects.toThrow(
            "Preparation study execution has been retired",
        );
        expect(fetch).not.toHaveBeenCalled();
        expect(await readdir(dir)).toEqual([]);
    } finally {
        vi.unstubAllGlobals();
        await rm(dir, { recursive: true, force: true });
    }
});
