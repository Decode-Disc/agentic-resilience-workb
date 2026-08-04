import {
    type ExaCompanyCandidate,
    pickBestExaCompanyResult,
    resolveWebsiteUrl,
} from '@convex/integrations/websiteResolver';
import { describe, expect, it, vi } from 'vitest';

describe('pickBestExaCompanyResult', () => {
    it('returns the result whose legal name best matches the entity name', () => {
        const candidates: ExaCompanyCandidate[] = [
            {
                url: 'https://servicenow.com/',
                entityName: 'ServiceNow',
            },
            {
                url: 'https://servicenow.com/early-careers',
                entityName: 'ServiceNow Early Careers',
            },
        ];

        expect(
            pickBestExaCompanyResult(candidates, {
                legalName: 'ServiceNow, Inc.',
                ticker: 'NOW',
            }),
        ).toEqual({
            url: 'https://servicenow.com/',
            entityName: 'ServiceNow',
        });
    });

    it('rejects aggregator/wikipedia results even when ranked first', () => {
        const candidates: ExaCompanyCandidate[] = [
            {
                url: 'https://en.wikipedia.org/wiki/ServiceNow',
                entityName: 'ServiceNow - Wikipedia',
            },
            {
                url: 'https://www.crunchbase.com/organization/servicenow',
                entityName: 'ServiceNow - Crunchbase',
            },
            {
                url: 'https://servicenow.com/',
                entityName: 'ServiceNow',
            },
        ];

        expect(
            pickBestExaCompanyResult(candidates, {
                legalName: 'ServiceNow, Inc.',
                ticker: 'NOW',
            }),
        ).toEqual({
            url: 'https://servicenow.com/',
            entityName: 'ServiceNow',
        });
    });

    it('prefers a root domain over a deep path with the same name', () => {
        const candidates: ExaCompanyCandidate[] = [
            {
                url: 'https://acme.com/products',
                entityName: 'Acme Products',
            },
            {
                url: 'https://acme.com/',
                entityName: 'Acme Holdings',
            },
        ];

        // Both share root domain; same legal-name token match. Root path
        // wins because it's the canonical homepage.
        expect(
            pickBestExaCompanyResult(candidates, {
                legalName: 'Acme Holdings',
                ticker: 'ACME',
            })?.url,
        ).toBe('https://acme.com/');
    });

    it('returns undefined when no candidate matches the legal name', () => {
        const candidates: ExaCompanyCandidate[] = [
            {
                url: 'https://irrelevant.com/',
                entityName: 'Unrelated Co',
            },
        ];

        expect(
            pickBestExaCompanyResult(candidates, {
                legalName: 'Acme Holdings',
                ticker: 'ACME',
            }),
        ).toBeUndefined();
    });

    it('returns undefined for an empty candidate list', () => {
        expect(
            pickBestExaCompanyResult([], {
                legalName: 'Acme',
                ticker: 'ACME',
            }),
        ).toBeUndefined();
    });
});

describe('resolveWebsiteUrl', () => {
    const baseInput = {
        legalName: 'ServiceNow, Inc.',
        ticker: 'NOW',
        investorRelationsUrl: undefined,
    };

    it('returns the SEC IR url when the classifier accepts it, without calling exa', async () => {
        const exaSearch = vi.fn();
        const result = await resolveWebsiteUrl(
            { ...baseInput, investorRelationsUrl: 'https://servicenow.com' },
            { exaSearch, classifyIr: (u) => u },
        );

        expect(result).toEqual({
            url: 'https://servicenow.com',
            source: 'sec_ir',
        });
        expect(exaSearch).not.toHaveBeenCalled();
    });

    it('falls back to Exa when the IR url is a vendor subdomain', async () => {
        const exaSearch = vi.fn(async () => [
            {
                url: 'https://servicenow.com/',
                entityName: 'ServiceNow',
            },
        ]);
        const result = await resolveWebsiteUrl(
            {
                ...baseInput,
                investorRelationsUrl: 'https://investor.servicenow.com',
            },
            {
                exaSearch,
                classifyIr: (u) =>
                    u?.startsWith('https://investor.') ? undefined : u,
            },
        );

        expect(result).toEqual({
            url: 'https://servicenow.com/',
            source: 'exa',
        });
        expect(exaSearch).toHaveBeenCalledWith(
            expect.stringContaining('ServiceNow'),
        );
    });

    it('falls back to Exa when no IR url is set', async () => {
        const exaSearch = vi.fn(async () => [
            {
                url: 'https://servicenow.com/',
                entityName: 'ServiceNow',
            },
        ]);
        const result = await resolveWebsiteUrl(baseInput, {
            exaSearch,
            classifyIr: () => undefined,
        });

        expect(result).toEqual({
            url: 'https://servicenow.com/',
            source: 'exa',
        });
    });

    it('returns null when Exa returns no usable candidate', async () => {
        const exaSearch = vi.fn(async () => [
            {
                url: 'https://en.wikipedia.org/wiki/ServiceNow',
                entityName: 'ServiceNow - Wikipedia',
            },
        ]);
        const result = await resolveWebsiteUrl(baseInput, {
            exaSearch,
            classifyIr: () => undefined,
        });

        expect(result).toBeNull();
        expect(exaSearch).toHaveBeenCalledTimes(1);
    });

    it('returns null and does not throw when exa rejects', async () => {
        const exaSearch = vi.fn(async () => {
            throw new Error('Exa unauthorized');
        });
        const result = await resolveWebsiteUrl(baseInput, {
            exaSearch,
            classifyIr: () => undefined,
        });

        expect(result).toBeNull();
    });
});
