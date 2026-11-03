import { expect, test } from "vitest";
import { dossierStatus } from "@/lib/presentation/research-copy";
const base = {
    lifecycleState: "discovering_sources" as const,
    completionOutcome: undefined,
};
test("distinguishes analyst pause, required review and unavailable execution", () => {
    expect(
        dossierStatus({
            ...base,
            executionStatus: "paused",
            pauseReason: "analyst",
        }),
    ).toEqual({ label: "Paused", tone: "ink" });
    expect(
        dossierStatus({
            ...base,
            executionStatus: "paused",
            pauseReason: "source_review",
        }),
    ).toEqual({ label: "Review needed", tone: "review" });
    expect(
        dossierStatus({
            ...base,
            executionStatus: "paused",
            pauseReason: "claim_generation_unavailable",
        }),
    ).toEqual({ label: "Blocked", tone: "dashed" });
    expect(
        dossierStatus({
            ...base,
            executionStatus: "completed",
            pauseReason: undefined,
        }),
    ).toEqual({ label: "Complete", tone: "ink" });
});
