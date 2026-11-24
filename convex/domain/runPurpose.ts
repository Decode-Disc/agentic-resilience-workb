import { type Infer, v } from "convex/values";

export const runPurposeValidator = v.union(
    v.literal("research"),
    v.literal("evaluation"),
    v.literal("browser_test"),
);
export type RunPurpose = Infer<typeof runPurposeValidator>;
