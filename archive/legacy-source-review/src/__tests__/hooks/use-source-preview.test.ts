import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { useAction, useQuery } = vi.hoisted(() => ({
    useAction: vi.fn(),
    useQuery: vi.fn(),
}));

vi.mock(import("convex/react"), () => ({ useAction, useQuery }));

import { useSourcePreview } from "@/hooks/use-source-preview";

const sourceId = "src_123" as never;
const runId = "run_456" as never;

function resetMocks() {
    useAction.mockReset();
    useQuery.mockReset();
}

describe("useSourcePreview", () => {
    beforeEach(resetMocks);

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test.each([
        { source: sourceId, run: undefined },
        { source: undefined, run: runId },
    ])("keeps a disconnected source preview unavailable without backend work: $source / $run", ({
        source,
        run,
    }) => {
        useQuery.mockReturnValue(undefined);
        const renderPreview = vi.fn();
        useAction.mockReturnValue(renderPreview);
        const { result } = renderHook(() =>
            useSourcePreview(source, run, "pending"),
        );
        expect(result.current).toEqual({
            status: "unavailable",
            reason: "no_context",
        });
        expect(useQuery).toHaveBeenCalledWith(expect.anything(), "skip");
        expect(renderPreview).not.toHaveBeenCalled();
    });

    test("skips and reports unavailable for a decided source", () => {
        useQuery.mockReturnValue(undefined);
        useAction.mockReturnValue(vi.fn());

        const { result } = renderHook(() =>
            useSourcePreview(sourceId, runId, "accepted"),
        );

        expect(result.current).toEqual({
            status: "unavailable",
            reason: "not_pending",
        });
    });

    test("returns screenshot immediately from a cached preview", () => {
        useQuery.mockReturnValue({ dataUrl: "data:image/png;base64,CACHED" });
        useAction.mockReturnValue(vi.fn());

        const { result } = renderHook(() =>
            useSourcePreview(sourceId, runId, "pending"),
        );

        expect(result.current).toEqual({
            status: "screenshot",
            dataUrl: "data:image/png;base64,CACHED",
        });
    });

    test("renders on cache miss and surfaces the rendered screenshot", async () => {
        useQuery.mockReturnValue(null); // confirmed miss
        const renderPreview = vi.fn().mockResolvedValue({
            status: "ok",
            base64: "data:image/png;base64,RENDERED",
        });
        useAction.mockReturnValue(renderPreview);

        const { result } = renderHook(() =>
            useSourcePreview(sourceId, runId, "pending"),
        );

        // While rendering, it shows loading.
        expect(result.current).toEqual({ status: "loading" });

        await waitFor(() =>
            expect(result.current).toEqual({
                status: "screenshot",
                dataUrl: "data:image/png;base64,RENDERED",
            }),
        );

        expect(renderPreview).toHaveBeenCalledWith({ sourceId, runId });
    });

    test.each([
        "screenshot",
        "failure",
        "late",
    ] as const)("switching sources cannot reuse the previous source's %s", async (previous) => {
        useQuery.mockReturnValue(null);
        let resolveFirst!: (
            value:
                | { status: "ok"; base64: string }
                | { status: "unavailable"; error: string },
        ) => void;
        let resolveSecond!: (value: { status: "ok"; base64: string }) => void;
        const renderPreview = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveFirst = resolve;
                    }),
            )
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveSecond = resolve;
                    }),
            );
        useAction.mockReturnValue(renderPreview);
        const { result, rerender } = renderHook(
            ({ source }) => useSourcePreview(source, runId, "pending"),
            { initialProps: { source: sourceId } },
        );
        const firstResult =
            previous === "failure"
                ? { status: "unavailable" as const, error: "render_failed" }
                : {
                      status: "ok" as const,
                      base64: "data:image/png;base64,FIRST",
                  };
        if (previous !== "late")
            await act(async () => resolveFirst(firstResult));
        rerender({ source: "src_other" as never });
        expect(result.current).toEqual({ status: "loading" });
        if (previous === "late") {
            await act(async () => resolveFirst(firstResult));
            expect(result.current).toEqual({ status: "loading" });
        }
        expect(renderPreview).toHaveBeenLastCalledWith({
            sourceId: "src_other",
            runId,
        });
        await act(async () =>
            resolveSecond({
                status: "ok",
                base64: "data:image/png;base64,SECOND",
            }),
        );
        expect(result.current).toEqual({
            status: "screenshot",
            dataUrl: "data:image/png;base64,SECOND",
        });
    });

    test("reports unavailable when rendering fails", async () => {
        useQuery.mockReturnValue(null);
        const renderPreview = vi.fn().mockResolvedValue({
            status: "unavailable",
            error: "render_failed",
        });
        useAction.mockReturnValue(renderPreview);

        const { result } = renderHook(() =>
            useSourcePreview(sourceId, runId, "pending"),
        );

        await waitFor(() =>
            expect(result.current).toEqual({
                status: "unavailable",
                reason: "render_failed",
            }),
        );
    });

    test("does not render while the cache query is still loading", async () => {
        useQuery.mockReturnValue(undefined); // still loading
        const renderPreview = vi.fn();
        useAction.mockReturnValue(renderPreview);

        renderHook(() => useSourcePreview(sourceId, runId, "pending"));

        // The effect must not fire the render action until the query resolves
        // to a confirmed miss (null), not merely undefined.
        expect(renderPreview).not.toHaveBeenCalled();
    });
});
