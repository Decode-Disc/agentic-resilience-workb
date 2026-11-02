import { expect, test } from "vitest";
import { sourceMissionState } from "@/lib/presentation/workbench";

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
