import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { LinkSquare01Icon } from "@hugeicons/core-free-icons";
import type { FunctionReturnType } from "convex/server";
import { useMemo } from "react";

import Icon from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import {
    DirectionAwareTabs,
    type Tab,
} from "@/components/ui/direction-aware-tabs";
import { SourceBrowserView } from "@/components/workspace/source-browser-view";
import { SourceDecisionStatus } from "@/components/workspace/source-decision";
import {
    sourceAuthorityLabel,
    sourceDocumentKindLabel,
} from "@/lib/presentation/research-copy";
import { cn } from "@/lib/utils";

type SourceContextResult = FunctionReturnType<
    typeof api.sources.listForReviewPage
>["page"][number];
type SourceContext = Omit<
    SourceContextResult,
    "documentKind" | "authorityTier"
> &
    Partial<Pick<SourceContextResult, "documentKind" | "authorityTier">>;

/**
 * Selected source detail panel with preview, provenance header, and source
 * details. When a visual preview is available for a pending candidate source,
 * it is shown inside the Preview tab with a clear reference-only label.
 */
export function SourceContextPanel({
    source,
    runId,
    className,
}: {
    source: SourceContext;
        runId?: Id<"researchRuns">;
    className?: string;
}) {
    const tabs: Tab[] = useMemo(
        () => [
            {
                id: "preview",
                label: "Preview",
                content: (
                    <div className="h-full min-h-0 w-full overflow-hidden rounded-xl border border-border/60">
                        <SourceBrowserView source={source} runId={runId} />
                    </div>
                ),
            },
            {
                id: "details",
                label: "Source details",
                content: (
                    <div className="h-full min-h-0 w-full overflow-auto rounded-xl border border-border/60 p-5">
                        <a
                            href={source.canonicalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 break-all font-mono text-xs link underline-offset-4">
                            <Icon
                                iconNode={LinkSquare01Icon}
                                className="mt-0.5 shrink-0"
                            />
                            {source.canonicalUrl}
                        </a>
                        <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
                            Source passages will become available for evidence
                            review after you approve the source set.
                        </p>
                    </div>
                ),
            },
        ],
        [source, runId],
    );

    return (
        <article
            className={cn(
                "surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-(--radius-source-card)",
                className,
            )}>
            <header
                data-slot="source-record-header"
                className="border-b border-border/60 bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--brand-green)_14%,transparent),transparent)] p-5">
                <div className="flex flex-wrap items-baseline gap-1">
                    <p className="text-micro text-source-selection-accent">
                        Selected source:
                    </p>
                    <h3 className="text-base font-medium">{source.title}</h3>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="secondary">
                        {sourceAuthorityLabel(source.authorityTier)}
                    </Badge>
                    <Badge variant="outline">
                        {sourceDocumentKindLabel(source.documentKind)}
                    </Badge>
                    <SourceDecisionStatus decision={source.decision} />
                </div>
            </header>

            <div className="flex min-h-0 flex-1 flex-col p-2">
                <DirectionAwareTabs
                    tabs={tabs}
                    defaultTabId="preview"
                    containerClassName="flex-1 min-h-0"
                />
            </div>
        </article>
    );
}
