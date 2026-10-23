"use node";

import {
    extractPassagesFromNormalizedText,
    sha256Hex,
} from "@convex/domain/sourcePassages";
import {
    preparationFailureCode,
    sourcePreparationError,
} from "@convex/domain/sourcePreparationAuthority";
import {
    fuseRetrievalRanks,
    retrievalMetadataValidator,
    retrievalModeValidator,
    SOURCE_RETRIEVAL_VERSION,
    shortRetrievalQuery,
    sourceEmbeddingScopeKey,
} from "@convex/domain/sourceRetrievalPolicy";
import {
    embedSourceTexts,
    SOURCE_EMBEDDING_PROFILE,
} from "@convex/integrations/sourceEmbeddings";
import type { FunctionReturnType } from "convex/server";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type ActionCtx, action, internalAction } from "./_generated/server";
import { MAX_NORMALIZED_ARTIFACT_BYTES } from "./resourceLimits";
import { approvedSourceScope } from "./sourceRetrieval";

const PROFILE = SOURCE_EMBEDDING_PROFILE.id;
const EMBEDDING_BATCH_SIZE = SOURCE_EMBEDDING_PROFILE.maximumBatchSize;
type Embedded =
    | { vectors: number[][]; reason?: never }
    | { vectors?: never; reason: string };

async function embed(
    ctx: ActionCtx,
    preparationId: Id<"sourceSelectionProposalRebuilds">,
    sourceId: Id<"sources">,
    texts: string[],
): Promise<Embedded> {
    const preparation = await ctx.runQuery(
        internal.sourcePreparation.getForExecution,
        { preparationId, now: Date.now() },
    );
    const vectors = await ctx.runQuery(internal.sourceRetrieval.cachedVectors, {
        preparationId,
        profile: PROFILE,
        texts,
    });
    const missing = texts.filter((_, i) => !vectors[i]);
    if (!missing.length) return { vectors: vectors as number[][] };
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_AI_TOKEN;
    if (!accountId || !apiToken) return { reason: "missing_configuration" };
    const submittedBytes = missing.reduce(
        (n, text) => n + new TextEncoder().encode(text).length,
        0,
    );
    const inputHash = sha256Hex(
        JSON.stringify({ profile: PROFILE, texts: missing }),
    );
    const attempt = {
        preparationId,
        sourceId: preparation.manualSourceIds?.[0] ?? sourceId,
        runId: preparation.runId,
        corpusRevisionId: preparation.corpusRevisionId,
        executionGeneration: preparation.executionGeneration,
        workflowVersion: preparation.workflowVersion,
        stepKey: "source_preparation",
        service: "model" as const,
        operation: "source_embedding",
        operationKey: `${preparation.operationKey}:step:source_embedding:input:${inputHash}:attempt:1`,
        inputHash,
        attempt: 1,
    };
    let claim: FunctionReturnType<typeof internal.providerCalls.recordAttempt>;
    try {
        claim = await ctx.runMutation(internal.providerCalls.recordAttempt, {
            ...attempt,
            status: "started",
            embeddingInputBytes: submittedBytes,
        });
    } catch (error) {
        const reason = preparationFailureCode(error);
        if (!reason) throw error;
        return { reason };
    }
    if (!claim.shouldExecute)
        return { reason: claim.errorCode ?? "attempt_outcome_unknown" };
    const started = Date.now();
    // Reservation and this immediately preceding fence both happen before external I/O.
    await ctx.runQuery(internal.sourcePreparation.getForExecution, {
        preparationId,
        now: Date.now(),
    });
    const result = await embedSourceTexts({
        accountId,
        apiToken,
        texts: missing,
        signal: AbortSignal.timeout(
            Math.max(1, (preparation.deadlineAt ?? 0) - Date.now()),
        ),
    });
    await ctx.runMutation(internal.providerCalls.recordAttempt, {
        ...attempt,
        status: result.status === "embedded" ? "succeeded" : "failed",
        latencyMs: Date.now() - started,
        usage: { profile: PROFILE, reservedInputBytes: submittedBytes },
        ...(result.status === "unavailable"
            ? { errorCode: result.reason, retryable: false }
            : {}),
    });
    if (result.status !== "embedded") return { reason: result.reason };
    await ctx.runMutation(internal.sourceRetrieval.saveCachedVectors, {
        preparationId,
        profile: PROFILE,
        providerCallId: claim.providerCallId,
        texts: missing,
        vectors: result.vectors,
    });
    let index = 0;
    return {
        vectors: vectors.map((vector) => {
            if (vector) return vector;
            const resolved = result.vectors[index++];
            if (!resolved)
                throw sourcePreparationError("embedding_vector_invalid");
            return resolved;
        }),
    };
}

/** Lazily indexes immutable capture bytes, with independent lexical and embedding completion. */
export const indexCapture = internalAction({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        captureId: v.id("sourceCaptures"),
        mode: retrievalModeValidator,
        maxReadBytes: v.optional(v.number()),
    },
    returns: v.object({
        candidateCount: v.number(),
        readBytes: v.number(),
        embeddingComplete: v.boolean(),
        degradationReason: v.optional(v.string()),
    }),
    handler: async (
        ctx,
        args,
    ): Promise<{
        candidateCount: number;
        readBytes: number;
        embeddingComplete: boolean;
        degradationReason?: string;
    }> => {
        const capture = await ctx.runQuery(
            internal.sourceRetrieval.getCapture,
            { preparationId: args.preparationId, captureId: args.captureId },
        );
        const readAllowance =
            args.maxReadBytes ?? MAX_NORMALIZED_ARTIFACT_BYTES;
        if (!Number.isSafeInteger(readAllowance) || readAllowance < 0)
            throw sourcePreparationError("retrieval_read_limit");
        const state = await ctx.runQuery(
            internal.sourceRetrieval.getIndexState,
            { preparationId: args.preparationId, captureId: args.captureId },
        );
        if (
            state &&
            (args.mode === "lexical" || state.embeddingProfile === PROFILE)
        )
            return {
                candidateCount: state.candidateCount,
                readBytes: 0,
                embeddingComplete: state.embeddingProfile === PROFILE,
            };
        if (capture.byteCount === undefined)
            throw sourcePreparationError("capture_unavailable");
        if (capture.byteCount > readAllowance)
            throw sourcePreparationError("retrieval_read_limit");
        const blob = capture.storageId
            ? await ctx.storage.get(capture.storageId)
            : null;
        if (
            !blob ||
            blob.size > MAX_NORMALIZED_ARTIFACT_BYTES ||
            blob.size !== capture.byteCount
        )
            throw sourcePreparationError("capture_unavailable");
        const text = await blob.text();
        if (sha256Hex(text) !== capture.contentHash)
            throw sourcePreparationError("capture_corrupt");
        let candidates: ReturnType<typeof extractPassagesFromNormalizedText>;
        try {
            candidates = extractPassagesFromNormalizedText({
                text,
                canonicalUrl: capture.resolvedUrl ?? capture.requestedUrl,
                sourceVersionHash: capture.contentHash,
                preparationVersion: SOURCE_RETRIEVAL_VERSION,
            });
        } catch (error) {
            if (
                error instanceof Error &&
                error.message === "searchable_candidate_limit_exceeded"
            )
                throw sourcePreparationError("retrieval_candidate_limit");
            throw error;
        }
        if (!state)
            for (let start = 0; start < candidates.length; start += 64) {
                const passages = candidates
                    .slice(start, start + 64)
                    .map((p) => ({
                        order: p.order,
                        startOffset: p.locator.startOffset,
                        endOffset: p.locator.endOffset,
                        quotation: p.exactQuotation,
                        headingPath: p.headingPath ?? [],
                    }));
                await ctx.runMutation(internal.sourceRetrieval.putBatch, {
                    preparationId: args.preparationId,
                    captureId: args.captureId,
                    passages,
                });
            }
        await ctx.runMutation(internal.sourceRetrieval.finishIndex, {
            preparationId: args.preparationId,
            captureId: args.captureId,
            candidateCount: candidates.length,
        });
        let reason: string | undefined;
        if (args.mode === "hybrid")
            for (
                let start = 0;
                start < candidates.length;
                start += EMBEDDING_BATCH_SIZE
            ) {
                const batch = await ctx.runQuery(
                    internal.sourceRetrieval.getEmbeddingBatch,
                    {
                        preparationId: args.preparationId,
                        captureId: args.captureId,
                        orders: candidates
                            .slice(start, start + EMBEDDING_BATCH_SIZE)
                            .map((p) => p.order),
                    },
                );
                const result = await embed(
                    ctx,
                    args.preparationId,
                    capture.sourceId,
                    batch.map((row) => row.searchText),
                );
                if (!result.vectors) {
                    reason = result.reason;
                    break;
                }
                await ctx.runMutation(
                    internal.sourceRetrieval.commitEmbeddings,
                    {
                        preparationId: args.preparationId,
                        captureId: args.captureId,
                        profile: PROFILE,
                        ids: batch.map((row) => row._id),
                    },
                );
            }
        const embeddingComplete =
            args.mode === "hybrid" && reason === undefined;
        if (args.mode === "hybrid")
            await ctx.runMutation(internal.sourceRetrieval.finishIndex, {
                preparationId: args.preparationId,
                captureId: args.captureId,
                candidateCount: candidates.length,
                ...(embeddingComplete
                    ? { embeddingProfile: PROFILE }
                    : { embeddingDegradationReason: reason }),
            });
        return {
            candidateCount: candidates.length,
            readBytes: blob.size,
            embeddingComplete,
            ...(reason ? { degradationReason: reason } : {}),
        };
    },
});

const retrieved = v.object({
    metadata: retrievalMetadataValidator,
    rankings: v.array(v.array(v.id("sourceSearchPassages"))),
    passages: v.array(
        v.object({
            id: v.id("sourceSearchPassages"),
            captureId: v.id("sourceCaptures"),
            sourceId: v.id("sources"),
            order: v.number(),
            startOffset: v.number(),
            endOffset: v.number(),
            quotation: v.string(),
            headingPath: v.array(v.string()),
        }),
    ),
});
/** Qualification and comparison use the same native search and rank fusion. */
export const retrieve = internalAction({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        captureIds: v.array(v.id("sourceCaptures")),
        queries: v.array(v.string()),
        mode: retrievalModeValidator,
    },
    returns: retrieved,
    handler: async (ctx, args): Promise<Infer<typeof retrieved>> => {
        if (
            args.captureIds.length > 60 ||
            args.queries.length > 16 ||
            args.queries.some((q) => q.length > 32000)
        )
            throw sourcePreparationError("retrieval_query_invalid");
        const preparation = await ctx.runQuery(
            internal.sourcePreparation.getForExecution,
            { preparationId: args.preparationId, now: Date.now() },
        );
        let totalCandidates = 0;
        let reason: string | undefined;
        for (const captureId of args.captureIds) {
            const state = await ctx.runQuery(
                internal.sourceRetrieval.getIndexState,
                { preparationId: args.preparationId, captureId },
            );
            if (!state)
                throw sourcePreparationError("retrieval_index_incomplete");
            totalCandidates += state.candidateCount;
            if (args.mode === "hybrid" && state.embeddingProfile !== PROFILE)
                reason =
                    state.embeddingDegradationReason ??
                    "embedding_index_incomplete";
        }
        const queries = args.queries.map(shortRetrievalQuery);
        let vectors: number[][] | undefined;
        const firstCaptureId = args.captureIds[0];
        if (
            args.mode === "hybrid" &&
            !reason &&
            queries.length &&
            firstCaptureId
        ) {
            const capture = await ctx.runQuery(
                internal.sourceRetrieval.getCapture,
                {
                    preparationId: args.preparationId,
                    captureId: firstCaptureId,
                },
            );
            const result = await embed(
                ctx,
                args.preparationId,
                capture.sourceId,
                queries,
            );
            if (result.reason) reason = result.reason;
            else vectors = result.vectors;
        }
        const rows = new Map<string, Doc<"sourceSearchPassages">>();
        const rankings: Array<Array<Id<"sourceSearchPassages">>> = [];
        for (const [i, query] of queries.entries()) {
            const captureRankings: string[][] = [];
            for (const captureId of new Set(args.captureIds)) {
                const matches = await ctx.runQuery(
                    internal.sourceRetrieval.search,
                    {
                        preparationId: args.preparationId,
                        captureId,
                        query,
                    },
                );
                for (const row of matches) rows.set(row._id, row);
                captureRankings.push(matches.map((row) => row._id));
            }
            const lexicalIds = fuseRetrievalRanks(...captureRankings).slice(
                0,
                64,
            );
            let semantic: Array<Doc<"sourceSearchPassages">> = [];
            const vector = vectors?.[i];
            if (vector) {
                const hits = await ctx.vectorSearch(
                    "sourceSearchPassages",
                    "search_embedding",
                    {
                        vector,
                        limit: 256,
                        filter: (q) =>
                            q.or(
                                ...[...new Set(args.captureIds)].map(
                                    (captureId) =>
                                        q.eq(
                                            "embeddingScopeKey",
                                            sourceEmbeddingScopeKey(
                                                `${preparation.runId}:${preparation.corpusRevisionId}:${SOURCE_RETRIEVAL_VERSION}`,
                                                PROFILE,
                                                captureId,
                                            ),
                                        ),
                                ),
                            ),
                    },
                );
                semantic = await ctx.runQuery(
                    internal.sourceRetrieval.getVectorResults,
                    {
                        preparationId: args.preparationId,
                        captureIds: args.captureIds,
                        ids: hits.map((hit) => hit._id),
                        profile: PROFILE,
                    },
                );
            }
            for (const row of semantic) rows.set(row._id, row);
            rankings.push(
                fuseRetrievalRanks(
                    lexicalIds,
                    semantic.map((r) => r._id),
                ).slice(0, 64) as Id<"sourceSearchPassages">[],
            );
            // Do not retain every capture's candidates across all sixteen queries.
            const retained = new Set(rankings.flat());
            for (const id of rows.keys())
                if (!retained.has(id as Id<"sourceSearchPassages">))
                    rows.delete(id);
        }
        const ordered = fuseRetrievalRanks(...rankings);
        const selected = new Set(ordered);
        return {
            metadata: {
                version: SOURCE_RETRIEVAL_VERSION,
                requestedMode: args.mode,
                effectiveMode:
                    args.mode === "hybrid" && !reason ? "hybrid" : "lexical",
                ...(reason ? { degradationReason: reason } : {}),
                selectedPassageKeys: ordered,
                omittedCandidateCount: Math.max(
                    0,
                    totalCandidates - selected.size,
                ),
            },
            rankings,
            passages: ordered.map((id) => {
                const row = rows.get(id);
                if (!row)
                    throw sourcePreparationError("retrieval_passage_invalid");
                return {
                    id: row._id,
                    captureId: row.captureId,
                    sourceId: row.sourceId,
                    order: row.order,
                    startOffset: row.startOffset,
                    endOffset: row.endOffset,
                    quotation: row.quotation,
                    headingPath: row.headingPath,
                };
            }),
        };
    },
});

/** Indexes only the approved stored representation. No provider or execution capability is invoked. */
export const ensureApprovedSourceIndex = action({
    args: approvedSourceScope,
    handler: async (
        ctx,
        args,
    ): Promise<
        { status: "ready" } | { status: "unavailable"; reason: string }
    > => {
        const allowed = await ctx.runQuery(
            internal.sourceRetrieval.getApprovedCapture,
            args,
        );
        if (allowed.status !== "available") return allowed;
        if (allowed.state) return { status: "ready" };
        const capture = allowed.capture;
        const blob = capture.storageId
            ? await ctx.storage.get(capture.storageId)
            : null;
        if (
            !blob ||
            blob.size > MAX_NORMALIZED_ARTIFACT_BYTES ||
            blob.size !== capture.byteCount
        )
            return { status: "unavailable", reason: "capture_unavailable" };
        const text = await blob.text();
        if (sha256Hex(text) !== capture.contentHash)
            return { status: "unavailable", reason: "capture_corrupt" };
        let candidates: ReturnType<typeof extractPassagesFromNormalizedText>;
        try {
            candidates = extractPassagesFromNormalizedText({
                text,
                canonicalUrl: capture.resolvedUrl ?? capture.requestedUrl,
                sourceVersionHash: capture.contentHash,
                preparationVersion: SOURCE_RETRIEVAL_VERSION,
            });
        } catch (error) {
            if (
                error instanceof Error &&
                [
                    "searchable_candidate_limit_exceeded",
                    "structured_block_limit_exceeded",
                ].includes(error.message)
            )
                return {
                    status: "unavailable",
                    reason: "retrieval_candidate_limit",
                };
            throw error;
        }
        const identity = {
            ...args,
            captureId: capture._id,
            contentHash: capture.contentHash,
        };
        for (let offset = 0; offset < candidates.length; offset += 64) {
            await ctx.runMutation(internal.sourceRetrieval.putApprovedBatch, {
                ...identity,
                passages: candidates.slice(offset, offset + 64).map((p) => ({
                    order: p.order,
                    startOffset: p.locator.startOffset,
                    endOffset: p.locator.endOffset,
                    quotation: p.exactQuotation,
                    headingPath: p.headingPath ?? [],
                })),
            });
        }
        await ctx.runMutation(internal.sourceRetrieval.finishApprovedIndex, {
            ...identity,
            candidateCount: candidates.length,
        });
        return { status: "ready" };
    },
});
