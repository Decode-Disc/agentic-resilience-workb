import { expect, test } from "vitest";
import { dossierStatus } from "@/lib/presentation/research-copy";
import { sourcesPhasePresentation } from "@/lib/presentation/sources";

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
    ).toEqual({ label: "Complete", tone: "success" });
});

test("a ready dossier reads as ready in the success tone on every surface", () => {
    expect(
        dossierStatus({
            ...base,
            executionStatus: "idle",
            pauseReason: undefined,
        }),
    ).toEqual({ label: "Ready", tone: "success" });
});

test.each([
    ["completed", "Sources prepared"],
    ["completed_with_limits", "Sources with limits"],
    ["ended_without_material", "No usable material"],
] as const)("settled Sources phase %s keeps its meaning in the dossier badge", (sourcesPhase, label) => {
    const run = {
        lifecycleState: "sources_prepared" as const,
        executionStatus: "idle" as const,
        sourcesPhase,
    };
    expect(dossierStatus(run).label).toBe(label);
});

test.each([
    ["completed", "success", "check"],
    ["completed_with_limits", "review", "check"],
    ["ended_without_material", "dashed", "barred"],
] as const)("the dossier badge and the Sources stage share one tone for %s", (sourcesPhase, tone, mark) => {
    const run = {
        lifecycleState: "sources_prepared" as const,
        executionStatus: "idle" as const,
        sourcesPhase,
    };
    expect(dossierStatus(run).tone).toBe(tone);
    const stage = sourcesPhasePresentation(sourcesPhase);
    expect(stage.tone === "muted" ? "dashed" : stage.tone).toBe(tone);
    expect(stage.mark).toBe(mark);
});
