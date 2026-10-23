import { extractPassagesFromNormalizedText } from "@convex/domain/sourcePassages";
import type {
    ApprovedSourceRetrievalInput,
    ApprovedSourceRetrievalResult,
    SourceDocumentRetrievalInput,
} from "@convex/integrations/approvedSourceRetrieval";
import {
    EXA_NORMALIZER_VERSION,
    normalizeExaText,
} from "@convex/integrations/evidenceNormalization";
import {
    type createExaContentsAdapter,
    ExaContentsError,
} from "@convex/integrations/exa";

export const EXA_RETRIEVAL_VERSION = "exa-contents-v1";

export async function retrieveAndNormalizeExaFiling(
    adapter: ReturnType<typeof createExaContentsAdapter>,
    input: SourceDocumentRetrievalInput | ApprovedSourceRetrievalInput,
): Promise<ApprovedSourceRetrievalResult> {
    try {
        const retrieval = await adapter.retrieveText(input.canonicalUrl);
        const normalized = normalizeExaText(retrieval.text);
        const passages = extractPassagesFromNormalizedText({
            text: normalized.normalizedText,
            canonicalUrl: input.canonicalUrl,
            sourceVersionHash: normalized.contentHash,
        });

        return {
            status: retrieval.textLimitReached ? "partial" : "succeeded",
            canonicalUrl: input.canonicalUrl,
            rawContent: retrieval.text,
            normalizedText: normalized.normalizedText,
            contentHash: normalized.contentHash,
            normalizerVersion: EXA_NORMALIZER_VERSION,
            retrievalVersion: EXA_RETRIEVAL_VERSION,
            mediaType: normalized.mediaType,
            byteCount: normalized.byteCount,
            passages,
            ...(retrieval.textLimitReached
                ? { failureReason: "Only part of this document was available." }
                : {}),
            retrievalMetadata: {
                providerReference:
                    retrieval.providerReference ?? input.providerReference,
                searchTime: retrieval.searchTime,
                costDollars: retrieval.costDollars,
            },
        };
    } catch (error) {
        const failureReason =
            error instanceof Error
                ? error.message
                : "Unknown Exa retrieval error";
        const errorCode =
            error instanceof ExaContentsError
                ? error.errorCode
                : error instanceof Error &&
                    /exceeds.*limit/i.test(error.message)
                  ? "response_too_large"
                  : error instanceof Error
                    ? error.name
                    : "ExaRetrievalError";
        return {
            status: "failed",
            canonicalUrl: input.canonicalUrl,
            failureReason,
            errorCode,
        };
    }
}
