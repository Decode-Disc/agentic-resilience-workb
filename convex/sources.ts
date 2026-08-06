import { getAuthUserId } from '@convex-dev/auth/server';
import type { WorkflowId } from '@convex-dev/workflow';
import {
    paginationOptsValidator,
    paginationResultValidator,
} from 'convex/server';
import { v } from 'convex/values';

import type { Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import {
    internalMutation,
    internalQuery,
    mutation,
    query,
} from './_generated/server';
import { upsertSourceReviewItem } from './domain/sourceReviewProjection';
import {
    assertSourceCandidateRequestFits,
    readSourceCandidateCapacity,
} from './domain/sourceCandidateCapacity';
import { sourceCandidateLimit } from './resourceLimits';
import { corpusRevisionApproved, workflow } from './workflow';

const sourceReviewDecisionValidator = v.union(
    v.literal('accepted'),
    v.literal('rejected'),
    v.literal('pending'),
);

const sourceReviewFilterValidator = v.union(
    v.literal('all'),
    sourceReviewDecisionValidator,
);

const sourceReviewSourceValidator = v.object({
    sourceId: v.id('sources'),
    canonicalUrl: v.string(),
    title: v.string(),
    origin: v.union(
        v.literal('sec'),
        v.literal('exa'),
        v.literal('analyst_url'),
    ),
    category: v.string(),
    publishedAt: v.optional(v.number()),
    decision: sourceReviewDecisionValidator,
    reason: v.optional(v.string()),
});

async function authorizeReviewRead(
    ctx: QueryCtx,
    args: {
        runId: Id<'researchRuns'>;
        corpusRevisionId: Id<'corpusRevisions'>;
    },
) {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) {
        throw new Error('Not authenticated');
    }
    const visitor = await ctx.db
        .query('visitors')
        .withIndex('by_auth_user_id', (builder) =>
            builder.eq('authUserId', authUserId),
        )
        .unique();
    const run = await ctx.db.get(args.runId);
    const revision = await ctx.db.get(args.corpusRevisionId);
    if (
        visitor?.status !== 'active' ||
        run?.ownerVisitorId !== visitor._id ||
        revision?.runId !== run._id
    ) {
        throw new Error('Unauthorized');
    }
    return { revision };
}

export const getReviewSummary = query({
    args: {
        runId: v.id('researchRuns'),
        corpusRevisionId: v.id('corpusRevisions'),
    },
    returns: v.object({
        revision: v.number(),
        status: v.union(v.literal('draft'), v.literal('approved')),
        counts: v.object({
            accepted: v.number(),
            rejected: v.number(),
            pending: v.number(),
        }),
        total: v.number(),
        candidateLimit: v.number(),
    }),
    handler: async (ctx, args) => {
        const { revision } = await authorizeReviewRead(ctx, args);
        const candidateLimit = sourceCandidateLimit();
        const count = async (
            decision: 'accepted' | 'rejected' | 'pending',
        ) => {
            const items = await ctx.db
                .query('sourceReviewItems')
                .withIndex('by_revision_decision_and_order', (builder) =>
                    builder
                        .eq('corpusRevisionId', revision._id)
                        .eq('decision', decision),
                )
                .take(candidateLimit + 1);
            if (items.length > candidateLimit) {
                throw new Error('Source review exceeds its candidate limit');
            }
            return items.length;
        };
        const [accepted, rejected, pending] = await Promise.all([
            count('accepted'),
            count('rejected'),
            count('pending'),
        ]);
        return {
            revision: revision.revision,
            status: revision.status,
            counts: { accepted, rejected, pending },
            total: accepted + rejected + pending,
            candidateLimit,
        };
    },
});

export const listForReviewPage = query({
    args: {
        runId: v.id('researchRuns'),
        corpusRevisionId: v.id('corpusRevisions'),
        filter: sourceReviewFilterValidator,
        paginationOpts: paginationOptsValidator,
    },
    returns: paginationResultValidator(sourceReviewSourceValidator),
    handler: async (ctx, args) => {
        const { revision } = await authorizeReviewRead(ctx, args);
        const decisionFilter =
            args.filter === 'all' ? null : args.filter;
        const paginated =
            decisionFilter === null
                ? await ctx.db
                      .query('sourceReviewItems')
                      .withIndex('by_revision_and_queue', (builder) =>
                          builder.eq('corpusRevisionId', revision._id),
                      )
                      .paginate(args.paginationOpts)
                : await ctx.db
                      .query('sourceReviewItems')
                      .withIndex(
                          'by_revision_decision_and_order',
                          (builder) =>
                              builder
                                  .eq('corpusRevisionId', revision._id)
                                  .eq('decision', decisionFilter),
                      )
                      .paginate(args.paginationOpts);
        const page = await Promise.all(
            paginated.page.map(async (item) => {
                const source = await ctx.db.get(item.sourceId);
                if (!source || source.runId !== args.runId) {
                    throw new Error('Source review projection is invalid');
                }
                return {
                    sourceId: source._id,
                    canonicalUrl: source.canonicalUrl,
                    title: source.title,
                    origin: source.origin,
                    category: source.category,
                    publishedAt: source.publishedAt,
                    decision: item.decision,
                    reason: item.reason,
                };
            }),
        );
        return { ...paginated, page };
    },
});

export const getReviewSource = query({
    args: {
        runId: v.id('researchRuns'),
        corpusRevisionId: v.id('corpusRevisions'),
        sourceId: v.id('sources'),
    },
    returns: v.union(sourceReviewSourceValidator, v.null()),
    handler: async (ctx, args) => {
        const { revision } = await authorizeReviewRead(ctx, args);
        const item = await ctx.db
            .query('sourceReviewItems')
            .withIndex('by_revision_and_source', (builder) =>
                builder
                    .eq('corpusRevisionId', revision._id)
                    .eq('sourceId', args.sourceId),
            )
            .unique();
        const source = await ctx.db.get(args.sourceId);
        if (!item || !source || source.runId !== args.runId) {
            return null;
        }
        return {
            sourceId: source._id,
            canonicalUrl: source.canonicalUrl,
            title: source.title,
            origin: source.origin,
            category: source.category,
            publishedAt: source.publishedAt,
            decision: item.decision,
            reason: item.reason,
        };
    },
});

export const decide = mutation({
    args: {
        runId: v.id('researchRuns'),
        corpusRevisionId: v.id('corpusRevisions'),
        sourceId: v.id('sources'),
        decision: sourceReviewDecisionValidator,
        decisionKey: v.string(),
        reason: v.optional(v.string()),
    },
    returns: v.object({ accepted: v.boolean() }),
    handler: async (ctx, args) => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            throw new Error('Not authenticated');
        }
        const visitor = await ctx.db
            .query('visitors')
            .withIndex('by_auth_user_id', (builder) =>
                builder.eq('authUserId', authUserId),
            )
            .unique();
        const run = await ctx.db.get(args.runId);
        const revision = await ctx.db.get(args.corpusRevisionId);
        const source = await ctx.db.get(args.sourceId);
        if (
            visitor?.status !== 'active' ||
            run?.ownerVisitorId !== visitor._id ||
            revision?.runId !== run._id ||
            source?.runId !== run._id
        ) {
            throw new Error('Unauthorized');
        }
        if (revision.status !== 'draft') {
            throw new Error('Approved corpus revisions are immutable');
        }
        const decisionKey = args.decisionKey.trim();
        if (decisionKey.length === 0 || decisionKey.length > 128) {
            throw new Error('Invalid decision key');
        }
        const existing = await ctx.db
            .query('sourceDecisions')
            .withIndex('by_run_and_decision_key', (builder) =>
                builder.eq('runId', run._id).eq('decisionKey', decisionKey),
            )
            .unique();
        if (existing) {
            if (
                existing.sourceId !== source._id ||
                existing.decision !== args.decision
            ) {
                throw new Error('Decision key belongs to another decision');
            }
            return { accepted: false };
        }
        const prior = await ctx.db
            .query('sourceDecisions')
            .withIndex('by_revision_source_and_occurred_at', (builder) =>
                builder
                    .eq('corpusRevisionId', revision._id)
                    .eq('sourceId', source._id),
            )
            .order('desc')
            .first();
        const now = Date.now();
        const decisionId = await ctx.db.insert('sourceDecisions', {
            runId: run._id,
            corpusRevisionId: revision._id,
            sourceId: source._id,
            decisionKey,
            decision: args.decision,
            reviewerVisitorId: visitor._id,
            supersedesDecisionId: prior?._id,
            reason: args.reason?.trim() || undefined,
            occurredAt: now,
        });
        await upsertSourceReviewItem(ctx, {
            runId: run._id,
            corpusRevisionId: revision._id,
            sourceId: source._id,
            decision: args.decision,
            sourceCreatedAt: source.createdAt,
            latestDecisionId: decisionId,
            decisionOccurredAt: now,
            reason: args.reason?.trim() || undefined,
        });
        await ctx.db.insert('auditEvents', {
            actor: { type: 'visitor', visitorId: visitor._id },
            action: 'source_decided',
            targetType: 'source',
            targetId: source._id,
            reason: args.reason?.trim() || undefined,
            occurredAt: now,
        });
        return { accepted: true };
    },
});

export const persistManualCandidate = internalMutation({
    args: {
        runId: v.id('researchRuns'),
        corpusRevisionId: v.id('corpusRevisions'),
        executionGeneration: v.number(),
        providerReference: v.string(),
        canonicalUrl: v.string(),
        title: v.string(),
    },
    returns: v.id('sources'),
    handler: async (ctx, args) => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            throw new Error('Not authenticated');
        }
        const visitor = await ctx.db
            .query('visitors')
            .withIndex('by_auth_user_id', (builder) =>
                builder.eq('authUserId', authUserId),
            )
            .unique();
        const run = await ctx.db.get(args.runId);
        const revision = await ctx.db.get(args.corpusRevisionId);
        if (
            visitor?.status !== 'active' ||
            run?.ownerVisitorId !== visitor._id ||
            revision?.runId !== run._id ||
            run.executionGeneration !== args.executionGeneration
        ) {
            throw new Error('Unauthorized');
        }
        if (
            revision.status !== 'draft' ||
            run.executionStatus !== 'paused' ||
            ![
                'awaiting_evidence_sufficiency_review',
                'awaiting_source_review',
            ].includes(run.lifecycleState)
        ) {
            throw new Error('Approved corpus revisions are immutable');
        }
        const capacity = await readSourceCandidateCapacity(ctx.db, run._id);
        assertSourceCandidateRequestFits(1, capacity.remaining);
        const duplicate = await ctx.db
            .query('sources')
            .withIndex('by_run_and_url', (builder) =>
                builder
                    .eq('runId', run._id)
                    .eq('canonicalUrl', args.canonicalUrl),
            )
            .unique();
        if (duplicate) {
            throw new Error('Source URL is already in this research run');
        }
        const now = Date.now();
        const sourceId = await ctx.db.insert('sources', {
            runId: run._id,
            canonicalUrl: args.canonicalUrl,
            title: args.title,
            origin: 'analyst_url',
            category: 'analyst_supplied',
            providerReference: args.providerReference,
            createdAt: now,
        });
        const decisionId = await ctx.db.insert('sourceDecisions', {
            runId: run._id,
            corpusRevisionId: revision._id,
            sourceId,
            decisionKey: `manual:${sourceId}`,
            decision: 'pending',
            reviewerVisitorId: visitor._id,
            occurredAt: now,
        });
        await upsertSourceReviewItem(ctx, {
            runId: run._id,
            corpusRevisionId: revision._id,
            sourceId,
            decision: 'pending',
            sourceCreatedAt: now,
            latestDecisionId: decisionId,
            decisionOccurredAt: now,
        });
        await ctx.db.insert('auditEvents', {
            actor: { type: 'visitor', visitorId: visitor._id },
            action: 'manual_source_added',
            targetType: 'source',
            targetId: sourceId,
            occurredAt: now,
        });
        return sourceId;
    },
});

export const authorizeManualCandidate = internalQuery({
    args: {
        runId: v.id('researchRuns'),
        corpusRevisionId: v.id('corpusRevisions'),
    },
    returns: v.object({
        executionGeneration: v.number(),
        stepKey: v.union(
            v.literal('evidence_sufficiency_review'),
            v.literal('source_review'),
        ),
    }),
    handler: async (ctx, args) => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            throw new Error('Not authenticated');
        }
        const visitor = await ctx.db
            .query('visitors')
            .withIndex('by_auth_user_id', (builder) =>
                builder.eq('authUserId', authUserId),
            )
            .unique();
        const run = await ctx.db.get(args.runId);
        const revision = await ctx.db.get(args.corpusRevisionId);
        if (
            visitor?.status !== 'active' ||
            run?.ownerVisitorId !== visitor._id ||
            revision?.runId !== run._id
        ) {
            throw new Error('Unauthorized');
        }
        if (
            revision.status !== 'draft' ||
            run.activeCorpusRevisionId !== revision._id ||
            run.executionStatus !== 'paused' ||
            ![
                'awaiting_evidence_sufficiency_review',
                'awaiting_source_review',
            ].includes(run.lifecycleState)
        ) {
            throw new Error('Research run is not accepting manual sources');
        }
        const capacity = await readSourceCandidateCapacity(ctx.db, run._id);
        assertSourceCandidateRequestFits(1, capacity.remaining);
        return {
            executionGeneration: run.executionGeneration,
            stepKey:
                run.lifecycleState === 'awaiting_evidence_sufficiency_review'
                    ? ('evidence_sufficiency_review' as const)
                    : ('source_review' as const),
        };
    },
});

export const findManualCandidateByProviderReference = internalQuery({
    args: {
        runId: v.id('researchRuns'),
        providerReference: v.string(),
    },
    returns: v.union(v.id('sources'), v.null()),
    handler: async (ctx, args) => {
        const sources = await ctx.db
            .query('sources')
            .withIndex('by_run_and_url', (builder) =>
                builder.eq('runId', args.runId),
            )
            .collect();
        return (
            sources.find(
                (source) =>
                    source.origin === 'analyst_url' &&
                    source.providerReference === args.providerReference,
            )?._id ?? null
        );
    },
});

export const verifyApprovedHandoff = internalMutation({
    args: {
        runId: v.id('researchRuns'),
        corpusRevisionId: v.id('corpusRevisions'),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        const revision = await ctx.db.get(args.corpusRevisionId);
        if (
            !run ||
            !revision ||
            run.activeCorpusRevisionId !== revision._id ||
            revision.status !== 'approved'
        ) {
            throw new Error('Approved corpus revision handoff is invalid');
        }
        return null;
    },
});

export const approveCorpusRevision = mutation({
    args: {
        runId: v.id('researchRuns'),
        corpusRevisionId: v.id('corpusRevisions'),
        decisionKey: v.string(),
    },
    returns: v.object({ accepted: v.boolean() }),
    handler: async (ctx, args) => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            throw new Error('Not authenticated');
        }
        const visitor = await ctx.db
            .query('visitors')
            .withIndex('by_auth_user_id', (builder) =>
                builder.eq('authUserId', authUserId),
            )
            .unique();
        const run = await ctx.db.get(args.runId);
        const revision = await ctx.db.get(args.corpusRevisionId);
        if (
            visitor?.status !== 'active' ||
            run?.ownerVisitorId !== visitor._id ||
            revision?.runId !== run._id
        ) {
            throw new Error('Unauthorized');
        }
        const decisionKey = args.decisionKey.trim();
        if (decisionKey.length === 0 || decisionKey.length > 128) {
            throw new Error('Invalid decision key');
        }
        const existing = await ctx.db
            .query('checkpointDecisions')
            .withIndex('by_run_and_decision_key', (builder) =>
                builder.eq('runId', run._id).eq('decisionKey', decisionKey),
            )
            .unique();
        if (existing) {
            return { accepted: false };
        }
        if (
            revision.status !== 'draft' ||
            run.activeCorpusRevisionId !== revision._id ||
            run.lifecycleState !== 'awaiting_source_review' ||
            run.executionStatus !== 'paused' ||
            run.pauseReason !== 'source_review' ||
            !run.workflowId
        ) {
            throw new Error('Corpus revision cannot be approved');
        }
        const accepted = await ctx.db
            .query('sourceReviewItems')
            .withIndex('by_revision_decision_and_order', (builder) =>
                builder
                    .eq('corpusRevisionId', revision._id)
                    .eq('decision', 'accepted'),
            )
            .first();
        if (!accepted) {
            throw new Error('At least one accepted source is required');
        }
        const concurrent = await ctx.db
            .query('researchRuns')
            .withIndex('by_owner_and_execution_status', (builder) =>
                builder
                    .eq('ownerVisitorId', visitor._id)
                    .eq('executionStatus', 'running'),
            )
            .first();
        if (concurrent) {
            throw new Error('A research workflow is already running');
        }
        const now = Date.now();
        await ctx.db.patch(run._id, {
            executionStatus: 'running',
            pauseReason: undefined,
            updatedAt: now,
        });
        await ctx.db.patch(revision._id, {
            status: 'approved',
            approvedByVisitorId: visitor._id,
            approvedAt: now,
        });
        const decisionId = await ctx.db.insert('checkpointDecisions', {
            runId: run._id,
            checkpoint: 'source_review',
            decisionKey,
            reviewerVisitorId: visitor._id,
            decision: 'approved',
            occurredAt: now,
        });
        await workflow.sendEvent(ctx, {
            ...corpusRevisionApproved,
            workflowId: run.workflowId as WorkflowId,
            value: {
                decisionId,
                corpusRevisionId: revision._id,
            },
        });
        await ctx.db.insert('auditEvents', {
            actor: { type: 'visitor', visitorId: visitor._id },
            action: 'corpus_revision_approved',
            targetType: 'corpus_revision',
            targetId: revision._id,
            occurredAt: now,
        });
        return { accepted: true };
    },
});
