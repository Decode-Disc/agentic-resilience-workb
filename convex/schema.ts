import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

import {
    auditActorValidator,
    auditEventActionValidator,
    companySnapshotValidator,
    coveragePresetValidator,
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
    invitationClaimRateLimits: defineTable({
        key: v.string(),
        attempts: v.number(),
        windowStartedAt: v.number(),
        updatedAt: v.number(),
    }).index('by_key', ['key']),
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
    companies: defineTable({
        cik: v.string(),
        legalName: v.string(),
        ticker: v.string(),
        exchange: v.string(),
        investorRelationsUrl: v.optional(v.string()),
        canonicalizedAt: v.number(),
    }).index('by_cik', ['cik']),
    companyPreflights: defineTable({
        ownerAuthUserId: v.optional(v.id('users')),
        ownerVisitorId: v.optional(v.id('visitors')),
        query: v.string(),
        companyId: v.id('companies'),
        companySnapshot: v.optional(companySnapshotValidator),
        resolverVersion: v.string(),
        status: v.union(v.literal('resolved'), v.literal('consumed')),
        expiresAt: v.number(),
        createdAt: v.number(),
    })
        .index('by_owner_auth_user_and_status', ['ownerAuthUserId', 'status'])
        .index('by_owner_and_status', ['ownerVisitorId', 'status']),
    researchRuns: defineTable({
        ownerVisitorId: v.optional(v.id('visitors')),
        reservationKey: v.optional(v.string()),
        reservationStatus: v.optional(
            v.union(v.literal('consumed'), v.literal('restored')),
        ),
        quotaRestoredAt: v.optional(v.number()),
        companyId: v.optional(v.id('companies')),
        companySnapshot: v.optional(companySnapshotValidator),
        companyPreflightId: v.optional(v.id('companyPreflights')),
        coveragePreset: v.optional(coveragePresetValidator),
        researchAngle: v.optional(v.string()),
        activeCorpusRevisionId: v.optional(v.id('corpusRevisions')),
        completionOutcome: v.optional(
            v.union(
                v.literal('completed_assessment'),
                v.literal('insufficient_public_evidence'),
            ),
        ),
        executionGeneration: v.number(),
        lifecycleState: researchRunLifecycleValidator,
        executionStatus: executionStatusValidator,
        pauseReason: v.optional(
            v.union(
                v.literal('evidence_sufficiency_review'),
                v.literal('source_review'),
                v.literal('assessment_review'),
            ),
        ),
        nextEventSequence: v.number(),
        workflowId: v.optional(v.string()),
        workflowVersion: v.optional(v.number()),
        retryCount: v.optional(v.number()),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index('by_owner_and_reservation_key', [
            'ownerVisitorId',
            'reservationKey',
        ])
        .index('by_owner_and_execution_status', [
            'ownerVisitorId',
            'executionStatus',
        ]),
    evidenceAvailabilityEvaluations: defineTable({
        runId: v.id('researchRuns'),
        policyVersion: v.string(),
        secFilingCount: v.number(),
        investorRelationsPresent: v.boolean(),
        manualCandidateCount: v.number(),
        outcome: v.union(v.literal('sufficient'), v.literal('insufficient')),
        reasons: v.array(v.string()),
        createdAt: v.number(),
    }).index('by_run', ['runId']),
    researchPlans: defineTable({
        runId: v.id('researchRuns'),
        version: v.number(),
        coveragePreset: coveragePresetValidator,
        researchAngle: v.optional(v.string()),
        queries: v.array(
            v.object({
                query: v.string(),
                category: v.string(),
                dimensionKeys: v.array(v.string()),
            }),
        ),
        createdAt: v.number(),
    }).index('by_run_and_version', ['runId', 'version']),
    sources: defineTable({
        runId: v.id('researchRuns'),
        canonicalUrl: v.string(),
        title: v.string(),
        origin: v.union(
            v.literal('sec'),
            v.literal('exa'),
            v.literal('analyst_url'),
        ),
        category: v.string(),
        publishedAt: v.optional(v.number()),
        providerReference: v.optional(v.string()),
        createdAt: v.number(),
    }).index('by_run_and_url', ['runId', 'canonicalUrl']),
    corpusRevisions: defineTable({
        runId: v.id('researchRuns'),
        revision: v.number(),
        status: v.union(v.literal('draft'), v.literal('approved')),
        approvedByVisitorId: v.optional(v.id('visitors')),
        approvedAt: v.optional(v.number()),
        createdAt: v.number(),
    }).index('by_run_and_revision', ['runId', 'revision']),
    sourceDecisions: defineTable({
        runId: v.id('researchRuns'),
        corpusRevisionId: v.id('corpusRevisions'),
        sourceId: v.id('sources'),
        decisionKey: v.string(),
        decision: v.union(
            v.literal('accepted'),
            v.literal('rejected'),
            v.literal('pending'),
        ),
        reviewerVisitorId: v.optional(v.id('visitors')),
        supersedesDecisionId: v.optional(v.id('sourceDecisions')),
        reason: v.optional(v.string()),
        occurredAt: v.number(),
    })
        .index('by_revision_and_source', ['corpusRevisionId', 'sourceId'])
        .index('by_run_and_decision_key', ['runId', 'decisionKey']),
    providerCalls: defineTable({
        runId: v.optional(v.id('researchRuns')),
        corpusRevisionId: v.optional(v.id('corpusRevisions')),
        executionGeneration: v.optional(v.number()),
        workflowVersion: v.optional(v.number()),
        stepKey: v.optional(v.string()),
        service: v.union(
            v.literal('sec'),
            v.literal('exa'),
            v.literal('url_metadata'),
        ),
        operation: v.string(),
        operationKey: v.string(),
        status: v.union(
            v.literal('started'),
            v.literal('succeeded'),
            v.literal('failed'),
        ),
        attempt: v.number(),
        latencyMs: v.optional(v.number()),
        usage: v.optional(v.any()),
        reportedCost: v.optional(v.number()),
        errorCode: v.optional(v.string()),
        createdAt: v.number(),
        completedAt: v.optional(v.number()),
    }).index('by_operation_key', ['operationKey']),
    providerRateLimits: defineTable({
        provider: v.literal('sec'),
        nextAllowedAt: v.number(),
    }).index('by_provider', ['provider']),
    paidWorkControls: defineTable({
        key: v.literal('global'),
        enabled: v.boolean(),
        updatedByVisitorId: v.optional(v.id('visitors')),
        reason: v.optional(v.string()),
        updatedAt: v.number(),
    }).index('by_key', ['key']),
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
        messageKey: v.optional(v.string()),
        current: v.optional(v.number()),
        total: v.optional(v.number()),
        failureCode: v.optional(v.string()),
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
            v.literal('evidence_sufficiency_review'),
            v.literal('source_review'),
            v.literal('assessment_review'),
        ),
        decisionKey: v.string(),
        reviewerVisitorId: v.id('visitors'),
        decision: v.union(
            v.literal('approved'),
            v.literal('recheck'),
            v.literal('force_continue'),
            v.literal('complete_insufficient'),
        ),
        reason: v.optional(v.string()),
        occurredAt: v.number(),
    })
        .index('by_run_and_checkpoint', ['runId', 'checkpoint'])
        .index('by_run_and_decision_key', ['runId', 'decisionKey']),
});
