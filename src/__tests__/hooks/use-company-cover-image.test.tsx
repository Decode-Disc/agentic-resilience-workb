import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { useAction } = vi.hoisted(() => ({
    useAction: vi.fn(),
}));

const { resolveOgImage } = vi.hoisted(() => ({
    resolveOgImage: vi.fn(),
}));

vi.mock(import("convex/react"), () => ({ useAction }));
vi.mock(import("@/lib/workspace/og-image"), () => ({ resolveOgImage }));

import { useCompanyCoverImage } from "@/hooks/use-company-cover-image";

const FALLBACK = "/images/placeholders/research-dossier-cover.png";

function resetMocks() {
    useAction.mockReset();
    resolveOgImage.mockReset();
}

describe("useCompanyCoverImage", () => {
    beforeEach(resetMocks);

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test("returns placeholder when no candidate URL exists", () => {
        useAction.mockReturnValue(vi.fn());

        const { result } = renderHook(() =>
            useCompanyCoverImage(undefined, undefined),
        );

        expect(result.current.src).toBe(FALLBACK);
        expect(resolveOgImage).not.toHaveBeenCalled();
    });

    test("uses the OG image URL when resolution succeeds", async () => {
        useAction.mockReturnValue(vi.fn());
        resolveOgImage.mockResolvedValue("https://cdn.example.com/og.png");

        const { result } = renderHook(() =>
            useCompanyCoverImage("https://example.com/"),
        );

        await waitFor(() => {
            expect(result.current.src).toBe("https://cdn.example.com/og.png");
        });
    });

    test("falls back to screenshot when OG resolution fails", async () => {
        const renderPreview = vi.fn().mockResolvedValue({
            status: "ok",
            dataUrl: "data:image/png;base64,SHOT",
        });
        useAction.mockReturnValue(renderPreview);
        resolveOgImage.mockResolvedValue(null);

        const { result } = renderHook(() =>
            useCompanyCoverImage("https://example.com/"),
        );

        await waitFor(() => {
            expect(result.current.src).toBe("data:image/png;base64,SHOT");
        });
        expect(renderPreview).toHaveBeenCalledWith({
            url: "https://example.com/",
        });
    });

    test("falls back to placeholder when both tiers fail", async () => {
        const renderPreview = vi
            .fn()
            .mockResolvedValue({ status: "unavailable", error: "timeout" });
        useAction.mockReturnValue(renderPreview);
        resolveOgImage.mockResolvedValue(null);

        const { result } = renderHook(() =>
            useCompanyCoverImage("https://example.com/"),
        );

        await waitFor(() => {
            expect(result.current.src).toBe(FALLBACK);
        });
    });

    test("onError advances from OG to screenshot", async () => {
        const renderPreview = vi.fn().mockResolvedValue({
            status: "ok",
            dataUrl: "data:image/png;base64,SHOT",
        });
        useAction.mockReturnValue(renderPreview);
        resolveOgImage.mockResolvedValue("https://cdn.example.com/og.png");

        const { result } = renderHook(() =>
            useCompanyCoverImage("https://example.com/"),
        );

        await waitFor(() => {
            expect(result.current.src).toBe("https://cdn.example.com/og.png");
        });

        result.current.onError();

        await waitFor(() => {
            expect(result.current.src).toBe("data:image/png;base64,SHOT");
        });
    });
});
