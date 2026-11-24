import { getEventListeners } from "node:events";
import { createSecCompanyResolver } from "@convex/integrations/sec";
import { beforeEach, describe, expect, test, vi } from "vitest";

describe("createSecCompanyResolver", () => {
    beforeEach(() => {
        process.env.COMPANY_SEARCH_RESULT_LIMIT = "40";
    });

    test("returns at most the configured 40 ranked company candidates", async () => {
        const companies = Array.from({ length: 52 }, (_, index) => [
            2_000_000 + index,
            `Ranked Company ${String(index + 1).padStart(2, "0")}`,
            `R${index + 1}`,
            "Nasdaq",
        ]);
        const resolver = createSecCompanyResolver({
            fetch: vi.fn(async () =>
                Promise.resolve(
                    new Response(
                        JSON.stringify({
                            fields: ["cik", "name", "ticker", "exchange"],
                            data: companies,
                        }),
                        { status: 200 },
                    ),
                ),
            ),
            now: () => 1_000,
            userAgent: "Evidence Workbench test@example.com",
            reserveRequest: vi.fn(async () => undefined),
            recordAttempt: vi.fn(async (attempt: { status: string }) => ({
                shouldExecute: attempt.status === "started",
            })),
        });

        const results = await resolver.search("ranked company");

        expect(results).toHaveLength(40);
        expect(results.at(0)?.legalName).toBe("Ranked Company 01");
        expect(results.at(-1)?.legalName).toBe("Ranked Company 40");
    });

    test("returns ranked company candidates for a partial name without revalidating each result", async () => {
        const fetchImplementation = vi.fn(
            async (input: string | URL | Request) => {
                const url = String(input);
                if (url.endsWith("/files/company_tickers_exchange.json")) {
                    return new Response(
                        JSON.stringify({
                            fields: ["cik", "name", "ticker", "exchange"],
                            data: [
                                [
                                    1818201,
                                    "CCC Intelligent Solutions Holdings Inc.",
                                    "CCCS",
                                    "Nasdaq",
                                ],
                                [
                                    1000001,
                                    "Intelligent Systems Corporation",
                                    "INS",
                                    "NYSE",
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
            shouldExecute: attempt.status === "started",
        }));
        const resolver = createSecCompanyResolver({
            fetch: fetchImplementation,
            now: () => 1_000,
            userAgent: "Evidence Workbench test@example.com",
            reserveRequest,
            recordAttempt,
        });

        await expect(resolver.search("intelligent")).resolves.toEqual([
            {
                cik: "1000001",
                legalName: "Intelligent Systems Corporation",
                ticker: "INS",
                exchange: "NYSE",
                investorRelationsUrl: undefined,
                websiteUrl: undefined,
                websiteUrlSource: undefined,
            },
            {
                cik: "1818201",
                legalName: "CCC Intelligent Solutions Holdings Inc.",
                ticker: "CCCS",
                exchange: "NASDAQ",
                investorRelationsUrl: undefined,
                websiteUrl: undefined,
                websiteUrlSource: undefined,
            },
        ]);
        expect(reserveRequest).toHaveBeenCalledTimes(1);
        expect(fetchImplementation).toHaveBeenCalledTimes(1);
        expect(recordAttempt).toHaveBeenCalledWith(
            expect.objectContaining({
                operation: "resolve_company",
                status: "succeeded",
            }),
        );
    });

    test("reuses the cached SEC company index across searches within its TTL without reserving additional SEC requests", async () => {
        let currentTime = 1_000;
        const fetchImplementation = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        fields: ["cik", "name", "ticker", "exchange"],
                        data: [
                            [1373715, "ServiceNow, Inc.", "NOW", "NYSE"],
                            [
                                1818201,
                                "CCC Intelligent Solutions Holdings Inc.",
                                "CCCS",
                                "Nasdaq",
                            ],
                        ],
                    }),
                    { status: 200 },
                ),
        );
        const reserveRequest = vi.fn(async () => undefined);
        const recordAttempt = vi.fn(async (attempt: { status: string }) => ({
            shouldExecute: attempt.status === "started",
        }));
        const resolver = createSecCompanyResolver({
            fetch: fetchImplementation,
            now: () => currentTime,
            userAgent: "Evidence Workbench test@example.com",
            reserveRequest,
            recordAttempt,
            companyIndexCacheTtlMs: 60_000,
        });

        await expect(resolver.search("serv")).resolves.toEqual([
            expect.objectContaining({ ticker: "NOW" }),
        ]);
        currentTime = 5_000;
        await expect(resolver.search("cccs")).resolves.toEqual([
            expect.objectContaining({ ticker: "CCCS" }),
        ]);
        expect(reserveRequest).toHaveBeenCalledTimes(1);
        expect(fetchImplementation).toHaveBeenCalledTimes(1);

        currentTime = 62_000;
        await expect(resolver.search("now")).resolves.toEqual([
            expect.objectContaining({ ticker: "NOW" }),
        ]);
        expect(reserveRequest).toHaveBeenCalledTimes(2);
        expect(fetchImplementation).toHaveBeenCalledTimes(2);
    });

    test.each([
        "service now",
        "servce now",
    ])("finds a concatenated company name from %s", async (query) => {
        const resolver = createSecCompanyResolver({
            fetch: vi.fn(async () =>
                Promise.resolve(
                    new Response(
                        JSON.stringify({
                            fields: ["cik", "name", "ticker", "exchange"],
                            data: [
                                [1373715, "ServiceNow, Inc.", "NOW", "NYSE"],
                                [
                                    1713683,
                                    "ServiceTitan, Inc.",
                                    "TTAN",
                                    "Nasdaq",
                                ],
                            ],
                        }),
                        { status: 200 },
                    ),
                ),
            ),
            now: () => 1_000,
            userAgent: "Evidence Workbench test@example.com",
            reserveRequest: vi.fn(async () => undefined),
            recordAttempt: vi.fn(async (attempt: { status: string }) => ({
                shouldExecute: attempt.status === "started",
            })),
        });

        await expect(resolver.search(query)).resolves.toEqual([
            {
                cik: "1373715",
                legalName: "ServiceNow, Inc.",
                ticker: "NOW",
                exchange: "NYSE",
                investorRelationsUrl: undefined,
                websiteUrl: undefined,
                websiteUrlSource: undefined,
            },
        ]);
    });

    test("does not add fuzzy noise to deterministic name matches", async () => {
        const resolver = createSecCompanyResolver({
            fetch: vi.fn(async () =>
                Promise.resolve(
                    new Response(
                        JSON.stringify({
                            fields: ["cik", "name", "ticker", "exchange"],
                            data: [
                                [1373715, "ServiceNow, Inc.", "NOW", "NYSE"],
                                [
                                    1713683,
                                    "ServiceTitan, Inc.",
                                    "TTAN",
                                    "Nasdaq",
                                ],
                                [1631574, "FirstService Corp", "FSV", "Nasdaq"],
                            ],
                        }),
                        { status: 200 },
                    ),
                ),
            ),
            now: () => 1_000,
            userAgent: "Evidence Workbench test@example.com",
            reserveRequest: vi.fn(async () => undefined),
            recordAttempt: vi.fn(async (attempt: { status: string }) => ({
                shouldExecute: attempt.status === "started",
            })),
        });

        await expect(resolver.search("servicenow")).resolves.toEqual([
            expect.objectContaining({
                legalName: "ServiceNow, Inc.",
                ticker: "NOW",
            }),
        ]);
    });

    test.each([
        "CCCS",
        "0001818201",
        "https://www.sec.gov/edgar/browse/?CIK=0001818201",
        "https://www.sec.gov/Archives/edgar/data/1818201/0001/index.html",
    ])("finds the indexed company from %s", async (query) => {
        const resolver = createSecCompanyResolver({
            fetch: vi.fn(async () =>
                Promise.resolve(
                    new Response(
                        JSON.stringify({
                            fields: ["cik", "name", "ticker", "exchange"],
                            data: [
                                [
                                    1818201,
                                    "CCC Intelligent Solutions Holdings Inc.",
                                    "CCCS",
                                    "Nasdaq",
                                ],
                            ],
                        }),
                        { status: 200 },
                    ),
                ),
            ),
            now: () => 1_000,
            userAgent: "Evidence Workbench test@example.com",
            reserveRequest: vi.fn(async () => undefined),
            recordAttempt: vi.fn(async (attempt: { status: string }) => ({
                shouldExecute: attempt.status === "started",
            })),
        });

        await expect(resolver.search(query)).resolves.toEqual([
            expect.objectContaining({
                cik: "1818201",
                legalName: "CCC Intelligent Solutions Holdings Inc.",
                ticker: "CCCS",
            }),
        ]);
    });

    test("reports filing metadata without leaking SEC response types", async () => {
        const resolver = createSecCompanyResolver({
            fetch: vi.fn(async () =>
                Promise.resolve(
                    new Response(
                        JSON.stringify({
                            cik: "0001818201",
                            name: "CCC Intelligent Solutions Holdings Inc.",
                            tickers: ["CCCS"],
                            exchanges: ["Nasdaq"],
                            filings: {
                                recent: {
                                    accessionNumber: ["0001", "0002"],
                                },
                            },
                        }),
                        { status: 200 },
                    ),
                ),
            ),
            now: () => 1_000,
            userAgent: "Evidence Workbench test@example.com",
            reserveRequest: vi.fn(async () => undefined),
            recordAttempt: vi.fn(async (attempt: { status: string }) => ({
                shouldExecute: attempt.status === "started",
            })),
        });

        await expect(resolver.inspectEvidence("1818201")).resolves.toEqual({
            company: {
                cik: "1818201",
                legalName: "CCC Intelligent Solutions Holdings Inc.",
                ticker: "CCCS",
                exchange: "NASDAQ",
                investorRelationsUrl: undefined,
                websiteUrl: undefined,
                websiteUrlSource: undefined,
            },
            filingCount: 2,
            filings: [
                {
                    accessionNumber: "0001",
                    form: undefined,
                    filingDate: undefined,
                    primaryDocument: undefined,
                },
                {
                    accessionNumber: "0002",
                    form: undefined,
                    filingDate: undefined,
                    primaryDocument: undefined,
                },
            ],
        });
    });

    test("does not repeat an already-recorded external attempt", async () => {
        const fetchImplementation = vi.fn();
        const resolver = createSecCompanyResolver({
            fetch: fetchImplementation,
            now: () => 1_000,
            userAgent: "Evidence Workbench test@example.com",
            reserveRequest: vi.fn(async () => undefined),
            recordAttempt: vi.fn(async () => ({ shouldExecute: false })),
            operationScope: "run:one:generation:1",
        });

        await expect(resolver.inspectEvidence("1818201")).rejects.toThrow(
            "already recorded",
        );
        expect(fetchImplementation).not.toHaveBeenCalled();
    });

    test("records bounded transport retry attempts", async () => {
        const fetchImplementation = vi
            .fn()
            .mockRejectedValueOnce(new TypeError("temporary network failure"))
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        cik: "0001818201",
                        name: "CCC Intelligent Solutions Holdings Inc.",
                        tickers: ["CCCS"],
                        exchanges: ["Nasdaq"],
                        filings: { recent: { accessionNumber: ["0001"] } },
                    }),
                    { status: 200 },
                ),
            );
        const recordAttempt = vi.fn(async (attempt: { status: string }) => ({
            shouldExecute: attempt.status === "started",
        }));
        const resolver = createSecCompanyResolver({
            fetch: fetchImplementation,
            now: () => 1_000,
            userAgent: "Evidence Workbench test@example.com",
            reserveRequest: vi.fn(async () => undefined),
            recordAttempt,
            operationScope: "run:one:generation:1",
        });

        await expect(
            resolver.inspectEvidence("1818201"),
        ).resolves.toMatchObject({
            company: { ticker: "CCCS" },
        });
        expect(fetchImplementation).toHaveBeenCalledTimes(2);
        expect(recordAttempt).toHaveBeenCalledWith(
            expect.objectContaining({ status: "started", attempt: 1 }),
        );
        expect(recordAttempt).toHaveBeenCalledWith(
            expect.objectContaining({ status: "failed", attempt: 1 }),
        );
        expect(recordAttempt).toHaveBeenCalledWith(
            expect.objectContaining({ status: "started", attempt: 2 }),
        );
        expect(recordAttempt).toHaveBeenCalledWith(
            expect.objectContaining({ status: "succeeded", attempt: 2 }),
        );
    });

    test("bounds SEC requests with an abort signal", async () => {
        const fetchImplementation = vi.fn(
            async (_input: string | URL | Request, init?: RequestInit) => {
                expect(init?.signal).toBeInstanceOf(AbortSignal);
                return new Response(
                    JSON.stringify({
                        cik: "0001818201",
                        name: "CCC Intelligent Solutions Holdings Inc.",
                        tickers: ["CCCS"],
                        exchanges: ["Nasdaq"],
                        filings: { recent: { accessionNumber: [] } },
                    }),
                    { status: 200 },
                );
            },
        );
        const resolver = createSecCompanyResolver({
            fetch: fetchImplementation,
            now: () => 1_000,
            userAgent: "Evidence Workbench test@example.com",
            reserveRequest: vi.fn(async () => undefined),
            recordAttempt: vi.fn(async (attempt: { status: string }) => ({
                shouldExecute: attempt.status === "started",
            })),
        });

        await expect(
            resolver.inspectEvidence("1818201"),
        ).resolves.toMatchObject({ company: { cik: "1818201" } });
    });

    test("aborts timed-out SEC requests within the bounded retry budget", async () => {
        const fetchImplementation = vi.fn(
            (_input: string | URL | Request, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () =>
                        reject(new DOMException("Aborted", "AbortError")),
                    );
                }),
        );
        const recordAttempt = vi.fn(async (attempt: { status: string }) => ({
            shouldExecute: attempt.status === "started",
        }));
        const resolver = createSecCompanyResolver({
            fetch: fetchImplementation,
            now: Date.now,
            userAgent: "Evidence Workbench test@example.com",
            reserveRequest: vi.fn(async () => undefined),
            recordAttempt,
            timeoutMs: 5,
        });

        await expect(resolver.inspectEvidence("1818201")).rejects.toThrow(
            "application timeout",
        );
        expect(fetchImplementation).toHaveBeenCalledTimes(2);
        expect(recordAttempt).toHaveBeenLastCalledWith(
            expect.objectContaining({
                status: "failed",
                attempt: 2,
                errorCode: "SecTimeoutError",
            }),
        );
    });

    test("retrieves SEC document HTML with identifying User-Agent and records provider attempts", async () => {
        const fetchImplementation = vi.fn(
            async (_input: string | URL | Request, init?: RequestInit) => {
                expect(init?.headers).toMatchObject({
                    "User-Agent": "Evidence Workbench test@example.com",
                    Accept: "text/html,application/xhtml+xml,text/plain,*/*",
                });
                return new Response(
                    "<html><body><h1>ITEM 1</h1><p>Business</p></body></html>",
                    {
                        status: 200,
                        headers: { "Content-Type": "text/html; charset=utf-8" },
                    },
                );
            },
        );
        const recordAttempt = vi.fn(async (attempt: { status: string }) => ({
            shouldExecute: attempt.status === "started",
        }));
        const resolver = createSecCompanyResolver({
            fetch: fetchImplementation,
            now: () => 1_000,
            userAgent: "Evidence Workbench test@example.com",
            reserveRequest: vi.fn(async () => undefined),
            recordAttempt,
            operationScope: "run:test:gen:1",
        });

        const html = await resolver.retrieveDocumentHtml(
            "https://www.sec.gov/Archives/edgar/data/1818201/000181820124000010/cccs-20231231.htm",
        );

        expect(html).toContain("ITEM 1");
        expect(recordAttempt).toHaveBeenCalledWith(
            expect.objectContaining({
                operation: "retrieve_filing_html",
                status: "started",
                attempt: 1,
            }),
        );
        expect(recordAttempt).toHaveBeenCalledWith(
            expect.objectContaining({
                operation: "retrieve_filing_html",
                status: "succeeded",
                attempt: 1,
            }),
        );
    });

    test("rejects SEC document HTML exceeding declared 16 MiB limit", async () => {
        const fetchImplementation = vi.fn(
            async () =>
                new Response("too big", {
                    status: 200,
                    headers: {
                        "Content-Type": "text/html",
                        "Content-Length": String(17 * 1024 * 1024),
                    },
                }),
        );
        const resolver = createSecCompanyResolver({
            fetch: fetchImplementation,
            now: () => 1_000,
            userAgent: "Evidence Workbench test@example.com",
            reserveRequest: vi.fn(async () => undefined),
            recordAttempt: vi.fn(async (a: { status: string }) => ({
                shouldExecute: a.status === "started",
            })),
        });

        await expect(
            resolver.retrieveDocumentHtml("https://www.sec.gov/doc.htm"),
        ).rejects.toThrow("exceeds declared limit");
    });

    test("rejects unsupported media types from SEC retrieval", async () => {
        const fetchImplementation = vi.fn(
            async () =>
                new Response("%PDF-1.4 dummy", {
                    status: 200,
                    headers: {
                        "Content-Type": "application/pdf",
                    },
                }),
        );
        const resolver = createSecCompanyResolver({
            fetch: fetchImplementation,
            now: () => 1_000,
            userAgent: "Evidence Workbench test@example.com",
            reserveRequest: vi.fn(async () => undefined),
            recordAttempt: vi.fn(async (a: { status: string }) => ({
                shouldExecute: a.status === "started",
            })),
        });

        await expect(
            resolver.retrieveDocumentHtml("https://www.sec.gov/doc.pdf"),
        ).rejects.toThrow("Unsupported media type");
    });

    test("rejects streamed body exceeding 16 MiB limit without declared Content-Length", async () => {
        const chunk1 = new Uint8Array(10 * 1024 * 1024);
        const chunk2 = new Uint8Array(7 * 1024 * 1024);
        let chunkIndex = 0;
        const chunks = [chunk1, chunk2];

        const stream = new ReadableStream({
            pull(controller) {
                if (chunkIndex < chunks.length) {
                    controller.enqueue(chunks[chunkIndex++]);
                } else {
                    controller.close();
                }
            },
        });

        const fetchImplementation = vi.fn(
            async () =>
                new Response(stream, {
                    status: 200,
                    headers: {
                        "Content-Type": "text/html",
                    },
                }),
        );
        const resolver = createSecCompanyResolver({
            fetch: fetchImplementation,
            now: () => 1_000,
            userAgent: "Evidence Workbench test@example.com",
            reserveRequest: vi.fn(async () => undefined),
            recordAttempt: vi.fn(async (a: { status: string }) => ({
                shouldExecute: a.status === "started",
            })),
        });

        await expect(
            resolver.retrieveDocumentHtml("https://www.sec.gov/huge.htm"),
        ).rejects.toThrow("exceeds limit of 16777216 bytes during streaming");
    });

    test("aborts timed-out body streaming under deadline", async () => {
        const fetchImplementation = vi.fn(
            async () =>
                new Response(
                    new ReadableStream({
                        pull(_controller) {
                            // Hang indefinitely
                            return new Promise(() => {});
                        },
                    }),
                    {
                        status: 200,
                        headers: {
                            "Content-Type": "text/html",
                        },
                    },
                ),
        );
        const recordAttempt = vi.fn(async (attempt: { status: string }) => ({
            shouldExecute: attempt.status === "started",
        }));
        const resolver = createSecCompanyResolver({
            fetch: fetchImplementation,
            now: Date.now,
            userAgent: "Evidence Workbench test@example.com",
            reserveRequest: vi.fn(async () => undefined),
            recordAttempt,
            timeoutMs: 10,
        });

        await expect(
            resolver.retrieveDocumentHtml("https://www.sec.gov/hanging.htm"),
        ).rejects.toThrow("application timeout");
        expect(recordAttempt).toHaveBeenLastCalledWith(
            expect.objectContaining({
                status: "failed",
                attempt: 2,
                errorCode: "SecTimeoutError",
            }),
        );
    });

    test("removes abort listener on stream settle and does not leak listeners across chunks", async () => {
        const chunk1 = new TextEncoder().encode("<div>First Chunk</div>");
        const chunk2 = new TextEncoder().encode("<div>Second Chunk</div>");
        const chunk3 = new TextEncoder().encode("<div>Third Chunk</div>");
        let chunkIndex = 0;
        const chunks = [chunk1, chunk2, chunk3];
        let requestSignal: AbortSignal | undefined;
        const listenerCounts: number[] = [];

        const stream = new ReadableStream({
            pull(controller) {
                if (requestSignal)
                    listenerCounts.push(
                        getEventListeners(requestSignal, "abort").length,
                    );
                if (chunkIndex < chunks.length) {
                    controller.enqueue(chunks[chunkIndex++]);
                } else {
                    controller.close();
                }
            },
        });

        const fetchImplementation = vi.fn(
            async (_input: string | URL | Request, init?: RequestInit) => {
                if (!init?.signal) throw new Error("Missing request signal");
                requestSignal = init.signal;
                return new Response(stream, {
                    status: 200,
                    headers: {
                        "Content-Type": "text/html",
                    },
                });
            },
        );
        const resolver = createSecCompanyResolver({
            fetch: fetchImplementation,
            now: () => 1_000,
            userAgent: "Evidence Workbench test@example.com",
            reserveRequest: vi.fn(async () => undefined),
            recordAttempt: vi.fn(async (a: { status: string }) => ({
                shouldExecute: a.status === "started",
            })),
        });

        const result = await resolver.retrieveDocumentHtml(
            "https://www.sec.gov/multi-chunk.htm",
        );
        expect(result).toBe(
            "<div>First Chunk</div><div>Second Chunk</div><div>Third Chunk</div>",
        );
        expect(listenerCounts.length).toBeGreaterThan(1);
        expect(listenerCounts.every((count) => count === 1)).toBe(true);
        if (!requestSignal) throw new Error("No SEC request was made");
        expect(getEventListeners(requestSignal, "abort")).toHaveLength(0);
    });
});
