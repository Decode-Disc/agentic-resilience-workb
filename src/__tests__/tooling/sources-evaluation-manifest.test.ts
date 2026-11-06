import { readFileSync } from "node:fs";
import { sourcesBatterySchema } from "@evaluations/workbench-browser/protocol";
import { expect, test } from "vitest";

test("a Sources quality lot freezes recommended effort separately for each model role", () => {
    const previous = JSON.parse(
        readFileSync(
            "scripts/evaluations/workbench-browser/sources-cases.json",
            "utf8",
        ),
    );
    expect(sourcesBatterySchema.parse(previous)).toMatchObject({
        version: 2,
        reasoningEffort: "low",
    });
    const { reasoningEffort: _old, ...base } = previous;
    const current = {
        ...base,
        version: 3,
        modelRole: "quality",
        reasoningByRole: { workbench: "recommended", sources: "recommended" },
    };
    expect(sourcesBatterySchema.parse(current).reasoningByRole).toEqual(
        current.reasoningByRole,
    );
    expect(() =>
        sourcesBatterySchema.parse({
            ...current,
            reasoningByRole: { workbench: "low", sources: "recommended" },
        }),
    ).toThrow();
    expect(
        sourcesBatterySchema.parse({
            ...current,
            modelRole: "harness_stress",
            reasoningByRole: { workbench: "low", sources: "none" },
        }).reasoningByRole,
    ).toEqual({ workbench: "low", sources: "none" });
});
