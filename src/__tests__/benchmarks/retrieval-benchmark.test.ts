// @vitest-environment node

import { describe, expect, test } from "vitest";

import {
    assertBenchmarkOptIn,
    assertMinimumFirecrawlCredits,
    classifyRetrieval,
    isRetryableRetrievalError,
    measureBenchmarkContent,
    normalizeBenchmarkMarkdown,
    parseFirecrawlCreditUsage,
    parseFirecrawlScrapeResponse,
    recommendFirecrawlFallback,
    runWithBoundedRetry,
} from "@/__tests__/benchmarks/retrieval-benchmark";
import { RETRIEVAL_BENCHMARK_CORPUS } from "@/__tests__/benchmarks/retrieval-benchmark-manifest";

describe("normalizeBenchmarkMarkdown", () => {
    test("normalizes text without rewriting content", () => {
        expect(
            normalizeBenchmarkMarkdown(
                "ＣＣＣ  \r\nLine two\t \r\n\r\n\r\n\r\nEnd",
            ),
        ).toBe("CCC\nLine two\n\nEnd");
    });
});

describe("classifyRetrieval", () => {
    test.each([
        {
            expected: "usable",
            input: {
                markdown: "Relevant content",
                scores: {
                    completeness: 2,
                    noiseAbsence: 1,
                    relocalizability: 2,
                    structure: 1,
                },
            },
        },
        {
            expected: "partial",
            input: {
                markdown: "Relevant content",
                scores: {
                    completeness: 1,
                    noiseAbsence: 2,
                    relocalizability: 2,
                    structure: 2,
                },
            },
        },
        {
            expected: "unusable",
            input: {
                markdown: "Blocked",
                scores: {
                    completeness: 0,
                    noiseAbsence: 2,
                    relocalizability: 1,
                    structure: 2,
                },
            },
        },
    ] as const)("classifies $expected retrieval", ({ expected, input }) => {
        expect(classifyRetrieval(input)).toBe(expected);
    });

    test("rejects empty and failed retrievals", () => {
        const scores = {
            completeness: 2,
            noiseAbsence: 2,
            relocalizability: 2,
            structure: 2,
        } as const;

        expect(classifyRetrieval({ markdown: "", scores })).toBe("unusable");
        expect(
            classifyRetrieval({
                error: "timeout",
                markdown: "content",
                scores,
            }),
        ).toBe("unusable");
    });
});

describe("recommendFirecrawlFallback", () => {
    const materialWin = (sourceId: string) => ({
        sourceId,
        exa: {
            anchorCoverage: 1 / 3,
            classification: "partial" as const,
            relocalizability: 1 as const,
        },
        firecrawl: {
            anchorCoverage: 1,
            classification: "usable" as const,
            relocalizability: 2 as const,
        },
    });

    test("requires repeated material gains", () => {
        expect(recommendFirecrawlFallback([materialWin("one")])).toMatchObject({
            recommend: false,
            materialWins: 1,
        });
        expect(
            recommendFirecrawlFallback([
                materialWin("one"),
                materialWin("two"),
            ]),
        ).toMatchObject({ recommend: true, materialWins: 2 });
    });

    test("rejects worse anchor coverage", () => {
        const row = materialWin("one");
        row.firecrawl.anchorCoverage = 0;

        expect(recommendFirecrawlFallback([row])).toMatchObject({
            recommend: false,
            materialWins: 0,
        });
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

    test("retries timeouts and network failures", () => {
        expect(isRetryableRetrievalError(new Error("request timed out"))).toBe(
            true,
        );
        expect(isRetryableRetrievalError({ code: "ECONNRESET" })).toBe(true);
    });

    test("does not retry deterministic failures", () => {
        expect(isRetryableRetrievalError({ statusCode: 400 })).toBe(false);
        expect(isRetryableRetrievalError(new Error("invalid URL"))).toBe(false);
    });
});

describe("runWithBoundedRetry", () => {
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
