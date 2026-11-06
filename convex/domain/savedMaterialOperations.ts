import { operationResultValidator } from "@convex/execution/operationResults";
import { type Infer, v } from "convex/values";
import { sourceMaterialReferenceValidator } from "./sourceRetrievalPolicy";
import { documentaryStatusValidator } from "./sourcesContracts";

export const SAVED_MATERIAL_DEFINITION_ID = "saved_material_inspection_v1";
export const SAVED_MATERIAL_DEFINITION_VERSION = 2;
export const savedMaterialDefinitionId = v.literal(
    SAVED_MATERIAL_DEFINITION_ID,
);
export const savedMaterialDefinitionVersion = v.literal(
    SAVED_MATERIAL_DEFINITION_VERSION,
);
export const savedMaterialCompletionValidator = v.object({
    kind: v.literal("complete"),
    captureIds: v.array(sourceMaterialReferenceValidator.fields.captureId),
    workingNotes: v.optional(v.string()),
});
export const savedMaterialMissionFields = {
    inspectedCaptureIds: v.array(
        sourceMaterialReferenceValidator.fields.captureId,
    ),
};

export const searchAvailableMaterialInputValidator = v.object({
    sourceId: sourceMaterialReferenceValidator.fields.sourceId,
    query: v.string(),
});

export const readInContextInputValidator = v.object({
    sourceId: sourceMaterialReferenceValidator.fields.sourceId,
    passageOrder: v.number(),
});

export const savedMaterialOperationValidator = v.union(
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

export const savedMaterialScopeValidator = v.object({
    kind: v.literal("saved_material_inspection_v1"),
    corpusRevisionId: v.id("corpusRevisions"),
});
export const savedMaterialStateValidator = v.object({
    kind: v.literal("saved_material_inspection_v1"),
    inspectedCaptureIds: v.array(
        sourceMaterialReferenceValidator.fields.captureId,
    ),
});
export const savedMaterialResultValidator = v.object({
    kind: v.literal("saved_material_inspection_v1"),
    captureIds: v.array(sourceMaterialReferenceValidator.fields.captureId),
});

export const savedMaterialOperationSuccessValidator = v.object({
    kind: v.literal("success"),
    valueJson: v.string(),
    captureId: v.optional(sourceMaterialReferenceValidator.fields.captureId),
    progressKey: v.optional(v.string()),
    progressKeys: v.optional(v.array(v.string())),
});

export const savedMaterialPinValidator = v.object({
    kind: v.literal(SAVED_MATERIAL_DEFINITION_ID),
    expectedCaptureId: v.optional(
        sourceMaterialReferenceValidator.fields.captureId,
    ),
    expectedContentHash: v.optional(v.string()),
});
export const savedMaterialSchemas = {
    id: savedMaterialDefinitionId,
    scope: savedMaterialScopeValidator,
    state: savedMaterialStateValidator,
    result: savedMaterialResultValidator,
    completion: savedMaterialCompletionValidator,
    operation: savedMaterialOperationValidator,
    pin: savedMaterialPinValidator,
    success: savedMaterialOperationSuccessValidator,
};

const materialFields = {
    ...sourceMaterialReferenceValidator.fields,
    documentaryStatus: v.optional(documentaryStatusValidator),
};
export const searchAvailableMaterialResult = operationResultValidator(
    v.object({
        ...materialFields,
        kind: v.literal("search_available_material"),
        canonicalUrl: v.string(),
        retrievedAt: v.number(),
        passages: v.array(
            v.object({
                passageOrder: v.number(),
                exactQuote: v.string(),
                headingPath: v.array(v.string()),
            }),
        ),
        omittedPassageCount: v.number(),
        limitReached: v.boolean(),
    }),
);
export const readInContextResult = operationResultValidator(
    v.object({
        ...materialFields,
        kind: v.literal("read_in_context"),
        passage: v.object({
            passageOrder: v.number(),
            startOffset: v.number(),
            endOffset: v.number(),
            exactQuote: v.string(),
            quotationHash: v.string(),
            headingPath: v.array(v.string()),
            surroundingText: v.string(),
        }),
    }),
);
