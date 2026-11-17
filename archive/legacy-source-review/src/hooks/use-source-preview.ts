import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";

export type PreviewState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "screenshot"; dataUrl: string }
    | { status: "unavailable"; reason?: string };

/**
 * Fetches an ephemeral visual preview for a pending candidate source.
 * Disconnected presentations without a source/run context never query or render previews.
 *
 * The rendered screenshot is cached server-side (short TTL) and read through a
 * reactive Convex query, so a repeat view returns the screenshot immediately
 * without re-rendering. On a confirmed cache miss, a single `renderPreview`
 * action is fired; its result populates the cache, which the reactive query
 * then reflects.
 */
export function useSourcePreview(
    sourceId: Id<"sources"> | undefined,
    runId: Id<"researchRuns"> | undefined,
    decision: string | undefined,
): PreviewState {
    const renderPreview = useAction(api.browserPreview.renderPreview);
    const cached = useQuery(
        api.browserPreviewInternals.getPreview,
        decision === "pending" && sourceId && runId ? { sourceId } : "skip",
    );

    const [rendered, setRendered] = useState<{
        sourceId: Id<"sources">;
        runId: Id<"researchRuns">;
        state: PreviewState;
    } | null>(null);
    const requestedRef = useRef<{
        sourceId: Id<"sources">;
        runId: Id<"researchRuns">;
        promise: ReturnType<typeof renderPreview>;
    } | null>(null);

    useEffect(() => {
        if (decision !== "pending" || !sourceId || !runId || cached !== null)
            return;
        if (
            requestedRef.current?.sourceId !== sourceId ||
            requestedRef.current.runId !== runId
        ) {
            requestedRef.current = {
                sourceId,
                runId,
                promise: renderPreview({ sourceId, runId }),
            };
        }
        let active = true;
        const settle = (state: PreviewState) => {
            if (active) setRendered({ sourceId, runId, state });
        };
        requestedRef.current.promise
            .then((result) =>
                settle(
                    result.status === "ok"
                        ? { status: "screenshot", dataUrl: result.base64 }
                        : { status: "unavailable", reason: "render_failed" },
                ),
            )
            .catch(() =>
                settle({ status: "unavailable", reason: "render_failed" }),
            );
        return () => {
            active = false;
        };
    }, [decision, sourceId, runId, cached, renderPreview]);

    if (decision !== "pending") {
        return { status: "unavailable", reason: "not_pending" };
    }

    if (!sourceId || !runId) {
        return { status: "unavailable", reason: "no_context" };
    }

    if (cached?.dataUrl)
        return { status: "screenshot", dataUrl: cached.dataUrl };
    return rendered?.sourceId === sourceId && rendered.runId === runId
        ? rendered.state
        : { status: "loading" };
}
