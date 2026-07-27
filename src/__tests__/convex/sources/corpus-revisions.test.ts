import type { Id } from '@convex/_generated/dataModel';
import schema from '@convex/schema';
import { makeFunctionReference } from 'convex/server';
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';

const modules = import.meta.glob('/convex/**/*.ts');
const listForReview = makeFunctionReference<
    'query',
    {
        runId: Id<'researchRuns'>;
        corpusRevisionId: Id<'corpusRevisions'>;
    },
    unknown
>('sources:listForReview');
const decideSource = makeFunctionReference<
    'mutation',
    {
        runId: Id<'researchRuns'>;
        corpusRevisionId: Id<'corpusRevisions'>;
        sourceId: Id<'sources'>;
        decision: 'accepted' | 'rejected' | 'pending';
        decisionKey: string;
        reason?: string;
    },
    { accepted: boolean }
>('sources:decide');
const addManualUrl = makeFunctionReference<
    'action',
    {
        runId: Id<'researchRuns'>;
        corpusRevisionId: Id<'corpusRevisions'>;
        url: string;
    },
    { sourceId: Id<'sources'> }
>('sourceActions:addManualUrl');
const approveCorpus = makeFunctionReference<
    'mutation',
    {
        runId: Id<'researchRuns'>;
        corpusRevisionId: Id<'corpusRevisions'>;
        decisionKey: string;
    },
    { accepted: boolean }
>('sources:approveCorpusRevision');

async function createSourceReviewFixture(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
        const userId = await ctx.db.insert('users', { isAnonymous: true });
        const otherUserId = await ctx.db.insert('users', {
            isAnonymous: true,
        });
        const invitationId = await ctx.db.insert('invitations', {
            slotKey: 'analyst-1',
            role: 'analyst',
            codeDigest: 'source-review-digest',
            status: 'claimed',
            createdAt: 1,
        });
        const otherInvitationId = await ctx.db.insert('invitations', {
            slotKey: 'analyst-2',
            role: 'analyst',
            codeDigest: 'other-source-review-digest',
            status: 'claimed',
            createdAt: 1,
        });
        const visitorId = await ctx.db.insert('visitors', {
            authUserId: userId,
            invitationId,
            role: 'analyst',
            status: 'active',
            analysesReserved: 1,
            admittedAt: 1,
        });
        await ctx.db.insert('visitors', {
            authUserId: otherUserId,
            invitationId: otherInvitationId,
            role: 'analyst',
            status: 'active',
            analysesReserved: 0,
            admittedAt: 1,
        });
        const runId = await ctx.db.insert('researchRuns', {
            ownerVisitorId: visitorId,
            lifecycleState: 'awaiting_source_review',
            executionStatus: 'paused',
            pauseReason: 'source_review',
            executionGeneration: 1,
            workflowId: 'paused-workflow',
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 1,
        });
        const corpusRevisionId = await ctx.db.insert('corpusRevisions', {
            runId,
            revision: 1,
            status: 'draft',
            createdAt: 1,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });
        const sourceId = await ctx.db.insert('sources', {
            runId,
            canonicalUrl: 'https://example.com/report',
            title: 'Public report',
            origin: 'exa',
            category: 'independent_analysis',
            createdAt: 1,
        });
        await ctx.db.insert('sourceDecisions', {
            runId,
            corpusRevisionId,
            sourceId,
            decisionKey: 'initial-pending',
            decision: 'pending',
            occurredAt: 1,
        });
        return {
            userId,
            otherUserId,
            runId,
            corpusRevisionId,
            sourceId,
        };
    });
}

test('owner appends source decisions while other visitors are rejected', async () => {
    const t = convexTest(schema, modules);
    const fixture = await createSourceReviewFixture(t);
    const owner = t.withIdentity({
        subject: `${fixture.userId}|source-owner`,
    });
    const other = t.withIdentity({
        subject: `${fixture.otherUserId}|source-other`,
    });

    await expect(
        other.query(listForReview, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
        }),
    ).rejects.toThrow('Unauthorized');
    await expect(
        owner.mutation(decideSource, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            sourceId: fixture.sourceId,
            decision: 'accepted',
            decisionKey: 'accept-report',
        }),
    ).resolves.toEqual({ accepted: true });
    await expect(
        owner.query(listForReview, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
        }),
    ).resolves.toMatchObject({
        counts: { accepted: 1, rejected: 0, pending: 0 },
        sources: [
            {
                sourceId: fixture.sourceId,
                decision: 'accepted',
            },
        ],
    });
});

test('rejects manual URL intake before network access for a non-owner', async () => {
    const t = convexTest(schema, modules);
    const fixture = await createSourceReviewFixture(t);
    const other = t.withIdentity({
        subject: `${fixture.otherUserId}|source-other`,
    });

    await expect(
        other.action(addManualUrl, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            url: 'https://127.0.0.1/private',
        }),
    ).rejects.toThrow('Unauthorized');
});

test('does not resume source review while another owner run is running', async () => {
    const t = convexTest(schema, modules);
    const fixture = await createSourceReviewFixture(t);
    const owner = t.withIdentity({
        subject: `${fixture.userId}|source-owner`,
    });

    await owner.mutation(decideSource, {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        sourceId: fixture.sourceId,
        decision: 'accepted',
        decisionKey: 'accept-before-conflict',
    });
    await t.run(async (ctx) => {
        const paused = await ctx.db.get(fixture.runId);
        if (!paused?.ownerVisitorId) {
            throw new Error('Fixture owner was not found');
        }
        await ctx.db.insert('researchRuns', {
            ownerVisitorId: paused.ownerVisitorId,
            lifecycleState: 'discovering_sources',
            executionStatus: 'running',
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 2,
            updatedAt: 2,
        });
    });

    await expect(
        owner.mutation(approveCorpus, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            decisionKey: 'approve-with-conflict',
        }),
    ).rejects.toThrow('already running');
    await expect(
        t.run((ctx) => ctx.db.get(fixture.corpusRevisionId)),
    ).resolves.toMatchObject({ status: 'draft' });
});
