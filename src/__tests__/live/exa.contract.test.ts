import Exa from 'exa-js';
import { expect, test } from 'vitest';

import { createExaDiscoveryAdapter } from '@convex/integrations/exa';

test('Exa metadata-only search remains bounded to two results', async () => {
    if (process.env.RUN_LIVE_PROVIDER_TESTS !== '1') {
        expect(process.env.RUN_LIVE_PROVIDER_TESTS).not.toBe('1');
        return;
    }
    const apiKey = process.env.EXA_API_KEY?.trim();
    if (!apiKey) {
        throw new Error('EXA_API_KEY is required for live provider tests');
    }
    const client = new Exa(apiKey);
    let requests = 0;
    let reportedCost: unknown;
    let providerSearchTime: number | undefined;
    const adapter = createExaDiscoveryAdapter({
        search: async (query, options) => {
            requests += 1;
            const response = await client.search(query, options);
            reportedCost = response.costDollars;
            providerSearchTime = response.searchTime;
            return response;
        },
    });

    const startedAt = Date.now();
    const results = await adapter.search(
        'CCC Intelligent Solutions investor relations',
        2,
    );
    const latencyMs = Date.now() - startedAt;

    expect(requests).toBe(1);
    expect(results.length).toBeLessThanOrEqual(2);
    expect(
        results.every(({ canonicalUrl }) =>
            canonicalUrl.startsWith('https://'),
        ),
    ).toBe(true);
    console.info(
        'LIVE_PROVIDER_EVIDENCE',
        JSON.stringify({
            provider: 'exa',
            requests,
            latencyMs,
            providerSearchTime,
            resultCount: results.length,
            metadataShape:
                results.length === 0
                    ? []
                    : Object.keys(results[0] ?? {}).sort(),
            cost: reportedCost ?? 'not_reported',
        }),
    );
});
