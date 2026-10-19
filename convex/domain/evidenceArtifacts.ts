import type { Id } from "@convex/_generated/dataModel";

export const SEC_NORMALIZER_VERSION = "sec-html-v1";
export const SEC_RETRIEVAL_VERSION = "sec-http-v1";

export type ArtifactUploadLeaseStatus =
    | "reserved"
    | "uploaded"
    | "committed"
    | "orphaned";

export type ArtifactUploadLeaseKey = {
    runId: Id<"researchRuns">;
    corpusRevisionId: Id<"corpusRevisions">;
    sourceId: Id<"sources">;
    acceptedDecisionId: Id<"sourceDecisions">;
    contentHash: string;
    normalizerVersion: string;
};

export type SourceVersionKey = {
    corpusRevisionId: Id<"corpusRevisions">;
    sourceId: Id<"sources">;
    acceptedDecisionId: Id<"sourceDecisions">;
    contentHash: string;
    normalizerVersion: string;
};

export type ExecutionFenceInput = {
    runId: Id<"researchRuns">;
    corpusRevisionId: Id<"corpusRevisions">;
    sourceId: Id<"sources">;
    acceptedDecisionId: Id<"sourceDecisions">;
    executionGeneration: number;
};
