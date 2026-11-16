import { hasKnownNonDispatch } from "@convex/execution/journal";
import {
    ADMIN_BACKFILL_PAGE_MAX_ITEMS,
    ADMIN_COUNT_LIMIT,
    ADMIN_JOURNAL_PAGE_MAX_ITEMS,
    MAX_AUDIT_REASON_CHARS,
    MIN_AUDIT_REASON_CHARS,
    ADMIN_RECENT_EVENT_LIMIT as RECENT_EVENT_LIMIT,
} from "@convex/resourcePolicy";
import type { WorkflowId } from "@convex-dev/workflow";
import {
    paginationOptsValidator,
    paginationResultValidator,
} from "convex/server";
import { type Infer, v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import {
    env,
    internalMutation,
    internalQuery,
    mutation,
    query,
} from "./_generated/server";
import { requireAdmin } from "./administrationAuthority";
import { mergeRunCompanyMetadata } from "./domain/companyMetadata";
import {
    ASSESSMENT_DIMENSION_KEYS,
    buildResearchPlanQuestions,
} from "./domain/researchPlan";
import { classifyRunPurpose, runPurposeValidator } from "./domain/runPurpose";
import { withdrawableRun } from "./domain/runWithdrawal";
import { upsertSourceReviewItem } from "./domain/sourceReviewProjection";
import { sourceDossierCandidateLimit } from "./resourceLimits";
import { isBrowserTestSlot } from "./runWorkspace";
import schema from "./schema";
import { createSourceSelectionProposal } from "./sourceSelectionProposals";
import { workflow } from "./workflow";

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
    companyLegalName: v.optional(v.string()),
    lifecycleState: runFields.lifecycleState,
    executionStatus: runFields.executionStatus,
    pauseReason: runFields.pauseReason,
    completionOutcome: runFields.completionOutcome,
    createdAt: runFields.createdAt,
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
                _id: v.id("providerCalls"),
                providerObservation: providerCallFields.providerObservation,
                billing: providerCallFields.billing,
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
                admittedAt: schema.tables.visitors.validator.fields.admittedAt,
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
                _id: call._id,
                providerObservation: call.providerObservation,
                billing: call.billing,
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
                    const reservedForTesting = isBrowserTestSlot(
                        invitation?.slotKey,
                    );
                    return {
                        visitorId: visitor._id,
                        role: visitor.role,
                        slotKey: invitation?.slotKey ?? "Unassigned",
                        reservedForTesting,
                        admittedAt: visitor.admittedAt,
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
        if (
            reason.length < MIN_AUDIT_REASON_CHARS ||
            reason.length > MAX_AUDIT_REASON_CHARS
        ) {
            throw new Error(
                `Paid work changes require a reason of ${MIN_AUDIT_REASON_CHARS} to ${MAX_AUDIT_REASON_CHARS} characters`,
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
            args.paginationOpts.numItems > ADMIN_BACKFILL_PAGE_MAX_ITEMS
        ) {
            throw new Error(
                `Backfill page size must be between 1 and ${ADMIN_BACKFILL_PAGE_MAX_ITEMS}`,
            );
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
            args.paginationOpts.numItems > ADMIN_BACKFILL_PAGE_MAX_ITEMS
        ) {
            throw new Error(
                `Backfill page size must be between 1 and ${ADMIN_BACKFILL_PAGE_MAX_ITEMS}`,
            );
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
            args.paginationOpts.numItems > ADMIN_BACKFILL_PAGE_MAX_ITEMS
        ) {
            throw new Error(
                `Backfill page size must be between 1 and ${ADMIN_BACKFILL_PAGE_MAX_ITEMS}`,
            );
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
    const hostname = tryParseHostname(env.CONVEX_CLOUD_URL);
    if (hostname === null || !["127.0.0.1", "localhost"].includes(hostname))
        throw new Error("Run purpose migration requires the local deployment");
}

/** Treats an unparseable deployment URL as non-local instead of throwing. */
function tryParseHostname(value: string): string | null {
    try {
        return new URL(value).hostname;
    } catch {
        return null;
    }
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
    const companyLegalName =
        run.companySnapshot?.legalName ??
        (run.companyId
            ? (await ctx.db.get(run.companyId))?.legalName
            : undefined);
    return {
        runId: run._id,
        purpose: run.purpose,
        ownerVisitorId: run.ownerVisitorId,
        reservationStatus: run.reservationStatus,
        withdrawnAt: run.withdrawnAt,
        canWithdraw: withdrawableRun(run),
        companyLegalName,
        lifecycleState: run.lifecycleState,
        executionStatus: run.executionStatus,
        pauseReason: run.pauseReason,
        completionOutcome: run.completionOutcome,
        createdAt: run.createdAt,
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

const countResult = v.object({ count: v.number(), capped: v.boolean() });

/** Counts at most `ADMIN_COUNT_LIMIT` rows, so a list total stays a bounded read; `capped` reports more. */
async function boundedCount(rows: { take: (n: number) => Promise<unknown[]> }) {
    const read = await rows.take(ADMIN_COUNT_LIMIT + 1);
    return {
        count: Math.min(read.length, ADMIN_COUNT_LIMIT),
        capped: read.length > ADMIN_COUNT_LIMIT,
    };
}

/** The total behind a paged dossier list of one purpose. */
export const countRuns = query({
    args: { purpose: runPurposeValidator },
    returns: countResult,
    handler: async (ctx, args) => {
        await requireAdmin(ctx);
        return boundedCount(
            ctx.db
                .query("researchRuns")
                .withIndex("by_purpose_and_updated_at", (q) =>
                    q.eq("purpose", args.purpose),
                ),
        );
    },
});

/** The total behind one dossier's paged provider receipts. */
export const countRunProviderCalls = query({
    args: { runId: v.id("researchRuns") },
    returns: countResult,
    handler: async (ctx, args) => {
        await requireAdmin(ctx);
        return boundedCount(
            ctx.db
                .query("providerCalls")
                .withIndex("by_run", (q) => q.eq("runId", args.runId)),
        );
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

/** A selected receipt stays reactive even after it leaves the recent-attempt list. */
export const inspectProviderCall = query({
    args: { providerCallId: v.id("providerCalls") },
    returns: v.union(schema.doc("providerCalls"), v.null()),
    handler: async (ctx, args) => {
        await requireAdmin(ctx);
        return ctx.db.get(args.providerCallId);
    },
});

/** Lists causal events without loading model payloads or requiring running execution. */
export const listRunJournalEventsPage = query({
    args: {
        runId: v.id("researchRuns"),
        paginationOpts: paginationOptsValidator,
    },
    returns: paginationResultValidator(schema.doc("agentExecutionEvents")),
    handler: async (ctx, args) => {
        await requireAdmin(ctx);
        if (!(await ctx.db.get(args.runId))) throw new Error("Run not found");
        if (
            args.paginationOpts.numItems < 1 ||
            args.paginationOpts.numItems > ADMIN_JOURNAL_PAGE_MAX_ITEMS
        )
            throw new Error(
                `Journal page size must be between 1 and ${ADMIN_JOURNAL_PAGE_MAX_ITEMS}`,
            );
        return ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_run", (q) => q.eq("runId", args.runId))
            .order("asc")
            .paginate(args.paginationOpts);
    },
});

const journalInvocationValidator =
    schema.tables.agentInvocations.validator.pick(
        "generationBackend",
        "journalVersion",
        "provenance",
        "status",
        "generation",
        "taskKey",
        "providerCallId",
        "createdAt",
        "completedAt",
        "blockCode",
        "outputJson",
        "receivedOutputJson",
        "receivedWhileAuthorized",
    );

export const inspectJournalEvent = query({
    args: {
        runId: v.id("researchRuns"),
        eventId: v.id("agentExecutionEvents"),
    },
    returns: v.object({
        event: schema.doc("agentExecutionEvents"),
        invocation: v.union(journalInvocationValidator, v.null()),
        request: v.union(schema.doc("agentOperationRequests"), v.null()),
        providerCall: v.union(schema.doc("providerCalls"), v.null()),
    }),
    handler: async (ctx, args) => {
        await requireAdmin(ctx);
        const event = await ctx.db.get(args.eventId);
        if (!event || event.runId !== args.runId)
            throw new Error("Journal entry not found");
        const turn = event.conversationTurnId
            ? await ctx.db.get(event.conversationTurnId)
            : null;
        const message = event.messageId
            ? await ctx.db.get(event.messageId)
            : null;
        if (
            (event.conversationTurnId && turn?.runId !== args.runId) ||
            (event.messageId &&
                (message?.runId !== args.runId ||
                    (event.conversationTurnId &&
                        message?.turnId !== event.conversationTurnId)))
        )
            throw new Error("Journal correlation mismatch");
        const mission = event.missionId
            ? await ctx.db.get(event.missionId)
            : null;
        if (event.missionId && mission?.runId !== args.runId)
            throw new Error("Journal correlation mismatch");
        const invocation = event.invocationId
            ? await ctx.db.get(event.invocationId)
            : null;
        const request = event.requestId
            ? await ctx.db.get(event.requestId)
            : null;
        if (
            event.invocationId &&
            (!invocation ||
                invocation.runId !== args.runId ||
                invocation.missionId !== event.missionId)
        )
            throw new Error("Journal correlation mismatch");
        if (request) {
            const mission = request.missionId
                ? await ctx.db.get(request.missionId)
                : null;
            if (
                (request.missionId ? mission?.runId : request.runId) !==
                    args.runId ||
                request.missionId !== event.missionId
            )
                throw new Error("Journal correlation mismatch");
        } else if (event.requestId)
            throw new Error("Journal correlation mismatch");
        const providerCall = invocation?.providerCallId
            ? await ctx.db.get(invocation.providerCallId)
            : null;
        if (invocation?.providerCallId && !providerCall)
            throw new Error("Journal correlation mismatch");
        if (
            providerCall &&
            (providerCall.runId !== args.runId ||
                (providerCall.invocationId &&
                    providerCall.invocationId !== invocation?._id))
        )
            throw new Error("Journal correlation mismatch");
        return {
            event,
            request,
            providerCall,
            invocation: invocation
                ? {
                      generationBackend: invocation.generationBackend,
                      journalVersion: invocation.journalVersion,
                      provenance: invocation.provenance,
                      status: invocation.status,
                      generation: invocation.generation,
                      taskKey: invocation.taskKey,
                      providerCallId: invocation.providerCallId,
                      createdAt: invocation.createdAt,
                      completedAt: invocation.completedAt,
                      blockCode: invocation.blockCode,
                      outputJson: invocation.outputJson,
                      receivedOutputJson: invocation.receivedOutputJson,
                      receivedWhileAuthorized:
                          invocation.receivedWhileAuthorized,
                  }
                : null,
        };
    },
});

import {
    completeRetainedText,
    retainedTextPage,
} from "@convex/execution/retainedText";

const invocationPayloadArgs = v.object({
    runId: v.id("researchRuns"),
    invocationId: v.id("agentInvocations"),
    part: v.union(v.literal("request"), v.literal("reply")),
});

/** Reads one bounded snapshot; legacy context is never invented into a provider request. */
export const readInvocationJournalPayload = query({
    args: invocationPayloadArgs.fields,
    returns: v.union(
        v.object({
            kind: v.literal("recorded"),
            payload: schema.doc("agentInvocationPayloads"),
        }),
        v.object({ kind: v.literal("unavailable"), code: v.string() }),
    ),
    handler: readJournalPayload,
});

async function readJournalPayload(
    ctx: QueryCtx,
    args: Infer<typeof invocationPayloadArgs>,
) {
    await requireAdmin(ctx);
    const invocation = await ctx.db.get(args.invocationId);
    if (!invocation || invocation.runId !== args.runId)
        throw new Error("Journal entry not found");
    const payload = await ctx.db
        .query("agentInvocationPayloads")
        .withIndex("by_invocation_and_part", (q) =>
            q.eq("invocationId", invocation._id).eq("part", args.part),
        )
        .unique();
    if (!payload)
        return {
            kind: "unavailable" as const,
            code: hasKnownNonDispatch(invocation)
                ? "not_dispatched"
                : invocation.journalVersion
                  ? `${args.part}_not_recorded`
                  : "historical_trace",
        };
    if (payload.runId !== args.runId)
        throw new Error("Journal correlation mismatch");
    return { kind: "recorded" as const, payload };
}

/** Complete publication and administrator correlation are checked before any fragment becomes observable. */
export const listInvocationPayloadFragmentsPage = query({
    args: {
        ...invocationPayloadArgs.fields,
        paginationOpts: paginationOptsValidator,
    },
    returns: paginationResultValidator(
        v.object({ index: v.number(), content: v.string() }),
    ),
    handler: async (ctx, args) => {
        const result = await readJournalPayload(ctx, args);
        if (
            result.kind !== "recorded" ||
            result.payload.state !== "complete" ||
            !result.payload.textId
        )
            throw new Error("Complete fragmented snapshot not found");
        const text = await completeRetainedText(ctx, result.payload.textId);
        if (
            text.key !== `${args.invocationId}:${args.part}` ||
            text.contentHash !== result.payload.contentHash ||
            text.sizeBytes !== result.payload.sizeBytes
        )
            throw new Error("Journal correlation mismatch");
        return retainedTextPage(ctx, text, args.paginationOpts);
    },
});
