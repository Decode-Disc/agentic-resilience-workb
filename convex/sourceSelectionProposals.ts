import { getAuthUserId } from "@convex-dev/auth/server";
import type { WorkflowId } from "@convex-dev/workflow";
import {
    paginationOptsValidator,
    paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
    internalMutation,
    type MutationCtx,
    mutation,
    type QueryCtx,
    query,
} from "./_generated/server";
import { claimPausedRunExecution } from "./domain/executionClaim";
import { upsertSourceReviewItem } from "./domain/sourceReviewProjection";
import {
    buildSourceSelectionProposal,
    SOURCE_SELECTION_POLICY_VERSION,
} from "./domain/sourceSelectionPolicy";
import {
    sourceCandidateLimit,
    sourceRecommendedTarget,
} from "./resourceLimits";
import { corpusRevisionApproved, workflow } from "./workflow";

type ProposalContext = {
    run: Doc<"researchRuns">;
    revision: Doc<"corpusRevisions">;
};

const dispositionValidator = v.union(
    v.literal("recommended"),
    v.literal("needs_attention"),
    v.literal("alternative"),
);

const sourceFamilyValidator = v.union(
    v.literal("regulatory"),
    v.literal("investor_relations"),
    v.literal("official_product"),
    v.literal("official_commercial"),
    v.literal("counter_evidence"),
    v.literal("official_security"),
    v.literal("independent_analysis"),
    v.literal("unrecognized"),
    v.literal("analyst_supplied"),
);

const reasonCodeValidator = v.union(
    v.literal("added_by_analyst"),
    v.literal("required_family_coverage"),
    v.literal("ranked_fill"),
    v.literal("unrecognized_source_family"),
    v.literal("not_selected"),
);

const decisionValidator = v.union(
    v.literal("accepted"),
    v.literal("rejected"),
    v.literal("pending"),
);

const proposalSourceValidator = v.object({
    sourceId: v.id("sources"),
    canonicalUrl: v.string(),
    title: v.string(),
    origin: v.union(
        v.literal("sec"),
        v.literal("exa"),
        v.literal("analyst_url"),
    ),
    category: v.string(),
    publishedAt: v.optional(v.number()),
    disposition: dispositionValidator,
    sourceFamily: sourceFamilyValidator,
    rank: v.number(),
    reasonCodes: v.array(reasonCodeValidator),
    decision: decisionValidator,
    included: v.boolean(),
    decisionReason: v.optional(v.string()),
});

async function sourceSelectionFingerprint(input: {
    candidates: Array<Doc<"sources">>;
    coveragePreset: NonNullable<Doc<"researchRuns">["coveragePreset"]>;
    researchAngle?: string;
    target: number;
}): Promise<string> {
    const canonicalInput = JSON.stringify({
        policyVersion: SOURCE_SELECTION_POLICY_VERSION,
        coveragePreset: input.coveragePreset,
        researchAngle: input.researchAngle?.trim() || null,
        target: input.target,
        candidates: [...input.candidates]
            .sort((left, right) => left._id.localeCompare(right._id, "en"))
            .map((source) => ({
                sourceId: source._id,
                canonicalUrl: source.canonicalUrl,
                title: source.title,
                origin: source.origin,
                category: source.category,
                publishedAt: source.publishedAt ?? null,
                providerReference: source.providerReference ?? null,
                providerResultPosition: source.providerResultPosition ?? null,
                discoveryQueryIndex: source.discoveryQueryIndex ?? null,
            })),
    });
    const bytes = new TextEncoder().encode(canonicalInput);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
    ).join("");
}

async function readProposalCandidates(
    ctx: MutationCtx | QueryCtx,
    runId: Id<"researchRuns">,
): Promise<Array<Doc<"sources">>> {
    const limit = sourceCandidateLimit();
    const candidates = await ctx.db
        .query("sources")
        .withIndex("by_run_and_url", (query) => query.eq("runId", runId))
        .take(limit + 1);
    if (candidates.length > limit) {
        throw new Error("Source candidate limit exceeded");
    }
    return candidates;
}

async function authorizeProposalContext(
    ctx: QueryCtx | MutationCtx,
    args: {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
    },
): Promise<{
    run: Doc<"researchRuns">;
    revision: Doc<"corpusRevisions">;
}> {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) {
        throw new Error("Not authenticated");
    }
    const visitor = await ctx.db
        .query("visitors")
        .withIndex("by_auth_user_id", (query) =>
            query.eq("authUserId", authUserId),
        )
        .unique();
    const run = await ctx.db.get(args.runId);
    const revision = await ctx.db.get(args.corpusRevisionId);
    if (
        visitor?.status !== "active" ||
        run?.ownerVisitorId !== visitor._id ||
        revision?.runId !== run._id
    ) {
        throw new Error("Unauthorized");
    }
    return { run, revision };
}

async function readCurrentProposal(
    ctx: QueryCtx | MutationCtx,
    { run, revision }: ProposalContext,
): Promise<Doc<"sourceSelectionProposals"> | null> {
    if (!revision.sourceSelectionProposalId) {
        return null;
    }
    const proposal = await ctx.db.get(revision.sourceSelectionProposalId);
    if (
        !proposal ||
        proposal.corpusRevisionId !== revision._id ||
        proposal.runId !== run._id
    ) {
        throw new Error("Source selection proposal pointer is invalid");
    }
    return proposal;
}

async function currentFingerprint(
    ctx: MutationCtx | QueryCtx,
    run: Doc<"researchRuns">,
): Promise<string> {
    if (!run.coveragePreset) {
        throw new Error("Research run has no coverage preset");
    }
    return sourceSelectionFingerprint({
        candidates: await readProposalCandidates(ctx, run._id),
        coveragePreset: run.coveragePreset,
        researchAngle: run.researchAngle,
        target: sourceRecommendedTarget(),
    });
}

function isIncluded(
    disposition: Doc<"sourceSelectionProposalItems">["disposition"],
    decision: Doc<"sourceReviewItems">["decision"],
): boolean {
    if (decision === "accepted") {
        return true;
    }
    if (decision === "rejected") {
        return false;
    }
    return disposition === "recommended";
}

async function hydrateProposalItem(
    ctx: QueryCtx,
    item: Doc<"sourceSelectionProposalItems">,
) {
    const source = await ctx.db.get(item.sourceId);
    const reviewItem = await ctx.db
        .query("sourceReviewItems")
        .withIndex("by_revision_and_source", (query) =>
            query
                .eq("corpusRevisionId", item.corpusRevisionId)
                .eq("sourceId", item.sourceId),
        )
        .unique();
    if (!source || !reviewItem) {
        throw new Error("Source proposal projection is incomplete");
    }
    return {
        sourceId: source._id,
        canonicalUrl: source.canonicalUrl,
        title: source.title,
        origin: source.origin,
        category: source.category,
        publishedAt: source.publishedAt,
        disposition: item.disposition,
        sourceFamily: item.sourceFamily,
        rank: item.rank,
        reasonCodes: item.reasonCodes,
        decision: reviewItem.decision,
        included: isIncluded(item.disposition, reviewItem.decision),
        decisionReason: reviewItem.reason,
    };
}

export async function createSourceSelectionProposal(
    ctx: MutationCtx,
    { run, revision }: ProposalContext,
): Promise<{
    proposalId: Id<"sourceSelectionProposals">;
    version: number;
    status: "ready" | "failed";
}> {
    if (!run.coveragePreset) {
        throw new Error("Research run has no coverage preset");
    }
    const candidates = await readProposalCandidates(ctx, run._id);
    const target = sourceRecommendedTarget();
    const result = buildSourceSelectionProposal({
        candidates: candidates.map((source) => ({
            sourceId: source._id,
            canonicalUrl: source.canonicalUrl,
            title: source.title,
            origin: source.origin,
            category: source.category,
            publishedAt: source.publishedAt,
            providerResultPosition: source.providerResultPosition,
            discoveryQueryIndex: source.discoveryQueryIndex,
            createdAt: source.createdAt,
        })),
        coveragePreset: run.coveragePreset,
        researchAngle: run.researchAngle,
        target,
    });
    const previous = await ctx.db
        .query("sourceSelectionProposals")
        .withIndex("by_corpus_revision_id_and_version", (query) =>
            query.eq("corpusRevisionId", revision._id),
        )
        .order("desc")
        .first();
    const version = (previous?.version ?? 0) + 1;
    const now = Date.now();
    const proposalId = await ctx.db.insert("sourceSelectionProposals", {
        runId: run._id,
        corpusRevisionId: revision._id,
        version,
        policyVersion: SOURCE_SELECTION_POLICY_VERSION,
        coveragePreset: run.coveragePreset,
        researchAngle: run.researchAngle,
        recommendedTarget: target,
        candidateFingerprint: await sourceSelectionFingerprint({
            candidates,
            coveragePreset: run.coveragePreset,
            researchAngle: run.researchAngle,
            target,
        }),
        status: "ready",
        counts: result.counts,
        gaps: result.gaps,
        createdAt: now,
    });
    for (const item of result.items) {
        await ctx.db.insert("sourceSelectionProposalItems", {
            runId: run._id,
            corpusRevisionId: revision._id,
            proposalId,
            sourceId: item.sourceId as Id<"sources">,
            disposition: item.disposition,
            sourceFamily: item.sourceFamily,
            rank: item.rank,
            reasonCodes: item.reasonCodes,
            createdAt: now,
        });
    }
    await ctx.db.patch(revision._id, { sourceSelectionProposalId: proposalId });
    return { proposalId, version, status: "ready" };
}

export const generateForRun = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        expectedExecutionGeneration: v.number(),
    },
    returns: v.object({
        proposalId: v.id("sourceSelectionProposals"),
        version: v.number(),
        status: v.union(v.literal("ready"), v.literal("failed")),
    }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        const revision = run?.activeCorpusRevisionId
            ? await ctx.db.get(run.activeCorpusRevisionId)
            : null;
        if (
            !run ||
            !revision ||
            run.executionGeneration !== args.expectedExecutionGeneration ||
            run.executionStatus !== "running" ||
            run.lifecycleState !== "discovering_sources" ||
            revision.runId !== run._id ||
            revision.status !== "draft"
        ) {
            throw new Error("Research execution is no longer active");
        }
        return createSourceSelectionProposal(ctx, { run, revision });
    },
});

export const getCurrent = query({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
    },
    returns: v.union(
        v.object({
            proposalId: v.id("sourceSelectionProposals"),
            version: v.number(),
            status: v.union(v.literal("ready"), v.literal("failed")),
            effectiveStatus: v.union(
                v.literal("ready"),
                v.literal("stale"),
                v.literal("failed"),
            ),
            recommendedTarget: v.number(),
            counts: v.object({
                recommended: v.number(),
                needsAttention: v.number(),
                alternative: v.number(),
            }),
            gaps: v.array(
                v.union(
                    v.literal("regulatory"),
                    v.literal("investor_relations"),
                    v.literal("official_product"),
                    v.literal("official_commercial"),
                    v.literal("counter_evidence"),
                    v.literal("official_security"),
                    v.literal("independent_analysis"),
                ),
            ),
            effectiveIncludedCount: v.number(),
            revisionStatus: v.union(v.literal("draft"), v.literal("approved")),
        }),
        v.null(),
    ),
    handler: async (ctx, args) => {
        const context = await authorizeProposalContext(ctx, args);
        const proposal = await readCurrentProposal(ctx, context);
        if (!proposal) {
            return null;
        }
        const { run, revision } = context;
        const items = await ctx.db
            .query("sourceSelectionProposalItems")
            .withIndex("by_proposal_and_rank_and_source", (query) =>
                query.eq("proposalId", proposal._id),
            )
            .take(sourceCandidateLimit() + 1);
        const hydrated = await Promise.all(
            items.map((item) => hydrateProposalItem(ctx, item)),
        );
        const fingerprint = await currentFingerprint(ctx, run);
        return {
            proposalId: proposal._id,
            version: proposal.version,
            status: proposal.status,
            effectiveStatus:
                proposal.status === "failed"
                    ? ("failed" as const)
                    : fingerprint === proposal.candidateFingerprint
                      ? ("ready" as const)
                      : ("stale" as const),
            recommendedTarget: proposal.recommendedTarget,
            counts: proposal.counts,
            gaps: proposal.gaps,
            effectiveIncludedCount: hydrated.filter(({ included }) => included)
                .length,
            revisionStatus: revision.status,
        };
    },
});

export const listItemsPage = query({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        disposition: dispositionValidator,
        paginationOpts: paginationOptsValidator,
    },
    returns: paginationResultValidator(proposalSourceValidator),
    handler: async (ctx, args) => {
        const context = await authorizeProposalContext(ctx, args);
        const proposal = await readCurrentProposal(ctx, context);
        if (!proposal) {
            throw new Error("Source selection proposal is unavailable");
        }
        const page = await ctx.db
            .query("sourceSelectionProposalItems")
            .withIndex(
                "by_proposal_and_disposition_and_rank_and_source",
                (query) =>
                    query
                        .eq("proposalId", proposal._id)
                        .eq("disposition", args.disposition),
            )
            .paginate(args.paginationOpts);
        return {
            ...page,
            page: await Promise.all(
                page.page.map((item) => hydrateProposalItem(ctx, item)),
            ),
        };
    },
});

export const getAdjustmentSets = query({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
    },
    returns: v.object({
        included: v.array(proposalSourceValidator),
        available: v.array(proposalSourceValidator),
    }),
    handler: async (ctx, args) => {
        const context = await authorizeProposalContext(ctx, args);
        const proposal = await readCurrentProposal(ctx, context);
        if (!proposal) {
            throw new Error("Source selection proposal is unavailable");
        }
        const items = await ctx.db
            .query("sourceSelectionProposalItems")
            .withIndex("by_proposal_and_rank_and_source", (query) =>
                query.eq("proposalId", proposal._id),
            )
            .take(sourceCandidateLimit() + 1);
        const hydrated = await Promise.all(
            items.map((item) => hydrateProposalItem(ctx, item)),
        );
        return {
            included: hydrated.filter(({ included }) => included),
            available: hydrated.filter(({ included }) => !included),
        };
    },
});

export const ensureCurrentForReview = mutation({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
    },
    returns: v.object({
        proposalId: v.id("sourceSelectionProposals"),
        version: v.number(),
        status: v.union(v.literal("ready"), v.literal("failed")),
    }),
    handler: async (ctx, args) => {
        const context = await authorizeProposalContext(ctx, args);
        const existing = await readCurrentProposal(ctx, context);
        if (existing) {
            return {
                proposalId: existing._id,
                version: existing.version,
                status: existing.status,
            };
        }
        const { run, revision } = context;
        if (
            revision.status !== "draft" ||
            run.activeCorpusRevisionId !== revision._id ||
            run.lifecycleState !== "awaiting_source_review" ||
            run.executionStatus !== "paused" ||
            run.pauseReason !== "source_review"
        ) {
            throw new Error(
                "Source selection proposal cannot be created for this revision",
            );
        }
        return createSourceSelectionProposal(ctx, context);
    },
});

export const recompute = mutation({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        expectedProposalId: v.id("sourceSelectionProposals"),
    },
    returns: v.object({
        proposalId: v.id("sourceSelectionProposals"),
        version: v.number(),
        status: v.union(v.literal("ready"), v.literal("failed")),
    }),
    handler: async (ctx, args) => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            throw new Error("Not authenticated");
        }
        const visitor = await ctx.db
            .query("visitors")
            .withIndex("by_auth_user_id", (query) =>
                query.eq("authUserId", authUserId),
            )
            .unique();
        const run = await ctx.db.get(args.runId);
        const revision = await ctx.db.get(args.corpusRevisionId);
        if (
            visitor?.status !== "active" ||
            run?.ownerVisitorId !== visitor._id ||
            revision?.runId !== run._id
        ) {
            throw new Error("Unauthorized");
        }
        if (
            revision.status !== "draft" ||
            revision.sourceSelectionProposalId !== args.expectedProposalId ||
            run.activeCorpusRevisionId !== revision._id ||
            run.lifecycleState !== "awaiting_source_review" ||
            run.executionStatus !== "paused" ||
            run.pauseReason !== "source_review"
        ) {
            throw new Error("Source selection proposal cannot be recomputed");
        }
        return createSourceSelectionProposal(ctx, { run, revision });
    },
});

export const approveProposedCorpus = mutation({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        proposalId: v.id("sourceSelectionProposals"),
        proposalVersion: v.number(),
        decisionKey: v.string(),
    },
    returns: v.object({ accepted: v.boolean() }),
    handler: async (ctx, args) => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            throw new Error("Not authenticated");
        }
        const visitor = await ctx.db
            .query("visitors")
            .withIndex("by_auth_user_id", (query) =>
                query.eq("authUserId", authUserId),
            )
            .unique();
        const run = await ctx.db.get(args.runId);
        const revision = await ctx.db.get(args.corpusRevisionId);
        const proposal = await ctx.db.get(args.proposalId);
        if (
            visitor?.status !== "active" ||
            run?.ownerVisitorId !== visitor._id ||
            revision?.runId !== run._id ||
            proposal?.runId !== run._id ||
            proposal.corpusRevisionId !== revision._id
        ) {
            throw new Error("Unauthorized");
        }
        const decisionKey = args.decisionKey.trim();
        if (decisionKey.length === 0 || decisionKey.length > 128) {
            throw new Error("Invalid decision key");
        }
        const existingCheckpoint = await ctx.db
            .query("checkpointDecisions")
            .withIndex("by_run_and_decision_key", (query) =>
                query.eq("runId", run._id).eq("decisionKey", decisionKey),
            )
            .unique();
        if (existingCheckpoint) {
            return { accepted: false };
        }
        if (
            revision.status !== "draft" ||
            run.activeCorpusRevisionId !== revision._id ||
            revision.sourceSelectionProposalId !== proposal._id ||
            proposal.version !== args.proposalVersion ||
            proposal.status !== "ready" ||
            run.lifecycleState !== "awaiting_source_review" ||
            run.executionStatus !== "paused" ||
            run.pauseReason !== "source_review" ||
            !run.workflowId
        ) {
            throw new Error("Proposed corpus cannot be approved");
        }
        if (
            (await currentFingerprint(ctx, run)) !==
            proposal.candidateFingerprint
        ) {
            throw new Error("Source selection proposal is stale");
        }
        const items = await ctx.db
            .query("sourceSelectionProposalItems")
            .withIndex("by_proposal_and_rank_and_source", (query) =>
                query.eq("proposalId", proposal._id),
            )
            .take(sourceCandidateLimit() + 1);
        if (items.length > sourceCandidateLimit()) {
            throw new Error("Source selection proposal exceeds its limit");
        }
        const now = Date.now();
        let acceptedCount = 0;
        for (const item of items) {
            const source = await ctx.db.get(item.sourceId);
            const reviewItem = await ctx.db
                .query("sourceReviewItems")
                .withIndex("by_revision_and_source", (query) =>
                    query
                        .eq("corpusRevisionId", revision._id)
                        .eq("sourceId", item.sourceId),
                )
                .unique();
            if (!source || !reviewItem || source.runId !== run._id) {
                throw new Error("Source proposal projection is incomplete");
            }
            if (reviewItem.decision === "accepted") {
                acceptedCount += 1;
                continue;
            }
            if (
                reviewItem.decision === "rejected" ||
                item.disposition !== "recommended"
            ) {
                continue;
            }
            const sourceDecisionId = await ctx.db.insert("sourceDecisions", {
                runId: run._id,
                corpusRevisionId: revision._id,
                sourceId: source._id,
                decisionKey: `${decisionKey}:source:${source._id}`,
                decision: "accepted",
                reviewerVisitorId: visitor._id,
                supersedesDecisionId: reviewItem.latestDecisionId,
                reason: "Accepted with proposed corpus",
                occurredAt: now,
            });
            await upsertSourceReviewItem(ctx, {
                runId: run._id,
                corpusRevisionId: revision._id,
                sourceId: source._id,
                decision: "accepted",
                sourceCreatedAt: source.createdAt,
                latestDecisionId: sourceDecisionId,
                decisionOccurredAt: now,
                reason: "Accepted with proposed corpus",
            });
            await ctx.db.insert("auditEvents", {
                actor: { type: "visitor", visitorId: visitor._id },
                action: "source_decided",
                targetType: "source",
                targetId: source._id,
                reason: "Accepted with proposed corpus",
                occurredAt: now,
            });
            acceptedCount += 1;
        }
        if (acceptedCount === 0) {
            throw new Error("At least one accepted source is required");
        }
        const executionGeneration = await claimPausedRunExecution(ctx, {
            visitor,
            run,
            checkpoint: {
                lifecycleState: "awaiting_source_review",
                pauseReason: "source_review",
            },
            now,
        });
        await ctx.db.patch(revision._id, {
            status: "approved",
            approvedByVisitorId: visitor._id,
            approvedAt: now,
        });
        const checkpointDecisionId = await ctx.db.insert(
            "checkpointDecisions",
            {
                runId: run._id,
                checkpoint: "source_review",
                decisionKey,
                reviewerVisitorId: visitor._id,
                decision: "approved",
                occurredAt: now,
            },
        );
        await workflow.sendEvent(ctx, {
            ...corpusRevisionApproved,
            workflowId: run.workflowId as WorkflowId,
            value: {
                decisionId: checkpointDecisionId,
                corpusRevisionId: revision._id,
                executionGeneration,
            },
        });
        await ctx.db.insert("auditEvents", {
            actor: { type: "visitor", visitorId: visitor._id },
            action: "corpus_revision_approved",
            targetType: "corpus_revision",
            targetId: revision._id,
            occurredAt: now,
        });
        return { accepted: true };
    },
});
