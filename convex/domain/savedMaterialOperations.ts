import {
    NATIVE_COMPLETION_INSPECTION_VERSION,
    NATIVE_COMPLETION_SOURCES_VERSION,
    REFERENCED_INSPECTION_VERSION,
    REFERENCED_SOURCES_VERSION,
    SAVED_MATERIAL_DEFINITION_ID,
    SCOPED_DOCUMENTARY_INSPECTION_VERSION,
    SCOPED_DOCUMENTARY_SOURCES_VERSION,
    savedMaterialScopeValidator,
    savedMaterialStateValidator,
    WORKBENCH_DOCUMENTARY_DEFINITION_VERSION,
} from "./savedMaterialScope";

export {
    NATIVE_COMPLETION_INSPECTION_VERSION,
    NATIVE_COMPLETION_SOURCES_VERSION,
    REFERENCED_INSPECTION_VERSION,
    REFERENCED_SOURCES_VERSION,
    SAVED_MATERIAL_DEFINITION_ID,
    SAVED_MATERIAL_DEFINITION_VERSION,
    SCOPED_DOCUMENTARY_INSPECTION_VERSION,
    SCOPED_DOCUMENTARY_SOURCES_VERSION,
    savedMaterialScopeValidator,
    savedMaterialStateValidator,
    WORKBENCH_DOCUMENTARY_DEFINITION_VERSION,
} from "./savedMaterialScope";

import { type Infer, v } from "convex/values";
import { validate } from "convex-helpers/validators";
import {
    WORKBENCH_FRAMING_METHOD_VERSION,
    WORKBENCH_FRAMING_RECEIPT_VERSION,
    WORKBENCH_SCOPED_DOCUMENTARY_VERSION,
} from "./framingContracts";
import {
    sourceDocumentMetadataValidator,
    sourceMaterialReferenceValidator,
} from "./sourceRetrievalPolicy";
import { documentaryStatusValidator } from "./sourcesContracts";

export const savedMaterialDefinitionId = v.literal(
    SAVED_MATERIAL_DEFINITION_ID,
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
    continuation: v.optional(v.string()),
});

export const readInContextInputValidator = v.object({
    sourceId: sourceMaterialReferenceValidator.fields.sourceId,
    passageOrder: v.number(),
    continuation: v.optional(v.string()),
    range: v.optional(
        v.object({ startOffset: v.number(), endOffset: v.number() }),
    ),
});

export const acquireDocumentInput = v.object({ reference: v.string() });
export const referencedSearchInput = v.object({
    reference: v.string(),
    query: v.string(),
    continuation: v.optional(v.string()),
});
export const referencedReadInput = v.object({ reference: v.string() });
export const documentaryRange = v.object({
    startOffset: v.number(),
    endOffset: v.number(),
});

export const documentaryCause = v.object({
    messageId: v.id("agentMessageDeliveries"),
    instructionVersion: v.number(),
});

const documentaryReferenceValidator = v.union(
    v.object({
        version: v.literal(2),
        issuer: v.literal("operation"),
        operationId: v.id("agentOperationRequests"),
        item: v.literal("candidate"),
        index: v.number(),
    }),
    v.object({
        version: v.literal(2),
        issuer: v.literal("operation"),
        operationId: v.id("agentOperationRequests"),
        item: v.literal("document"),
    }),
    v.object({
        version: v.literal(2),
        issuer: v.literal("operation"),
        operationId: v.id("agentOperationRequests"),
        item: v.literal("passage"),
        index: v.number(),
    }),
    v.object({
        version: v.literal(2),
        issuer: v.literal("operation"),
        operationId: v.id("agentOperationRequests"),
        item: v.literal("next"),
    }),
    v.object({
        version: v.literal(2),
        issuer: v.literal("operation"),
        operationId: v.id("agentOperationRequests"),
        item: v.literal("destination"),
        index: v.number(),
    }),
    v.object({
        version: v.literal(2),
        issuer: v.literal("capture_refresh"),
        captureId: v.id("sourceCaptures"),
        conversationCause: v.optional(documentaryCause),
    }),
    v.object({
        version: v.literal(2),
        issuer: v.literal("source"),
        sourceId: v.id("sources"),
    }),
    v.object({
        version: v.literal(2),
        issuer: v.literal("capture"),
        captureId: v.id("sourceCaptures"),
        conversationCause: v.optional(documentaryCause),
    }),
    v.object({
        version: v.literal(2),
        issuer: v.literal("retained_document"),
        rootOperationId: v.id("agentOperationRequests"),
        conversationCause: v.optional(documentaryCause),
    }),
    v.object({
        version: v.literal(2),
        issuer: v.literal("analyst_url"),
        messageId: v.id("agentMessageDeliveries"),
        url: v.string(),
    }),
);

type WithoutReferenceVersion<R> = R extends { version: 2 }
    ? Omit<R, "version">
    : never;

export function documentaryReference(
    reference: WithoutReferenceVersion<
        Infer<typeof documentaryReferenceValidator>
    >,
) {
    return JSON.stringify({ ...reference, version: 2 });
}

export function parseDocumentaryReference(token: string) {
    let reference: unknown;
    try {
        reference = JSON.parse(token);
    } catch {
        return undefined;
    }
    return validate(documentaryReferenceValidator, reference)
        ? reference
        : undefined;
}

/** Finds tokens in the exact JSON form emitted by documentaryReference, even inside a sentence. */
export function containsDocumentaryReference(text: string): boolean {
    const candidates = text.matchAll(
        /\{"issuer":(?:[^{}"]|"(?:[^"\\]|\\.)*"|\{(?:[^{}"]|"(?:[^"\\]|\\.)*")*\})*\}/gu,
    );
    for (const [token] of candidates)
        if (parseDocumentaryReference(token)) return true;
    return false;
}

export const documentaryPin = v.object({
    kind: v.literal("documentary_v1"),
    scope: v.union(
        v.object({
            kind: v.literal("framing"),
            cause: documentaryCause,
            revisionId: v.id("framingRevisions"),
        }),
        v.object({
            kind: v.literal("workbench_read"),
            cause: documentaryCause,
            corpusRevisionId: v.id("corpusRevisions"),
            preparationId: v.optional(v.id("sourceSelectionProposalRebuilds")),
        }),
        v.object({
            kind: v.literal("sources"),
            preparationId: v.id("sourceSelectionProposalRebuilds"),
            needsRevision: v.number(),
        }),
        v.object({
            kind: v.literal("inspection"),
            corpusRevisionId: v.id("corpusRevisions"),
        }),
    ),
    target: v.union(
        v.object({
            kind: v.literal("acquisition"),
            canonicalUrl: v.string(),
            requestInputHash: v.string(),
        }),
        sourceMaterialReferenceValidator.extend({ kind: v.literal("capture") }),
        v.object({
            kind: v.literal("retained_document"),
            rootOperationId: v.id("agentOperationRequests"),
            canonicalUrl: v.string(),
            contentHash: v.string(),
        }),
    ),
});

export const captureRepresentationCompleteness = v.union(
    v.literal("complete"),
    v.literal("partial"),
    v.literal("unknown"),
);

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

export const acquireDocumentRequest = v.object({
    kind: v.literal("acquire_document"),
    ...acquireDocumentInput.fields,
});

export type SavedMaterialOperation = Infer<
    typeof savedMaterialOperationValidator
>;

export const referencedSavedMaterialOperation = v.union(
    referencedSearchInput.extend({
        kind: v.literal("search_available_material"),
    }),
    referencedReadInput.extend({ kind: v.literal("read_in_context") }),
);
export type ReferencedSavedMaterialOperation = Infer<
    typeof referencedSavedMaterialOperation
>;

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
    operation: v.union(
        savedMaterialOperationValidator,
        referencedSavedMaterialOperation,
        acquireDocumentRequest,
    ),
    pin: v.union(savedMaterialPinValidator, documentaryPin),
    success: savedMaterialOperationSuccessValidator,
};

export const materialFields = {
    ...sourceMaterialReferenceValidator.fields,
    document: v.optional(sourceDocumentMetadataValidator),
    documentaryStatus: v.optional(documentaryStatusValidator),
};
export type SavedMaterialBinding = "legacy" | "referenced";

/** Selects the documentary contract for a pinned agent definition. */
export function savedMaterialBinding(
    definitionId: string,
    version: number | undefined,
): SavedMaterialBinding {
    if (
        (definitionId === "workbench_v1" &&
            (version === WORKBENCH_DOCUMENTARY_DEFINITION_VERSION ||
                version === WORKBENCH_FRAMING_RECEIPT_VERSION ||
                version === WORKBENCH_FRAMING_METHOD_VERSION ||
                version === WORKBENCH_SCOPED_DOCUMENTARY_VERSION)) ||
        (definitionId === "sources_v1" &&
            (version === REFERENCED_SOURCES_VERSION ||
                version === NATIVE_COMPLETION_SOURCES_VERSION ||
                version === SCOPED_DOCUMENTARY_SOURCES_VERSION)) ||
        (definitionId === SAVED_MATERIAL_DEFINITION_ID &&
            (version === REFERENCED_INSPECTION_VERSION ||
                version === NATIVE_COMPLETION_INSPECTION_VERSION ||
                version === SCOPED_DOCUMENTARY_INSPECTION_VERSION))
    )
        return "referenced";
    return "legacy";
}

export function supportsScopedDocumentaryExamination(
    definitionId: string,
    version: number,
) {
    return (
        (definitionId === "workbench_v1" &&
            version === WORKBENCH_SCOPED_DOCUMENTARY_VERSION) ||
        (definitionId === "sources_v1" &&
            version === SCOPED_DOCUMENTARY_SOURCES_VERSION) ||
        (definitionId === SAVED_MATERIAL_DEFINITION_ID &&
            version === SCOPED_DOCUMENTARY_INSPECTION_VERSION)
    );
}
