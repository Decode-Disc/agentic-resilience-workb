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

import Icon from "@/components/icon";
import AnimatedListFilter from "@/components/ui/animated-list-filters";
import { Button } from "@/components/ui/button";
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
    compareSourceReviewDecisions,
    sourceDecisionDefinitions,
} from "@/components/workspace/source-decision";
import { SourceMasterList } from "@/components/workspace/source-master-list";
import { useResponsive } from "@/hooks/use-responsive";

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

/** Full candidate inspection surface with master/detail review controls. */
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
    showApprovalAction = true,
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
    showApprovalAction?: boolean;
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

    const filterTotal = filter === "all" ? total : review.counts[filter];
    const filterOptions = [
        { value: "all" as const, label: "All decisions", icon: CheckListIcon },
        ...sourceDecisionDefinitions.map((definition) => ({
            value: definition.decision,
            label: `${definition.label} (${review.counts[definition.decision]})`,
            icon: definition.icon,
        })),
    ];
    const masterList = (
        <SourceMasterList
            heading="Candidate sources"
            description="Review provenance and record source-level decisions across the full candidate set."
            items={visibleSources}
            total={filterTotal}
            selectedId={selectedId}
            onDecide={onDecide}
            onSelect={(sourceId) => {
                selectSource(sourceId);
                if (isTabletOrBelow) {
                    setDrawerOpen(true);
                }
            }}
            reviewStatus={review.status}
            groupByDecision={filter === "all"}
            headerAction={
                <AnimatedListFilter
                    align="end"
                    label="Filter candidate sources"
                    value={filter}
                    options={filterOptions}
                    onChange={setFilter}
                />
            }
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            isLoadingInitial={isLoadingInitial}
            onLoadMore={onLoadMore}
            className="h-full"
        />
    );

    return (
        <section aria-label={`Source set ${review.revision}`}>
            <SourceReviewToolbar
                review={{ ...review, total, candidateLimit }}
                onApprove={onApprove}
                onAddManualUrl={onAddManualUrl}
                showApprovalAction={showApprovalAction}
            />
            {isTabletOrBelow ? (
                masterList
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
                        {masterList}
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
    showApprovalAction,
}: {
    review: SourceReviewModel & { total: number; candidateLimit: number };
    onApprove: () => void | Promise<void>;
    onAddManualUrl?: (url: string) => void | Promise<void>;
    showApprovalAction: boolean;
}) {
    const shouldReduceMotion = useReducedMotion();
    const isApproved = review.status === "approved";
    const canApprove = review.counts.accepted > 0 && !isApproved;
    const canAddSource =
        onAddManualUrl !== undefined &&
        review.status === "draft" &&
        review.total < review.candidateLimit;
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
            {showApprovalAction ? (
                <motion.div
                    key={
                        canApprove
                            ? "ready"
                            : isApproved
                              ? "approved"
                              : "waiting"
                    }
                    data-slot="source-approval-action"
                    data-state={
                        isApproved
                            ? "approved"
                            : canApprove
                              ? "ready"
                              : "waiting"
                    }
                    initial={shouldReduceMotion ? false : { opacity: 0, y: -6 }}
                    animate={
                        shouldReduceMotion ? undefined : { opacity: 1, y: 0 }
                    }
                    transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
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
                                  ? `${review.counts.pending} pending source${review.counts.pending === 1 ? "" : "s"} will be excluded from the approved corpus.`
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
            ) : null}
            {steps.length > 0 ? (
                <ToolbarExpandable steps={steps} className="bg-muted" />
            ) : null}
        </div>
    );
}
