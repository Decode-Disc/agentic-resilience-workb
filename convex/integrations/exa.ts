type ExaSearchResult = {
    id: string;
    url: string;
    title: string | null;
    publishedDate?: string;
};

export type ExaSearchClient = {
    search(
        query: string,
        options: {
            type: 'auto';
            numResults: number;
            contents: false;
        },
    ): Promise<{
        results: ReadonlyArray<ExaSearchResult>;
    }>;
};

export type DiscoveredSourceCandidate = {
    canonicalUrl: string;
    title: string;
    publishedAt?: number;
    providerReference: string;
};

/**
 * Exa client contract for semantic company search. The `category: 'company'`
 * parameter returns structured entities (homepage URL + company name), which
 * the website resolver uses to find a marketing website when SEC
 * `investorWebsite` is empty or a vendor subdomain.
 */
export type ExaCompanySearchClient = {
    search(
        query: string,
        options: {
            type: 'auto';
            category: 'company';
            numResults: number;
            contents: false;
        },
    ): Promise<{
        results: ReadonlyArray<{
            id: string;
            url: string;
            title: string | null;
            entities?: ReadonlyArray<{
                type: string;
                properties?: { name?: string | null };
            }>;
        }>;
    }>;
};

/**
 * Builds the company-search adapter from an Exa client. Shares the same
 * public-HTTPS contract as the source-discovery adapter so neither leaks
 * non-public URLs. Drops provider-specific fields (entity `id`, image, etc.)
 * so the website resolver stays provider-agnostic.
 */
export function createExaWebsiteAdapter(client: ExaCompanySearchClient): {
    search(query: string): Promise<
        ReadonlyArray<{
            url: string;
            entityName: string;
        }>
    >;
} {
    return {
        async search(query) {
            const response = await client.search(query, {
                type: 'auto',
                category: 'company',
                numResults: 5,
                contents: false,
            });
            return response.results.map((result) => {
                const url = new URL(result.url);
                if (
                    url.protocol !== 'https:' ||
                    url.username ||
                    url.password ||
                    (url.port && url.port !== '443')
                ) {
                    throw new Error(
                        'Exa returned a URL outside the public HTTPS contract',
                    );
                }
                url.port = '';
                url.hash = '';
                const entityName =
                    result.entities?.find((e) => e.type === 'company')
                        ?.properties?.name ??
                    result.title?.trim() ??
                    url.hostname;
                return {
                    url: url.toString(),
                    entityName: entityName ?? url.hostname,
                };
            });
        },
    };
}

export function createExaDiscoveryAdapter(client: ExaSearchClient): {
    search(
        query: string,
        limit: number,
    ): Promise<ReadonlyArray<DiscoveredSourceCandidate>>;
} {
    return {
        async search(query, limit) {
            const response = await client.search(query, {
                type: 'auto',
                numResults: Math.max(1, Math.min(10, Math.floor(limit))),
                contents: false,
            });
            return response.results.map((result) => {
                const url = new URL(result.url);
                if (
                    url.protocol !== 'https:' ||
                    url.username ||
                    url.password ||
                    (url.port && url.port !== '443')
                ) {
                    throw new Error(
                        'Exa returned a URL outside the public HTTPS contract',
                    );
                }
                url.port = '';
                url.hash = '';
                const publishedAt = result.publishedDate
                    ? Date.parse(result.publishedDate)
                    : Number.NaN;
                return {
                    canonicalUrl: url.toString(),
                    title: result.title?.trim() || url.hostname,
                    publishedAt: Number.isFinite(publishedAt)
                        ? publishedAt
                        : undefined,
                    providerReference: result.id,
                };
            });
        },
    };
}
