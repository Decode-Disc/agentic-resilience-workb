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
    sourceId: string | undefined,
    runId: string | undefined,
    decision: string | undefined,
): PreviewState {
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
            const convexUrl = import.meta.env.VITE_CONVEX_URL;
            const response = await fetch(`${convexUrl}/api/preview/render`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sourceId, runId }),
            });

            if (!response.ok) {
                setState({ status: "unavailable" });
                return;
            }

            const data: unknown = await response.json();
            if (
                data &&
                typeof data === "object" &&
                "status" in data &&
                (data as Record<string, unknown>).status === "ok" &&
                "base64" in data &&
                typeof (data as Record<string, unknown>).base64 === "string"
            ) {
                setState({
                    status: "screenshot",
                    dataUrl: (data as { base64: string }).base64,
                });
            } else {
                setState({ status: "unavailable" });
            }
        } catch {
            setState({ status: "unavailable" });
        }
    }, [sourceId, runId, decision]);

    useEffect(() => {
        void fetchPreview();
    }, [fetchPreview]);

    return state;
}
