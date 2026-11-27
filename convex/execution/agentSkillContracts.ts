import { v } from "convex/values";
import { z } from "zod";
export const agentSkillBindingSchema = z
    .object({
        packageId: z.string(),
        skillName: z.enum(["workbench-framing", "source-preparation"]),
        catalogue: z.literal(false).optional(),
    })
    .strict();
export type AgentSkillBinding = z.infer<typeof agentSkillBindingSchema>;
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
export const skillReadResult = z
    .object({
        packageId: z.string(),
        path: z.string(),
        resourceHash: z.string(),
        text: z.string(),
    })
    .strict();
