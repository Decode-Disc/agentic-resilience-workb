import { sourcesEnvelopeValidator } from "@convex/domain/sourcesContracts";
import { executionError } from "@convex/execution/errors";
import {
    awaitResearchControl,
    recordResearchObservation,
} from "@convex/execution/researchControl";
import {
    type EventId,
    vResultValidator,
    vWorkflowId,
    type WorkflowCtx,
} from "@convex-dev/workflow";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { workflow } from "./workflow";

async function awaitSourcesHandoff(
    step: WorkflowCtx,
    args: {
        preparationId: Id<"sourceSelectionProposalRebuilds">;
        eventId: EventId;
        executionGeneration: number;
        checkpoint: () => Promise<number>;
    },
): Promise<null> {
    const terminal = await step.awaitEvent({
        id: args.eventId,
        validator: v.object({ missionId: v.id("agentMissions") }),
    });
    let executionGeneration = await args.checkpoint();
    while (true) {
        const pending = await step.runMutation(internal.sourcesMission.finish, {
            preparationId: args.preparationId,
            missionId: terminal.missionId,
            expectedGeneration: executionGeneration,
        });
        if (!pending) break;
        if (pending.eventId)
            await step.awaitEvent({
                id: pending.eventId,
                validator: v.null(),
            });
        executionGeneration = await args.checkpoint();
    }
    return null;
}

export const run = workflow
    .define({
        args: {
            runId: v.id("researchRuns"),
            executionGeneration: v.number(),
            prepareSources: v.optional(v.boolean()),
            sourcesEnvelope: v.optional(sourcesEnvelopeValidator),
            controlled: v.optional(v.boolean()),
            reattachSources: v.optional(
                v.object({
                    preparationId: v.id("sourceSelectionProposalRebuilds"),
                }),
            ),
        },
        returns: v.null(),
    })
    .handler(async (step, args): Promise<null> => {
        let executionGeneration = args.executionGeneration;
        const checkpoint = async () => {
            if (args.controlled)
                executionGeneration = await awaitResearchControl(
                    step,
                    args.runId,
                );
            return executionGeneration;
        };
        if (args.reattachSources) {
            const reattached = await step.runMutation(
                internal.sourcesMission.reattach,
                {
                    preparationId: args.reattachSources.preparationId,
                    workflowId: step.workflowId,
                },
            );
            return awaitSourcesHandoff(step, {
                preparationId: args.reattachSources.preparationId,
                eventId: reattached.eventId,
                executionGeneration,
                checkpoint,
            });
        }
        const envelope = args.sourcesEnvelope;
        if (!envelope)
            throw executionError("sources_configuration_unavailable");
        await checkpoint();
        const availability = await step.runAction(
            internal.companyResolution.revalidateRun,
            {
                runId: args.runId,
            },
            { retry: false },
        );
        await checkpoint();
        await step.runMutation(internal.researchRuns.transition, {
            runId: args.runId,
            expectedExecutionGeneration: executionGeneration,
            lifecycleState: "checking_public_evidence",
            executionStatus: "running",
            stepKey: "check_public_evidence",
        });
        await step.runMutation(internal.researchRuns.transition, {
            runId: args.runId,
            expectedExecutionGeneration: executionGeneration,
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            stepKey: "prepare_sources",
        });
        await step.runMutation(internal.researchPlanning.createForRun, {
            runId: args.runId,
            expectedExecutionGeneration: executionGeneration,
        });
        await checkpoint();
        await step.runAction(
            internal.sourceDiscoveryActions.discoverForRun,
            {
                runId: args.runId,
                cik: availability.cik,
                filings: availability.filings,
                skipWeb: true,
            },
            { retry: false },
        );
        const run = await step.runQuery(internal.researchRuns.get, {
            runId: args.runId,
        });
        if (!run?.activeCorpusRevisionId)
            throw new Error("Draft corpus revision not found");
        const preparationId = await step.runMutation(
            internal.sourcesMission.claim,
            {
                runId: args.runId,
                corpusRevisionId: run.activeCorpusRevisionId,
                expectedGeneration: executionGeneration,
                envelope,
            },
        );
        await checkpoint();
        const started = await step.runMutation(internal.sourcesMission.start, {
            preparationId,
            expectedGeneration: executionGeneration,
            workflowId: step.workflowId,
        });
        return awaitSourcesHandoff(step, {
            preparationId,
            eventId: started.eventId,
            executionGeneration,
            checkpoint,
        });
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
            await ctx.runMutation(
                internal.researchWorkflow.clearActiveWorkflowHandleOnSuccess,
                { runId: args.context.runId, workflowId: args.workflowId },
            );
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
        await recordResearchObservation(ctx, run._id, eventType);
        return null;
    },
});
