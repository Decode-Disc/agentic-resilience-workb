import type { api } from '@convex/_generated/api';
import { LinkSquare01Icon } from '@hugeicons/core-free-icons';
import type { FunctionReturnType } from 'convex/server';
import { useMemo } from 'react';

import Icon from '@/components/icon';
import { Badge } from '@/components/ui/badge';
import {
    DirectionAwareTabs,
    type Tab,
} from '@/components/ui/direction-aware-tabs';
import { SourceBrowserView } from '@/components/workspace/source-browser-view';
import { SourceDecisionStatus } from '@/components/workspace/source-decision';
import {
    sourceCategoryLabel,
    sourceOriginLabel,
} from '@/lib/presentation/research-copy';

type SourceContext = FunctionReturnType<
    typeof api.sources.listForReview
>['sources'][number];

/**
 * Selected source detail panel: an embedded best-effort preview by default,
 * behind a record header band that announces the source's provenance, plus a
 * direction-aware tab control. Both reinterpretations of the Sales Hub
 * reference: the record header band + tabs are reproduced structurally, while
 * the reference's warm lime tint is translated to brand-green so the
 * prototype's purple/green-only discipline holds.
 */
export function SourceContextPanel({ source }: { source: SourceContext }) {
    const tabs: Tab[] = useMemo(
        () => [
            {
                id: 'preview',
                label: 'Preview',
                content: (
                    <div className="h-full min-h-0 w-full overflow-hidden rounded-xl border border-border/60">
                        <SourceBrowserView source={source} />
                    </div>
                ),
            },
            {
                id: 'details',
                label: 'Source details',
                content: (
                    <div className="h-full min-h-0 w-full overflow-auto rounded-xl border border-border/60 p-5">
                        <a
                            href={source.canonicalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 break-all font-mono text-xs link underline-offset-4"
                        >
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
        [source],
    );

    return (
        <article className="surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-xl">
            <header
                data-slot="source-record-header"
                className="border-b border-border/60 bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--brand-green)_14%,transparent),transparent)] p-5"
            >
                <div className="flex flex-wrap items-baseline gap-1">
                    <p className="text-micro text-brand-purple">
                        Selected source:
                    </p>
                    <h3 className="text-lg font-medium">{source.title}</h3>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="secondary">
                        {sourceOriginLabel(source.origin)}
                    </Badge>
                    <Badge variant="outline">
                        {sourceCategoryLabel(source.category)}
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
