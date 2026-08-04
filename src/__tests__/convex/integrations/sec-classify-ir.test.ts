import { classifyIrAsWebsite } from '@convex/integrations/sec';
import { describe, expect, it } from 'vitest';

describe('classifyIrAsWebsite', () => {
    it('accepts a bare company domain as a marketing website', () => {
        expect(classifyIrAsWebsite('https://acme.com')).toBe(
            'https://acme.com',
        );
        expect(classifyIrAsWebsite('https://www.acme.com')).toBe(
            'https://www.acme.com',
        );
    });

    it('rejects investor-relations subdomains', () => {
        expect(
            classifyIrAsWebsite('https://investor.acme.com'),
        ).toBeUndefined();
        expect(classifyIrAsWebsite('https://ir.acme.com')).toBeUndefined();
        expect(
            classifyIrAsWebsite('https://investors.acme.com'),
        ).toBeUndefined();
    });

    it('rejects common IR-vendor hosted subdomains', () => {
        expect(classifyIrAsWebsite('https://acme.q4ir.com')).toBeUndefined();
        expect(classifyIrAsWebsite('https://acme.q4inc.com')).toBeUndefined();
        expect(
            classifyIrAsWebsite('https://ir.acme.nasdaqomx.com'),
        ).toBeUndefined();
    });

    it('rejects non-https IR urls so only public https is treated as a website', () => {
        expect(classifyIrAsWebsite('http://acme.com')).toBeUndefined();
    });

    it('returns undefined for empty or unparseable input', () => {
        expect(classifyIrAsWebsite(undefined)).toBeUndefined();
        expect(classifyIrAsWebsite('')).toBeUndefined();
        expect(classifyIrAsWebsite('not a url')).toBeUndefined();
    });

    it('preserves the path of an accepted root domain', () => {
        // Root domain with an IR path segment still indicates an IR page — but
        // this function only inspects the host. A URL like
        // https://acme.com/investors is rare in SEC investorWebsite data; if
        // it shows up we treat it as the website root.
        expect(classifyIrAsWebsite('https://acme.com/investors')).toBe(
            'https://acme.com/investors',
        );
    });
});
