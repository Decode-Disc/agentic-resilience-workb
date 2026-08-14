import { afterEach, describe, expect, test, vi } from "vitest";
import { resolveOgImage } from "@/lib/workspace/og-image";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
    fetchMock.mockReset();
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
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({
                ok: true,
                imageUrl: "https://cdn.example.com/og.png",
                imageOk: true,
            }),
        });

        await expect(resolveOgImage("https://example.com/")).resolves.toBe(
            "https://cdn.example.com/og.png",
        );
    });

    test("returns null when the proxy reports not-ok", async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ ok: false, error: "The site returned 403" }),
        });

        await expect(
            resolveOgImage("https://example.com/"),
        ).resolves.toBeNull();
    });

    test("returns null when the proxy reports an invalid image", async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({
                ok: true,
                imageUrl: "https://cdn.example.com/og.png",
                imageOk: false,
            }),
        });

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
