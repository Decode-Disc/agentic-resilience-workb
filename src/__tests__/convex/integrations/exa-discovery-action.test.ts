import type { Id } from '@convex/_generated/dataModel';
import schema from '@convex/schema';
import { makeFunctionReference } from 'convex/server';
import { convexTest } from 'convex-test';
import { afterEach, expect, test, vi } from 'vitest';

const { exaSearch } = vi.hoisted(() => ({
    exaSearch: vi.fn(),
}));

vi.mock('exa-js', () => ({
    default: class MockExa {
        search(...args: unknown[]) {
            return exaSearch(...args);
        }
    },
}));

vi.mock('node:dns/promises', async (importOriginal) => {
    const dns = await importOriginal<typeof import('node:dns/promises')>();
    return {
        ...dns,
        lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
    };
});

const modules = import.meta.glob('/convex/**/*.ts');
const discoverForRun = makeFunctionReference<
    'action',
    { runId: Id<'researchRuns'> },
    { total: number }
>('exaDiscoveryActions:discoverForRun');
const originalExaApiKey = process.env.EXA_API_KEY;

afterEach(() => {
    exaSearch.mockReset();
    if (originalExaApiKey === undefined) {
        delete process.env.EXA_API_KEY;
    } else {
        process.env.EXA_API_KEY = originalExaApiKey;
    }
});

async function createDiscoveryFixture(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
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
            queries: [
                {
                    query: 'CCC workflow control',
                    category: 'independent_analysis',
                    dimensionKeys: ['workflow_control'],
                },
            ],
            createdAt: 1,
        });
        return { runId };
    });
}

test('does not retry Exa after cancellation invalidates an in-flight result', async () => {
    process.env.EXA_API_KEY = 'test-key';
    const t = convexTest(schema, modules);
    const { runId } = await createDiscoveryFixture(t);
    let releaseSearch:
        | ((value: {
              results: Array<{
                  id: string;
                  url: string;
                  title: string;
              }>;
          }) => void)
        | undefined;
    exaSearch.mockImplementation(
        () =>
            new Promise((resolve) => {
                releaseSearch = resolve;
            }),
    );

    const discovery = t.action(discoverForRun, { runId });
    await vi.waitFor(() => expect(exaSearch).toHaveBeenCalledOnce());
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            executionStatus: 'cancelled',
            executionGeneration: 2,
            updatedAt: 2,
        }),
    );
    releaseSearch?.({
        results: [
            {
                id: 'late-exa-result',
                url: 'https://example.com/late',
                title: 'Late result',
            },
        ],
    });

    await expect(discovery).rejects.toThrow('no longer active');
    expect(exaSearch).toHaveBeenCalledOnce();
    await expect(
        t.run((ctx) => ctx.db.query('sources').collect()),
    ).resolves.toHaveLength(0);
    await expect(
        t.run((ctx) => ctx.db.query('providerCalls').collect()),
    ).resolves.toEqual([
        expect.objectContaining({
            service: 'exa',
            status: 'failed',
            errorCode: 'stale_execution',
        }),
    ]);
});
