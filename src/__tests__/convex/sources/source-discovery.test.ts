import type { Id } from '@convex/_generated/dataModel';
import schema from '@convex/schema';
import { makeFunctionReference } from 'convex/server';
import { convexTest } from 'convex-test';
import { afterEach, expect, test } from 'vitest';

const modules = import.meta.glob('/convex/**/*.ts');
const persistCandidates = makeFunctionReference<
    'mutation',
    {
        runId: Id<'researchRuns'>;
        corpusRevisionId: Id<'corpusRevisions'>;
        executionGeneration: number;
        operationKey: string;
        candidates: Array<{
            canonicalUrl: string;
            title: string;
            origin: 'sec' | 'exa';
            category: string;
            providerReference?: string;
        }>;
    },
    { inserted: number; total: number }
>('sourceDiscovery:persistCandidates');
const discoverForRun = makeFunctionReference<
    'action',
    {
        runId: Id<'researchRuns'>;
        cik: string;
        filings: [];
    },
    { total: number }
>('sourceDiscoveryActions:discoverForRun');
const originalExaApiKey = process.env.EXA_API_KEY;

afterEach(() => {
    if (originalExaApiKey === undefined) {
        delete process.env.EXA_API_KEY;
    } else {
        process.env.EXA_API_KEY = originalExaApiKey;
    }
});

test('persists unique candidates with pending decisions', async () => {
    const t = convexTest(schema, modules);
    const { runId, corpusRevisionId } = await t.run(async (ctx) => {
        const runId = await ctx.db.insert('researchRuns', {
            lifecycleState: 'discovering_sources',
            executionStatus: 'running',
            executionGeneration: 1,
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
        return { runId, corpusRevisionId };
    });
    const input = {
        runId,
        corpusRevisionId,
        executionGeneration: 1,
        operationKey: 'discover:run-1',
        candidates: [
            {
                canonicalUrl: 'https://example.com/analysis',
                title: 'Independent analysis',
                origin: 'exa' as const,
                category: 'independent_analysis',
                providerReference: 'exa-1',
            },
            {
                canonicalUrl: 'https://example.com/analysis',
                title: 'Duplicate result',
                origin: 'exa' as const,
                category: 'independent_analysis',
                providerReference: 'exa-duplicate',
            },
        ],
    };

    await expect(t.mutation(persistCandidates, input)).resolves.toEqual({
        inserted: 1,
        total: 1,
    });
    await expect(t.mutation(persistCandidates, input)).resolves.toEqual({
        inserted: 0,
        total: 1,
    });
    await expect(
        t.run(async (ctx) => ctx.db.query('sourceDecisions').collect()),
    ).resolves.toEqual([
        expect.objectContaining({
            corpusRevisionId,
            decision: 'pending',
        }),
    ]);
});

test('rejects candidates from a stale or cancelled generation', async () => {
    const t = convexTest(schema, modules);
    const { runId, corpusRevisionId } = await t.run(async (ctx) => {
        const runId = await ctx.db.insert('researchRuns', {
            lifecycleState: 'discovering_sources',
            executionStatus: 'cancelled',
            executionGeneration: 2,
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
        return { runId, corpusRevisionId };
    });

    await expect(
        t.mutation(persistCandidates, {
            runId,
            corpusRevisionId,
            executionGeneration: 1,
            operationKey: 'stale-discovery',
            candidates: [
                {
                    canonicalUrl: 'https://example.com/late',
                    title: 'Late result',
                    origin: 'exa',
                    category: 'independent_analysis',
                },
            ],
        }),
    ).rejects.toThrow('no longer active');
    await expect(
        t.run(async (ctx) => ctx.db.query('sources').collect()),
    ).resolves.toHaveLength(0);
});

test('persists an actionable failure when Exa is not configured', async () => {
    delete process.env.EXA_API_KEY;
    const t = convexTest(schema, modules);
    const runId = await t.run(async (ctx) => {
        const companyId = await ctx.db.insert('companies', {
            cik: '1818201',
            legalName: 'CCC Intelligent Solutions Holdings Inc.',
            ticker: 'CCC',
            exchange: 'NYSE',
            canonicalizedAt: 1,
        });
        const runId = await ctx.db.insert('researchRuns', {
            companyId,
            lifecycleState: 'discovering_sources',
            executionStatus: 'running',
            executionGeneration: 1,
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
        await ctx.db.patch(runId, {
            activeCorpusRevisionId: corpusRevisionId,
        });
        await ctx.db.insert('researchPlans', {
            runId,
            version: 1,
            coveragePreset: 'balanced',
            queries: [],
            createdAt: 1,
        });
        return runId;
    });

    await expect(
        t.action(discoverForRun, {
            runId,
            cik: '1818201',
            filings: [],
        }),
    ).resolves.toEqual({ total: 0 });
    await expect(
        t.run((ctx) => ctx.db.query('providerCalls').collect()),
    ).resolves.toEqual([
        expect.objectContaining({
            runId,
            service: 'exa',
            status: 'failed',
            errorCode: 'exa_not_configured',
        }),
    ]);
});
