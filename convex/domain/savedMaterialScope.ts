import { v } from "convex/values";
export const SAVED_MATERIAL_DEFINITION_ID = "saved_material_inspection_v1";
export const SAVED_MATERIAL_DEFINITION_VERSION = 2;
export const WORKBENCH_DOCUMENTARY_DEFINITION_VERSION = 10;
export const REFERENCED_INSPECTION_VERSION = 3;
export const NATIVE_COMPLETION_INSPECTION_VERSION = 4;
export const SCOPED_DOCUMENTARY_INSPECTION_VERSION = 5;
export const REFERENCED_SOURCES_VERSION = 7;
export const NATIVE_COMPLETION_SOURCES_VERSION = 8;
export const SCOPED_DOCUMENTARY_SOURCES_VERSION = 9;
export const savedMaterialScopeValidator = v.object({
    kind: v.literal("saved_material_inspection_v1"),
    corpusRevisionId: v.id("corpusRevisions"),
});
export const savedMaterialStateValidator = v.object({
    kind: v.literal("saved_material_inspection_v1"),
    inspectedCaptureIds: v.array(v.id("sourceCaptures")),
});
