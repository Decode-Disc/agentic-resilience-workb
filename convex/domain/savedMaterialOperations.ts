import { type Infer, v } from "convex/values";

export const consultMissionStateInputValidator = v.object({
    cursor: v.optional(v.string()),
});

export const searchAvailableMaterialInputValidator = v.object({
    sourceId: v.id("sources"),
    query: v.string(),
});

export const readInContextInputValidator = v.object({
    sourceId: v.id("sources"),
    passageOrder: v.number(),
});

export const savedMaterialOperationValidator = v.union(
    v.object({
        kind: v.literal("consult_mission_state"),
        ...consultMissionStateInputValidator.fields,
    }),
    v.object({
        kind: v.literal("search_available_material"),
        ...searchAvailableMaterialInputValidator.fields,
    }),
    v.object({
        kind: v.literal("read_in_context"),
        ...readInContextInputValidator.fields,
    }),
);

export type SavedMaterialOperation = Infer<
    typeof savedMaterialOperationValidator
>;
