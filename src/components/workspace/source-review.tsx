import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    CheckListIcon,
    CheckmarkCircle02Icon,
    Plus,
} from "@hugeicons/core-free-icons";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { FaviconAvatar } from "@/components/favicon-avatar";
import Icon from "@/components/icon";
import { InfiniteCollectionViewport } from "@/components/infinite-collection-viewport";
import { Button } from "@/components/ui/button";
import DiscreteTabs, {
    type DiscreteTabItem,
} from "@/components/ui/discrete-tabs";
import {
    Drawer,
    DrawerContent,
    DrawerDescription,
    DrawerHeader,
    DrawerTitle,
} from "@/components/ui/drawer";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from "@/components/ui/empty";
import { LiquidGlassCard } from "@/components/ui/liquid-glass";
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Skeleton } from "@/components/ui/skeleton";
import ToolbarExpandable, {
    type DynamicStep,
} from "@/components/ui/toolbar-expandable";
import { AddSourceDialog } from "@/components/workspace/add-source-dialog";
import { SourceContextPanel } from "@/components/workspace/source-context-panel";
import {
    compareSourceReviewDecisions,
    getSourceDecisionActiveButtonClassName,
    getSourceDecisionButtonLabel,
    getSourceDecisionIconClassName,
    sourceDecisionDefinitions,
} from "@/components/workspace/source-decision";
import { useResponsive } from "@/hooks/use-responsive";
import {
    sourceCategoryLabel,
    sourceOriginLabel,
} from "@/lib/presentation/research-copy";
import { cn } from "@/lib/utils";

type SourceReviewSummary = FunctionReturnType<
    typeof api.sources.getReviewSummary
>;
export type SourceReviewSource = FunctionReturnType<
    typeof api.sources.listForReviewPage
    >["page"][number];
type SourceDecision = FunctionArgs<typeof api.sources.decide>["decision"];
export type SourceFilter = "all" | SourceDecision;
type SourceReviewModel = Omit<SourceReviewSummary, "total" | "candidateLimit"> &
    Partial<Pick<SourceReviewSummary, "total" | "candidateLimit">> & {
        sources: Array<SourceReviewSource>;
    };

const DEFAULT_SOURCE_CANDIDATE_LIMIT = 48;

/** Dedicated human checkpoint for source inclusion and corpus approval. */
export function SourceReview({
    review,
    onDecide,
    onApprove,
    onAddManualUrl,
    filter: controlledFilter,
    onFilterChange,
    selectedId: controlledSelectedId,
    selectedSource,
    onSelectedIdChange,
    hasMore = false,
    isLoadingMore = false,
    isLoadingInitial = false,
    onLoadMore = () => undefined,
}: {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
    review: SourceReviewModel;
    onDecide: (
        sourceId: Id<"sources">,
        decision: SourceDecision,
    ) => void | Promise<void>;
    onApprove: () => void | Promise<void>;
    onAddManualUrl?: (url: string) => void | Promise<void>;
    filter?: SourceFilter;
    onFilterChange?: (filter: SourceFilter) => void;
        selectedId?: Id<"sources"> | null;
    selectedSource?: SourceReviewSource | null;
        onSelectedIdChange?: (sourceId: Id<"sources"> | null) => void;
    hasMore?: boolean;
    isLoadingMore?: boolean;
    isLoadingInitial?: boolean;
    onLoadMore?: () => void;
}) {
    const total =
        review.total ??
        review.counts.accepted + review.counts.rejected + review.counts.pending;
    const candidateLimit =
        review.candidateLimit ?? DEFAULT_SOURCE_CANDIDATE_LIMIT;
    const [internalFilter, setInternalFilter] = useState<SourceFilter>("all");
    const filter = controlledFilter ?? internalFilter;
    const [internalSelectedId, setInternalSelectedId] =
        useState<Id<"sources"> | null>(review.sources[0]?.sourceId ?? null);
    const selectedId = controlledSelectedId ?? internalSelectedId;
    const [drawerOpen, setDrawerOpen] = useState(false);
    const { isTabletOrBelow } = useResponsive();
    const serverFiltered = controlledFilter !== undefined;
    const visibleSources = useMemo(() => {
        if (serverFiltered) {
            return review.sources;
        }
        if (filter !== "all") {
            return review.sources.filter(
                (source) => source.decision === filter,
            );
        }
        return [...review.sources].sort((left, right) =>
            compareSourceReviewDecisions(left.decision, right.decision),
        );
    }, [filter, review.sources, serverFiltered]);
    const selected =
        selectedSource !== undefined
            ? selectedSource
            : (review.sources.find(({ sourceId }) => sourceId === selectedId) ??
                null);

    const selectSource = useCallback(
        (sourceId: Id<"sources"> | null) => {
            if (controlledSelectedId === undefined) {
                setInternalSelectedId(sourceId);
            }
            onSelectedIdChange?.(sourceId);
        },
        [controlledSelectedId, onSelectedIdChange],
    );

    useEffect(() => {
        const firstVisibleId = visibleSources[0]?.sourceId ?? null;
        if (selectedSource !== undefined) {
            if (
                selectedSource === null ||
                (filter !== "all" && selectedSource.decision !== filter)
            ) {
                selectSource(firstVisibleId);
            }
            return;
        }
        if (
            selectedId === null ||
            !visibleSources.some(({ sourceId }) => sourceId === selectedId)
        ) {
            selectSource(firstVisibleId);
        }
    }, [filter, selectSource, selectedId, selectedSource, visibleSources]);

    const setFilter = (nextFilter: SourceFilter) => {
        if (controlledFilter === undefined) {
            setInternalFilter(nextFilter);
        }
        onFilterChange?.(nextFilter);
    };

    if (total === 0 && !isLoadingInitial) {
        const canAddSource =
            onAddManualUrl !== undefined && review.status === "draft";
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
                {canAddSource ? (
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
                        <p className="mt-2 text-xs text-muted-foreground">
                            Up to {candidateLimit} candidate sources can be
                            reviewed in this dossier.
                        </p>
                    </div>
                ) : null}
            </section>
        );
    }

    const reviewWithCollection = {
        ...review,
        total,
        candidateLimit,
        sources: visibleSources,
    };

    return (
        <section aria-label={`Source set ${review.revision}`}>
            <SourceReviewToolbar
                review={reviewWithCollection}
                onApprove={onApprove}
                onAddManualUrl={onAddManualUrl}
            />
            {isTabletOrBelow ? (
                <SourceMasterList
                    review={reviewWithCollection}
                    filter={filter}
                    onFilterChange={setFilter}
                    selectedId={selectedId}
                    onDecide={onDecide}
                    onSelect={(sourceId) => {
                        selectSource(sourceId);
                        setDrawerOpen(true);
                    }}
                    hasMore={hasMore}
                    isLoadingMore={isLoadingMore}
                    isLoadingInitial={isLoadingInitial}
                    onLoadMore={onLoadMore}
                />
            ) : (
                <ResizablePanelGroup
                    data-group="source-review"
                    orientation="horizontal"
                    defaultLayout={{
                        "source-master-list": 36,
                        "source-context": 64,
                    }}
                        className="min-h-168">
                    <ResizablePanel
                        id="source-master-list"
                        data-panel="source-master-list"
                        minSize="18rem"
                            maxSize="50%">
                        <SourceMasterList
                            review={reviewWithCollection}
                            filter={filter}
                            onFilterChange={setFilter}
                            selectedId={selectedId}
                            onDecide={onDecide}
                            onSelect={selectSource}
                            hasMore={hasMore}
                            isLoadingMore={isLoadingMore}
                            isLoadingInitial={isLoadingInitial}
                            onLoadMore={onLoadMore}
                            className="h-full"
                        />
                    </ResizablePanel>
                    <ResizableHandle withHandle className="mx-2" />
                    <ResizablePanel
                        id="source-context"
                        data-panel="source-context"
                            minSize="26rem">
                        <div className="h-full min-w-0">
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
                    showSwipeHandle>
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

function SourceReviewToolbar({
    review,
    onApprove,
    onAddManualUrl,
}: {
    review: SourceReviewModel & { total: number; candidateLimit: number };
    onApprove: () => void | Promise<void>;
    onAddManualUrl?: (url: string) => void | Promise<void>;
}) {
    const shouldReduceMotion = useReducedMotion();
    const isApproved = review.status === "approved";
    const canApprove = review.counts.accepted > 0 && !isApproved;
    const canAddSource =
        onAddManualUrl !== undefined &&
        review.status === "draft" &&
        review.total < review.candidateLimit;
    const pendingCopy = `${review.counts.pending} pending source${review.counts.pending === 1 ? "" : "s"} will be excluded from the approved corpus.`;
    const steps: DynamicStep[] = [];

    if (canAddSource) {
        steps.push({
            id: "add-source",
            title: "Add source",
            description:
                "Missing a key source? Add a public HTTPS link for analyst review.",
            icon: Plus,
            content: (
                <AddSourceDialog
                    trigger={
                        <Button type="button" variant="secondary">
                            <Icon iconNode={Plus} />
                            Add source link
                        </Button>
                    }
                    onAdd={onAddManualUrl}
                />
            ),
        });
    }

    return (
        <div className="mb-4 space-y-2">
            <motion.div
                key={canApprove ? "ready" : isApproved ? "approved" : "waiting"}
                data-slot="source-approval-action"
                data-state={
                    isApproved ? "approved" : canApprove ? "ready" : "waiting"
                }
                initial={shouldReduceMotion ? false : { opacity: 0, y: -6 }}
                animate={
                    shouldReduceMotion
                        ? undefined
                        : canApprove
                          ? {
                                opacity: 1,
                                y: 0,
                                boxShadow: [
                                    "0 0 0 0 color-mix(in oklch, var(--approved) 0%, transparent)",
                                    "0 0 0 4px color-mix(in oklch, var(--approved) 18%, transparent)",
                                    "0 0 0 0 color-mix(in oklch, var(--approved) 0%, transparent)",
                                ],
                            }
                          : { opacity: 1, y: 0 }
                }
                transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
                className="surface-panel flex flex-col gap-3 rounded-lg border border-border/60 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium text-foreground">
                        {isApproved
                            ? "Source set approved"
                            : canApprove
                                ? "Ready for corpus approval"
                                : "Accept a source to continue"}
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        {isApproved
                            ? `${review.counts.accepted} accepted source${review.counts.accepted === 1 ? "" : "s"} will be used for evidence extraction.`
                            : review.counts.pending > 0
                              ? pendingCopy
                              : canApprove
                                    ? "All candidate sources have been reviewed."
                                    : "The evidence corpus must contain at least one accepted source."}
                    </p>
                </div>
                {isApproved ? (
                    <div className="flex shrink-0 items-center gap-2 text-sm font-medium text-approved">
                        <Icon iconNode={CheckmarkCircle02Icon} />
                        Approved
                    </div>
                ) : (
                    <Button
                        type="button"
                        size="lg"
                        className="w-full sm:w-auto"
                        onClick={() => void onApprove()}
                            disabled={!canApprove}>
                        <Icon iconNode={CheckmarkCircle02Icon} />
                        Approve source set
                    </Button>
                )}
            </motion.div>

            {steps.length > 0 ? <ToolbarExpandable steps={steps} /> : null}
        </div>
    );
}

function SourceMasterList({
    review,
    filter,
    onFilterChange,
    selectedId,
    onDecide,
    onSelect,
    hasMore,
    isLoadingMore,
    isLoadingInitial,
    onLoadMore,
    className,
}: {
    review: SourceReviewModel & { total: number; candidateLimit: number };
    filter: SourceFilter;
    onFilterChange: (filter: SourceFilter) => void;
        selectedId: Id<"sources"> | null;
    onDecide: (
        sourceId: Id<"sources">,
        decision: SourceDecision,
    ) => void | Promise<void>;
        onSelect: (sourceId: Id<"sources">) => void;
    hasMore: boolean;
    isLoadingMore: boolean;
    isLoadingInitial: boolean;
    onLoadMore: () => void;
    className?: string;
}) {
    const shouldReduceMotion = useReducedMotion();
    const filterTotal = filter === "all" ? review.total : review.counts[filter];
    const tabs: DiscreteTabItem[] = [
        {
            id: "all",
            title: "All",
            icon: CheckListIcon,
            count: review.total,
        },
        ...sourceDecisionDefinitions.map((definition) => ({
            id: definition.decision,
            title: definition.label,
            icon: definition.icon,
            count: review.counts[definition.decision],
        })),
    ];

    return (
        <LiquidGlassCard
            data-slot="source-master-list"
            className={cn("min-h-0 overflow-hidden bg-card p-3", className)}
            glowIntensity="none"
            shadowIntensity="none"
            whileHover={undefined}
            whileTap={undefined}>
            <header className="space-y-3 px-1 pb-4">
                <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                        Candidate sources
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                        {review.sources.length} of {filterTotal} loaded
                    </p>
                </div>
                <DiscreteTabs
                    tabs={tabs}
                    value={filter}
                    onValueChange={(nextFilter) =>
                        onFilterChange(nextFilter as SourceFilter)
                    }
                    ariaLabel="Filter candidate sources by decision"
                    className="gap-2"
                />
            </header>
            <InfiniteCollectionViewport
                hasMore={hasMore}
                isLoadingMore={isLoadingMore}
                itemCount={review.sources.length}
                onLoadMore={onLoadMore}
                ariaLabel="Candidate source collection"
                loadMoreLabel="Load more sources"
                className="h-[min(42rem,70vh)]"
                viewportClassName="pr-2"
                loadingFallback={<SourceContinuationSkeleton />}
                endContent={
                    review.sources.length > 0 ? (
                        <p className="text-xs text-muted-foreground">
                            {review.sources.length} of {filterTotal} loaded
                        </p>
                    ) : null
                }>
                {isLoadingInitial ? (
                    <SourceListSkeleton />
                ) : review.sources.length === 0 ? (
                    <Empty className="min-h-64 border-none">
                        <EmptyHeader>
                            <EmptyTitle>
                                    No {filter === "all" ? "" : `${filter} `}
                                sources
                            </EmptyTitle>
                            <EmptyDescription>
                                No sources currently match this review filter.
                            </EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                ) : (
                    <ul className="space-y-5">
                        {review.sources.map((source, index) => {
                            const isActive = selectedId === source.sourceId;
                            const previous = review.sources[index - 1];
                            const startsDecisionGroup =
                                filter === "all" &&
                                previous?.decision !== source.decision;
                            return (
                                <motion.li
                                    layout={
                                        shouldReduceMotion ? false : "position"
                                    }
                                    transition={{
                                        duration: shouldReduceMotion ? 0 : 0.2,
                                        ease: [0.32, 0.72, 0, 1],
                                    }}
                                    key={source.sourceId}
                                    className="flex flex-col items-center group/source-row">
                                    {startsDecisionGroup ? (
                                        <p className="mb-2 w-full text-micro text-muted-foreground">
                                            {sourceDecisionDefinitions.find(
                                                ({ decision }) =>
                                                    decision ===
                                                    source.decision,
                                            )?.label ?? source.decision}
                                        </p>
                                    ) : null}
                                    <span className="w-full max-w-[calc(100%-2rem)] truncate rounded-t-sm border border-border bg-secondary/50 px-2 py-1 text-start text-[10px] font-medium">
                                        {source.canonicalUrl}
                                    </span>
                                    <div
                                        className={cn(
                                            "source-selection relative flex min-h-28 w-full flex-col justify-between border p-3",
                                            isActive &&
                                            "source-selection-active",
                                        )}>
                                        <button
                                            type="button"
                                            aria-pressed={isActive}
                                            data-slot="source-row"
                                            data-active={
                                                isActive ? "true" : undefined
                                            }
                                            aria-label={`Open ${source.title} for review`}
                                            className="flex w-full items-start gap-3 text-left text-wrap"
                                            onClick={() =>
                                                onSelect(source.sourceId)
                                            }>
                                            <FaviconAvatar
                                                canonicalUrl={
                                                    source.canonicalUrl
                                                }
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
                                                    {" · "}
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
                                                            key={
                                                                definition.decision
                                                            }
                                                            type="button"
                                                            size="xs"
                                                            variant="outline"
                                                            disabled={
                                                                review.status ===
                                                                "approved"
                                                            }
                                                            aria-pressed={
                                                                isSelected
                                                            }
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
                                                            }>
                                                            <Icon
                                                                iconNode={
                                                                    definition.icon
                                                                }
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
                                </motion.li>
                            );
                        })}
                    </ul>
                )}
            </InfiniteCollectionViewport>
        </LiquidGlassCard>
    );
}

function SourceContinuationSkeleton() {
    return (
        <div className="space-y-2 px-1">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-28 w-full rounded-xl" />
        </div>
    );
}

function SourceListSkeleton() {
    return (
        <div
            role="status"
            aria-label="Loading candidate sources"
            aria-busy="true"
            className="space-y-5">
            {["first", "second", "third"].map((key) => (
                <div key={key} className="space-y-1 px-1">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-28 w-full rounded-xl" />
                </div>
            ))}
        </div>
    );
}
