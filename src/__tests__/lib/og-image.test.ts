import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resolveOgImage } from "@/lib/workspace/og-image";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => vi.stubGlobal("fetch", fetchMock));

afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
});

describe("resolveOgImage", () => {
    test("returns null for a non-HTTPS URL without calling fetch", async () => {
        await expect(resolveOgImage("http://example.com")).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("returns null for an invalid URL without calling fetch", async () => {
        await expect(resolveOgImage("not a url")).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("returns the og:image URL from the proxy response", async () => {
        fetchMock.mockResolvedValue(
            Response.json({
                ok: true,
                imageUrl: "https://cdn.example.com/og.png",
                imageOk: true,
            }),
        );
        const candidate =
            "https://reports.example.com/annual?year=2026&section=risks";
        await expect(resolveOgImage(candidate)).resolves.toBe(
            "https://cdn.example.com/og.png",
        );
        const [input, options] = fetchMock.mock.calls[0] ?? [];
        const requested = new URL(String(input));
        expect(requested.origin).toBe("https://api.poly.io");
        expect(requested.pathname).toBe("/og");
        expect([...requested.searchParams]).toEqual([["url", candidate]]);
        expect(options?.headers).toEqual({ Accept: "application/json" });
    });

    test("returns null when the proxy reports not-ok", async () => {
        fetchMock.mockResolvedValue(
            Response.json({ ok: false, error: "The site returned 403" }),
        );

        await expect(
            resolveOgImage("https://example.com/"),
        ).resolves.toBeNull();
    });

    test("returns null when the proxy reports an invalid image", async () => {
        fetchMock.mockResolvedValue(
            Response.json({
                ok: true,
                imageUrl: "https://cdn.example.com/og.png",
                imageOk: false,
            }),
        );

        await expect(
            resolveOgImage("https://example.com/"),
        ).resolves.toBeNull();
    });

    test.each([
        {
            label: "an HTTP failure",
            response: () =>
                Response.json(
                    { ok: true, imageUrl: "https://cdn.example.com/error.png" },
                    { status: 503 },
                ),
        },
        { label: "malformed JSON", response: () => new Response("not JSON") },
        {
            label: "a missing image",
            response: () => Response.json({ ok: true }),
        },
    ])("returns null for $label", async ({ response }) => {
        fetchMock.mockResolvedValue(response());
        await expect(
            resolveOgImage("https://example.com/"),
        ).resolves.toBeNull();
    });

    test("returns null when the proxy request fails", async () => {
        fetchMock.mockRejectedValue(new Error("network down"));

        await expect(
            resolveOgImage("https://example.com/"),
        ).resolves.toBeNull();
    });
});
