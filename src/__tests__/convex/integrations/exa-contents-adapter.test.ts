import {
    createExaContentsAdapter,
    type ExaContentsClient,
} from "@convex/integrations/exa";
import { describe, expect, test, vi } from "vitest";

describe("Exa Contents Adapter", () => {
    test("records a provider text limit before trimming trailing whitespace", async () => {
        const adapter = createExaContentsAdapter({
            getContents: async () => ({
                results: [
                    {
                        id: "bounded",
                        url: "https://example.com/bounded",
                        text: "A report\n\n",
                    },
                ],
            }),
        });
        expect(
            await adapter.retrieveText("https://example.com/bounded", {
                maxCharacters: 10,
            }),
        ).toMatchObject({ text: "A report", textLimitReached: true });
    });

    test("retrieves text-only contents for one canonical URL", async () => {
        const getContents = vi.fn(async () => ({
            results: [
                {
                    id: "exa-ref-123",
                    url: "https://example.com/article",
                    title: "Example Article",
                    text: "This is the article content for architectural resilience analysis.",
                },
            ],
            searchTime: 120,
            costDollars: { total: 0.005 },
        }));

        const client: ExaContentsClient = { getContents };
        const adapter = createExaContentsAdapter(client);

        const result = await adapter.retrieveText(
            "https://example.com/article",
        );

        expect(result).toEqual({
            text: "This is the article content for architectural resilience analysis.",
            providerReference: "exa-ref-123",
            title: "Example Article",
            searchTime: 120,
            costDollars: 0.005,
        });

        expect(getContents).toHaveBeenCalledTimes(1);
        expect(getContents).toHaveBeenCalledWith(
            ["https://example.com/article"],
            expect.objectContaining({
                text: { maxCharacters: 1_000_000 },
            }),
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
    });

    test("respects caller-supplied lower maxCharacters bound and clamps higher bound", async () => {
        const getContents = vi.fn(async () => ({
            results: [
                {
                    id: "exa-ref-bound",
                    url: "https://example.com/bound",
                    text: "Bound test content",
                },
            ],
        }));

        const adapter = createExaContentsAdapter({ getContents });

        // Lower bound is respected
        await adapter.retrieveText("https://example.com/bound", {
            maxCharacters: 2000,
        });
        expect(getContents).toHaveBeenLastCalledWith(
            ["https://example.com/bound"],
            expect.objectContaining({
                text: { maxCharacters: 2000 },
            }),
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );

        // The provider's character cap is lower than the application's byte cap.
        await adapter.retrieveText("https://example.com/bound", {
            maxCharacters: 50_000_000,
        });
        expect(getContents).toHaveBeenLastCalledWith(
            ["https://example.com/bound"],
            expect.objectContaining({
                text: { maxCharacters: 1_000_000 },
            }),
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
    });

    test("retries on retryable error up to two attempts", async () => {
        let calls = 0;
        const getContents = vi.fn(async () => {
            calls += 1;
            if (calls === 1) {
                const err: any = new Error("500 Internal Server Error");
                err.status = 500;
                err.name = "ExaServerError";
                throw err;
            }
            return {
                results: [
                    {
                        id: "exa-ref-456",
                        url: "https://example.com/retry",
                        text: "Recovered content after 500",
                    },
                ],
                searchTime: 80,
                costDollars: { total: 0.005 },
            };
        });

        const recordAttempt = vi.fn(async () => ({ shouldExecute: true }));
        const adapter = createExaContentsAdapter(
            { getContents },
            {
                recordAttempt,
                operationScope: "run:run1:gen:1:source:src1",
            },
        );

        const result = await adapter.retrieveText("https://example.com/retry");
        expect(result.text).toBe("Recovered content after 500");
        expect(getContents).toHaveBeenCalledTimes(2);
        expect(recordAttempt).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "started",
                attempt: 1,
                operation: "get_contents",
            }),
        );
        expect(recordAttempt).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "failed",
                attempt: 1,
                operation: "get_contents",
            }),
        );
        expect(recordAttempt).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "started",
                attempt: 2,
                operation: "get_contents",
            }),
        );
        expect(recordAttempt).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "succeeded",
                attempt: 2,
                operation: "get_contents",
            }),
        );
    });

    test("fails immediately on non-retryable error without second attempt", async () => {
        const getContents = vi.fn(async () => {
            const err = new Error("400 Bad Request: Invalid URL");
            err.name = "ExaClientError";
            throw err;
        });

        const recordAttempt = vi.fn(async () => ({ shouldExecute: true }));
        const adapter = createExaContentsAdapter(
            { getContents },
            {
                recordAttempt,
                operationScope: "run:run1:gen:1:source:src1",
            },
        );

        await expect(
            adapter.retrieveText("https://example.com/bad-request"),
        ).rejects.toThrow("400 Bad Request");
        expect(getContents).toHaveBeenCalledTimes(1);
    });

    test("enforces 120-second application-owned timeout", async () => {
        vi.useFakeTimers();
        try {
            const getContents = vi.fn(
                (
                    _urls: string[],
                    _options: unknown,
                    requestOptions?: { signal: AbortSignal },
                ) =>
                    new Promise<{
                        results: Array<{
                            id: string;
                            url: string;
                            text: string;
                        }>;
                    }>((_resolve, reject) => {
                        requestOptions?.signal.addEventListener(
                            "abort",
                            () => reject(requestOptions.signal.reason),
                            { once: true },
                        );
                    }),
            );

            const recordAttempt = vi.fn(async () => ({ shouldExecute: true }));
            const adapter = createExaContentsAdapter(
                { getContents },
                {
                    recordAttempt,
                    operationScope: "run:run1:gen:1:source:src1",
                    timeoutMs: 120_000,
                },
            );

            const promise = adapter.retrieveText("https://example.com/timeout");
            const expectation = expect(promise).rejects.toThrow(
                /exceeded its application timeout|timeout/i,
            );

            await vi.advanceTimersByTimeAsync(125_000);
            // After first timeout, retry starts and also times out
            await vi.advanceTimersByTimeAsync(125_000);

            await expectation;
            expect(getContents).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    test("rejects when response contains multiple results", async () => {
        const getContents = vi.fn(async () => ({
            results: [
                {
                    id: "exa-1",
                    url: "https://example.com/item",
                    text: "First result",
                },
                {
                    id: "exa-2",
                    url: "https://example.com/item",
                    text: "Second result",
                },
            ],
        }));

        const adapter = createExaContentsAdapter({ getContents });
        await expect(
            adapter.retrieveText("https://example.com/item"),
        ).rejects.toThrow(/multiple results|unexpected_result_count/i);
    });

    test("rejects when response URL does not match requested canonical URL", async () => {
        const getContents = vi.fn(async () => ({
            results: [
                {
                    id: "exa-diff",
                    url: "https://attacker.com/malicious",
                    text: "Malicious content",
                },
            ],
        }));

        const adapter = createExaContentsAdapter({ getContents });
        await expect(
            adapter.retrieveText("https://example.com/expected"),
        ).rejects.toThrow(/url mismatch/i);
    });

    test("accepts response when URL matches under equivalent deterministic canonicalization", async () => {
        const getContents = vi.fn(async () => ({
            results: [
                {
                    id: "exa-match",
                    url: "https://EXAMPLE.COM/path/",
                    text: "Valid content",
                },
            ],
        }));

        const adapter = createExaContentsAdapter({ getContents });
        const res = await adapter.retrieveText("https://example.com/path");
        expect(res.text).toBe("Valid content");
    });

    test("independently rejects raw Exa UTF-8 text exceeding MAX_APPROVED_SOURCE_BYTES", async () => {
        const oversizeText = "A".repeat(16 * 1024 * 1024 + 10);
        const getContents = vi.fn(async () => ({
            results: [
                {
                    id: "exa-oversize",
                    url: "https://example.com/oversize",
                    text: oversizeText,
                },
            ],
        }));

        const adapter = createExaContentsAdapter({ getContents });
        await expect(
            adapter.retrieveText("https://example.com/oversize"),
        ).rejects.toThrow(/exceeds limit|response_too_large/i);
    });

    test("does not retry on false-positive error message containing 500", async () => {
        const getContents = vi.fn(async () => {
            const err = new Error(
                "Search query returned 500 items from the archive",
            );
            err.name = "ExaQueryError";
            throw err;
        });

        const recordAttempt = vi.fn(async () => ({ shouldExecute: true }));
        const adapter = createExaContentsAdapter(
            { getContents },
            {
                recordAttempt,
                operationScope: "run:run1:gen:1:source:src1",
            },
        );

        await expect(
            adapter.retrieveText("https://example.com/false-positive"),
        ).rejects.toThrow("Search query returned 500 items");
        expect(getContents).toHaveBeenCalledTimes(1);
    });

    test("does not retry on arbitrary error message containing 500 without typed status or code", async () => {
        const getContents = vi.fn(async () => {
            const err = new Error("500 Internal Server Error");
            err.name = "ExaServerError";
            throw err;
        });

        const recordAttempt = vi.fn(async () => ({ shouldExecute: true }));
        const adapter = createExaContentsAdapter(
            { getContents },
            {
                recordAttempt,
                operationScope: "run:run1:gen:1:source:src1",
            },
        );

        await expect(
            adapter.retrieveText("https://example.com/untyped-500"),
        ).rejects.toThrow("500 Internal Server Error");
        expect(getContents).toHaveBeenCalledTimes(1);
    });

    test("retries on HTTP 501 and HTTP 505 status codes", async () => {
        for (const status of [501, 505]) {
            let calls = 0;
            const getContents = vi.fn(async () => {
                calls += 1;
                if (calls === 1) {
                    const err: any = new Error(`HTTP ${status} Server Error`);
                    err.status = status;
                    throw err;
                }
                return {
                    results: [
                        {
                            id: "exa-ok",
                            url: "https://example.com/retry-status",
                            text: "Recovered text",
                        },
                    ],
                };
            });

            const recordAttempt = vi.fn(async () => ({ shouldExecute: true }));
            const adapter = createExaContentsAdapter(
                { getContents },
                {
                    recordAttempt,
                    operationScope: "run:run1:gen:1:source:src1",
                },
            );

            const result = await adapter.retrieveText(
                "https://example.com/retry-status",
            );
            expect(result.text).toBe("Recovered text");
            expect(getContents).toHaveBeenCalledTimes(2);
        }
    });

    test("rejects an empty result list", async () => {
        const getContents = vi.fn(async () => ({
            results: [],
        }));

        const adapter = createExaContentsAdapter({ getContents });
        await expect(
            adapter.retrieveText("https://example.com/empty"),
        ).rejects.toThrow(/no contents returned/i);
    });

    test("rejects an empty document without retrying it", async () => {
        const getContents = vi.fn(async () => ({
            results: [
                {
                    id: "empty-document",
                    url: "https://example.com/empty",
                    text: "",
                },
            ],
        }));
        const adapter = createExaContentsAdapter({ getContents });
        await expect(
            adapter.retrieveText("https://example.com/empty"),
        ).rejects.toMatchObject({ errorCode: "no_text_returned" });
        expect(getContents).toHaveBeenCalledOnce();
    });

    test("Task5 defect 2: >16MiB leading/trailing whitespace whose trimmed value is small returns response_too_large and no success", async () => {
        const whitespaceOversize = `   ${" ".repeat(16 * 1024 * 1024 + 10)}Small valid text   `;
        const getContents = vi.fn(async () => ({
            results: [
                {
                    id: "exa-whitespace-oversize",
                    url: "https://example.com/whitespace-oversize",
                    text: whitespaceOversize,
                },
            ],
        }));

        const recordAttempt = vi.fn(async () => ({ shouldExecute: true }));
        const adapter = createExaContentsAdapter(
            { getContents },
            {
                recordAttempt,
                operationScope: "run:run1:gen:1:source:src1",
            },
        );

        await expect(
            adapter.retrieveText("https://example.com/whitespace-oversize"),
        ).rejects.toThrow(/exceeds limit|response_too_large/i);

        expect(recordAttempt).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "failed",
                errorCode: "response_too_large",
            }),
        );
        expect(recordAttempt).not.toHaveBeenCalledWith(
            expect.objectContaining({
                status: "succeeded",
            }),
        );
    });

    test("Task5 defect 3: ordinary TypeError not retried", async () => {
        const getContents = vi.fn(async () => {
            throw new TypeError(
                "Cannot read properties of undefined (reading 'foo')",
            );
        });

        const recordAttempt = vi.fn(async () => ({ shouldExecute: true }));
        const adapter = createExaContentsAdapter(
            { getContents },
            {
                recordAttempt,
                operationScope: "run:run1:gen:1:source:src1",
            },
        );

        await expect(
            adapter.retrieveText("https://example.com/type-error"),
        ).rejects.toThrow(TypeError);

        // Must NOT retry - called only 1 time
        expect(getContents).toHaveBeenCalledTimes(1);
    });

    test("Task5 defect 3: TypeError with ETIMEDOUT code is retried", async () => {
        let calls = 0;
        const getContents = vi.fn(async () => {
            calls += 1;
            if (calls === 1) {
                const err = new TypeError("fetch failed");
                (err as any).code = "ETIMEDOUT";
                throw err;
            }
            return {
                results: [
                    {
                        id: "exa-timeout-recovered",
                        url: "https://example.com/etimedout",
                        text: "Recovered text after ETIMEDOUT",
                    },
                ],
            };
        });

        const recordAttempt = vi.fn(async () => ({ shouldExecute: true }));
        const adapter = createExaContentsAdapter(
            { getContents },
            {
                recordAttempt,
                operationScope: "run:run1:gen:1:source:src1",
            },
        );

        const res = await adapter.retrieveText("https://example.com/etimedout");
        expect(res.text).toBe("Recovered text after ETIMEDOUT");
        // Must retry - called 2 times
        expect(getContents).toHaveBeenCalledTimes(2);
    });
});
