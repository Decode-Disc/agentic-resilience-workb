import { getAuthUserId } from "@convex-dev/auth/server";
import type { WorkflowId } from "@convex-dev/workflow";
import {
    paginationOptsValidator,
    paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import { internal } from "./_generated/api";
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
import { purgePreviewCacheForSource } from "./domain/previewCache";
import { readSourceCandidateCapacity } from "./domain/sourceCandidateCapacity";
import {
    SOURCE_COMPARISON_VERSION,
    type SourceComparisonDisposition,
    sourceComparisonOutcomesSchema,
} from "./domain/sourceComparison";
import {
    coverageRoleValidator,
    discoveryFamilyValidator,
    recoveryReasonValidator,
    recoverySearchPlan,
    recoveryTargetValidator,
} from "./domain/sourceDiscoveryRecovery";
import {
    preparationFailureCode,
    readPreparationLimits,
    sourcePreparationStopCodeValidator,
} from "./domain/sourcePreparationAuthority";
import {
    readPreparationHistory,
    readPreparationRecovery,
    readSourceReview,
    sourceReadingStatusValidator,
} from "./domain/sourcePreparationReview";
import { isReadableQualificationVersion } from "./domain/sourceQualification";
import { upsertSourceReviewItem } from "./domain/sourceReviewProjection";
import { SourceReviewReads } from "./domain/sourceReviewReads";
import {
    buildSourceSelectionProposal,
    canRefreshSourceSelectionPolicy,
    evaluateSourceCoverage,
    SOURCE_PUBLISHER_REGISTRY_VERSION,
    SOURCE_SELECTION_POLICY_VERSION,
    type SourceSelectionCandidate,
    sourceRoleAvailabilityValidator,
} from "./domain/sourceSelectionPolicy";
import {
    readComparisonHistory,
    readPinnedComparisonReview,
} from "./domain/sourceUsage";
import { canStartNewCorpusRevision } from "./domain/transitions";
import {
    MAX_SUPPLEMENT_SEARCHES,
    sourceDossierCandidateLimit,
    sourcePreparationEnabled,
    sourceRecommendedTarget,
} from "./resourceLimits";
import schema from "./schema";
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

const rebuildOutcomeValidator = v.union(
    v.literal("complete"),
    v.literal("partial"),
    v.literal("blocked"),
);

const reasonCodeValidator =
    schema.tables.sourceSelectionProposalItems.validator.fields.reasonCodes
        .element;
const selectionRationaleValidator =
    schema.tables.sourceSelectionProposalItems.validator.fields
        .selectionRationale;

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
    v.literal("unverified_counter_evidence"),
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

const companyLinkageBasisValidator = v.union(
    v.literal("inspected_content"),
    v.literal("structural"),
    v.literal("discovery_metadata"),
    v.literal("unverified"),
    v.literal("not_evaluated"),
);

const eligibleCoverageRolesValidator = v.array(coverageRoleValidator);

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
    readingStatus: v.optional(sourceReadingStatusValidator),
    sourceId: v.id("sources"),
    sourceCaptureId: v.optional(v.id("sourceCaptures")),
    qualificationTaskId: v.optional(v.id("aiTaskResults")),
    comparisonTaskIds: v.optional(v.array(v.id("aiTaskResults"))),
    comparisonOutcomes: v.optional(zodToConvex(sourceComparisonOutcomesSchema)),
    roleAvailability: v.optional(sourceRoleAvailabilityValidator),
    inspectionStatus: v.optional(
        v.union(
            v.literal("complete"),
            v.literal("partial"),
            v.literal("unavailable"),
        ),
    ),
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
    companyLinkageBasis: companyLinkageBasisValidator,
    coverageContributions: v.array(v.string()),
    recommendationContributions: v.array(v.string()),
    declaredCoverageRoles: eligibleCoverageRolesValidator,
    eligibleCoverageRoles: eligibleCoverageRolesValidator,
    duplicateOfSourceId: v.optional(v.id("sources")),
    rank: v.number(),
    reasonCodes: v.array(reasonCodeValidator),
    selectionRationale: selectionRationaleValidator,
    decision: decisionValidator,
    included: v.boolean(),
    decisionReason: v.optional(v.string()),
});

function comparisonOutcomePins(
    outcomes?: Record<number, SourceComparisonDisposition>,
) {
    return Object.entries(outcomes ?? {})
        .map(([findingIndex, disposition]) => ({
            findingIndex: Number(findingIndex),
            disposition,
        }))
        .sort((left, right) => left.findingIndex - right.findingIndex);
}

async function sourceSelectionFingerprint(input: {
    candidates: Array<Doc<"sources">>;
    qualificationInputs?: Array<{
        sourceId: Id<"sources">;
        taskId?: Id<"aiTaskResults">;
        captureId?: Id<"sourceCaptures">;
        comparisonTaskIds?: Array<Id<"aiTaskResults">>;
        comparisonOutcomes?: Record<number, SourceComparisonDisposition>;
    }>;
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
        qualificationInputs:
            input.qualificationInputs?.map(
                ({
                    sourceId,
                    taskId,
                    captureId,
                    comparisonTaskIds,
                    comparisonOutcomes,
                }) => ({
                    sourceId,
                    taskId,
                    captureId,
                    comparisonTaskIds: comparisonTaskIds ?? [],
                    comparisonOutcomes:
                        comparisonOutcomePins(comparisonOutcomes),
                }),
            ) ?? null,
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
                ...(source.reviewSearchId
                    ? { reviewSearchId: source.reviewSearchId }
                    : {}),
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
    run: Doc<"researchRuns">,
    reads?: SourceReviewReads,
): Promise<Array<Doc<"sources">>> {
    const limit = sourceDossierCandidateLimit(run.sourcePreparationId);
    const candidates = reads
        ? (await reads.sources()).slice(0, limit + 1)
        : await ctx.db
              .query("sources")
              .withIndex("by_run_and_url", (query) =>
                  query.eq("runId", run._id),
              )
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
    reads?: SourceReviewReads,
): Promise<string> {
    if (!run.coveragePreset) {
        throw new Error("Research run has no coverage preset");
    }
    const company = await readSelectionCompany(ctx, run);
    const candidates = await readProposalCandidates(ctx, run, reads);
    const qualificationInputs = await readQualificationInputs(
        ctx,
        run,
        candidates,
        reads,
    );
    return sourceSelectionFingerprint({
        candidates,
        qualificationInputs,
        coveragePreset: run.coveragePreset,
        researchAngle: run.researchAngle,
        ceiling: sourceRecommendedTarget(run.sourcePreparationId),
        company,
    });
}

/** Resolves immutable content judgments without making page reads start paid work. */
async function readQualificationInputs(
    ctx: QueryCtx | MutationCtx,
    run: Doc<"researchRuns">,
    candidates: Doc<"sources">[],
    reads?: SourceReviewReads,
) {
    if (!run.sourcePreparationId) return undefined;
    return Promise.all(
        candidates.map(async (source) => {
            const tasks = reads
                ? await reads.qualificationHistory(source._id)
                : await ctx.db
                      .query("aiTaskResults")
                      .withIndex(
                          "by_source_and_task_type_and_created_at",
                          (q) =>
                              q
                                  .eq("sourceId", source._id)
                                  .eq("taskType", "source_qualification"),
                      )
                      .order("desc")
                      .take(4);
            for (const task of tasks) {
                if (
                    !isReadableQualificationVersion(task.schemaVersion) ||
                    task.runId !== run._id ||
                    task.output.kind !== "source_qualification"
                )
                    continue;
                const capture = await (reads?.capture(
                    task.output.sourceCaptureId,
                ) ?? ctx.db.get(task.output.sourceCaptureId));
                if (
                    capture?.status !== "committed" ||
                    capture.sourceId !== source._id ||
                    capture.runId !== run._id ||
                    capture.contentHash !== task.output.contentHash
                )
                    continue;
                const comparisonTaskIds = await readComparisonTaskIds(
                    ctx,
                    source._id,
                    capture._id,
                    capture.contentHash,
                    reads,
                );
                let comparisonReview: Pick<
                    Awaited<ReturnType<typeof readPinnedComparisonReview>>,
                    "outcomes" | "details"
                > = { outcomes: {}, details: {} };
                if (run.activeCorpusRevisionId) {
                    const comparisonItem = {
                        runId: run._id,
                        sourceId: source._id,
                        corpusRevisionId: run.activeCorpusRevisionId,
                        comparisonTaskIds,
                    };
                    const pinned = {
                        sourceCaptureId: capture._id,
                        contentHash: capture.contentHash,
                        qualificationTaskId: task._id,
                        qualification: task.output.qualification,
                        readingCompleteness: task.output.readingCompleteness,
                        qualificationExecutionMode: task.executionMode,
                    };
                    comparisonReview = await (reads?.comparisonReview(
                        comparisonItem,
                        pinned,
                    ) ??
                        readPinnedComparisonReview(
                            ctx.db,
                            comparisonItem,
                            pinned,
                        ));
                }
                const comparisonOutcomes = comparisonReview.outcomes;
                return {
                    sourceId: source._id,
                    taskId: task._id,
                    captureId: capture._id,
                    comparisonTaskIds,
                    comparisonOutcomes,
                    inspection: {
                        status: "qualified",
                        qualification: task.output.qualification,
                        readingCompleteness: task.output.readingCompleteness,
                        comparisonOutcomes,
                    } satisfies SourceSelectionCandidate["inspection"],
                };
            }
            const capture = reads
                ? (await reads.captureHistory(source._id))[0]
                : await ctx.db
                      .query("sourceCaptures")
                      .withIndex("by_source_and_status_and_updated_at", (q) =>
                          q
                              .eq("sourceId", source._id)
                              .eq("status", "committed"),
                      )
                      .order("desc")
                      .first();
            return {
                sourceId: source._id,
                taskId: undefined,
                captureId: capture?.runId === run._id ? capture._id : undefined,
                comparisonTaskIds: [],
                comparisonOutcomes: {},
                inspection: {
                    status: "unavailable",
                    reasonCode: "qualification_unavailable",
                } satisfies SourceSelectionCandidate["inspection"],
            };
        }),
    );
}

async function readComparisonTaskIds(
    ctx: QueryCtx | MutationCtx,
    sourceId: Id<"sources">,
    captureId: Id<"sourceCaptures">,
    contentHash: string,
    reads?: SourceReviewReads,
) {
    const ids: Id<"aiTaskResults">[] = [];
    for await (const task of reads
        ? await reads.comparisonHistory(sourceId)
        : readComparisonHistory(ctx.db, { sourceId })) {
        if (
            task.schemaVersion === SOURCE_COMPARISON_VERSION &&
            task.output.kind === "source_comparison" &&
            task.output.targetCaptureId === captureId &&
            task.output.targetContentHash === contentHash
        )
            ids.push(task._id);
    }
    return ids.reverse();
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
    ctx: QueryCtx | MutationCtx,
    item: Doc<"sourceSelectionProposalItems">,
    context: ProposalContext & {
        preparations: Doc<"sourceSelectionProposalRebuilds">[];
        company: Awaited<ReturnType<typeof readSelectionCompany>>;
        reads?: SourceReviewReads;
    },
) {
    const source = await (context.reads?.source(item.sourceId) ??
        ctx.db.get(item.sourceId));
    if (!source) {
        throw new Error("Source proposal projection is incomplete");
    }
    const { reading, classification } = await readSourceReview(ctx.db, {
        ...context,
        source,
        item,
    });
    const current = classification ?? item;
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
        reading,
        source: {
            ...(reading ? { readingStatus: reading.status } : {}),
            sourceId: source._id,
            ...(item.sourceCaptureId
                ? { sourceCaptureId: item.sourceCaptureId }
                : {}),
            ...(item.qualificationTaskId
                ? { qualificationTaskId: item.qualificationTaskId }
                : {}),
            ...(item.comparisonTaskIds?.length
                ? { comparisonTaskIds: item.comparisonTaskIds }
                : {}),
            ...(item.comparisonOutcomes
                ? { comparisonOutcomes: item.comparisonOutcomes }
                : {}),
            ...(current.roleAvailability
                ? { roleAvailability: current.roleAvailability }
                : {}),
            ...(current.inspectionStatus
                ? { inspectionStatus: current.inspectionStatus }
                : {}),
            canonicalUrl: source.canonicalUrl,
            title: source.title,
            origin: source.origin,
            category: source.category,
            publishedAt: source.publishedAt,
            disposition: item.disposition,
            sourceFamily: current.sourceFamily,
            documentKind: current.documentKind ?? "unknown",
            authorityTier: current.authorityTier ?? "unverified",
            companyLinkageBasis: current.companyLinkageBasis ?? "not_evaluated",
            coverageContributions: current.coverageContributions ?? [],
            recommendationContributions:
                current.recommendationContributions ?? [],
            declaredCoverageRoles: current.declaredCoverageRoles ?? [],
            eligibleCoverageRoles: current.eligibleCoverageRoles ?? [],
            duplicateOfSourceId: item.duplicateOfSourceId,
            rank: item.rank,
            reasonCodes: item.reasonCodes,
            ...(item.selectionRationale
                ? { selectionRationale: item.selectionRationale }
                : {}),
            decision,
            included: isIncluded(item.disposition, decision),
            decisionReason: reviewItem?.reason,
        },
    };
}

async function recordRecoveryProgress(
    ctx: MutationCtx,
    run: Doc<"researchRuns">,
    type: "source_recovery_started" | "source_recovery_completed",
) {
    const sequence = run.nextEventSequence + 1;
    await ctx.db.patch(run._id, {
        nextEventSequence: sequence,
        updatedAt: Date.now(),
    });
    await ctx.db.insert("runEvents", {
        runId: run._id,
        sequence,
        type,
        lifecycleState: run.lifecycleState,
        executionStatus: run.executionStatus,
        occurredAt: Date.now(),
    });
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
    if (!rebuild && revision.sourceSelectionProposalId) {
        const previous = await ctx.db.get(revision.sourceSelectionProposalId);
        if (
            previous?.rebuildOutcome === "partial" ||
            previous?.rebuildOutcome === "complete"
        )
            rebuild = {
                outcome: previous.rebuildOutcome,
                failedDiscoveryFamilies: previous.failedDiscoveryFamilies ?? [],
            };
    }
    const candidates = await readProposalCandidates(ctx, run);
    const recommendationCeiling = sourceRecommendedTarget(
        run.sourcePreparationId,
    );
    const company = await readSelectionCompany(ctx, run);
    const qualificationInputs = await readQualificationInputs(
        ctx,
        run,
        candidates,
    );
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
            requiresAnalystReview: source.reviewSearchId !== undefined,
            createdAt: source.createdAt,
            inspection: qualificationInputs?.find(
                (input) => input.sourceId === source._id,
            )?.inspection,
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
        sourcePreparationId: run.sourcePreparationId,
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
            qualificationInputs,
            coveragePreset: run.coveragePreset,
            researchAngle: run.researchAngle,
            ceiling: recommendationCeiling,
            company,
        }),
        status: "ready",
        counts: result.counts,
        gaps: result.gaps,
        coverageGaps: result.coverageGaps,
        documentaryCoverageGaps: result.documentaryCoverageGaps,
        createdAt: now,
    });
    for (const item of result.items) {
        await ctx.db.insert("sourceSelectionProposalItems", {
            runId: run._id,
            corpusRevisionId: revision._id,
            proposalId,
            sourceId: item.sourceId as Id<"sources">,
            sourceCaptureId: qualificationInputs?.find(
                (input) => input.sourceId === item.sourceId,
            )?.captureId,
            qualificationTaskId: qualificationInputs?.find(
                (input) => input.sourceId === item.sourceId,
            )?.taskId,
            comparisonTaskIds: qualificationInputs?.find(
                (input) => input.sourceId === item.sourceId,
            )?.comparisonTaskIds,
            comparisonOutcomes: comparisonOutcomePins(
                qualificationInputs?.find(
                    (input) => input.sourceId === item.sourceId,
                )?.comparisonOutcomes,
            ),
            roleAvailability: item.roleAvailability,
            inspectionStatus: item.inspectionStatus,
            disposition: item.disposition,
            sourceFamily: item.sourceFamily,
            documentKind: item.documentKind,
            authorityTier: item.authorityTier,
            companyLinkageBasis: item.companyLinkageBasis,
            coverageContributions: item.coverageContributions,
            recommendationContributions: item.recommendationContributions,
            declaredCoverageRoles: item.declaredCoverageRoles,
            eligibleCoverageRoles: item.eligibleCoverageRoles,
            duplicateOfSourceId: item.duplicateOfSourceId
                ? (item.duplicateOfSourceId as Id<"sources">)
                : undefined,
            rank: item.rank,
            reasonCodes: item.reasonCodes,
            ...(item.selectionRationale
                ? { selectionRationale: item.selectionRationale }
                : {}),
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

async function hydrateProposalItems(
    ctx: QueryCtx | MutationCtx,
    items: Doc<"sourceSelectionProposalItems">[],
    context: ProposalContext & { reads?: SourceReviewReads },
) {
    const [preparations, company] = await Promise.all([
        readPreparationHistory(ctx.db, context.run._id, context.revision._id),
        readSelectionCompany(ctx, context.run),
    ]);
    const reviews = await Promise.all(
        items.map((item) =>
            hydrateProposalItem(ctx, item, {
                ...context,
                preparations,
                company,
            }),
        ),
    );
    return {
        sources: reviews.map((review) => review.source),
        readings: reviews.map((review) => review.reading),
        preparations,
    };
}

async function readProposalReviews(
    ctx: QueryCtx | MutationCtx,
    proposal: Doc<"sourceSelectionProposals">,
    context: ProposalContext & { reads?: SourceReviewReads },
) {
    const items = await ctx.db
        .query("sourceSelectionProposalItems")
        .withIndex("by_proposal_and_rank_and_source", (q) =>
            q.eq("proposalId", proposal._id),
        )
        .take(sourceDossierCandidateLimit(proposal.sourcePreparationId) + 1);
    if (
        items.length > sourceDossierCandidateLimit(proposal.sourcePreparationId)
    )
        throw new Error("Source selection proposal exceeds its limit");
    const reads =
        context.reads ?? new SourceReviewReads(ctx.db, context.run._id);
    await reads.sources();
    return hydrateProposalItems(ctx, items, { ...context, reads });
}

export const getCurrent = query({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        now: v.optional(v.number()),
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
            coverageRequirements: v.array(
                v.object({
                    role: coverageRoleValidator,
                    covered: v.boolean(),
                    availability: v.optional(
                        v.union(
                            v.literal("available"),
                            v.literal("limited"),
                            v.literal("not_established"),
                        ),
                    ),
                    reasonCodes: v.optional(v.array(v.string())),
                    candidateIds: v.array(v.id("sources")),
                    relatedCandidateIds: v.optional(v.array(v.id("sources"))),
                    assessmentStatus: v.optional(
                        v.union(v.literal("pending"), v.literal("assessed")),
                    ),
                    includedSourceIds: v.optional(v.array(v.id("sources"))),
                }),
            ),
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
            recovery: v.union(
                v.null(),
                schema
                    .doc("sourceSelectionProposalRebuilds")
                    .pick(
                        "status",
                        "requestId",
                        "target",
                        "reason",
                        "leaseExpiresAt",
                        "completedAt",
                        "insertedCount",
                        "readingSourceIds",
                    ),
            ),
            effectiveIncludedCount: v.number(),
            selectionExplanationRefreshAvailable: v.optional(v.boolean()),
            revisionStatus: v.union(v.literal("draft"), v.literal("approved")),
            preparation: v.optional(
                v.object({
                    preparationId: v.optional(
                        v.id("sourceSelectionProposalRebuilds"),
                    ),
                    status: schema.tables.sourceSelectionProposalRebuilds
                        .validator.fields.status,
                    checked: v.number(),
                    total: v.number(),
                    captured: v.optional(v.number()),
                    assessed: v.optional(v.number()),
                    failed: v.optional(v.number()),
                    remaining: v.optional(v.number()),
                    excluded: v.optional(v.number()),
                    stopCode: v.optional(sourcePreparationStopCodeValidator),
                    canResume: v.boolean(),
                    pendingComparisons: v.optional(v.number()),
                    progress:
                        schema.tables.sourceSelectionProposalRebuilds.validator
                            .fields.progress,
                    lastActivityAt: v.optional(v.number()),
                    initialReadingsCompletedAt: v.optional(v.number()),
                    proposalPublished: v.optional(v.boolean()),
                }),
            ),
            preparationAction: v.optional(
                v.object({
                    kind: v.union(v.literal("start"), v.literal("resume")),
                    available: v.boolean(),
                    reason: v.optional(
                        v.union(
                            v.literal("disabled"),
                            v.literal("busy"),
                            v.literal("read_only"),
                            v.literal("deadline_elapsed"),
                            v.literal("missing_configuration"),
                            v.literal("complete"),
                            v.literal("cooldown"),
                            v.literal("attempts_exhausted"),
                            v.literal("work_budget_exhausted"),
                            v.literal("incident_budget_exhausted"),
                            v.literal("outcome_unknown"),
                            v.literal("no_eligible_work"),
                            v.literal("configuration_unavailable"),
                        ),
                    ),
                    deadlineAt: v.optional(v.number()),
                    retryAt: v.optional(v.number()),
                }),
            ),
            searchAllowance: v.optional(
                v.object({
                    remainingSearches: v.number(),
                    remainingCandidates: v.number(),
                    deadlineAt: v.optional(v.number()),
                    enabled: v.boolean(),
                }),
            ),
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
        const reads = new SourceReviewReads(ctx.db, run._id);
        await reads.sources();
        const preparation = run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
        const expiredReview =
            preparation?.status === "started" &&
            (preparation.deadlineAt ?? Infinity) <= (args.now ?? Date.now()) &&
            preparation.executionGeneration === run.executionGeneration &&
            run.lifecycleState === "awaiting_source_review";
        const {
            sources: hydrated,
            readings,
            preparations,
        } = await readProposalReviews(ctx, proposal, { ...context, reads });
        const eligibleReadings = readings.filter(
            (reading, index) =>
                reading && hydrated[index]?.decision !== "rejected",
        );
        const assessed = eligibleReadings.filter((r) => r?.assessed).length;
        const unresolvedSourceIds = new Set(
            hydrated
                .filter(
                    (item, index) =>
                        item.decision !== "rejected" &&
                        !readings[index]?.assessed,
                )
                .map((item) => item.sourceId),
        );
        const interruptedReading = preparations.find((p) => {
            const scope = p.readingSourceIds ?? p.manualSourceIds;
            return (
                p.stopCode &&
                (scope
                    ? scope.some((id) => unresolvedSourceIds.has(id))
                    : !p.target && unresolvedSourceIds.size > 0)
            );
        });
        const preparationSummary = preparations.length
            ? {
                  preparationId: preparation?._id,
                  proposalPublished:
                      preparation?.status !== "started" &&
                      preparation?.proposalId === proposal._id,
                  initialReadingsCompletedAt: preparations.find(
                      (operation) =>
                          operation.initialReadingsCompletedAt !== undefined,
                  )?.initialReadingsCompletedAt,
                  ...(preparation?.progress
                      ? { progress: preparation.progress }
                      : {}),
                  lastActivityAt:
                      preparation?.completedAt ??
                      preparation?.progress?.updatedAt ??
                      run.updatedAt,
                  status:
                      preparation?.status === "started" && !expiredReview
                          ? ("started" as const)
                          : unresolvedSourceIds.size === 0
                            ? ("complete" as const)
                            : assessed > 0
                              ? ("partial" as const)
                              : ("blocked" as const),
                  checked: eligibleReadings.filter(
                      (r) =>
                          r?.status !== "not_started" &&
                          r?.status !== "preparing",
                  ).length,
                  total: eligibleReadings.length,
                  excluded: hydrated.filter(
                      (source) => source.decision === "rejected",
                  ).length,
                  captured: eligibleReadings.filter((r) => r?.captured).length,
                  assessed,
                  failed: eligibleReadings.filter(
                      (r) =>
                          r?.status === "reading_failed" ||
                          r?.status === "assessment_unavailable",
                  ).length,
                  remaining: eligibleReadings.filter(
                      (r) =>
                          r?.status === "not_started" ||
                          r?.status === "preparing",
                  ).length,
                  stopCode: interruptedReading?.stopCode,
                  canResume: false,
                  pendingComparisons: 0,
              }
            : undefined;
        const running = run.ownerVisitorId
            ? await ctx.db
                  .query("researchRuns")
                  .withIndex("by_owner_and_execution_status", (q) =>
                      q
                          .eq("ownerVisitorId", run.ownerVisitorId)
                          .eq("executionStatus", "running"),
                  )
                  .take(2)
            : [];
        const deadlineAt = preparation?.deadlineAt;
        const recoveryPlan =
            preparation?.kind === "preparation" &&
            (preparation.status !== "started" || expiredReview) &&
            revision.status === "draft"
                ? await readPreparationRecovery(ctx.db, {
                      runId: run._id,
                      corpusRevisionId: revision._id,
                      preparation,
                      now: args.now ?? Date.now(),
                      reads,
                      preparations,
                  })
                : null;
        if (preparationSummary && recoveryPlan?.pendingComparisons) {
            preparationSummary.pendingComparisons =
                recoveryPlan.pendingComparisons;
            preparationSummary.status = "partial";
        }
        let configurationUnavailable =
            recoveryPlan?.blockedReason === "preparation_configuration_invalid";
        if (!recoveryPlan) {
            try {
                readPreparationLimits();
            } catch (error) {
                if (
                    preparationFailureCode(error) !==
                    "preparation_configuration_invalid"
                )
                    throw error;
                configurationUnavailable = true;
            }
        }
        const preparationActionReason =
            revision.status !== "draft"
                ? ("read_only" as const)
                : !sourcePreparationEnabled()
                  ? ("disabled" as const)
                  : configurationUnavailable
                    ? ("configuration_unavailable" as const)
                    : (run.executionStatus !== "paused" && !expiredReview) ||
                        running.some(
                            (item) => item._id !== run._id || !expiredReview,
                        )
                      ? ("busy" as const)
                      : recoveryPlan &&
                          recoveryPlan.resumableSourceIds.length === 0 &&
                          !recoveryPlan.hasSearchWork &&
                          recoveryPlan.blockedReason
                        ? recoveryPlan.retryAt !== undefined
                            ? ("cooldown" as const)
                            : recoveryPlan.blockedReason ===
                                    "work_budget_exhausted" ||
                                recoveryPlan.blockedReason ===
                                    "incident_budget_exhausted"
                              ? (recoveryPlan.blockedReason as
                                    | "work_budget_exhausted"
                                    | "incident_budget_exhausted")
                              : [
                                      "recovery_attempt_exhausted",
                                      "model_attempt_limit_reached",
                                  ].includes(recoveryPlan.blockedReason)
                                ? ("attempts_exhausted" as const)
                                : recoveryPlan.blockedReason ===
                                    "attempt_outcome_unknown"
                                  ? ("outcome_unknown" as const)
                                  : ("no_eligible_work" as const)
                        : preparationSummary &&
                            unresolvedSourceIds.size === 0 &&
                            !recoveryPlan?.resumableSourceIds.length &&
                            !recoveryPlan?.hasSearchWork
                          ? ("complete" as const)
                          : undefined;
        const preparationAction = {
            kind: preparationSummary ? ("resume" as const) : ("start" as const),
            available: preparationActionReason === undefined,
            ...(preparationActionReason
                ? { reason: preparationActionReason }
                : {}),
            ...(deadlineAt !== undefined ? { deadlineAt } : {}),
            ...(recoveryPlan?.retryAt !== undefined
                ? { retryAt: recoveryPlan.retryAt }
                : {}),
        };
        if (preparationSummary)
            preparationSummary.canResume = preparationAction.available;
        const fingerprint = await currentFingerprint(ctx, run, reads);
        const coverageRequirements = evaluateSourceCoverage(
            proposal.coveragePreset,
            hydrated,
        ).map((requirement) => ({
            ...requirement,
            ...(preparationSummary
                ? {
                      assessmentStatus:
                          !requirement.covered &&
                          requirement.candidateIds.some((sourceId) => {
                              const index = hydrated.findIndex(
                                  (s) => s.sourceId === sourceId,
                              );
                              return (
                                  index >= 0 &&
                                  hydrated[index]?.included &&
                                  !readings[index]?.assessed
                              );
                          })
                              ? ("pending" as const)
                              : ("assessed" as const),
                  }
                : {}),
            includedSourceIds: requirement.candidateIds.filter((sourceId) =>
                hydrated.some(
                    (source) => source.sourceId === sourceId && source.included,
                ),
            ),
        }));
        const supplement = run.automaticSupplementOperationId
            ? await ctx.db.get(run.automaticSupplementOperationId)
            : null;
        const searchAllowance = preparationSummary
            ? {
                  enabled: sourcePreparationEnabled(),
                  remainingSearches: Math.max(
                      0,
                      MAX_SUPPLEMENT_SEARCHES -
                          (supplement?.supplementClaimedQueryIndexes?.length ??
                              0),
                  ),
                  remainingCandidates: (
                      await readSourceCandidateCapacity(ctx.db, run._id)
                  ).remaining,
                  ...(preparation?.status === "started" &&
                  !expiredReview &&
                  preparation.deadlineAt !== undefined
                      ? { deadlineAt: preparation.deadlineAt }
                      : {}),
              }
            : undefined;
        const latestRecovery = await ctx.db
            .query("sourceSelectionProposalRebuilds")
            .withIndex("by_revision_and_created_at", (q) =>
                q.eq("corpusRevisionId", revision._id),
            )
            .order("desc")
            .first();
        const recovery =
            (latestRecovery?.kind !== "preparation" ||
                latestRecovery?.target) &&
            latestRecovery?.requestId
                ? {
                      status: latestRecovery.status,
                      requestId: latestRecovery.requestId,
                      target: latestRecovery.target,
                      reason: latestRecovery.reason,
                      leaseExpiresAt: latestRecovery.leaseExpiresAt,
                      completedAt: latestRecovery.completedAt,
                      insertedCount: latestRecovery.insertedCount,
                      readingSourceIds: latestRecovery.readingSourceIds,
                  }
                : null;
        return {
            proposalId: proposal._id,
            version: proposal.version,
            status: proposal.status,
            effectiveStatus:
                proposal.status === "failed"
                    ? ("failed" as const)
                    : !canRefreshSourceSelectionPolicy(proposal.policyVersion)
                      ? ("outdated" as const)
                      : proposal.policyVersion ===
                              SOURCE_SELECTION_POLICY_VERSION &&
                          fingerprint === proposal.candidateFingerprint
                        ? ("ready" as const)
                        : ("stale" as const),
            recommendedTarget: proposal.recommendedTarget,
            recommendationCeiling:
                proposal.recommendationCeiling ?? proposal.recommendedTarget,
            rebuildOutcome: proposal.rebuildOutcome,
            failedDiscoveryFamilies: proposal.failedDiscoveryFamilies ?? [],
            coverageGaps: coverageRequirements
                .filter((item) => !item.covered)
                .map((item) => item.role),
            coverageRequirements,
            recovery,
            counts: proposal.counts,
            gaps: proposal.gaps,
            effectiveIncludedCount: hydrated.filter(({ included }) => included)
                .length,
            selectionExplanationRefreshAvailable:
                revision.status === "draft" &&
                run.activeCorpusRevisionId === revision._id &&
                run.lifecycleState === "awaiting_source_review" &&
                run.executionStatus === "paused" &&
                run.pauseReason === "source_review" &&
                canRefreshSourceSelectionPolicy(proposal.policyVersion) &&
                hydrated.some(
                    (item) =>
                        item.disposition === "recommended" &&
                        !item.selectionRationale,
                ),
            revisionStatus: revision.status,
            ...(preparationSummary ? { preparation: preparationSummary } : {}),
            ...(revision.status === "draft" ? { preparationAction } : {}),
            ...(searchAllowance ? { searchAllowance } : {}),
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
            page: (await hydrateProposalItems(ctx, page.page, context)).sources,
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
        const { sources: hydrated } = await readProposalReviews(
            ctx,
            proposal,
            context,
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
            !canRefreshSourceSelectionPolicy(
                (await ctx.db.get(args.expectedProposalId))?.policyVersion ??
                    "",
            ) ||
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
        recovery: v.optional(
            v.object({
                requestId: v.string(),
                target: recoveryTargetValidator,
            }),
        ),
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
            families: v.array(discoveryFamilyValidator),
            initialFailedFamilies: v.array(discoveryFamilyValidator),
        }),
        v.object({
            shouldExecute: v.literal(false),
            proposalId: v.id("sourceSelectionProposals"),
            version: v.number(),
            outcome: rebuildOutcomeValidator,
            failedDiscoveryFamilies: v.array(discoveryFamilyValidator),
            reason: v.optional(recoveryReasonValidator),
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
        if (run.sourcePreparationId)
            throw new Error(
                "Source preparation must use its bounded review operation",
            );
        const recovery = args.recovery;
        if (
            recovery &&
            (!recovery.requestId.trim() || recovery.requestId.length > 128)
        )
            throw new Error("Invalid recovery request");
        const operationKey = `run:${args.runId}:generation:${run.executionGeneration}:corpus:${args.corpusRevisionId}:proposal:${args.expectedProposalId}:policy:${SOURCE_SELECTION_POLICY_VERSION}${recovery ? `:request:${recovery.requestId}` : ""}`;
        const existing = await ctx.db
            .query("sourceSelectionProposalRebuilds")
            .withIndex("by_operation_key", (query) =>
                query.eq("operationKey", operationKey),
            )
            .unique();
        const now = Date.now();
        if (existing) {
            if (
                recovery &&
                (existing.target?.kind !== recovery.target.kind ||
                    (recovery.target.kind === "coverage" &&
                        (existing.target?.kind !== "coverage" ||
                            existing.target.role !== recovery.target.role)))
            )
                throw new Error(
                    "Recovery request was reused for a different target",
                );
            if (
                recovery &&
                existing.status === "started" &&
                existing.leaseExpiresAt <= now
            ) {
                await ctx.db.patch(existing._id, {
                    status: "blocked",
                    reason: "unavailable",
                    completedAt: now,
                });
                await recordRecoveryProgress(
                    ctx,
                    run,
                    "source_recovery_completed",
                );
                return {
                    shouldExecute: false as const,
                    proposalId: proposal._id,
                    version: proposal.version,
                    outcome: "blocked" as const,
                    failedDiscoveryFamilies: existing.failedDiscoveryFamilies,
                    reason: "unavailable" as const,
                };
            }
            if (recovery && existing.status === "blocked")
                return {
                    shouldExecute: false as const,
                    proposalId: proposal._id,
                    version: proposal.version,
                    outcome: "blocked" as const,
                    failedDiscoveryFamilies: existing.failedDiscoveryFamilies,
                    reason: existing.reason ?? ("unavailable" as const),
                };
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
                    reason: existing.reason,
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
                    reason: "in_progress" as const,
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
                    reason: "cooldown" as const,
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
            (recovery
                ? currentProposal.policyVersion !==
                  SOURCE_SELECTION_POLICY_VERSION
                : currentProposal.policyVersion ===
                  SOURCE_SELECTION_POLICY_VERSION) ||
            run.lifecycleState !== "awaiting_source_review" ||
            run.executionStatus !== "paused" ||
            run.pauseReason !== "source_review" ||
            !run.coveragePreset
        ) {
            throw new Error("Source selection proposal cannot be rebuilt");
        }
        const active = await ctx.db
            .query("sourceSelectionProposalRebuilds")
            .withIndex("by_revision_and_status_and_lease", (q) =>
                q
                    .eq("corpusRevisionId", revision._id)
                    .eq("status", "started")
                    .gt("leaseExpiresAt", now),
            )
            .first();
        if (active)
            return {
                shouldExecute: false as const,
                proposalId: proposal._id,
                version: proposal.version,
                outcome: "blocked" as const,
                failedDiscoveryFamilies: proposal.failedDiscoveryFamilies ?? [],
                reason: "in_progress" as const,
            };
        const latest = await ctx.db
            .query("sourceSelectionProposalRebuilds")
            .withIndex("by_revision_and_created_at", (q) =>
                q.eq("corpusRevisionId", revision._id),
            )
            .order("desc")
            .first();
        if (
            recovery &&
            latest?.status === "blocked" &&
            latest.leaseExpiresAt > now
        )
            return {
                shouldExecute: false as const,
                proposalId: proposal._id,
                version: proposal.version,
                outcome: "blocked" as const,
                failedDiscoveryFamilies: proposal.failedDiscoveryFamilies ?? [],
                reason: "cooldown" as const,
            };
        if (
            recovery &&
            (await currentFingerprint(ctx, run)) !==
                proposal.candidateFingerprint
        )
            throw new Error(
                "Source proposal changed; refresh before searching",
            );
        const company = await readSelectionCompany(ctx, run);
        if (!company) {
            throw new Error("Confirmed company was not found");
        }
        const capacity = await readSourceCandidateCapacity(ctx.db, run._id);
        const failedFamilies = proposal.failedDiscoveryFamilies ?? [];
        if (recovery?.target.kind === "coverage") {
            const items = evaluateSourceCoverage(
                proposal.coveragePreset,
                (await readProposalReviews(ctx, proposal, { run, revision }))
                    .sources,
            );
            const role = recovery.target.role;
            if (!items.some((item) => item.role === role && !item.covered))
                throw new Error("Coverage requirement is no longer missing");
        }
        const plan = recoverySearchPlan({
            company,
            coveragePreset: run.coveragePreset,
            researchAngle: run.researchAngle,
            target: recovery?.target,
            failedFamilies,
        });
        if (recovery && capacity.remaining === 0)
            return {
                shouldExecute: false as const,
                proposalId: proposal._id,
                version: proposal.version,
                outcome: "blocked" as const,
                failedDiscoveryFamilies: failedFamilies,
                reason: "capacity_reached" as const,
            };
        if (recovery && plan.families.length === 0)
            throw new Error("No failed discovery remains");
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
                  requestId: recovery?.requestId,
                  target: recovery?.target,
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
        if (recovery)
            await recordRecoveryProgress(ctx, run, "source_recovery_started");
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
            queries: plan.queries,
            families: plan.families,
            initialFailedFamilies:
                recovery?.target.kind === "failed_discovery"
                    ? failedFamilies.filter(
                          (family) => !plan.families.includes(family),
                      )
                    : recovery
                      ? failedFamilies
                      : [],
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
            rebuild.leaseExpiresAt <= Date.now() ||
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
        insertedCount: v.optional(v.number()),
        blockedReason: v.optional(
            v.union(v.literal("request_rejected"), v.literal("unavailable")),
        ),
        failedDiscoveryFamilies: v.array(discoveryFamilyValidator),
    },
    returns: v.object({
        proposalId: v.id("sourceSelectionProposals"),
        version: v.number(),
        outcome: rebuildOutcomeValidator,
        failedDiscoveryFamilies: v.array(discoveryFamilyValidator),
        reason: v.optional(recoveryReasonValidator),
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
            rebuild.leaseExpiresAt <= Date.now() ||
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
        if (rebuild.requestId)
            await recordRecoveryProgress(ctx, run, "source_recovery_completed");
        const now = Date.now();
        if (args.outcome === "blocked") {
            const reason = args.blockedReason ?? "unavailable";
            await ctx.db.patch(rebuild._id, {
                status: "blocked",
                reason,
                failedDiscoveryFamilies: args.failedDiscoveryFamilies,
                leaseExpiresAt: now + 15_000,
                completedAt: now,
            });
            return {
                proposalId: current._id,
                version: current.version,
                outcome: "blocked" as const,
                reason,
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
            insertedCount: args.insertedCount,
            reason:
                rebuild.requestId && args.insertedCount === 0
                    ? "no_new_candidates"
                    : undefined,
            failedDiscoveryFamilies: args.failedDiscoveryFamilies,
            proposalId: proposal.proposalId,
            proposalVersion: proposal.version,
            completedAt: now,
        });
        return {
            proposalId: proposal.proposalId,
            version: proposal.version,
            outcome: args.outcome,
            reason:
                rebuild.requestId && args.insertedCount === 0
                    ? ("no_new_candidates" as const)
                    : undefined,
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
            run.pauseReason !== "source_review"
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
            .take(sourceDossierCandidateLimit(run.sourcePreparationId) + 1);
        if (
            items.length > sourceDossierCandidateLimit(run.sourcePreparationId)
        ) {
            throw new Error("Source selection proposal exceeds its limit");
        }
        if (
            await ctx.db
                .query("sourceSelectionProposalRebuilds")
                .withIndex("by_revision_and_status_and_lease", (q) =>
                    q
                        .eq("corpusRevisionId", revision._id)
                        .eq("status", "started")
                        .gt("leaseExpiresAt", Date.now()),
                )
                .first()
        )
            throw new Error("Source discovery is still active");
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
            // The source is now accepted (decided), so its candidate preview
            // must not linger in the cache.
            await purgePreviewCacheForSource(ctx, source._id);
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
        if (run.workflowId) {
            await workflow.sendEvent(ctx, {
                ...corpusRevisionApproved,
                workflowId: run.workflowId as WorkflowId,
                value: {
                    decisionId: checkpointDecisionId,
                    corpusRevisionId: revision._id,
                    executionGeneration,
                },
            });
        } else {
            // A reopened legacy corpus has no discovery workflow waiting for an event.
            await ctx.runMutation(
                internal.evidenceExecution.completeSourceReview,
                {
                    runId: run._id,
                    decisionId: checkpointDecisionId,
                    corpusRevisionId: revision._id,
                    expectedExecutionGeneration: executionGeneration,
                },
            );
        }
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
        if (!canStartNewCorpusRevision(run, revision.status)) {
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
        const currentRun = await ctx.db.get(run._id);
        if (!newRevision || !currentRun) {
            throw new Error("New corpus revision was not created");
        }
        const proposal = await createSourceSelectionProposal(ctx, {
            run: currentRun,
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
