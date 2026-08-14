import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let server: Server;
const BASE_URL = "http://127.0.0.1:3099";
const SECRET = "test-secret-for-preview";

beforeAll(async () => {
    process.env.PREVIEW_SERVICE_SECRET = SECRET;
    process.env.PORT = "3099";
    process.env.MAX_CONCURRENT_RENDERS = "2";

    const mod = await import("../server.js");
    server = (mod as unknown as { __server: Server }).__server;
    await new Promise<void>((resolve) => server.listen(3099, resolve));
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
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
    it("rejects missing auth header", async () => {
        const res = await fetch(`${BASE_URL}/render`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: "https://example.com" }),
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

    it("rejects excessively large request body", async () => {
        const res = await fetch(`${BASE_URL}/render`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SECRET}`,
            },
            body: JSON.stringify({
                url: "https://example.com",
                extra: "x".repeat(11000),
            }),
        });
        expect(res.status).toBe(413);
    });
});

describe("/render success", () => {
    it("returns PNG for a valid public URL", async () => {
        const res = await fetch(`${BASE_URL}/render`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SECRET}`,
            },
            body: JSON.stringify({ url: "https://example.com" }),
        });
        expect(res.status).toBe(200);
        const contentType = res.headers.get("content-type");
        expect(contentType).toContain("image/png");
        const buffer = await res.arrayBuffer();
        expect(buffer.byteLength).toBeGreaterThan(100);
    }, 30000);
});

describe("/render concurrency", () => {
    it("handles 3 concurrent requests within limits", async () => {
        const results = await Promise.allSettled([
            fetch(`${BASE_URL}/render`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${SECRET}`,
                },
                body: JSON.stringify({ url: "https://example.com" }),
            }),
            fetch(`${BASE_URL}/render`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${SECRET}`,
                },
                body: JSON.stringify({ url: "https://example.com" }),
            }),
            fetch(`${BASE_URL}/render`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${SECRET}`,
                },
                body: JSON.stringify({ url: "https://example.com" }),
            }),
        ]);

        // All should settle (fulfilled or rejected), and any fulfilled
        // ones should return a valid status.
        const fulfilled = results.filter(
            (r) => r.status === "fulfilled",
        );
        expect(fulfilled.length).toBeGreaterThanOrEqual(2);
        for (const r of fulfilled) {
            const status = (r as PromiseFulfilledResult<Response>).value.status;
            expect([200, 422, 429]).toContain(status);
        }
    }, 35000);
});

describe("unknown route", () => {
    it("returns 404 for unknown paths", async () => {
        const res = await fetch(`${BASE_URL}/unknown`);
        expect(res.status).toBe(404);
    });
});
