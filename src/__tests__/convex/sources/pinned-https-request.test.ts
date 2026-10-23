import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";

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

describe("requestPinnedPublicSource", () => {
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
    test("H4: terminates with request_timeout and destroys request/response on slow trickle response past deadline", async () => {
        const mockResponse = new EventEmitter() as any;
        mockResponse.socket = { remoteAddress: "93.184.216.34" };
        mockResponse.headers = {
            "content-type": "text/html",
            "content-encoding": "identity",
        };
        mockResponse.statusCode = 200;
        mockResponse.destroy = vi.fn();

        let createdReq: any;
        mockHttpsRequest.mockImplementationOnce(
            (_url: any, _options: any, callback: any) => {
                const req = new EventEmitter() as any;
                req.destroy = vi.fn();
                req.end = vi.fn(() => {
                    setTimeout(() => {
                        callback(mockResponse);
                        mockResponse.emit("data", Buffer.from("<htm"));
                    }, 10);
                });
                createdReq = req;
                return req;
            },
        );

        const promise = requestPinnedPublicSource(
            "https://example.com/trickle",
            "93.184.216.34",
            { timeoutMs: 40 },
        );

        await expect(promise).rejects.toMatchObject({
            data: { code: "request_timeout" },
        });

        expect(createdReq.destroy).toHaveBeenCalled();
        expect(mockResponse.destroy).toHaveBeenCalled();
    });

    test("H4: settles cleanly on normal response and clears timer without error", async () => {
        const mockResponse = new EventEmitter() as any;
        mockResponse.socket = { remoteAddress: "93.184.216.34" };
        mockResponse.headers = {
            "content-type": "text/html",
            "content-encoding": "identity",
        };
        mockResponse.statusCode = 200;
        mockResponse.destroy = vi.fn();

        mockHttpsRequest.mockImplementationOnce(
            (_url: any, _options: any, callback: any) => {
                const req = new EventEmitter() as any;
                req.destroy = vi.fn();
                req.end = vi.fn(() => {
                    setTimeout(() => {
                        callback(mockResponse);
                        mockResponse.emit(
                            "data",
                            Buffer.from("<html>Clean</html>"),
                        );
                        mockResponse.emit("end");
                    }, 10);
                });
                return req;
            },
        );

        const response = await requestPinnedPublicSource(
            "https://example.com/fast",
            "93.184.216.34",
            { timeoutMs: 200 },
        );

        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toBe("<html>Clean</html>");
    });
});
