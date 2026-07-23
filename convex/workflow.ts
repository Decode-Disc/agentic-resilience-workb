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

export const assessmentReviewApproved = defineEvent({
    name: 'assessmentReviewApproved',
    validator: checkpointDecisionValidator,
});
