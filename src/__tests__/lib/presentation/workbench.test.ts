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
