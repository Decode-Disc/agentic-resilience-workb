import { v } from "convex/values";
export const workbenchScopeValidator = v.object({
    kind: v.literal("workbench_v1"),
});
export const workbenchStateValidator = v.object({
    kind: v.literal("workbench_v1"),
});
