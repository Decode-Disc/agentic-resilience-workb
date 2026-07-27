import type { Id } from '@convex/_generated/dataModel';
import schema from '@convex/schema';
import { makeFunctionReference } from 'convex/server';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import workflowTest from './workflow-test-register.js';

const modules = import.meta.glob('/convex/**/*.ts');
const reserve = makeFunctionReference<
    'mutation',
    { idempotencyKey: string },
    { runId: Id<'researchRuns'>; remainingAnalyses: number }
>('researchRuns:reserve');
const startReserved = makeFunctionReference<
    'mutation',
    { runId: Id<'researchRuns'> },
    string
>('workflowControls:startReserved');
const confirmAndStart = makeFunctionReference<
    'action',
    {
        preflightId: Id<'companyPreflights'>;
        idempotencyKey: string;
        coveragePreset: 'balanced';
    },
    { runId: Id<'researchRuns'>; remainingAnalyses: number }
>('researchLaunch:confirmAndStart');
const cancelRun = makeFunctionReference<
    'mutation',
    { runId: Id<'researchRuns'> },
    { cancelled: boolean }
>('workflowControls:cancel');
const getRun = makeFunctionReference<
    'query',
    { runId: Id<'researchRuns'> },
    unknown
>('researchRuns:get');
const transition = makeFunctionReference<
    'mutation',
    {
        runId: Id<'researchRuns'>;
        lifecycleState: 'checking_public_evidence';
        executionStatus: 'running';
        stepKey: 'check_public_evidence';
    },
    null
>('researchRuns:transition');

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function createVisitor(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
        const userId = await ctx.db.insert('users', { isAnonymous: true });
        const invitationId = await ctx.db.insert('invitations', {
            slotKey: 'durable-analyst',
            role: 'analyst',
            codeDigest: 'durable',
            status: 'claimed',
            createdAt: 1,
        });
        const visitorId = await ctx.db.insert('visitors', {
            authUserId: userId,
            invitationId,
            role: 'analyst',
            status: 'active',
            analysesReserved: 0,
            admittedAt: 1,
        });
        return { userId, visitorId };
    });
}

test('an unbound quota reservation cannot start the Phase 4 workflow', async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    const { userId } = await createVisitor(t);
    const analyst = t.withIdentity({ subject: `${userId}|unbound` });
    const { runId } = await analyst.mutation(reserve, {
        idempotencyKey: 'unbound-reservation',
    });

    await expect(t.mutation(startReserved, { runId })).rejects.toThrow(
        'confirmed company',
    );
});

test('cancellation of a confirmed workflow is terminal and idempotent', async () => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    const { userId, visitorId } = await createVisitor(t);
    const preflightId = await t.run(async (ctx) => {
        const companyId = await ctx.db.insert('companies', {
            cik: '1818201',
            legalName: 'CCC Intelligent Solutions Holdings Inc.',
            ticker: 'CCCS',
            exchange: 'NASDAQ',
            canonicalizedAt: 1,
        });
        return ctx.db.insert('companyPreflights', {
            ownerVisitorId: visitorId,
            query: 'CCCS',
            companyId,
            resolverVersion: 'sec-company-v1',
            status: 'resolved',
            expiresAt: Date.now() + 60_000,
            createdAt: 1,
        });
    });
    const analyst = t.withIdentity({ subject: `${userId}|cancel` });
    const { runId } = await analyst.action(confirmAndStart, {
        preflightId,
        idempotencyKey: 'cancel-confirmed',
        coveragePreset: 'balanced',
    });

    await expect(analyst.mutation(cancelRun, { runId })).resolves.toEqual({
        cancelled: true,
    });
    await expect(analyst.mutation(cancelRun, { runId })).resolves.toEqual({
        cancelled: false,
    });
    await expect(t.query(getRun, { runId })).resolves.toMatchObject({
        executionStatus: 'cancelled',
        workflowVersion: 2,
        executionGeneration: 2,
    });
    await expect(
        t.mutation(transition, {
            runId,
            lifecycleState: 'checking_public_evidence',
            executionStatus: 'running',
            stepKey: 'check_public_evidence',
        }),
    ).rejects.toThrow('terminal');
});
