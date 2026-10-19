import type { Id } from "@convex/_generated/dataModel";
import { vResultValidator, vWorkflowId } from "@convex-dev/workflow";
import { fanOutFrozenBranches } from "@convex/domain/evidenceFanout";
import type { FunctionReference } from "convex/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { assertLifecycleTransition } from "./domain/transitions";
import { applyEvidenceExtractionFailed } from "./domain/evidenceFailure";
import { MAX_CLAIMS_PER_RUN, sourceCandidateLimit } from "./resourceLimits";
import { internalMutation } from "./_generated/server";
import { workflow } from "./workflow";

type InternalQueryRef = FunctionReference<"query", "internal">;
type InternalMutationRef = FunctionReference<"mutation", "internal">;
type InternalActionRef = FunctionReference<"action", "internal">;

const clearActiveWorkflowHandleOnSuccessRef = makeFunctionReference(
    "evidenceWorkflow:clearActiveWorkflowHandleOnSuccess",
) as unknown as InternalMutationRef;

const listFrozenSourcesForRunRef = makeFunctionReference(
    "evidenceArtifacts:listFrozenSourcesForRun",
) as unknown as InternalQueryRef;

const updateEvidenceSourceStatusRef = makeFunctionReference(
    "evidenceArtifacts:updateEvidenceSourceStatus",
) as unknown as InternalMutationRef;

const retrieveAndNormalizeSecSourceRef = makeFunctionReference(
    "evidenceActions:retrieveAndNormalizeSecSource",
) as unknown as InternalActionRef;

const retrieveAndNormalizeExaSourceRef = makeFunctionReference(
    "evidenceActions:retrieveAndNormalizeExaSource",
) as unknown as InternalActionRef;

const retrieveAndNormalizeManualSourceRef = makeFunctionReference(
    "evidenceActions:retrieveAndNormalizeManualSource",
) as unknown as InternalActionRef;

const generateClaimsForRunRef = makeFunctionReference(
    "claimGeneration:generateClaimsForRun",
) as unknown as InternalMutationRef;

const evaluatePolicyForRunRef = makeFunctionReference(
    "policyEvaluations:evaluatePolicyForRun",
) as unknown as InternalActionRef;

const pauseForClaimGenerationUnavailableRef = makeFunctionReference(
    "researchRuns:pauseForClaimGenerationUnavailable",
) as unknown as InternalMutationRef;

const failEvidenceExtractionRef = makeFunctionReference(
    "researchRuns:failEvidenceExtraction",
) as unknown as InternalMutationRef;

const evidenceReadyHandoffRef = makeFunctionReference(
    "evidenceWorkflow:evidenceReadyHandoff",
) as unknown as InternalMutationRef;

export const run = workflow
    .define({
        args: {
            runId: v.id("researchRuns"),
            executionGeneration: v.number(),
        },
        returns: v.null(),
    })
    .handler(async (step, args): Promise<null> => {
        const frozenSources = (await step.runQuery(listFrozenSourcesForRunRef, {
            runId: args.runId,
            executionGeneration: args.executionGeneration,
        })) as Array<{
            sourceId: Id<"sources">;
            corpusRevisionId: Id<"corpusRevisions">;
            acceptedDecisionId: Id<"sourceDecisions">;
            origin: "sec" | "exa" | "analyst_url";
            status: "queued" | "running" | "succeeded" | "partial" | "failed";
            sourceVersionId?: Id<"sourceVersions">;
        }>;

        // Phase 5 source retrieval fan-out via the shared production
        // dispatcher. Every queued/incomplete frozen row is an independent,
        // parallel branch so a slow, hung, or rejected first branch never
        // prevents the others from starting or terminalizing. Branches that
        // reject after the workflow manager's bounded retries are terminalized
        // by the dispatcher's exact-row idempotent failure handler, and the
        // aggregate gates claim work on every branch reaching terminal.
        const pending = frozenSources.filter(
            (item) =>
                item.status !== "succeeded" &&
                item.status !== "partial" &&
                item.status !== "failed",
        );

        const dispatch = (item: (typeof frozenSources)[number]) => ({
            runId: args.runId,
            corpusRevisionId: item.corpusRevisionId,
            sourceId: item.sourceId,
            acceptedDecisionId: item.acceptedDecisionId,
            executionGeneration: args.executionGeneration,
            origin: item.origin,
        });

        if (pending.length > 0) {
            await fanOutFrozenBranches(
                pending.map(dispatch),
                async (branch) => {
                    const { origin, ...actionArgs } = branch;
                    if (origin === "sec") {
                        await step.runAction(
                            retrieveAndNormalizeSecSourceRef,
                            actionArgs,
                        );
                    } else if (origin === "exa") {
                        await step.runAction(
                            retrieveAndNormalizeExaSourceRef,
                            actionArgs,
                        );
                    } else if (origin === "analyst_url") {
                        await step.runAction(
                            retrieveAndNormalizeManualSourceRef,
                            actionArgs,
                        );
                    } else {
                        // Unknown origin is an unexpected rejection: the
                        // dispatcher terminalizes exactly this branch.
                        throw new Error(
                            `Phase 5 evidence retrieval for unknown origin "${origin}"`,
                        );
                    }
                },
                async (branch, reason) => {
                    try {
                        await step.runMutation(updateEvidenceSourceStatusRef, {
                            runId: branch.runId,
                            corpusRevisionId: branch.corpusRevisionId,
                            sourceId: branch.sourceId,
                            acceptedDecisionId: branch.acceptedDecisionId,
                            executionGeneration: branch.executionGeneration,
                            status: "failed",
                            failureReason: reason,
                        });
                    } catch {
                        // Execution fence already rejected (cancelled/stale
                        // generation); the run's onComplete/cancel path owns
                        // terminal state.
                    }
                },
            );
        }

        // Phase 5 claim generation step
        const claimResult = await step.runMutation(generateClaimsForRunRef, {
            runId: args.runId,
            executionGeneration: args.executionGeneration,
        });

        if (claimResult.status === "unavailable") {
            // Acquisition limitation: zero committed passages / zero frozen
            // sources is an all-failed/zero-passages typed failed outcome with
            // no claim or policy work, not a claim-generation pause.
            if (
                claimResult.reason === "no_frozen_sources" ||
                claimResult.reason === "no_committed_passages"
            ) {
                await step.runMutation(failEvidenceExtractionRef, {
                    runId: args.runId,
                    expectedExecutionGeneration: args.executionGeneration,
                    failureCode: claimResult.reason,
                });
                return null;
            }
            // Capability pause: the deterministic claim adapter is not
            // authorized for this dossier's logical input yet.
            await step.runMutation(pauseForClaimGenerationUnavailableRef, {
                runId: args.runId,
                expectedExecutionGeneration: args.executionGeneration,
            });
            return null;
        }

        if (claimResult.status === "failed") {
            throw new Error(
                `Claim generation failed: ${claimResult.reason ?? "unknown"}`,
            );
        }

        // Task 7: Policy evaluation step after successful claim generation
        await step.runAction(evaluatePolicyForRunRef, {
            runId: args.runId,
            executionGeneration: args.executionGeneration,
        });

        // Task 8: strong evidence_ready handoff. Terminal source projections,
        // at least one committed reproducible passage, a terminal claim
        // pipeline, and at least one structurally valid claim gate the
        // transition to evidence_ready + idle.
        await step.runMutation(evidenceReadyHandoffRef, {
            runId: args.runId,
            executionGeneration: args.executionGeneration,
        });

        return null;
    });

export const evidenceReadyHandoff = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        executionGeneration: v.number(),
    },
    returns: v.union(
        v.object({ outcome: v.literal("handed_off") }),
        v.object({ outcome: v.literal("failed_no_valid_claims") }),
    ),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (
            run?.lifecycleState !== "extracting_evidence" ||
            run.executionStatus !== "running" ||
            run.executionGeneration !== args.executionGeneration
        ) {
            // Stale/cancelled/foreign generation can never hand off. The
            // compare-and-clear only ever clears this run's own handle.
            throw new Error(
                "Research execution cannot hand off evidence: run is not actively extracting this generation",
            );
        }
        if (!run.activeCorpusRevisionId) {
            throw new Error("Research run missing activeCorpusRevisionId");
        }
        const corpusRevisionId = run.activeCorpusRevisionId;
        const corpus = await ctx.db.get(corpusRevisionId);
        if (corpus?.status !== "approved") {
            throw new Error("Active corpus revision is not approved");
        }

        // Strong source predicate: every frozen branch is terminal.
        const limit = sourceCandidateLimit();
        const statuses = await ctx.db
            .query("evidenceSourceStatuses")
            .withIndex("by_run_and_execution_generation", (q) =>
                q
                    .eq("runId", run._id)
                    .eq("executionGeneration", args.executionGeneration),
            )
            .take(limit + 1);
        if (statuses.length === 0 || statuses.length > limit) {
            throw new Error(
                "Evidence source set is missing or exceeds configured candidate limit",
            );
        }
        let hasReproduciblePassage = false;
        for (const st of statuses) {
            if (st.status !== "succeeded" && st.status !== "partial") {
                if (st.status === "failed") {
                    continue;
                }
                throw new Error(
                    "Nonterminal source branch blocks evidence handoff",
                );
            }
            if (!st.sourceVersionId) {
                throw new Error(
                    "Terminal source is missing its committed source version",
                );
            }
            if (!hasReproduciblePassage) {
                const passages = await ctx.db
                    .query("sourcePassages")
                    .withIndex("by_source_version_and_order", (q) =>
                        q.eq(
                            "sourceVersionId",
                            st.sourceVersionId as Id<"sourceVersions">,
                        ),
                    )
                    .take(1);
                if (passages.length > 0) {
                    hasReproduciblePassage = true;
                }
            }
        }
        if (!hasReproduciblePassage) {
            // Zero reproducible passages is a typed failed/retryable outcome
            // with no claim or policy work, never an evidence_ready handoff.
            await applyEvidenceExtractionFailed(ctx, {
                runId: run._id,
                expectedExecutionGeneration: args.executionGeneration,
                failureCode: "no_committed_passages",
            });
            return { outcome: "failed_no_valid_claims" as const };
        }

        // Strong claim predicate: the claim pipeline committed for every
        // persisted claim, and at least one claim is structurally valid.
        const claims = await ctx.db
            .query("claims")
            .withIndex("by_run_and_corpus", (q) =>
                q.eq("runId", run._id).eq("corpusRevisionId", corpusRevisionId),
            )
            .take(MAX_CLAIMS_PER_RUN + 1);
        if (claims.length === 0) {
            await applyEvidenceExtractionFailed(ctx, {
                runId: run._id,
                expectedExecutionGeneration: args.executionGeneration,
                failureCode: "no_valid_claims",
            });
            return { outcome: "failed_no_valid_claims" as const };
        }
        const evaluations = await ctx.db
            .query("policyEvaluations")
            .withIndex("by_run_and_corpus_revision", (q) =>
                q.eq("runId", run._id).eq("corpusRevisionId", corpusRevisionId),
            )
            .take(MAX_CLAIMS_PER_RUN + 1);
        const evaluatedClaimIds = new Set(
            evaluations.map((evaluation) => evaluation.claimId),
        );
        if (!claims.every((claim) => evaluatedClaimIds.has(claim._id))) {
            throw new Error("Claim pipeline is not terminal; handoff blocked");
        }
        const hasStructurallyValidClaim = evaluations.some(
            (evaluation) => evaluation.structuralResult.status === "valid",
        );
        if (!hasStructurallyValidClaim) {
            await applyEvidenceExtractionFailed(ctx, {
                runId: run._id,
                expectedExecutionGeneration: args.executionGeneration,
                failureCode: "no_valid_claims",
            });
            return { outcome: "failed_no_valid_claims" as const };
        }

        // Strong success: only now transition to evidence_ready + idle and
        // compare-clear the active workflow handle.
        assertLifecycleTransition(
            "extracting_evidence",
            "evidence_ready",
            "idle",
        );
        const now = Date.now();
        await ctx.db.patch(run._id, {
            lifecycleState: "evidence_ready",
            executionStatus: "idle",
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: now,
        });
        const runningSteps = await ctx.db
            .query("workflowSteps")
            .withIndex("by_run_and_key", (q) => q.eq("runId", run._id))
            .take(65);
        for (const step of runningSteps) {
            if (step.state === "running") {
                await ctx.db.patch(step._id, {
                    state: "completed",
                    completedAt: now,
                    updatedAt: now,
                });
            }
        }
        for (const key of [
            "generate_claims",
            "evaluate_evidence_policy",
        ] as const) {
            const existing = await ctx.db
                .query("workflowSteps")
                .withIndex("by_run_and_key", (index) =>
                    index.eq("runId", run._id).eq("key", key),
                )
                .first();
            if (!existing) {
                await ctx.db.insert("workflowSteps", {
                    runId: run._id,
                    key,
                    state: "completed",
                    attempt: 1,
                    completedAt: now,
                    updatedAt: now,
                });
            }
        }
        const existingEvents = await ctx.db
            .query("runEvents")
            .withIndex("by_run_and_sequence", (index) =>
                index.eq("runId", run._id),
            )
            .take(65);
        const evidenceReadyAlreadyPersisted = existingEvents.some(
            (event) => event.type === "evidence_ready",
        );
        if (!evidenceReadyAlreadyPersisted) {
            await ctx.db.insert("runEvents", {
                runId: run._id,
                sequence: run.nextEventSequence + 1,
                type: "evidence_ready",
                lifecycleState: "evidence_ready",
                executionStatus: "idle",
                stepKey: "evaluate_evidence_policy",
                occurredAt: now,
            });
        }
        return { outcome: "handed_off" as const };
    },
});

export const clearActiveWorkflowHandleOnSuccess = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        workflowId: vWorkflowId,
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (run?.workflowId === args.workflowId) {
            await ctx.db.patch(run._id, {
                workflowId: undefined,
                updatedAt: Date.now(),
            });
        }
        return null;
    },
});

export const onComplete = internalMutation({
    args: {
        workflowId: vWorkflowId,
        result: vResultValidator,
        context: v.object({ runId: v.id("researchRuns") }),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        if (args.result.kind === "success") {
            await ctx.runMutation(clearActiveWorkflowHandleOnSuccessRef, {
                runId: args.context.runId,
                workflowId: args.workflowId,
            });
            return null;
        }
        const run = await ctx.db.get(args.context.runId);
        if (
            !run ||
            run.workflowId !== args.workflowId ||
            run.executionStatus === "completed" ||
            run.executionStatus === "cancelled" ||
            run.executionStatus === "failed"
        ) {
            return null;
        }
        const executionStatus =
            args.result.kind === "canceled" ? "cancelled" : "failed";
        const eventType =
            args.result.kind === "canceled" ? "run_cancelled" : "run_failed";
        const now = Date.now();
        await ctx.db.patch(run._id, {
            workflowId: undefined,
            executionStatus,
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: now,
        });
        const runningSteps = await ctx.db
            .query("workflowSteps")
            .withIndex("by_run_and_key", (query) => query.eq("runId", run._id))
            .take(65);
        if (runningSteps.length > 64) {
            throw new Error("Workflow step limit exceeded");
        }
        for (const step of runningSteps) {
            if (step.state === "running") {
                await ctx.db.patch(step._id, {
                    state: "failed",
                    completedAt: now,
                    updatedAt: now,
                });
            }
        }
        await ctx.db.insert("runEvents", {
            runId: run._id,
            sequence: run.nextEventSequence + 1,
            type: eventType,
            lifecycleState: run.lifecycleState,
            executionStatus,
            occurredAt: now,
        });
        return null;
    },
});
