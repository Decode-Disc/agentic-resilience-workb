import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    CheckListIcon,
    CheckmarkCircle02Icon,
    Plus,
} from "@hugeicons/core-free-icons";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { FaviconAvatar } from "@/components/favicon-avatar";
import Icon from "@/components/icon";
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
import ToolbarExpandable, {
    type DynamicStep,
} from "@/components/ui/toolbar-expandable";
import { AddSourceDialog } from "@/components/workspace/add-source-dialog";
import { SourceContextPanel } from "@/components/workspace/source-context-panel";
import {
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

type SourceReviewProjection = FunctionReturnType<
    typeof api.sources.listForReview
>;
type SourceDecision = FunctionArgs<typeof api.sources.decide>["decision"];
type SourceFilter = "all" | SourceDecision;

/** Dedicated human checkpoint for source inclusion and corpus approval. */
export function SourceReview({
    review,
    onDecide,
    onApprove,
    onAddManualUrl,
}: {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
    review: SourceReviewProjection;
    onDecide: (
        sourceId: Id<"sources">,
        decision: SourceDecision,
    ) => void | Promise<void>;
    onApprove: () => void | Promise<void>;
    onAddManualUrl?: (url: string) => void | Promise<void>;
}) {
    const [selectedId, setSelectedId] = useState<Id<"sources"> | null>(
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
            <SourceReviewToolbar
                review={review}
                onApprove={onApprove}
                onAddManualUrl={onAddManualUrl}
            />
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
                            review={review}
                            selectedId={selectedId}
                            onDecide={onDecide}
                            onSelect={setSelectedId}
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
    review: SourceReviewProjection;
    onApprove: () => void | Promise<void>;
    onAddManualUrl?: (url: string) => void | Promise<void>;
}) {
    const shouldReduceMotion = useReducedMotion();
    const isApproved = review.status === "approved";
    const canApprove = review.counts.accepted > 0 && !isApproved;
    const pendingCopy = `${review.counts.pending} pending source${review.counts.pending === 1 ? "" : "s"} will be excluded from the approved corpus.`;
    const steps: DynamicStep[] = [];

    if (onAddManualUrl && review.status === "draft") {
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
                initial={
                    shouldReduceMotion ? false : { opacity: 0, y: -6 }
                }
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
    selectedId,
    onDecide,
    onSelect,
    className,
}: {
    review: SourceReviewProjection;
        selectedId: Id<"sources"> | null;
    onDecide: (
        sourceId: Id<"sources">,
        decision: SourceDecision,
    ) => void | Promise<void>;
        onSelect: (sourceId: Id<"sources">) => void;
    className?: string;
}) {
    const [filter, setFilter] = useState<SourceFilter>("all");
    const visibleSources =
        filter === "all"
            ? review.sources
            : review.sources.filter((source) => source.decision === filter);
    const tabs: DiscreteTabItem[] = [
        {
            id: "all",
            title: "All",
            icon: CheckListIcon,
            count: review.sources.length,
        },
        ...sourceDecisionDefinitions.map((definition) => ({
            id: definition.decision,
            title: definition.label,
            icon: definition.icon,
            count: review.counts[definition.decision],
        })),
    ];

    const handleFilterChange = (nextFilter: string) => {
        const resolvedFilter = nextFilter as SourceFilter;
        setFilter(resolvedFilter);

        if (resolvedFilter === "all") return;
        const selectedSource = review.sources.find(
            (source) => source.sourceId === selectedId,
        );
        if (selectedSource?.decision === resolvedFilter) return;

        const firstMatchingSource = review.sources.find(
            (source) => source.decision === resolvedFilter,
        );
        if (firstMatchingSource) {
            onSelect(firstMatchingSource.sourceId);
        }
    };

    return (
        <LiquidGlassCard
            data-slot="source-master-list"
            className={cn("min-h-0 overflow-hidden p-3 bg-card", className)}
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
                        {visibleSources.length} shown
                    </p>
                </div>
                <DiscreteTabs
                    tabs={tabs}
                    value={filter}
                    onValueChange={handleFilterChange}
                    ariaLabel="Filter candidate sources by decision"
                    className="gap-2"
                />
            </header>
            <ul className="space-y-5">
                {visibleSources.map((source) => {
                    const isActive = selectedId === source.sourceId;
                    return (
                        <li
                            key={source.sourceId}
                            className="flex flex-col items-center group/source-row">
                            <span className="border border-border bg-secondary/50 px-2 py-1 rounded-t-sm w-full max-w-[calc(100%-2rem)] truncate text-[10px] text-start font-medium">
                                {source.canonicalUrl}
                            </span>
                            <div
                                className={cn(
                                    "relative source-selection flex min-h-28 w-full flex-col justify-between border p-3",
                                    isActive && "source-selection-active",
                                )}>
                                <button
                                    type="button"
                                    aria-pressed={isActive}
                                    data-slot="source-row"
                                    data-active={isActive ? "true" : undefined}
                                    aria-label={`Open ${source.title} for review`}
                                    className="flex w-full items-start gap-3 text-left text-wrap"
                                    onClick={() => onSelect(source.sourceId)}>
                                    <FaviconAvatar
                                        canonicalUrl={source.canonicalUrl}
                                        size="default"
                                    />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-semibold">
                                            {source.title}
                                        </span>
                                        <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
                                            {sourceOriginLabel(source.origin)}
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
                                                    key={definition.decision}
                                                    type="button"
                                                    size="xs"
                                                    variant="outline"
                                                    disabled={
                                                        review.status ===
                                                        "approved"
                                                    }
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
                        </li>
                    );
                })}
            </ul>
        </LiquidGlassCard>
    );
}
