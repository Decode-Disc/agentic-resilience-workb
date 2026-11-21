import { operationResultValidator } from "@convex/execution/operationResults";
import { type Infer, v } from "convex/values";
import { validate } from "convex-helpers/validators";
import {
    WORKBENCH_FRAMING_METHOD_VERSION,
    WORKBENCH_FRAMING_RECEIPT_VERSION,
} from "./framingContracts";
import {
    sourceDocumentMetadataValidator,
    sourceMaterialReferenceValidator,
} from "./sourceRetrievalPolicy";
import { documentaryStatusValidator } from "./sourcesContracts";

export const SAVED_MATERIAL_DEFINITION_ID = "saved_material_inspection_v1";
export const SAVED_MATERIAL_DEFINITION_VERSION = 2;
export const WORKBENCH_DOCUMENTARY_DEFINITION_VERSION = 10;
export const REFERENCED_INSPECTION_VERSION = 3;
export const REFERENCED_SOURCES_VERSION = 7;
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

export const acquireDocumentResult = operationResultValidator(
    v.object({
        kind: v.literal("acquire_document"),
        ...sourceMaterialReferenceValidator.fields,
        canonicalUrl: v.string(),
        document: sourceDocumentMetadataValidator,
        representationCompleteness: captureRepresentationCompleteness,
        retrievedAt: v.number(),
        indexStatus: v.union(v.literal("not_indexed"), v.literal("indexed")),
        readingReference: v.string(),
    }),
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
    operation: v.union(
        savedMaterialOperationValidator,
        referencedSavedMaterialOperation,
        acquireDocumentRequest,
    ),
    pin: v.union(savedMaterialPinValidator, documentaryPin),
    success: savedMaterialOperationSuccessValidator,
};

const materialFields = {
    ...sourceMaterialReferenceValidator.fields,
    document: v.optional(sourceDocumentMetadataValidator),
    documentaryStatus: v.optional(documentaryStatusValidator),
};
const legacySearchResult = v.object({
    ...materialFields,
    kind: v.literal("search_available_material"),
    canonicalUrl: v.string(),
    retrievedAt: v.union(v.number(), v.null()),
    passages: v.array(
        v.object({
            passageOrder: v.number(),
            exactQuote: v.string(),
            headingPath: v.array(v.string()),
        }),
    ),
    omittedPassageCount: v.number(),
    limitReached: v.boolean(),
    continuation: v.optional(v.union(v.string(), v.null())),
    responseOmittedPassageCount: v.optional(v.number()),
    captureOmittedPassageCount: v.optional(v.union(v.number(), v.null())),
});
const legacyContextResult = v.object({
    ...materialFields,
    kind: v.literal("read_in_context"),
    continuation: v.optional(v.union(v.string(), v.null())),
    captureOmittedPassageCount: v.optional(v.union(v.number(), v.null())),
    passage: v.object({
        passageOrder: v.number(),
        startOffset: v.number(),
        endOffset: v.number(),
        exactQuote: v.string(),
        quotationHash: v.string(),
        headingPath: v.array(v.string()),
        surroundingText: v.string(),
        contextStartOffset: v.optional(v.number()),
        contextEndOffset: v.optional(v.number()),
        contextRange: v.optional(
            v.object({ startOffset: v.number(), endOffset: v.number() }),
        ),
        captureCharacters: v.optional(v.number()),
    }),
});

const displayedMaterial = {
    ...sourceMaterialReferenceValidator.fields,
    document: sourceDocumentMetadataValidator,
    canonicalUrl: v.string(),
    representationCompleteness: captureRepresentationCompleteness,
    retrievedAt: v.union(v.number(), v.null()),
};

export const referencedSearchResult = v.object({
    ...displayedMaterial,
    kind: v.literal("search_available_material"),
    passages: v.array(
        v.object({
            reference: v.string(),
            passageOrder: v.number(),
            exactQuote: v.string(),
            range: documentaryRange,
            headingPath: v.array(v.string()),
        }),
    ),
    continuation: v.optional(v.string()),
    limitReached: v.boolean(),
});

export const referencedContextResult = v.object({
    ...displayedMaterial,
    kind: v.literal("read_in_context"),
    reference: v.string(),
    nextReference: v.optional(v.string()),
    readKind: v.union(v.literal("beginning"), v.literal("context")),
    range: documentaryRange,
    text: v.string(),
    captureCharacters: v.number(),
    observedDestinations: v.optional(
        v.array(
            v.object({
                urlPreview: v.string(),
                acquisitionReference: v.string(),
            }),
        ),
    ),
    indexedPassage: v.optional(
        v.object({
            passageOrder: v.number(),
            exactQuote: v.string(),
        }),
    ),
});

export const searchAvailableMaterialResult = operationResultValidator(
    v.union(referencedSearchResult, legacySearchResult),
);
export const readInContextResult = operationResultValidator(
    v.union(referencedContextResult, legacyContextResult),
);

const searchWire = {
    legacy: {
        inputValidator: searchAvailableMaterialInputValidator,
        resultValidator: operationResultValidator(legacySearchResult),
    },
    referenced: {
        description:
            "Search one saved document using an issued reference and a nonblank query. Returns exact displayed quotations, their references and indexed passage orders. Use a quotation's reference with read_in_context to open the match. Copy continuation with the same reference and query to see more matches. Empty results establish no documentary absence.",
        inputValidator: referencedSearchInput,
        resultValidator: operationResultValidator(referencedSearchResult),
    },
};
const contextWire = {
    legacy: {
        inputValidator: readInContextInputValidator,
        resultValidator: operationResultValidator(legacyContextResult),
    },
    referenced: {
        description:
            "Open an issued document, search-match or next reference. Returns the exact displayed text, character range, capture identity, recorded dates and representation completeness. Use the returned passage reference when citing displayed text, or nextReference to read further. When an indexed passage is returned, its order identifies the exact quote for documentary qualification.",
        inputValidator: referencedReadInput,
        resultValidator: operationResultValidator(referencedContextResult),
    },
};

type SavedMaterialBinding = "legacy" | "referenced";

/** Selects the documentary contract for a pinned agent definition. */
export function savedMaterialBinding(
    definitionId: string,
    version: number | undefined,
): SavedMaterialBinding {
    if (
        (definitionId === "workbench_v1" &&
            (version === WORKBENCH_DOCUMENTARY_DEFINITION_VERSION ||
                version === WORKBENCH_FRAMING_RECEIPT_VERSION ||
                version === WORKBENCH_FRAMING_METHOD_VERSION)) ||
        (definitionId === "sources_v1" &&
            version === REFERENCED_SOURCES_VERSION) ||
        (definitionId === SAVED_MATERIAL_DEFINITION_ID &&
            version === REFERENCED_INSPECTION_VERSION)
    )
        return "referenced";
    return "legacy";
}

export function savedMaterialWireContract(
    name: string,
    binding: SavedMaterialBinding,
) {
    const wire =
        name === "search_available_material"
            ? searchWire
            : name === "read_in_context"
              ? contextWire
              : undefined;
    return wire?.[binding];
}
