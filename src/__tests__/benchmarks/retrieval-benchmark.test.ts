// @vitest-environment node

import { once } from "node:events";
import { createServer } from "node:http";
import { createExaContentsClient } from "@convex/integrations/exaContentsClient";
import { fetchExaSearch } from "@convex/integrations/exaSearchClient";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
    assertBenchmarkOptIn,
    assertMinimumFirecrawlCredits,
    isRetryableRetrievalError,
    measureBenchmarkContent,
    normalizeBenchmarkMarkdown,
    parseFirecrawlCreditUsage,
    parseFirecrawlScrapeResponse,
    runWithBoundedRetry,
    withBenchmarkDeadline,
} from "@/__tests__/benchmarks/retrieval-benchmark";
import { RETRIEVAL_BENCHMARK_CORPUS } from "@/__tests__/benchmarks/retrieval-benchmark-manifest";

afterEach(() => vi.restoreAllMocks());

describe("benchmark transport settlement", () => {
    test.each([
        "contents",
        "search",
    ] as const)("aborts a stalled %s response before continuing, without redispatch", async (operation) => {
        const realFetch = globalThis.fetch;
        let requests = 0;
        let cancelled = false;
        let closed: Promise<void> = Promise.resolve();
        const server = createServer((_request, response) => {
            requests += 1;
            response.writeHead(200, { "content-type": "application/json" });
            response.write('{"results":[');
            const finish = setTimeout(() => response.end("]}"), 1000);
            closed = new Promise((resolve) =>
                response.once("close", () => {
                    cancelled = !response.writableEnded;
                    clearTimeout(finish);
                    resolve();
                }),
            );
        });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address();
        if (!address || typeof address === "string")
            throw new Error("Missing loopback listener");
        vi.spyOn(globalThis, "fetch").mockImplementation((url, options) => {
            expect(url).toBe(`https://api.exa.ai/${operation}`);
            return realFetch(`http://127.0.0.1:${address.port}`, options);
        });
        try {
            const result = await runWithBoundedRetry(() =>
                withBenchmarkDeadline(
                    (signal) =>
                        operation === "contents"
                            ? createExaContentsClient(
                                  "fixture-key",
                              ).getContents(
                                  ["https://example.com"],
                                  { text: true },
                                  { signal },
                              )
                            : fetchExaSearch(
                                  "fixture-key",
                                  "research",
                                  {
                                      type: "auto",
                                      numResults: 4,
                                      contents: false,
                                  },
                                  signal,
                              ),
                    200,
                ),
            );
            await closed;
            expect(requests).toBe(1);
            expect(cancelled).toBe(true);
            expect(result).toMatchObject({
                attempts: 1,
                error: expect.any(String),
            });
            expect(result.value).toBeUndefined();
        } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve())),
            );
        }
    });

    test("retries a confirmed Contents rejection and preserves cache policy and provider evidence", async () => {
        const response = {
            results: [
                {
                    id: "document",
                    url: "https://example.com",
                    text: "Evidence",
                },
            ],
            requestId: "provider-request",
            statuses: [{ status: "200" }],
            costDollars: { total: 0.001 },
        };
        const fetch = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(new Response("busy", { status: 503 }))
            .mockResolvedValueOnce(Response.json(response));
        const result = await runWithBoundedRetry(() =>
            withBenchmarkDeadline(
                (signal) =>
                    createExaContentsClient("fixture-key").getContents(
                        ["https://example.com"],
                        { text: true, maxAgeHours: 24 },
                        { signal },
                    ),
                1000,
            ),
        );
        expect(result).toEqual({ attempts: 2, value: response });
        expect(
            fetch.mock.calls.map(([, options]) =>
                JSON.parse(String(options?.body)),
            ),
        ).toEqual(
            Array(2).fill({
                urls: ["https://example.com"],
                text: true,
                maxAgeHours: 24,
            }),
        );
    });
});

describe("normalizeBenchmarkMarkdown", () => {
    test("normalizes text without rewriting content", () => {
        expect(
            normalizeBenchmarkMarkdown(
                "ＣＣＣ  \r\nLine two\t \r\n\r\n\r\n\r\nEnd",
            ),
        ).toBe("CCC\nLine two\n\nEnd");
    });
});

describe("benchmark live guards", () => {
    test("requires both explicit opt-ins", () => {
        expect(() =>
            assertBenchmarkOptIn({
                RUN_LIVE_PROVIDER_TESTS: "1",
                RUN_RETRIEVAL_BENCHMARK: "0",
            }),
        ).toThrow("RUN_RETRIEVAL_BENCHMARK");
        expect(() =>
            assertBenchmarkOptIn({
                RUN_LIVE_PROVIDER_TESTS: "1",
                RUN_RETRIEVAL_BENCHMARK: "1",
            }),
        ).not.toThrow();
    });

    test("requires at least twenty Firecrawl credits", () => {
        expect(
            parseFirecrawlCreditUsage(
                JSON.stringify({
                    success: true,
                    data: { remainingCredits: 20 },
                }),
            ),
        ).toBe(20);
        const remainingCredits = parseFirecrawlCreditUsage(
            JSON.stringify({
                success: true,
                data: { remainingCredits: 19 },
            }),
        );
        expect(() => assertMinimumFirecrawlCredits(remainingCredits)).toThrow(
            "20 Firecrawl credits",
        );
    });
});

describe("parseFirecrawlScrapeResponse", () => {
    test("maps CLI JSON into a neutral retrieval", () => {
        expect(
            parseFirecrawlScrapeResponse(
                JSON.stringify({
                    markdown: "# Example",
                    metadata: {
                        scrapeId: "scrape-1",
                        sourceURL: "https://example.com",
                        statusCode: 200,
                        title: "Example",
                        url: "https://www.example.com/final",
                    },
                }),
            ),
        ).toEqual({
            finalUrl: "https://www.example.com/final",
            markdown: "# Example",
            requestId: "scrape-1",
            statusCode: 200,
            title: "Example",
        });
    });

    test("rejects responses without Markdown", () => {
        expect(() =>
            parseFirecrawlScrapeResponse(
                JSON.stringify({ metadata: { statusCode: 403 } }),
            ),
        ).toThrow("Markdown");
    });
});

describe("isRetryableRetrievalError", () => {
    test.each([408, 429, 500, 503])("retries HTTP %s", (statusCode) => {
        expect(isRetryableRetrievalError({ statusCode })).toBe(true);
    });

    test("does not retry unconfirmed timeouts or network failures", () => {
        expect(isRetryableRetrievalError(new Error("request timed out"))).toBe(
            false,
        );
        expect(isRetryableRetrievalError({ code: "ECONNRESET" })).toBe(false);
    });

    test("does not retry deterministic failures", () => {
        expect(isRetryableRetrievalError({ statusCode: 400 })).toBe(false);
        expect(isRetryableRetrievalError(new Error("invalid URL"))).toBe(false);
    });
});

describe("runWithBoundedRetry", () => {
    test("does not redispatch a potentially paid request after an unknown outcome", async () => {
        let dispatches = 0;
        const result = await runWithBoundedRetry(async () => {
            dispatches += 1;
            throw new Error("Provider timeout after 120000ms");
        });
        expect(result).toEqual({
            attempts: 1,
            error: "Provider timeout after 120000ms",
        });
        expect(dispatches).toBe(1);
    });
    test("retries one transient failure", async () => {
        let attempts = 0;
        const result = await runWithBoundedRetry(async () => {
            attempts += 1;
            if (attempts === 1) {
                throw Object.assign(new Error("temporary"), {
                    statusCode: 503,
                });
            }
            return "retrieved";
        });

        expect(result).toEqual({ attempts: 2, value: "retrieved" });
    });

    test("stops after a deterministic failure", async () => {
        const result = await runWithBoundedRetry(async () => {
            throw Object.assign(new Error("invalid"), { statusCode: 400 });
        });

        expect(result).toMatchObject({ attempts: 1, error: "invalid" });
    });
});

describe("RETRIEVAL_BENCHMARK_CORPUS", () => {
    test("freezes the approved representative corpus", () => {
        expect(RETRIEVAL_BENCHMARK_CORPUS).toHaveLength(10);
        expect(
            RETRIEVAL_BENCHMARK_CORPUS.filter(
                ({ sourceClass }) => sourceClass === "first_party",
            ),
        ).toHaveLength(6);
        expect(
            RETRIEVAL_BENCHMARK_CORPUS.filter(
                ({ sourceClass }) => sourceClass === "third_party",
            ),
        ).toHaveLength(4);
        expect(
            RETRIEVAL_BENCHMARK_CORPUS.every(
                ({ anchors, url }) =>
                    anchors.length === 3 &&
                    url.startsWith("https://") &&
                    !url.endsWith(".pdf") &&
                    !url.includes("sec.gov"),
            ),
        ).toBe(true);
    });
});

describe("measureBenchmarkContent", () => {
    test("measures normalized content and anchor coverage", () => {
        const result = measureBenchmarkContent(
            "# ＣＣＣ First Look\n\nAI-assisted total loss review.",
            ["CCC First Look", "total loss", "missing anchor"],
        );

        expect(result).toMatchObject({
            anchorMatches: [true, true, false],
            anchorCoverage: 2 / 3,
            wordCount: 8,
        });
        expect(result.nativeHash).toMatch(/^[a-f0-9]{64}$/);
        expect(result.normalizedHash).toMatch(/^[a-f0-9]{64}$/);
    });

    test("handles empty content and anchors", () => {
        expect(measureBenchmarkContent("", [])).toMatchObject({
            anchorMatches: [],
            anchorCoverage: 0,
            wordCount: 0,
            characterCount: 0,
        });
    });
});
