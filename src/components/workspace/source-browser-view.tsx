import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";

import { BrowserView } from "@/components/ui/browser-view";
import { useSourcePreview } from "@/hooks/use-source-preview";

type SourceContextResult = FunctionReturnType<
    typeof api.sources.listForReviewPage
>["page"][number];
type SourceContext = Omit<
    SourceContextResult,
    "documentKind" | "authorityTier"
> &
    Partial<Pick<SourceContextResult, "documentKind" | "authorityTier">>;

/** Maps a reviewed source record to the shared external browser destination,
 *  with an ephemeral visual preview for pending candidates. */
export function SourceBrowserView({
    source,
    runId,
}: {
    source: SourceContext;
        runId?: Id<"researchRuns">;
}) {
    const preview = useSourcePreview(
        source.sourceId,
        runId,
        source.decision,
    );

    const previewState =
        preview.status === "loading"
            ? "loading"
            : preview.status === "screenshot"
                ? "screenshot"
                : preview.status === "unavailable"
                    ? "unavailable"
                    : undefined;

    return (
        <BrowserView
            url={source.canonicalUrl}
            title={source.title}
            actionLabel="Open original"
            previewState={previewState}
            previewDataUrl={
                preview.status === "screenshot"
                    ? preview.dataUrl
                    : undefined
            }
        />
    );
}
