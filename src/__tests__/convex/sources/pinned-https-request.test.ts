import { EventEmitter, getEventListeners } from "node:events";
import type { RequestOptions } from "node:https";
import { getActiveResourcesInfo } from "node:process";
import { afterEach, assert, describe, expect, test, vi } from "vitest";

const { mockHttpsRequest } = vi.hoisted(() => {
    const mockHttpsRequest = vi.fn(
        (_url: any, _options: any, _callback: any) => {
            const req = new EventEmitter() as any;
            req.destroy = vi.fn();
            req.end = vi.fn();
            return req;
        },
    );
    return { mockHttpsRequest };
});

vi.mock("node:https", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:https")>();
    return {
        ...actual,
        default: {
            ...((actual as any).default ?? {}),
            request: mockHttpsRequest,
        },
        request: mockHttpsRequest,
    };
});

import { requestPinnedPublicSource } from "@convex/sourceActions";

afterEach(() => vi.useRealTimers());

describe("requestPinnedPublicSource", () => {
    test.each([
        { suffix: "d", rejected: false },
        { suffix: "é", rejected: true },
    ])("streamed PDF bytes enforce the supplied limit with multibyte overflow=$rejected", async ({
        suffix,
        rejected,
    }) => {
        const response = Object.assign(new EventEmitter(), {
            socket: { remoteAddress: "93.184.216.34" },
            headers: { "content-type": "application/pdf" },
            statusCode: 200,
            destroy: vi.fn((error?: Error) => {
                if (error) response.emit("error", error);
            }),
        });
        mockHttpsRequest.mockImplementationOnce((_url, _options, callback) =>
            Object.assign(new EventEmitter(), {
                destroy: vi.fn(),
                end: vi.fn(() => {
                    callback(response);
                    response.emit("data", Buffer.from("abc"));
                    response.emit("data", Buffer.from(suffix));
                    response.emit("end");
                }),
            }),
        );
        const pending = requestPinnedPublicSource(
            "https://example.com/streamed.pdf",
            "93.184.216.34",
            {
                maxBytes: 4,
                allowPdfBody: true,
            },
        );
        if (rejected) {
            await expect(pending).rejects.toMatchObject({
                data: { code: "response_too_large" },
            });
            expect(response.destroy).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        code: "response_too_large",
                    }),
                }),
            );
        } else {
            expect(await (await pending).text()).toBe("abcd");
            expect(response.destroy).not.toHaveBeenCalled();
        }
    });
    test.each([
        { address: "93.184.216.34", family: 4 },
        { address: "2001:4860:4860::8888", family: 6 },
    ])("the Node lookup contract retains only the approved $address in single and all-address modes", async ({
        address,
        family,
    }) => {
        const controller = new AbortController();
        const pending = requestPinnedPublicSource(
            "https://www.sec.gov/Archives/edgar/document.htm",
            address,
            { signal: controller.signal },
        );
        try {
            const requestOptions: RequestOptions =
                mockHttpsRequest.mock.lastCall?.[1];
            assert(requestOptions.lookup);
            const resolved = vi.fn();
            requestOptions.lookup("www.sec.gov", { all: true }, resolved);
            expect(resolved).toHaveBeenCalledExactlyOnceWith(null, [
                { address, family },
            ]);
            resolved.mockClear();
            requestOptions.lookup("www.sec.gov", { all: false }, resolved);
            expect(resolved).toHaveBeenCalledExactlyOnceWith(
                null,
                address,
                family,
            );
        } finally {
            controller.abort(new Error("lookup contract fixture finished"));
            await expect(pending).rejects.toThrow(
                "lookup contract fixture finished",
            );
        }
    });
    test("preserves provider identification and aborts a pinned request on cancellation", async () => {
        const controller = new AbortController();
        const promise = requestPinnedPublicSource(
            "https://data.sec.gov/submissions/CIK0000320193.json",
            "93.184.216.34",
            {
                headers: {
                    Accept: "application/json",
                    "User-Agent": "Research research@example.com",
                },
                signal: controller.signal,
                timeoutMs: 50,
            },
        );
        controller.abort(new Error("cancelled"));
        await expect(promise).rejects.toThrow("cancelled");
        expect(mockHttpsRequest.mock.lastCall?.[1].headers).toMatchObject({
            Accept: "application/json",
            "User-Agent": "Research research@example.com",
            Host: "data.sec.gov",
        });
    });
    test("a trickle cannot postpone the deadline or prevent request/response cancellation", async () => {
        vi.useFakeTimers();
        const response = Object.assign(new EventEmitter(), {
            socket: { remoteAddress: "93.184.216.34" },
            headers: { "content-type": "text/html" },
            statusCode: 200,
            destroy: vi.fn(),
        });
        const destroyRequest = vi.fn();
        mockHttpsRequest.mockImplementationOnce((_url, _options, receive) =>
            Object.assign(new EventEmitter(), {
                destroy: destroyRequest,
                end() {
                    receive(response);
                    response.emit("data", Buffer.from("<htm"));
                },
            }),
        );
        const pending = requestPinnedPublicSource(
            "https://example.com/trickle",
            "93.184.216.34",
            { timeoutMs: 40 },
        );
        const rejection = expect(pending).rejects.toMatchObject({
            data: { code: "request_timeout" },
        });
        await vi.advanceTimersByTimeAsync(39);
        response.emit("data", Buffer.from("l>"));
        expect(destroyRequest).not.toHaveBeenCalled();
        expect(response.destroy).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await rejection;
        expect(destroyRequest).toHaveBeenCalledOnce();
        expect(response.destroy).toHaveBeenCalledOnce();
    });

    test.each([
        "controlled",
        "native",
    ] as const)("successful completion releases the %s timer and abort listener", async (clock) => {
        if (clock === "controlled") vi.useFakeTimers();
        // Let Vitest install its own test deadline before measuring native resources.
        await Promise.resolve();
        const countTimers = () =>
            clock === "controlled"
                ? vi.getTimerCount()
                : getActiveResourcesInfo().filter((type) => type === "Timeout")
                      .length;
        const before = countTimers();
        const controller = new AbortController();
        const destroyRequest = vi.fn();
        const response = Object.assign(new EventEmitter(), {
            socket: { remoteAddress: "93.184.216.34" },
            headers: { "content-type": "text/html" },
            statusCode: 200,
            destroy: vi.fn(),
        });
        mockHttpsRequest.mockImplementationOnce((_url, _options, receive) =>
            Object.assign(new EventEmitter(), {
                destroy: destroyRequest,
                end() {
                    receive(response);
                    response.emit("data", Buffer.from("<html>Clean</html>"));
                    response.emit("end");
                },
            }),
        );
        const result = await requestPinnedPublicSource(
            "https://example.com/fast",
            "93.184.216.34",
            { timeoutMs: 200, signal: controller.signal },
        );
        expect(result.status).toBe(200);
        expect(await result.text()).toBe("<html>Clean</html>");
        expect(countTimers()).toBe(before);
        expect(getEventListeners(controller.signal, "abort")).toEqual([]);
        controller.abort(new Error("Caller has moved on"));
        if (clock === "controlled") await vi.advanceTimersByTimeAsync(200);
        expect(destroyRequest).not.toHaveBeenCalled();
        expect(response.destroy).not.toHaveBeenCalled();
    });
});
