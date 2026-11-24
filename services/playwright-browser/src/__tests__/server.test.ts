import { once } from "node:events";
import {
    request as httpRequest,
    type IncomingMessage,
    type Server,
} from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import policy from "../resource-policy.generated.json" with { type: "json" };

let server: Server;
let BASE_URL: string;
let logServerStarted: (server: Server) => void;
const SECRET = "test-secret-for-preview";

beforeAll(async () => {
    vi.stubEnv("PREVIEW_SERVICE_SECRET", SECRET);
    vi.stubEnv("PORT", "0");
    vi.stubEnv("MAX_CONCURRENT_RENDERS", "2");

    const mod = await import("../server.js");
    server = mod.__server;
    logServerStarted = mod.logServerStarted;
    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("Missing preview listener address");
    BASE_URL = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
    try {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    } finally {
        vi.unstubAllEnvs();
    }
});

describe("startup logging", () => {
    it("reports the port actually bound when the requested port is zero", () => {
        const address = server.address();
        if (!address || typeof address === "string")
            throw new Error("Missing preview listener address");
        const chunks: string[] = [];
        const write = vi
            .spyOn(process.stderr, "write")
            .mockImplementation((chunk) => {
                chunks.push(String(chunk));
                return true;
            });
        try {
            logServerStarted(server);
        } finally {
            write.mockRestore();
        }
        expect(JSON.parse(chunks.join(""))).toMatchObject({
            event: "server_started",
            origin: `http://127.0.0.1:${address.port}`,
            port: address.port,
        });
    });
});

describe("/health", () => {
    it("returns 200 without auth", async () => {
        const res = await fetch(`${BASE_URL}/health`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({ status: "ok" });
    });
});

describe("/render auth", () => {
    it("rejects missing auth before reading an oversized body", async () => {
        const res = await fetch(`${BASE_URL}/render`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "x".repeat(policy.requestBodyBytes + 1),
        });
        expect(res.status).toBe(401);
    });

    it("rejects wrong auth header", async () => {
        const res = await fetch(`${BASE_URL}/render`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer wrong-secret",
            },
            body: JSON.stringify({ url: "https://example.com" }),
        });
        expect(res.status).toBe(401);
    });
});

describe("/render validation", () => {
    it("rejects missing url field", async () => {
        const res = await fetch(`${BASE_URL}/render`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SECRET}`,
            },
            body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
    });

    it("rejects non-HTTPS URL", async () => {
        const res = await fetch(`${BASE_URL}/render`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SECRET}`,
            },
            body: JSON.stringify({ url: "http://example.com" }),
        });
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("https_required");
    });

    it("rejects URL with credentials", async () => {
        const res = await fetch(`${BASE_URL}/render`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SECRET}`,
            },
            body: JSON.stringify({ url: "https://user:pass@example.com" }),
        });
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("credentials_not_allowed");
    });

    it("rejects invalid URL", async () => {
        const res = await fetch(`${BASE_URL}/render`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SECRET}`,
            },
            body: JSON.stringify({ url: "not-a-url" }),
        });
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("invalid_url");
    });

    it.each([
        0, 1,
    ])("counts request body bytes at the limit plus %i", async (extraBytes) => {
        const paddingBytes =
            policy.requestBodyBytes +
            extraBytes -
            Buffer.byteLength(JSON.stringify({ url: "not-a-url", extra: "" }));
        const body = JSON.stringify({
            url: "not-a-url",
            extra:
                "é".repeat(Math.floor(paddingBytes / 2)) +
                "x".repeat(paddingBytes % 2),
        });
        expect(Buffer.byteLength(body)).toBe(
            policy.requestBodyBytes + extraBytes,
        );
        const res = await fetch(`${BASE_URL}/render`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SECRET}`,
            },
            body,
        });
        expect(res.status).toBe(extraBytes === 0 ? 422 : 413);
        expect(await res.json()).toMatchObject({
            error: extraBytes === 0 ? "invalid_url" : "Request body too large",
        });
    });
});

/** Exposes real HTTP stream boundaries so tests can control chunk arrival and disconnects. */
function openRenderRequest() {
    const received = new Promise<IncomingMessage>((resolve) =>
        server.once("request", resolve),
    );
    const request = httpRequest(`${BASE_URL}/render`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SECRET}`,
        },
    });
    const response = new Promise<{ status: number | undefined; body: string }>(
        (resolve, reject) => {
            request.on("error", reject);
            request.on("response", (incoming) => {
                let body = "";
                incoming.setEncoding("utf8");
                incoming.on("data", (chunk: string) => {
                    body += chunk;
                });
                incoming.on("error", reject);
                incoming.on("end", () =>
                    resolve({ status: incoming.statusCode, body }),
                );
            });
        },
    );
    request.flushHeaders();
    return { request, received, response };
}

describe("request body lifecycle", () => {
    it.each([
        "null",
        "42",
    ])("rejects non-object JSON %s without losing the listener", async (body) => {
        const response = await fetch(`${BASE_URL}/render`, {
            method: "POST",
            headers: { Authorization: `Bearer ${SECRET}` },
            body,
            signal: AbortSignal.timeout(5000),
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
            error: expect.any(String),
        });
        expect((await fetch(`${BASE_URL}/health`)).status).toBe(200);
    });

    it("rejects malformed JSON separately from shape validation", async () => {
        const response = await fetch(`${BASE_URL}/render`, {
            method: "POST",
            headers: { Authorization: `Bearer ${SECRET}` },
            body: "{",
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "Invalid JSON body" });
    });

    it("preserves a UTF-8 URL split across received chunks", async () => {
        const body = Buffer.from(
            JSON.stringify({ url: "http://é.example.test/" }),
        );
        const split = body.indexOf(Buffer.from("é")) + 1;
        const { request, received, response } = openRenderRequest();
        try {
            const incoming = await received;
            const firstChunk = once(incoming, "data");
            request.write(body.subarray(0, split));
            await firstChunk;
            request.end(body.subarray(split));
            const result = await response;
            expect(result.status).toBe(422);
            expect(JSON.parse(result.body)).toMatchObject({
                error: "https_required",
            });
        } finally {
            request.destroy();
        }
    });

    it("rejects overflow while the body is open and remains usable after further chunks", async () => {
        const { request, received, response } = openRenderRequest();
        try {
            const incoming = await received;
            request.write(Buffer.alloc(policy.requestBodyBytes + 1, "x"));
            const result = await response;
            expect(result).toEqual({
                status: 413,
                body: JSON.stringify({ error: "Request body too large" }),
            });
            let drainedBytes = 0;
            incoming.on("data", (chunk: Buffer) => {
                drainedBytes += chunk.byteLength;
            });
            const ended = once(incoming, "end");
            request.end(Buffer.alloc(policy.requestBodyBytes, "x"));
            await ended;
            expect(drainedBytes).toBe(policy.requestBodyBytes);
            expect((await fetch(`${BASE_URL}/health`)).status).toBe(200);
        } finally {
            request.destroy();
        }
    });

    it("survives a client disconnect during a partial body", async () => {
        const { request, received, response } = openRenderRequest();
        const rejected = expect(response).rejects.toMatchObject({
            code: "ECONNRESET",
        });
        try {
            const incoming = await received;
            const firstChunk = once(incoming, "data");
            request.write('{"url":');
            await firstChunk;
            const aborted = new Promise<void>((resolve) =>
                incoming.once("aborted", resolve),
            );
            request.destroy();
            await Promise.all([aborted, rejected]);
            expect((await fetch(`${BASE_URL}/health`)).status).toBe(200);
        } finally {
            request.destroy();
        }
    });
});

describe("unknown route", () => {
    it("returns 404 for unknown paths", async () => {
        const res = await fetch(`${BASE_URL}/unknown`);
        expect(res.status).toBe(404);
    });
});
