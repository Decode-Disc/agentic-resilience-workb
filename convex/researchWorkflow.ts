import { vResultValidator, vWorkflowId } from '@convex-dev/workflow';
import { v } from 'convex/values';

import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';
import {
    assessmentReviewApproved,
    sourceReviewApproved,
    workflow,
} from './workflow';

export const run = workflow
    .define({ args: { runId: v.id('researchRuns') }, returns: v.null() })
    .handler(async (step, args): Promise<null> => {
        await step.runMutation(internal.researchRuns.transition, {
            runId: args.runId,
            lifecycleState: 'discovering_sources',
            executionStatus: 'running',
            stepKey: 'resolve_company',
        });
        await step.runMutation(internal.researchRuns.transition, {
            runId: args.runId,
            lifecycleState: 'awaiting_source_review',
            executionStatus: 'paused',
            stepKey: 'source_review',
        });
        await step.awaitEvent(sourceReviewApproved);
        await step.runMutation(internal.researchRuns.transition, {
            runId: args.runId,
            lifecycleState: 'extracting_evidence',
            executionStatus: 'running',
            stepKey: 'extract_evidence',
        });
        await step.runMutation(internal.researchRuns.transition, {
            runId: args.runId,
            lifecycleState: 'assessing_dimensions',
            executionStatus: 'running',
            stepKey: 'assess_dimensions',
        });
        await step.runMutation(internal.researchRuns.transition, {
            runId: args.runId,
            lifecycleState: 'awaiting_assessment_review',
            executionStatus: 'paused',
            stepKey: 'assessment_review',
        });
        await step.awaitEvent(assessmentReviewApproved);
        await step.runMutation(internal.researchRuns.transition, {
            runId: args.runId,
            lifecycleState: 'completed',
            executionStatus: 'completed',
            stepKey: 'generate_derived_views',
        });
        return null;
    });

export const onComplete = internalMutation({
    args: {
        workflowId: vWorkflowId,
        result: vResultValidator,
        context: v.object({ runId: v.id('researchRuns') }),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        if (args.result.kind === 'success') {
            return null;
        }
        const run = await ctx.db.get(args.context.runId);
        if (
            !run ||
            run.executionStatus === 'completed' ||
            run.executionStatus === 'cancelled'
        ) {
            return null;
        }
        const executionStatus =
            args.result.kind === 'canceled' ? 'cancelled' : 'failed';
        const eventType =
            args.result.kind === 'canceled' ? 'run_cancelled' : 'run_failed';
        const now = Date.now();
        await ctx.db.patch(run._id, {
            executionStatus,
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: now,
        });
        await ctx.db.insert('runEvents', {
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
