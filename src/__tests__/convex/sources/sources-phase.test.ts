import { sourcesPreparationPhase } from "@convex/domain/sources";
import { expect, test } from "vitest";

const documentary = {
    lifecycleState: "discovering_sources",
    executionStatus: "running",
} as const;

test.each([
    [{ ...documentary }, null, null, "collecting"],
    [
        { ...documentary, executionStatus: "paused", pauseReason: "analyst" },
        null,
        null,
        "paused",
    ],
    [
        {
            ...documentary,
            executionStatus: "paused",
            pauseReason: "sources_time_limit",
        },
        { status: "started" },
        { status: "blocked", blockCode: "execution_time_limit" },
        "time_limit",
    ],
    [
        {
            ...documentary,
            executionStatus: "paused",
            pauseReason: "execution_interrupted",
        },
        { status: "started" },
        { status: "blocked", blockCode: "execution_interrupted" },
        "interrupted",
    ],
    [
        { ...documentary, executionStatus: "failed" },
        { status: "started" },
        { status: "blocked", blockCode: "operation_outcome_unknown" },
        "failed",
    ],
    [
        { lifecycleState: "sources_prepared", executionStatus: "idle" },
        { status: "partial" },
        { status: "blocked", blockCode: "execution_deadline" },
        "completed_with_limits",
    ],
    [
        { lifecycleState: "sources_prepared", executionStatus: "idle" },
        { status: "complete" },
        { status: "completed" },
        "completed",
    ],
    [
        { lifecycleState: "extracting_evidence", executionStatus: "failed" },
        null,
        null,
        "completed",
    ],
    [
        {
            lifecycleState: "extracting_evidence",
            executionStatus: "failed",
            pauseReason: "execution_interrupted",
        },
        { status: "partial" },
        { status: "completed" },
        "completed_with_limits",
    ],
    [
        {
            ...documentary,
            executionStatus: "idle",
            completionOutcome: "insufficient_public_evidence",
        },
        null,
        null,
        "insufficient_evidence",
    ],
] as const)("Sources phase case %#", (run, preparation, mission, phase) => {
    expect(sourcesPreparationPhase(run, preparation, mission)).toBe(phase);
});

test("a handover that keeps no document ends without material", () => {
    expect(
        sourcesPreparationPhase(
            { lifecycleState: "sources_prepared", executionStatus: "idle" },
            { status: "blocked" },
            null,
        ),
    ).toBe("ended_without_material");
    expect(
        sourcesPreparationPhase(
            { lifecycleState: "sources_prepared", executionStatus: "idle" },
            { status: "partial" },
            null,
        ),
    ).toBe("completed_with_limits");
    expect(
        sourcesPreparationPhase(
            {
                lifecycleState: "awaiting_source_review",
                executionStatus: "paused",
            },
            { status: "blocked" },
            null,
        ),
    ).toBe("ended_without_material");
});
