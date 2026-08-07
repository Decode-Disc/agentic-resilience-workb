import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { motion, useReducedMotion } from "motion/react";
import {
    type KeyboardEvent as ReactKeyboardEvent,
    type ReactNode,
    useState,
} from "react";

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
import {
    ExpandableScreen,
    ExpandableScreenContent,
} from "@/components/ui/expandable-screen";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceContextPanel } from "@/components/workspace/source-context-panel";
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

function toSourceContext(source: SourceMasterListItem) {
    return {
        sourceId: source.sourceId,
        canonicalUrl: source.canonicalUrl,
        title: source.title,
        origin: source.origin,
        category: source.category,
        publishedAt: source.publishedAt,
        decision: source.decision,
        reason: "reason" in source ? source.reason : source.decisionReason,
    };
}

/** Reusable source collection; filters and grouping controls belong to consumers. */
export function SourceMasterList<TSource extends SourceMasterListItem>({
    heading,
    description,
    items,
    total,
    selectedId,
    onSelect,
    enableDialogPreview = true,
    reviewStatus,
    onDecide,
    rowAction,
    annotation,
    itemWrapper,
    itemHandle,
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
    listClassName,
}: {
    heading: string;
    description?: string;
    items: ReadonlyArray<TSource>;
    total: number;
    selectedId?: Id<"sources"> | null;
    onSelect?: (sourceId: Id<"sources">) => void;
        enableDialogPreview?: boolean;
    reviewStatus: "draft" | "approved";
    onDecide?: (
        sourceId: Id<"sources">,
        decision: SourceDecision,
    ) => void | Promise<void>;
    rowAction?: (source: TSource) => ReactNode;
    annotation?: (source: TSource) => ReactNode;
    itemWrapper?: (source: TSource, item: ReactNode) => ReactNode;
    itemHandle?: (source: TSource) => ReactNode;
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
        listClassName?: string;
}) {
    const shouldReduceMotion = useReducedMotion();
    const [previewSource, setPreviewSource] = useState<TSource | null>(null);
    const loadedCount =
        items.length > 0 ? (
            <p className="text-xs text-muted-foreground">
                {items.length} of {total} loaded
            </p>
        ) : null;

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
                        progressContent={loadedCount}
                        endContent={loadedCount}>
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
                                    <ul className={cn("space-y-5", listClassName)}>
                                {items.map((source, index) => {
                                    const isActive =
                                        selectedId === source.sourceId;
                                    const previous = items[index - 1];
                                    const startsDecisionGroup =
                                        groupByDecision &&
                                        previous?.decision !== source.decision;
                                    const isInteractive =
                                        onSelect !== undefined ||
                                        enableDialogPreview;
                                    const handleRowActivate = () => {
                                        onSelect?.(source.sourceId);
                                        if (enableDialogPreview) {
                                            setPreviewSource(source);
                                        }
                                    };
                                    const sourceRowProps = isInteractive
                                        ? {
                                              role: "button" as const,
                                              tabIndex: 0,
                                              "aria-pressed": isActive,
                                              "data-active": isActive
                                                  ? "true"
                                                  : undefined,
                                              "aria-label": `Open ${source.title} for review`,
                                            onClick: handleRowActivate,
                                              onKeyDown: (
                                                  event: ReactKeyboardEvent<HTMLDivElement>,
                                              ) => {
                                                  if (
                                                      event.target !==
                                                      event.currentTarget
                                                  ) {
                                                      return;
                                                  }
                                                  if (
                                                      event.key !== "Enter" &&
                                                      event.key !== " "
                                                  ) {
                                                      return;
                                                  }
                                                  event.preventDefault();
                                                  handleRowActivate();
                                              },
                                          }
                                        : {};
                                    const rowActionClassName =
                                        "-mx-3 -mb-3 mt-3 flex flex-wrap gap-1 border-t border-border/60 bg-muted/20 group-hover/source-row:bg-muted/70 p-1";
                                    const canMove =
                                        reviewStatus === "draft" &&
                                        itemWrapper !== undefined;
                                    const sourceItem = (
                                        <motion.div
                                            layout={
                                                shouldReduceMotion || canMove
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
                                            data-slot="source-row"
                                            data-active={
                                                isActive ? "true" : undefined
                                            }
                                            data-drag-enabled={
                                                canMove ? "true" : undefined
                                            }
                                            className={cn(
                                                "group/source-row flex flex-col items-center",
                                                canMove &&
                                                    "cursor-grab active:cursor-grabbing",
                                            )}>
                                            {startsDecisionGroup ? (
                                                <p className="mb-2 w-full text-micro text-muted-foreground">
                                                    {sourceDecisionDefinitions.find(
                                                        ({ decision }) =>
                                                            decision ===
                                                            source.decision,
                                                    )?.label ?? source.decision}
                                                </p>
                                            ) : null}
                                            <span className="flex w-full max-w-[calc(100%-2rem)] items-center gap-1 rounded-t-sm border border-border bg-secondary/50 px-2 py-1 text-start text-[10px] font-medium">
                                                <span className="min-w-0 flex-1 truncate">
                                                    {source.canonicalUrl}
                                                </span>
                                                {canMove
                                                    ? itemHandle?.(source)
                                                    : null}
                                            </span>
                                            <div
                                                data-slot="source-row-container"
                                                className={cn(
                                                    "relative flex w-full flex-col justify-between border p-3",
                                                    "transition-[background-image,background-color,border-color,box-shadow] duration-200 ease-out",
                                                    "group-hover/source-row:bg-source-selection-accent/15",
                                                    isInteractive &&
                                                        "cursor-pointer",
                                                    isActive &&
                                                    "bg-source-selection-accent/10 text-foreground ring ring-source-selection-accent",
                                                )}
                                                {...sourceRowProps}>
                                                <div
                                                    data-slot="source-row-content"
                                                    className="flex w-full items-start gap-3 text-left text-wrap">
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
                                                </div>
                                                {annotation?.(source)}
                                                {rowAction ? (
                                                    <div
                                                        className={
                                                            rowActionClassName
                                                        }>
                                                        {rowAction(source)}
                                                    </div>
                                                ) : onDecide ? (
                                                    <div
                                                        className={
                                                            rowActionClassName
                                                        }>
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
                                        </motion.div>
                                    );
                                    return itemWrapper ? (
                                        itemWrapper(source, sourceItem)
                                    ) : (
                                        <li key={source.sourceId}>
                                            {sourceItem}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </InfiniteCollectionViewport>
                </div>
            </CardContent>
            {enableDialogPreview && previewSource ? (
                <ExpandableScreen
                    defaultExpanded={true}
                    onExpandChange={(expanded) => {
                        if (!expanded) {
                            setPreviewSource(null);
                        }
                    }}
                    layoutId={`source-preview-${previewSource.sourceId}`}>
                    <ExpandableScreenContent className="h-[85vh] max-w-4xl overflow-hidden p-0 bg-background border border-border shadow-xl">
                        <SourceContextPanel
                            source={toSourceContext(previewSource)}
                            className="h-full border-none rounded-none"
                        />
                    </ExpandableScreenContent>
                </ExpandableScreen>
            ) : null}
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
