import { defineEvent, WorkflowManager } from '@convex-dev/workflow';
import { v } from 'convex/values';

import { components } from './_generated/api';

export const workflow = new WorkflowManager(components.workflow, {
    workpoolOptions: {
        defaultRetryBehavior: {
            maxAttempts: 3,
            initialBackoffMs: 100,
            base: 2,
        },
        retryActionsByDefault: true,
    },
});

const checkpointDecisionValidator = v.object({
    decisionId: v.id('checkpointDecisions'),
});

export const sourceReviewApproved = defineEvent({
    name: 'sourceReviewApproved',
    validator: checkpointDecisionValidator,
});

export const corpusRevisionApproved = defineEvent({
    name: 'corpusRevisionApproved',
    validator: v.object({
        decisionId: v.id('checkpointDecisions'),
        corpusRevisionId: v.id('corpusRevisions'),
    }),
});

export const assessmentReviewApproved = defineEvent({
    name: 'assessmentReviewApproved',
    validator: checkpointDecisionValidator,
});

export const evidenceSufficiencyDecided = defineEvent({
    name: 'evidenceSufficiencyDecided',
    validator: v.union(
        v.object({
            kind: v.literal('recheck'),
            decisionId: v.id('checkpointDecisions'),
        }),
        v.object({
            kind: v.literal('force_continue'),
            decisionId: v.id('checkpointDecisions'),
        }),
        v.object({
            kind: v.literal('complete_insufficient'),
            decisionId: v.id('checkpointDecisions'),
        }),
    ),
});
