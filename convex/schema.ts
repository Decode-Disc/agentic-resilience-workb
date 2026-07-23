import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

import {
    auditActorValidator,
    auditEventActionValidator,
    executionStatusValidator,
    invitationStatusValidator,
    researchRunLifecycleValidator,
    runEventTypeValidator,
    visitorRoleValidator,
    workflowStepKeyValidator,
    workflowStepStateValidator,
} from './domain/validators';

export default defineSchema({
    ...authTables,
    invitations: defineTable({
        slotKey: v.string(),
        role: visitorRoleValidator,
        codeDigest: v.string(),
        status: invitationStatusValidator,
        claimedByVisitorId: v.optional(v.id('visitors')),
        claimedAt: v.optional(v.number()),
        revokedAt: v.optional(v.number()),
        createdAt: v.number(),
    })
        .index('by_slot_key', ['slotKey'])
        .index('by_code_digest', ['codeDigest']),
    visitors: defineTable({
        authUserId: v.id('users'),
        invitationId: v.id('invitations'),
        role: visitorRoleValidator,
        status: v.union(v.literal('active'), v.literal('revoked')),
        analysesReserved: v.number(),
        admittedAt: v.number(),
        revokedAt: v.optional(v.number()),
    })
        .index('by_auth_user_id', ['authUserId'])
        .index('by_invitation_id', ['invitationId']),
    researchRuns: defineTable({
        ownerVisitorId: v.optional(v.id('visitors')),
        reservationKey: v.optional(v.string()),
        reservationStatus: v.optional(
            v.union(v.literal('consumed'), v.literal('restored')),
        ),
        quotaRestoredAt: v.optional(v.number()),
        lifecycleState: researchRunLifecycleValidator,
        executionStatus: executionStatusValidator,
        pauseReason: v.optional(
            v.union(v.literal('source_review'), v.literal('assessment_review')),
        ),
        nextEventSequence: v.number(),
        workflowId: v.optional(v.string()),
        workflowVersion: v.optional(v.number()),
        retryCount: v.optional(v.number()),
        createdAt: v.number(),
        updatedAt: v.number(),
    }).index('by_owner_and_reservation_key', [
        'ownerVisitorId',
        'reservationKey',
    ]),
    workflowSteps: defineTable({
        runId: v.id('researchRuns'),
        key: workflowStepKeyValidator,
        state: workflowStepStateValidator,
        attempt: v.number(),
        startedAt: v.optional(v.number()),
        completedAt: v.optional(v.number()),
        updatedAt: v.number(),
    }).index('by_run_and_key', ['runId', 'key']),
    runEvents: defineTable({
        runId: v.id('researchRuns'),
        sequence: v.number(),
        type: runEventTypeValidator,
        lifecycleState: researchRunLifecycleValidator,
        executionStatus: executionStatusValidator,
        stepKey: v.optional(workflowStepKeyValidator),
        occurredAt: v.number(),
    }).index('by_run_and_sequence', ['runId', 'sequence']),
    auditEvents: defineTable({
        actor: auditActorValidator,
        action: auditEventActionValidator,
        targetType: v.string(),
        targetId: v.string(),
        reason: v.optional(v.string()),
        occurredAt: v.number(),
    }).index('by_target', ['targetType', 'targetId']),
    checkpointDecisions: defineTable({
        runId: v.id('researchRuns'),
        checkpoint: v.union(
            v.literal('source_review'),
            v.literal('assessment_review'),
        ),
        decisionKey: v.string(),
        reviewerVisitorId: v.id('visitors'),
        decision: v.literal('approved'),
        occurredAt: v.number(),
    })
        .index('by_run_and_checkpoint', ['runId', 'checkpoint'])
        .index('by_run_and_decision_key', ['runId', 'decisionKey']),
});
