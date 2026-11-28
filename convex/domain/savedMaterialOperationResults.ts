import { operationResultValidator } from "@convex/execution/operationResults";
import { v } from "convex/values";
import {
    captureRepresentationCompleteness,
    documentaryRange,
    materialFields,
    readInContextInputValidator,
    referencedReadInput,
    referencedSearchInput,
    type SavedMaterialBinding,
    searchAvailableMaterialInputValidator,
} from "./savedMaterialOperations";
import {
    sourceDocumentMetadataValidator,
    sourceMaterialReferenceValidator,
} from "./sourceRetrievalPolicy";
import {
    captureExaminationValidator,
    retainedCaptureExaminationValidator,
    retainedDocumentaryStatusValidator,
} from "./sourcesContracts";
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

const retainedReferencedContextResult = v.object({
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

export const referencedContextResult = v.object({
    ...retainedReferencedContextResult.fields,
    examination: v.optional(captureExaminationValidator),
});
const scopedContextWire = {
    description:
        "Open an issued document, search-match or next reference. Returns exact text, capture provenance and a scoped documentary examination when performed for that capture. Use needOrder for need positions and useOrder for permission indexes in usesByNeed. A null use means the contribution did not address that need, and a null objection index applies to the whole contribution. Use its passage reference to cite the text, or nextReference to read further.",
    inputValidator: referencedReadInput,
    resultValidator: operationResultValidator(referencedContextResult),
};
export const searchAvailableMaterialResult = operationResultValidator(
    v.union(referencedSearchResult, legacySearchResult),
);
export const readInContextResult = operationResultValidator(
    v.union(
        referencedContextResult.extend({
            examination: v.optional(retainedCaptureExaminationValidator),
        }),
        legacyContextResult,
    ),
);

const retainedLegacyStatus = v.optional(retainedDocumentaryStatusValidator);
const retainedLegacySearchResult = v.object({
    ...legacySearchResult.fields,
    documentaryStatus: retainedLegacyStatus,
});
const retainedLegacyContextResult = v.object({
    ...legacyContextResult.fields,
    documentaryStatus: retainedLegacyStatus,
});

const searchWire = {
    legacy: {
        inputValidator: searchAvailableMaterialInputValidator,
        resultValidator: operationResultValidator(retainedLegacySearchResult),
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
        resultValidator: operationResultValidator(retainedLegacyContextResult),
    },
    referenced: {
        description:
            "Open an issued document, search-match or next reference. Returns the exact displayed text, character range, capture identity, recorded dates and representation completeness. Use the returned passage reference when citing displayed text, or nextReference to read further. When an indexed passage is returned, its order identifies the exact quote for documentary qualification.",
        inputValidator: referencedReadInput,
        resultValidator: operationResultValidator(
            retainedReferencedContextResult,
        ),
    },
};

export function savedMaterialWireContract(
    name: string,
    binding: SavedMaterialBinding,
    scopedExamination = false,
) {
    if (name === "read_in_context" && scopedExamination)
        return scopedContextWire;
    const wire =
        name === "search_available_material"
            ? searchWire
            : name === "read_in_context"
              ? contextWire
              : undefined;
    return wire?.[binding];
}
