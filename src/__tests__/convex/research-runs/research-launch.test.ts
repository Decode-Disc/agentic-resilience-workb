import type { Id } from '@convex/_generated/dataModel';
import schema from '@convex/schema';
import { makeFunctionReference } from 'convex/server';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import rateLimiterTest from '../integrations/rate-limiter-test-register.js';
import workflowTest from '../workflows/workflow-test-register.js';

const modules = import.meta.glob('/convex/**/*.ts');
const originalFetch = globalThis.fetch;
const originalSecUserAgent = process.env.SEC_USER_AGENT;

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalSecUserAgent === undefined) {
        delete process.env.SEC_USER_AGENT;
    } else {
        process.env.SEC_USER_AGENT = originalSecUserAgent;
    }
    vi.useRealTimers();
});
const confirmAndStart = makeFunctionReference<
    'action',
    {
        preflightId: Id<'companyPreflights'>;
        idempotencyKey: string;
        coveragePreset:
            | 'balanced'
            | 'first_party_depth'
            | 'independent_scrutiny';
        researchAngle?: string;
    },
    { runId: Id<'researchRuns'>; remainingAnalyses: number }
>('researchLaunch:confirmAndStart');
const confirmAndStartReserved = makeFunctionReference<
    'mutation',
    {
        preflightId: Id<'companyPreflights'>;
        idempotencyKey: string;
        coveragePreset: 'balanced';
        manualSources: Array<{
            canonicalUrl: string;
            title: string;
            providerReference: string;
        }>;
    },
    { runId: Id<'researchRuns'>; remainingAnalyses: number }
>('researchLaunch:confirmAndStartReserved');
const authorizeLaunchPreparation = makeFunctionReference<
    'query',
    {
        preflightId: Id<'companyPreflights'>;
        idempotencyKey: string;
    },
    { shouldPrepareManualSources: boolean }
>('researchLaunch:authorizeLaunchPreparation');
const getRun = makeFunctionReference<
    'query',
    { runId: Id<'researchRuns'> },
    unknown
>('researchRuns:get');
const getMine = makeFunctionReference<
    'query',
    { runId: Id<'researchRuns'> },
    unknown
>('researchRuns:getMine');
const transition = makeFunctionReference<
    'mutation',
    {
        runId: Id<'researchRuns'>;
        lifecycleState:
            | 'checking_public_evidence'
            | 'awaiting_evidence_sufficiency_review';
        executionStatus: 'running' | 'paused';
        stepKey: 'check_public_evidence' | 'evidence_sufficiency_review';
    },
    null
>('researchRuns:transition');
const decideSufficiency = makeFunctionReference<
    'mutation',
    {
        runId: Id<'researchRuns'>;
        decision:
            | { kind: 'recheck'; decisionKey: string }
            | {
                  kind: 'force_continue';
                  decisionKey: string;
                  reason: string;
              }
            | {
                  kind: 'complete_insufficient';
                  decisionKey: string;
                  reason: string;
              };
    },
    { accepted: boolean }
>('evidenceSufficiency:decide');

async function createAdmittedPreflight(
    t: ReturnType<typeof convexTest>,
): Promise<{
    userId: Id<'users'>;
    preflightId: Id<'companyPreflights'>;
}> {
    return t.run(async (ctx) => {
        const userId = await ctx.db.insert('users', { isAnonymous: true });
        const invitationId = await ctx.db.insert('invitations', {
            slotKey: 'analyst-1',
            role: 'analyst',
            codeDigest: 'launch-test-digest',
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
        const companyId = await ctx.db.insert('companies', {
            cik: '1818201',
            legalName: 'CCC Intelligent Solutions Holdings Inc.',
            ticker: 'CCCS',
            exchange: 'NASDAQ',
            canonicalizedAt: Date.now(),
        });
        const preflightId = await ctx.db.insert('companyPreflights', {
            ownerVisitorId: visitorId,
            query: 'CCCS',
            companyId,
            resolverVersion: 'sec-company-v1',
            status: 'resolved',
            expiresAt: Date.now() + 60_000,
            createdAt: Date.now(),
        });
        return { userId, preflightId };
    });
}

test('confirms a preflight and starts workflow version 2 once', async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const analyst = t.withIdentity({ subject: `${userId}|launch-session` });

    const first = await analyst.action(confirmAndStart, {
        preflightId,
        idempotencyKey: 'launch-cccs',
        coveragePreset: 'balanced',
        researchAngle: 'Focus on claims workflow control.',
    });
    const replay = await analyst.action(confirmAndStart, {
        preflightId,
        idempotencyKey: 'launch-cccs',
        coveragePreset: 'balanced',
        researchAngle: 'Focus on claims workflow control.',
    });

    expect(replay).toEqual(first);
    await expect(
        t.query(getRun, { runId: first.runId }),
    ).resolves.toMatchObject({
        companyPreflightId: preflightId,
        coveragePreset: 'balanced',
        researchAngle: 'Focus on claims workflow control.',
        reservationStatus: 'consumed',
        executionStatus: 'running',
        executionGeneration: 1,
        workflowVersion: 2,
    });
    await expect(
        t.run(async (ctx) => ctx.db.query('corpusRevisions').collect()),
    ).resolves.toEqual([
        expect.objectContaining({
            runId: first.runId,
            revision: 1,
            status: 'draft',
        }),
    ]);
    await t.run(async (ctx) => {
        const run = await ctx.db.get(first.runId);
        if (!run?.companyId) {
            throw new Error('Confirmed company missing');
        }
        await ctx.db.patch(run.companyId, {
            legalName: 'Changed canonical company name',
            ticker: 'NEW',
            exchange: 'NYSE',
        });
    });
    await expect(
        analyst.query(getMine, { runId: first.runId }),
    ).resolves.toMatchObject({
        company: {
            legalName: 'CCC Intelligent Solutions Holdings Inc.',
            ticker: 'CCCS',
            exchange: 'NASDAQ',
        },
    });
});

test('persists validated launch references as pending sources in corpus revision 1', async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const analyst = t.withIdentity({
        subject: `${userId}|launch-reference-session`,
    });

    const { runId } = await analyst.mutation(confirmAndStartReserved, {
        preflightId,
        idempotencyKey: 'launch-with-public-reference',
        coveragePreset: 'balanced',
        manualSources: [
            {
                canonicalUrl: 'https://example.com/public-report',
                title: 'Public report',
                providerReference: 'launch_url_metadata:public-report',
            },
        ],
    });

    const persisted = await t.run(async (ctx) => {
        const run = await ctx.db.get(runId);
        const sources = await ctx.db
            .query('sources')
            .withIndex('by_run_and_url', (query) => query.eq('runId', runId))
            .collect();
        const decisions = await ctx.db
            .query('sourceDecisions')
            .withIndex('by_revision_and_source', (query) =>
                query.eq(
                    'corpusRevisionId',
                    run?.activeCorpusRevisionId as Id<'corpusRevisions'>,
                ),
            )
            .collect();
        return { sources, decisions };
    });

    expect(persisted.sources).toEqual([
        expect.objectContaining({
            canonicalUrl: 'https://example.com/public-report',
            title: 'Public report',
            origin: 'analyst_url',
            category: 'analyst_supplied',
        }),
    ]);
    expect(persisted.decisions).toEqual([
        expect.objectContaining({
            runId,
            decision: 'pending',
        }),
    ]);
});

test('skips manual source preparation when the launch key already owns a run', async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const analyst = t.withIdentity({
        subject: `${userId}|launch-preparation-session`,
    });

    await analyst.action(confirmAndStart, {
        preflightId,
        idempotencyKey: 'already-prepared-launch',
        coveragePreset: 'balanced',
    });

    await expect(
        analyst.query(authorizeLaunchPreparation, {
            preflightId,
            idempotencyKey: 'already-prepared-launch',
        }),
    ).resolves.toEqual({ shouldPrepareManualSources: false });
});

test('adopts a pre-admission preflight for the admitted session', async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    const { userId, visitorId, preflightId } = await t.run(async (ctx) => {
        const userId = await ctx.db.insert('users', { isAnonymous: true });
        const companyId = await ctx.db.insert('companies', {
            cik: '1818201',
            legalName: 'CCC Intelligent Solutions Holdings Inc.',
            ticker: 'CCCS',
            exchange: 'NASDAQ',
            canonicalizedAt: Date.now(),
        });
        const preflightId = await ctx.db.insert('companyPreflights', {
            ownerAuthUserId: userId,
            query: 'CCCS',
            companyId,
            resolverVersion: 'sec-company-v1',
            status: 'resolved',
            expiresAt: Date.now() + 60_000,
            createdAt: Date.now(),
        });
        const invitationId = await ctx.db.insert('invitations', {
            slotKey: 'analyst-1',
            role: 'analyst',
            codeDigest: 'pre-admission-launch-digest',
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
        return { userId, visitorId, preflightId };
    });
    const admittedSession = t.withIdentity({
        subject: `${userId}|pre-admission-session`,
    });

    const result = await admittedSession.action(confirmAndStart, {
        preflightId,
        idempotencyKey: 'launch-after-admission',
        coveragePreset: 'balanced',
    });

    await expect(
        t.run((ctx) => ctx.db.get(preflightId)),
    ).resolves.toMatchObject({
        ownerAuthUserId: userId,
        ownerVisitorId: visitorId,
        status: 'consumed',
    });
    await expect(
        admittedSession.query(getMine, { runId: result.runId }),
    ).resolves.toMatchObject({
        company: { ticker: 'CCCS' },
    });
});

test('allows exactly one running workflow per visitor', async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const secondPreflightId = await t.run(async (ctx) => {
        const first = await ctx.db.get(preflightId);
        if (!first) {
            throw new Error('Test preflight not found');
        }
        return ctx.db.insert('companyPreflights', {
            ownerVisitorId: first.ownerVisitorId,
            query: first.query,
            companyId: first.companyId,
            resolverVersion: first.resolverVersion,
            status: 'resolved',
            createdAt: Date.now(),
            expiresAt: Date.now() + 60_000,
        });
    });
    const analyst = t.withIdentity({ subject: `${userId}|concurrent-session` });

    const starts = await Promise.allSettled([
        analyst.action(confirmAndStart, {
            preflightId,
            idempotencyKey: 'concurrent-a',
            coveragePreset: 'balanced',
        }),
        analyst.action(confirmAndStart, {
            preflightId: secondPreflightId,
            idempotencyKey: 'concurrent-b',
            coveragePreset: 'balanced',
        }),
    ]);

    const fulfilled = starts.filter(
        (
            result,
        ): result is PromiseFulfilledResult<{
            runId: Id<'researchRuns'>;
            remainingAnalyses: number;
        }> => result.status === 'fulfilled',
    );
    expect(fulfilled).toHaveLength(1);
    expect(starts.filter(({ status }) => status === 'rejected')).toHaveLength(
        1,
    );

    const runningRunId = fulfilled[0]?.value.runId;
    if (!runningRunId) {
        throw new Error('Expected one running research run');
    }
    await t.mutation(transition, {
        runId: runningRunId,
        lifecycleState: 'checking_public_evidence',
        executionStatus: 'running',
        stepKey: 'check_public_evidence',
    });
    await t.mutation(transition, {
        runId: runningRunId,
        lifecycleState: 'awaiting_evidence_sufficiency_review',
        executionStatus: 'paused',
        stepKey: 'evidence_sufficiency_review',
    });

    await expect(
        analyst.action(confirmAndStart, {
            preflightId: secondPreflightId,
            idempotencyKey: 'concurrent-b-retry',
            coveragePreset: 'balanced',
        }),
    ).resolves.toMatchObject({ remainingAnalyses: 1 });
});

test('revalidates the confirmed CIK before evidence checks', async () => {
    process.env.SEC_USER_AGENT = 'Evidence Workbench test@example.com';
    const fetchImplementation = vi.fn(async () =>
        Promise.resolve(
            new Response(
                JSON.stringify({
                    cik: '0001818201',
                    name: 'CCC Intelligent Solutions Holdings Inc.',
                    tickers: ['CCCS'],
                    exchanges: ['Nasdaq'],
                    filings: { recent: { accessionNumber: ['0001'] } },
                }),
                { status: 200 },
            ),
        ),
    );
    globalThis.fetch = fetchImplementation;
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const analyst = t.withIdentity({ subject: `${userId}|revalidate-session` });

    const { runId } = await analyst.action(confirmAndStart, {
        preflightId,
        idempotencyKey: 'revalidate-cccs',
        coveragePreset: 'balanced',
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchImplementation).toHaveBeenCalledWith(
        'https://data.sec.gov/submissions/CIK0001818201.json',
        expect.objectContaining({
            headers: expect.objectContaining({
                'User-Agent': 'Evidence Workbench test@example.com',
            }),
        }),
    );
    await expect(t.query(getRun, { runId })).resolves.toMatchObject({
        lifecycleState: 'awaiting_source_review',
        executionStatus: 'paused',
    });
});

test('pauses when revalidation finds no public evidence', async () => {
    process.env.SEC_USER_AGENT = 'Evidence Workbench test@example.com';
    globalThis.fetch = vi.fn(async () =>
        Promise.resolve(
            new Response(
                JSON.stringify({
                    cik: '0001818201',
                    name: 'CCC Intelligent Solutions Holdings Inc.',
                    tickers: ['CCCS'],
                    exchanges: ['Nasdaq'],
                    filings: { recent: { accessionNumber: [] } },
                }),
                { status: 200 },
            ),
        ),
    );
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const analyst = t.withIdentity({
        subject: `${userId}|insufficient-session`,
    });

    const { runId } = await analyst.action(confirmAndStart, {
        preflightId,
        idempotencyKey: 'insufficient-cccs',
        coveragePreset: 'balanced',
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await expect(t.query(getRun, { runId })).resolves.toMatchObject({
        lifecycleState: 'awaiting_evidence_sufficiency_review',
        executionStatus: 'paused',
        pauseReason: 'evidence_sufficiency_review',
    });
    await expect(
        analyst.mutation(decideSufficiency, {
            runId,
            decision: {
                kind: 'complete_insufficient',
                decisionKey: 'complete-insufficient-cccs',
                reason: 'Public evidence cannot support a credible assessment.',
            },
        }),
    ).resolves.toEqual({ accepted: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expect(t.query(getRun, { runId })).resolves.toMatchObject({
        lifecycleState: 'completed',
        executionStatus: 'completed',
    });
});

test('requires a justified force-continuation decision', async () => {
    process.env.SEC_USER_AGENT = 'Evidence Workbench test@example.com';
    globalThis.fetch = vi.fn(async () =>
        Promise.resolve(
            new Response(
                JSON.stringify({
                    cik: '0001818201',
                    name: 'CCC Intelligent Solutions Holdings Inc.',
                    tickers: ['CCCS'],
                    exchanges: ['Nasdaq'],
                    filings: { recent: { accessionNumber: [] } },
                }),
                { status: 200 },
            ),
        ),
    );
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const analyst = t.withIdentity({ subject: `${userId}|force-session` });
    const { runId } = await analyst.action(confirmAndStart, {
        preflightId,
        idempotencyKey: 'force-cccs',
        coveragePreset: 'balanced',
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await expect(
        analyst.mutation(decideSufficiency, {
            runId,
            decision: {
                kind: 'force_continue',
                decisionKey: 'force-short',
                reason: 'too short',
            },
        }),
    ).rejects.toThrow('12 characters');
    await expect(
        analyst.mutation(decideSufficiency, {
            runId,
            decision: {
                kind: 'force_continue',
                decisionKey: 'force-valid',
                reason: 'Proceed with explicitly limited public evidence.',
            },
        }),
    ).resolves.toEqual({ accepted: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expect(t.query(getRun, { runId })).resolves.toMatchObject({
        lifecycleState: 'awaiting_source_review',
        executionStatus: 'paused',
    });
});
