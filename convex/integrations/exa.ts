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
