import { getAuthUserId } from "@convex-dev/auth/server";
import type { WorkflowId } from "@convex-dev/workflow";
import {
    paginationOptsValidator,
    paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
    env,
    internalMutation,
    internalQuery,
    mutation,
    query,
} from "./_generated/server";
import { mergeRunCompanyMetadata } from "./domain/companyMetadata";
import {
    ASSESSMENT_DIMENSION_KEYS,
    buildResearchPlanQuestions,
} from "./domain/researchPlan";
import { classifyRunPurpose, runPurposeValidator } from "./domain/runPurpose";
import { withdrawableRun } from "./domain/runWithdrawal";
import { upsertSourceReviewItem } from "./domain/sourceReviewProjection";
import { sourceDossierCandidateLimit } from "./resourceLimits";
import { BROWSER_TEST_SLOT } from "./runWorkspace";
import schema from "./schema";
import { createSourceSelectionProposal } from "./sourceSelectionProposals";
import { workflow } from "./workflow";

const RECENT_EVENT_LIMIT = 50;
const runFields = schema.tables.researchRuns.validator.fields;
const checkpointFields = schema.tables.checkpointDecisions.validator.fields;
const providerCallFields = schema.tables.providerCalls.validator.fields;

const runOverviewValidator = v.object({
    runId: v.id("researchRuns"),
    purpose: runPurposeValidator,
    ownerVisitorId: runFields.ownerVisitorId,
    reservationStatus: runFields.reservationStatus,
    withdrawnAt: runFields.withdrawnAt,
    canWithdraw: v.boolean(),
    lifecycleState: runFields.lifecycleState,
    executionStatus: runFields.executionStatus,
    pauseReason: runFields.pauseReason,
    updatedAt: runFields.updatedAt,
    preparation: v.optional(
        v.object({
            preparationId: v.id("sourceSelectionProposalRebuilds"),
            status: schema.tables.sourceSelectionProposalRebuilds.validator
                .fields.status,
            stopCode:
                schema.tables.sourceSelectionProposalRebuilds.validator.fields
                    .stopCode,
            configurationCheck:
                schema.tables.sourceSelectionProposalRebuilds.validator.fields
                    .configurationCheck,
            deadlineAt: v.optional(v.number()),
            failures: v.array(
                v.object({
                    sourceId: v.id("sources"),
                    reasonCode: v.string(),
                }),
            ),
        }),
    ),
});

async function requireAdmin(ctx: QueryCtx | MutationCtx) {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) {
        throw new Error("Not authenticated");
    }
    const visitor = await ctx.db
        .query("visitors")
        .withIndex("by_auth_user_id", (builder) =>
            builder.eq("authUserId", authUserId),
        )
        .unique();
    if (visitor?.status !== "active" || visitor.role !== "admin") {
        throw new Error("Unauthorized");
    }
    return visitor;
}

export const get = query({
    args: {},
    returns: v.object({
        paidWork: v.object({
            enabled: v.boolean(),
            reason: v.optional(v.string()),
            updatedAt: v.optional(v.number()),
        }),
        checkpoints: v.array(
            v.object({
                runId: checkpointFields.runId,
                checkpoint: checkpointFields.checkpoint,
                decision: checkpointFields.decision,
                occurredAt: checkpointFields.occurredAt,
            }),
        ),
        providerCalls: v.array(
            v.object({
                runId: providerCallFields.runId,
                service: providerCallFields.service,
                operation: providerCallFields.operation,
                status: providerCallFields.status,
                usage: providerCallFields.usage,
                reportedCost: providerCallFields.reportedCost,
                errorCode: providerCallFields.errorCode,
                validationReason: v.optional(v.string()),
                preparationId: providerCallFields.preparationId,
                sourceId: providerCallFields.sourceId,
                attempt: providerCallFields.attempt,
                dispatchOutcome: providerCallFields.dispatchOutcome,
                httpStatus: providerCallFields.httpStatus,
                retryAfterAt: providerCallFields.retryAfterAt,
                recoveryOfProviderCallId:
                    providerCallFields.recoveryOfProviderCallId,
                createdAt: providerCallFields.createdAt,
            }),
        ),
        reservations: v.array(
            v.object({
                visitorId: v.id("visitors"),
                role: schema.tables.visitors.validator.fields.role,
                remaining: v.number(),
                slotKey: v.string(),
                reservedForTesting: v.boolean(),
            }),
        ),
    }),
    handler: async (ctx) => {
        await requireAdmin(ctx);
        const [checkpoints, providerCalls, visitors, paidWork] =
            await Promise.all([
                ctx.db
                    .query("checkpointDecisions")
                    .withIndex("by_occurred_at")
                    .order("desc")
                    .take(RECENT_EVENT_LIMIT),
                ctx.db
                    .query("providerCalls")
                    .withIndex("by_created_at")
                    .order("desc")
                    .take(RECENT_EVENT_LIMIT),
                ctx.db.query("visitors").collect(),
                ctx.db
                    .query("paidWorkControls")
                    .withIndex("by_key", (builder) =>
                        builder.eq("key", "global"),
                    )
                    .unique(),
            ]);
        return {
            paidWork: {
                enabled: paidWork?.enabled ?? true,
                reason: paidWork?.reason,
                updatedAt: paidWork?.updatedAt,
            },
            checkpoints: checkpoints.map((checkpoint) => ({
                runId: checkpoint.runId,
                checkpoint: checkpoint.checkpoint,
                decision: checkpoint.decision,
                occurredAt: checkpoint.occurredAt,
            })),
            providerCalls: providerCalls.map((call) => ({
                runId: call.runId,
                service: call.service,
                operation: call.operation,
                status: call.status,
                usage: call.usage,
                reportedCost: call.reportedCost,
                errorCode: call.errorCode,
                validationReason: call.diagnostic?.reason,
                preparationId: call.preparationId,
                sourceId: call.sourceId,
                attempt: call.attempt,
                dispatchOutcome: call.dispatchOutcome,
                httpStatus: call.httpStatus,
                retryAfterAt: call.retryAfterAt,
                recoveryOfProviderCallId: call.recoveryOfProviderCallId,
                createdAt: call.createdAt,
            })),
            reservations: await Promise.all(
                visitors.map(async (visitor) => {
                    const invitation = await ctx.db.get(visitor.invitationId);
                    const reservedForTesting =
                        invitation?.slotKey === BROWSER_TEST_SLOT;
                    return {
                        visitorId: visitor._id,
                        role: visitor.role,
                        slotKey: invitation?.slotKey ?? "Unassigned",
                        reservedForTesting,
                        remaining: reservedForTesting
                            ? 0
                            : Math.max(0, 3 - visitor.analysesReserved),
                    };
                }),
            ),
        };
    },
});

export const setPaidWorkEnabled = mutation({
    args: { enabled: v.boolean(), reason: v.string() },
    returns: v.object({ enabled: v.boolean() }),
    handler: async (ctx, args) => {
        const admin = await requireAdmin(ctx);
        const reason = args.reason.trim();
        if (reason.length < 12 || reason.length > 500) {
            throw new Error(
                "Paid work changes require a reason of 12 to 500 characters",
            );
        }
        const existing = await ctx.db
            .query("paidWorkControls")
            .withIndex("by_key", (builder) => builder.eq("key", "global"))
            .unique();
        const now = Date.now();
        if (existing) {
            await ctx.db.patch(existing._id, {
                enabled: args.enabled,
                updatedByVisitorId: admin._id,
                reason,
                updatedAt: now,
            });
        } else {
            await ctx.db.insert("paidWorkControls", {
                key: "global",
                enabled: args.enabled,
                updatedByVisitorId: admin._id,
                reason,
                updatedAt: now,
            });
        }
        await ctx.db.insert("auditEvents", {
            actor: { type: "visitor", visitorId: admin._id },
            action: "paid_work_toggled",
            targetType: "paid_work_control",
            targetId: "global",
            reason,
            occurredAt: now,
        });
        return { enabled: args.enabled };
    },
});

const sourceReviewBackfillResultValidator = v.object({
    revisionId: v.id("corpusRevisions"),
    sourceTotal: v.number(),
    projectionTotal: v.number(),
});

export const backfillSourceReviewProjection = mutation({
    args: { paginationOpts: paginationOptsValidator },
    returns: paginationResultValidator(sourceReviewBackfillResultValidator),
    handler: async (ctx, args) => {
        await requireAdmin(ctx);
        if (
            args.paginationOpts.numItems < 1 ||
            args.paginationOpts.numItems > 10
        ) {
            throw new Error("Backfill page size must be between 1 and 10");
        }
        const revisions = await ctx.db
            .query("corpusRevisions")
            .order("asc")
            .paginate(args.paginationOpts);
        const page = [];

        for (const revision of revisions.page) {
            const run = await ctx.db.get(revision.runId);
            const limit = sourceDossierCandidateLimit(run?.sourcePreparationId);
            const sources = await ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (builder) =>
                    builder.eq("runId", revision.runId),
                )
                .take(limit + 1);
            if (sources.length > limit) {
                throw new Error(
                    `Corpus revision ${revision._id} exceeds the source candidate limit`,
                );
            }
            for (const source of sources) {
                const latestDecision = await ctx.db
                    .query("sourceDecisions")
                    .withIndex(
                        "by_revision_source_and_occurred_at",
                        (builder) =>
                            builder
                                .eq("corpusRevisionId", revision._id)
                                .eq("sourceId", source._id),
                    )
                    .order("desc")
                    .first();
                if (!latestDecision) {
                    throw new Error(
                        `Corpus revision ${revision._id} has a source without a decision`,
                    );
                }
                await upsertSourceReviewItem(ctx, {
                    runId: revision.runId,
                    corpusRevisionId: revision._id,
                    sourceId: source._id,
                    decision: latestDecision.decision,
                    sourceCreatedAt: source.createdAt,
                    latestDecisionId: latestDecision._id,
                    decisionOccurredAt: latestDecision.occurredAt,
                    reason: latestDecision.reason,
                });
            }
            const projection = await ctx.db
                .query("sourceReviewItems")
                .withIndex("by_revision_and_queue", (builder) =>
                    builder.eq("corpusRevisionId", revision._id),
                )
                .take(limit + 1);
            if (projection.length !== sources.length) {
                throw new Error(
                    `Corpus revision ${revision._id} projection total does not match its sources`,
                );
            }
            page.push({
                revisionId: revision._id,
                sourceTotal: sources.length,
                projectionTotal: projection.length,
            });
        }
        return { ...revisions, page };
    },
});

const sourceSelectionProposalBackfillResultValidator = v.object({
    revisionId: v.id("corpusRevisions"),
    proposalId: v.union(v.id("sourceSelectionProposals"), v.null()),
    outcome: v.union(
        v.literal("created"),
        v.literal("unchanged"),
        v.literal("skipped"),
    ),
});

export const backfillSourceSelectionProposals = mutation({
    args: { paginationOpts: paginationOptsValidator },
    returns: paginationResultValidator(
        sourceSelectionProposalBackfillResultValidator,
    ),
    handler: async (ctx, args) => {
        await requireAdmin(ctx);
        if (
            args.paginationOpts.numItems < 1 ||
            args.paginationOpts.numItems > 10
        ) {
            throw new Error("Backfill page size must be between 1 and 10");
        }
        const revisions = await ctx.db
            .query("corpusRevisions")
            .order("asc")
            .paginate(args.paginationOpts);
        const page = [];
        for (const revision of revisions.page) {
            const run = await ctx.db.get(revision.runId);
            if (
                revision.status !== "draft" ||
                !run ||
                run.activeCorpusRevisionId !== revision._id ||
                run.lifecycleState !== "awaiting_source_review"
            ) {
                page.push({
                    revisionId: revision._id,
                    proposalId: null,
                    outcome: "skipped" as const,
                });
                continue;
            }
            if (revision.sourceSelectionProposalId) {
                const existing = await ctx.db.get(
                    revision.sourceSelectionProposalId,
                );
                if (!existing) {
                    throw new Error(
                        "Source selection proposal pointer is invalid",
                    );
                }
                page.push({
                    revisionId: revision._id,
                    proposalId: existing._id,
                    outcome: "unchanged" as const,
                });
                continue;
            }
            const proposal = await createSourceSelectionProposal(ctx, {
                run,
                revision,
            });
            page.push({
                revisionId: revision._id,
                proposalId: proposal.proposalId,
                outcome: "created" as const,
            });
        }
        return { ...revisions, page };
    },
});

const phase5AuthorityBackfillResultValidator = v.object({
    revisionId: v.id("corpusRevisions"),
    questionsBackfilled: v.number(),
    questionVersionReviewRequired: v.boolean(),
    handleCleared: v.boolean(),
    handleReviewRequired: v.boolean(),
});

export const backfillPhase5Authority = mutation({
    args: { paginationOpts: paginationOptsValidator },
    returns: paginationResultValidator(phase5AuthorityBackfillResultValidator),
    handler: async (ctx, args) => {
        await requireAdmin(ctx);
        if (
            args.paginationOpts.numItems < 1 ||
            args.paginationOpts.numItems > 10
        ) {
            throw new Error("Backfill page size must be between 1 and 10");
        }
        const revisions = await ctx.db
            .query("corpusRevisions")
            .order("asc")
            .paginate(args.paginationOpts);
        const page = [];

        for (const revision of revisions.page) {
            const run = await ctx.db.get(revision.runId);
            let questionsBackfilled = 0;
            let questionVersionReviewRequired = false;
            let handleCleared = false;
            let handleReviewRequired = false;

            if (
                run &&
                run.activeCorpusRevisionId === revision._id &&
                run.companyId
            ) {
                const plan = await ctx.db
                    .query("researchPlans")
                    .withIndex("by_run_and_version", (builder) =>
                        builder.eq("runId", run._id),
                    )
                    .order("desc")
                    .first();
                if (plan) {
                    const existingQuestions = await ctx.db
                        .query("researchPlanQuestions")
                        .withIndex("by_plan_and_key", (builder) =>
                            builder.eq("researchPlanId", plan._id),
                        )
                        .take(ASSESSMENT_DIMENSION_KEYS.length + 2);
                    questionVersionReviewRequired = existingQuestions.some(
                        (question) => question.planVersion !== plan.version,
                    );
                    if (existingQuestions.length === 0) {
                        const company = mergeRunCompanyMetadata(
                            run.companySnapshot,
                            await ctx.db.get(run.companyId),
                        );
                        if (company) {
                            const questionInputs = buildResearchPlanQuestions({
                                company,
                                researchAngle: plan.researchAngle,
                            });
                            const now = Date.now();
                            for (const questionInput of questionInputs) {
                                await ctx.db.insert("researchPlanQuestions", {
                                    runId: run._id,
                                    researchPlanId: plan._id,
                                    planVersion: plan.version,
                                    questionKey: questionInput.questionKey,
                                    prompt: questionInput.prompt,
                                    dimensionKeys: questionInput.dimensionKeys,
                                    createdAt: now,
                                });
                            }
                            questionsBackfilled = questionInputs.length;
                        }
                    }
                }
            }

            if (
                run &&
                run.lifecycleState === "corpus_approved" &&
                run.executionStatus === "idle" &&
                run.workflowId
            ) {
                try {
                    const status = await workflow.status(
                        ctx,
                        run.workflowId as WorkflowId,
                    );
                    if (
                        status.type === "canceled" ||
                        status.type === "failed" ||
                        status.type === "completed"
                    ) {
                        await ctx.db.patch(run._id, {
                            workflowId: undefined,
                            updatedAt: Date.now(),
                        });
                        handleCleared = true;
                    } else {
                        handleReviewRequired = true;
                    }
                } catch {
                    handleReviewRequired = true;
                }
            }

            page.push({
                revisionId: revision._id,
                questionsBackfilled,
                questionVersionReviewRequired,
                handleCleared,
                handleReviewRequired,
            });
        }
        return { ...revisions, page };
    },
});

function assertLocalPurposeMigration() {
    if (
        !["127.0.0.1", "localhost"].includes(
            new URL(env.CONVEX_CLOUD_URL).hostname,
        )
    )
        throw new Error("Run purpose migration requires the local deployment");
}

/** Read-only preview; ambiguous legacy markers never silently acquire technical authority. */
export const previewRunPurposes = internalQuery({
    args: { paginationOpts: paginationOptsValidator },
    returns: paginationResultValidator(
        v.object({
            runId: v.id("researchRuns"),
            oldPurpose: v.optional(runPurposeValidator),
            purpose: runPurposeValidator,
            reason: v.string(),
            requiresReview: v.boolean(),
        }),
    ),
    handler: async (ctx, args) => {
        assertLocalPurposeMigration();
        const page = await ctx.db
            .query("researchRuns")
            .paginate(args.paginationOpts);
        return {
            ...page,
            page: page.page.map((run) => {
                const classified = classifyRunPurpose(run);
                return {
                    runId: run._id,
                    oldPurpose: run.purpose,
                    purpose: classified.purpose,
                    reason: classified.reason,
                    requiresReview: classified.requiresReview ?? false,
                };
            }),
        };
    },
});

/** Assigns metadata only, preserving business timestamps, ownership, evidence and accounting. */
export const migrateRunPurposes = internalMutation({
    args: { runIds: v.array(v.id("researchRuns")) },
    returns: v.object({ changed: v.number() }),
    handler: async (ctx, args) => {
        assertLocalPurposeMigration();
        if (
            args.runIds.length > 50 ||
            new Set(args.runIds).size !== args.runIds.length
        )
            throw new Error("Supply at most fifty distinct runs");
        let changed = 0;
        for (const id of args.runIds) {
            const run = await ctx.db.get(id);
            if (!run) throw new Error("Research run missing");
            if (run.purpose) continue;
            const classified = classifyRunPurpose(run);
            if (classified.requiresReview)
                throw new Error(`Run purpose requires review: ${id}`);
            await ctx.db.patch(id, { purpose: classified.purpose });
            await ctx.db.insert("auditEvents", {
                actor: { type: "system" },
                action: "run_purpose_classified",
                targetType: "research_run",
                targetId: id,
                reason: `run-purpose-v1: ${classified.purpose}; ${classified.reason}`,
                occurredAt: Date.now(),
            });
            changed++;
        }
        return { changed };
    },
});

async function projectOperationsRun(
    ctx: QueryCtx,
    run: import("./_generated/dataModel").Doc<"researchRuns">,
) {
    const preparation = run.sourcePreparationId
        ? await ctx.db.get(run.sourcePreparationId)
        : null;
    return {
        runId: run._id,
        purpose: run.purpose,
        ownerVisitorId: run.ownerVisitorId,
        reservationStatus: run.reservationStatus,
        withdrawnAt: run.withdrawnAt,
        canWithdraw: withdrawableRun(run),
        lifecycleState: run.lifecycleState,
        executionStatus: run.executionStatus,
        pauseReason: run.pauseReason,
        updatedAt: run.updatedAt,
        preparation:
            preparation?.kind === "preparation"
                ? {
                      preparationId: preparation._id,
                      status: preparation.status,
                      stopCode: preparation.stopCode,
                      configurationCheck: preparation.configurationCheck,
                      deadlineAt: preparation.deadlineAt,
                      failures: (preparation.sourceOutcomes ?? []).flatMap(
                          (outcome) =>
                              outcome.result.status === "unavailable"
                                  ? [
                                        {
                                            sourceId: outcome.sourceId,
                                            reasonCode:
                                                outcome.result.reasonCode,
                                        },
                                    ]
                                  : [],
                      ),
                  }
                : undefined,
    };
}

export const listRunsPage = query({
    args: {
        purpose: runPurposeValidator,
        paginationOpts: paginationOptsValidator,
    },
    returns: paginationResultValidator(runOverviewValidator),
    handler: async (ctx, args) => {
        await requireAdmin(ctx);
        const result = await ctx.db
            .query("researchRuns")
            .withIndex("by_purpose_and_updated_at", (q) =>
                q.eq("purpose", args.purpose),
            )
            .order("desc")
            .paginate(args.paginationOpts);
        return {
            ...result,
            page: await Promise.all(
                result.page.map((run) => projectOperationsRun(ctx, run)),
            ),
        };
    },
});

export const listRestorableRunsPage = query({
    args: { paginationOpts: paginationOptsValidator },
    returns: paginationResultValidator(
        v.object({
            runId: v.id("researchRuns"),
            ownerVisitorId: runFields.ownerVisitorId,
            createdAt: v.number(),
        }),
    ),
    handler: async (ctx, args) => {
        await requireAdmin(ctx);
        const result = await ctx.db
            .query("researchRuns")
            .withIndex(
                "by_purpose_lifecycle_execution_reservation_created_at",
                (q) =>
                    q
                        .eq("purpose", "research")
                        .eq("lifecycleState", "draft")
                        .eq("executionStatus", "idle")
                        .eq("reservationStatus", "consumed"),
            )
            .order("desc")
            .paginate(args.paginationOpts);
        return {
            ...result,
            page: result.page.map((run) => ({
                runId: run._id,
                ownerVisitorId: run.ownerVisitorId,
                createdAt: run.createdAt,
            })),
        };
    },
});

export const inspectRun = query({
    args: { runId: v.id("researchRuns") },
    returns: v.object({
        run: schema.doc("researchRuns"),
        company: v.union(schema.doc("companies"), v.null()),
    }),
    handler: async (ctx, args) => {
        await requireAdmin(ctx);
        const run = await ctx.db.get(args.runId);
        if (!run) throw new Error("Run not found");
        return {
            run,
            company: run.companyId ? await ctx.db.get(run.companyId) : null,
        };
    },
});

export const listRunProviderCallsPage = query({
    args: {
        runId: v.id("researchRuns"),
        paginationOpts: paginationOptsValidator,
    },
    returns: paginationResultValidator(schema.doc("providerCalls")),
    handler: async (ctx, args) => {
        await requireAdmin(ctx);
        return ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", args.runId))
            .order("desc")
            .paginate(args.paginationOpts);
    },
});
