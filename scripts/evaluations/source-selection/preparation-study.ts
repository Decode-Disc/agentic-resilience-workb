import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Infer } from "convex/values";
import type { sourcePreparationExecutionPlanValidator } from "../../../convex/domain/sourcePreparationAuthority.ts";
import type { PreparationStudyEnvelope } from "../../../convex/sourcePreparationStudyPolicy.ts";

type PreparationExecutionPlan = Infer<
    typeof sourcePreparationExecutionPlanValidator
>;

type StudyCondition = {
    phase: PreparationStudyEnvelope["conditions"][number]["phase"];
    concurrency: number;
    version?: PreparationExecutionPlan;
    warmup?: boolean;
    repetition?: number;
};

/** Freezes the order before any dispatch; paid repetitions require separately approved lots. */
export function buildPreparationStudyConditions(input: {
    phase: PreparationStudyEnvelope["conditions"][number]["phase"];
    plans: Array<PreparationExecutionPlan>;
    concurrencies: number[];
    repetitions: number;
    warmups: number;
    modelSourceCount?: number;
}): StudyCondition[] {
    assert(
        input.plans.length && input.concurrencies.length,
        "Study conditions are empty",
    );
    assert(
        input.plans.every((p) =>
            [
                "collect_then_compare_v1",
                "inline_controls_v2",
                "source_actions_v3",
            ].includes(p),
        ),
        "Unknown execution plan",
    );
    assert(
        input.concurrencies.every((c) => Number.isSafeInteger(c) && c > 0),
        "Invalid study concurrency",
    );
    assert(
        Number.isSafeInteger(input.repetitions) &&
            input.repetitions > 0 &&
            Number.isSafeInteger(input.warmups) &&
            input.warmups >= 0,
        "Invalid study repetitions",
    );
    const base = input.plans.flatMap((version) =>
        input.concurrencies.map((concurrency) => ({
            phase: input.phase,
            version,
            concurrency,
        })),
    );
    assert(
        base.length * (input.repetitions + input.warmups) <= 64,
        "Study condition limit exceeded",
    );
    const modelSourceCount = input.modelSourceCount ?? 24;
    assert(
        Number.isSafeInteger(modelSourceCount) &&
            modelSourceCount >= 0 &&
            modelSourceCount <= 24 &&
            (input.phase !== "reading" || modelSourceCount === 24),
        "Invalid model source count",
    );
    if (input.phase !== "replay") {
        assert(input.warmups === 0, "Paid warmups are not permitted");
        assert(
            base.length * input.repetitions * modelSourceCount * 2 <= 128,
            "Split paid conditions into separate approved lots",
        );
    }
    return [
        ...Array.from({ length: input.warmups }, (_, repetition) =>
            base.map((c) => ({ ...c, warmup: true, repetition })),
        ).flat(),
        ...Array.from({ length: input.repetitions }, (_, repetition) =>
            (repetition % 2 ? [...base].reverse() : base).map((c) => ({
                ...c,
                warmup: false,
                repetition,
            })),
        ).flat(),
    ];
}

/** Retained study artifacts are available for analysis after workflow execution has been retired. */
export async function runPreparationStudy(_argv: string[]): Promise<never> {
    throw new Error("Preparation study execution has been retired");
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
    await runPreparationStudy(process.argv.slice(2));
