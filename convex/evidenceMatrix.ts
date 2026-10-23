import { getAuthUserId } from "@convex-dev/auth/server";
import {
    paginationOptsValidator,
    paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import {
    claimClassificationValidator,
    evidenceRelationValidator,
} from "./domain/claims";
import { assessmentDimensionKeyValidator } from "./domain/researchPlan";
import { sourceLocatorValidator } from "./domain/sourcePassages";
import {
    executionStatusValidator,
    researchRunLifecycleValidator,
} from "./domain/validators";
import {
    MAX_CLAIMS_PER_RUN,
    MAX_DIMENSION_LINKS_PER_CLAIM,
    MAX_EVIDENCE_PER_CLAIM,
    sourceDossierCandidateLimit,
} from "./resourceLimits";

const MAX_RESEARCH_PLAN_QUESTIONS = 11;
const MAX_EXTRACTION_TASK_SCAN = 16;
const MAX_POLICY_EVAL_SCAN = 16;

const pauseReasonValidator = v.union(
    v.literal("evidence_sufficiency_review"),
    v.literal("source_review"),
    v.literal("assessment_review"),
    v.literal("claim_generation_unavailable"),
);

const extractionModeValidator = v.union(
    v.literal("showcase"),
    v.literal("live"),
    v.literal("unavailable"),
    v.literal("not_started"),
);

const policyResultValidator = v.union(
    v.literal("pass"),
    v.literal("needs_review"),
    v.literal("blocked"),
);

const processingStateValidator = v.union(
    v.literal("complete"),
    v.literal("partial"),
    v.literal("failed"),
    v.literal("in_progress"),
);

const claimListFilterValidator = v.object({
    classification: v.optional(claimClassificationValidator),
    policyResult: v.optional(policyResultValidator),
    dimensionKey: v.optional(assessmentDimensionKeyValidator),
    hasCounterEvidence: v.optional(v.boolean()),
    processing: v.optional(processingStateValidator),
});

const questionCoverageValidator = v.object({
    total: v.number(),
    covered: v.number(),
    buckets: v.array(
        v.object({
            questionId: v.id("researchPlanQuestions"),
            claimCount: v.number(),
        }),
    ),
});

const frozenSourceBucketsValidator = v.object({
    accepted: v.number(),
    processed: v.number(),
    partial: v.number(),
    failed: v.number(),
});

const claimListItemValidator = v.object({
    claimId: v.id("claims"),
    statement: v.string(),
    canonicalText: v.string(),
    classification: claimClassificationValidator,
    researchPlanQuestionId: v.optional(v.id("researchPlanQuestions")),
    questionKey: v.optional(v.string()),
    policy: v.optional(policyResultValidator),
    dimensions: v.array(v.string()),
    hasCounterEvidence: v.boolean(),
    processing: processingStateValidator,
});

const citedSourceVersionValidator = v.object({
    sourceVersionId: v.id("sourceVersions"),
    contentHash: v.string(),
    mediaType: v.string(),
    byteCount: v.number(),
    retrievalVersion: v.string(),
});

const citedSourceValidator = v.object({
    sourceId: v.id("sources"),
    canonicalUrl: v.string(),
    title: v.string(),
    origin: v.union(
        v.literal("sec"),
        v.literal("exa"),
        v.literal("analyst_url"),
    ),
    category: v.string(),
});

const acceptedDecisionValidator = v.object({
    acceptedDecisionId: v.id("sourceDecisions"),
    occurredAt: v.number(),
});

const citedEvidenceValidator = v.object({
    relation: evidenceRelationValidator,
    sourcePassageId: v.id("sourcePassages"),
    passageKey: v.optional(v.string()),
    exactQuotation: v.string(),
    locator: sourceLocatorValidator,
    contextBefore: v.optional(v.string()),
    contextAfter: v.optional(v.string()),
    order: v.number(),
    sourceVersion: citedSourceVersionValidator,
    source: citedSourceValidator,
    accepted: acceptedDecisionValidator,
});

const claimDetailValidator = v.object({
    claim: v.object({
        claimId: v.id("claims"),
        statement: v.string(),
        canonicalText: v.string(),
        classification: claimClassificationValidator,
        researchPlanQuestionId: v.optional(v.id("researchPlanQuestions")),
        questionKey: v.optional(v.string()),
        proposingTaskId: v.id("aiTaskResults"),
    }),
    policy: v.optional(
        v.object({
            policyVersion: v.string(),
            result: policyResultValidator,
            reasonCodes: v.array(v.string()),
        }),
    ),
    dimensions: v.array(
        v.object({
            dimensionKey: assessmentDimensionKeyValidator,
            origin: v.union(v.literal("generated"), v.literal("analyst")),
            rationale: v.optional(v.string()),
        }),
    ),
    evidence: v.array(citedEvidenceValidator),
});

type ClaimListItem = {
    claimId: Id<"claims">;
    statement: string;
    canonicalText: string;
    classification: "Fact" | "Inference" | "Hypothesis" | "Unknown";
    researchPlanQuestionId?: Id<"researchPlanQuestions">;
    questionKey?: string;
    policy?: "pass" | "needs_review" | "blocked";
    dimensions: Array<string>;
    hasCounterEvidence: boolean;
    processing: "complete" | "partial" | "failed" | "in_progress";
};

type ResolvedEvidence = {
    passage: Doc<"sourcePassages">;
    sourceVersion: Doc<"sourceVersions">;
    source: Doc<"sources">;
    accepted: Doc<"sourceDecisions">;
    relation: "supporting" | "counter" | "context";
    processing: "complete" | "partial" | "failed" | "in_progress";
};

/**
 * Returns the active analyst visitor for the authenticated caller.
 * Throws when unauthenticated or when no active visitor exists.
 */
async function requireVisitor(ctx: QueryCtx): Promise<Doc<"visitors">> {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) {
        throw new Error("Not authenticated");
    }
    const visitor = await ctx.db
        .query("visitors")
        .withIndex("by_auth_user_id", (q) => q.eq("authUserId", authUserId))
        .unique();
    if (visitor?.status !== "active") {
        throw new Error("Unauthorized");
    }
    return visitor;
}

/** Returns the run owned by the active visitor, else throws. */
async function getOwnedRun(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
): Promise<Doc<"researchRuns">> {
    const visitor = await requireVisitor(ctx);
    const run = await ctx.db.get(runId);
    if (!run) {
        throw new Error("Research run not found");
    }
    if (run.ownerVisitorId !== visitor._id) {
        throw new Error("Unauthorized");
    }
    return run;
}

/** Loads research plan questions of the latest plan, bounded by the limit. */
async function loadCurrentPlanQuestions(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
): Promise<Doc<"researchPlanQuestions">[]> {
    const plan = await ctx.db
        .query("researchPlans")
        .withIndex("by_run_and_version", (q) => q.eq("runId", runId))
        .order("desc")
        .first();
    if (!plan) {
        return [];
    }
    const questions = await ctx.db
        .query("researchPlanQuestions")
        .withIndex("by_plan_and_key", (q) => q.eq("researchPlanId", plan._id))
        .take(MAX_RESEARCH_PLAN_QUESTIONS + 1);
    if (questions.length > MAX_RESEARCH_PLAN_QUESTIONS) {
        throw new Error("Research plan question limit exceeded");
    }
    return questions;
}

/**
 * Reads a claim's cited evidence after the current-status and accepted-head
 * fence. Returns valid=false when any cited passage no longer resolves to the
 * current corpus, current source version, or accepted decision head, so
 * rejected or superseded sources never leak into the matrix.
 */
async function resolveClaimEvidence(
    ctx: QueryCtx,
    args: {
        runId: Id<"researchRuns">;
        corpusId: Id<"corpusRevisions">;
        claimId: Id<"claims">;
    },
): Promise<{
    valid: boolean;
    evidence: ResolvedEvidence[];
    processing: "complete" | "partial" | "failed" | "in_progress" | null;
    hasCounterEvidence: boolean;
}> {
    const run = await ctx.db.get(args.runId);
    const corpus = await ctx.db.get(args.corpusId);
    if (
        !run ||
        !corpus ||
        corpus.runId !== run._id ||
        corpus.status !== "approved" ||
        run.activeCorpusRevisionId !== corpus._id
    ) {
        return {
            valid: false,
            evidence: [],
            hasCounterEvidence: false,
            processing: null,
        };
    }

    const rows = await ctx.db
        .query("claimEvidence")
        .withIndex("by_claim", (q) => q.eq("claimId", args.claimId))
        .take(MAX_EVIDENCE_PER_CLAIM + 1);
    if (rows.length > MAX_EVIDENCE_PER_CLAIM) {
        throw new Error("Claim evidence limit exceeded");
    }

    const evidence: ResolvedEvidence[] = [];
    let valid = true;
    let hasFailed = false;
    let hasInProgress = false;
    let hasPartial = false;

    for (const row of rows) {
        const passage = await ctx.db.get(row.sourcePassageId);
        if (!passage) {
            valid = false;
            continue;
        }
        const sourceVersion = await ctx.db.get(passage.sourceVersionId);
        if (
            !sourceVersion ||
            sourceVersion.runId !== run._id ||
            sourceVersion.corpusRevisionId !== corpus._id
        ) {
            valid = false;
            continue;
        }
        const source = await ctx.db.get(sourceVersion.sourceId);
        if (!source || source.runId !== run._id) {
            valid = false;
            continue;
        }
        const reviewItem = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_source", (q) =>
                q.eq("corpusRevisionId", corpus._id).eq("sourceId", source._id),
            )
            .unique();
        if (
            !reviewItem ||
            reviewItem.runId !== run._id ||
            reviewItem.decision !== "accepted" ||
            reviewItem.latestDecisionId !== sourceVersion.acceptedDecisionId
        ) {
            valid = false;
            continue;
        }
        const accepted = await ctx.db.get(reviewItem.latestDecisionId);
        if (
            accepted?.decision !== "accepted" ||
            accepted.runId !== run._id ||
            accepted.corpusRevisionId !== corpus._id ||
            accepted.sourceId !== source._id
        ) {
            valid = false;
            continue;
        }
        const statusDoc = await ctx.db
            .query("evidenceSourceStatuses")
            .withIndex("by_run_corpus_generation_source", (q) =>
                q
                    .eq("runId", run._id)
                    .eq("corpusRevisionId", corpus._id)
                    .eq("executionGeneration", run.executionGeneration)
                    .eq("sourceId", source._id),
            )
            .unique();
        if (
            !statusDoc ||
            statusDoc.sourceVersionId !== sourceVersion._id ||
            statusDoc.acceptedDecisionId !== sourceVersion.acceptedDecisionId
        ) {
            valid = false;
            continue;
        }
        let processing: "complete" | "partial" | "failed" | "in_progress";
        if (statusDoc.status === "succeeded") {
            processing = "complete";
        } else if (statusDoc.status === "partial") {
            processing = "partial";
            hasPartial = true;
        } else if (statusDoc.status === "failed") {
            processing = "failed";
            hasFailed = true;
        } else {
            processing = "in_progress";
            hasInProgress = true;
        }
        evidence.push({
            passage,
            sourceVersion,
            source,
            accepted,
            relation: row.relation,
            processing,
        });
    }

    const visible = valid && evidence.length > 0;
    let processing: "complete" | "partial" | "failed" | "in_progress" | null =
        null;
    if (visible) {
        if (hasFailed) processing = "failed";
        else if (hasInProgress) processing = "in_progress";
        else if (hasPartial) processing = "partial";
        else processing = "complete";
    }

    const hasCounterEvidence = evidence.some(
        (entry) => entry.relation === "counter",
    );
    return { valid: visible, evidence, hasCounterEvidence, processing };
}

/**
 * Counts frozen source statuses for the current generation that still resolve
 * to the accepted decision head of the active corpus. Rejected or superseded
 * sources are excluded.
 */
async function countFrozenSourceBuckets(
    ctx: QueryCtx,
    args: {
        runId: Id<"researchRuns">;
        corpusId: Id<"corpusRevisions">;
    },
): Promise<{
    accepted: number;
    processed: number;
    partial: number;
    failed: number;
}> {
    const run = await ctx.db.get(args.runId);
    const corpus = await ctx.db.get(args.corpusId);
    if (
        !run?.activeCorpusRevisionId ||
        run.activeCorpusRevisionId !== corpus?._id
    ) {
        return { accepted: 0, processed: 0, partial: 0, failed: 0 };
    }
    const rows = await ctx.db
        .query("evidenceSourceStatuses")
        .withIndex("by_run_corpus_generation_source", (q) =>
            q
                .eq("runId", run._id)
                .eq("corpusRevisionId", corpus._id)
                .eq("executionGeneration", run.executionGeneration),
        )
        .take(sourceDossierCandidateLimit(run.sourcePreparationId) + 1);
    if (rows.length > sourceDossierCandidateLimit(run.sourcePreparationId)) {
        throw new Error("Frozen source statuses exceed candidate limit");
    }
    let accepted = 0;
    let processed = 0;
    let partial = 0;
    let failed = 0;
    for (const row of rows) {
        const source = await ctx.db.get(row.sourceId);
        if (!source || source.runId !== run._id) continue;
        const reviewItem = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_source", (q) =>
                q.eq("corpusRevisionId", corpus._id).eq("sourceId", source._id),
            )
            .unique();
        if (
            !reviewItem ||
            reviewItem.runId !== run._id ||
            reviewItem.decision !== "accepted" ||
            reviewItem.latestDecisionId !== row.acceptedDecisionId
        ) {
            continue;
        }
        const decisionDoc = await ctx.db.get(reviewItem.latestDecisionId);
        if (
            decisionDoc?.decision !== "accepted" ||
            decisionDoc.runId !== run._id ||
            decisionDoc.corpusRevisionId !== corpus._id ||
            decisionDoc.sourceId !== source._id
        ) {
            continue;
        }
        accepted++;
        if (row.status === "succeeded") processed++;
        else if (row.status === "partial") partial++;
        else if (row.status === "failed") failed++;
    }
    return { accepted, processed, partial, failed };
}

type ExtractionMode = "showcase" | "live" | "unavailable" | "not_started";

/**
 * Determines the extraction mode for the run. An unavailable pause tuple wins
 * over any persisted task result; otherwise the latest claim-extraction task
 * mode for the corpus is reported, falling back to "not_started".
 */
async function readExtractionMode(
    ctx: QueryCtx,
    args: { runId: Id<"researchRuns">; corpusId: Id<"corpusRevisions"> },
): Promise<ExtractionMode> {
    const run = await ctx.db.get(args.runId);
    if (
        run?.executionStatus === "paused" &&
        run.pauseReason === "claim_generation_unavailable"
    ) {
        return "unavailable";
    }
    const tasks = await ctx.db
        .query("aiTaskResults")
        .withIndex("by_run_and_task_type_and_input_hash", (q) =>
            q
                .eq("runId", args.runId)
                .eq("taskType", "showcase_claim_extraction"),
        )
        .order("desc")
        .take(MAX_EXTRACTION_TASK_SCAN);
    const task = tasks.find((t) => t.corpusRevisionId === args.corpusId);
    if (task) return task.executionMode;
    return "not_started";
}

/** Reads a claim's latest persisted policy evaluation result, if any. */
async function readPolicyResult(
    ctx: QueryCtx,
    claimId: Id<"claims">,
): Promise<
    | {
          policyVersion: string;
          result: "pass" | "needs_review" | "blocked";
          reasonCodes: Array<string>;
      }
    | undefined
> {
    const evals = await ctx.db
        .query("policyEvaluations")
        .withIndex("by_claim", (q) => q.eq("claimId", claimId))
        .order("desc")
        .take(MAX_POLICY_EVAL_SCAN);
    const latest = evals[0];
    if (!latest) return undefined;
    return {
        policyVersion: latest.policyVersion,
        result: latest.result,
        reasonCodes: latest.reasonCodes,
    };
}

export const getSummary = query({
    args: {
        runId: v.id("researchRuns"),
    },
    returns: v.object({
        runId: v.id("researchRuns"),
        corpusRevisionId: v.optional(v.id("corpusRevisions")),
        lifecycleState: researchRunLifecycleValidator,
        executionGeneration: v.number(),
        executionStatus: executionStatusValidator,
        pauseReason: v.optional(pauseReasonValidator),
        questionCoverage: questionCoverageValidator,
        frozenSources: frozenSourceBucketsValidator,
        claimCount: v.number(),
        executionMode: extractionModeValidator,
        isShowcase: v.boolean(),
    }),
    handler: async (ctx, args) => {
        const run = await getOwnedRun(ctx, args.runId);
        const corpusId = run.activeCorpusRevisionId;
        let questionCoverage = {
            total: 0,
            covered: 0,
            buckets: [] as Array<{
                questionId: Id<"researchPlanQuestions">;
                claimCount: number;
            }>,
        };
        let claimCount = 0;
        let frozenSources = {
            accepted: 0,
            processed: 0,
            partial: 0,
            failed: 0,
        };
        let executionMode: ExtractionMode = "not_started";

        if (corpusId) {
            const corpus = await ctx.db.get(corpusId);
            if (
                corpus &&
                corpus.runId === run._id &&
                corpus.status === "approved"
            ) {
                const claims = await ctx.db
                    .query("claims")
                    .withIndex("by_run_and_corpus", (q) =>
                        q
                            .eq("runId", run._id)
                            .eq("corpusRevisionId", corpus._id),
                    )
                    .take(MAX_CLAIMS_PER_RUN + 1);
                if (claims.length > MAX_CLAIMS_PER_RUN) {
                    throw new Error("Claim matrix limit exceeded");
                }
                const questions = await loadCurrentPlanQuestions(ctx, run._id);
                const currentQuestionIds = new Set(questions.map((q) => q._id));
                const coveredMap = new Map<
                    Id<"researchPlanQuestions">,
                    number
                >();
                let validClaimCount = 0;
                for (const claim of claims) {
                    const resolved = await resolveClaimEvidence(ctx, {
                        runId: run._id,
                        corpusId: corpus._id,
                        claimId: claim._id,
                    });
                    if (!resolved.valid) {
                        continue;
                    }
                    validClaimCount++;
                    const qid = claim.researchPlanQuestionId;
                    if (qid && currentQuestionIds.has(qid)) {
                        coveredMap.set(qid, (coveredMap.get(qid) ?? 0) + 1);
                    }
                }
                claimCount = validClaimCount;
                questionCoverage = {
                    total: questions.length,
                    covered: coveredMap.size,
                    buckets: questions
                        .filter((q) => coveredMap.has(q._id))
                        .map((q) => ({
                            questionId: q._id,
                            claimCount: coveredMap.get(q._id) ?? 0,
                        })),
                };
                frozenSources = await countFrozenSourceBuckets(ctx, {
                    runId: run._id,
                    corpusId: corpus._id,
                });
                executionMode = await readExtractionMode(ctx, {
                    runId: run._id,
                    corpusId: corpus._id,
                });
            }
        }

        return {
            runId: run._id,
            corpusRevisionId: corpusId,
            lifecycleState: run.lifecycleState,
            executionGeneration: run.executionGeneration,
            executionStatus: run.executionStatus,
            pauseReason: run.pauseReason,
            questionCoverage,
            frozenSources,
            claimCount,
            executionMode,
            isShowcase: executionMode === "showcase",
        };
    },
});

export const listClaims = query({
    args: {
        runId: v.id("researchRuns"),
        paginationOpts: paginationOptsValidator,
        filters: v.optional(claimListFilterValidator),
    },
    returns: paginationResultValidator(claimListItemValidator),
    handler: async (ctx, args) => {
        const run = await getOwnedRun(ctx, args.runId);
        const corpusId = run.activeCorpusRevisionId;
        if (!corpusId) {
            return { page: [], isDone: true, continueCursor: "" };
        }
        const filters = args.filters ?? {};
        const numItems = Math.max(
            1,
            Math.floor(args.paginationOpts.numItems) || 1,
        );
        // Native Convex pagination pages the raw claim cursor; in-memory
        // projection applies the sparse filters. paginated.isDone and
        // continueCursor stay truthful, so a filtered page that happens to be
        // empty is never reported as terminal while later raw pages may match.
        const paginated = await ctx.db
            .query("claims")
            .withIndex("by_run_and_corpus", (q) =>
                q.eq("runId", run._id).eq("corpusRevisionId", corpusId),
            )
            .order("asc")
            .paginate(args.paginationOpts);

        const matched: ClaimListItem[] = [];
        for (const claim of paginated.page) {
            if (matched.length >= numItems) break;
            const resolved = await resolveClaimEvidence(ctx, {
                runId: run._id,
                corpusId,
                claimId: claim._id,
            });
            if (!resolved.valid) continue;
            if (resolved.processing === null) continue;
            const dimRows = await ctx.db
                .query("claimDimensionLinks")
                .withIndex("by_claim", (q) => q.eq("claimId", claim._id))
                .take(MAX_DIMENSION_LINKS_PER_CLAIM + 1);
            const dimensionKeys = new Set(dimRows.map((d) => d.dimensionKey));
            if (
                filters.dimensionKey &&
                !dimensionKeys.has(filters.dimensionKey)
            ) {
                continue;
            }
            const policy = await readPolicyResult(ctx, claim._id);
            if (
                filters.policyResult &&
                (!policy || policy.result !== filters.policyResult)
            ) {
                continue;
            }
            if (
                filters.classification &&
                claim.classification !== filters.classification
            ) {
                continue;
            }
            if (
                filters.hasCounterEvidence !== undefined &&
                resolved.hasCounterEvidence !== filters.hasCounterEvidence
            ) {
                continue;
            }
            if (
                filters.processing &&
                resolved.processing !== filters.processing
            ) {
                continue;
            }
            matched.push({
                claimId: claim._id,
                statement: claim.statement,
                canonicalText: claim.canonicalText,
                classification: claim.classification,
                researchPlanQuestionId: claim.researchPlanQuestionId,
                questionKey: undefined,
                policy: policy?.result,
                dimensions: [...dimensionKeys],
                hasCounterEvidence: resolved.hasCounterEvidence,
                processing: resolved.processing,
            });
        }

        return { ...paginated, page: matched.slice(0, numItems) };
    },
});

export const getClaimDetail = query({
    args: {
        runId: v.id("researchRuns"),
        claimId: v.id("claims"),
    },
    returns: claimDetailValidator,
    handler: async (ctx, args) => {
        const run = await getOwnedRun(ctx, args.runId);
        const corpusId = run.activeCorpusRevisionId;
        if (!corpusId) {
            throw new Error("Research run has no active corpus");
        }
        const claim = await ctx.db.get(args.claimId);
        if (
            !claim ||
            claim.runId !== run._id ||
            claim.corpusRevisionId !== corpusId
        ) {
            throw new Error("Unauthorized");
        }
        const resolved = await resolveClaimEvidence(ctx, {
            runId: run._id,
            corpusId,
            claimId: claim._id,
        });
        if (!resolved.valid) {
            throw new Error(
                "Claim evidence no longer resolves to the current corpus",
            );
        }
        const dimRows = await ctx.db
            .query("claimDimensionLinks")
            .withIndex("by_claim", (q) => q.eq("claimId", claim._id))
            .take(MAX_DIMENSION_LINKS_PER_CLAIM + 1);
        if (dimRows.length > MAX_DIMENSION_LINKS_PER_CLAIM) {
            throw new Error("Claim dimension link limit exceeded");
        }
        const questions = await loadCurrentPlanQuestions(ctx, run._id);
        const questionById = new Map(
            questions.map((q) => [q._id, q.questionKey]),
        );
        const policy = await readPolicyResult(ctx, claim._id);
        return {
            claim: {
                claimId: claim._id,
                statement: claim.statement,
                canonicalText: claim.canonicalText,
                classification: claim.classification,
                researchPlanQuestionId: claim.researchPlanQuestionId,
                questionKey: claim.researchPlanQuestionId
                    ? questionById.get(claim.researchPlanQuestionId)
                    : undefined,
                proposingTaskId: claim.proposingTaskId,
            },
            policy,
            dimensions: dimRows.map((d) => ({
                dimensionKey: d.dimensionKey,
                origin: d.origin,
                rationale: d.rationale,
            })),
            evidence: resolved.evidence.map((e) => ({
                relation: e.relation,
                sourcePassageId: e.passage._id,
                passageKey: e.passage.passageKey,
                exactQuotation: e.passage.exactQuotation,
                locator: e.passage.locator,
                contextBefore: e.passage.contextBefore,
                contextAfter: e.passage.contextAfter,
                order: e.passage.order,
                sourceVersion: {
                    sourceVersionId: e.sourceVersion._id,
                    contentHash: e.sourceVersion.contentHash,
                    mediaType: e.sourceVersion.mediaType,
                    byteCount: e.sourceVersion.byteCount,
                    retrievalVersion: e.sourceVersion.retrievalVersion,
                },
                source: {
                    sourceId: e.source._id,
                    canonicalUrl: e.source.canonicalUrl,
                    title: e.source.title,
                    origin: e.source.origin,
                    category: e.source.category,
                },
                accepted: {
                    acceptedDecisionId: e.accepted._id,
                    occurredAt: e.accepted.occurredAt,
                },
            })),
        };
    },
});
