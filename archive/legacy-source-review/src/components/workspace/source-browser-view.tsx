import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { File02Icon } from "@hugeicons/core-free-icons";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import Icon from "@/components/icon";
import { BrowserView } from "@/components/ui/browser-view";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@/components/ui/empty";
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
    onViewDetails,
}: {
    source: SourceContext;
    runId?: Id<"researchRuns">;
    onViewDetails?: () => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const preview = useSourcePreview(source.sourceId, runId, source.decision);

    const previewState =
        preview.status === "loading"
            ? "loading"
            : preview.status === "screenshot"
              ? "screenshot"
              : preview.status === "unavailable"
                ? "unavailable"
                : undefined;

    return (
        <div className="flex min-h-72 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 p-3">
                <p className="text-xs text-muted-foreground">
                    Preview — for visual reference only
                </p>
                {preview.status === "screenshot" ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpanded(true)}>
                        Expand preview
                    </Button>
                ) : null}
            </div>
            <div className="min-h-0 flex-1">
                <BrowserView
                    url={source.canonicalUrl}
                    title={source.title}
                    actionLabel="Open original"
                    previewState={previewState}
                    fallback={
                        preview.status === "unavailable" ? (
                            <Empty className="min-h-64 flex-1 rounded-none border-0">
                                <EmptyHeader>
                                    <EmptyMedia variant="icon">
                                        <Icon iconNode={File02Icon} />
                                    </EmptyMedia>
                                    <EmptyTitle>Preview unavailable</EmptyTitle>
                                    <EmptyDescription>
                                        You can still review the source details
                                        or open the original document.
                                    </EmptyDescription>
                                </EmptyHeader>
                                {onViewDetails ? (
                                    <EmptyContent>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={onViewDetails}>
                                            View source details
                                        </Button>
                                    </EmptyContent>
                                ) : null}
                            </Empty>
                        ) : undefined
                    }
                    previewDataUrl={
                        preview.status === "screenshot"
                            ? preview.dataUrl
                            : undefined
                    }
                />
            </div>
            <Dialog open={expanded} onOpenChange={setExpanded}>
                <DialogContent className="max-w-[95vw] sm:max-w-[95vw]">
                    <DialogHeader>
                        <DialogTitle>{source.title}</DialogTitle>
                        <DialogDescription>
                            Preview — for visual reference only
                        </DialogDescription>
                    </DialogHeader>
                    {preview.status === "screenshot" ? (
                        <img
                            src={preview.dataUrl}
                            alt={`Preview of ${source.title}`}
                            className="max-h-[75dvh] w-full object-contain"
                        />
                    ) : null}
                </DialogContent>
            </Dialog>
        </div>
    );
}
