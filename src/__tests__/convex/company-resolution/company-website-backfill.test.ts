import { describe, expect, it, vi } from 'vitest';

import {
    backfillRunCompanyWebsiteWithResolver,
    type SecCompanyMatch,
} from '@convex/companyResolution';

const legacyCompany: SecCompanyMatch = {
    cik: '1373715',
    legalName: 'ServiceNow, Inc.',
    ticker: 'NOW',
    exchange: 'NYSE',
};

describe('backfillRunCompanyWebsiteWithResolver', () => {
    it('resolves and persists a missing website URL for a legacy run', async () => {
        const resolveWebsite = vi.fn(async () => ({
            url: 'https://servicenow.com/',
            source: 'exa' as const,
        }));
        const persist = vi.fn(async () => undefined);

        const result = await backfillRunCompanyWebsiteWithResolver(
            {
                runId: 'run-1',
                companyId: 'company-1',
                company: legacyCompany,
                companySnapshot: legacyCompany,
            },
            { resolveWebsite, persist },
        );

        expect(result).toEqual({
            websiteUrl: 'https://servicenow.com/',
            websiteUrlSource: 'exa',
        });
        expect(resolveWebsite).toHaveBeenCalledWith(legacyCompany);
        expect(persist).toHaveBeenCalledWith({
            runId: 'run-1',
            companyId: 'company-1',
            websiteUrl: 'https://servicenow.com/',
            websiteUrlSource: 'exa',
        });
    });

    it('copies a company-level URL into a legacy run snapshot without resolving again', async () => {
        const resolveWebsite = vi.fn();
        const persist = vi.fn(async () => undefined);

        const result = await backfillRunCompanyWebsiteWithResolver(
            {
                runId: 'run-1',
                companyId: 'company-1',
                company: {
                    ...legacyCompany,
                    websiteUrl: 'https://servicenow.com/',
                    websiteUrlSource: 'exa',
                },
                companySnapshot: legacyCompany,
            },
            { resolveWebsite, persist },
        );

        expect(result).toEqual({
            websiteUrl: 'https://servicenow.com/',
            websiteUrlSource: 'exa',
        });
        expect(resolveWebsite).not.toHaveBeenCalled();
        expect(persist).toHaveBeenCalledWith({
            runId: 'run-1',
            companyId: 'company-1',
            websiteUrl: 'https://servicenow.com/',
            websiteUrlSource: 'exa',
        });
    });

    it('preserves missing provenance for an existing company URL', async () => {
        const resolveWebsite = vi.fn();
        const persist = vi.fn(async () => undefined);

        const result = await backfillRunCompanyWebsiteWithResolver(
            {
                runId: 'run-1',
                companyId: 'company-1',
                company: {
                    ...legacyCompany,
                    websiteUrl: 'https://servicenow.com/',
                },
                companySnapshot: legacyCompany,
            },
            { resolveWebsite, persist },
        );

        expect(result).toEqual({
            websiteUrl: 'https://servicenow.com/',
            websiteUrlSource: undefined,
        });
        expect(resolveWebsite).not.toHaveBeenCalled();
        expect(persist).toHaveBeenCalledWith({
            runId: 'run-1',
            companyId: 'company-1',
            websiteUrl: 'https://servicenow.com/',
        });
    });

    it('leaves legacy metadata empty when resolution cannot identify a website', async () => {
        const resolveWebsite = vi.fn(async () => null);
        const persist = vi.fn();

        const result = await backfillRunCompanyWebsiteWithResolver(
            {
                runId: 'run-1',
                companyId: 'company-1',
                company: legacyCompany,
                companySnapshot: legacyCompany,
            },
            { resolveWebsite, persist },
        );

        expect(result).toEqual({});
        expect(persist).not.toHaveBeenCalled();
    });
});
