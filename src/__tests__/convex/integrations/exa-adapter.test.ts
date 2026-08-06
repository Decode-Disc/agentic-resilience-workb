import { createExaDiscoveryAdapter } from "@convex/integrations/exa";
import { validateExaCandidates } from "@convex/exaDiscoveryActions";
import { expect, test, vi } from "vitest";

test("requests metadata-only Exa results", async () => {
    const search = vi.fn(async () => ({
        requestId: "request-1",
        searchTime: 37,
        costDollars: { total: 0.002 },
        results: [
            {
                id: "exa-1",
                url: "https://example.com/analysis",
                title: "Independent analysis",
                publishedDate: "2026-06-01T00:00:00.000Z",
            },
        ],
    }));
    const adapter = createExaDiscoveryAdapter({ search });

    await expect(adapter.search("CCC workflow control", 4)).resolves.toEqual({
        candidates: [
            {
                canonicalUrl: "https://example.com/analysis",
                title: "Independent analysis",
                publishedAt: Date.parse("2026-06-01T00:00:00.000Z"),
                providerReference: "exa-1",
            },
        ],
        rejected: 0,
        searchTime: 37,
        costDollars: 0.002,
    });
    expect(search).toHaveBeenCalledWith("CCC workflow control", {
        type: "auto",
        numResults: 4,
        contents: false,
    });
});

test("keeps valid results when another Exa URL is invalid", async () => {
    const adapter = createExaDiscoveryAdapter({
        search: vi.fn(async () => ({
            results: [
                {
                    id: "valid",
                    url: "https://example.com/valid",
                    title: "Valid result",
                },
                {
                    id: "unsafe",
                    url: "http://example.com/unsafe",
                    title: "Unsafe result",
                },
            ],
        })),
    });

    await expect(adapter.search("mixed provider result", 2)).resolves.toEqual({
        candidates: [
            {
                canonicalUrl: "https://example.com/valid",
                title: "Valid result",
                publishedAt: undefined,
                providerReference: "valid",
            },
        ],
        rejected: 1,
        searchTime: undefined,
        costDollars: undefined,
    });
});

test("rejects provider URLs resolving to a private network", async () => {
    await expect(
        validateExaCandidates(
            [
                {
                    canonicalUrl: "https://private.example/report",
                    title: "Private destination",
                    providerReference: "private",
                },
            ],
            async () => ["10.0.0.1"],
        ),
    ).resolves.toEqual({ candidates: [], rejected: 1 });
});
