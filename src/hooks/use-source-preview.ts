import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";

export type PreviewState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "screenshot"; dataUrl: string }
    | { status: "unavailable"; reason?: string };

/**
 * Fetches an ephemeral visual preview for a pending candidate source.
 * Skips fetch entirely for accepted or rejected sources.
 * Fetches at most once per mount — callers re-mount to retry.
 */
export function useSourcePreview(
    sourceId: Id<"sources"> | undefined,
    runId: Id<"researchRuns"> | undefined,
    decision: string | undefined,
): PreviewState {
    const renderPreview = useAction(api.browserPreview.renderPreview);
    const [state, setState] = useState<PreviewState>({ status: "idle" });
    const fetchedRef = useRef(false);

    const fetchPreview = useCallback(async () => {
        if (!sourceId || !runId || fetchedRef.current) return;

        // Only preview pending (undecided) candidates
        if (decision !== "pending") {
            setState({ status: "unavailable", reason: "not_pending" });
            return;
        }

        fetchedRef.current = true;
        setState({ status: "loading" });

        try {
            const result = await renderPreview({ sourceId, runId });
            if (result.status === "ok") {
                setState({ status: "screenshot", dataUrl: result.base64 });
            } else {
                setState({ status: "unavailable", reason: result.error });
            }
        } catch {
            setState({ status: "unavailable" });
        }
    }, [renderPreview, sourceId, runId, decision]);

    useEffect(() => {
        void fetchPreview();
    }, [fetchPreview]);

    return state;
}
