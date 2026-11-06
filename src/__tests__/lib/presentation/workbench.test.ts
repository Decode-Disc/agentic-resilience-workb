import { expect, test } from "vitest";
import {
    sourceMissionPresentation,
    sourceMissionState,
} from "@/lib/presentation/workbench";

test.each([
    "partial",
    "blocked",
] as const)("Sources %s handoff remains visibly unfinished", (status) => {
    expect(
        sourceMissionState(
            { lifecycleState: "sources_prepared", executionStatus: "idle" },
            { status },
        ),
    ).toBe("interrupted");
});

test("a running analytical stage does not make Sources appear to be running", () => {
    expect(
        sourceMissionState(
            {
                lifecycleState: "extracting_evidence",
                executionStatus: "running",
            },
            null,
        ),
    ).toBe("completed");
});
test("a failure after documentary preparation does not rewrite the Sources mission as interrupted", () => {
    expect(
        sourceMissionState(
            {
                lifecycleState: "extracting_evidence",
                executionStatus: "failed",
            },
            null,
        ),
    ).toBe("completed");
});
test("a research pause during documentary preparation is visible independently of Workbench", () => {
    expect(
        sourceMissionState(
            {
                lifecycleState: "discovering_sources",
                executionStatus: "paused",
                pauseReason: "analyst",
            },
            null,
        ),
    ).toBe("paused");
});

test.each([
    "partial",
    "blocked",
] as const)("completed Sources with %s material remains completed", (status) => {
    expect(
        sourceMissionState(
            { lifecycleState: "sources_prepared", executionStatus: "idle" },
            { status, missionStatus: "completed" },
        ),
    ).toBe("completed");
});

test("a later interruption does not rewrite a completed Sources mission", () => {
    expect(
        sourceMissionState(
            {
                lifecycleState: "extracting_evidence",
                executionStatus: "failed",
                pauseReason: "execution_interrupted",
            },
            { status: "partial", missionStatus: "completed" },
        ),
    ).toBe("completed");
});

test("an interrupted Sources mission retains its distinct state despite usable partial material", () => {
    expect(
        sourceMissionState(
            { lifecycleState: "sources_prepared", executionStatus: "idle" },
            { status: "partial", missionStatus: "blocked" },
        ),
    ).toBe("interrupted");
});

test.each([
    "completed",
    "blocked",
] as const)("%s partial preparation explains material limits and unavailable Investigation", (missionStatus) => {
    const copy = sourceMissionPresentation(
        { lifecycleState: "sources_prepared", executionStatus: "idle" },
        { status: "partial", missionStatus },
    );
    expect(copy.title).toBe(
        missionStatus === "completed"
            ? "Documentary preparation completed with limits"
            : "Documentary preparation interrupted",
    );
    expect(copy.detail).toContain("Retained material");
    expect(copy.detail).toContain("unfinished");
    expect(copy.detail).toContain("Investigation is not available yet");
    expect(copy.detail).not.toMatch(
        /sources_prepared|investigation_unavailable|initial_fixture|Start research/,
    );
});

test("a full conversation journal explains preservation without inviting a futile new request", async () => {
    const { workbenchFailureCopy } = await import(
        "@/lib/presentation/workbench"
    );
    const copy = workbenchFailureCopy("pi_storage_capacity");
    expect(copy).toContain("conversation");
    expect(copy).toContain("remain available");
    expect(copy).not.toMatch(/send.*message|narrower request/i);
    expect(copy).not.toContain("pi_storage_capacity");
});

test("an unresolved conversation closure explains the retained work without promising another send can recover it", async () => {
    const { workbenchFailureCopy } = await import(
        "@/lib/presentation/workbench"
    );
    const copy = workbenchFailureCopy("native_settlement_incomplete");
    expect(copy).toContain("requires recovery");
    expect(copy).toContain("recorded work remain available");
    expect(copy).not.toMatch(
        /native_settlement|Send another message|writer|session/,
    );
});
