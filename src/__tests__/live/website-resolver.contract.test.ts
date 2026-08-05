import { createExaWebsiteAdapter } from '@convex/integrations/exa';
import { classifyIrAsWebsite } from '@convex/integrations/sec';
import { resolveWebsiteUrl } from '@convex/integrations/websiteResolver';
import Exa from 'exa-js';
import { expect, test } from 'vitest';

/**
 * Live integration check that the website resolver picks the right marketing
 * homepage via Exa's company category. Gated behind RUN_LIVE_PROVIDER_TESTS=1
 * (mirrors the convention in exa.contract.test.ts). CI does not run this.
 */
test('website resolver picks the marketing homepage for known companies', async () => {
    if (process.env.RUN_LIVE_PROVIDER_TESTS !== '1') {
        expect(process.env.RUN_LIVE_PROVIDER_TESTS).not.toBe('1');
        return;
    }
    const apiKey = process.env.EXA_API_KEY?.trim();
    if (!apiKey) {
        throw new Error('EXA_API_KEY is required for live provider tests');
    }
    const client = new Exa(apiKey);
    const adapter = createExaWebsiteAdapter({
        search: (query, options) => client.search(query, options),
    });

    // expectedHostname may be a literal host (servicenow.com) or a regex
    // fragment (apple.) to accept Apple's country-specific Exa results.
    const cases: Array<{
        legalName: string;
        ticker: string;
        investorRelationsUrl?: string;
        expectedHostname: string;
    }> = [
        {
            legalName: 'ServiceNow, Inc.',
            ticker: 'NOW',
            investorRelationsUrl: 'https://investor.servicenow.com',
            expectedHostname: 'servicenow.com',
        },
        {
            legalName: 'Apple Inc.',
            ticker: 'AAPL',
            // Exa regionalizes Apple to country-specific entities; accept any
            // apple.* domain as a valid resolution of the Apple brand.
            expectedHostname: 'apple.',
        },
        {
            legalName: 'Microsoft Corporation',
            ticker: 'MSFT',
            expectedHostname: 'microsoft.com',
        },
    ];

    for (const c of cases) {
        const result = await resolveWebsiteUrl(c, {
            exaSearch: (query) => adapter.search(query),
            classifyIr: classifyIrAsWebsite,
        });
        expect(result, `no website resolved for ${c.legalName}`).not.toBeNull();
        const hostname = new URL(result?.url ?? '').hostname
            .toLowerCase()
            .replace(/^www\./, '');
        const matches = c.expectedHostname.endsWith('.')
            ? hostname.startsWith(c.expectedHostname)
            : hostname === c.expectedHostname ||
              hostname.endsWith(`.${c.expectedHostname}`);
        expect(
            matches,
            `${c.legalName}: expected ${c.expectedHostname} but got ${hostname} (url ${result?.url ?? '<unknown>'})`,
        ).toBe(true);
        expect(result?.source).toBe('exa');
    }
});
