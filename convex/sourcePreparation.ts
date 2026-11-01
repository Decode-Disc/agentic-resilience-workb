import { readResearchContext } from "@convex/domain/researchContext";
import {
    SOURCE_COMPARISON_MAX_OUTPUT_BYTES,
    SOURCE_COMPARISON_VERSION,
    type SourceComparisonOutput,
    sourceComparisonOutputSchema,
    sourceFindingNeedsComparison,
} from "@convex/domain/sourceComparison";
import {
    isExecutableQualificationVersion,
    qualificationExecutionVersion,
    qualificationOutputIssue,
} from "@convex/domain/sourceQualification";
import {
    retrievalMetadataValidator,
    SOURCE_RETRIEVAL_RANKING_POLICY,
    SOURCE_RETRIEVAL_VERSION,
} from "@convex/domain/sourceRetrievalPolicy";
import { applyRequestedResearchPause } from "@convex/execution/researchControl";
import {
    MAX_HISTORICAL_SOURCE_CANDIDATES,
    MAX_SUPPLEMENT_SEARCHES,
    SOURCE_PREPARATION_DEADLINE_MS,
    SOURCE_PREPARATION_EXECUTION_PLAN_VERSION,
    sourcePreparationEnabled,
} from "@convex/resourceLimits";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { WorkflowId } from "@convex-dev/workflow";
import { type Infer, v } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
    env,
    internalMutation,
    internalQuery,
    mutation,
} from "./_generated/server";
import { mergeRunCompanyMetadata } from "./domain/companyMetadata";
import {
    claimPausedRunExecution,
    ExecutionSlotUnavailableError,
} from "./domain/executionClaim";
import { readSourceCandidateCapacity } from "./domain/sourceCandidateCapacity";
import {
    comparisonContextForTarget,
    readComparisonPrimaryContext,
    sourceComparisonWork,
} from "./domain/sourceComparisonContext";
import {
    type RecoveryTarget,
    readSupplementalSearchAttempts,
    recoverySearchPlan,
    recoveryTargetValidator,
    supplementalSearchInputHash,
    supplementalSearchOperationKey,
} from "./domain/sourceDiscoveryRecovery";
import {
    assertPreparationComparisonFence,
    assertPreparationCompletionFence,
    assertPreparationExecutionFence,
    MAX_PREPARATION_ATTEMPT_HISTORY,
    nextPreparationAttempt,
    preparationBudgetBlock,
    preparationFailureClass,
    readEligiblePreparationSourceIds,
    readPreparationBudget,
    readPreparationConcurrency,
    readPreparationLimits,
    readPreparationSourceDecision,
    sourcePreparationError,
    sourcePreparationOutcomeValidator,
    sourcePreparationPhaseValidator,
    sourcePreparationStopCodeValidator,
} from "./domain/sourcePreparationAuthority";
import { readPreparationRecovery } from "./domain/sourcePreparationReview";
import {
    qualificationSelectionStrategyValidator,
    sourceQualificationValidator,
} from "./domain/sourceQualification";
import { SOURCE_DOCUMENT_KINDS } from "./domain/sourceSelectionPolicy";
import {
    readComparisonHistory,
    readPinnedSourceQualification,
} from "./domain/sourceUsage";
import { companySnapshotValidator } from "./domain/validators";
import { requireWorkspaceRun } from "./runWorkspace";
import schema from "./schema";
import {
    createSourceSelectionProposal,
    readCurrentSourceSelection,
} from "./sourceSelectionProposals";
import { workflow } from "./workflow";

const sourceComparisonOutputValidator = zodToConvex(
    sourceComparisonOutputSchema,
);

async function scopeSupplementQueries(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
    preparation: Doc<"sourceSelectionProposalRebuilds">,
    queries: NonNullable<
        Doc<"sourceSelectionProposalRebuilds">["supplementQueries"]
    >,
) {
    const { framing, scope } = await readResearchContext(ctx, run);
    return queries.map((query) => ({
        ...query,
        query: [
            query.query,
            framing ? scope : undefined,
            preparation.documentaryNeed,
        ]
            .filter(Boolean)
            .join(" "),
        ...(framing ? { dimensionKeys: [] } : {}),
    }));
}

/** Starts or resumes the review preparation while preserving the main approval workflow. Callers validate ownership and the current draft before entering. */
export async function startReviewPreparation(
    ctx: MutationCtx,
    args: {
        run: Doc<"researchRuns">;
        revision: Doc<"corpusRevisions">;
        proposal: Doc<"sourceSelectionProposals">;
        visitor: Doc<"visitors">;
        requestId: string;
        manualSourceId?: Id<"sources">;
        target?: RecoveryTarget;
        documentaryNeed?: string;
    },
) {
    let { run } = args;
    const { revision, proposal, visitor } = args;
    const invitation = await ctx.db.get(visitor.invitationId);
    if (
        invitation?.status !== "claimed" ||
        invitation.claimedByVisitorId !== visitor._id
    )
        throw new Error("Unauthorized");
    if (!sourcePreparationEnabled())
        throw sourcePreparationError("preparation_disabled");
    if (
        args.documentaryNeed &&
        (!args.target || args.documentaryNeed.trim().length > 2000)
    )
        throw sourcePreparationError("request_invalid");
    const requestId = args.requestId.trim();
    if (!requestId || requestId.length > 128)
        throw new Error("Invalid preparation request");
    const operationKey = `run:${run._id}:source-review-preparation:request:${requestId}`;
    const replay = await ctx.db
        .query("sourceSelectionProposalRebuilds")
        .withIndex("by_operation_key", (q) =>
            q.eq("operationKey", operationKey),
        )
        .unique();
    if (replay) {
        if (
            replay.corpusRevisionId !== revision._id ||
            replay.expectedProposalId !== proposal._id ||
            JSON.stringify(
                replay.entryPoint === "targeted_search"
                    ? (replay.target ?? null)
                    : null,
            ) !== JSON.stringify(args.target ?? null) ||
            replay.documentaryNeed !== args.documentaryNeed
        )
            throw new Error(
                "Preparation request was reused for a different proposal",
            );
        return { preparationId: replay._id, status: replay.status };
    }
    if (
        revision.status !== "draft" ||
        run.activeCorpusRevisionId !== revision._id ||
        revision.sourceSelectionProposalId !== proposal._id
    )
        throw new Error("Source selection proposal changed");
    const modelLimits = readPreparationLimits();
    const maxConcurrentSources = readPreparationConcurrency();
    let previous = run.sourcePreparationId
        ? await ctx.db.get(run.sourcePreparationId)
        : null;
    if (
        previous?.kind === "preparation" &&
        previous.status === "started" &&
        (previous.deadlineAt ?? Infinity) <= Date.now() &&
        previous.executionGeneration === run.executionGeneration &&
        run.lifecycleState === "awaiting_source_review" &&
        run.executionStatus === "running"
    ) {
        if (previous.workflowId)
            await workflow.cancel(ctx, previous.workflowId as WorkflowId);
        await ctx.db.patch(previous._id, {
            status: "blocked",
            stopCode: "execution_expired",
            workflowId: undefined,
            completedAt: Date.now(),
        });
        await ctx.db.patch(run._id, {
            executionStatus: "paused",
            pauseReason: "source_review",
        });
        previous = {
            ...previous,
            status: "blocked",
            stopCode: "execution_expired",
            workflowId: undefined,
        };
        run = {
            ...run,
            executionStatus: "paused",
            pauseReason: "source_review",
        };
    }
    const recovery =
        previous?.kind === "preparation" &&
        !args.target &&
        !args.manualSourceId &&
        previous.status !== "started"
            ? await readPreparationRecovery(ctx.db, {
                  runId: run._id,
                  corpusRevisionId: revision._id,
                  preparation: previous,
                  now: Date.now(),
              })
            : null;
    if (recovery) {
        if (recovery.resumableSourceIds.length === 0 && !recovery.hasSearchWork)
            return {
                preparationId: recovery.scopePreparation._id,
                status: "blocked" as const,
                reason: recovery.blockedReason ?? "complete",
                retryAt: recovery.retryAt,
            };
        previous = recovery.scopePreparation;
    }
    const resumingTargetedReading =
        !args.target &&
        !args.manualSourceId &&
        previous?.kind === "preparation" &&
        !!previous.target &&
        (previous.readingSourceIds?.length ?? 0) > 0;
    if (
        previous?.kind === "preparation" &&
        previous.status === "started" &&
        previous.corpusRevisionId === revision._id &&
        previous.executionGeneration === run.executionGeneration &&
        run.executionStatus === "running"
    ) {
        if (
            args.target &&
            JSON.stringify(args.target) !==
                JSON.stringify(previous.target ?? null)
        )
            throw sourcePreparationError("preparation_busy");
        return { preparationId: previous._id, status: previous.status };
    }
    if (args.target) {
        const current = await readCurrentSourceSelection(ctx, {
            run,
            revision,
        });
        if (
            !current ||
            (args.target.kind === "coverage"
                ? !current.coverageRequirements.some(
                      (item) =>
                          args.target?.kind === "coverage" &&
                          item.role === args.target.role &&
                          !item.covered,
                  )
                : current.failedDiscoveryFamilies.length === 0)
        )
            throw sourcePreparationError("request_invalid");
    }
    const now = Date.now();
    if (args.target) {
        if (previous?.kind !== "preparation")
            throw sourcePreparationError("preparation_unavailable");
        if (
            previous.target &&
            previous.status === "blocked" &&
            previous.leaseExpiresAt > now
        )
            throw sourcePreparationError("search_cooldown");
        const supplement = run.automaticSupplementOperationId
            ? await ctx.db.get(run.automaticSupplementOperationId)
            : null;
        const capacity = await readSourceCandidateCapacity(ctx.db, run._id);
        if (
            capacity.remaining === 0 ||
            (supplement?.supplementClaimedQueryIndexes?.length ?? 0) >=
                MAX_SUPPLEMENT_SEARCHES
        )
            throw sourcePreparationError("search_limit_reached");
    }
    let executionGeneration = run.executionGeneration;
    let slotUnavailable = false;
    try {
        executionGeneration = await claimPausedRunExecution(ctx, {
            run,
            visitor,
            now,
            checkpoint: {
                lifecycleState: "awaiting_source_review",
                pauseReason: "source_review",
            },
        });
    } catch (error) {
        if (
            !(error instanceof ExecutionSlotUnavailableError) ||
            !args.manualSourceId
        )
            throw error;
        slotUnavailable = true;
    }
    const deadlineAt = slotUnavailable
        ? undefined
        : now + SOURCE_PREPARATION_DEADLINE_MS;
    const budget = await readPreparationBudget(
        ctx.db,
        run,
        previous?.kind === "preparation" ? previous : undefined,
    );
    const qualificationVersion = qualificationExecutionVersion(
        previous?.kind === "preparation" &&
            !(
                previous.qualificationVersion === "source-qualification-v2" &&
                (args.manualSourceId || args.target)
            )
            ? previous.qualificationVersion
            : undefined,
    );
    const preparationId = await ctx.db.insert(
        "sourceSelectionProposalRebuilds",
        {
            runId: run._id,
            corpusRevisionId: revision._id,
            expectedProposalId: proposal._id,
            kind: "preparation",
            ...(previous?.kind === "preparation"
                ? {
                      resumesPreparationId: previous._id,
                      initialReadingsCompletedAt:
                          previous.initialReadingsCompletedAt,
                  }
                : {}),
            entryPoint: args.target
                ? "targeted_search"
                : args.manualSourceId || previous?.manualSourceIds
                  ? "manual_addition"
                  : "source_review",
            manualSourceIds: args.target
                ? undefined
                : args.manualSourceId
                  ? [
                        ...(previous?.stopCode ===
                            "execution_slot_unavailable" &&
                        previous.deadlineAt === undefined
                            ? (previous.manualSourceIds ?? [])
                            : []),
                        args.manualSourceId,
                    ]
                  : previous?.manualSourceIds,
            ...(args.target
                ? { target: args.target, readingSourceIds: [] }
                : resumingTargetedReading && previous
                  ? {
                        target: previous.target,
                        readingSourceIds: previous.readingSourceIds ?? [],
                        ...(previous.insertedCount !== undefined
                            ? { insertedCount: previous.insertedCount }
                            : {}),
                    }
                  : {}),
            workflowVersion: run.workflowVersion ?? 1,
            executionGeneration,
            policyVersion: qualificationVersion,
            qualificationVersion,
            executionPlanVersion: SOURCE_PREPARATION_EXECUTION_PLAN_VERSION,
            comparisonVersion: SOURCE_COMPARISON_VERSION,
            ...(env.SOURCE_RETRIEVAL_MODE
                ? {
                      retrievalVersion: SOURCE_RETRIEVAL_VERSION,
                      ...(previous?.kind === "preparation"
                          ? previous.retrievalRankingPolicy
                              ? {
                                    retrievalRankingPolicy:
                                        previous.retrievalRankingPolicy,
                                }
                              : {}
                          : {
                                retrievalRankingPolicy:
                                    SOURCE_RETRIEVAL_RANKING_POLICY,
                            }),
                      retrievalMode: env.SOURCE_RETRIEVAL_MODE,
                  }
                : {}),
            operationKey,
            requestId,
            documentaryNeed: args.documentaryNeed,
            cycle: 1,
            status: slotUnavailable ? "blocked" : "started",
            progress: { phase: "reading", updatedAt: now },
            ...(slotUnavailable
                ? {
                      stopCode: "execution_slot_unavailable" as const,
                      reason: "unavailable" as const,
                  }
                : {}),
            failedDiscoveryFamilies: proposal.failedDiscoveryFamilies ?? [],
            deadlineAt,
            leaseExpiresAt: deadlineAt ?? now,
            asOfTime:
                !args.manualSourceId && previous?.kind === "preparation"
                    ? (previous.asOfTime ?? previous.createdAt)
                    : now,
            modelAttemptCount: 0,
            modelLimits,
            maxConcurrentSources,
            ...(recovery ? { sourceOutcomes: recovery.retainedOutcomes } : {}),
            createdAt: now,
        },
    );
    await ctx.db.patch(run._id, {
        sourcePreparationId: preparationId,
        sourcePreparationBudget: budget,
        sourceQualificationAttemptCount: budget.dispatches,
    });
    if (slotUnavailable) return { preparationId, status: "blocked" as const };
    const workflowId = await workflow.start(
        ctx,
        internal.sourcePreparationWorkflow.run,
        {
            preparationId,
            ...(run.startMode === "framed" ? { controlRunId: run._id } : {}),
        },
        {
            onComplete: internal.sourcePreparationWorkflow.onComplete,
            context: { preparationId },
        },
    );
    await ctx.db.patch(preparationId, { workflowId });
    return { preparationId, status: "started" as const };
}

export const startForReview = mutation({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        expectedProposalId: v.id("sourceSelectionProposals"),
        requestId: v.string(),
        target: v.optional(recoveryTargetValidator),
    },
    returns: v.object({
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        status: schema.tables.sourceSelectionProposalRebuilds.validator.fields
            .status,
        reason: v.optional(v.string()),
        retryAt: v.optional(v.number()),
    }),
    handler: async (ctx, args) => {
        await requireWorkspaceRun(ctx, args.runId);
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) throw new Error("Not authenticated");
        const visitor = await ctx.db
            .query("visitors")
            .withIndex("by_auth_user_id", (q) => q.eq("authUserId", authUserId))
            .unique();
        const invitation = visitor
            ? await ctx.db.get(visitor.invitationId)
            : null;
        const run = await ctx.db.get(args.runId);
        const revision = await ctx.db.get(args.corpusRevisionId);
        const proposal = await ctx.db.get(args.expectedProposalId);
        if (
            visitor?.status !== "active" ||
            invitation?.status !== "claimed" ||
            invitation.claimedByVisitorId !== visitor._id ||
            run?.ownerVisitorId !== visitor._id ||
            revision?.runId !== run._id ||
            proposal?.runId !== run._id ||
            proposal.corpusRevisionId !== revision._id
        )
            throw new Error("Unauthorized");
        return startReviewPreparation(ctx, {
            run,
            revision,
            proposal,
            visitor,
            requestId: args.requestId,
            target: args.target,
        });
    },
});

export const getQualificationInput = internalQuery({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        sourceCaptureId: v.id("sourceCaptures"),
        now: v.number(),
    },
    returns: v.object({
        capture: schema.doc("sourceCaptures"),
        source: schema.doc("sources"),
        company: companySnapshotValidator,
        asOfTime: v.number(),
        researchAngle: v.optional(v.string()),
    }),
    handler: async (ctx, args) => {
        const capture = await ctx.db.get(args.sourceCaptureId);
        if (capture?.status !== "committed" || !capture.storageId)
            throw sourcePreparationError("capture_unavailable");
        const { run, preparation } = await assertPreparationExecutionFence(
            ctx.db,
            {
                preparationId: args.preparationId,
                sourceId: capture.sourceId,
                now: args.now,
            },
        );
        const source = await ctx.db.get(capture.sourceId);
        const company = mergeRunCompanyMetadata(
            run.companySnapshot,
            run.companyId ? await ctx.db.get(run.companyId) : null,
        );
        if (capture.runId !== run._id || !source || !company)
            throw sourcePreparationError("capture_unavailable");
        const { researchAngle } = await readResearchContext(ctx, run);
        return {
            capture,
            source,
            company,
            asOfTime: preparation.asOfTime ?? preparation.createdAt,
            researchAngle,
        };
    },
});

export const getQualification = internalQuery({
    args: {
        runId: v.id("researchRuns"),
        inputHash: v.string(),
    },
    returns: v.union(schema.doc("aiTaskResults"), v.null()),
    handler: async (ctx, args) => {
        const tasks = await ctx.db
            .query("aiTaskResults")
            .withIndex("by_run_and_task_type_and_input_hash", (q) =>
                q
                    .eq("runId", args.runId)
                    .eq("taskType", "source_qualification")
                    .eq("inputHash", args.inputHash),
            )
            .take(10);
        return tasks[0] ?? null;
    },
});

const comparisonCandidateValidator = v.object({
    source: schema.doc("sources"),
    capture: schema.doc("sourceCaptures"),
    context: v.object({
        authorityTier: v.union(
            v.literal("regulator_primary"),
            v.literal("company_primary"),
            v.literal("company_hosted_ir"),
        ),
        companyLinkageBasis: v.string(),
        companyIdentityConfirmed: v.boolean(),
        documentKind: v.union(
            ...SOURCE_DOCUMENT_KINDS.map((kind) => v.literal(kind)),
        ),
        coverageRole: v.optional(v.string()),
    }),
    reportingPeriodEnd: v.optional(v.union(v.string(), v.null())),
    retrievalStateHash: v.string(),
});

export const getComparisonInput = internalQuery({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        sourceCaptureId: v.id("sourceCaptures"),
        qualificationTaskId: v.id("aiTaskResults"),
        now: v.number(),
    },
    returns: v.object({
        preparation: schema.doc("sourceSelectionProposalRebuilds"),
        run: schema.doc("researchRuns"),
        revision: schema.doc("corpusRevisions"),
        targetCapture: schema.doc("sourceCaptures"),
        targetSource: schema.doc("sources"),
        qualificationTask: schema.doc("aiTaskResults"),
        company: companySnapshotValidator,
        primaryCandidates: v.array(comparisonCandidateValidator),
        candidateMetadataLimitReached: v.boolean(),
        modelBudgetBlocked: v.boolean(),
        comparisonContextHash: v.string(),
        comparisonBaseContextHash: v.string(),
        retainedComparison: v.union(schema.doc("aiTaskResults"), v.null()),
    }),
    handler: async (ctx, args) => {
        const targetCapture = await ctx.db.get(args.sourceCaptureId);
        if (
            targetCapture?.status !== "committed" ||
            !targetCapture.contentHash ||
            !targetCapture.storageId
        )
            throw sourcePreparationError("capture_unavailable");
        const { run, revision, preparation } =
            await assertPreparationComparisonFence(ctx.db, {
                preparationId: args.preparationId,
                sourceId: targetCapture.sourceId,
                sourceCaptureId: targetCapture._id,
                qualificationTaskId: args.qualificationTaskId,
                now: args.now,
            });
        if (preparation.comparisonVersion !== SOURCE_COMPARISON_VERSION)
            throw sourcePreparationError("comparison_version_unavailable");
        const targetSource = await ctx.db.get(targetCapture.sourceId);
        const qualificationTask = await ctx.db.get(args.qualificationTaskId);
        const company = mergeRunCompanyMetadata(
            run.companySnapshot,
            run.companyId ? await ctx.db.get(run.companyId) : null,
        );
        if (
            targetCapture.runId !== run._id ||
            targetCapture.corpusRevisionId !== revision._id ||
            !targetSource ||
            targetSource.runId !== run._id ||
            !qualificationTask ||
            qualificationTask.taskType !== "source_qualification" ||
            !isExecutableQualificationVersion(
                qualificationTask.schemaVersion,
            ) ||
            qualificationTask.runId !== run._id ||
            qualificationTask.corpusRevisionId !== revision._id ||
            qualificationTask.sourceId !== targetSource._id ||
            qualificationTask.sourceCaptureId !== targetCapture._id ||
            qualificationTask.output.kind !== "source_qualification" ||
            qualificationTask.output.sourceCaptureId !== targetCapture._id ||
            qualificationTask.output.contentHash !==
                targetCapture.contentHash ||
            !company
        )
            throw sourcePreparationError("qualification_unavailable");

        const primaryContext = await readComparisonPrimaryContext(
            ctx.db,
            run,
            revision._id,
        );
        const {
            primaryCandidates,
            comparisonContextHash,
            comparisonBaseContextHash,
        } = comparisonContextForTarget(primaryContext, {
            source: targetSource,
            capture: targetCapture,
            qualification: qualificationTask,
            preparation,
        });
        const history: Doc<"aiTaskResults">[] = [];
        for await (const task of readComparisonHistory(ctx.db, {
            sourceId: targetSource._id,
        }))
            history.push(task);
        const work = sourceComparisonWork(
            qualificationTask,
            history,
            comparisonContextHash,
        );
        const retainedComparison = work.kind === "reusable" ? work.task : null;
        if (
            retainedComparison?.output.kind === "source_comparison" &&
            !(await comparisonReferencesAreCurrent(
                ctx,
                {
                    runId: run._id,
                    sourceId: targetSource._id,
                    capture: targetCapture,
                    qualification: qualificationTask,
                },
                retainedComparison.output,
            ))
        )
            throw sourcePreparationError("cached_comparison_invalid");
        return {
            retainedComparison,
            comparisonBaseContextHash,
            preparation,
            run,
            revision,
            targetCapture,
            targetSource,
            qualificationTask,
            company,
            primaryCandidates,
            comparisonContextHash,
            modelBudgetBlocked: !!preparationBudgetBlock(
                await readPreparationBudget(ctx.db, run, preparation),
                readPreparationLimits(preparation),
            ),
            candidateMetadataLimitReached:
                primaryContext.candidateMetadataLimitReached,
        };
    },
});

async function comparisonReferencesAreCurrent(
    ctx: Pick<QueryCtx, "db">,
    target: {
        runId: Id<"researchRuns">;
        sourceId: Id<"sources">;
        capture: Doc<"sourceCaptures">;
        qualification: Doc<"aiTaskResults">;
    },
    output: SourceComparisonOutput,
): Promise<boolean> {
    if (
        output.findings.some((finding) => finding.premises) &&
        !sourceComparisonOutputSchema.safeParse(output).success
    )
        return false;
    if (
        target.qualification.output.kind !== "source_qualification" ||
        target.qualification.output.sourceCaptureId !== target.capture._id ||
        target.qualification.output.contentHash !==
            target.capture.contentHash ||
        !target.capture.storageId ||
        !target.capture.contentHash
    )
        return false;
    const targetArtifact = await ctx.db.system.get(
        "_storage",
        target.capture.storageId,
    );
    if (!targetArtifact || targetArtifact.size > 16 * 1024 * 1024) return false;
    const selected = new Map(
        target.qualification.output.selectedPassages.map((passage) => [
            passage.passageKey,
            passage,
        ]),
    );
    const outputIndexes = new Set<number>();
    for (const finding of output.findings) {
        if (
            outputIndexes.has(finding.findingIndex) ||
            finding.findingIndex >=
                target.qualification.output.qualification.findings.length
        )
            return false;
        outputIndexes.add(finding.findingIndex);
        const qualificationFinding =
            target.qualification.output.qualification.findings[
                finding.findingIndex
            ];
        if (!qualificationFinding) return false;
        for (const passage of finding.targetPassages) {
            const selectedPassage = selected.get(passage.passageKey);
            if (
                !selectedPassage ||
                passage.startOffset < selectedPassage.startOffset ||
                passage.endOffset > selectedPassage.endOffset ||
                passage.endOffset - passage.startOffset !==
                    passage.quotation.length ||
                passage.endOffset > targetArtifact.size ||
                !qualificationFinding.passages.some(
                    (reference) =>
                        reference.passageKey === passage.passageKey &&
                        reference.quotation.includes(passage.quotation),
                )
            )
                return false;
        }
    }

    const primaryCaptures = new Map<
        string,
        { capture: Doc<"sourceCaptures">; size: number }
    >();
    let aggregateBytes = 0;
    for (const finding of output.findings) {
        for (const passage of finding.primaryPassages) {
            if (passage.sourceId === target.sourceId) return false;
            const key = `${passage.sourceId}:${passage.captureId}:${passage.contentHash}`;
            let primary = primaryCaptures.get(key);
            if (!primary) {
                if (primaryCaptures.size >= 8) return false;
                const sourceId = passage.sourceId as Id<"sources">;
                const captureId = passage.captureId as Id<"sourceCaptures">;
                const [source, capture] = await Promise.all([
                    ctx.db.get(sourceId),
                    ctx.db.get(captureId),
                ]);
                if (
                    !source ||
                    source.runId !== target.runId ||
                    !capture ||
                    capture.status !== "committed" ||
                    capture.runId !== target.runId ||
                    capture.sourceId !== source._id ||
                    capture.contentHash !== passage.contentHash ||
                    !capture.storageId ||
                    (await readPreparationSourceDecision(ctx.db, {
                        runId: target.runId,
                        corpusRevisionId:
                            output.corpusRevisionId as Id<"corpusRevisions">,
                        sourceId: source._id,
                    })) === "rejected"
                )
                    return false;
                const artifact = await ctx.db.system.get(
                    "_storage",
                    capture.storageId,
                );
                if (!artifact || artifact.size > 16 * 1024 * 1024) return false;
                aggregateBytes += artifact.size;
                if (aggregateBytes > 32 * 1024 * 1024) return false;
                primary = { capture, size: artifact.size };
                primaryCaptures.set(key, primary);
            }
            if (
                passage.startOffset < 0 ||
                passage.endOffset > primary.size ||
                passage.endOffset - passage.startOffset !==
                    passage.quotation.length
            )
                return false;
        }
    }
    return true;
}

export const getComparison = internalQuery({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        sourceCaptureId: v.id("sourceCaptures"),
        qualificationTaskId: v.id("aiTaskResults"),
        inputHash: v.string(),
        now: v.number(),
    },
    returns: v.union(
        v.object({ status: v.literal("missing") }),
        v.object({ status: v.literal("stale") }),
        v.object({
            status: v.literal("cached"),
            taskId: v.id("aiTaskResults"),
        }),
    ),
    handler: async (ctx, args) => {
        const targetCapture = await ctx.db.get(args.sourceCaptureId);
        if (targetCapture?.status !== "committed" || !targetCapture.contentHash)
            throw sourcePreparationError("capture_unavailable");
        const { run, revision, preparation } =
            await assertPreparationComparisonFence(ctx.db, {
                preparationId: args.preparationId,
                sourceId: targetCapture.sourceId,
                sourceCaptureId: targetCapture._id,
                qualificationTaskId: args.qualificationTaskId,
                now: args.now,
            });
        if (preparation.comparisonVersion !== SOURCE_COMPARISON_VERSION)
            throw sourcePreparationError("comparison_version_unavailable");
        const qualification = await ctx.db.get(args.qualificationTaskId);
        if (
            qualification?.taskType !== "source_qualification" ||
            !isExecutableQualificationVersion(qualification.schemaVersion) ||
            qualification.runId !== run._id ||
            qualification.corpusRevisionId !== revision._id ||
            qualification.sourceId !== targetCapture.sourceId ||
            qualification.sourceCaptureId !== targetCapture._id ||
            qualification.output.kind !== "source_qualification" ||
            qualification.output.contentHash !== targetCapture.contentHash
        )
            throw sourcePreparationError("qualification_unavailable");
        let hasHistory = false;
        let task: Doc<"aiTaskResults"> | undefined;
        for await (const candidate of readComparisonHistory(ctx.db, {
            runId: run._id,
            inputHash: args.inputHash,
        })) {
            hasHistory = true;
            if (
                candidate.schemaVersion !== SOURCE_COMPARISON_VERSION ||
                candidate.output.kind !== "source_comparison" ||
                candidate.output.comparisonVersion !==
                    SOURCE_COMPARISON_VERSION ||
                candidate.output.inputHash !== args.inputHash ||
                candidate.output.runId !== run._id ||
                candidate.output.corpusRevisionId !== revision._id ||
                candidate.output.targetSourceId !== targetCapture.sourceId ||
                candidate.output.targetCaptureId !== targetCapture._id ||
                candidate.output.targetContentHash !==
                    targetCapture.contentHash ||
                candidate.output.qualificationTaskId !== qualification._id
            )
                continue;
            task ??= candidate;
            if (
                ["compared", "not_run"].includes(candidate.output.checkStatus)
            ) {
                task = candidate;
                break;
            }
        }
        if (!hasHistory) return { status: "missing" as const };
        if (task?.output.kind !== "source_comparison")
            return { status: "stale" as const };
        if (
            !["compared", "not_run"].includes(task.output.checkStatus) &&
            preparation.resumesPreparationId
        ) {
            const calls = await ctx.db
                .query("providerCalls")
                .withIndex("by_run_operation_input_and_attempt", (q) =>
                    q
                        .eq("runId", run._id)
                        .eq("operation", "source_comparison")
                        .eq("inputHash", args.inputHash),
                )
                .order("desc")
                .take(MAX_PREPARATION_ATTEMPT_HISTORY);
            if (nextPreparationAttempt(calls, preparation, args.now).attempt)
                return { status: "missing" as const };
        }
        return (await comparisonReferencesAreCurrent(
            ctx,
            {
                runId: run._id,
                sourceId: targetCapture.sourceId,
                capture: targetCapture,
                qualification,
            },
            task.output,
        ))
            ? { status: "cached" as const, taskId: task._id }
            : { status: "stale" as const };
    },
});

export const validateComparisonAuthority = internalQuery({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        sourceCaptureId: v.id("sourceCaptures"),
        qualificationTaskId: v.id("aiTaskResults"),
        primaryCaptures: v.array(
            v.object({
                sourceId: v.id("sources"),
                captureId: v.id("sourceCaptures"),
                contentHash: v.string(),
            }),
        ),
        now: v.number(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        const targetCapture = await ctx.db.get(args.sourceCaptureId);
        if (
            targetCapture?.status !== "committed" ||
            !targetCapture.contentHash ||
            !targetCapture.storageId
        )
            return false;
        const { run, revision, preparation } =
            await assertPreparationComparisonFence(ctx.db, {
                preparationId: args.preparationId,
                sourceId: targetCapture.sourceId,
                sourceCaptureId: targetCapture._id,
                qualificationTaskId: args.qualificationTaskId,
                now: args.now,
            });
        if (preparation.comparisonVersion !== SOURCE_COMPARISON_VERSION)
            return false;
        const qualification = await ctx.db.get(args.qualificationTaskId);
        if (
            qualification?.taskType !== "source_qualification" ||
            !isExecutableQualificationVersion(qualification.schemaVersion) ||
            qualification.runId !== run._id ||
            qualification.corpusRevisionId !== revision._id ||
            qualification.sourceId !== targetCapture.sourceId ||
            qualification.sourceCaptureId !== targetCapture._id ||
            qualification.output.kind !== "source_qualification" ||
            qualification.output.contentHash !== targetCapture.contentHash
        )
            return false;
        const identities = new Set<string>();
        for (const reference of args.primaryCaptures) {
            const identity = `${reference.sourceId}:${reference.captureId}:${reference.contentHash}`;
            if (identities.has(identity)) continue;
            identities.add(identity);
            if (reference.sourceId === targetCapture.sourceId) return false;
            const [source, capture] = await Promise.all([
                ctx.db.get(reference.sourceId),
                ctx.db.get(reference.captureId),
            ]);
            if (
                !source ||
                source.runId !== run._id ||
                !capture ||
                capture.status !== "committed" ||
                capture.runId !== run._id ||
                capture.sourceId !== source._id ||
                capture.contentHash !== reference.contentHash ||
                !capture.storageId ||
                (await readPreparationSourceDecision(ctx.db, {
                    runId: run._id,
                    corpusRevisionId: revision._id,
                    sourceId: source._id,
                })) === "rejected"
            )
                return false;
            const artifact = await ctx.db.system.get(
                "_storage",
                capture.storageId,
            );
            if (!artifact || artifact.size > 16 * 1024 * 1024) return false;
        }
        return true;
    },
});

export const saveComparison = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        sourceCaptureId: v.id("sourceCaptures"),
        qualificationTaskId: v.id("aiTaskResults"),
        inputHash: v.string(),
        comparisonContextHash: v.optional(v.string()),
        output: sourceComparisonOutputValidator,
        providerCallId: v.optional(v.id("providerCalls")),
        receipt: v.optional(
            v.object({
                latencyMs: v.number(),
                usage: v.optional(v.any()),
                reportedCost: v.optional(v.number()),
            }),
        ),
    },
    returns: v.id("aiTaskResults"),
    handler: async (ctx, args): Promise<Id<"aiTaskResults">> => {
        const targetCapture = await ctx.db.get(args.sourceCaptureId);
        if (targetCapture?.status !== "committed" || !targetCapture.contentHash)
            throw sourcePreparationError("capture_unavailable");
        const { run, revision, preparation } =
            await assertPreparationComparisonFence(ctx.db, {
                preparationId: args.preparationId,
                sourceId: targetCapture.sourceId,
                sourceCaptureId: targetCapture._id,
                qualificationTaskId: args.qualificationTaskId,
                now: Date.now(),
            });
        if (preparation.comparisonVersion !== SOURCE_COMPARISON_VERSION)
            throw sourcePreparationError("comparison_version_unavailable");
        const qualification = await ctx.db.get(args.qualificationTaskId);
        const output = args.output;
        if (
            qualification?.taskType !== "source_qualification" ||
            !isExecutableQualificationVersion(qualification.schemaVersion) ||
            qualification.runId !== run._id ||
            qualification.corpusRevisionId !== revision._id ||
            qualification.sourceId !== targetCapture.sourceId ||
            qualification.sourceCaptureId !== targetCapture._id ||
            qualification.output.kind !== "source_qualification" ||
            qualification.output.contentHash !== targetCapture.contentHash ||
            output.comparisonVersion !== SOURCE_COMPARISON_VERSION ||
            output.runId !== run._id ||
            output.corpusRevisionId !== revision._id ||
            output.inputHash !== args.inputHash ||
            output.targetSourceId !== targetCapture.sourceId ||
            output.targetCaptureId !== targetCapture._id ||
            output.targetContentHash !== targetCapture.contentHash ||
            output.qualificationTaskId !== qualification._id ||
            new TextEncoder().encode(JSON.stringify(output)).byteLength >
                SOURCE_COMPARISON_MAX_OUTPUT_BYTES ||
            !(await comparisonReferencesAreCurrent(
                ctx,
                {
                    runId: run._id,
                    sourceId: targetCapture.sourceId,
                    capture: targetCapture,
                    qualification,
                },
                output,
            ))
        )
            throw sourcePreparationError("comparison_output_invalid");
        if (args.comparisonContextHash) {
            const source = await ctx.db.get(targetCapture.sourceId);
            const primaryContext = await readComparisonPrimaryContext(
                ctx.db,
                run,
                revision._id,
            );
            if (
                !source ||
                comparisonContextForTarget(primaryContext, {
                    source,
                    capture: targetCapture,
                    qualification,
                    preparation,
                }).comparisonContextHash !== args.comparisonContextHash
            )
                throw sourcePreparationError("stale_execution");
        }
        for await (const cached of readComparisonHistory(ctx.db, {
            runId: run._id,
            inputHash: args.inputHash,
        })) {
            if (
                cached.schemaVersion !== SOURCE_COMPARISON_VERSION ||
                cached.providerCallId !== args.providerCallId ||
                cached.output.kind !== "source_comparison" ||
                cached.output.targetCaptureId !== targetCapture._id ||
                cached.output.qualificationTaskId !== qualification._id
            )
                continue;
            if (JSON.stringify(cached.output) !== JSON.stringify(output))
                throw sourcePreparationError("comparison_input_conflict");
            return cached._id;
        }

        let providerCall: Doc<"providerCalls"> | null = null;
        if (args.providerCallId) {
            providerCall = await ctx.db.get(args.providerCallId);
            if (
                providerCall?.service !== "model" ||
                providerCall.operation !== "source_comparison" ||
                providerCall.inputHash !== args.inputHash ||
                providerCall.runId !== run._id ||
                providerCall.corpusRevisionId !== revision._id ||
                providerCall.sourceId !== targetCapture.sourceId ||
                providerCall.preparationId !== preparation._id ||
                providerCall.executionGeneration !==
                    preparation.executionGeneration ||
                providerCall.workflowVersion !== preparation.workflowVersion ||
                providerCall.stepKey !== "source_preparation" ||
                !Number.isSafeInteger(providerCall.attempt) ||
                providerCall.attempt < 1 ||
                !["started", "succeeded", "failed"].includes(
                    providerCall.status,
                ) ||
                providerCall.operationKey !==
                    `${preparation.operationKey}:step:source_comparison:input:${args.inputHash}:attempt:${providerCall.attempt}`
            )
                throw sourcePreparationError("comparison_attempt_invalid");
        }
        if (
            (output.checkStatus === "compared" &&
                (!providerCall || providerCall.status === "failed")) ||
            (output.checkStatus === "not_run" && providerCall)
        )
            throw sourcePreparationError("comparison_attempt_invalid");
        if (providerCall?.status === "started") {
            await ctx.runMutation(internal.providerCalls.recordAttempt, {
                runId: providerCall.runId,
                corpusRevisionId: providerCall.corpusRevisionId,
                sourceId: providerCall.sourceId,
                preparationId: providerCall.preparationId,
                executionGeneration: providerCall.executionGeneration,
                workflowVersion: providerCall.workflowVersion,
                stepKey: providerCall.stepKey,
                service: "model",
                operation: providerCall.operation,
                operationKey: providerCall.operationKey,
                inputHash: args.inputHash,
                attempt: providerCall.attempt,
                status: "succeeded",
                latencyMs: args.receipt?.latencyMs,
                usage: args.receipt?.usage,
                reportedCost: args.receipt?.reportedCost,
            });
        }
        return ctx.db.insert("aiTaskResults", {
            runId: run._id,
            corpusRevisionId: revision._id,
            sourceId: targetCapture.sourceId,
            sourceCaptureId: targetCapture._id,
            taskType: "source_comparison",
            executionMode: "live",
            schemaVersion: SOURCE_COMPARISON_VERSION,
            adapterVersion: "openrouter-comparison-v1",
            inputHash: args.inputHash,
            comparisonContextHash: args.comparisonContextHash,
            ...(providerCall ? { providerCallId: providerCall._id } : {}),
            output,
            createdAt: Date.now(),
        });
    },
});

/** Backfills a derived context checkpoint only after the exact retained result is validated. */
export const confirmComparisonContext = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        sourceCaptureId: v.id("sourceCaptures"),
        qualificationTaskId: v.id("aiTaskResults"),
        taskId: v.id("aiTaskResults"),
        inputHash: v.string(),
        comparisonContextHash: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const input = await ctx.runQuery(
            internal.sourcePreparation.getComparisonInput,
            {
                preparationId: args.preparationId,
                sourceCaptureId: args.sourceCaptureId,
                qualificationTaskId: args.qualificationTaskId,
                now: Date.now(),
            },
        );
        const cached = await ctx.runQuery(
            internal.sourcePreparation.getComparison,
            {
                preparationId: args.preparationId,
                sourceCaptureId: args.sourceCaptureId,
                qualificationTaskId: args.qualificationTaskId,
                inputHash: args.inputHash,
                now: Date.now(),
            },
        );
        if (
            input.comparisonContextHash !== args.comparisonContextHash ||
            cached.status !== "cached" ||
            cached.taskId !== args.taskId
        )
            throw sourcePreparationError("stale_execution");
        await ctx.db.patch(args.taskId, {
            comparisonContextHash: args.comparisonContextHash,
        });
        return null;
    },
});

export const saveQualification = internalMutation({
    args: {
        receipt: v.optional(
            v.object({
                latencyMs: v.number(),
                usage: v.optional(v.any()),
                reportedCost: v.optional(v.number()),
            }),
        ),
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        sourceCaptureId: v.id("sourceCaptures"),
        providerCallId: v.id("providerCalls"),
        inputHash: v.string(),
        qualification: sourceQualificationValidator,
        selectionStrategy: v.optional(qualificationSelectionStrategyValidator),
        readingCompleteness: v.union(
            v.literal("complete"),
            v.literal("partial"),
        ),
        omittedPassageCount: v.number(),
        retrieval: v.optional(retrievalMetadataValidator),
        selectedPassages: v.array(
            v.object({
                passageKey: v.string(),
                startOffset: v.number(),
                endOffset: v.number(),
            }),
        ),
    },
    returns: v.id("aiTaskResults"),
    handler: async (ctx, args): Promise<Id<"aiTaskResults">> => {
        const capture = await ctx.db.get(args.sourceCaptureId);
        if (capture?.status !== "committed" || !capture.contentHash)
            throw sourcePreparationError("capture_unavailable");
        const { run, revision, preparation } =
            await assertPreparationExecutionFence(ctx.db, {
                preparationId: args.preparationId,
                sourceId: capture.sourceId,
                now: Date.now(),
            });
        const restrictionIssue = qualificationOutputIssue(
            args.qualification,
            args.selectedPassages.map((passage) => passage.passageKey),
            qualificationExecutionVersion(preparation.qualificationVersion),
        );
        if (restrictionIssue) throw sourcePreparationError(restrictionIssue);
        const call = await ctx.db.get(args.providerCallId);
        if (
            capture.runId !== run._id ||
            !call ||
            !["started", "succeeded"].includes(call.status) ||
            call.service !== "model" ||
            call.inputHash !== args.inputHash ||
            call.preparationId !== args.preparationId ||
            call.sourceId !== capture.sourceId
        )
            throw sourcePreparationError("qualification_attempt_invalid");
        const existing = await ctx.db
            .query("aiTaskResults")
            .withIndex("by_run_and_task_type_and_input_hash", (q) =>
                q
                    .eq("runId", run._id)
                    .eq("taskType", "source_qualification")
                    .eq("inputHash", args.inputHash),
            )
            .take(10);
        const cached = existing[0];
        if (cached) return cached._id;
        await ctx.runMutation(internal.providerCalls.recordAttempt, {
            runId: call.runId,
            corpusRevisionId: call.corpusRevisionId,
            sourceId: call.sourceId,
            preparationId: call.preparationId,
            executionGeneration: call.executionGeneration,
            workflowVersion: call.workflowVersion,
            stepKey: call.stepKey,
            service: "model",
            operation: call.operation,
            operationKey: call.operationKey,
            inputHash: args.inputHash,
            attempt: call.attempt,
            status: "succeeded",
            latencyMs: args.receipt?.latencyMs,
            usage: args.receipt?.usage,
            reportedCost: args.receipt?.reportedCost,
        });
        return ctx.db.insert("aiTaskResults", {
            runId: run._id,
            corpusRevisionId: revision._id,
            taskType: "source_qualification",
            sourceId: capture.sourceId,
            sourceCaptureId: capture._id,
            executionMode: "live",
            schemaVersion: qualificationExecutionVersion(
                preparation.qualificationVersion,
            ),
            adapterVersion: "openrouter-qualification-v1",
            inputHash: args.inputHash,
            providerCallId: call._id,
            output: {
                kind: "source_qualification",
                sourceCaptureId: capture._id,
                contentHash: capture.contentHash,
                qualification: args.qualification,
                ...(args.selectionStrategy
                    ? { selectionStrategy: args.selectionStrategy }
                    : {}),
                readingCompleteness: args.readingCompleteness,
                omittedPassageCount: args.omittedPassageCount,
                selectedPassages: args.selectedPassages,
                ...(args.retrieval ? { retrieval: args.retrieval } : {}),
            },
            createdAt: Date.now(),
        });
    },
});

export const recordConfigurationCheck = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        available: v.boolean(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await assertPreparationExecutionFence(ctx.db, {
            preparationId: args.preparationId,
            now: Date.now(),
        });
        await ctx.db.patch(args.preparationId, {
            configurationCheck: {
                available: args.available,
                checkedAt: Date.now(),
            },
        });
        return null;
    },
});

/** Persists real workflow boundaries with their event; replay cannot renew work or repeat an unchanged update. */
export const recordProgress = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        phase: sourcePreparationPhaseValidator,
        current: v.optional(v.number()),
        total: v.optional(v.number()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const { preparation, run } = await assertPreparationCompletionFence(
            ctx.db,
            args,
        );
        if (!preparation.progress) return null;
        if (
            (args.current !== undefined &&
                (!Number.isSafeInteger(args.current) || args.current < 0)) ||
            (args.total !== undefined &&
                (!Number.isSafeInteger(args.total) ||
                    args.total < 0 ||
                    args.total > MAX_HISTORICAL_SOURCE_CANDIDATES)) ||
            (args.current !== undefined &&
                args.total !== undefined &&
                args.current > args.total)
        )
            throw sourcePreparationError("preparation_result_invalid");
        if (
            preparation.progress.phase === args.phase &&
            preparation.progress.current === args.current &&
            preparation.progress.total === args.total
        )
            return null;
        const now = Date.now();
        await ctx.db.patch(preparation._id, {
            ...((args.phase !== "reading" ||
                preparation.progress.phase !== "reading") &&
            preparation.initialReadingsCompletedAt === undefined
                ? {
                      initialReadingsCompletedAt:
                          preparation.progress.phase === "reading"
                              ? now
                              : preparation.progress.updatedAt,
                  }
                : {}),
            progress: {
                phase: args.phase,
                current: args.current,
                total: args.total,
                updatedAt: now,
            },
        });
        await ctx.db.patch(run._id, {
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: now,
        });
        await ctx.db.insert("runEvents", {
            runId: run._id,
            sequence: run.nextEventSequence + 1,
            type: "source_preparation_progress",
            lifecycleState: run.lifecycleState,
            executionStatus: run.executionStatus,
            stepKey:
                preparation.entryPoint === "initial_discovery"
                    ? "discover_sources"
                    : "source_review",
            messageKey: {
                reading: "source_candidates_checked",
                comparison: "source_comparisons_checked",
                supplement: "source_supplement_check",
                proposal: "source_proposal_finalizing",
            }[args.phase],
            current: args.current,
            total: args.total,
            occurredAt: now,
        });
        return null;
    },
});

export const getForExecution = internalQuery({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        sourceId: v.optional(v.id("sources")),
        now: v.number(),
    },
    returns: schema.doc("sourceSelectionProposalRebuilds"),
    handler: async (ctx, args) =>
        (await assertPreparationExecutionFence(ctx.db, args)).preparation,
});

export const claimForDiscovery = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        expectedExecutionGeneration: v.number(),
    },
    returns: v.id("sourceSelectionProposalRebuilds"),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        const revision = await ctx.db.get(args.corpusRevisionId);
        const visitor = run?.ownerVisitorId
            ? await ctx.db.get(run.ownerVisitorId)
            : null;
        if (
            !run ||
            !revision ||
            !visitor ||
            visitor.status !== "active" ||
            run.executionStatus !== "running" ||
            run.lifecycleState !== "discovering_sources" ||
            run.executionGeneration !== args.expectedExecutionGeneration ||
            run.activeCorpusRevisionId !== revision._id ||
            revision.runId !== run._id ||
            revision.status !== "draft"
        )
            throw new Error("Source preparation execution is not active");
        const previous = run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
        const qualificationVersion = qualificationExecutionVersion(
            previous?.kind === "preparation"
                ? previous.qualificationVersion
                : undefined,
        );
        const operationKey = `run:${run._id}:corpus:${revision._id}:generation:${run.executionGeneration}:preparation:${qualificationVersion}:comparison:${SOURCE_COMPARISON_VERSION}${env.SOURCE_RETRIEVAL_MODE ? `:retrieval:${SOURCE_RETRIEVAL_VERSION}:${env.SOURCE_RETRIEVAL_MODE}` : ""}`;
        const existing = await ctx.db
            .query("sourceSelectionProposalRebuilds")
            .withIndex("by_operation_key", (q) =>
                q.eq("operationKey", operationKey),
            )
            .unique();
        if (existing) return existing._id;
        const now = Date.now();
        const deadlineAt =
            previous?.kind === "preparation"
                ? (previous.deadlineAt ??
                  previous.createdAt + SOURCE_PREPARATION_DEADLINE_MS)
                : now + SOURCE_PREPARATION_DEADLINE_MS;
        const preparationId = await ctx.db.insert(
            "sourceSelectionProposalRebuilds",
            {
                runId: run._id,
                corpusRevisionId: revision._id,
                kind: "preparation",
                entryPoint: "initial_discovery",
                workflowVersion: run.workflowVersion ?? 1,
                executionGeneration: run.executionGeneration,
                policyVersion: qualificationVersion,
                qualificationVersion,
                executionPlanVersion: SOURCE_PREPARATION_EXECUTION_PLAN_VERSION,
                comparisonVersion: SOURCE_COMPARISON_VERSION,
                ...(env.SOURCE_RETRIEVAL_MODE
                    ? {
                          retrievalVersion: SOURCE_RETRIEVAL_VERSION,
                          ...(previous?.kind === "preparation"
                              ? previous.retrievalRankingPolicy
                                  ? {
                                        retrievalRankingPolicy:
                                            previous.retrievalRankingPolicy,
                                    }
                                  : {}
                              : {
                                    retrievalRankingPolicy:
                                        SOURCE_RETRIEVAL_RANKING_POLICY,
                                }),
                          retrievalMode: env.SOURCE_RETRIEVAL_MODE,
                      }
                    : {}),
                operationKey,
                cycle: 1,
                status: "started",
                failedDiscoveryFamilies: [],
                progress: { phase: "reading", updatedAt: now },
                deadlineAt,
                leaseExpiresAt: deadlineAt,
                asOfTime:
                    previous?.kind === "preparation"
                        ? (previous.asOfTime ?? previous.createdAt)
                        : now,
                modelAttemptCount: 0,
                modelLimits: readPreparationLimits(),
                maxConcurrentSources: readPreparationConcurrency(),
                createdAt: now,
            },
        );
        await ctx.db.patch(run._id, {
            sourcePreparationId: preparationId,
            sourcePreparationBudget: await readPreparationBudget(
                ctx.db,
                run,
                previous?.kind === "preparation" ? previous : undefined,
            ),
        });
        return preparationId;
    },
});

export const nextBatch = internalMutation({
    args: { preparationId: v.id("sourceSelectionProposalRebuilds") },
    returns: v.object({
        executionGeneration: v.number(),
        executionPlanVersion:
            schema.tables.sourceSelectionProposalRebuilds.validator.fields
                .executionPlanVersion,
        maxConcurrentSources: v.optional(v.number()),
        sourceIds: v.array(v.id("sources")),
        canSupplement: v.boolean(),
        comparisonVersion: v.optional(v.string()),
        // Older journal entries omit this flag and retain their original workflow step order.
        progressEnabled: v.optional(v.boolean()),
        completed: v.optional(v.boolean()),
    }),
    handler: async (ctx, args) => {
        const previous = await ctx.db.get(args.preparationId);
        if (
            previous?.kind === "preparation" &&
            previous.status !== "started" &&
            previous.proposalId
        )
            return {
                executionGeneration: previous.executionGeneration,
                executionPlanVersion: previous.executionPlanVersion,
                maxConcurrentSources: readPreparationConcurrency(previous),
                sourceIds: [],
                canSupplement: false,
                completed: true,
                comparisonVersion: previous.comparisonVersion,
                progressEnabled: previous.progress ? true : undefined,
            };
        const { preparation, run } = await assertPreparationCompletionFence(
            ctx.db,
            args,
        );
        const sourceIds: Id<"sources">[] = [];
        const result = {
            executionGeneration: preparation.executionGeneration,
            executionPlanVersion: preparation.executionPlanVersion,
            maxConcurrentSources: readPreparationConcurrency(preparation),
            sourceIds,
            canSupplement: false,
            completed: false,
            ...(preparation.progress ? { progressEnabled: true } : {}),
            ...(preparation.comparisonVersion
                ? { comparisonVersion: preparation.comparisonVersion }
                : {}),
        };
        if (
            preparation.stopCode ||
            (preparation.deadlineAt ?? 0) <= Date.now() ||
            preparation.leaseExpiresAt <= Date.now()
        )
            return result;
        result.canSupplement =
            !preparation.manualSourceIds &&
            (!preparation.target || preparation.insertedCount === undefined);
        await readSourceCandidateCapacity(ctx.db, run._id);
        const eligible = await readEligiblePreparationSourceIds(
            ctx.db,
            preparation,
        );
        for (const sourceId of eligible) {
            if (
                preparation.sourceOutcomes?.some(
                    (outcome) => outcome.sourceId === sourceId,
                )
            )
                continue;
            sourceIds.push(sourceId);
            if (sourceIds.length >= (result.maxConcurrentSources ?? 2)) break;
        }
        return result;
    },
});

const comparisonTargetValidator = v.object({
    sourceId: v.id("sources"),
    sourceCaptureId: v.id("sourceCaptures"),
    qualificationTaskId: v.id("aiTaskResults"),
});

export const comparisonTargets = internalQuery({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        now: v.number(),
    },
    returns: v.array(comparisonTargetValidator),
    handler: async (ctx, args) => {
        const { preparation } = await assertPreparationCompletionFence(
            ctx.db,
            args,
        );
        if (
            preparation.comparisonVersion !== SOURCE_COMPARISON_VERSION ||
            (preparation.deadlineAt ?? 0) <= args.now ||
            preparation.leaseExpiresAt <= args.now
        )
            return [];
        const eligible = new Set(
            await readEligiblePreparationSourceIds(ctx.db, preparation),
        );
        const targets: Array<Infer<typeof comparisonTargetValidator>> = [];
        const outcomes = [...(preparation.sourceOutcomes ?? [])];
        if (
            preparation.target &&
            preparation.readingSourceIds?.length &&
            preparation.expectedProposalId
        ) {
            const pinnedItems = await ctx.db
                .query("sourceSelectionProposalItems")
                .withIndex("by_proposal_and_rank_and_source", (q) =>
                    q.eq(
                        "proposalId",
                        preparation.expectedProposalId as Id<"sourceSelectionProposals">,
                    ),
                )
                .take(MAX_HISTORICAL_SOURCE_CANDIDATES + 1);
            if (pinnedItems.length > MAX_HISTORICAL_SOURCE_CANDIDATES)
                throw sourcePreparationError("preparation_scope_invalid");
            for (const item of pinnedItems) {
                if (
                    outcomes.some(
                        (outcome) => outcome.sourceId === item.sourceId,
                    ) ||
                    (await readPreparationSourceDecision(ctx.db, {
                        runId: preparation.runId,
                        corpusRevisionId: preparation.corpusRevisionId,
                        sourceId: item.sourceId,
                    })) === "rejected"
                )
                    continue;
                const pinned = await readPinnedSourceQualification(
                    ctx.db,
                    item,
                );
                if (!pinned) continue;
                eligible.add(item.sourceId);
                outcomes.push({
                    sourceId: item.sourceId,
                    result: {
                        status: "qualified",
                        sourceCaptureId: pinned.sourceCaptureId,
                        taskId: pinned.qualificationTaskId,
                    },
                });
            }
        }
        for (const outcome of outcomes) {
            if (
                outcome.result.status !== "qualified" ||
                !eligible.has(outcome.sourceId)
            )
                continue;
            const [capture, task] = await Promise.all([
                ctx.db.get(outcome.result.sourceCaptureId),
                ctx.db.get(outcome.result.taskId),
            ]);
            if (
                capture?.status !== "committed" ||
                capture.runId !== preparation.runId ||
                capture.corpusRevisionId !== preparation.corpusRevisionId ||
                capture.sourceId !== outcome.sourceId ||
                !capture.contentHash ||
                task?.taskType !== "source_qualification" ||
                !isExecutableQualificationVersion(task.schemaVersion) ||
                task.runId !== preparation.runId ||
                task.corpusRevisionId !== preparation.corpusRevisionId ||
                task.sourceId !== outcome.sourceId ||
                task.sourceCaptureId !== capture._id ||
                task.output.kind !== "source_qualification" ||
                task.output.contentHash !== capture.contentHash
            )
                continue;
            const qualification = task.output.qualification;
            if (
                !qualification.findings.some((finding) =>
                    sourceFindingNeedsComparison(
                        finding,
                        qualification.limitations,
                    ),
                )
            ) {
                let recorded = false;
                for await (const comparison of readComparisonHistory(ctx.db, {
                    sourceId: outcome.sourceId,
                })) {
                    if (
                        comparison.schemaVersion ===
                            SOURCE_COMPARISON_VERSION &&
                        comparison.output.kind === "source_comparison" &&
                        comparison.output.checkStatus === "not_run" &&
                        comparison.output.targetCaptureId === capture._id &&
                        comparison.output.qualificationTaskId === task._id
                    ) {
                        recorded = true;
                        break;
                    }
                }
                if (recorded) continue;
            }
            targets.push({
                sourceId: outcome.sourceId,
                sourceCaptureId: capture._id,
                qualificationTaskId: task._id,
            });
        }
        return targets;
    },
});

export const reserveSupplementPlan = internalMutation({
    args: { preparationId: v.id("sourceSelectionProposalRebuilds") },
    returns: v.union(
        v.null(),
        v.object({
            supplementOperationId: v.id("sourceSelectionProposalRebuilds"),
            queries: schema.tables.researchPlans.validator.fields.queries,
        }),
    ),
    handler: async (ctx, args) => {
        const { preparation, run, revision } =
            await assertPreparationCompletionFence(ctx.db, args);
        if (
            preparation.manualSourceIds ||
            preparation.stopCode ||
            (preparation.deadlineAt ?? 0) <= Date.now() ||
            preparation.leaseExpiresAt <= Date.now()
        )
            return null;
        const batch = await ctx.runMutation(
            internal.sourcePreparation.nextBatch,
            args,
        );
        if (batch.sourceIds.length > 0)
            throw sourcePreparationError("preparation_unfinished");
        if (run.automaticSupplementOperationId) {
            const reserved = await ctx.db.get(
                run.automaticSupplementOperationId,
            );
            if (reserved?.runId !== run._id || !reserved.supplementQueries)
                throw sourcePreparationError("supplement_invalid");
            return {
                supplementOperationId: reserved._id,
                queries: reserved.supplementQueries,
            };
        }
        const capacity = await readSourceCandidateCapacity(ctx.db, run._id);
        if (capacity.remaining === 0) return null;
        const company = mergeRunCompanyMetadata(
            run.companySnapshot,
            run.companyId ? await ctx.db.get(run.companyId) : null,
        );
        const coveragePreset = run.coveragePreset;
        if (!company || !coveragePreset)
            throw sourcePreparationError("company_unavailable");
        const proposed = await createSourceSelectionProposal(ctx, {
            run,
            revision,
        });
        const proposal = await ctx.db.get(proposed.proposalId);
        if (!proposal) throw sourcePreparationError("proposal_unavailable");
        const queries = preparation.target
            ? recoverySearchPlan({
                  company,
                  coveragePreset,
                  researchAngle:
                      run.startMode === "framed"
                          ? undefined
                          : run.researchAngle,
                  target: preparation.target,
                  failedFamilies: preparation.failedDiscoveryFamilies,
              }).queries.slice(0, 1)
            : (preparation.executionPlanVersion
                  ? (proposal.documentaryCoverageGaps ??
                    proposal.coverageGaps ??
                    [])
                  : (proposal.coverageGaps ?? [])
              )
                  .flatMap(
                      (role) =>
                          recoverySearchPlan({
                              company,
                              coveragePreset,
                              researchAngle:
                                  run.startMode === "framed"
                                      ? undefined
                                      : run.researchAngle,
                              target: { kind: "coverage", role },
                              failedFamilies: [],
                          }).queries,
                  )
                  .filter((query) => query.discoveryIntent !== "regulatory")
                  .slice(0, MAX_SUPPLEMENT_SEARCHES);
        const scopedQueries = await scopeSupplementQueries(
            ctx,
            run,
            preparation,
            queries,
        );
        if (queries.length === 0) return null;
        await ctx.db.patch(preparation._id, {
            supplementQueries: scopedQueries,
        });
        await ctx.db.patch(run._id, {
            automaticSupplementOperationId: preparation._id,
        });
        return {
            supplementOperationId: preparation._id,
            queries: scopedQueries,
        };
    },
});

const supplementSearchReservationValidator = v.union(
    v.null(),
    v.object({
        query: schema.tables.researchPlans.validator.fields.queries.element,
        providerCallId: v.id("providerCalls"),
        operationKey: v.string(),
        attempt: v.optional(v.number()),
        companyCik: v.optional(v.string()),
        shouldExecute: v.boolean(),
        reasonCode: v.optional(sourcePreparationStopCodeValidator),
        retryAt: v.optional(v.number()),
    }),
);

export const reserveNextSupplementSearch = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        configuration: v.optional(
            v.object({ sec: v.boolean(), exa: v.boolean() }),
        ),
    },
    returns: supplementSearchReservationValidator,
    handler: async (
        ctx,
        args,
    ): Promise<Infer<typeof supplementSearchReservationValidator>> => {
        const plan = await ctx.runMutation(
            internal.sourcePreparation.reserveSupplementPlan,
            { preparationId: args.preparationId },
        );
        if (!plan) return null;
        const { preparation, run } = await assertPreparationExecutionFence(
            ctx.db,
            { ...args, now: Date.now() },
        );
        const operation = await ctx.db.get(plan.supplementOperationId);
        if (!operation) throw sourcePreparationError("supplement_invalid");
        if (
            (await readSourceCandidateCapacity(ctx.db, run._id)).remaining === 0
        )
            return null;
        if (preparation.target && preparation.insertedCount !== undefined)
            return null;
        const claimed = operation.supplementClaimedQueryIndexes ?? [];
        if (claimed.length >= MAX_SUPPLEMENT_SEARCHES) return null;
        let queryIndex = plan.queries.findIndex((_, i) => !claimed.includes(i));
        const queries = [...plan.queries];
        let retryIndex: number | undefined;
        const retryableQueryIndexes = new Set<number>();
        const blockedQueries = new Map<
            number,
            NonNullable<Infer<typeof supplementSearchReservationValidator>>
        >();
        if (preparation.resumesPreparationId) {
            for (const index of new Set(claimed)) {
                const query = queries[index];
                if (!query) continue;
                const calls = await readSupplementalSearchAttempts(
                    ctx.db,
                    run._id,
                    operation,
                    index,
                );
                const retry = nextPreparationAttempt(
                    calls,
                    preparation,
                    Date.now(),
                    1,
                );
                const last = [...calls].sort(
                    (a, b) => b.attempt - a.attempt,
                )[0];
                if (
                    last &&
                    retry.attempt !== 2 &&
                    retry.errorCode !== "result_already_recorded"
                )
                    blockedQueries.set(index, {
                        query,
                        providerCallId: last._id,
                        operationKey: last.operationKey,
                        shouldExecute: false,
                        reasonCode:
                            preparationFailureClass(last) === "terminal"
                                ? "request_invalid"
                                : "transport_unavailable",
                        retryAt: retry.retryAt,
                    });
                if (retry.attempt === 2) {
                    retryableQueryIndexes.add(index);
                    retryIndex ??= index;
                }
            }
        }
        if (!preparation.target && retryIndex !== undefined)
            queryIndex = retryIndex;
        if (preparation.target) {
            const company = mergeRunCompanyMetadata(
                run.companySnapshot,
                run.companyId ? await ctx.db.get(run.companyId) : null,
            );
            if (!company || !run.coveragePreset)
                throw sourcePreparationError("company_unavailable");
            const targetedQueries = await scopeSupplementQueries(
                ctx,
                run,
                preparation,
                recoverySearchPlan({
                    company,
                    coveragePreset: run.coveragePreset,
                    researchAngle:
                        run.startMode === "framed"
                            ? undefined
                            : run.researchAngle,
                    target: preparation.target,
                    failedFamilies: preparation.failedDiscoveryFamilies,
                }).queries,
            );
            if (!targetedQueries.length)
                throw sourcePreparationError("request_invalid");
            const targetedQuery =
                targetedQueries.find((query) => {
                    const index = queries.findIndex(
                        (existing) =>
                            supplementalSearchInputHash(existing) ===
                            supplementalSearchInputHash(query),
                    );
                    return (
                        index < 0 ||
                        !claimed.includes(index) ||
                        retryableQueryIndexes.has(index)
                    );
                }) ??
                targetedQueries.find((query) =>
                    blockedQueries.has(
                        queries.findIndex(
                            (existing) =>
                                supplementalSearchInputHash(existing) ===
                                supplementalSearchInputHash(query),
                        ),
                    ),
                );
            if (!targetedQuery) return null;
            const existingIndex = queries.findIndex(
                (query) =>
                    supplementalSearchInputHash(query) ===
                    supplementalSearchInputHash(targetedQuery),
            );
            const blocked = blockedQueries.get(existingIndex);
            if (blocked) return blocked;
            if (existingIndex >= 0 && claimed.includes(existingIndex)) {
                if (!retryableQueryIndexes.has(existingIndex)) return null;
                queryIndex = existingIndex;
            } else if (
                queryIndex < 0 &&
                queries.length < MAX_SUPPLEMENT_SEARCHES
            )
                queryIndex = queries.length;
            if (queryIndex >= 0 && queryIndex < MAX_SUPPLEMENT_SEARCHES) {
                if (!claimed.includes(queryIndex))
                    queries[queryIndex] = targetedQuery;
                await ctx.db.patch(operation._id, {
                    supplementQueries: queries,
                });
            }
        }
        if (queryIndex < 0 || queryIndex >= MAX_SUPPLEMENT_SEARCHES)
            return blockedQueries.values().next().value ?? null;
        const query = queries[queryIndex];
        if (!query) throw sourcePreparationError("supplement_invalid");
        const companyCik =
            query.discoveryIntent === "regulatory"
                ? mergeRunCompanyMetadata(
                      run.companySnapshot,
                      run.companyId ? await ctx.db.get(run.companyId) : null,
                  )?.cik
                : undefined;
        if (
            query.discoveryIntent === "regulatory" &&
            (!companyCik || !/^\d{1,10}$/.test(companyCik))
        )
            throw sourcePreparationError("company_unavailable");
        if (
            args.configuration &&
            !(query.discoveryIntent === "regulatory"
                ? args.configuration.sec
                : args.configuration.exa)
        )
            throw sourcePreparationError("missing_configuration");
        const attempt =
            claimed.filter((index) => index === queryIndex).length + 1;
        if (attempt > 2) return null;
        const operationKey = supplementalSearchOperationKey(
            operation._id,
            queryIndex,
            attempt,
        );
        const lease = await ctx.runMutation(
            internal.providerCalls.recordAttempt,
            {
                runId: run._id,
                corpusRevisionId: preparation.corpusRevisionId,
                preparationId: preparation._id,
                executionGeneration: preparation.executionGeneration,
                workflowVersion: preparation.workflowVersion,
                stepKey: "source_preparation",
                service: query.discoveryIntent === "regulatory" ? "sec" : "exa",
                operation: "source_supplement_search",
                operationKey,
                inputHash: supplementalSearchInputHash(query),
                attempt,
                status: "started",
            },
        );
        await ctx.db.patch(operation._id, {
            supplementClaimedQueryIndexes: [...claimed, queryIndex],
        });
        if (preparation.target)
            await ctx.db.patch(preparation._id, { insertedCount: 0 });
        if (lease.errorCode === "paid_work_disabled")
            await ctx.db.patch(preparation._id, {
                stopCode: "paid_work_disabled",
            });
        return {
            query,
            ...(companyCik ? { companyCik } : {}),
            providerCallId: lease.providerCallId,
            operationKey,
            attempt,
            shouldExecute: lease.shouldExecute,
            ...(!lease.shouldExecute
                ? {
                      reasonCode:
                          lease.errorCode === "paid_work_disabled"
                              ? ("paid_work_disabled" as const)
                              : ("transport_unavailable" as const),
                  }
                : {}),
        };
    },
});

export const recordResult = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        outcome: sourcePreparationOutcomeValidator,
    },
    returns: v.union(
        v.literal("recorded"),
        v.literal("source_rejected"),
        v.literal("deadline_elapsed"),
    ),
    handler: async (ctx, args) => {
        const { preparation, run, revision } =
            await assertPreparationCompletionFence(ctx.db, args);
        if (
            (await readPreparationSourceDecision(ctx.db, {
                runId: run._id,
                corpusRevisionId: revision._id,
                sourceId: args.outcome.sourceId,
            })) === "rejected"
        )
            return "source_rejected" as const;
        if (
            (preparation.deadlineAt ?? 0) <= Date.now() ||
            preparation.leaseExpiresAt <= Date.now()
        )
            return "deadline_elapsed" as const;
        await assertPreparationExecutionFence(ctx.db, {
            preparationId: preparation._id,
            sourceId: args.outcome.sourceId,
            now: Date.now(),
        });
        const outcomes = preparation.sourceOutcomes ?? [];
        const previous = outcomes.find(
            (outcome) => outcome.sourceId === args.outcome.sourceId,
        );
        const result = args.outcome.result;
        if (previous) {
            const identical =
                previous.result.status === "qualified" &&
                result.status === "qualified"
                    ? previous.result.taskId === result.taskId
                    : previous.result.status === "unavailable" &&
                      result.status === "unavailable" &&
                      previous.result.reasonCode === result.reasonCode;
            if (
                !identical ||
                previous.result.sourceCaptureId !== result.sourceCaptureId
            )
                throw sourcePreparationError("preparation_result_conflict");
            return "recorded" as const;
        }
        if (outcomes.length >= MAX_HISTORICAL_SOURCE_CANDIDATES)
            throw sourcePreparationError("preparation_result_limit");
        const capture = result.sourceCaptureId
            ? await ctx.db.get(result.sourceCaptureId)
            : null;
        if (
            result.sourceCaptureId &&
            (!capture ||
                capture.runId !== run._id ||
                capture.sourceId !== args.outcome.sourceId)
        )
            throw sourcePreparationError("capture_unavailable");
        if (result.status === "qualified") {
            const task = await ctx.db.get(result.taskId);
            if (
                capture?.status !== "committed" ||
                !task ||
                !isExecutableQualificationVersion(task.schemaVersion) ||
                task.runId !== run._id ||
                task.sourceId !== args.outcome.sourceId ||
                task.output.kind !== "source_qualification" ||
                task.output.sourceCaptureId !== capture._id ||
                task.output.contentHash !== capture.contentHash
            )
                throw sourcePreparationError("qualification_unavailable");
        } else if (!result.reasonCode.trim() || result.reasonCode.length > 100)
            throw sourcePreparationError("preparation_result_invalid");
        const capacity = await readSourceCandidateCapacity(ctx.db, run._id);
        const now = Date.now();
        const stopCode =
            result.status === "unavailable"
                ? sourcePreparationStopCodeValidator.members.find(
                      (code) => code.value === result.reasonCode,
                  )?.value
                : undefined;
        await ctx.db.patch(preparation._id, {
            sourceOutcomes: [...outcomes, args.outcome],
            ...(preparation.progress
                ? { progress: { phase: "reading" as const, updatedAt: now } }
                : {}),
            ...(stopCode && !preparation.stopCode ? { stopCode } : {}),
        });
        await ctx.db.patch(run._id, {
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: now,
        });
        await ctx.db.insert("runEvents", {
            runId: run._id,
            sequence: run.nextEventSequence + 1,
            type: "source_preparation_progress",
            lifecycleState: run.lifecycleState,
            executionStatus: run.executionStatus,
            stepKey:
                preparation.entryPoint === "initial_discovery"
                    ? "discover_sources"
                    : "source_review",
            messageKey: "source_candidates_checked",
            current: outcomes.length + 1,
            total:
                preparation.readingSourceIds?.length ??
                preparation.manualSourceIds?.length ??
                capacity.total,
            occurredAt: now,
        });
        return "recorded" as const;
    },
});

/** Records model-stage stop causes without replacing retained reading outcomes. */
export const recordComparisonResults = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        failures: v.array(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const { preparation } = await assertPreparationCompletionFence(
            ctx.db,
            args,
        );
        const stopCode = sourcePreparationStopCodeValidator.members.find(
            (code) => args.failures.includes(code.value),
        )?.value;
        if (stopCode && !preparation.stopCode)
            await ctx.db.patch(preparation._id, { stopCode });
        return null;
    },
});

const completionResultValidator = v.object({
    proposalId: v.id("sourceSelectionProposals"),
    version: v.number(),
    outcome: v.union(
        v.literal("complete"),
        v.literal("partial"),
        v.literal("blocked"),
    ),
});

export const finish = internalMutation({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        expectedExecutionGeneration: v.number(),
        stopCode: v.optional(sourcePreparationStopCodeValidator),
        retryAt: v.optional(v.number()),
    },
    returns: completionResultValidator,
    handler: async (ctx, args) => {
        const previous = await ctx.db.get(args.preparationId);
        if (
            previous?.kind !== "preparation" ||
            previous.executionGeneration !== args.expectedExecutionGeneration
        )
            throw sourcePreparationError("stale_execution");
        if (
            previous.status !== "started" &&
            previous.proposalId &&
            previous.proposalVersion !== undefined
        )
            return {
                proposalId: previous.proposalId,
                version: previous.proposalVersion,
                outcome: previous.status,
            };
        const { preparation, run, revision } =
            await assertPreparationCompletionFence(ctx.db, args);
        const stopCode = preparation.stopCode ?? args.stopCode;
        const now = Date.now();
        await readSourceCandidateCapacity(ctx.db, run._id);
        const eligible = await readEligiblePreparationSourceIds(
            ctx.db,
            preparation,
        );
        const outcomes = (preparation.sourceOutcomes ?? []).filter((outcome) =>
            eligible.includes(outcome.sourceId),
        );
        const expired =
            (preparation.deadlineAt ?? 0) <= now ||
            preparation.leaseExpiresAt <= now;
        if (
            eligible.some(
                (sourceId) =>
                    !outcomes.some((outcome) => outcome.sourceId === sourceId),
            ) &&
            !expired &&
            !stopCode
        )
            throw sourcePreparationError("preparation_unfinished");
        const qualified = outcomes.filter(
            (outcome) => outcome.result.status === "qualified",
        ).length;
        const outcome =
            qualified === eligible.length && !stopCode && !expired
                ? ("complete" as const)
                : qualified > 0
                  ? ("partial" as const)
                  : ("blocked" as const);
        const priorProposal = revision.sourceSelectionProposalId
            ? await ctx.db.get(revision.sourceSelectionProposalId)
            : null;
        const failedDiscoveryFamilies = [
            ...new Set([
                ...(preparation.target?.kind === "failed_discovery"
                    ? []
                    : (priorProposal?.failedDiscoveryFamilies ?? [])),
                ...preparation.failedDiscoveryFamilies,
            ]),
        ];
        const proposal = await createSourceSelectionProposal(ctx, {
            run,
            revision,
            rebuild: {
                outcome: outcome === "complete" ? "complete" : "partial",
                failedDiscoveryFamilies,
            },
        });
        await ctx.db.patch(preparation._id, {
            status: outcome,
            stopCode,
            reason:
                preparation.target &&
                !stopCode &&
                (preparation.insertedCount ?? 0) === 0
                    ? "no_new_candidates"
                    : stopCode === "request_invalid"
                      ? "request_rejected"
                      : outcome === "blocked"
                        ? "unavailable"
                        : undefined,
            ...(preparation.target && outcome === "blocked"
                ? { leaseExpiresAt: Math.max(now + 15_000, args.retryAt ?? 0) }
                : {}),
            proposalId: proposal.proposalId,
            proposalVersion: proposal.version,
            completedAt: now,
        });
        const reviewEntry = preparation.entryPoint !== "initial_discovery";
        const latestRun = await ctx.db.get(run._id);
        if (!latestRun) throw sourcePreparationError("stale_execution");
        const currentRun = reviewEntry
            ? await applyRequestedResearchPause(ctx, latestRun)
            : latestRun;
        await ctx.db.patch(run._id, {
            ...(reviewEntry && currentRun.pauseReason !== "analyst"
                ? {
                      executionStatus: "paused" as const,
                      pauseReason: "source_review" as const,
                  }
                : {}),
            nextEventSequence: currentRun.nextEventSequence + 1,
            updatedAt: now,
        });
        await ctx.db.insert("runEvents", {
            runId: run._id,
            sequence: currentRun.nextEventSequence + 1,
            type: "source_preparation_completed",
            lifecycleState: run.lifecycleState,
            executionStatus: reviewEntry ? "paused" : run.executionStatus,
            stepKey: reviewEntry ? "source_review" : "discover_sources",
            messageKey:
                outcome === "complete"
                    ? "source_preparation_ready"
                    : "source_preparation_limited",
            current: outcomes.length,
            total: eligible.length,
            failureCode:
                stopCode ??
                (expired
                    ? "preparation_deadline"
                    : outcome === "blocked"
                      ? "qualification_unavailable"
                      : undefined),
            occurredAt: now,
        });
        if (run.startMode === "framed")
            await ctx.scheduler.runAfter(
                0,
                internal.workbench.processInstructions,
                { runId: run._id },
            );
        return {
            proposalId: proposal.proposalId,
            version: proposal.version,
            outcome,
        };
    },
});
