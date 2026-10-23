import { renderHook, waitFor } from "@testing-library/react";
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
