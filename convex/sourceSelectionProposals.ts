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
    internalQuery,
    type MutationCtx,
    mutation,
    type QueryCtx,
    query,
} from "./_generated/server";
import { mergeRunCompanyMetadata } from "./domain/companyMetadata";
import { claimPausedRunExecution } from "./domain/executionClaim";
import { buildResearchPlan } from "./domain/researchPlan";
import { readSourceCandidateCapacity } from "./domain/sourceCandidateCapacity";
import { upsertSourceReviewItem } from "./domain/sourceReviewProjection";
import {
    buildSourceSelectionProposal,
    SOURCE_PUBLISHER_REGISTRY_VERSION,
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

const discoveryFamilyValidator = v.union(
    v.literal("regulatory"),
    v.literal("investor_relations"),
    v.literal("official_product"),
    v.literal("official_commercial"),
    v.literal("counter_evidence"),
    v.literal("official_security"),
    v.literal("independent_analysis"),
);

const rebuildOutcomeValidator = v.union(
    v.literal("complete"),
    v.literal("partial"),
    v.literal("blocked"),
);

const reasonCodeValidator = v.union(
    v.literal("added_by_analyst"),
    v.literal("required_family_coverage"),
    v.literal("ranked_fill"),
    v.literal("unrecognized_source_family"),
    v.literal("not_selected"),
    v.literal("required_coverage_role"),
    v.literal("additional_coverage"),
    v.literal("canonical_duplicate"),
    v.literal("metadata_duplicate"),
    v.literal("search_or_index"),
    v.literal("low_information_document"),
    v.literal("company_identity_unverified"),
    v.literal("unverified_publisher"),
    v.literal("no_new_coverage"),
    v.literal("recommendation_ceiling_reached"),
    v.literal("integrity_conflict"),
);

const coverageRoleValidator = v.union(
    v.literal("regulatory_annual"),
    v.literal("regulatory_interim"),
    v.literal("regulatory_material_event"),
    v.literal("investor_results"),
    v.literal("investor_presentation"),
    v.literal("official_product_platform"),
    v.literal("official_product_integration"),
    v.literal("official_commercial_pricing"),
    v.literal("official_commercial_terms"),
    v.literal("counter_evidence_primary"),
    v.literal("counter_evidence_secondary"),
    v.literal("official_security_architecture"),
    v.literal("official_security_trust"),
    v.literal("independent_analysis_primary"),
    v.literal("independent_analysis_secondary"),
);

const documentKindValidator = v.union(
    v.literal("regulatory_annual"),
    v.literal("regulatory_interim"),
    v.literal("regulatory_material"),
    v.literal("regulatory_proxy"),
    v.literal("regulatory_ownership"),
    v.literal("regulatory_registration"),
    v.literal("regulatory_other"),
    v.literal("earnings_release"),
    v.literal("investor_presentation"),
    v.literal("earnings_transcript"),
    v.literal("official_product_documentation"),
    v.literal("official_integration_documentation"),
    v.literal("official_pricing"),
    v.literal("official_commercial_terms"),
    v.literal("official_security_documentation"),
    v.literal("independent_analysis"),
    v.literal("news_reporting"),
    v.literal("partner_evidence"),
    v.literal("community_content"),
    v.literal("search_or_index"),
    v.literal("unknown"),
);

const authorityTierValidator = v.union(
    v.literal("regulator_primary"),
    v.literal("company_primary"),
    v.literal("company_hosted_ir"),
    v.literal("institutional_independent"),
    v.literal("qualified_partner"),
    v.literal("unverified"),
    v.literal("analyst_supplied"),
);

const decisionValidator = v.union(
    v.literal("accepted"),
    v.literal("rejected"),
    v.literal("pending"),
);

const rebuildCandidateValidator = v.object({
    canonicalUrl: v.string(),
    title: v.string(),
    origin: v.union(v.literal("sec"), v.literal("exa")),
    category: v.string(),
    publishedAt: v.optional(v.number()),
    providerReference: v.optional(v.string()),
    secForm: v.optional(v.string()),
    secAccessionNumber: v.optional(v.string()),
    providerResultPosition: v.optional(v.number()),
    discoveryQueryIndex: v.optional(v.number()),
});

const rebuildPlanQueryValidator = v.object({
    query: v.string(),
    category: v.string(),
    discoveryIntent: v.string(),
    includeDomains: v.optional(v.array(v.string())),
    dimensionKeys: v.array(v.string()),
});

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
    documentKind: documentKindValidator,
    authorityTier: authorityTierValidator,
    coverageContributions: v.array(v.string()),
    duplicateOfSourceId: v.optional(v.id("sources")),
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
    ceiling: number;
    company?: {
        cik: string;
        legalName: string;
        ticker: string;
        websiteUrl?: string;
        investorRelationsUrl?: string;
    };
}): Promise<string> {
    const canonicalInput = JSON.stringify({
        policyVersion: SOURCE_SELECTION_POLICY_VERSION,
        coveragePreset: input.coveragePreset,
        researchAngle: input.researchAngle?.trim() || null,
        publisherRegistryVersion: SOURCE_PUBLISHER_REGISTRY_VERSION,
        ceiling: input.ceiling,
        company: input.company ?? null,
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
                secForm: source.secForm ?? null,
                secAccessionNumber: source.secAccessionNumber ?? null,
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

async function readSelectionCompany(
    ctx: MutationCtx | QueryCtx,
    run: Doc<"researchRuns">,
) {
    const currentCompany = run.companyId
        ? await ctx.db.get(run.companyId)
        : null;
    const company = mergeRunCompanyMetadata(
        run.companySnapshot,
        currentCompany,
    );
    if (!company) {
        return undefined;
    }
    return {
        cik: company.cik,
        legalName: company.legalName,
        ticker: company.ticker,
        websiteUrl: company.websiteUrl,
        investorRelationsUrl: company.investorRelationsUrl,
    };
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
    const company = await readSelectionCompany(ctx, run);
    return sourceSelectionFingerprint({
        candidates: await readProposalCandidates(ctx, run._id),
        coveragePreset: run.coveragePreset,
        researchAngle: run.researchAngle,
        ceiling: sourceRecommendedTarget(),
        company,
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
    if (!source) {
        throw new Error("Source proposal projection is incomplete");
    }
    const reviewItem = await ctx.db
        .query("sourceReviewItems")
        .withIndex("by_revision_and_source", (query) =>
            query
                .eq("corpusRevisionId", item.corpusRevisionId)
                .eq("sourceId", item.sourceId),
        )
        .unique();
    const decision = reviewItem?.decision ?? "pending";
    return {
        sourceId: source._id,
        canonicalUrl: source.canonicalUrl,
        title: source.title,
        origin: source.origin,
        category: source.category,
        publishedAt: source.publishedAt,
        disposition: item.disposition,
        sourceFamily: item.sourceFamily,
        documentKind: item.documentKind ?? "unknown",
        authorityTier: item.authorityTier ?? "unverified",
        coverageContributions: item.coverageContributions ?? [],
        duplicateOfSourceId: item.duplicateOfSourceId,
        rank: item.rank,
        reasonCodes: item.reasonCodes,
        decision,
        included: isIncluded(item.disposition, decision),
        decisionReason: reviewItem?.reason,
    };
}

export async function createSourceSelectionProposal(
    ctx: MutationCtx,
    {
        run,
        revision,
        rebuild,
    }: ProposalContext & {
        rebuild?: {
            outcome: "complete" | "partial";
            failedDiscoveryFamilies: Array<
                | "regulatory"
                | "investor_relations"
                | "official_product"
                | "official_commercial"
                | "counter_evidence"
                | "official_security"
                | "independent_analysis"
            >;
        };
    },
): Promise<{
    proposalId: Id<"sourceSelectionProposals">;
    version: number;
    status: "ready" | "failed";
}> {
    if (!run.coveragePreset) {
        throw new Error("Research run has no coverage preset");
    }
    const candidates = await readProposalCandidates(ctx, run._id);
    const recommendationCeiling = sourceRecommendedTarget();
    const company = await readSelectionCompany(ctx, run);
    const result = buildSourceSelectionProposal({
        candidates: candidates.map((source) => ({
            sourceId: source._id,
            canonicalUrl: source.canonicalUrl,
            title: source.title,
            origin: source.origin,
            category: source.category,
            publishedAt: source.publishedAt,
            providerReference: source.providerReference,
            secForm: source.secForm,
            secAccessionNumber: source.secAccessionNumber,
            providerResultPosition: source.providerResultPosition,
            discoveryQueryIndex: source.discoveryQueryIndex,
            createdAt: source.createdAt,
        })),
        coveragePreset: run.coveragePreset,
        researchAngle: run.researchAngle,
        company,
        ceiling: recommendationCeiling,
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
        recommendedTarget: recommendationCeiling,
        recommendationCeiling,
        publisherRegistryVersion: SOURCE_PUBLISHER_REGISTRY_VERSION,
        rebuildOutcome: rebuild?.outcome,
        failedDiscoveryFamilies: rebuild?.failedDiscoveryFamilies,
        candidateFingerprint: await sourceSelectionFingerprint({
            candidates,
            coveragePreset: run.coveragePreset,
            researchAngle: run.researchAngle,
            ceiling: recommendationCeiling,
            company,
        }),
        status: "ready",
        counts: result.counts,
        gaps: result.gaps,
        coverageGaps: result.coverageGaps,
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
            documentKind: item.documentKind,
            authorityTier: item.authorityTier,
            coverageContributions: item.coverageContributions,
            duplicateOfSourceId: item.duplicateOfSourceId
                ? (item.duplicateOfSourceId as Id<"sources">)
                : undefined,
            rank: item.rank,
            reasonCodes: item.reasonCodes,
            createdAt: now,
        });
        // Ensure a source review item exists for this revision so the proposal
        // can be hydrated. This is needed when a new revision is created from
        // an already-approved corpus (no discovery has run for it yet).
        const existingReviewItem = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_source", (query) =>
                query
                    .eq("corpusRevisionId", revision._id)
                    .eq("sourceId", item.sourceId as Id<"sources">),
            )
            .unique();
        if (!existingReviewItem) {
            const source = await ctx.db.get(item.sourceId as Id<"sources">);
            if (source) {
                const decisionId = await ctx.db.insert("sourceDecisions", {
                    runId: run._id,
                    corpusRevisionId: revision._id,
                    sourceId: source._id,
                    decisionKey: `revision-${revision.revision}:initial:${source._id}`,
                    decision: "pending",
                    occurredAt: now,
                });
                await ctx.db.insert("sourceReviewItems", {
                    runId: run._id,
                    corpusRevisionId: revision._id,
                    sourceId: source._id,
                    decision: "pending",
                    decisionRank: 0,
                    sourceCreatedAt: source.createdAt,
                    latestDecisionId: decisionId,
                    decisionOccurredAt: now,
                });
            }
        }
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
                v.literal("outdated"),
            ),
            recommendedTarget: v.number(),
            recommendationCeiling: v.number(),
            rebuildOutcome: v.optional(rebuildOutcomeValidator),
            failedDiscoveryFamilies: v.array(discoveryFamilyValidator),
            coverageGaps: v.array(coverageRoleValidator),
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
                    : proposal.policyVersion !== SOURCE_SELECTION_POLICY_VERSION
                      ? ("outdated" as const)
                      : fingerprint === proposal.candidateFingerprint
                        ? ("ready" as const)
                        : ("stale" as const),
            recommendedTarget: proposal.recommendedTarget,
            recommendationCeiling:
                proposal.recommendationCeiling ?? proposal.recommendedTarget,
            rebuildOutcome: proposal.rebuildOutcome,
            failedDiscoveryFamilies: proposal.failedDiscoveryFamilies ?? [],
            coverageGaps: proposal.coverageGaps ?? [],
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
        proposalId: v.optional(v.id("sourceSelectionProposals")),
        disposition: dispositionValidator,
        paginationOpts: paginationOptsValidator,
    },
    returns: paginationResultValidator(proposalSourceValidator),
    handler: async (ctx, args) => {
        const context = await authorizeProposalContext(ctx, args);
        const proposal = args.proposalId
            ? await ctx.db.get(args.proposalId)
            : await readCurrentProposal(ctx, context);
        if (!proposal) {
            throw new Error("Source selection proposal is unavailable");
        }
        if (
            proposal.runId !== args.runId ||
            proposal.corpusRevisionId !== args.corpusRevisionId
        ) {
            throw new Error("Unauthorized");
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
            (await ctx.db.get(args.expectedProposalId))?.policyVersion !==
                SOURCE_SELECTION_POLICY_VERSION ||
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

export const claimRebuild = internalMutation({
    args: {
        authUserId: v.id("users"),
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        expectedProposalId: v.id("sourceSelectionProposals"),
    },
    returns: v.union(
        v.object({
            shouldExecute: v.literal(true),
            rebuildId: v.id("sourceSelectionProposalRebuilds"),
            cycle: v.number(),
            executionGeneration: v.number(),
            company: v.object({
                cik: v.string(),
                legalName: v.string(),
                ticker: v.string(),
                websiteUrl: v.optional(v.string()),
                investorRelationsUrl: v.optional(v.string()),
            }),
            queries: v.array(rebuildPlanQueryValidator),
            remainingCapacity: v.number(),
        }),
        v.object({
            shouldExecute: v.literal(false),
            proposalId: v.id("sourceSelectionProposals"),
            version: v.number(),
            outcome: rebuildOutcomeValidator,
            failedDiscoveryFamilies: v.array(discoveryFamilyValidator),
        }),
    ),
    handler: async (ctx, args) => {
        const visitor = await ctx.db
            .query("visitors")
            .withIndex("by_auth_user_id", (query) =>
                query.eq("authUserId", args.authUserId),
            )
            .unique();
        const run = await ctx.db.get(args.runId);
        const revision = await ctx.db.get(args.corpusRevisionId);
        const proposal = await ctx.db.get(args.expectedProposalId);
        if (
            visitor?.status !== "active" ||
            run?.ownerVisitorId !== visitor._id ||
            revision?.runId !== run._id ||
            proposal?.runId !== run._id ||
            proposal.corpusRevisionId !== revision._id
        ) {
            throw new Error("Unauthorized");
        }
        const operationKey = `run:${args.runId}:generation:${run.executionGeneration}:corpus:${args.corpusRevisionId}:proposal:${args.expectedProposalId}:policy:${SOURCE_SELECTION_POLICY_VERSION}`;
        const existing = await ctx.db
            .query("sourceSelectionProposalRebuilds")
            .withIndex("by_operation_key", (query) =>
                query.eq("operationKey", operationKey),
            )
            .unique();
        const now = Date.now();
        if (existing) {
            if (
                (existing.status === "complete" ||
                    existing.status === "partial") &&
                existing.proposalId &&
                existing.proposalVersion !== undefined
            ) {
                return {
                    shouldExecute: false as const,
                    proposalId: existing.proposalId,
                    version: existing.proposalVersion,
                    outcome: existing.status,
                    failedDiscoveryFamilies: existing.failedDiscoveryFamilies,
                };
            }
            if (
                existing.status === "started" &&
                existing.leaseExpiresAt > now
            ) {
                return {
                    shouldExecute: false as const,
                    proposalId: proposal._id,
                    version: proposal.version,
                    outcome: "blocked" as const,
                    failedDiscoveryFamilies: [],
                };
            }
            if (
                existing.status === "blocked" &&
                existing.leaseExpiresAt > now
            ) {
                return {
                    shouldExecute: false as const,
                    proposalId: proposal._id,
                    version: proposal.version,
                    outcome: "blocked" as const,
                    failedDiscoveryFamilies: existing.failedDiscoveryFamilies,
                };
            }
        }
        const currentProposal = revision?.sourceSelectionProposalId
            ? await ctx.db.get(revision.sourceSelectionProposalId)
            : null;
        if (
            revision.status !== "draft" ||
            revision.sourceSelectionProposalId !== args.expectedProposalId ||
            run.activeCorpusRevisionId !== revision._id ||
            !currentProposal ||
            currentProposal._id !== args.expectedProposalId ||
            currentProposal.corpusRevisionId !== revision._id ||
            currentProposal.policyVersion === SOURCE_SELECTION_POLICY_VERSION ||
            run.lifecycleState !== "awaiting_source_review" ||
            run.executionStatus !== "paused" ||
            run.pauseReason !== "source_review" ||
            !run.coveragePreset
        ) {
            throw new Error("Source selection proposal cannot be rebuilt");
        }
        const company = await readSelectionCompany(ctx, run);
        if (!company) {
            throw new Error("Confirmed company was not found");
        }
        const capacity = await readSourceCandidateCapacity(ctx.db, run._id);
        const cycle = existing ? (existing.cycle ?? 1) + 1 : 1;
        const rebuildId = existing
            ? existing._id
            : await ctx.db.insert("sourceSelectionProposalRebuilds", {
                  runId: run._id,
                  corpusRevisionId: revision._id,
                  expectedProposalId: proposal._id,
                  executionGeneration: run.executionGeneration,
                  policyVersion: SOURCE_SELECTION_POLICY_VERSION,
                  operationKey,
                  cycle,
                  status: "started",
                  failedDiscoveryFamilies: [],
                  leaseExpiresAt: now + 5 * 60_000,
                  createdAt: now,
              });
        if (existing) {
            await ctx.db.patch(existing._id, {
                status: "started",
                cycle,
                failedDiscoveryFamilies: [],
                leaseExpiresAt: now + 5 * 60_000,
                completedAt: undefined,
            });
        }
        return {
            shouldExecute: true as const,
            rebuildId,
            cycle,
            executionGeneration: run.executionGeneration,
            company: {
                cik: company.cik,
                legalName: company.legalName,
                ticker: company.ticker,
                websiteUrl: company.websiteUrl,
                investorRelationsUrl: company.investorRelationsUrl,
            },
            queries: buildResearchPlan({
                company,
                coveragePreset: run.coveragePreset,
                researchAngle: run.researchAngle,
            }).queries,
            remainingCapacity: capacity.remaining,
        };
    },
});

export const verifyRebuildActive = internalQuery({
    args: {
        rebuildId: v.id("sourceSelectionProposalRebuilds"),
        cycle: v.number(),
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        expectedProposalId: v.id("sourceSelectionProposals"),
        executionGeneration: v.number(),
    },
    returns: v.object({ remainingCapacity: v.number() }),
    handler: async (ctx, args) => {
        const rebuild = await ctx.db.get(args.rebuildId);
        const run = await ctx.db.get(args.runId);
        const revision = await ctx.db.get(args.corpusRevisionId);
        if (
            rebuild?.status !== "started" ||
            (rebuild.cycle ?? 1) !== args.cycle ||
            rebuild.runId !== args.runId ||
            rebuild.corpusRevisionId !== args.corpusRevisionId ||
            rebuild.expectedProposalId !== args.expectedProposalId ||
            rebuild.executionGeneration !== args.executionGeneration ||
            rebuild.leaseExpiresAt <= Date.now() ||
            !run ||
            run.executionGeneration !== args.executionGeneration ||
            run.executionStatus !== "paused" ||
            run.lifecycleState !== "awaiting_source_review" ||
            run.pauseReason !== "source_review" ||
            run.activeCorpusRevisionId !== args.corpusRevisionId ||
            revision?.runId !== run._id ||
            revision.status !== "draft" ||
            revision.sourceSelectionProposalId !== args.expectedProposalId
        ) {
            throw new Error("Source proposal rebuild is no longer active");
        }
        const capacity = await readSourceCandidateCapacity(ctx.db, run._id);
        return { remainingCapacity: capacity.remaining };
    },
});

export const persistRebuildCandidates = internalMutation({
    args: {
        rebuildId: v.id("sourceSelectionProposalRebuilds"),
        cycle: v.number(),
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        expectedProposalId: v.id("sourceSelectionProposals"),
        executionGeneration: v.number(),
        operationKey: v.string(),
        providerCallId: v.id("providerCalls"),
        providerStatus: v.union(v.literal("succeeded"), v.literal("partial")),
        latencyMs: v.number(),
        rejected: v.number(),
        searchTime: v.optional(v.number()),
        reportedCost: v.optional(v.number()),
        candidates: v.array(rebuildCandidateValidator),
    },
    returns: v.object({ inserted: v.number(), total: v.number() }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        const revision = await ctx.db.get(args.corpusRevisionId);
        const rebuild = await ctx.db.get(args.rebuildId);
        const providerCall = await ctx.db.get(args.providerCallId);
        if (
            rebuild?.status !== "started" ||
            (rebuild.cycle ?? 1) !== args.cycle ||
            rebuild.runId !== args.runId ||
            rebuild.corpusRevisionId !== args.corpusRevisionId ||
            rebuild.expectedProposalId !== args.expectedProposalId ||
            rebuild.executionGeneration !== args.executionGeneration ||
            !run ||
            run.executionGeneration !== args.executionGeneration ||
            run.executionStatus !== "paused" ||
            run.lifecycleState !== "awaiting_source_review" ||
            run.pauseReason !== "source_review" ||
            run.activeCorpusRevisionId !== args.corpusRevisionId ||
            revision?.runId !== run._id ||
            revision.status !== "draft" ||
            revision.sourceSelectionProposalId !== args.expectedProposalId ||
            providerCall?.runId !== run._id ||
            providerCall.executionGeneration !== args.executionGeneration ||
            providerCall.status !== "started"
        ) {
            throw new Error("Source proposal rebuild is no longer active");
        }
        const capacity = await readSourceCandidateCapacity(ctx.db, run._id);
        let inserted = 0;
        const seen = new Set<string>();
        const now = Date.now();
        for (const candidate of args.candidates) {
            if (
                inserted >= capacity.remaining ||
                seen.has(candidate.canonicalUrl)
            ) {
                continue;
            }
            seen.add(candidate.canonicalUrl);
            const existing = await ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (query) =>
                    query
                        .eq("runId", run._id)
                        .eq("canonicalUrl", candidate.canonicalUrl),
                )
                .unique();
            if (existing) {
                if (
                    candidate.origin === "sec" &&
                    (!existing.secForm ||
                        !existing.providerReference ||
                        !existing.secAccessionNumber)
                ) {
                    await ctx.db.patch(existing._id, {
                        secForm: candidate.secForm ?? existing.secForm,
                        secAccessionNumber:
                            candidate.secAccessionNumber ??
                            existing.secAccessionNumber,
                        providerReference:
                            candidate.providerReference ??
                            existing.providerReference,
                    });
                }
                continue;
            }
            const sourceId = await ctx.db.insert("sources", {
                runId: run._id,
                ...candidate,
                createdAt: now,
            });
            const decisionId = await ctx.db.insert("sourceDecisions", {
                runId: run._id,
                corpusRevisionId: revision._id,
                sourceId,
                decisionKey: `${args.operationKey}:${candidate.canonicalUrl}`,
                decision: "pending",
                occurredAt: now,
            });
            await upsertSourceReviewItem(ctx, {
                runId: run._id,
                corpusRevisionId: revision._id,
                sourceId,
                decision: "pending",
                sourceCreatedAt: now,
                latestDecisionId: decisionId,
                decisionOccurredAt: now,
            });
            inserted += 1;
        }
        await ctx.db.patch(providerCall._id, {
            status: args.providerStatus,
            latencyMs: args.latencyMs,
            usage: {
                accepted: args.candidates.length,
                rejected: args.rejected,
                searchTime: args.searchTime,
            },
            reportedCost: args.reportedCost,
            completedAt: now,
        });
        return { inserted, total: capacity.total + inserted };
    },
});

export const finishRebuild = internalMutation({
    args: {
        rebuildId: v.id("sourceSelectionProposalRebuilds"),
        cycle: v.number(),
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        expectedProposalId: v.id("sourceSelectionProposals"),
        executionGeneration: v.number(),
        outcome: rebuildOutcomeValidator,
        failedDiscoveryFamilies: v.array(discoveryFamilyValidator),
    },
    returns: v.object({
        proposalId: v.id("sourceSelectionProposals"),
        version: v.number(),
        outcome: rebuildOutcomeValidator,
        failedDiscoveryFamilies: v.array(discoveryFamilyValidator),
    }),
    handler: async (ctx, args) => {
        const rebuild = await ctx.db.get(args.rebuildId);
        const run = await ctx.db.get(args.runId);
        const revision = await ctx.db.get(args.corpusRevisionId);
        if (
            rebuild?.status !== "started" ||
            (rebuild.cycle ?? 1) !== args.cycle ||
            rebuild.runId !== args.runId ||
            rebuild.corpusRevisionId !== args.corpusRevisionId ||
            rebuild.expectedProposalId !== args.expectedProposalId ||
            rebuild.executionGeneration !== args.executionGeneration ||
            !run ||
            run.executionGeneration !== args.executionGeneration ||
            run.executionStatus !== "paused" ||
            run.lifecycleState !== "awaiting_source_review" ||
            run.pauseReason !== "source_review" ||
            run.activeCorpusRevisionId !== args.corpusRevisionId ||
            revision?.runId !== run._id ||
            revision.status !== "draft"
        ) {
            throw new Error("Source proposal rebuild is no longer active");
        }
        const current = await readCurrentProposal(ctx, { run, revision });
        if (!current) {
            throw new Error("Source selection proposal is unavailable");
        }
        if (current._id !== args.expectedProposalId) {
            throw new Error("Source proposal rebuild was superseded");
        }
        const now = Date.now();
        if (args.outcome === "blocked") {
            await ctx.db.patch(rebuild._id, {
                status: "blocked",
                failedDiscoveryFamilies: args.failedDiscoveryFamilies,
                leaseExpiresAt: now + 15_000,
                completedAt: now,
            });
            return {
                proposalId: current._id,
                version: current.version,
                outcome: "blocked" as const,
                failedDiscoveryFamilies: args.failedDiscoveryFamilies,
            };
        }
        const proposal = await createSourceSelectionProposal(ctx, {
            run,
            revision,
            rebuild: {
                outcome: args.outcome,
                failedDiscoveryFamilies: args.failedDiscoveryFamilies,
            },
        });
        await ctx.db.patch(rebuild._id, {
            status: args.outcome,
            failedDiscoveryFamilies: args.failedDiscoveryFamilies,
            proposalId: proposal.proposalId,
            proposalVersion: proposal.version,
            completedAt: now,
        });
        return {
            proposalId: proposal.proposalId,
            version: proposal.version,
            outcome: args.outcome,
            failedDiscoveryFamilies: args.failedDiscoveryFamilies,
        };
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
            proposal.policyVersion !== SOURCE_SELECTION_POLICY_VERSION ||
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

export const startNewCorpusRevision = mutation({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
    },
    returns: v.object({
        corpusRevisionId: v.id("corpusRevisions"),
        proposalId: v.id("sourceSelectionProposals"),
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
            revision?.runId !== run._id ||
            revision._id !== run.activeCorpusRevisionId
        ) {
            throw new Error("Unauthorized");
        }
        if (
            revision.status !== "approved" ||
            run.lifecycleState !== "corpus_approved" ||
            run.executionStatus !== "idle"
        ) {
            throw new Error(
                "Current corpus revision must be approved before starting a new one",
            );
        }
        if (!run.coveragePreset) {
            throw new Error("Research run has no coverage preset");
        }

        const executionGeneration = run.executionGeneration + 1;
        const now = Date.now();

        // Transition run to awaiting_source_review / paused.
        await ctx.db.patch(run._id, {
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
            executionGeneration,
            updatedAt: now,
        });

        // Compute next revision number.
        const existingRevisions = await ctx.db
            .query("corpusRevisions")
            .withIndex("by_run_and_revision", (query) =>
                query.eq("runId", run._id),
            )
            .order("desc")
            .take(1);
        const nextRevision = (existingRevisions[0]?.revision ?? 0) + 1;

        const newRevisionId = await ctx.db.insert("corpusRevisions", {
            runId: run._id,
            revision: nextRevision,
            status: "draft",
            createdAt: now,
        });

        await ctx.db.patch(run._id, {
            activeCorpusRevisionId: newRevisionId,
            executionGeneration,
        });

        const newRevision = await ctx.db.get(newRevisionId);
        if (!newRevision) {
            throw new Error("New corpus revision was not created");
        }
        const proposal = await createSourceSelectionProposal(ctx, {
            run: { ...run, executionGeneration },
            revision: newRevision,
        });

        await ctx.db.insert("runEvents", {
            runId: run._id,
            sequence: run.nextEventSequence + 1,
            type: "corpus_revision_started",
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            occurredAt: now,
        });
        await ctx.db.patch(run._id, {
            nextEventSequence: run.nextEventSequence + 1,
        });

        await ctx.db.insert("auditEvents", {
            actor: { type: "visitor", visitorId: visitor._id },
            action: "new_corpus_revision",
            targetType: "corpus_revision",
            targetId: newRevisionId,
            occurredAt: now,
        });

        return {
            corpusRevisionId: newRevisionId,
            proposalId: proposal.proposalId,
        };
    },
});
