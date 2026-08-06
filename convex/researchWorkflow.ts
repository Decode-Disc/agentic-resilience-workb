import { vResultValidator, vWorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import {
    corpusRevisionApproved,
    evidenceSufficiencyDecided,
    workflow,
} from "./workflow";

export const run = workflow
    .define({
        args: {
            runId: v.id("researchRuns"),
            executionGeneration: v.number(),
        },
        returns: v.null(),
    })
    .handler(async (step, args): Promise<null> => {
        let executionGeneration = args.executionGeneration;
        const availability = await step.runAction(
            internal.companyResolution.revalidateRun,
            {
                runId: args.runId,
            },
            { retry: false },
        );
        await step.runMutation(internal.researchRuns.transition, {
            runId: args.runId,
            expectedExecutionGeneration: executionGeneration,
            lifecycleState: "checking_public_evidence",
            executionStatus: "running",
            stepKey: "check_public_evidence",
        });
        while (true) {
            const evaluation = await step.runMutation(
                internal.evidenceSufficiency.evaluateForRun,
                {
                    runId: args.runId,
                    expectedExecutionGeneration: executionGeneration,
                    secFilingCount: availability.secFilingCount,
                    investorRelationsPresent:
                        availability.investorRelationsPresent,
                },
            );
            if (evaluation.outcome === "sufficient") {
                await step.runMutation(internal.researchRuns.transition, {
                    runId: args.runId,
                    expectedExecutionGeneration: executionGeneration,
                    lifecycleState: "discovering_sources",
                    executionStatus: "running",
                    stepKey: "discover_sources",
                });
                await step.runMutation(internal.researchPlanning.createForRun, {
                    runId: args.runId,
                    expectedExecutionGeneration: executionGeneration,
                });
                await step.runAction(
                    internal.sourceDiscoveryActions.discoverForRun,
                    {
                        runId: args.runId,
                        cik: availability.cik,
                        filings: availability.filings,
                    },
                    { retry: false },
                );
                break;
            }
            await step.runMutation(internal.researchRuns.transition, {
                runId: args.runId,
                expectedExecutionGeneration: executionGeneration,
                lifecycleState: "awaiting_evidence_sufficiency_review",
                executionStatus: "paused",
                stepKey: "evidence_sufficiency_review",
            });
            const decision = await step.awaitEvent(evidenceSufficiencyDecided);
            executionGeneration = decision.executionGeneration;
            if (decision.kind === "complete_insufficient") {
                await step.runMutation(
                    internal.evidenceSufficiency.completeInsufficient,
                    {
                        runId: args.runId,
                        expectedExecutionGeneration: executionGeneration,
                    },
                );
                return null;
            }
            if (decision.kind === "force_continue") {
                await step.runMutation(internal.researchRuns.transition, {
                    runId: args.runId,
                    expectedExecutionGeneration: executionGeneration,
                    lifecycleState: "discovering_sources",
                    executionStatus: "running",
                    stepKey: "discover_sources",
                });
                await step.runMutation(internal.researchPlanning.createForRun, {
                    runId: args.runId,
                    expectedExecutionGeneration: executionGeneration,
                });
                await step.runAction(
                    internal.sourceDiscoveryActions.discoverForRun,
                    {
                        runId: args.runId,
                        cik: availability.cik,
                        filings: availability.filings,
                    },
                    { retry: false },
                );
                break;
            }
            await step.runMutation(internal.researchRuns.transition, {
                runId: args.runId,
                expectedExecutionGeneration: executionGeneration,
                lifecycleState: "checking_public_evidence",
                executionStatus: "running",
                stepKey: "check_public_evidence",
            });
        }
        await step.runMutation(internal.researchRuns.transition, {
            runId: args.runId,
            expectedExecutionGeneration: executionGeneration,
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            stepKey: "source_review",
        });
        const approval = await step.awaitEvent(corpusRevisionApproved);
        executionGeneration = approval.executionGeneration;
        await step.runMutation(internal.sources.verifyApprovedHandoff, {
            runId: args.runId,
            corpusRevisionId: approval.corpusRevisionId,
            expectedExecutionGeneration: executionGeneration,
        });
        await step.runMutation(internal.researchRuns.transition, {
            runId: args.runId,
            expectedExecutionGeneration: executionGeneration,
            lifecycleState: "corpus_approved",
            executionStatus: "idle",
            stepKey: "source_review",
        });
        return null;
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
            executionStatus,
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: now,
        });
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
