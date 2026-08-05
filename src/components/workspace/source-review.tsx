import type { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { CheckmarkCircle02Icon, Plus } from '@hugeicons/core-free-icons';
import type { FunctionArgs, FunctionReturnType } from 'convex/server';
import { useEffect, useState } from 'react';
import { FaviconAvatar } from '@/components/favicon-avatar';
import Icon from '@/components/icon';
import { AlertStatus } from '@/components/ui/alert-status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Drawer,
    DrawerContent,
    DrawerDescription,
    DrawerHeader,
    DrawerTitle,
} from '@/components/ui/drawer';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from '@/components/ui/empty';
import { LiquidGlassCard } from '@/components/ui/liquid-glass';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from '@/components/ui/resizable';
import { AddSourceDialog } from '@/components/workspace/add-source-dialog';
import { SourceContextPanel } from '@/components/workspace/source-context-panel';
import {
    getSourceDecisionActiveButtonClassName,
    getSourceDecisionButtonLabel,
    getSourceDecisionIconClassName,
    sourceDecisionDefinitions,
} from '@/components/workspace/source-decision';
import { useResponsive } from '@/hooks/use-responsive';
import {
    sourceCategoryLabel,
    sourceOriginLabel,
} from '@/lib/presentation/research-copy';
import { cn } from '@/lib/utils';

type SourceReviewProjection = FunctionReturnType<
    typeof api.sources.listForReview
>;
type SourceDecision = FunctionArgs<typeof api.sources.decide>['decision'];

/** Dedicated human checkpoint for source inclusion and corpus approval. */
export function SourceReview({
    review,
    onDecide,
    onApprove,
    onAddManualUrl,
}: {
    runId: Id<'researchRuns'>;
    corpusRevisionId: Id<'corpusRevisions'>;
    review: SourceReviewProjection;
    onDecide: (
        sourceId: Id<'sources'>,
        decision: SourceDecision,
    ) => void | Promise<void>;
    onApprove: () => void | Promise<void>;
    onAddManualUrl?: (url: string) => void | Promise<void>;
}) {
    const [selectedId, setSelectedId] = useState<Id<'sources'> | null>(
        review.sources[0]?.sourceId ?? null,
    );
    const [drawerOpen, setDrawerOpen] = useState(false);
    const { isTabletOrBelow } = useResponsive();
    const selected =
        review.sources.find(({ sourceId }) => sourceId === selectedId) ?? null;

    useEffect(() => {
        if (
            selectedId === null ||
            !review.sources.some(({ sourceId }) => sourceId === selectedId)
        ) {
            setSelectedId(review.sources[0]?.sourceId ?? null);
        }
    }, [review.sources, selectedId]);

    if (review.sources.length === 0) {
        return (
            <section className="space-y-5">
                <Empty>
                    <EmptyHeader>
                        <EmptyTitle>No candidate sources</EmptyTitle>
                        <EmptyDescription>
                            No public sources were found. Add a public link or
                            review whether the available evidence is enough.
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
                {onAddManualUrl ? (
                    <div className="surface-panel flex flex-col items-center justify-center rounded-xl p-5 text-center">
                        <AddSourceDialog
                            trigger={
                                <Button type="button">
                                    <Icon iconNode={Plus} />
                                    Add source link
                                </Button>
                            }
                            onAdd={onAddManualUrl}
                        />
                    </div>
                ) : null}
            </section>
        );
    }

    return (
        <section aria-label={`Source set ${review.revision}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant="outline">
                        {review.counts.accepted} accepted
                    </Badge>
                    <Badge variant="outline">
                        {review.counts.rejected} rejected
                    </Badge>
                    <Badge variant="outline">
                        {review.counts.pending} pending
                    </Badge>
                </div>
                <Button
                    type="button"
                    onClick={() => void onApprove()}
                    disabled={
                        review.status === 'approved' ||
                        review.counts.accepted === 0
                    }
                >
                    <Icon iconNode={CheckmarkCircle02Icon} />
                    Approve source set
                </Button>
            </div>
            {onAddManualUrl && review.status === 'draft' ? (
                <div className="surface-panel mb-4 flex items-center justify-between gap-3 rounded-xl p-4">
                    <div>
                        <p className="text-sm font-medium text-foreground">
                            Missing a key source?
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Add public HTTPS links or review document ingestion
                            options.
                        </p>
                    </div>
                    <AddSourceDialog
                        trigger={
                            <Button type="button" variant="secondary">
                                <Icon iconNode={Plus} />
                                Add source link
                            </Button>
                        }
                        onAdd={onAddManualUrl}
                    />
                </div>
            ) : null}
            {review.counts.pending > 0 ? (
                <AlertStatus
                    size="sm"
                    variant="soft"
                    status="warning"
                    closable
                    description="Sources left undecided won’t be used. Accept at least one
                    source before approving the set."
                    className="text-xs mb-4"
                />
            ) : null}
            {isTabletOrBelow ? (
                <SourceMasterList
                    review={review}
                    selectedId={selectedId}
                    onDecide={onDecide}
                    onSelect={(sourceId) => {
                        setSelectedId(sourceId);
                        setDrawerOpen(true);
                    }}
                />
            ) : (
                <ResizablePanelGroup
                    data-group="source-review"
                    orientation="horizontal"
                    defaultLayout={{
                        'source-master-list': 36,
                        'source-context': 64,
                    }}
                    className="min-h-168"
                >
                    <ResizablePanel
                        id="source-master-list"
                        data-panel="source-master-list"
                        minSize="18rem"
                    >
                        <SourceMasterList
                            review={review}
                            selectedId={selectedId}
                            onDecide={onDecide}
                            onSelect={setSelectedId}
                            className="h-full"
                        />
                    </ResizablePanel>
                    <ResizableHandle withHandle />
                    <ResizablePanel
                        id="source-context"
                        data-panel="source-context"
                        minSize="24rem"
                    >
                        <div className="h-full min-w-0 pl-3">
                            {selected ? (
                                <SourceContextPanel source={selected} />
                            ) : (
                                <div className="surface-panel flex h-full min-h-64 items-center justify-center rounded-2xl text-sm text-muted-foreground">
                                    Select a source to review its preview and
                                    provenance.
                                </div>
                            )}
                        </div>
                    </ResizablePanel>
                </ResizablePanelGroup>
            )}
            {isTabletOrBelow ? (
                <Drawer
                    open={drawerOpen}
                    onOpenChange={setDrawerOpen}
                    showSwipeHandle
                >
                    <DrawerContent>
                        <DrawerHeader>
                            <DrawerTitle>Source detail</DrawerTitle>
                            <DrawerDescription>
                                Review provenance before making an inclusion
                                decision.
                            </DrawerDescription>
                        </DrawerHeader>
                        <div className="min-h-0 overflow-y-auto p-4">
                            {selected ? (
                                <SourceContextPanel source={selected} />
                            ) : null}
                        </div>
                    </DrawerContent>
                </Drawer>
            ) : null}
        </section>
    );
}

function SourceMasterList({
    review,
    selectedId,
    onDecide,
    onSelect,
    className,
}: {
    review: SourceReviewProjection;
    selectedId: Id<'sources'> | null;
    onDecide: (
        sourceId: Id<'sources'>,
        decision: SourceDecision,
    ) => void | Promise<void>;
    onSelect: (sourceId: Id<'sources'>) => void;
    className?: string;
}) {
    return (
        <LiquidGlassCard
            data-slot="source-master-list"
            className={cn('min-h-0 overflow-hidden p-3', className)}
            glowIntensity="xs"
            shadowIntensity="sm"
            whileHover={undefined}
            whileTap={undefined}
        >
                    <header className="flex items-center justify-between gap-3 px-1 pb-3">
                        <p className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                            Candidate sources
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                            {review.sources.length} total
                        </p>
                    </header>
            <ul className="space-y-3">
                        {review.sources.map((source) => {
                            const isActive = selectedId === source.sourceId;
                            return (
                                <li
                                    key={source.sourceId}
                                    className="flex flex-col items-center"
                                >
                                    <span className="border border-border bg-secondary/50 px-2 rounded-t-md w-full max-w-[calc(100%-2rem)] truncate text-[10px] text-start font-medium">
                                        {source.canonicalUrl}
                                    </span>
                                    <div
                                        className={cn(
                                            'group/source-row relative flex min-h-28 w-full flex-col justify-between rounded-2xl border p-3 transition-[background-image,background-color,border-color,box-shadow] duration-200',
                                            isActive
                                                ? 'source-selection-bridge border-brand-green/40 text-foreground ring-1 ring-brand-green/30'
                                                : 'border-border/50 bg-card hover:bg-muted/60',
                                        )}
                                    >
                                        <button
                                            type="button"
                                            aria-pressed={isActive}
                                            data-slot="source-row"
                                            data-active={
                                                isActive ? 'true' : undefined
                                            }
                                            aria-label={`Open ${source.title} for review`}
                                            className="flex w-full items-start gap-3 text-left text-wrap"
                                            onClick={() => onSelect(source.sourceId)}
                                        >
                                            <FaviconAvatar
                                                canonicalUrl={source.canonicalUrl}
                                                size="default"
                                            />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm font-semibold">
                                                    {source.title}
                                                </span>
                                                <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
                                                    {sourceOriginLabel(
                                                        source.origin,
                                                    )}
                                                    {' · '}
                                                    {sourceCategoryLabel(
                                                        source.category,
                                                    )}
                                                </span>
                                            </span>
                                        </button>
                                        <div className="mt-3 flex flex-wrap gap-1 px-1">
                                            {sourceDecisionDefinitions.map(
                                                (definition) => {
                                                    const isSelected =
                                                        source.decision ===
                                                        definition.decision;
                                                    const buttonLabel =
                                                        getSourceDecisionButtonLabel(
                                                            definition.decision,
                                                            isSelected,
                                                        );
                                                    return (
                                            <Button
                                                            key={definition.decision}
                                                type="button"
                                                size="xs"
                                                            variant="outline"
                                                            aria-pressed={isSelected}
                                                            aria-label={`${buttonLabel} ${source.title} as ${definition.decision}`}
                                                            data-status={
                                                                isSelected
                                                                    ? definition.status
                                                                    : undefined
                                                }
                                                            className={
                                                                isSelected
                                                                    ? getSourceDecisionActiveButtonClassName(
                                                                        definition.decision,
                                                                    )
                                                                    : undefined
                                                }
                                                onClick={() =>
                                                    void onDecide(
                                                        source.sourceId,
                                                        definition.decision,
                                                    )
                                                }
                                            >
                                                            <Icon
                                                                iconNode={definition.icon}
                                                                className={getSourceDecisionIconClassName(
                                                                    definition.decision,
                                                                )}
                                                            />
                                                            {buttonLabel}
                                            </Button>
                                                    );
                                                },
                                            )}
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
        </LiquidGlassCard>
    );
}
