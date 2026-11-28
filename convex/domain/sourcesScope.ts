import { v } from "convex/values";
export const SOURCES_PROTOCOL = "sources_mission_v1";
export const sourcesScopeValidator = v.object({
    kind: v.literal("sources_v1"),
    preparationId: v.id("sourceSelectionProposalRebuilds"),
});
export const sourcesStateValidator = v.object({
    kind: v.literal("sources_v1"),
});
