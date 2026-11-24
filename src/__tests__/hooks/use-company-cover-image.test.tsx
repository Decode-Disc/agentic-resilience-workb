import { api } from "@convex/_generated/api";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";
import { deferred } from "@/__tests__/setup/deferred";

vi.mock(
    "convex/react",
    async () =>
        (await import("@/__tests__/helpers/convex-react-harness"))
            .convexReactHarness.module,
);

import { useCompanyCoverImage } from "@/hooks/use-company-cover-image";

const FALLBACK = "/images/placeholders/research-dossier-cover.png";
const SHOT = "data:image/png;base64,SHOT";
const fetchOg = vi.fn<typeof fetch>();
const renderPreview =
    vi.fn<
        (
            args: FunctionArgs<
                typeof api.companyCoverImage.renderCompanyPreview
            >,
        ) => Promise<
            FunctionReturnType<
                typeof api.companyCoverImage.renderCompanyPreview
            >
        >
    >();

describe("useCompanyCoverImage", () => {
    beforeEach(() => {
        renderPreview
            .mockReset()
            .mockResolvedValue({ status: "ok", dataUrl: SHOT });
        convexReactHarness.reset();
        convexReactHarness
            .action(api.companyCoverImage.renderCompanyPreview)
            .uses(renderPreview);
        fetchOg
            .mockReset()
            .mockImplementation(async () => Response.json({ ok: false }));
        vi.stubGlobal("fetch", fetchOg);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    test("returns placeholder without remote work when no candidate URL exists", () => {
        const { result } = renderHook(() => useCompanyCoverImage());
        expect(result.current.src).toBe(FALLBACK);
        expect(fetchOg).not.toHaveBeenCalled();
        expect(renderPreview).not.toHaveBeenCalled();
    });

    test("uses the website OG image before investor relations or a screenshot", async () => {
        fetchOg.mockImplementation(async () =>
            Response.json({
                ok: true,
                imageUrl: "https://cdn.example.com/og.png",
            }),
        );
        const { result } = renderHook(() =>
            useCompanyCoverImage(
                "https://og-cover.example/",
                "https://investors.example/",
            ),
        );
        await waitFor(() =>
            expect(result.current.src).toBe("https://cdn.example.com/og.png"),
        );
        const request = new URL(String(fetchOg.mock.calls[0]?.[0]));
        expect(request.searchParams.get("url")).toBe(
            "https://og-cover.example/",
        );
        expect(renderPreview).not.toHaveBeenCalled();
    });

    test("uses investor relations when the website is absent and OG has no image", async () => {
        const { result } = renderHook(() =>
            useCompanyCoverImage(undefined, "https://ir-cover.example/"),
        );
        await waitFor(() => expect(result.current.src).toBe(SHOT));
        expect(renderPreview).toHaveBeenCalledWith({
            url: "https://ir-cover.example/",
        });
    });

    test.each([
        "unavailable",
        "rejected",
    ] as const)("settles to placeholder after the screenshot is %s", async (outcome) => {
        const pending = deferred<Awaited<ReturnType<typeof renderPreview>>>();
        renderPreview.mockImplementation(async () => {
            await pending.promise;
            if (outcome === "rejected")
                throw new Error("Preview connection failed");
            return { status: "unavailable", error: "timeout" };
        });
        const { result, unmount } = renderHook(() =>
            useCompanyCoverImage(`https://${outcome}-cover.example/`),
        );
        await waitFor(() => expect(renderPreview).toHaveBeenCalledTimes(1));
        await act(async () => {
            pending.resolve({ status: "unavailable", error: "timeout" });
        });
        expect(result.current.src).toBe(FALLBACK);
        unmount();
        const cached = renderHook(() =>
            useCompanyCoverImage(`https://${outcome}-cover.example/`),
        );
        await act(async () => {});
        expect(cached.result.current.src).toBe(FALLBACK);
        expect(renderPreview).toHaveBeenCalledTimes(1);
    });

    test("advances failed OG and screenshot images to the next tier", async () => {
        fetchOg.mockImplementation(async () =>
            Response.json({
                ok: true,
                imageUrl: "https://cdn.example.com/failing-og.png",
            }),
        );
        const { result } = renderHook(() =>
            useCompanyCoverImage("https://load-error-cover.example/"),
        );
        await waitFor(() =>
            expect(result.current.src).toBe(
                "https://cdn.example.com/failing-og.png",
            ),
        );
        act(() => result.current.onError());
        await waitFor(() => expect(result.current.src).toBe(SHOT));
        act(() => result.current.onError());
        expect(result.current.src).toBe(FALLBACK);
    });

    test("requests the new identity after the previous screenshot completed", async () => {
        renderPreview.mockImplementation(async ({ url }) => ({
            status: "ok",
            dataUrl: `data:image/png;base64,${new URL(url).hostname}`,
        }));
        const { result, rerender } = renderHook(
            ({ url }) => useCompanyCoverImage(url),
            { initialProps: { url: "https://completed-a.example/" } },
        );
        await waitFor(() =>
            expect(result.current.src).toBe(
                "data:image/png;base64,completed-a.example",
            ),
        );
        rerender({ url: "https://completed-b.example/" });
        expect(result.current.src).toBe(FALLBACK);
        await waitFor(() =>
            expect(result.current.src).toBe(
                "data:image/png;base64,completed-b.example",
            ),
        );
    });

    test("ignores a delayed screenshot from the previous identity", async () => {
        const old = deferred<Awaited<ReturnType<typeof renderPreview>>>();
        renderPreview.mockImplementation(({ url }) =>
            url.includes("delayed-a")
                ? old.promise
                : Promise.resolve({ status: "ok", dataUrl: SHOT }),
        );
        const { result, rerender } = renderHook(
            ({ url }) => useCompanyCoverImage(url),
            { initialProps: { url: "https://delayed-a.example/" } },
        );
        await waitFor(() =>
            expect(renderPreview).toHaveBeenCalledWith({
                url: "https://delayed-a.example/",
            }),
        );
        fetchOg.mockImplementation(async () =>
            Response.json({
                ok: true,
                imageUrl: "https://cdn.example.com/b.png",
            }),
        );
        rerender({ url: "https://delayed-b.example/" });
        await waitFor(() =>
            expect(result.current.src).toBe("https://cdn.example.com/b.png"),
        );
        expect(renderPreview).toHaveBeenCalledTimes(1);
        await act(async () => {
            old.resolve({ status: "ok", dataUrl: "data:image/png;base64,OLD" });
        });
        act(() => result.current.onError());
        await waitFor(() => expect(result.current.src).toBe(SHOT));
        expect(renderPreview).toHaveBeenCalledWith({
            url: "https://delayed-b.example/",
        });
    });

    test("does not carry a failed screenshot into a new identity", async () => {
        renderPreview.mockResolvedValueOnce({
            status: "unavailable",
            error: "timeout",
        });
        const { result, rerender } = renderHook(
            ({ url }) => useCompanyCoverImage(url),
            { initialProps: { url: "https://failed-a.example/" } },
        );
        await act(async () => {});
        expect(renderPreview).toHaveBeenCalledWith({
            url: "https://failed-a.example/",
        });
        expect(result.current.src).toBe(FALLBACK);
        rerender({ url: "https://failed-b.example/" });
        await waitFor(() => expect(result.current.src).toBe(SHOT));
    });

    test("ignores an old image error after another identity has loaded", async () => {
        fetchOg.mockImplementation(async (input) => {
            const candidate = new URL(String(input)).searchParams.get("url");
            return Response.json({ ok: true, imageUrl: `${candidate}og.png` });
        });
        const { result, rerender } = renderHook(
            ({ url }) => useCompanyCoverImage(url),
            { initialProps: { url: "https://old-error-a.example/" } },
        );
        await waitFor(() =>
            expect(result.current.src).toBe(
                "https://old-error-a.example/og.png",
            ),
        );
        const oldImage = result.current;
        rerender({ url: "https://old-error-b.example/" });
        await waitFor(() =>
            expect(result.current.src).toBe(
                "https://old-error-b.example/og.png",
            ),
        );
        await act(async () => oldImage.onError());
        expect(result.current.src).toBe("https://old-error-b.example/og.png");
        expect(renderPreview).not.toHaveBeenCalled();
    });

    test("reuses a completed screenshot after a StrictMode remount", async () => {
        const pending = deferred<Awaited<ReturnType<typeof renderPreview>>>();
        renderPreview.mockReturnValue(pending.promise);
        const first = renderHook(
            () => useCompanyCoverImage("https://shared-cover.example/"),
            { wrapper: StrictMode },
        );
        await waitFor(() => expect(renderPreview).toHaveBeenCalledTimes(1));
        await act(async () => {
            pending.resolve({ status: "ok", dataUrl: SHOT });
        });
        await waitFor(() => expect(first.result.current.src).toBe(SHOT));
        first.unmount();
        const second = renderHook(
            () => useCompanyCoverImage("https://shared-cover.example/"),
            { wrapper: StrictMode },
        );
        await waitFor(() => expect(second.result.current.src).toBe(SHOT));
        expect(renderPreview).toHaveBeenCalledTimes(1);
    });
});
