import { expect, test } from "vitest";
import { dossierStages, sourcesHandedOff } from "@/lib/presentation/sources";

const states = (phase: Parameters<typeof dossierStages>[0]) =>
    dossierStages(phase).map(({ key, state }) => [key, state]);

test("Sources stays the current stage until it hands off", () => {
    for (const phase of [
        "collecting",
        "waiting",
        "paused",
        "time_limit",
        "interrupted",
        "failed",
    ] as const) {
        expect(sourcesHandedOff(phase)).toBe(false);
        expect(states(phase)).toEqual([
            ["framing", "done"],
            ["sources", "current"],
            ["investigation", "unavailable"],
            ["synthesis", "unavailable"],
        ]);
    }
});

test("a handoff completes Sources without opening unavailable stages", () => {
    for (const phase of [
        "completed",
        "completed_with_limits",
        "ended_without_material",
        "insufficient_evidence",
    ] as const) {
        expect(sourcesHandedOff(phase)).toBe(true);
        expect(states(phase)).toEqual([
            ["framing", "done"],
            ["sources", "done"],
            ["investigation", "unavailable"],
            ["synthesis", "unavailable"],
        ]);
    }
});

test("stage labels reuse the workspace section names", () => {
    expect(dossierStages("collecting").map((stage) => stage.label)).toEqual([
        "Framing",
        "Sources",
        "Investigation",
        "Synthesis",
    ]);
});
