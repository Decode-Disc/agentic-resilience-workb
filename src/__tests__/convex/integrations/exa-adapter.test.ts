import { createExaDiscoveryAdapter } from '@convex/integrations/exa';
import { validateExaCandidates } from '@convex/exaDiscoveryActions';
import { expect, test, vi } from 'vitest';

test('requests metadata-only Exa results', async () => {
    const search = vi.fn(async () => ({
        requestId: 'request-1',
        results: [
            {
                id: 'exa-1',
                url: 'https://example.com/analysis',
                title: 'Independent analysis',
                publishedDate: '2026-06-01T00:00:00.000Z',
            },
        ],
    }));
    const adapter = createExaDiscoveryAdapter({ search });

    await expect(adapter.search('CCC workflow control', 4)).resolves.toEqual([
        {
            canonicalUrl: 'https://example.com/analysis',
            title: 'Independent analysis',
            publishedAt: Date.parse('2026-06-01T00:00:00.000Z'),
            providerReference: 'exa-1',
        },
    ]);
    expect(search).toHaveBeenCalledWith('CCC workflow control', {
        type: 'auto',
        numResults: 4,
        contents: false,
    });
});

test.each([
    'http://example.com/analysis',
    'https://user:pass@example.com/analysis',
    'https://example.com:8443/analysis',
])('rejects unsafe provider URL %s', async (url) => {
    const adapter = createExaDiscoveryAdapter({
        search: vi.fn(async () => ({
            results: [{ id: 'unsafe', url, title: 'Unsafe result' }],
        })),
    });

    await expect(adapter.search('unsafe provider result', 1)).rejects.toThrow(
        'public HTTPS',
    );
});

test('rejects provider URLs resolving to a private network', async () => {
    await expect(
        validateExaCandidates(
            [
                {
                    canonicalUrl: 'https://private.example/report',
                    title: 'Private destination',
                    providerReference: 'private',
                },
            ],
            async () => ['10.0.0.1'],
        ),
    ).rejects.toThrow('public network');
});
