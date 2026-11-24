import { expect, test } from "vitest";
import {
    checkpointDecisionLabel,
    checkpointLabel,
    dossierStatus,
    eventLabel,
} from "@/lib/presentation/research-copy";

test("recoverable research interruption is not labelled as an analyst review prerequisite", () => {
    expect(
        dossierStatus({
            lifecycleState: "discovering_sources",
            executionStatus: "paused",
            pauseReason: "execution_interrupted",
            completionOutcome: undefined,
        }),
    ).toEqual({ label: "Interrupted", tone: "dashed" });
});

test.each([
    ["source_preparation_progress", "Sources checked"],
    ["source_preparation_completed", "Source checks finished"],
] as const)("translates %s without exposing workflow or provider details", (event, expected) => {
    const label = eventLabel(event);
    expect(label).toBe(expected);
    expect(label).not.toMatch(
        /source_preparation|sourcePreparation|OPENROUTER|generation|model/i,
    );
});

test("names human review checkpoints and their decisions without raw keys", () => {
    expect(checkpointLabel("source_review")).toBe("Source review");
    expect(checkpointLabel("evidence_sufficiency_review")).toBe(
        "Evidence coverage review",
    );
    expect(checkpointLabel("assessment_review")).toBe("Assessment review");
    expect(checkpointDecisionLabel("approved")).toBe("Approved");
    expect(checkpointDecisionLabel("recheck")).toBe("Recheck requested");
    expect(checkpointDecisionLabel("force_continue")).toBe(
        "Continued despite missing evidence",
    );
    expect(checkpointDecisionLabel("complete_insufficient")).toBe(
        "Closed as insufficient",
    );
    for (const decision of [
        "approved",
        "recheck",
        "force_continue",
        "complete_insufficient",
    ] as const) {
        expect(checkpointDecisionLabel(decision)).not.toMatch(/_/);
    }
});
