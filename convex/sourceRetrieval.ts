import { requireSavedMaterialScope } from "@convex/domain/savedMaterialInspection";
import { sha256Hex } from "@convex/domain/sourcePassages";
import {
    assertPreparationExecutionFence,
    readPreparationSourceDecision,
    sourcePreparationError,
} from "@convex/domain/sourcePreparationAuthority";
import {
    readCaptureIndexState,
    SOURCE_RETRIEVAL_VERSION,
    sourceEmbeddingScopeKey,
} from "@convex/domain/sourceRetrievalPolicy";
import { SourceReviewReads } from "@convex/domain/sourceReviewReads";
import { type Infer, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, query } from "./_generated/server";
import {
    requireDossierAuthority,
    requireMissionAuthority,
} from "./execution/authority";
import {
    MAX_SOURCE_EMBEDDING_BATCH_TEXTS,
    MAX_SOURCE_EMBEDDING_TEXT_BYTES,
    MAX_SOURCE_SEARCH_CANDIDATES,
    SOURCE_EMBEDDING_DIMENSIONS,
} from "./resourceLimits";
import schema from "./schema";
import { authorizeReviewRead } from "./sources";

const passage = v.object({
    order: v.number(),
    startOffset: v.number(),
    endOffset: v.number(),
    quotation: v.string(),
    headingPath: v.array(v.string()),
});
const scopeKey = (
    p: Pick<
        Doc<"sourceSelectionProposalRebuilds">,
        "runId" | "corpusRevisionId"
    >,
) => `${p.runId}:${p.corpusRevisionId}:${SOURCE_RETRIEVAL_VERSION}`;

async function eligibleCapture(
    ctx: QueryCtx,
    preparation: Doc<"sourceSelectionProposalRebuilds">,
    captureId: Id<"sourceCaptures">,
    retained?: Doc<"sourceCaptures">,
) {
    const capture = retained ?? (await ctx.db.get(captureId));
    if (
        !capture ||
        capture.runId !== preparation.runId ||
        capture.status !== "committed" ||
        !capture.contentHash ||
        (await readPreparationSourceDecision(ctx.db, {
            runId: preparation.runId,
            corpusRevisionId: preparation.corpusRevisionId,
            sourceId: capture.sourceId,
        })) === "rejected"
    ) {
        throw sourcePreparationError("capture_unavailable");
    }
    return { ...capture, contentHash: capture.contentHash };
}

async function putCaptureBatch(
    ctx: MutationCtx,
    capture: Doc<"sourceCaptures"> & { contentHash: string },
    key: string,
    passages: Infer<typeof passage>[],
) {
    if (passages.length > 64)
        throw sourcePreparationError("retrieval_batch_limit");
    let inserted = 0;
    for (const p of passages) {
        if (
            !Number.isSafeInteger(p.order) ||
            p.order < 0 ||
            !Number.isSafeInteger(p.startOffset) ||
            !Number.isSafeInteger(p.endOffset) ||
            p.startOffset < 0 ||
            p.endOffset - p.startOffset !== p.quotation.length ||
            !p.quotation.length ||
            p.quotation.length > 4000 ||
            p.endOffset > (capture.byteCount ?? 0) ||
            p.headingPath.join(" ").length > 4000
        )
            throw sourcePreparationError("retrieval_passage_invalid");
        const existing = await ctx.db
            .query("sourceSearchPassages")
            .withIndex("by_scope_capture_order", (q) =>
                q
                    .eq("scopeKey", key)
                    .eq("captureId", capture._id)
                    .eq("order", p.order),
            )
            .unique();
        if (existing) {
            if (
                existing.contentHash !== capture.contentHash ||
                existing.startOffset !== p.startOffset ||
                existing.endOffset !== p.endOffset ||
                existing.quotation !== p.quotation ||
                existing.headingPath.join("\n") !== p.headingPath.join("\n")
            )
                throw sourcePreparationError("retrieval_identity_conflict");
            continue;
        }
        await ctx.db.insert("sourceSearchPassages", {
            ...p,
            scopeKey: key,
            captureId: capture._id,
            sourceId: capture.sourceId,
            contentHash: capture.contentHash,
            policyVersion: SOURCE_RETRIEVAL_VERSION,
            quotationHash: sha256Hex(p.quotation),
            searchText: [...p.headingPath, p.quotation].join("\n"),
        });
        inserted++;
    }
    return inserted;
}

/** Derived preparation rows are neither approved analytical passages nor a new persistence authority. */
export const putBatch = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        captureId: v.id("sourceCaptures"),
        passages: v.array(passage),
    },
    returns: v.number(),
    handler: async (ctx, args) => {
        const { preparation } = await assertPreparationExecutionFence(ctx.db, {
            preparationId: args.preparationId,
            now: Date.now(),
        });
        const capture = await eligibleCapture(ctx, preparation, args.captureId);
        return putCaptureBatch(
            ctx,
            capture,
            scopeKey(preparation),
            args.passages,
        );
    },
});

async function searchCapture(
    ctx: QueryCtx,
    preparation: Doc<"sourceSelectionProposalRebuilds">,
    captureId: Id<"sourceCaptures">,
    queryText: string,
) {
    if (queryText.trim().split(/\s+/).length > 16 || queryText.length > 512)
        throw sourcePreparationError("retrieval_query_invalid");
    await eligibleCapture(ctx, preparation, captureId);
    if (!queryText.trim()) return [];
    return ctx.db
        .query("sourceSearchPassages")
        .withSearchIndex("search_text", (q) =>
            q
                .search("searchText", queryText)
                .eq("scopeKey", scopeKey(preparation))
                .eq("captureId", captureId),
        )
        .take(64);
}

export const search = internalQuery({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        query: v.string(),
        captureId: v.id("sourceCaptures"),
    },
    returns: v.array(schema.doc("sourceSearchPassages")),
    handler: async (ctx, args) => {
        const { preparation } = await assertPreparationExecutionFence(ctx.db, {
            preparationId: args.preparationId,
            now: Date.now(),
        });
        return searchCapture(ctx, preparation, args.captureId, args.query);
    },
});

/** Two captures keep native per-capture ranking and bound transaction bytes. */
export const searchBatch = internalQuery({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        query: v.string(),
        captureIds: v.array(v.id("sourceCaptures")),
    },
    returns: v.array(
        v.object({
            captureId: v.id("sourceCaptures"),
            passages: v.array(schema.doc("sourceSearchPassages")),
        }),
    ),
    handler: async (ctx, args) => {
        if (args.captureIds.length > 2)
            throw sourcePreparationError("retrieval_batch_limit");
        const { preparation } = await assertPreparationExecutionFence(ctx.db, {
            preparationId: args.preparationId,
            now: Date.now(),
        });
        return Promise.all(
            args.captureIds.map(async (captureId) => ({
                captureId,
                passages: await searchCapture(
                    ctx,
                    preparation,
                    captureId,
                    args.query,
                ),
            })),
        );
    },
});

export const getCapture = internalQuery({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        captureId: v.id("sourceCaptures"),
    },
    returns: schema.doc("sourceCaptures"),
    handler: async (ctx, args) => {
        const { preparation } = await assertPreparationExecutionFence(ctx.db, {
            preparationId: args.preparationId,
            now: Date.now(),
        });
        return eligibleCapture(ctx, preparation, args.captureId);
    },
});

export const getIndexState = internalQuery({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        captureId: v.id("sourceCaptures"),
    },
    returns: v.union(schema.doc("sourceSearchCaptures"), v.null()),
    handler: async (ctx, args) => {
        const { preparation } = await assertPreparationExecutionFence(ctx.db, {
            preparationId: args.preparationId,
            now: Date.now(),
        });
        await eligibleCapture(ctx, preparation, args.captureId);
        return readCaptureIndexState(ctx.db, preparation, args.captureId);
    },
});

/** Capture metadata and index readiness share one authorization snapshot. */
export const getCaptureIndexBatch = internalQuery({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        captureIds: v.array(v.id("sourceCaptures")),
    },
    returns: v.array(
        v.object({
            capture: schema.doc("sourceCaptures"),
            state: v.union(schema.doc("sourceSearchCaptures"), v.null()),
        }),
    ),
    handler: async (ctx, args) => {
        if (args.captureIds.length > 8)
            throw sourcePreparationError("retrieval_batch_limit");
        const { preparation } = await assertPreparationExecutionFence(ctx.db, {
            preparationId: args.preparationId,
            now: Date.now(),
        });
        return Promise.all(
            args.captureIds.map(async (captureId) => ({
                capture: await eligibleCapture(ctx, preparation, captureId),
                state: await readCaptureIndexState(
                    ctx.db,
                    preparation,
                    captureId,
                ),
            })),
        );
    },
});

async function publishCaptureIndex(
    ctx: MutationCtx,
    capture: Doc<"sourceCaptures"> & { contentHash: string },
    key: string,
    args: {
        candidateCount: number;
        embeddingProfile?: string;
        embeddingDegradationReason?: string;
    },
) {
    if (
        !Number.isSafeInteger(args.candidateCount) ||
        args.candidateCount < 0 ||
        args.candidateCount > MAX_SOURCE_SEARCH_CANDIDATES
    )
        throw sourcePreparationError("retrieval_index_invalid");
    const existing = await ctx.db
        .query("sourceSearchCaptures")
        .withIndex("by_scope_and_capture", (q) =>
            q.eq("scopeKey", key).eq("captureId", capture._id),
        )
        .unique();
    const value = {
        scopeKey: key,
        captureId: capture._id,
        contentHash: capture.contentHash,
        candidateCount: args.candidateCount,
        embeddingProfile: args.embeddingProfile,
        embeddingDegradationReason: args.embeddingDegradationReason,
    };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert("sourceSearchCaptures", value);
    return null;
}

export const finishIndex = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        captureId: v.id("sourceCaptures"),
        candidateCount: v.number(),
        embeddingProfile: v.optional(v.string()),
        embeddingDegradationReason: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const { preparation } = await assertPreparationExecutionFence(ctx.db, {
            preparationId: args.preparationId,
            now: Date.now(),
        });
        const capture = await eligibleCapture(ctx, preparation, args.captureId);
        return publishCaptureIndex(ctx, capture, scopeKey(preparation), args);
    },
});

/** Reads the bounded text batch; exact-text cache lookup has one owner in cachedVectors. */
export const getEmbeddingBatch = internalQuery({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        captureId: v.id("sourceCaptures"),
        orders: v.array(v.number()),
    },
    returns: v.array(schema.doc("sourceSearchPassages")),
    handler: async (ctx, args) => {
        const { preparation } = await assertPreparationExecutionFence(ctx.db, {
            preparationId: args.preparationId,
            now: Date.now(),
        });
        await eligibleCapture(ctx, preparation, args.captureId);
        if (args.orders.length > MAX_SOURCE_EMBEDDING_BATCH_TEXTS)
            throw sourcePreparationError("retrieval_batch_limit");
        return Promise.all(
            args.orders.map(async (order) => {
                const row = await ctx.db
                    .query("sourceSearchPassages")
                    .withIndex("by_scope_capture_order", (q) =>
                        q
                            .eq("scopeKey", scopeKey(preparation))
                            .eq("captureId", args.captureId)
                            .eq("order", order),
                    )
                    .unique();
                if (!row)
                    throw sourcePreparationError("retrieval_index_incomplete");
                return row;
            }),
        );
    },
});

/** Attaches only receipt-validated cached vectors, without passing dense arrays back through the caller. */
export const commitEmbeddings = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        captureId: v.id("sourceCaptures"),
        profile: v.string(),
        ids: v.array(v.id("sourceSearchPassages")),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const { preparation } = await assertPreparationExecutionFence(ctx.db, {
            preparationId: args.preparationId,
            now: Date.now(),
        });
        await eligibleCapture(ctx, preparation, args.captureId);
        if (args.ids.length > MAX_SOURCE_EMBEDDING_BATCH_TEXTS)
            throw sourcePreparationError("retrieval_batch_limit");
        for (const id of args.ids) {
            const row = await ctx.db.get(id);
            if (
                !row ||
                row.scopeKey !== scopeKey(preparation) ||
                row.captureId !== args.captureId
            )
                throw sourcePreparationError("retrieval_passage_invalid");
            const cached = await ctx.db
                .query("sourceEmbeddingCache")
                .withIndex("by_profile_and_hash", (q) =>
                    q
                        .eq("profile", args.profile)
                        .eq("textHash", sha256Hex(row.searchText)),
                )
                .unique();
            if (
                !cached ||
                cached.vector.length !== SOURCE_EMBEDDING_DIMENSIONS ||
                cached.vector.some((n) => !Number.isFinite(n)) ||
                !cached.vector.some((n) => n !== 0)
            )
                throw sourcePreparationError("embedding_receipt_invalid");
            await ctx.db.patch(row._id, {
                embedding: cached.vector,
                embeddingProfile: args.profile,
                embeddingScopeKey: sourceEmbeddingScopeKey(
                    scopeKey(preparation),
                    args.profile,
                    args.captureId,
                ),
            });
        }
        return null;
    },
});

export const getVectorResults = internalQuery({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        captureIds: v.array(v.id("sourceCaptures")),
        ids: v.array(v.id("sourceSearchPassages")),
        profile: v.string(),
    },
    returns: v.array(schema.doc("sourceSearchPassages")),
    handler: async (ctx, args) => {
        const { preparation } = await assertPreparationExecutionFence(ctx.db, {
            preparationId: args.preparationId,
            now: Date.now(),
        });
        if (args.captureIds.length > 60 || args.ids.length > 256)
            throw sourcePreparationError("retrieval_batch_limit");
        for (const id of args.captureIds)
            await eligibleCapture(ctx, preparation, id);
        const allowed = new Set(args.captureIds);
        const rows = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
        return rows.filter(
            (row): row is Doc<"sourceSearchPassages"> =>
                row !== null &&
                row.scopeKey === scopeKey(preparation) &&
                allowed.has(row.captureId) &&
                row.embeddingProfile === args.profile,
        );
    },
});

export const cachedVectors = internalQuery({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        profile: v.string(),
        texts: v.array(v.string()),
    },
    returns: v.array(v.union(v.array(v.float64()), v.null())),
    handler: async (ctx, args) => {
        await assertPreparationExecutionFence(ctx.db, {
            preparationId: args.preparationId,
            now: Date.now(),
        });
        if (
            args.texts.length > MAX_SOURCE_EMBEDDING_BATCH_TEXTS ||
            args.texts.some(
                (text) =>
                    new TextEncoder().encode(text).length >
                    MAX_SOURCE_EMBEDDING_TEXT_BYTES,
            )
        )
            throw sourcePreparationError("retrieval_batch_limit");
        return Promise.all(
            args.texts.map(
                async (text) =>
                    (
                        await ctx.db
                            .query("sourceEmbeddingCache")
                            .withIndex("by_profile_and_hash", (q) =>
                                q
                                    .eq("profile", args.profile)
                                    .eq("textHash", sha256Hex(text)),
                            )
                            .unique()
                    )?.vector ?? null,
            ),
        );
    },
});

export const saveCachedVectors = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        profile: v.string(),
        providerCallId: v.id("providerCalls"),
        texts: v.array(v.string()),
        vectors: v.array(v.array(v.float64())),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const { preparation } = await assertPreparationExecutionFence(ctx.db, {
            preparationId: args.preparationId,
            now: Date.now(),
        });
        const call = await ctx.db.get(args.providerCallId);
        if (
            !args.texts.length ||
            args.texts.length > MAX_SOURCE_EMBEDDING_BATCH_TEXTS ||
            args.texts.length !== args.vectors.length ||
            args.texts.some(
                (text) =>
                    new TextEncoder().encode(text).length >
                    MAX_SOURCE_EMBEDDING_TEXT_BYTES,
            ) ||
            call?.status !== "succeeded" ||
            call.operation !== "source_embedding" ||
            call.preparationId !== preparation._id ||
            call.executionGeneration !== preparation.executionGeneration ||
            call.inputHash !==
                sha256Hex(
                    JSON.stringify({
                        profile: args.profile,
                        texts: args.texts,
                    }),
                )
        )
            throw sourcePreparationError("embedding_receipt_invalid");
        for (const [i, text] of args.texts.entries()) {
            const vector = args.vectors[i];
            if (!vector)
                throw sourcePreparationError("embedding_vector_invalid");
            if (
                vector.length !== SOURCE_EMBEDDING_DIMENSIONS ||
                vector.some((n) => !Number.isFinite(n)) ||
                !vector.some((n) => n !== 0)
            )
                throw sourcePreparationError("embedding_vector_invalid");
            const textHash = sha256Hex(text);
            const existing = await ctx.db
                .query("sourceEmbeddingCache")
                .withIndex("by_profile_and_hash", (q) =>
                    q.eq("profile", args.profile).eq("textHash", textHash),
                )
                .unique();
            if (!existing)
                await ctx.db.insert("sourceEmbeddingCache", {
                    profile: args.profile,
                    textHash,
                    vector,
                });
        }
        return null;
    },
});

export const approvedSourceScope = {
    runId: v.id("researchRuns"),
    corpusRevisionId: v.id("corpusRevisions"),
    sourceId: v.id("sources"),
};

/** Approved reading is independent of execution state, but never of ownership and frozen membership. */
async function approvedCapture(
    ctx: QueryCtx,
    args: {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        sourceId: Id<"sources">;
    },
) {
    await authorizeReviewRead(ctx, args, sourcePreparationError);
    return validateApprovedCapture(ctx, args);
}

async function validateApprovedCapture(
    ctx: QueryCtx,
    args: {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        sourceId: Id<"sources">;
    },
) {
    const revision = await ctx.db.get(args.corpusRevisionId);
    if (
        revision?.runId !== args.runId ||
        revision.status !== "approved" ||
        (await readPreparationSourceDecision(ctx.db, args)) !== "accepted"
    )
        throw sourcePreparationError("source_not_approved");
    return validatePreparedCapture(
        ctx,
        args,
        await approvedCaptureProposal(ctx, revision),
    );
}

async function approvedCaptureProposal(
    ctx: QueryCtx,
    revision: Doc<"corpusRevisions">,
) {
    const proposal = revision.sourceSelectionProposalId
        ? await ctx.db.get(revision.sourceSelectionProposalId)
        : null;
    if (
        proposal &&
        (proposal.runId !== revision.runId ||
            proposal.corpusRevisionId !== revision._id)
    )
        throw sourcePreparationError("capture_identity_conflict");
    return proposal;
}

async function validatePreparedCapture(
    ctx: QueryCtx,
    args: {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        sourceId: Id<"sources">;
    },
    proposal: Doc<"sourceSelectionProposals"> | null,
) {
    if (!proposal?.sourcePreparationId)
        return {
            status: "unavailable" as const,
            reason: "no_prepared_capture" as const,
        };
    const item = await ctx.db
        .query("sourceSelectionProposalItems")
        .withIndex("by_proposal_and_source", (q) =>
            q.eq("proposalId", proposal._id).eq("sourceId", args.sourceId),
        )
        .unique();
    const capture = item?.sourceCaptureId
        ? await ctx.db.get(item.sourceCaptureId)
        : null;
    if (
        capture?.status !== "committed" ||
        !capture.storageId ||
        !capture.contentHash ||
        capture.runId !== args.runId ||
        capture.sourceId !== args.sourceId ||
        !(await ctx.db.system.get("_storage", capture.storageId))
    )
        return {
            status: "unavailable" as const,
            reason: "capture_unavailable" as const,
        };
    const key = scopeKey(args);
    const state = await ctx.db
        .query("sourceSearchCaptures")
        .withIndex("by_scope_and_capture", (q) =>
            q.eq("scopeKey", key).eq("captureId", capture._id),
        )
        .unique();
    if (state && state.contentHash !== capture.contentHash)
        throw sourcePreparationError("capture_identity_conflict");
    return {
        status: "available" as const,
        capture: { ...capture, contentHash: capture.contentHash },
        state,
        key,
    };
}

const missionApprovedSourceScope = {
    missionId: v.optional(v.id("agentMissions")),
    runId: v.optional(v.id("researchRuns")),
    expectedGeneration: v.number(),
    sourceId: v.id("sources"),
};

async function missionMaterialOwner(
    ctx: QueryCtx,
    args: {
        missionId?: Id<"agentMissions">;
        runId?: Id<"researchRuns">;
        expectedGeneration: number;
    },
) {
    if (args.missionId) {
        const { mission, run } = await requireMissionAuthority(
            ctx,
            args.missionId,
            args.expectedGeneration,
        );
        return {
            run,
            revision: await requireSavedMaterialScope(ctx, mission, run),
            mission,
            preparation:
                run.sourcesProtocol === "sources_mission_v1" &&
                run.sourcePreparationId
                    ? await ctx.db.get(run.sourcePreparationId)
                    : null,
        };
    }
    if (!args.runId) throw sourcePreparationError("not_authorized");
    const { run } = await requireDossierAuthority(ctx, args.runId);
    if (
        run.executionGeneration !== args.expectedGeneration ||
        !run.activeCorpusRevisionId
    )
        throw sourcePreparationError("stale_execution");
    const revision = await ctx.db.get(run.activeCorpusRevisionId);
    if (revision?.runId !== run._id)
        throw sourcePreparationError("not_authorized");
    return {
        run,
        revision,
        mission: undefined,
        preparation:
            run.sourcesProtocol === "sources_mission_v1" &&
            run.sourcePreparationId
                ? await ctx.db.get(run.sourcePreparationId)
                : null,
    };
}
async function validateMissionApprovedCapture(
    ctx: QueryCtx,
    args: {
        missionId?: Id<"agentMissions">;
        runId?: Id<"researchRuns">;
        expectedGeneration: number;
        sourceId: Id<"sources">;
    },
    owner?: Awaited<ReturnType<typeof missionMaterialOwner>>,
) {
    const { run, revision, mission, preparation } =
        owner ?? (await missionMaterialOwner(ctx, args));
    if (
        run.sourcesProtocol === "sources_mission_v1" &&
        (!mission ||
            ("scope" in mission &&
                ["sources_v1", "workbench_v1"].includes(mission.scope.kind)))
    ) {
        if (
            (await readPreparationSourceDecision(ctx.db, {
                runId: run._id,
                corpusRevisionId: revision._id,
                sourceId: args.sourceId,
            })) === "rejected"
        )
            throw sourcePreparationError("source_rejected");
        const ids = preparation?.sourcesMission?.captureIds ?? [];
        const captures = ids.length
            ? await ctx.db
                  .query("sourceCaptures")
                  .withIndex("by_source_and_status_and_updated_at", (q) =>
                      q.eq("sourceId", args.sourceId).eq("status", "committed"),
                  )
                  .order("desc")
                  .filter((q) =>
                      q.or(...ids.map((id) => q.eq(q.field("_id"), id))),
                  )
                  .take(ids.length + 1)
            : [];
        const candidate = captures[0];
        if (
            !preparation ||
            !candidate?.storageId ||
            !(await ctx.db.system.get("_storage", candidate.storageId))
        )
            return {
                status: "unavailable" as const,
                reason: "no_prepared_capture" as const,
            };
        const capture = await eligibleCapture(
            ctx,
            preparation,
            candidate._id,
            candidate,
        );
        const key = scopeKey(preparation);
        const state = await ctx.db
            .query("sourceSearchCaptures")
            .withIndex("by_scope_and_capture", (q) =>
                q.eq("scopeKey", key).eq("captureId", capture._id),
            )
            .unique();
        if (state && state.contentHash !== capture.contentHash)
            throw sourcePreparationError("capture_identity_conflict");
        return { status: "available" as const, capture, state, key };
    }
    return validateApprovedCapture(ctx, {
        runId: run._id,
        corpusRevisionId: revision._id,
        sourceId: args.sourceId,
    });
}

export type MissionApprovedCapture = Awaited<
    ReturnType<typeof validateMissionApprovedCapture>
>;

/** Uses persisted mission authority while retaining the same frozen capture checks as interactive reads. */
export const approvedCaptureForMission = internalQuery({
    args: missionApprovedSourceScope,
    handler: validateMissionApprovedCapture,
});

const missionCaptureListingArgs = {
    missionId: v.id("agentMissions"),
    expectedGeneration: v.number(),
    sourceIds: v.array(v.id("sources")),
};
const captureAvailabilityValidator = v.object({
    sourceId: v.id("sources"),
    captureId: v.id("sourceCaptures"),
    contentHash: v.string(),
    readingCompleteness:
        schema.doc("sourceCaptures").fields.readingCompleteness,
    representationCompleteness:
        schema.doc("sourceCaptures").fields.representationCompleteness,
    captureOmittedPassageCount: v.union(v.number(), v.null()),
    index: v.union(
        v.object({ status: v.literal("not_indexed") }),
        v.object({
            status: v.literal("indexed"),
            candidateCount: v.number(),
            coverage: v.literal("bounded_candidates"),
        }),
    ),
});
function captureAvailability(
    capture: Doc<"sourceCaptures">,
    state: Doc<"sourceSearchCaptures"> | null,
) {
    return {
        sourceId: capture.sourceId,
        captureId: capture._id,
        contentHash: capture.contentHash ?? "",
        readingCompleteness: capture.readingCompleteness,
        representationCompleteness: capture.representationCompleteness,
        captureOmittedPassageCount: capture.omittedPassageCount ?? null,
        index: state
            ? {
                  status: "indexed" as const,
                  candidateCount: state.candidateCount,
                  coverage: "bounded_candidates" as const,
              }
            : { status: "not_indexed" as const },
    };
}
/** One authorized traversal supplies both identity-only and descriptive bounded availability. */
async function readMissionCaptureAvailability(
    ctx: QueryCtx,
    args: Infer<typeof missionCaptureListingValidator>,
) {
    if (args.sourceIds.length > 60)
        throw sourcePreparationError("context_capacity");
    const owner = await missionMaterialOwner(ctx, args);
    const { mission, run, revision } = owner;
    const proposal = await approvedCaptureProposal(ctx, revision);
    const available = await Promise.all(
        args.sourceIds.map(async (sourceId) => {
            const scope = {
                runId: run._id,
                corpusRevisionId: revision._id,
                sourceId,
            };
            if (
                run.sourcesProtocol === "sources_mission_v1" &&
                mission &&
                "scope" in mission &&
                mission.scope.kind === "workbench_v1"
            ) {
                if (
                    (await readPreparationSourceDecision(ctx.db, scope)) ===
                    "rejected"
                )
                    return null;
                const prepared = await validateMissionApprovedCapture(
                    ctx,
                    {
                        ...args,
                        sourceId,
                    },
                    owner,
                );
                return prepared.status === "available"
                    ? captureAvailability(prepared.capture, prepared.state)
                    : null;
            }
            if (
                (await readPreparationSourceDecision(ctx.db, scope)) !==
                "accepted"
            )
                return null;
            const capture = await validatePreparedCapture(ctx, scope, proposal);
            return capture.status === "available"
                ? captureAvailability(capture.capture, capture.state)
                : null;
        }),
    );
    return available.filter((sourceId) => sourceId !== null);
}
const missionCaptureListingValidator = v.object(missionCaptureListingArgs);
export const availableCapturesForMission = internalQuery({
    args: missionCaptureListingArgs,
    returns: v.array(v.id("sources")),
    handler: async (ctx, args) =>
        (await readMissionCaptureAvailability(ctx, args)).map(
            (capture) => capture.sourceId,
        ),
});
export const availableCaptureMetadataForMission = internalQuery({
    args: missionCaptureListingArgs,
    returns: v.array(captureAvailabilityValidator),
    handler: readMissionCaptureAvailability,
});

async function searchApprovedCapture(
    ctx: QueryCtx,
    args: {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        sourceId: Id<"sources">;
        query: string;
    },
    allowed: Awaited<ReturnType<typeof approvedCapture>>,
) {
    if (allowed.status !== "available") return allowed;
    if (args.query.length > 512 || args.query.trim().split(/\s+/).length > 16)
        throw sourcePreparationError("retrieval_query_invalid");
    if (!allowed.state) return { status: "not_indexed" as const };
    const { capture, key } = allowed;
    const rows = args.query.trim()
        ? await ctx.db
              .query("sourceSearchPassages")
              .withSearchIndex("search_text", (q) =>
                  q
                      .search("searchText", args.query)
                      .eq("scopeKey", key)
                      .eq("captureId", capture._id),
              )
              .take(64)
        : [];
    if (
        rows.some(
            (row) =>
                row.contentHash !== capture.contentHash ||
                row.sourceId !== capture.sourceId ||
                row.quotationHash !== sha256Hex(row.quotation),
        )
    )
        throw sourcePreparationError("capture_identity_conflict");
    return {
        status: "ready" as const,
        corpusRevisionId: args.corpusRevisionId,
        sourceId: args.sourceId,
        captureId: capture._id,
        contentHash: capture.contentHash,
        canonicalUrl: capture.resolvedUrl ?? capture.requestedUrl,
        retrievedAt: capture.retrievedAt ?? null,
        passages: rows.map(
            ({
                order,
                startOffset,
                endOffset,
                quotation,
                quotationHash,
                headingPath,
            }) => ({
                order,
                startOffset,
                endOffset,
                quotation,
                quotationHash,
                headingPath,
            }),
        ),
        limitReached: rows.length === 64,
    };
}

export const searchApprovedSourceForMission = internalQuery({
    args: { ...missionApprovedSourceScope, query: v.string() },
    handler: async (ctx, args) => {
        const allowed = await validateMissionApprovedCapture(ctx, args);
        const { run, revision } = await missionMaterialOwner(ctx, args);
        return searchApprovedCapture(
            ctx,
            {
                runId: run._id,
                corpusRevisionId: revision._id,
                sourceId: args.sourceId,
                query: args.query,
            },
            allowed,
        );
    },
});

async function approvedMissionPassages(
    ctx: QueryCtx,
    args: {
        missionId?: Id<"agentMissions">;
        runId?: Id<"researchRuns">;
        expectedGeneration: number;
        sourceId: Id<"sources">;
        passageOrders: number[];
    },
) {
    if (
        !args.passageOrders.length ||
        args.passageOrders.length > 128 ||
        args.passageOrders.some(
            (order) => !Number.isSafeInteger(order) || order < 0,
        )
    )
        throw sourcePreparationError("retrieval_passage_invalid");
    const owner = await missionMaterialOwner(ctx, args);
    const allowed = await validateMissionApprovedCapture(ctx, args, owner);
    if (allowed.status !== "available") return allowed;
    if (!allowed.state)
        return {
            status: "unavailable" as const,
            reason: "not_indexed" as const,
        };
    const reads = new SourceReviewReads(ctx.db, owner.run._id);
    await reads.prefetchPassages(
        owner.revision._id,
        args.passageOrders.map((passageOrder) => ({
            captureId: allowed.capture._id,
            passageOrder,
        })),
    );
    const passages = [];
    for (const order of new Set(args.passageOrders)) {
        const row = await reads.passage(
            owner.revision._id,
            allowed.capture._id,
            order,
        );
        if (!row)
            return {
                status: "unavailable" as const,
                reason: "passage_unavailable" as const,
            };
        if (
            row.contentHash !== allowed.capture.contentHash ||
            row.sourceId !== args.sourceId ||
            row.quotationHash !== sha256Hex(row.quotation) ||
            row.endOffset - row.startOffset !== row.quotation.length
        )
            throw sourcePreparationError("capture_identity_conflict");
        passages.push({
            order: row.order,
            startOffset: row.startOffset,
            endOffset: row.endOffset,
            quotation: row.quotation,
            quotationHash: row.quotationHash,
            headingPath: row.headingPath,
        });
    }
    return {
        status: "ready" as const,
        capture: {
            captureId: allowed.capture._id,
            contentHash: allowed.capture.contentHash,
            storageId: allowed.capture.storageId,
            byteCount: allowed.capture.byteCount,
        },
        passages,
    };
}

/** One authority/capture check for a bounded set of exact contextual passages. */
export const approvedPassagesForMission = internalQuery({
    args: { ...missionApprovedSourceScope, passageOrders: v.array(v.number()) },
    returns: v.union(
        v.object({
            status: v.literal("unavailable"),
            reason: v.union(
                v.literal("no_prepared_capture"),
                v.literal("capture_unavailable"),
                v.literal("not_indexed"),
                v.literal("passage_unavailable"),
            ),
        }),
        v.object({
            status: v.literal("ready"),
            capture: v.object({
                captureId: v.id("sourceCaptures"),
                contentHash: v.string(),
                storageId: v.optional(v.id("_storage")),
                byteCount: v.optional(v.number()),
            }),
            passages: v.array(passage.extend({ quotationHash: v.string() })),
        }),
    ),
    handler: approvedMissionPassages,
});

export const approvedPassageForMission = internalQuery({
    args: { ...missionApprovedSourceScope, passageOrder: v.number() },
    handler: async (ctx, args) => {
        const result = await approvedMissionPassages(ctx, {
            ...args,
            passageOrders: [args.passageOrder],
        });
        if (result.status !== "ready") return result;
        const passage = result.passages[0];
        if (!passage) throw sourcePreparationError("capture_identity_conflict");
        return { status: "ready" as const, capture: result.capture, passage };
    },
});

export const getApprovedCapture = internalQuery({
    args: approvedSourceScope,
    handler: approvedCapture,
});

export const putApprovedBatch = internalMutation({
    args: {
        ...approvedSourceScope,
        captureId: v.id("sourceCaptures"),
        contentHash: v.string(),
        passages: v.array(passage),
    },
    handler: async (ctx, args) => {
        const allowed = await approvedCapture(ctx, args);
        if (
            allowed.status !== "available" ||
            allowed.capture._id !== args.captureId ||
            allowed.capture.contentHash !== args.contentHash
        )
            throw sourcePreparationError("capture_unavailable");
        return putCaptureBatch(
            ctx,
            allowed.capture,
            allowed.key,
            args.passages,
        );
    },
});

export const putApprovedBatchForMission = internalMutation({
    args: {
        ...missionApprovedSourceScope,
        captureId: v.id("sourceCaptures"),
        contentHash: v.string(),
        passages: v.array(passage),
    },
    handler: async (ctx, args) => {
        const allowed = await validateMissionApprovedCapture(ctx, args);
        if (
            allowed.status !== "available" ||
            allowed.capture._id !== args.captureId ||
            allowed.capture.contentHash !== args.contentHash
        )
            throw sourcePreparationError("capture_unavailable");
        return putCaptureBatch(
            ctx,
            allowed.capture,
            allowed.key,
            args.passages,
        );
    },
});

export const finishApprovedIndexForMission = internalMutation({
    args: {
        ...missionApprovedSourceScope,
        captureId: v.id("sourceCaptures"),
        contentHash: v.string(),
        candidateCount: v.number(),
    },
    handler: async (ctx, args) => {
        const allowed = await validateMissionApprovedCapture(ctx, args);
        if (
            allowed.status !== "available" ||
            allowed.capture._id !== args.captureId ||
            allowed.capture.contentHash !== args.contentHash
        )
            throw sourcePreparationError("capture_unavailable");
        if (allowed.state) return null;
        return publishCaptureIndex(ctx, allowed.capture, allowed.key, args);
    },
});

export const finishApprovedIndex = internalMutation({
    args: {
        ...approvedSourceScope,
        captureId: v.id("sourceCaptures"),
        contentHash: v.string(),
        candidateCount: v.number(),
    },
    handler: async (ctx, args) => {
        const allowed = await approvedCapture(ctx, args);
        if (
            allowed.status !== "available" ||
            allowed.capture._id !== args.captureId ||
            allowed.capture.contentHash !== args.contentHash
        )
            throw sourcePreparationError("capture_unavailable");
        // Repeated readers reuse an already completed index, including any existing embedding metadata.
        if (allowed.state) return null;
        return publishCaptureIndex(ctx, allowed.capture, allowed.key, args);
    },
});

/** Returns captured quotations, not approved claims or materialized analytical passages. */
export const searchApprovedSource = query({
    args: { ...approvedSourceScope, query: v.string() },
    handler: async (ctx, args) => {
        const allowed = await approvedCapture(ctx, args);
        return searchApprovedCapture(ctx, args, allowed);
    },
});

/** Exposes the same immutable preparation identity to bounded documentary controls. */
export const captureIdentityForPreparation = internalQuery({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        captureId: v.id("sourceCaptures"),
    },
    returns: v.object({ sourceId: v.id("sources"), contentHash: v.string() }),
    handler: async (ctx, args) => {
        const { preparation } = await assertPreparationExecutionFence(ctx.db, {
            ...args,
            now: Date.now(),
        });
        if (!preparation.sourcesMission?.captureIds.includes(args.captureId))
            throw sourcePreparationError("capture_unavailable");
        const capture = await eligibleCapture(ctx, preparation, args.captureId);
        return { sourceId: capture.sourceId, contentHash: capture.contentHash };
    },
});
