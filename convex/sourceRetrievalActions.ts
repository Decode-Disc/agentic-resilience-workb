"use node";

import { createHash } from "node:crypto";
import { referencedContextResult } from "@convex/domain/savedMaterialOperationResults";
import { documentaryRange } from "@convex/domain/savedMaterialOperations";
import {
    completeCharacterBoundary,
    extractPassagesFromNormalizedText,
    sha256Hex,
} from "@convex/domain/sourcePassages";
import {
    preparationFailureCode,
    sourcePreparationError,
} from "@convex/domain/sourcePreparationAuthority";
import {
    capturedDocumentMetadata,
    fuseRetrievalRanks,
    retrievalMetadataValidator,
    retrievalModeValidator,
    SOURCE_RETRIEVAL_VERSION,
    type SourcePassageRankIdentity,
    shortRetrievalQuery,
    sourceDocumentMetadataValidator,
    sourceEmbeddingScopeKey,
} from "@convex/domain/sourceRetrievalPolicy";
import { retainedPublicReadPage } from "@convex/domain/workbenchContracts";
import { executionError } from "@convex/execution/errors";
import {
    embedSourceTexts,
    SOURCE_EMBEDDING_PROFILE,
} from "@convex/integrations/sourceEmbeddings";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type ActionCtx, action, internalAction } from "./_generated/server";
import {
    MAX_NORMALIZED_ARTIFACT_BYTES,
    MAX_OPERATION_RESULT_BYTES,
    SOURCE_CONTEXT_NEIGHBOR_CHARACTERS,
    SOURCE_CONTEXT_PAGE_CHARACTERS,
} from "./resourcePolicy";
import {
    approvedSourceScope,
    type MissionApprovedCapture,
    missionApprovedSourceScope,
} from "./sourceRetrieval";

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
    allowProviderCalls = true,
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
    if (!allowProviderCalls) return { reason: "model_attempt_limit_reached" };
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
const captureIndexArgs = v.object({
    preparationId: v.id("sourceSelectionProposalRebuilds"),
    captureId: v.id("sourceCaptures"),
    mode: retrievalModeValidator,
    allowProviderCalls: v.optional(v.boolean()),
    maxReadBytes: v.optional(v.number()),
});

/** Shares Node preparation work without another action invocation. */
export async function ensureSourceCaptureIndex(
    ctx: ActionCtx,
    args: Infer<typeof captureIndexArgs>,
): Promise<{
    candidateCount: number;
    readBytes: number;
    embeddingComplete: boolean;
    degradationReason?: string;
}> {
    const capture = await ctx.runQuery(internal.sourceRetrieval.getCapture, {
        preparationId: args.preparationId,
        captureId: args.captureId,
    });
    const readAllowance = args.maxReadBytes ?? MAX_NORMALIZED_ARTIFACT_BYTES;
    if (!Number.isSafeInteger(readAllowance) || readAllowance < 0)
        throw sourcePreparationError("retrieval_read_limit");
    const existing = await ctx.runQuery(
        internal.sourceRetrieval.getIndexState,
        {
            preparationId: args.preparationId,
            captureId: args.captureId,
        },
    );
    if (
        existing &&
        (args.mode === "lexical" || existing.embeddingProfile === PROFILE)
    )
        return {
            candidateCount: existing.candidateCount,
            readBytes: 0,
            embeddingComplete: existing.embeddingProfile === PROFILE,
        };
    if (capture.byteCount === undefined)
        throw sourcePreparationError("capture_unavailable");
    if (capture.byteCount > readAllowance)
        throw sourcePreparationError("retrieval_read_limit");
    const stored = await readVerifiedCaptureText(ctx, capture);
    if (stored.status === "unavailable")
        throw sourcePreparationError(stored.reason);
    const { text } = stored;
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
    if (!existing)
        for (let start = 0; start < candidates.length; start += 64) {
            const passages = candidates.slice(start, start + 64).map((p) => ({
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
                args.allowProviderCalls,
            );
            if (!result.vectors) {
                reason = result.reason;
                break;
            }
            await ctx.runMutation(internal.sourceRetrieval.commitEmbeddings, {
                preparationId: args.preparationId,
                captureId: args.captureId,
                profile: PROFILE,
                ids: batch.map((row) => row._id),
            });
        }
    const embeddingComplete = args.mode === "hybrid" && reason === undefined;
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
        readBytes: stored.byteCount,
        embeddingComplete,
        ...(reason ? { degradationReason: reason } : {}),
    };
}

export const indexCapture = internalAction({
    args: captureIndexArgs,
    returns: v.object({
        candidateCount: v.number(),
        readBytes: v.number(),
        embeddingComplete: v.boolean(),
        degradationReason: v.optional(v.string()),
    }),
    handler: (ctx, args) => ensureSourceCaptureIndex(ctx, args),
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
const retrievalArgs = v.object({
    preparationId: v.id("sourceSelectionProposalRebuilds"),
    captureIds: v.array(v.id("sourceCaptures")),
    queries: v.array(v.string()),
    mode: retrievalModeValidator,
    allowProviderCalls: v.optional(v.boolean()),
});

/** Shares Node preparation work without another action invocation. */
export async function retrieveSourcePassages(
    ctx: ActionCtx,
    args: Infer<typeof retrievalArgs>,
): Promise<Infer<typeof retrieved>> {
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
    const captureUrls = new Map<string, string>();
    const vectorScopes = new Map<Id<"sourceCaptures">, string>();
    let totalCandidates = 0;
    let reason: string | undefined;
    for (let offset = 0; offset < args.captureIds.length; offset += 8) {
        const entries = await ctx.runQuery(
            internal.sourceRetrieval.getCaptureIndexBatch,
            {
                preparationId: args.preparationId,
                captureIds: args.captureIds.slice(offset, offset + 8),
            },
        );
        for (const { capture, state } of entries) {
            captureUrls.set(
                capture._id,
                capture.resolvedUrl ?? capture.requestedUrl,
            );
            if (!state)
                throw sourcePreparationError("retrieval_index_incomplete");
            totalCandidates += state.candidateCount;
            vectorScopes.set(
                capture._id,
                sourceEmbeddingScopeKey(state.scopeKey, PROFILE, capture._id),
            );
            if (args.mode === "hybrid" && state.embeddingProfile !== PROFILE)
                reason =
                    state.embeddingDegradationReason ??
                    "embedding_index_incomplete";
        }
    }
    const queries = args.queries.map(shortRetrievalQuery);
    let vectors: number[][] | undefined;
    const firstCaptureId = args.captureIds[0];
    if (args.mode === "hybrid" && !reason && queries.length && firstCaptureId) {
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
            args.allowProviderCalls,
        );
        if (result.reason) reason = result.reason;
        else vectors = result.vectors;
    }
    const captureIds = [...new Set(args.captureIds)];
    const captureBatches: Array<Array<Id<"sourceCaptures">>> = [];
    for (let offset = 0; offset < captureIds.length; offset += 2)
        captureBatches.push(captureIds.slice(offset, offset + 2));
    const jobs = queries.flatMap((query) =>
        captureBatches.map((captureIds) => ({ query, captureIds })),
    );
    let jobOffset = 0;
    let prefetched: Array<
        FunctionReturnType<typeof internal.sourceRetrieval.searchBatch>
    > = [];
    const nextLexicalBatch = async () => {
        if (!prefetched.length) {
            const batch = jobs.slice(jobOffset, jobOffset + 2);
            jobOffset += batch.length;
            const results = await Promise.allSettled(
                batch.map((job) =>
                    ctx.runQuery(internal.sourceRetrieval.searchBatch, {
                        preparationId: args.preparationId,
                        ...job,
                    }),
                ),
            );
            const failed = results.find(
                (result) => result.status === "rejected",
            );
            if (failed?.status === "rejected") throw failed.reason;
            prefetched = results.flatMap((result) =>
                result.status === "fulfilled" ? [result.value] : [],
            );
        }
        const result = prefetched.shift();
        if (!result) throw sourcePreparationError("retrieval_query_invalid");
        return result;
    };
    const rows = new Map<string, Doc<"sourceSearchPassages">>();
    const identities = preparation.retrievalRankingPolicy
        ? new Map<string, SourcePassageRankIdentity>()
        : undefined;
    const retain = (row: Doc<"sourceSearchPassages">) => {
        rows.set(row._id, row);
        const canonicalUrl = captureUrls.get(row.captureId);
        if (identities) {
            if (!canonicalUrl)
                throw sourcePreparationError("retrieval_passage_invalid");
            identities.set(row._id, {
                canonicalUrl,
                contentHash: row.contentHash,
                order: row.order,
                startOffset: row.startOffset,
                endOffset: row.endOffset,
            });
        }
    };
    const rankings: Array<Array<Id<"sourceSearchPassages">>> = [];
    for (const [i] of queries.entries()) {
        const captureRankings: string[][] = [];
        for (
            let batchIndex = 0;
            batchIndex < captureBatches.length;
            batchIndex++
        ) {
            const results = await nextLexicalBatch();
            for (const { passages: matches } of results) {
                for (const row of matches) retain(row);
                captureRankings.push(matches.map((row) => row._id));
            }
        }
        const lexicalIds = fuseRetrievalRanks(
            captureRankings,
            identities,
        ).slice(0, 64);
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
                            ...[...vectorScopes.values()].map((scope) =>
                                q.eq("embeddingScopeKey", scope),
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
        for (const row of semantic) retain(row);
        rankings.push(
            fuseRetrievalRanks(
                [lexicalIds, semantic.map((r) => r._id)],
                identities,
            ).slice(0, 64) as Id<"sourceSearchPassages">[],
        );
        // Do not retain every capture's candidates across all sixteen queries.
        const retained = new Set(rankings.flat());
        for (const id of rows.keys())
            if (!retained.has(id as Id<"sourceSearchPassages">)) {
                rows.delete(id);
                identities?.delete(id);
            }
    }
    const ordered = fuseRetrievalRanks(rankings, identities);
    const selected = new Set(ordered);
    return {
        metadata: {
            version: SOURCE_RETRIEVAL_VERSION,
            ...(preparation.retrievalRankingPolicy
                ? { rankingPolicy: preparation.retrievalRankingPolicy }
                : {}),
            requestedMode: args.mode,
            effectiveMode:
                args.mode === "hybrid" && !reason ? "hybrid" : "lexical",
            ...(reason ? { degradationReason: reason } : {}),
            selectedPassageKeys: ordered,
            omittedCandidateCount: Math.max(0, totalCandidates - selected.size),
        },
        rankings,
        passages: ordered.map((id) => {
            const row = rows.get(id);
            if (!row) throw sourcePreparationError("retrieval_passage_invalid");
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
}

export const retrieve = internalAction({
    args: retrievalArgs,
    returns: retrieved,
    handler: (ctx, args) => retrieveSourcePassages(ctx, args),
});

type ApprovedIndexIdentity = {
    captureId: Id<"sourceCaptures">;
    contentHash: string;
};

type ApprovedIndexPassage = {
    order: number;
    startOffset: number;
    endOffset: number;
    quotation: string;
    headingPath: string[];
};

const approvedPassageResult = v.object({
    order: v.number(),
    startOffset: v.number(),
    endOffset: v.number(),
    quotation: v.string(),
    quotationHash: v.string(),
    headingPath: v.array(v.string()),
});

const approvedMaterialReadRequest = v.union(
    v.object({
        kind: v.literal("search"),
        query: v.string(),
        cursor: v.optional(v.string()),
        expectedCaptureId: v.optional(v.id("sourceCaptures")),
        expectedContentHash: v.optional(v.string()),
    }),
    v.object({
        kind: v.literal("context"),
        passageOrder: v.number(),
        expectedCaptureId: v.optional(v.id("sourceCaptures")),
        expectedContentHash: v.optional(v.string()),
        range: v.optional(
            v.object({ startOffset: v.number(), endOffset: v.number() }),
        ),
        offset: v.optional(v.number()),
    }),
    v.object({
        kind: v.literal("contexts"),
        passageOrders: v.array(v.number()),
    }),
);

const approvedContextReadResult = v.object({
    status: v.literal("ready"),
    kind: v.literal("context"),
    captureId: v.id("sourceCaptures"),
    contentHash: v.string(),
    document: sourceDocumentMetadataValidator,
    captureOmittedPassageCount: v.optional(v.union(v.number(), v.null())),
    passage: v.object({
        ...approvedPassageResult.fields,
        surroundingText: v.string(),
        contextStartOffset: v.optional(v.number()),
        contextEndOffset: v.optional(v.number()),
        contextRange: v.optional(
            v.object({ startOffset: v.number(), endOffset: v.number() }),
        ),
        captureCharacters: v.optional(v.number()),
    }),
});

const approvedMaterialReadResult = v.union(
    v.object({ status: v.literal("unavailable"), reason: v.string() }),
    v.object({
        status: v.literal("ready"),
        kind: v.literal("search"),
        document: sourceDocumentMetadataValidator,
        captureId: v.id("sourceCaptures"),
        contentHash: v.string(),
        canonicalUrl: v.string(),
        retrievedAt: v.union(v.number(), v.null()),
        passages: v.array(approvedPassageResult),
        limitReached: v.boolean(),
        continueCursor: v.optional(v.union(v.string(), v.null())),
        captureOmittedPassageCount: v.optional(v.union(v.number(), v.null())),
    }),
    approvedContextReadResult,
    v.object({
        status: v.literal("ready"),
        kind: v.literal("contexts"),
        contexts: v.array(approvedContextReadResult),
    }),
);

type ApprovedIndexResult =
    | { status: "ready" }
    | { status: "unavailable"; reason: string };
type ApprovedMaterialReadResult = Infer<typeof approvedMaterialReadResult>;
type AvailableApprovedCapture = Extract<
    MissionApprovedCapture,
    { status: "available" }
>["capture"];

export async function readVerifiedCaptureText(
    ctx: ActionCtx,
    capture: Pick<
        Doc<"sourceCaptures">,
        "storageId" | "byteCount" | "contentHash" | "retainedImport"
    >,
): Promise<
    | {
          status: "available";
          text: string;
          byteCount: number;
          contentHash: string;
      }
    | { status: "unavailable"; reason: string }
> {
    const blob = capture.storageId
        ? await ctx.storage.get(capture.storageId)
        : null;
    if (!blob || blob.size > MAX_NORMALIZED_ARTIFACT_BYTES)
        return { status: "unavailable", reason: "capture_unavailable" };
    const text = capture.retainedImport
        ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(
              await blob.arrayBuffer(),
          )
        : await blob.text();
    const contentHash = createHash("sha256").update(text).digest("hex");
    if (contentHash !== capture.contentHash)
        return { status: "unavailable", reason: "capture_corrupt" };
    if (capture.byteCount !== undefined && blob.size !== capture.byteCount)
        return { status: "unavailable", reason: "capture_unavailable" };
    return { status: "available", text, byteCount: blob.size, contentHash };
}

async function ensureApprovedIndex(
    ctx: ActionCtx,
    allowed:
        | {
              status: "available";
              capture: AvailableApprovedCapture;
              state: Doc<"sourceSearchCaptures"> | null;
          }
        | { status: "unavailable"; reason: string },
    persistBatch: (
        identity: ApprovedIndexIdentity,
        passages: ApprovedIndexPassage[],
    ) => Promise<unknown>,
    finishIndex: (
        identity: ApprovedIndexIdentity,
        candidateCount: number,
    ) => Promise<unknown>,
    suppliedText?: string,
): Promise<{ status: "ready" } | { status: "unavailable"; reason: string }> {
    if (allowed.status !== "available") return allowed;
    const capture = allowed.capture;
    if (allowed.state && suppliedText === undefined) return { status: "ready" };
    let text = suppliedText;
    if (text === undefined) {
        const stored = await readVerifiedCaptureText(ctx, capture);
        if (stored.status !== "available") return stored;
        text = stored.text;
    }
    if (allowed.state) return { status: "ready" };
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
        captureId: capture._id,
        contentHash: capture.contentHash,
    };
    for (let offset = 0; offset < candidates.length; offset += 64) {
        await persistBatch(
            identity,
            candidates.slice(offset, offset + 64).map((p) => ({
                order: p.order,
                startOffset: p.locator.startOffset,
                endOffset: p.locator.endOffset,
                quotation: p.exactQuotation,
                headingPath: p.headingPath ?? [],
            })),
        );
    }
    await finishIndex(identity, candidates.length);
    return { status: "ready" };
}

async function ensureMissionApprovedIndex(
    ctx: ActionCtx,
    args: FunctionArgs<
        typeof internal.sourceRetrieval.approvedCaptureForMission
    >,
    allowed: MissionApprovedCapture,
    suppliedText?: string,
): Promise<ApprovedIndexResult> {
    return ensureApprovedIndex(
        ctx,
        allowed,
        (identity, passages) =>
            ctx.runMutation(
                internal.sourceRetrieval.putApprovedBatchForMission,
                { ...args, ...identity, passages },
            ),
        (identity, candidateCount) =>
            ctx.runMutation(
                internal.sourceRetrieval.finishApprovedIndexForMission,
                { ...args, ...identity, candidateCount },
            ),
        suppliedText,
    );
}

function quoteIsInCapture(
    text: string,
    passage: { startOffset: number; endOffset: number; quotation: string },
) {
    return (
        text.slice(passage.startOffset, passage.endOffset) === passage.quotation
    );
}

function capturePage(
    text: string,
    startOffset: number,
    extentEnd: number,
    pageCharacters = SOURCE_CONTEXT_PAGE_CHARACTERS,
) {
    const endOffset = completeCharacterBoundary(
        text,
        Math.min(extentEnd, startOffset + pageCharacters),
    );
    return {
        range: { startOffset, endOffset },
        text: text.slice(startOffset, endOffset),
    };
}

/** Keeps historical read IDs and page widths over the same verified capture reader. */
const retainedPublicContextPageResult = v.union(
    v.object({ status: v.literal("unavailable"), reason: v.string() }),
    v.object({ status: v.literal("ready"), page: retainedPublicReadPage }),
);

export const readRetainedPublicContextPage = internalAction({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: retainedPublicContextPageResult,
    async handler(
        ctx,
        args,
    ): Promise<Infer<typeof retainedPublicContextPageResult>> {
        const imported = await ctx.runAction(
            internal.sourceCaptureActions.importRetainedDocument,
            args,
        );
        if (imported.status === "unavailable") return imported;
        const { capture, rootId, start, characters } = await ctx.runQuery(
            internal.sourceCaptures.retainedContinuationCapture,
            { ...args, captureId: imported.captureId },
        );
        const stored = await readVerifiedCaptureText(ctx, capture);
        if (stored.status === "unavailable") return stored;
        if (
            stored.text.length !== characters ||
            start < 0 ||
            start >= characters
        )
            throw executionError("source_continuation_invalid");
        const page = capturePage(
            stored.text,
            start,
            characters,
            Math.floor(MAX_OPERATION_RESULT_BYTES / 8),
        );
        return {
            status: "ready",
            page: {
                readId: rootId,
                contentHash: capture.contentHash,
                characters,
                start,
                end: page.range.endOffset,
                excerpt: page.text,
            },
        };
    },
});

const documentaryMaterialReadResult = v.union(
    v.object({ status: v.literal("unavailable"), reason: v.string() }),
    v.object({
        status: v.literal("ready"),
        kind: v.literal("search"),
        passages: v.array(approvedPassageResult),
        continueCursor: v.union(v.string(), v.null()),
    }),
    v.object({
        status: v.literal("ready"),
        kind: v.literal("context"),
        readKind: referencedContextResult.fields.readKind,
        range: documentaryRange,
        captureCharacters: v.number(),
        text: v.string(),
        indexedPassage: referencedContextResult.fields.indexedPassage,
    }),
);

/** Reads the exact capture admitted by the referring operation, sharing the retained index and page reader. */
export const readDocumentaryForOperation = internalAction({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
        cursor: v.optional(v.string()),
    },
    returns: documentaryMaterialReadResult,
    async handler(
        ctx,
        { cursor, ...authority },
    ): Promise<Infer<typeof documentaryMaterialReadResult>> {
        const allowed = await ctx.runQuery(
            internal.sourceRetrieval.documentaryCaptureForOperation,
            authority,
        );
        const stored = await readVerifiedCaptureText(ctx, allowed.capture);
        if (stored.status !== "available") return stored;
        const { text } = stored;
        if (allowed.input.kind === "search_available_material") {
            const index = await ensureApprovedIndex(
                ctx,
                { ...allowed, status: "available" },
                (_identity, passages) =>
                    ctx.runMutation(
                        internal.sourceRetrieval.putDocumentaryBatch,
                        { ...authority, passages },
                    ),
                (_identity, candidateCount) =>
                    ctx.runMutation(
                        internal.sourceRetrieval.publishDocumentaryIndex,
                        { ...authority, candidateCount },
                    ),
                text,
            );
            if (index.status !== "ready") return index;
            const matches = await ctx.runQuery(
                internal.sourceRetrieval.searchDocumentaryCapture,
                { ...authority, cursor },
            );
            if (matches.status !== "ready")
                return {
                    status: "unavailable",
                    reason:
                        matches.status === "not_indexed"
                            ? "source_index_unavailable"
                            : matches.reason,
                };
            if (
                matches.captureId !== allowed.capture._id ||
                matches.contentHash !== allowed.capture.contentHash ||
                matches.passages.some((p) => !quoteIsInCapture(text, p))
            )
                return { status: "unavailable", reason: "capture_corrupt" };
            return {
                status: "ready",
                kind: "search",
                passages: matches.passages,
                continueCursor: matches.continueCursor,
            };
        }
        const extent = allowed.extent;
        let offset = 0;
        let readKind: "beginning" | "context" = "beginning";
        if (extent.kind === "focal") {
            if (
                !quoteIsInCapture(text, {
                    ...extent.range,
                    quotation: extent.quotation,
                })
            )
                return { status: "unavailable", reason: "capture_corrupt" };
            offset = Math.max(
                0,
                extent.range.startOffset - SOURCE_CONTEXT_NEIGHBOR_CHARACTERS,
            );
            // The neighbor start can fall on the second code unit of a character.
            offset = completeCharacterBoundary(text, offset);
            readKind = "context";
        } else if (extent.kind === "next") {
            offset = extent.offset;
            readKind = extent.readKind;
            if (
                !Number.isSafeInteger(offset) ||
                offset < 0 ||
                extent.endOffset !== text.length ||
                completeCharacterBoundary(text, offset) !== offset
            )
                return {
                    status: "unavailable",
                    reason: "material_continuation_invalid",
                };
        }
        if (offset >= text.length)
            return {
                status: "unavailable",
                reason: "material_continuation_invalid",
            };
        const page = capturePage(text, offset, text.length);
        if (
            extent.kind === "focal" &&
            page.range.endOffset < extent.range.endOffset
        )
            return {
                status: "unavailable",
                reason: "retrieval_passage_invalid",
            };
        // Recheck after reading to avoid presenting content once the admitted scope has changed.
        await ctx.runQuery(
            internal.sourceRetrieval.documentaryCaptureForOperation,
            authority,
        );
        return {
            ...page,
            status: "ready",
            kind: "context",
            readKind,
            captureCharacters: text.length,
            ...(extent.kind === "focal"
                ? {
                      indexedPassage: {
                          passageOrder: extent.passageOrder,
                          exactQuote: extent.quotation,
                      },
                  }
                : {}),
        };
    },
});

/** Reads approved search results or passage context while reusing the capture bytes used for a cold index. */
export const readApprovedMaterialForMission = internalAction({
    args: {
        ...missionApprovedSourceScope,
        request: approvedMaterialReadRequest,
    },
    returns: approvedMaterialReadResult,
    handler: async (ctx, args): Promise<ApprovedMaterialReadResult> => {
        if (
            args.request.kind === "contexts" &&
            (!args.request.passageOrders.length ||
                args.request.passageOrders.length > 128 ||
                args.request.passageOrders.some(
                    (order) => !Number.isSafeInteger(order) || order < 0,
                ))
        )
            return {
                status: "unavailable",
                reason: "retrieval_passage_invalid",
            };
        const captureArgs = {
            missionId: args.missionId,
            runId: args.runId,
            expectedGeneration: args.expectedGeneration,
            sourceId: args.sourceId,
            exactCapture: args.exactCapture,
        };
        const allowed: MissionApprovedCapture = await ctx.runQuery(
            internal.sourceRetrieval.approvedCaptureForMission,
            captureArgs,
        );
        if (allowed.status !== "available")
            return { status: "unavailable", reason: allowed.reason };
        if (
            args.request.kind !== "contexts" &&
            ((args.request.expectedCaptureId &&
                args.request.expectedCaptureId !== allowed.capture._id) ||
                (args.request.expectedContentHash &&
                    args.request.expectedContentHash !==
                        allowed.capture.contentHash))
        )
            return {
                status: "unavailable",
                reason: "material_continuation_unavailable",
            };
        const stored = await readVerifiedCaptureText(ctx, allowed.capture);
        if (stored.status !== "available") return stored;
        const index: ApprovedIndexResult = await ensureMissionApprovedIndex(
            ctx,
            captureArgs,
            allowed,
            stored.text,
        );
        if (index.status !== "ready") return index;

        const current: MissionApprovedCapture = await ctx.runQuery(
            internal.sourceRetrieval.approvedCaptureForMission,
            captureArgs,
        );
        if (
            current.status !== "available" ||
            current.capture._id !== allowed.capture._id ||
            current.capture.contentHash !== allowed.capture.contentHash
        )
            return {
                status: "unavailable",
                reason: "capture_unavailable",
            };

        const document =
            current.capture.document ??
            capturedDocumentMetadata(current.document, stored.text);
        if (args.request.kind === "search") {
            const result: FunctionReturnType<
                typeof internal.sourceRetrieval.searchApprovedSourceForMission
            > = await ctx.runQuery(
                internal.sourceRetrieval.searchApprovedSourceForMission,
                {
                    ...captureArgs,
                    query: args.request.query,
                    cursor: args.request.cursor,
                },
            );
            if (result.status !== "ready")
                return {
                    status: "unavailable",
                    reason:
                        result.status === "not_indexed"
                            ? "source_index_unavailable"
                            : result.reason,
                };
            if (
                result.captureId !== allowed.capture._id ||
                result.contentHash !== allowed.capture.contentHash ||
                result.passages.some(
                    (passage) => !quoteIsInCapture(stored.text, passage),
                )
            )
                return {
                    status: "unavailable",
                    reason: "capture_corrupt",
                };
            return {
                status: "ready",
                kind: "search",
                document,
                captureId: result.captureId,
                contentHash: result.contentHash,
                canonicalUrl: result.canonicalUrl,
                retrievedAt: result.retrievedAt,
                passages: result.passages,
                limitReached: result.limitReached,
                continueCursor: result.continueCursor,
                captureOmittedPassageCount: result.captureOmittedPassageCount,
            };
        }

        const contextualPassages = new Map<
            number,
            Extract<
                FunctionReturnType<
                    typeof internal.sourceRetrieval.approvedPassageForMission
                >,
                { status: "ready" }
            >
        >();
        if (args.request.kind === "contexts") {
            const batch = await ctx.runQuery(
                internal.sourceRetrieval.approvedPassagesForMission,
                { ...captureArgs, passageOrders: args.request.passageOrders },
            );
            if (batch.status !== "ready")
                return { status: "unavailable", reason: batch.reason };
            for (const passage of batch.passages)
                contextualPassages.set(passage.order, {
                    status: "ready",
                    capture: batch.capture,
                    passage,
                });
        }
        const readContext = async (
            passageOrder: number,
        ): Promise<
            | Infer<typeof approvedContextReadResult>
            | { status: "unavailable"; reason: string }
        > => {
            const result: FunctionReturnType<
                typeof internal.sourceRetrieval.approvedPassageForMission
            > =
                args.request.kind === "contexts"
                    ? (contextualPassages.get(passageOrder) ?? {
                          status: "unavailable",
                          reason: "passage_unavailable",
                      })
                    : await ctx.runQuery(
                          internal.sourceRetrieval.approvedPassageForMission,
                          { ...captureArgs, passageOrder },
                      );
            if (result.status !== "ready")
                return { status: "unavailable", reason: result.reason };
            if (
                result.capture.captureId !== allowed.capture._id ||
                result.capture.contentHash !== allowed.capture.contentHash ||
                result.passage.quotationHash !==
                    sha256Hex(result.passage.quotation) ||
                !quoteIsInCapture(stored.text, result.passage)
            )
                return { status: "unavailable", reason: "capture_corrupt" };
            const requested =
                args.request.kind === "context"
                    ? args.request.range
                    : undefined;
            const range = requested ?? {
                startOffset: Math.max(
                    0,
                    result.passage.startOffset -
                        SOURCE_CONTEXT_NEIGHBOR_CHARACTERS,
                ),
                endOffset: Math.min(
                    stored.text.length,
                    result.passage.endOffset +
                        SOURCE_CONTEXT_NEIGHBOR_CHARACTERS,
                ),
            };
            const offset =
                args.request.kind === "context"
                    ? (args.request.offset ?? range.startOffset)
                    : range.startOffset;
            if (
                ![range.startOffset, range.endOffset, offset].every(
                    Number.isSafeInteger,
                ) ||
                range.startOffset < 0 ||
                range.endOffset > stored.text.length ||
                range.startOffset > result.passage.startOffset ||
                range.endOffset < result.passage.endOffset ||
                offset < range.startOffset ||
                offset >= range.endOffset
            )
                return {
                    status: "unavailable",
                    reason: "material_continuation_invalid",
                };
            const page = capturePage(stored.text, offset, range.endOffset);
            return {
                status: "ready",
                kind: "context",
                document,
                captureId: result.capture.captureId,
                contentHash: result.capture.contentHash,
                captureOmittedPassageCount:
                    allowed.capture.omittedPassageCount ?? null,
                passage: {
                    ...result.passage,
                    surroundingText: page.text,
                    contextStartOffset: offset,
                    contextEndOffset: page.range.endOffset,
                    contextRange: range,
                    captureCharacters: stored.text.length,
                },
            };
        };
        if (args.request.kind === "contexts") {
            const contexts = [];
            for (const order of new Set(args.request.passageOrders)) {
                const reading = await readContext(order);
                if (reading.status !== "ready") return reading;
                contexts.push(reading);
            }
            return { status: "ready", kind: "contexts", contexts };
        }
        return readContext(args.request.passageOrder);
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
        return ensureApprovedIndex(
            ctx,
            allowed,
            (identity, passages) =>
                ctx.runMutation(internal.sourceRetrieval.putApprovedBatch, {
                    ...args,
                    ...identity,
                    passages,
                }),
            (identity, candidateCount) =>
                ctx.runMutation(internal.sourceRetrieval.finishApprovedIndex, {
                    ...args,
                    ...identity,
                    candidateCount,
                }),
        );
    },
});

/** Indexes a mission's frozen approved capture and revalidates authority for every persisted batch. */
export const ensureApprovedSourceIndexForMission = internalAction({
    args: missionApprovedSourceScope,
    handler: async (
        ctx,
        args,
    ): Promise<
        { status: "ready" } | { status: "unavailable"; reason: string }
    > => {
        const allowed = await ctx.runQuery(
            internal.sourceRetrieval.approvedCaptureForMission,
            args,
        );
        return ensureMissionApprovedIndex(ctx, args, allowed);
    },
});
