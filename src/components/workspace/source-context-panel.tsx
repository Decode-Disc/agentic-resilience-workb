import type { api } from '@convex/_generated/api';
import { LinkSquare01Icon } from '@hugeicons/core-free-icons';
import type { FunctionReturnType } from 'convex/server';

import Icon from '@/components/icon';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
 * segmented pill tab control. Both reinterpreations of the Sales Hub
 * reference: the record header band + tabs are reproduced structurally, while
 * the reference's warm lime tint is translated to brand-green so the
 * prototype's purple/green-only discipline holds.
 */
export function SourceContextPanel({ source }: { source: SourceContext }) {
    return (
        <article className="surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-xl">
            <header
                data-slot="source-record-header"
                className="border-b border-border/60 bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--brand-green)_14%,transparent),transparent)] p-5"
            >
                <p className="text-micro text-brand-purple">Selected source</p>
                <h3 className="mt-2 text-lg font-medium">{source.title}</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="secondary">
                        {sourceOriginLabel(source.origin)}
                    </Badge>
                    <Badge variant="outline">
                        {sourceCategoryLabel(source.category)}
                    </Badge>
                    <SourceDecisionStatus decision={source.decision} />
                </div>
            </header>

            <Tabs
                defaultValue="preview"
                className="flex min-h-0 flex-1 flex-col gap-2 p-2 data-horizontal:flex-col"
            >
                <TabsList className="self-start">
                    <TabsTrigger value="preview">Preview</TabsTrigger>
                    <TabsTrigger value="details">Source details</TabsTrigger>
                </TabsList>
                <TabsContent
                    value="preview"
                    className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60"
                >
                    <SourceBrowserView source={source} />
                </TabsContent>
                <TabsContent
                    value="details"
                    className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/60 p-5"
                >
                    <a
                        href={source.canonicalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-start gap-2 break-all font-mono text-xs text-foreground underline underline-offset-4"
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
                </TabsContent>
            </Tabs>
        </article>
    );
}
