import { z } from "zod";
export const agentSkillBindingSchema = z
    .object({
        packageId: z.string(),
        skillName: z.enum(["workbench-framing", "source-preparation"]),
        catalogue: z.literal(false).optional(),
    })
    .strict();
export type AgentSkillBinding = z.infer<typeof agentSkillBindingSchema>;
export const skillReadResult = z
    .object({
        packageId: z.string(),
        path: z.string(),
        resourceHash: z.string(),
        text: z.string(),
    })
    .strict();
