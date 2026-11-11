import {
    modelCallSettings,
    preparationModelOutputLimit,
} from "@convex/integrations/modelRouting";
import { expect, test } from "vitest";

const route = {
    model: "fixture/prepared-capacity",
    descriptor: {
        contextWindow: 200000,
        maxTokens: 50000,
        reasoning: false,
        inputPrice: 0.01,
        outputPrice: 0.02,
        cacheReadPrice: 0,
        structuredOutputs: true,
    },
};

test("prepared generation capacity is not replaced by the former one-shot output ceiling", () => {
    expect(modelCallSettings(route).generation.maxOutputTokens).toBe(50000);
    expect(preparationModelOutputLimit(route)).toBe(50000);
});

test("serialization without model capabilities does not invent a live output allowance", () => {
    expect(
        modelCallSettings({ model: "fixture/unprepared" }).generation
            .maxOutputTokens,
    ).toBeUndefined();
    expect(() =>
        preparationModelOutputLimit({ model: "fixture/unprepared" }),
    ).toThrow("invalid_model_output_limit");
});
