import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { FaviconAvatar } from "@/components/favicon-avatar";
import Icon from "@/components/icon";
import { InfiniteCollectionViewport } from "@/components/infinite-collection-viewport";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
    getSourceDecisionActiveButtonClassName,
    getSourceDecisionButtonLabel,
    getSourceDecisionIconClassName,
    sourceDecisionDefinitions,
} from "@/components/workspace/source-decision";
import {
    sourceCategoryLabel,
    sourceOriginLabel,
} from "@/lib/presentation/research-copy";
import { cn } from "@/lib/utils";

type ReviewSource = FunctionReturnType<
    typeof api.sources.listForReviewPage
>["page"][number];
type ProposalSource = FunctionReturnType<
    typeof api.sourceSelectionProposals.listItemsPage
>["page"][number];
export type SourceMasterListItem = ReviewSource | ProposalSource;
type SourceDecision = FunctionArgs<typeof api.sources.decide>["decision"];

/** Reusable source collection; filters and grouping controls belong to consumers. */
export function SourceMasterList<TSource extends SourceMasterListItem>({
    heading,
    description,
    items,
    total,
    selectedId,
    onSelect,
    reviewStatus,
    onDecide,
    rowAction,
    annotation,
    groupByDecision = false,
    headerAction,
    hasMore = false,
    isLoadingMore = false,
    isLoadingInitial = false,
    onLoadMore = () => undefined,
    collectionLabel = "Candidate source collection",
    emptyTitle = "No candidate sources",
    emptyDescription = "No sources currently match this view.",
    className,
}: {
    heading: string;
    description?: string;
    items: ReadonlyArray<TSource>;
    total: number;
    selectedId?: Id<"sources"> | null;
    onSelect?: (sourceId: Id<"sources">) => void;
    reviewStatus: "draft" | "approved";
    onDecide?: (
        sourceId: Id<"sources">,
        decision: SourceDecision,
    ) => void | Promise<void>;
    rowAction?: (source: TSource) => ReactNode;
    annotation?: (source: TSource) => ReactNode;
    groupByDecision?: boolean;
    headerAction?: ReactNode;
    hasMore?: boolean;
    isLoadingMore?: boolean;
    isLoadingInitial?: boolean;
    onLoadMore?: () => void;
    collectionLabel?: string;
    emptyTitle?: string;
    emptyDescription?: string;
    className?: string;
}) {
    const shouldReduceMotion = useReducedMotion();

    return (
        <Card className={cn("rounded-(--radius-source-card) py-4", className)}>
            <CardHeader className="space-y-3 px-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="text-micro text-muted-foreground">
                            {heading}
                        </p>
                        {description ? (
                            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                                {description}
                            </p>
                        ) : null}
                    </div>
                    {headerAction}
                </div>
            </CardHeader>
            <CardContent className="min-h-0 overflow-hidden px-4">
                <div data-slot="source-master-list">
                    <InfiniteCollectionViewport
                        hasMore={hasMore}
                        isLoadingMore={isLoadingMore}
                        itemCount={items.length}
                        onLoadMore={onLoadMore}
                        ariaLabel={collectionLabel}
                        loadMoreLabel="Load more sources"
                        className="h-[min(42rem,80vh)]"
                        viewportClassName="pr-3 pl-1"
                        loadingFallback={<SourceContinuationSkeleton />}
                        endContent={
                            items.length > 0 ? (
                                <p className="text-xs text-muted-foreground">
                                    {items.length} of {total} loaded
                                </p>
                            ) : null
                        }>
                        {isLoadingInitial ? (
                            <SourceListSkeleton />
                        ) : items.length === 0 ? (
                            <Empty className="min-h-64 border-none">
                                <EmptyHeader>
                                    <EmptyTitle>{emptyTitle}</EmptyTitle>
                                    <EmptyDescription>
                                        {emptyDescription}
                                    </EmptyDescription>
                                </EmptyHeader>
                            </Empty>
                        ) : (
                            <ul className="space-y-5">
                                {items.map((source, index) => {
                                    const isActive =
                                        selectedId === source.sourceId;
                                    const previous = items[index - 1];
                                    const startsDecisionGroup =
                                        groupByDecision &&
                                        previous?.decision !== source.decision;
                                    const sourceIdentity = (
                                        <>
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
                                        </>
                                    );
                                    return (
                                        <motion.li
                                            layout={
                                                shouldReduceMotion
                                                    ? false
                                                    : "position"
                                            }
                                            transition={{
                                                duration: shouldReduceMotion
                                                    ? 0
                                                    : 0.2,
                                                ease: [0.32, 0.72, 0, 1],
                                            }}
                                            key={source.sourceId}
                                            className="group/source-row flex flex-col items-center">
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
                                                {onSelect ? (
                                                    <button
                                                        type="button"
                                                        aria-pressed={isActive}
                                                        data-slot="source-row"
                                                        data-active={
                                                            isActive
                                                                ? "true"
                                                                : undefined
                                                        }
                                                        aria-label={`Open ${source.title} for review`}
                                                        className="flex w-full items-start gap-3 text-left text-wrap"
                                                        onClick={() =>
                                                            onSelect(
                                                                source.sourceId,
                                                            )
                                                        }>
                                                        {sourceIdentity}
                                                    </button>
                                                ) : (
                                                    <div
                                                        data-slot="source-row"
                                                        className="flex w-full items-start gap-3 text-left text-wrap">
                                                        {sourceIdentity}
                                                    </div>
                                                )}
                                                {annotation?.(source)}
                                                {rowAction ? (
                                                    <div className="mt-3 flex flex-wrap gap-1 px-1">
                                                        {rowAction(source)}
                                                    </div>
                                                ) : onDecide ? (
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
                                                                            reviewStatus ===
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
                                                                        {
                                                                            buttonLabel
                                                                        }
                                                                    </Button>
                                                                );
                                                            },
                                                        )}
                                                    </div>
                                                ) : null}
                                            </div>
                                        </motion.li>
                                    );
                                })}
                            </ul>
                        )}
                    </InfiniteCollectionViewport>
                </div>
            </CardContent>
        </Card>
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
