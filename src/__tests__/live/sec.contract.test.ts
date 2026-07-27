import { expect, test } from 'vitest';

import { createSecCompanyResolver } from '@convex/integrations/sec';

test('SEC submissions contract returns one bounded known-company snapshot', async () => {
    if (process.env.RUN_LIVE_PROVIDER_TESTS !== '1') {
        expect(process.env.RUN_LIVE_PROVIDER_TESTS).not.toBe('1');
        return;
    }
    const userAgent = process.env.SEC_USER_AGENT?.trim();
    if (!userAgent) {
        throw new Error('SEC_USER_AGENT is required for live provider tests');
    }
    let requests = 0;
    const resolver = createSecCompanyResolver({
        fetch: async (input, init) => {
            requests += 1;
            return fetch(input, init);
        },
        now: Date.now,
        userAgent,
        reserveRequest: async () => undefined,
        recordAttempt: async () => ({ shouldExecute: true }),
        operationScope: 'live-contract',
    });

    const startedAt = Date.now();
    const snapshot = await resolver.inspectEvidence('1818201');
    const latencyMs = Date.now() - startedAt;

    expect(requests).toBe(1);
    expect(snapshot.company.ticker).toBe('CCC');
    expect(snapshot.company.cik).toBe('1818201');
    expect(snapshot.filingCount).toBeGreaterThan(0);
    console.info(
        'LIVE_PROVIDER_EVIDENCE',
        JSON.stringify({
            provider: 'sec',
            requests,
            latencyMs,
            metadataShape: {
                company: Object.keys(snapshot.company).sort(),
                filingCount: typeof snapshot.filingCount,
            },
            cost: 'free_public_endpoint',
        }),
    );
});
