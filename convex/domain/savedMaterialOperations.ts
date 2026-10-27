import { type Infer, v } from "convex/values";

export const SAVED_MATERIAL_DEFINITION_ID = "saved_material_inspection_v1";
export const SAVED_MATERIAL_DEFINITION_VERSION = 1;
export const savedMaterialDefinitionId = v.literal(
    SAVED_MATERIAL_DEFINITION_ID,
);
export const savedMaterialDefinitionVersion = v.literal(
    SAVED_MATERIAL_DEFINITION_VERSION,
);
export const savedMaterialCompletionValidator = v.object({
    kind: v.literal("complete"),
    captureIds: v.array(v.id("sourceCaptures")),
    workingNotes: v.optional(v.string()),
});
export const savedMaterialMissionFields = {
    inspectedCaptureIds: v.array(v.id("sourceCaptures")),
};

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
