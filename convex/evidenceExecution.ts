import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
    internalMutation,
    type MutationCtx,
    mutation,
} from "./_generated/server";
import { loadEffectiveAcceptedSourceHeads } from "./domain/evidenceAuthority";
import {
    claimCorpusApprovedRunExecution,
    claimEvidenceRetryExecution,
    claimUnavailableResumeExecution,
} from "./domain/executionClaim";
import { lookupShowcaseManifest } from "./domain/showcaseManifest";
import { sourceDossierCandidateLimit } from "./resourceLimits";
import { requireWorkspaceRun } from "./runWorkspace";
import { workflow } from "./workflow";

const evidenceWorkflowRun = internal.evidenceWorkflow.run;

const evidenceWorkflowOnComplete = internal.evidenceWorkflow.onComplete;

async function startApprovedRun(
    ctx: MutationCtx,
    run: Doc<"researchRuns">,
    visitor: Doc<"visitors">,
    requestKey: string,
): Promise<{ acceptedSourceCount: number; executionGeneration: number }> {
    // Idempotent replay check with identical request key on this run
    if (run.evidenceStartRequestKey === requestKey) {
        const limit = sourceDossierCandidateLimit(run.sourcePreparationId);
        const frozen = await ctx.db
            .query("evidenceSourceStatuses")
            .withIndex("by_run_and_execution_generation", (query) =>
                query
                    .eq("runId", run._id)
                    .eq("executionGeneration", run.executionGeneration),
            )
            .take(limit + 1);
        if (frozen.length > limit) {
            throw new Error("Frozen source limit exceeded");
        }
        return {
            acceptedSourceCount: frozen.length,
            executionGeneration: run.executionGeneration,
        };
    }

    if (
        run.lifecycleState !== "corpus_approved" ||
        run.executionStatus !== "idle" ||
        !run.activeCorpusRevisionId
    ) {
        throw new Error("Research run cannot be started");
    }

    const revision = await ctx.db.get(run.activeCorpusRevisionId);
    if (
        !revision ||
        revision.runId !== run._id ||
        revision.status !== "approved"
    ) {
        throw new Error("Active corpus revision is not approved");
    }

    const acceptedSources = await loadEffectiveAcceptedSourceHeads(ctx, {
        runId: run._id,
        corpusRevisionId: revision._id,
    });

    const now = Date.now();
    const executionGeneration = await claimCorpusApprovedRunExecution(ctx, {
        visitor,
        run,
        now,
    });

    for (const accepted of acceptedSources) {
        await ctx.db.insert("evidenceSourceStatuses", {
            runId: run._id,
            corpusRevisionId: revision._id,
            sourceId: accepted.sourceId,
            acceptedDecisionId: accepted.acceptedDecisionId,
            executionGeneration,
            status: "queued",
            requestKey,
            createdAt: now,
            updatedAt: now,
        });
    }

    const workflowId = await workflow.start(
        ctx,
        evidenceWorkflowRun,
        { runId: run._id, executionGeneration },
        {
            startAsync: true,
            onComplete: evidenceWorkflowOnComplete,
            context: { runId: run._id },
        },
    );

    await ctx.db.patch(run._id, {
        workflowId,
        workflowVersion: 2,
        evidenceStartRequestKey: requestKey,
        nextEventSequence: run.nextEventSequence + 1,
        updatedAt: now,
    });

    await ctx.db.insert("runEvents", {
        runId: run._id,
        sequence: run.nextEventSequence + 1,
        type: "run_transitioned",
        lifecycleState: "extracting_evidence",
        executionStatus: "running",
        stepKey: "extract_evidence",
        occurredAt: now,
    });

    await ctx.db.insert("workflowSteps", {
        runId: run._id,
        key: "extract_evidence",
        state: "running",
        attempt: 1,
        startedAt: now,
        updatedAt: now,
    });

    return {
        acceptedSourceCount: acceptedSources.length,
        executionGeneration,
    };
}

export const start = mutation({
    args: {
        runId: v.id("researchRuns"),
        requestKey: v.string(),
    },
    returns: v.object({
        acceptedSourceCount: v.number(),
        executionGeneration: v.number(),
    }),
    handler: async (ctx, args) => {
        const { visitor, run } = await requireWorkspaceRun(ctx, args.runId);
        const requestKey = args.requestKey.trim();
        if (requestKey.length === 0 || requestKey.length > 128) {
            throw new Error("Invalid request key");
        }

        return startApprovedRun(ctx, run, visitor, requestKey);
    },
});

export const completeSourceReview = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        decisionId: v.id("checkpointDecisions"),
        expectedExecutionGeneration: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        const decision = await ctx.db.get(args.decisionId);
        const revision = await ctx.db.get(args.corpusRevisionId);
        const visitor = run?.ownerVisitorId
            ? await ctx.db.get(run.ownerVisitorId)
            : null;
        if (
            !run ||
            visitor?.status !== "active" ||
            decision?.runId !== run._id ||
            decision.checkpoint !== "source_review" ||
            decision.decision !== "approved" ||
            decision.reviewerVisitorId !== visitor._id ||
            revision?.runId !== run._id ||
            revision.status !== "approved" ||
            revision.approvedByVisitorId !== visitor._id ||
            run.activeCorpusRevisionId !== revision._id
        ) {
            throw new Error("Approved corpus handoff authority is invalid");
        }
        const requestKey = `corpus:${revision._id}:approval:${decision._id}`;
        if (run.evidenceStartRequestKey === requestKey) return null;
        if (
            run.executionGeneration !== args.expectedExecutionGeneration ||
            run.lifecycleState !== "awaiting_source_review" ||
            run.executionStatus !== "running"
        ) {
            throw new Error("Stale approved corpus handoff");
        }
        await ctx.runMutation(internal.researchRuns.transition, {
            runId: run._id,
            expectedExecutionGeneration: args.expectedExecutionGeneration,
            lifecycleState: "corpus_approved",
            executionStatus: "idle",
            stepKey: "source_review",
        });
        const approvedRun = await ctx.db.get(run._id);
        if (!approvedRun)
            throw new Error("Approved research run was not found");
        await startApprovedRun(ctx, approvedRun, visitor, requestKey);
        return null;
    },
});

/**
 * Protected retry boundary for claim generation unavailability.
 * First checks capability without writes. If still unavailable => strict no-op.
 * Newly available => atomically claim slot, bump generation, start new workflow.
 * Reuses frozen row/artifacts via inputHash idempotency.
 */
export const retryClaimGeneration = mutation({
    args: {
        runId: v.id("researchRuns"),
    },
    returns: v.object({
        status: v.union(v.literal("unavailable"), v.literal("retried")),
        executionGeneration: v.number(),
    }),
    handler: async (ctx, args) => {
        const { visitor, run } = await requireWorkspaceRun(ctx, args.runId);

        // Run must be at the exact unavailable pause tuple
        if (
            run.lifecycleState !== "extracting_evidence" ||
            run.executionStatus !== "paused" ||
            run.pauseReason !== "claim_generation_unavailable"
        ) {
            throw new Error(
                "Research run is not paused for claim generation unavailable",
            );
        }

        if (!run.activeCorpusRevisionId) {
            throw new Error("Research run missing activeCorpusRevisionId");
        }

        // --- Capability check: NO WRITES ---
        // Compute the normalized input hash for this run's current state.
        // We use the internal query to build it (read-only).
        const normalizedInputResult = await ctx.runQuery(
            internal.claimGeneration.getNormalizedClaimInput,
            {
                runId: run._id,
                executionGeneration: run.executionGeneration,
            },
        );

        // If we can't compute normalized input, capability is still unavailable
        if (!normalizedInputResult) {
            return {
                status: "unavailable" as const,
                executionGeneration: run.executionGeneration,
            };
        }

        // Check manifest registry for the input hash
        const manifest = lookupShowcaseManifest(
            normalizedInputResult.inputHash,
        );
        if (!manifest) {
            // Still unavailable — strict no-op
            return {
                status: "unavailable" as const,
                executionGeneration: run.executionGeneration,
            };
        }

        if (run.workflowId !== undefined) {
            throw new Error("Claim generation workflow is still completing");
        }

        // --- Capability available: atomic resume and exact frozen-row clone ---
        const now = Date.now();
        const previousGeneration = run.executionGeneration;
        const executionGeneration = await claimUnavailableResumeExecution(ctx, {
            visitor,
            run,
            checkpoint: {
                lifecycleState: "extracting_evidence",
                pauseReason: "claim_generation_unavailable",
            },
            now,
        });
        const revision = await ctx.db.get(run.activeCorpusRevisionId);
        if (revision?.status !== "approved") {
            throw new Error("Active corpus revision is not approved");
        }
        const limit = sourceDossierCandidateLimit(run.sourcePreparationId);
        const priorStatuses = await ctx.db
            .query("evidenceSourceStatuses")
            .withIndex("by_run_and_execution_generation", (query) =>
                query
                    .eq("runId", run._id)
                    .eq("executionGeneration", previousGeneration),
            )
            .take(limit + 1);
        if (priorStatuses.length === 0 || priorStatuses.length > limit) {
            throw new Error(
                "Frozen source retry set is missing or exceeds limit",
            );
        }
        for (const prior of priorStatuses) {
            if (prior.corpusRevisionId !== revision._id) {
                throw new Error("Frozen source revision changed before retry");
            }
            const review = await ctx.db
                .query("sourceReviewItems")
                .withIndex("by_revision_and_source", (query) =>
                    query
                        .eq("corpusRevisionId", revision._id)
                        .eq("sourceId", prior.sourceId),
                )
                .unique();
            const decision = review
                ? await ctx.db.get(review.latestDecisionId)
                : null;
            if (
                review?.decision !== "accepted" ||
                review.latestDecisionId !== prior.acceptedDecisionId ||
                decision?.decision !== "accepted"
            ) {
                throw new Error("Accepted source head changed before retry");
            }
            if (prior.sourceVersionId) {
                const sourceVersion = await ctx.db.get(prior.sourceVersionId);
                if (
                    sourceVersion?.sourceId !== prior.sourceId ||
                    sourceVersion.acceptedDecisionId !==
                        prior.acceptedDecisionId ||
                    sourceVersion.corpusRevisionId !== revision._id
                ) {
                    throw new Error(
                        "Frozen source version changed before retry",
                    );
                }
            }
            if (
                prior.status !== "succeeded" &&
                prior.status !== "partial" &&
                prior.status !== "failed"
            ) {
                throw new Error(
                    "Frozen source status is non-terminal and cannot be reused on retry",
                );
            }
            await ctx.db.insert("evidenceSourceStatuses", {
                runId: run._id,
                corpusRevisionId: revision._id,
                sourceId: prior.sourceId,
                acceptedDecisionId: prior.acceptedDecisionId,
                sourceVersionId: prior.sourceVersionId,
                executionGeneration,
                status: prior.status,
                requestKey: prior.requestKey,
                failureReason: prior.failureReason,
                createdAt: now,
                updatedAt: now,
            });
        }

        // Start a new workflow that schedules only incomplete claim+policy steps
        const workflowId = await workflow.start(
            ctx,
            evidenceWorkflowRun,
            { runId: run._id, executionGeneration },
            {
                startAsync: true,
                onComplete: evidenceWorkflowOnComplete,
                context: { runId: run._id },
            },
        );

        await ctx.db.patch(run._id, {
            workflowId,
            workflowVersion: 2,
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: now,
        });

        await ctx.db.insert("runEvents", {
            runId: run._id,
            sequence: run.nextEventSequence + 1,
            type: "run_retried",
            lifecycleState: "extracting_evidence",
            executionStatus: "running",
            stepKey: "generate_claims",
            occurredAt: now,
        });

        return {
            status: "retried" as const,
            executionGeneration,
        };
    },
});

/**
 * Retries a typed failed evidence extraction. Claims the visitor slot,
 * advances the generation, clones terminal success/partial rows exactly
 * (reusing their sourceVersionId and failureReason), re-queues only the
 * failed/missing branches, and starts a fresh workflow that dispatches only
 * that incomplete source work. No committed artifact, passage, claim, task,
 * policy, or storage record is recreated.
 */
export const retryEvidenceExtraction = mutation({
    args: {
        runId: v.id("researchRuns"),
    },
    returns: v.object({
        executionGeneration: v.number(),
    }),
    handler: async (ctx, args) => {
        const { visitor, run } = await requireWorkspaceRun(ctx, args.runId);
        if (
            run.lifecycleState !== "extracting_evidence" ||
            run.executionStatus !== "failed"
        ) {
            throw new Error(
                "Research run is not in a retryable failed evidence state",
            );
        }
        if (!run.activeCorpusRevisionId) {
            throw new Error("Research run missing activeCorpusRevisionId");
        }
        if (run.workflowId !== undefined) {
            throw new Error("Evidence workflow is still completing");
        }

        const now = Date.now();
        const previousGeneration = run.executionGeneration;
        const executionGeneration = await claimEvidenceRetryExecution(ctx, {
            visitor,
            run,
            now,
        });
        const revision = await ctx.db.get(run.activeCorpusRevisionId);
        if (revision?.status !== "approved") {
            throw new Error("Active corpus revision is not approved");
        }
        const limit = sourceDossierCandidateLimit(run.sourcePreparationId);
        const priorStatuses = await ctx.db
            .query("evidenceSourceStatuses")
            .withIndex("by_run_and_execution_generation", (query) =>
                query
                    .eq("runId", run._id)
                    .eq("executionGeneration", previousGeneration),
            )
            .take(limit + 1);
        if (priorStatuses.length === 0 || priorStatuses.length > limit) {
            throw new Error(
                "Frozen source retry set is missing or exceeds limit",
            );
        }
        for (const prior of priorStatuses) {
            if (prior.corpusRevisionId !== revision._id) {
                throw new Error("Frozen source revision changed before retry");
            }
            const review = await ctx.db
                .query("sourceReviewItems")
                .withIndex("by_revision_and_source", (query) =>
                    query
                        .eq("corpusRevisionId", revision._id)
                        .eq("sourceId", prior.sourceId),
                )
                .unique();
            const decision = review
                ? await ctx.db.get(review.latestDecisionId)
                : null;
            if (
                review?.decision !== "accepted" ||
                review.latestDecisionId !== prior.acceptedDecisionId ||
                decision?.decision !== "accepted"
            ) {
                throw new Error("Accepted source head changed before retry");
            }
            if (prior.sourceVersionId) {
                const sourceVersion = await ctx.db.get(prior.sourceVersionId);
                if (
                    sourceVersion?.sourceId !== prior.sourceId ||
                    sourceVersion.acceptedDecisionId !==
                        prior.acceptedDecisionId ||
                    sourceVersion.corpusRevisionId !== revision._id
                ) {
                    throw new Error(
                        "Frozen source version changed before retry",
                    );
                }
            }
            // Re-queue only missing/incomplete work (status failed). Reuse
            // terminal rows exactly, including the sourceVersionId and
            // failureReason, as immutable committed source versions must never
            // be rebuilt and limitation metadata must carry through unchanged.
            if (prior.status === "failed") {
                await ctx.db.insert("evidenceSourceStatuses", {
                    runId: run._id,
                    corpusRevisionId: revision._id,
                    sourceId: prior.sourceId,
                    acceptedDecisionId: prior.acceptedDecisionId,
                    sourceVersionId: undefined,
                    executionGeneration,
                    status: "queued",
                    requestKey: prior.requestKey,
                    failureReason: undefined,
                    createdAt: now,
                    updatedAt: now,
                });
            } else if (
                prior.status === "succeeded" ||
                prior.status === "partial"
            ) {
                await ctx.db.insert("evidenceSourceStatuses", {
                    runId: run._id,
                    corpusRevisionId: revision._id,
                    sourceId: prior.sourceId,
                    acceptedDecisionId: prior.acceptedDecisionId,
                    sourceVersionId: prior.sourceVersionId,
                    executionGeneration,
                    status: prior.status,
                    requestKey: prior.requestKey,
                    failureReason: prior.failureReason,
                    createdAt: now,
                    updatedAt: now,
                });
            } else {
                throw new Error(
                    "Prior source status is non-terminal and cannot be retried",
                );
            }
        }

        const workflowId = await workflow.start(
            ctx,
            evidenceWorkflowRun,
            { runId: run._id, executionGeneration },
            {
                startAsync: true,
                onComplete: evidenceWorkflowOnComplete,
                context: { runId: run._id },
            },
        );

        await ctx.db.patch(run._id, {
            workflowId,
            workflowVersion: 2,
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: now,
        });

        await ctx.db.insert("runEvents", {
            runId: run._id,
            sequence: run.nextEventSequence + 1,
            type: "run_retried",
            lifecycleState: "extracting_evidence",
            executionStatus: "running",
            stepKey: "extract_evidence",
            occurredAt: now,
        });

        return { executionGeneration };
    },
});
