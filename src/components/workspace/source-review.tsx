import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    CheckListIcon,
    CheckmarkCircle02Icon,
    Plus,
} from "@hugeicons/core-free-icons";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { motion, useReducedMotion } from "motion/react";
import {
    type ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from "react";

import Icon from "@/components/icon";
import AnimatedListFilter from "@/components/ui/animated-list-filters";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import MotionAnimatePresence from "@/components/ui/motion-animate-presence";
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import ToolbarExpandable, {
    type DynamicStep,
} from "@/components/ui/toolbar-expandable";
import { AddSourceDialog } from "@/components/workspace/add-source-dialog";
import { SourceContextPanel } from "@/components/workspace/source-context-panel";
import {
    compareSourceReviewDecisions,
    sourceDecisionDefinitions,
} from "@/components/workspace/source-decision";
import {
    SourceMasterList,
    toSourceContext,
} from "@/components/workspace/source-master-list";
import { SourceAdjustmentActions } from "@/components/workspace/source-proposal-adjustment-board";
import { useResponsive } from "@/hooks/use-responsive";
import {
    sourceDocumentKindLabel,
    sourceInclusionLabel,
    sourceMatchesSearch,
} from "@/lib/presentation/research-copy";

type SourceReviewSummary = FunctionReturnType<
    typeof api.sources.getReviewSummary
>;
type SourceReviewServerSource = NonNullable<
    FunctionReturnType<typeof api.sources.getReviewSource>
>;
export type SourceReviewSource = Omit<
    SourceReviewServerSource,
    "documentKind" | "authorityTier"
> &
    Partial<Pick<SourceReviewServerSource, "documentKind" | "authorityTier">>;
type SourceDecision = FunctionArgs<typeof api.sources.decide>["decision"];
export type SourceFilter = "all" | SourceDecision;
type SourceReviewModel = Omit<SourceReviewSummary, "total" | "candidateLimit"> &
    Partial<Pick<SourceReviewSummary, "total" | "candidateLimit">> & {
        sources: Array<SourceReviewSource>;
    };

const DEFAULT_SOURCE_CANDIDATE_LIMIT = 48;

/** Full candidate inspection surface with master/detail review controls. */
export function SourceReview({
    runId,
    annotation,
    corpusRevisionId,
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
    showToolbar = true,
    proposalSources,
    emptyState,
}: {
    runId?: Id<"researchRuns">;
    annotation?: (
        source: FunctionReturnType<
            typeof api.sourceSelectionProposals.listItemsPage
        >["page"][number],
    ) => ReactNode;
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
    showToolbar?: boolean;
    proposalSources?: ReadonlyArray<
        FunctionReturnType<
            typeof api.sourceSelectionProposals.getAdjustmentSets
        >["included"][number]
    >;
    emptyState?: { title: string; description: string };
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
    const selectedId =
        controlledSelectedId !== undefined
            ? controlledSelectedId
            : internalSelectedId;
    const isReadingLoading =
        controlledSelectedId !== undefined &&
        controlledSelectedId !== null &&
        selectedSource === undefined;
    const [drawerOpen, setDrawerOpen] = useState(false);
    const { isTabletOrBelow } = useResponsive();
    const serverFiltered = controlledFilter !== undefined;
    const [search, setSearch] = useState("");
    const [documentType, setDocumentType] = useState<NonNullable<
        SourceReviewSource["documentKind"]
    > | null>(null);
    const searchingCollection =
        search.trim().length > 0 || documentType !== null;
    const visibleSources = useMemo(() => {
        if (serverFiltered && !searchingCollection) {
            return review.sources;
        }
        const candidates =
            searchingCollection && proposalSources
                ? proposalSources.map(toSourceContext)
                : review.sources;
        const matching = candidates.filter(
            (source) =>
                sourceMatchesSearch(source, search) &&
                (documentType === null ||
                    (source.documentKind ?? "unknown") === documentType),
        );
        if (filter !== "all") {
            return matching.filter((source) => source.decision === filter);
        }
        return [...matching].sort((left, right) =>
            compareSourceReviewDecisions(left.decision, right.decision),
        );
    }, [
        filter,
        review.sources,
        serverFiltered,
        searchingCollection,
        proposalSources,
        search,
        documentType,
    ]);
    const selected =
        selectedSource !== undefined
            ? selectedSource
            : (visibleSources.find(({ sourceId }) => sourceId === selectedId) ??
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
                (filter !== "all" && selectedSource.decision !== filter) ||
                (searchingCollection &&
                    !visibleSources.some(
                        (source) => source.sourceId === selectedSource.sourceId,
                    ))
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
    }, [
        filter,
        selectSource,
        selectedId,
        selectedSource,
        visibleSources,
        searchingCollection,
    ]);

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
                        <EmptyTitle>
                            {emptyState?.title ?? "No candidate sources"}
                        </EmptyTitle>
                        <EmptyDescription>
                            {emptyState?.description ??
                                "No public sources were found. Add a public link or review whether the available evidence is enough."}
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
                {canAddSource ? (
                    <div className="surface-panel flex flex-col items-center justify-center p-5 text-center">
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

    const filterTotal = searchingCollection
        ? visibleSources.length
        : filter === "all"
          ? total
          : review.counts[filter];
    const documentTypes = [
        ...new Set(
            (proposalSources ?? review.sources).map(
                (source) => source.documentKind ?? "unknown",
            ),
        ),
    ];
    const selectedProposal = proposalSources?.find(
        (source) => source.sourceId === selected?.sourceId,
    );
    const readerActions =
        selectedProposal && review.status === "draft" ? (
            <SourceAdjustmentActions
                source={selectedProposal}
                disabled={false}
                onDecide={onDecide}
                context="overview"
            />
        ) : undefined;
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
            description="Inspect source provenance and review decisions."
            runId={runId}
            corpusRevisionId={corpusRevisionId}
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
            enableDialogPreview={false}
            compact={proposalSources !== undefined}
            listClassName={proposalSources ? "space-y-2" : undefined}
            rowAction={
                proposalSources
                    ? (source) => {
                          const item = proposalSources.find(
                              (candidate) =>
                                  candidate.sourceId === source.sourceId,
                          );
                          return (
                              <Badge
                                  variant="outline"
                                  className={
                                      item?.included
                                          ? "border-approved/30 text-approved"
                                          : undefined
                                  }>
                                  {sourceInclusionLabel(
                                      item?.included ?? false,
                                  )}
                              </Badge>
                          );
                      }
                    : undefined
            }
            reviewStatus={review.status}
            groupByDecision={proposalSources ? false : filter === "all"}
            headerAction={
                <AnimatedListFilter
                    align="end"
                    label="Filter candidate sources"
                    value={filter}
                    options={filterOptions}
                    onChange={setFilter}
                />
            }
            headerContent={
                <div className="space-y-2">
                    <Input
                        type="search"
                        aria-label={
                            proposalSources
                                ? "Search candidates"
                                : "Search loaded candidates"
                        }
                        placeholder="Search candidates…"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        className="rounded-lg"
                    />
                    <Select
                        value={documentType ?? "all"}
                        onValueChange={(value) =>
                            setDocumentType(
                                documentTypes.find((kind) => kind === value) ??
                                    null,
                            )
                        }>
                        <SelectTrigger
                            aria-label="Document type"
                            className="w-full rounded-lg">
                            <SelectValue>
                                {documentType
                                    ? sourceDocumentKindLabel(documentType)
                                    : "All document types"}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">
                                All document types
                            </SelectItem>
                            {documentTypes.map((kind) => (
                                <SelectItem key={kind} value={kind}>
                                    {sourceDocumentKindLabel(kind)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            }
            hasMore={!searchingCollection && hasMore}
            isLoadingMore={!searchingCollection && isLoadingMore}
            isLoadingInitial={isLoadingInitial}
            onLoadMore={onLoadMore}
            className="h-full"
        />
    );

    return (
        <section
            aria-label={`Source set ${review.revision}`}
            className="flex flex-col gap-4">
            {showToolbar ? (
                <SourceReviewToolbar
                    review={{ ...review, total, candidateLimit }}
                    onApprove={onApprove}
                    onAddManualUrl={onAddManualUrl}
                    showApprovalAction={showApprovalAction}
                />
            ) : null}
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
                        minSize={proposalSources ? "14rem" : "18rem"}
                        maxSize="50%">
                        {masterList}
                    </ResizablePanel>
                    <ResizableHandle withHandle className="mx-2" />
                    <ResizablePanel
                        id="source-context"
                        data-panel="source-context"
                        minSize={proposalSources ? "20rem" : "26rem"}>
                        <div className="h-full min-w-0">
                            <MotionAnimatePresence
                                contentKey={
                                    selected ? selected.sourceId : "empty"
                                }
                                mode="wait"
                                preset="shrink-pop"
                                className="h-full"
                                wrapperClassName="h-full">
                                {selected ? (
                                    <SourceContextPanel
                                        source={selected}
                                        included={selectedProposal?.included}
                                        annotation={
                                            selectedProposal && annotation
                                                ? annotation(selectedProposal)
                                                : undefined
                                        }
                                        actions={readerActions}
                                        approvedCorpusRevisionId={
                                            review.status === "approved"
                                                ? corpusRevisionId
                                                : undefined
                                        }
                                        runId={runId}
                                        isReadingLoading={isReadingLoading}
                                    />
                                ) : (
                                    <div className="surface-panel flex h-full min-h-64 items-center justify-center rounded-2xl text-sm text-muted-foreground">
                                        Select a source to review its preview
                                        and provenance.
                                    </div>
                                )}
                            </MotionAnimatePresence>
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
                                <SourceContextPanel
                                    source={selected}
                                    included={selectedProposal?.included}
                                    annotation={
                                        selectedProposal && annotation
                                            ? annotation(selectedProposal)
                                            : undefined
                                    }
                                    actions={readerActions}
                                    approvedCorpusRevisionId={
                                        review.status === "approved"
                                            ? corpusRevisionId
                                            : undefined
                                    }
                                    runId={runId}
                                    isReadingLoading={isReadingLoading}
                                />
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
        <div className="empty:hidden space-y-2">
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
                            className="w-full sm:w-auto approve-button"
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
