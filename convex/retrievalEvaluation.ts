import {
    SOURCE_RETRIEVAL_VERSION,
    sourceEmbeddingScopeKey,
} from "@convex/domain/sourceRetrievalPolicy";
/** Local, internal fixture operations for the frozen retrieval experiment. Never exposes test endpoints. */

import {
    extractPassagesFromNormalizedText,
    sha256Hex,
} from "@convex/domain/sourcePassages";
import { assertPreparationExecutionFence } from "@convex/domain/sourcePreparationAuthority";
import {
    SOURCE_EMBEDDING_PROFILE,
    validateEmbeddingVectors,
} from "@convex/integrations/sourceEmbeddings";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
    env,
    internalAction,
    internalMutation,
    internalQuery,
} from "./_generated/server";
import { MAX_PASSAGES_PER_SOURCE } from "./resourcePolicy";
import schema from "./schema";
import { createSourceSelectionProposal } from "./sourceSelectionProposals";

export function assertLocalFixture() {
    if (
        env.E2E_FIXTURES_ENABLED !== "true" ||
        !["127.0.0.1", "localhost"].includes(
            new URL(env.CONVEX_CLOUD_URL).hostname,
        )
    )
        throw new Error("Local retrieval fixtures are disabled");
}
export const seed = internalMutation({
    args: {
        slotKey: v.string(),
        fixtureKey: v.string(),
        company: v.object({
            cik: v.string(),
            legalName: v.string(),
            ticker: v.string(),
        }),
    },
    returns: v.object({
        runId: v.id("researchRuns"),
        preparationId: v.id("sourceSelectionProposalRebuilds"),
    }),
    handler: async (
        ctx,
        args,
    ): Promise<{
        runId: Id<"researchRuns">;
        preparationId: Id<"sourceSelectionProposalRebuilds">;
    }> => {
        assertLocalFixture();
        if (!/^[a-z0-9-]{1,80}$/.test(args.fixtureKey))
            throw new Error("Invalid retrieval fixture key");
        const invitation = await ctx.db
            .query("invitations")
            .withIndex("by_slot_key", (q) => q.eq("slotKey", args.slotKey))
            .unique();
        const visitor = invitation?.claimedByVisitorId
            ? await ctx.db.get(invitation.claimedByVisitorId)
            : null;
        if (invitation?.status !== "claimed" || visitor?.status !== "active")
            throw new Error("Admitted fixture visitor required");
        const reservationKey = `retrieval-evaluation:${args.fixtureKey}`;
        const existing = await ctx.db
            .query("researchRuns")
            .withIndex("by_owner_and_reservation_key", (q) =>
                q
                    .eq("ownerVisitorId", visitor._id)
                    .eq("reservationKey", reservationKey),
            )
            .unique();
        if (existing?.sourcePreparationId) {
            if (existing.purpose && existing.purpose !== "evaluation")
                throw new Error(
                    "Evaluation reservation belongs to another purpose",
                );
            return {
                runId: existing._id,
                preparationId: existing.sourcePreparationId,
            };
        }
        if (
            await ctx.db
                .query("researchRuns")
                .withIndex("by_owner_and_execution_status", (q) =>
                    q
                        .eq("ownerVisitorId", visitor._id)
                        .eq("executionStatus", "running"),
                )
                .first()
        )
            throw new Error("Visitor execution slot occupied");
        const now = Date.now();
        let company = await ctx.db
            .query("companies")
            .withIndex("by_cik", (q) => q.eq("cik", args.company.cik))
            .unique();
        if (!company) {
            const id = await ctx.db.insert("companies", {
                ...args.company,
                exchange: "Fixture",
                canonicalizedAt: now,
            });
            company = await ctx.db.get(id);
        }
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "evaluation",
            ownerVisitorId: visitor._id,
            companyId: company?._id,
            reservationKey,
            coveragePreset: "balanced",
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            executionGeneration: 1,
            workflowVersion: 1,
            nextEventSequence: 1,
            createdAt: now,
            updatedAt: now,
        });
        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "draft",
            createdAt: now,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });
        const preparationId = await ctx.runMutation(
            internal.sourcePreparation.claimForDiscovery,
            { runId, corpusRevisionId, expectedExecutionGeneration: 1 },
        );
        // Evaluation has no provider workflow. A longer bounded lease permits the offline upload/import phases.
        await ctx.db.patch(preparationId, {
            retrievalVersion: SOURCE_RETRIEVAL_VERSION,
            retrievalMode: "lexical",
            deadlineAt: now + 2 * 60 * 60 * 1000,
            leaseExpiresAt: now + 2 * 60 * 60 * 1000,
        });
        return { runId, preparationId };
    },
});
export const authorize = internalQuery({
    args: { preparationId: v.id("sourceSelectionProposalRebuilds") },
    returns: schema.doc("sourceSelectionProposalRebuilds"),
    handler: async (ctx, args) => {
        assertLocalFixture();
        const state = await assertPreparationExecutionFence(ctx.db, {
            ...args,
            now: Date.now(),
        });
        if (!state.run.reservationKey?.startsWith("retrieval-evaluation:"))
            throw new Error("Evaluation scope required");
        return state.preparation;
    },
});
export const commitDocument = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        documentKey: v.string(),
        url: v.string(),
        title: v.string(),
        storageId: v.id("_storage"),
        contentHash: v.string(),
        byteCount: v.number(),
    },
    returns: v.id("sourceCaptures"),
    handler: async (ctx, args): Promise<Id<"sourceCaptures">> => {
        const p = await ctx.runQuery(internal.retrievalEvaluation.authorize, {
            preparationId: args.preparationId,
        });
        if (
            args.byteCount > 16 * 1024 * 1024 ||
            !/^[a-f0-9]{64}$/.test(args.contentHash)
        )
            throw new Error("Invalid evaluation capture");
        const key = `evaluation:${p._id}:${args.documentKey}`;
        const previous = await ctx.db
            .query("sourceCaptures")
            .withIndex("by_capture_key", (q) => q.eq("captureKey", key))
            .unique();
        if (previous) {
            if (previous.contentHash !== args.contentHash)
                throw new Error("Frozen evaluation capture changed");
            return previous._id;
        }
        const sourceId = await ctx.db.insert("sources", {
            runId: p.runId,
            canonicalUrl: args.url,
            title: `[Retrieval fixture] ${args.title}`,
            origin: "exa",
            category: "official_product",
            createdAt: Date.now(),
        });
        return ctx.db.insert("sourceCaptures", {
            runId: p.runId,
            corpusRevisionId: p.corpusRevisionId,
            sourceId,
            preparationId: p._id,
            executionGeneration: p.executionGeneration,
            captureKey: key,
            requestInputHash: sha256Hex(key),
            status: "committed",
            requestedUrl: args.url,
            storageId: args.storageId,
            contentHash: args.contentHash,
            byteCount: args.byteCount,
            normalizerVersion: "frozen-retrieval-fixture-v1",
            retrievalVersion: "frozen-public-capture",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
    },
});
export const addDocument = internalAction({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        documentKey: v.string(),
        url: v.string(),
        title: v.string(),
        text: v.string(),
        contentHash: v.string(),
    },
    returns: v.object({
        captureId: v.id("sourceCaptures"),
        candidateCount: v.number(),
    }),
    handler: async (
        ctx,
        args,
    ): Promise<{ captureId: Id<"sourceCaptures">; candidateCount: number }> => {
        await ctx.runQuery(internal.retrievalEvaluation.authorize, {
            preparationId: args.preparationId,
        });
        const bytes = new TextEncoder().encode(args.text).length;
        if (
            bytes > 16 * 1024 * 1024 ||
            sha256Hex(args.text) !== args.contentHash
        )
            throw new Error("Frozen evaluation hash mismatch");
        const storageId = await ctx.storage.store(new Blob([args.text]));
        const { text: _text, ...metadata } = args;
        let captureId: Id<"sourceCaptures">;
        try {
            captureId = await ctx.runMutation(
                internal.retrievalEvaluation.commitDocument,
                { ...metadata, storageId, byteCount: bytes },
            );
        } catch (error) {
            await ctx.storage.delete(storageId);
            throw error;
        }
        const capture = await ctx.runQuery(
            internal.sourceRetrieval.getCapture,
            { preparationId: args.preparationId, captureId },
        );
        if (capture.storageId !== storageId)
            await ctx.storage.delete(storageId);
        const state = await ctx.runAction(
            internal.sourceRetrievalActions.indexCapture,
            { preparationId: args.preparationId, captureId, mode: "lexical" },
        );
        return { captureId, candidateCount: state.candidateCount };
    },
});
export const importVectors = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        captureId: v.id("sourceCaptures"),
        items: v.array(
            v.object({
                order: v.number(),
                textHash: v.string(),
                vector: v.array(v.float64()),
            }),
        ),
        profile: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const p = await ctx.runQuery(internal.retrievalEvaluation.authorize, {
            preparationId: args.preparationId,
        });
        if (
            args.profile !== SOURCE_EMBEDDING_PROFILE.id ||
            args.items.length > 32
        )
            throw new Error("Invalid evaluation profile");
        const state = await ctx.db
            .query("sourceSearchCaptures")
            .withIndex("by_scope_and_capture", (q) =>
                q
                    .eq(
                        "scopeKey",
                        `${p.runId}:${p.corpusRevisionId}:${SOURCE_RETRIEVAL_VERSION}`,
                    )
                    .eq("captureId", args.captureId),
            )
            .unique();
        if (!state) throw new Error("Missing evaluation index");
        let count = state.embeddedCount ?? 0;
        for (const item of args.items) {
            const row = await ctx.db
                .query("sourceSearchPassages")
                .withIndex("by_scope_capture_order", (q) =>
                    q
                        .eq("scopeKey", state.scopeKey)
                        .eq("captureId", args.captureId)
                        .eq("order", item.order),
                )
                .unique();
            if (
                !row ||
                sha256Hex(row.searchText) !== item.textHash ||
                !validateEmbeddingVectors(
                    { shape: [1, 1024], data: [item.vector] },
                    1,
                )
            )
                throw new Error("Evaluation embedding provenance mismatch");
            if (row.embeddingProfile !== args.profile) count++;
            await ctx.db.patch(row._id, {
                embedding: item.vector,
                embeddingProfile: args.profile,
                embeddingScopeKey: sourceEmbeddingScopeKey(
                    state.scopeKey,
                    args.profile,
                    args.captureId,
                ),
            });
            const cached = await ctx.db
                .query("sourceEmbeddingCache")
                .withIndex("by_profile_and_hash", (q) =>
                    q.eq("profile", args.profile).eq("textHash", item.textHash),
                )
                .unique();
            if (!cached)
                await ctx.db.insert("sourceEmbeddingCache", {
                    profile: args.profile,
                    textHash: item.textHash,
                    vector: item.vector,
                });
        }
        await ctx.db.patch(state._id, {
            embeddedCount: count,
            ...(count === state.candidateCount
                ? { embeddingProfile: args.profile }
                : {}),
        });
        return null;
    },
});
export const importQueryVectors = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        items: v.array(
            v.object({ text: v.string(), vector: v.array(v.float64()) }),
        ),
        profile: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await ctx.runQuery(internal.retrievalEvaluation.authorize, {
            preparationId: args.preparationId,
        });
        if (
            args.items.length > 32 ||
            args.profile !== SOURCE_EMBEDDING_PROFILE.id
        )
            throw new Error("Invalid evaluation profile");
        for (const item of args.items) {
            if (
                new TextEncoder().encode(item.text).length > 6000 ||
                !validateEmbeddingVectors(
                    { shape: [1, 1024], data: [item.vector] },
                    1,
                )
            )
                throw new Error("Invalid evaluation vector");
            const textHash = sha256Hex(item.text);
            if (
                !(await ctx.db
                    .query("sourceEmbeddingCache")
                    .withIndex("by_profile_and_hash", (q) =>
                        q.eq("profile", args.profile).eq("textHash", textHash),
                    )
                    .unique())
            )
                await ctx.db.insert("sourceEmbeddingCache", {
                    profile: args.profile,
                    textHash,
                    vector: item.vector,
                });
        }
        return null;
    },
});
export const finish = internalMutation({
    args: { preparationId: v.id("sourceSelectionProposalRebuilds") },
    returns: v.null(),
    handler: async (ctx, args) => {
        const p = await ctx.runQuery(
            internal.retrievalEvaluation.authorize,
            args,
        );
        await ctx.db.patch(p._id, {
            status: "complete",
            completedAt: Date.now(),
        });
        await ctx.db.patch(p.runId, {
            executionStatus: "paused",
            lifecycleState: "awaiting_source_review",
            pauseReason: "source_review",
            updatedAt: Date.now(),
        });
        return null;
    },
});

/** A fresh labelled review fixture appends a new capture; historical capture bytes are never replaced. */
export const reviewInput = internalQuery({
    args: { runId: v.id("researchRuns"), fixtureKey: v.string() },
    returns: v.object({
        run: schema.doc("researchRuns"),
        revision: schema.doc("corpusRevisions"),
        capture: schema.doc("sourceCaptures"),
        task: schema.doc("aiTaskResults"),
    }),
    handler: async (ctx, args) => {
        assertLocalFixture();
        const run = await ctx.db.get(args.runId);
        const revision = run?.activeCorpusRevisionId
            ? await ctx.db.get(run.activeCorpusRevisionId)
            : null;
        if (
            run?.companySnapshot?.cik !== `e2e-${args.fixtureKey}` ||
            revision?.status !== "draft" ||
            run.executionStatus !== "paused"
        )
            throw new Error("Fresh review fixture required");
        const proposalId = revision.sourceSelectionProposalId;
        const items = proposalId
            ? await ctx.db
                  .query("sourceSelectionProposalItems")
                  .withIndex("by_proposal_and_rank_and_source", (q) =>
                      q.eq("proposalId", proposalId),
                  )
                  .take(4)
            : [];
        const item = items.find(
            (item) => item.sourceCaptureId && item.qualificationTaskId,
        );
        const capture = item?.sourceCaptureId
            ? await ctx.db.get(item.sourceCaptureId)
            : null;
        const task = item?.qualificationTaskId
            ? await ctx.db.get(item.qualificationTaskId)
            : null;
        if (!capture || task?.output.kind !== "source_qualification")
            throw new Error("Review reading unavailable");
        return { run, revision, capture, task };
    },
});
export const seedReview = internalAction({
    args: { slotKey: v.string(), fixtureKey: v.string() },
    returns: v.id("researchRuns"),
    handler: async (ctx, args): Promise<Id<"researchRuns">> => {
        assertLocalFixture();
        const base = await ctx.runAction(
            internal.e2eFixtures.seedInspectedSourceReviewScenario,
            args,
        );
        const original = await ctx.runQuery(
            internal.retrievalEvaluation.reviewInput,
            { runId: base.runId, fixtureKey: args.fixtureKey },
        );
        const qualification = original.task.output;
        if (qualification.kind !== "source_qualification")
            throw new Error("Invalid review fixture");
        if (qualification.retrieval) return base.runId;
        const blob = original.capture.storageId
            ? await ctx.storage.get(original.capture.storageId)
            : null;
        if (!blob) throw new Error("Review fixture capture missing");
        const background = Array.from({ length: 600 }, (_, i) =>
            `Illustrative background paragraph ${i}. ${"This is synthetic preparation context. ".repeat(50)}`.slice(
                0,
                1801,
            ),
        ).join("\n\n");
        const prefix = `${background}\n\n`;
        const text = `${prefix}${await blob.text()}`;
        const contentHash = sha256Hex(text);
        const selectedSpans = qualification.selectedPassages.map((p) => ({
            startOffset: p.startOffset + prefix.length,
            endOffset: p.endOffset + prefix.length,
        }));
        const omittedCandidateCount = extractPassagesFromNormalizedText({
            text,
            canonicalUrl:
                original.capture.resolvedUrl ?? original.capture.requestedUrl,
            sourceVersionHash: contentHash,
            preparationVersion: SOURCE_RETRIEVAL_VERSION,
        }).filter(
            (p) =>
                !selectedSpans.some(
                    (span) =>
                        p.locator.startOffset <= span.startOffset &&
                        p.locator.endOffset >= span.endOffset,
                ),
        ).length;
        const storageId = await ctx.storage.store(new Blob([text]));
        try {
            await ctx.runMutation(internal.retrievalEvaluation.commitReview, {
                runId: base.runId,
                fixtureKey: args.fixtureKey,
                storageId,
                prefixChars: prefix.length,
                contentHash,
                byteCount: new TextEncoder().encode(text).length,
                omittedCandidateCount,
            });
        } catch (error) {
            await ctx.storage.delete(storageId);
            throw error;
        }
        return base.runId;
    },
});
export const commitReview = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        fixtureKey: v.string(),
        storageId: v.id("_storage"),
        prefixChars: v.number(),
        contentHash: v.string(),
        byteCount: v.number(),
        omittedCandidateCount: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const original = await ctx.runQuery(
            internal.retrievalEvaluation.reviewInput,
            { runId: args.runId, fixtureKey: args.fixtureKey },
        );
        const {
            _id: _captureId,
            _creationTime: _captureTime,
            ...capture
        } = original.capture;
        const captureId = await ctx.db.insert("sourceCaptures", {
            ...capture,
            captureKey: `${capture.captureKey}:structured`,
            storageId: args.storageId,
            contentHash: args.contentHash,
            byteCount: args.byteCount,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
        const {
            _id: _taskId,
            _creationTime: _taskTime,
            ...task
        } = original.task;
        if (task.output.kind !== "source_qualification")
            throw new Error("Invalid review fixture");
        await ctx.db.insert("aiTaskResults", {
            ...task,
            sourceCaptureId: captureId,
            inputHash: sha256Hex(
                `${task.inputHash}:${args.contentHash}:structured`,
            ),
            output: {
                ...task.output,
                sourceCaptureId: captureId,
                contentHash: args.contentHash,
                selectedPassages: task.output.selectedPassages.map((p) => ({
                    ...p,
                    startOffset: p.startOffset + args.prefixChars,
                    endOffset: p.endOffset + args.prefixChars,
                })),
                retrieval: {
                    version: SOURCE_RETRIEVAL_VERSION,
                    requestedMode: "hybrid",
                    effectiveMode: "lexical",
                    degradationReason: "missing_configuration",
                    selectedPassageKeys: task.output.selectedPassages.map(
                        (p) => p.passageKey,
                    ),
                    omittedCandidateCount: args.omittedCandidateCount,
                },
            },
            createdAt: Date.now(),
        });
        await createSourceSelectionProposal(ctx, {
            run: original.run,
            revision: original.revision,
        });
        return null;
    },
});
export const inspectReview = internalQuery({
    args: { runId: v.id("researchRuns") },
    returns: v.object({
        revisionStatus: v.optional(v.string()),
        versionCount: v.number(),
        passageCount: v.number(),
        lateEvidence: v.boolean(),
        unselectedPassageMaterialized: v.boolean(),
        indexedCaptures: v.number(),
        searchCandidateCount: v.number(),
    }),
    handler: async (ctx, args) => {
        assertLocalFixture();
        const run = await ctx.db.get(args.runId);
        if (!run?.companySnapshot?.cik.startsWith("e2e-retrieval-review-"))
            throw new Error("Retrieval review fixture required");
        const revision = run.activeCorpusRevisionId
            ? await ctx.db.get(run.activeCorpusRevisionId)
            : null;
        const versions = await ctx.db
            .query("sourceVersions")
            .withIndex("by_run", (q) => q.eq("runId", args.runId))
            .take(4);
        const passages = (
            await Promise.all(
                versions.map((version) =>
                    ctx.db
                        .query("sourcePassages")
                        .withIndex("by_source_version_and_order", (q) =>
                            q.eq("sourceVersionId", version._id),
                        )
                        .take(513),
                ),
            )
        ).flat();
        const indexes = revision
            ? await ctx.db
                  .query("sourceSearchCaptures")
                  .withIndex("by_scope_and_capture", (q) =>
                      q.eq(
                          "scopeKey",
                          `${run._id}:${revision._id}:${SOURCE_RETRIEVAL_VERSION}`,
                      ),
                  )
                  .take(4)
            : [];
        return {
            unselectedPassageMaterialized: passages.some((p) =>
                p.exactQuotation.includes(
                    "Illustrative background paragraph 550.",
                ),
            ),
            indexedCaptures: indexes.length,
            searchCandidateCount: indexes.reduce(
                (total, index) => total + index.candidateCount,
                0,
            ),
            revisionStatus: revision?.status,
            versionCount: versions.length,
            passageCount: passages.length,
            lateEvidence: passages.some(
                (p) =>
                    p.order >= MAX_PASSAGES_PER_SOURCE &&
                    p.exactQuotation.includes("The author argues that"),
            ),
        };
    },
});
