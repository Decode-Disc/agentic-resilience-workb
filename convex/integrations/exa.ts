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
            type: "auto";
            numResults: number;
            contents: false;
        },
    ): Promise<{
        results: ReadonlyArray<ExaSearchResult>;
        searchTime?: number;
        costDollars?: { total: number };
    }>;
};

export type DiscoveredSourceCandidate = {
    canonicalUrl: string;
    title: string;
    publishedAt?: number;
    providerReference: string;
};

export type ExaCandidateBatch<Candidate> = {
    candidates: ReadonlyArray<Candidate>;
    rejected: number;
    searchTime?: number;
    costDollars?: number;
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
            type: "auto";
            category: "company";
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
        searchTime?: number;
        costDollars?: { total: number };
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
        ExaCandidateBatch<{
            url: string;
            entityName: string;
        }>
    >;
} {
    return {
        async search(query) {
            const response = await client.search(query, {
                type: "auto",
                category: "company",
                numResults: 5,
                contents: false,
            });
            const candidates: Array<{ url: string; entityName: string }> = [];
            let rejected = 0;
            for (const result of response.results) {
                try {
                    const url = new URL(result.url);
                    if (
                        url.protocol !== "https:" ||
                        url.username ||
                        url.password ||
                        (url.port && url.port !== "443")
                    ) {
                        throw new Error("Invalid public HTTPS result");
                    }
                    url.port = "";
                    url.hash = "";
                    const entityName =
                        result.entities?.find((e) => e.type === "company")
                            ?.properties?.name ??
                        result.title?.trim() ??
                        url.hostname;
                    candidates.push({
                        url: url.toString(),
                        entityName: entityName ?? url.hostname,
                    });
                } catch {
                    rejected += 1;
                }
            }
            return {
                candidates,
                rejected,
                searchTime: response.searchTime,
                costDollars: response.costDollars?.total,
            };
        },
    };
}

export function createExaDiscoveryAdapter(client: ExaSearchClient): {
    search(
        query: string,
        limit: number,
    ): Promise<ExaCandidateBatch<DiscoveredSourceCandidate>>;
} {
    return {
        async search(query, limit) {
            const response = await client.search(query, {
                type: "auto",
                numResults: Math.max(1, Math.min(10, Math.floor(limit))),
                contents: false,
            });
            const candidates: Array<DiscoveredSourceCandidate> = [];
            let rejected = 0;
            for (const result of response.results) {
                try {
                    const url = new URL(result.url);
                    if (
                        url.protocol !== "https:" ||
                        url.username ||
                        url.password ||
                        (url.port && url.port !== "443")
                    ) {
                        throw new Error("Invalid public HTTPS result");
                    }
                    url.port = "";
                    url.hash = "";
                    const publishedAt = result.publishedDate
                        ? Date.parse(result.publishedDate)
                        : Number.NaN;
                    candidates.push({
                        canonicalUrl: url.toString(),
                        title: result.title?.trim() || url.hostname,
                        publishedAt: Number.isFinite(publishedAt)
                            ? publishedAt
                            : undefined,
                        providerReference: result.id,
                    });
                } catch {
                    rejected += 1;
                }
            }
            return {
                candidates,
                rejected,
                searchTime: response.searchTime,
                costDollars: response.costDollars?.total,
            };
        },
    };
}
