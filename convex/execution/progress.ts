import { MAX_PROGRESS_FACTS } from "@convex/resourcePolicy";
import { v } from "convex/values";
import { agentStateValidator } from "./agentSchemas";

export const agentProgressValidator = v.object({
    state: v.optional(agentStateValidator),
    facts: v.optional(v.array(v.string())),
    obligations: v.optional(v.array(v.string())),
    blockCode: v.optional(v.string()),
});

/** Deduplicate verified facts atomically, preserving the entire prior set on capacity failure. */
export function adoptProgress(
    current: readonly string[],
    incoming: readonly string[],
):
    | { kind: "ready"; keys: string[]; added: number }
    | { kind: "blocked"; code: "context_capacity" } {
    const keys = [...new Set([...current, ...incoming])];
    return keys.length > MAX_PROGRESS_FACTS
        ? { kind: "blocked", code: "context_capacity" }
        : { kind: "ready", keys, added: keys.length - current.length };
}
