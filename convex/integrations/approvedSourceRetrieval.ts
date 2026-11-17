import type { Id } from "@convex/_generated/dataModel";
import type { NormalizedPassage } from "@convex/domain/sourcePassages";

export type SourceDocumentRetrievalInput = {
    canonicalUrl: string;
    origin: "sec" | "exa" | "analyst_url";
    providerReference?: string;
    secAccessionNumber?: string;
    secForm?: string;
    secPrimaryDocument?: string;
    companyCik?: string;
};

export type ApprovedSourceRetrievalInput = SourceDocumentRetrievalInput & {
    runId: Id<"researchRuns">;
    corpusRevisionId: Id<"corpusRevisions">;
    sourceId: Id<"sources">;
    acceptedDecisionId: Id<"sourceDecisions">;
    executionGeneration: number;
};

export type ApprovedSourceRetrievalResult = {
    status: "succeeded" | "partial" | "failed";
    canonicalUrl: string;
    rawContent?: string;
    normalizedText?: string;
    contentHash?: string;
    normalizerVersion?: string;
    retrievalVersion?: string;
    mediaType?: string;
    byteCount?: number;
    pageCount?: number;
    passages?: NormalizedPassage[];
    retrievalMetadata?: Record<string, unknown>;
    failureReason?: string;
    errorCode?: string;
};
