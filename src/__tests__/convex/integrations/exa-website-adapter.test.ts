import { createExaWebsiteAdapter } from '@convex/integrations/exa';
import { expect, test, vi } from 'vitest';

test('requests company category results and extracts the entity name', async () => {
    const search = vi.fn(async () => ({
        requestId: 'r-1',
        results: [
            {
                id: 'org-1',
                url: 'https://servicenow.com/',
                title: 'ServiceNow',
                entities: [
                    {
                        type: 'company',
                        properties: { name: 'ServiceNow' },
                    },
                ],
            },
        ],
    }));
    const adapter = createExaWebsiteAdapter({ search });

    await expect(
        adapter.search('ServiceNow, Inc. official website'),
    ).resolves.toEqual([
        {
            url: 'https://servicenow.com/',
            entityName: 'ServiceNow',
        },
    ]);
    expect(search).toHaveBeenCalledWith('ServiceNow, Inc. official website', {
        type: 'auto',
        category: 'company',
        numResults: 5,
        contents: false,
    });
});

test('falls back to the page title when no structured company entity is present', async () => {
    const search = vi.fn(async () => ({
        requestId: 'r-2',
        results: [
            {
                id: 'page-1',
                url: 'https://acme.com/',
                title: 'Acme — Home',
                entities: [],
            },
        ],
    }));
    const adapter = createExaWebsiteAdapter({ search });

    await expect(adapter.search('Acme Co official website')).resolves.toEqual([
        {
            url: 'https://acme.com/',
            entityName: 'Acme — Home',
        },
    ]);
});

test('falls back to hostname when both entity and title are missing', async () => {
    const search = vi.fn(async () => ({
        requestId: 'r-3',
        results: [
            {
                id: 'page-2',
                url: 'https://stealth.io/',
                title: null,
            },
        ],
    }));
    const adapter = createExaWebsiteAdapter({ search });

    await expect(adapter.search('Stealth Co')).resolves.toEqual([
        {
            url: 'https://stealth.io/',
            entityName: 'stealth.io',
        },
    ]);
});

test.each([
    'http://acme.com/',
    'https://user:pass@acme.com/',
    'https://acme.com:8443/',
])('rejects unsafe provider URL %s', async (url) => {
    const search = vi.fn(async () => ({
        requestId: 'r-4',
        results: [{ id: 'x', url, title: 'Acme' }],
    }));
    const adapter = createExaWebsiteAdapter({ search });

    await expect(adapter.search('Acme')).rejects.toThrow(
        /public HTTPS contract/,
    );
});
