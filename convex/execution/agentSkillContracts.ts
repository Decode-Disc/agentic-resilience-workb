import { v } from "convex/values";
import type { AgentSkillBinding } from "./agentSkillResults";

export type { AgentSkillBinding } from "./agentSkillResults";
export const sourcesDocumentaryMethod = {
    packageId: "research-methods-v2",
    skillName: "source-preparation",
} as const satisfies AgentSkillBinding;
export const skillReadInput = v.object({
    path: v.string(),
    offset: v.optional(v.number()),
    limit: v.optional(v.number()),
});
export const skillReadOperationInput = v.object({
    kind: v.literal("read"),
    ...skillReadInput.fields,
});
export const skillReadPin = v.object({
    kind: v.literal("agent_skill"),
    packageId: v.string(),
    packageHash: v.string(),
    path: v.string(),
    resourceHash: v.string(),
});
