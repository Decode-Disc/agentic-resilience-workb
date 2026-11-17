import type { reasoningEffort } from "@convex/modelConfigurationSchema";
import type { Infer } from "convex/values";

export type ReasoningEffort = Infer<typeof reasoningEffort>;

const effortLabels: Record<ReasoningEffort, string> = {
    none: "Off",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra",
    max: "Max",
};

/** Readable reasoning-effort names shared by the analyst model picker and model administration. */
export function reasoningEffortLabel(effort: ReasoningEffort) {
    return effortLabels[effort];
}
