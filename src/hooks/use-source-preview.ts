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
        decision === "pending" && sourceId ? { sourceId } : "skip",
    );

    const [rendered, setRendered] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const requestedRef = useRef(false);

    useEffect(() => {
        if (decision !== "pending" || !sourceId || !runId) return;
        // Only render on a confirmed miss (null), not while the query is still
        // loading (undefined), and never more than once per mount.
        if (cached !== null) return;
        if (requestedRef.current) return;
        requestedRef.current = true;
        renderPreview({ sourceId, runId })
            .then((result) => {
                if (result.status === "ok") {
                    setRendered(result.base64);
                } else {
                    setFailed(true);
                }
            })
            .catch(() => setFailed(true));
    }, [decision, sourceId, runId, cached, renderPreview]);

    if (decision !== "pending") {
        return { status: "unavailable", reason: "not_pending" };
    }

    const dataUrl = cached?.dataUrl ?? rendered;
    if (dataUrl) {
        return { status: "screenshot", dataUrl };
    }

    if (failed) {
        return { status: "unavailable", reason: "render_failed" };
    }

    return { status: "loading" };
}
