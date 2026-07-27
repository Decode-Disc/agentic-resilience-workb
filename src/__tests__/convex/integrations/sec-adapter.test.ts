import { createSecCompanyResolver } from '@convex/integrations/sec';
import { describe, expect, test, vi } from 'vitest';

describe('createSecCompanyResolver', () => {
    test('returns ranked company candidates for a partial name without revalidating each result', async () => {
        const fetchImplementation = vi.fn(
            async (input: string | URL | Request) => {
                const url = String(input);
                if (url.endsWith('/files/company_tickers_exchange.json')) {
                    return new Response(
                        JSON.stringify({
                            fields: ['cik', 'name', 'ticker', 'exchange'],
                            data: [
                                [
                                    1818201,
                                    'CCC Intelligent Solutions Holdings Inc.',
                                    'CCCS',
                                    'Nasdaq',
                                ],
                                [
                                    1000001,
                                    'Intelligent Systems Corporation',
                                    'INS',
                                    'NYSE',
                                ],
                            ],
                        }),
                        { status: 200 },
                    );
                }
                throw new Error(`Unexpected SEC request: ${url}`);
            },
        );
        const reserveRequest = vi.fn(async () => undefined);
        const recordAttempt = vi.fn(async (attempt: { status: string }) => ({
            shouldExecute: attempt.status === 'started',
        }));
        const resolver = createSecCompanyResolver({
            fetch: fetchImplementation,
            now: () => 1_000,
            userAgent: 'Evidence Workbench test@example.com',
            reserveRequest,
            recordAttempt,
        });

        await expect(resolver.search('intelligent')).resolves.toEqual([
            {
                cik: '1000001',
                legalName: 'Intelligent Systems Corporation',
                ticker: 'INS',
                exchange: 'NYSE',
                investorRelationsUrl: undefined,
            },
            {
                cik: '1818201',
                legalName: 'CCC Intelligent Solutions Holdings Inc.',
                ticker: 'CCCS',
                exchange: 'NASDAQ',
                investorRelationsUrl: undefined,
            },
        ]);
        expect(reserveRequest).toHaveBeenCalledTimes(1);
        expect(fetchImplementation).toHaveBeenCalledTimes(1);
        expect(recordAttempt).toHaveBeenCalledWith(
            expect.objectContaining({
                operation: 'resolve_company',
                status: 'succeeded',
            }),
        );
    });

    test.each([
        'service now',
        'servce now',
    ])('finds a concatenated company name from %s', async (query) => {
        const resolver = createSecCompanyResolver({
            fetch: vi.fn(async () =>
                Promise.resolve(
                    new Response(
                        JSON.stringify({
                            fields: ['cik', 'name', 'ticker', 'exchange'],
                            data: [
                                [1373715, 'ServiceNow, Inc.', 'NOW', 'NYSE'],
                                [
                                    1713683,
                                    'ServiceTitan, Inc.',
                                    'TTAN',
                                    'Nasdaq',
                                ],
                            ],
                        }),
                        { status: 200 },
                    ),
                ),
            ),
            now: () => 1_000,
            userAgent: 'Evidence Workbench test@example.com',
            reserveRequest: vi.fn(async () => undefined),
            recordAttempt: vi.fn(async (attempt: { status: string }) => ({
                shouldExecute: attempt.status === 'started',
            })),
        });

        await expect(resolver.search(query)).resolves.toEqual([
            {
                cik: '1373715',
                legalName: 'ServiceNow, Inc.',
                ticker: 'NOW',
                exchange: 'NYSE',
                investorRelationsUrl: undefined,
            },
        ]);
    });

    test('does not add fuzzy noise to deterministic name matches', async () => {
        const resolver = createSecCompanyResolver({
            fetch: vi.fn(async () =>
                Promise.resolve(
                    new Response(
                        JSON.stringify({
                            fields: ['cik', 'name', 'ticker', 'exchange'],
                            data: [
                                [1373715, 'ServiceNow, Inc.', 'NOW', 'NYSE'],
                                [
                                    1713683,
                                    'ServiceTitan, Inc.',
                                    'TTAN',
                                    'Nasdaq',
                                ],
                                [1631574, 'FirstService Corp', 'FSV', 'Nasdaq'],
                            ],
                        }),
                        { status: 200 },
                    ),
                ),
            ),
            now: () => 1_000,
            userAgent: 'Evidence Workbench test@example.com',
            reserveRequest: vi.fn(async () => undefined),
            recordAttempt: vi.fn(async (attempt: { status: string }) => ({
                shouldExecute: attempt.status === 'started',
            })),
        });

        await expect(resolver.search('servicenow')).resolves.toEqual([
            expect.objectContaining({
                legalName: 'ServiceNow, Inc.',
                ticker: 'NOW',
            }),
        ]);
    });

    test.each([
        'CCCS',
        '0001818201',
        'https://www.sec.gov/edgar/browse/?CIK=0001818201',
        'https://www.sec.gov/Archives/edgar/data/1818201/0001/index.html',
    ])('finds the indexed company from %s', async (query) => {
        const resolver = createSecCompanyResolver({
            fetch: vi.fn(async () =>
                Promise.resolve(
                    new Response(
                        JSON.stringify({
                            fields: ['cik', 'name', 'ticker', 'exchange'],
                            data: [
                                [
                                    1818201,
                                    'CCC Intelligent Solutions Holdings Inc.',
                                    'CCCS',
                                    'Nasdaq',
                                ],
                            ],
                        }),
                        { status: 200 },
                    ),
                ),
            ),
            now: () => 1_000,
            userAgent: 'Evidence Workbench test@example.com',
            reserveRequest: vi.fn(async () => undefined),
            recordAttempt: vi.fn(async (attempt: { status: string }) => ({
                shouldExecute: attempt.status === 'started',
            })),
        });

        await expect(resolver.search(query)).resolves.toEqual([
            expect.objectContaining({
                cik: '1818201',
                legalName: 'CCC Intelligent Solutions Holdings Inc.',
                ticker: 'CCCS',
            }),
        ]);
    });

    test('reports filing metadata without leaking SEC response types', async () => {
        const resolver = createSecCompanyResolver({
            fetch: vi.fn(async () =>
                Promise.resolve(
                    new Response(
                        JSON.stringify({
                            cik: '0001818201',
                            name: 'CCC Intelligent Solutions Holdings Inc.',
                            tickers: ['CCCS'],
                            exchanges: ['Nasdaq'],
                            filings: {
                                recent: {
                                    accessionNumber: ['0001', '0002'],
                                },
                            },
                        }),
                        { status: 200 },
                    ),
                ),
            ),
            now: () => 1_000,
            userAgent: 'Evidence Workbench test@example.com',
            reserveRequest: vi.fn(async () => undefined),
            recordAttempt: vi.fn(async (attempt: { status: string }) => ({
                shouldExecute: attempt.status === 'started',
            })),
        });

        await expect(resolver.inspectEvidence('1818201')).resolves.toEqual({
            company: {
                cik: '1818201',
                legalName: 'CCC Intelligent Solutions Holdings Inc.',
                ticker: 'CCCS',
                exchange: 'NASDAQ',
                investorRelationsUrl: undefined,
            },
            filingCount: 2,
            filings: [
                {
                    accessionNumber: '0001',
                    form: undefined,
                    filingDate: undefined,
                    primaryDocument: undefined,
                },
                {
                    accessionNumber: '0002',
                    form: undefined,
                    filingDate: undefined,
                    primaryDocument: undefined,
                },
            ],
        });
    });

    test('does not repeat an already-recorded external attempt', async () => {
        const fetchImplementation = vi.fn();
        const resolver = createSecCompanyResolver({
            fetch: fetchImplementation,
            now: () => 1_000,
            userAgent: 'Evidence Workbench test@example.com',
            reserveRequest: vi.fn(async () => undefined),
            recordAttempt: vi.fn(async () => ({ shouldExecute: false })),
            operationScope: 'run:one:generation:1',
        });

        await expect(resolver.inspectEvidence('1818201')).rejects.toThrow(
            'already recorded',
        );
        expect(fetchImplementation).not.toHaveBeenCalled();
    });

    test('records bounded transport retry attempts', async () => {
        const fetchImplementation = vi
            .fn()
            .mockRejectedValueOnce(new TypeError('temporary network failure'))
            .mockResolvedValueOnce(
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
            );
        const recordAttempt = vi.fn(async (attempt: { status: string }) => ({
            shouldExecute: attempt.status === 'started',
        }));
        const resolver = createSecCompanyResolver({
            fetch: fetchImplementation,
            now: () => 1_000,
            userAgent: 'Evidence Workbench test@example.com',
            reserveRequest: vi.fn(async () => undefined),
            recordAttempt,
            operationScope: 'run:one:generation:1',
        });

        await expect(
            resolver.inspectEvidence('1818201'),
        ).resolves.toMatchObject({
            company: { ticker: 'CCCS' },
        });
        expect(fetchImplementation).toHaveBeenCalledTimes(2);
        expect(recordAttempt).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'started', attempt: 1 }),
        );
        expect(recordAttempt).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'failed', attempt: 1 }),
        );
        expect(recordAttempt).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'started', attempt: 2 }),
        );
        expect(recordAttempt).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'succeeded', attempt: 2 }),
        );
    });
});
