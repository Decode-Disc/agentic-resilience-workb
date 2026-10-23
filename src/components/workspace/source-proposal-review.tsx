import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    AlertCircleIcon,
    ArrowLeft01Icon,
    CheckListIcon,
    CheckmarkCircle02Icon,
    MoreHorizontalIcon,
    PlusSignIcon,
    RefreshIcon,
    Search01Icon,
    Settings02Icon,
} from "@hugeicons/core-free-icons";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { type ReactNode, useRef, useState } from "react";

import Icon from "@/components/icon";
import { AlertStatus } from "@/components/ui/alert-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import DiscreteTabs, {
    type DiscreteTabItem,
} from "@/components/ui/discrete-tabs";
import MotionAnimatePresence from "@/components/ui/motion-animate-presence";
import {
    Popover,
    PopoverContent,
    PopoverTitle,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { AddSourceDialog } from "@/components/workspace/add-source-dialog";
import {
    SourceCoverageNavigation,
    SourceCoverageRail,
} from "@/components/workspace/source-coverage-rail";
import { SourceFamilyBadge } from "@/components/workspace/source-family-badge";
import { SourceProposalAdjustmentBoard } from "@/components/workspace/source-proposal-adjustment-board";
import { SourceProposalCarousel } from "@/components/workspace/source-proposal-carousel";
import { SourceReview } from "@/components/workspace/source-review";
import { SourceSearchFeedback } from "@/components/workspace/source-search-feedback";
import { useMediaQuery } from "@/hooks/use-responsive";
import {
    type SourceRecoveryState,
    sourceCoverageCopy,
    sourceCoverageRoleLabel,
    sourceCoverageSearchState,
    sourcePreparationActionCopy,
    sourcePreparationCopy,
    sourceSearchAllowanceCopy,
    sourceSelectionExplanation,
} from "@/lib/presentation/research-copy";

type ProposalSummary = NonNullable<
    FunctionReturnType<typeof api.sourceSelectionProposals.getCurrent>
>;
type ProposalSource = FunctionReturnType<
    typeof api.sourceSelectionProposals.listItemsPage
>["page"][number];
type AdjustmentSets = FunctionReturnType<
    typeof api.sourceSelectionProposals.getAdjustmentSets
>;
type InspectionReview = Parameters<typeof SourceReview>[0]["review"];
type SourceDecision = FunctionArgs<typeof api.sources.decide>["decision"];
type ProposalDisposition = FunctionArgs<
    typeof api.sourceSelectionProposals.listItemsPage
>["disposition"];
type ProposalView = "overview" | "adjust" | "inspect";
type ProposalNavigationPreset = "slide-left" | "slide-right";

export type SourceReviewNavigation = {
    view: ProposalView;
    coverage?: ProposalSummary["coverageGaps"][number];
};

const dispositionTabs: ReadonlyArray<
    Omit<DiscreteTabItem, "count"> & { id: ProposalDisposition }
> = [
    {
        id: "recommended",
        title: "Recommended",
        icon: CheckmarkCircle02Icon,
        iconClassName: "text-approved",
    },
    {
        id: "needs_attention",
        title: "Needs attention",
        icon: AlertCircleIcon,
        iconClassName: "text-review",
    },
    {
        id: "alternative",
        title: "Alternatives",
        icon: CheckListIcon,
    },
];

function humanize(value: string): string {
    const text = value.replaceAll("_", " ");
    return `${text.charAt(0).toLocaleUpperCase("en")}${text.slice(1)}`;
}

/** Summary-first human checkpoint for a deterministic source proposal. */
export function SourceProposalReview({
    runId,
    corpusRevisionId,
    summary,
    disposition,
    onDispositionChange,
    adjustmentSets,
    inspectionReview,
    onDecide,
    onApprove,
    onRecompute,
    onRebuild = () => undefined,
    isRebuilding = false,
    onRecoverDiscovery,
    isRecovering = false,
    recovery,
    onAddManualUrl,
    onPrepare,
    isStartingPreparation = false,
    inspectionFilter,
    onInspectionFilterChange,
    inspectionSelectedId,
    inspectionSelectedSource,
    onInspectionSelectedIdChange,
    inspectionHasMore = false,
    inspectionIsLoadingMore = false,
    inspectionIsLoadingInitial = false,
    onLoadMoreInspection = () => undefined,
    sourceReviewNavigation,
    onSourceReviewNavigate,
}: {
    runId?: Id<"researchRuns">;
    corpusRevisionId: Id<"corpusRevisions">;
    summary: ProposalSummary;
    disposition: ProposalDisposition;
    onDispositionChange: (disposition: ProposalDisposition) => void;
    adjustmentSets: AdjustmentSets;
    inspectionReview: InspectionReview;
    onDecide: (
        sourceId: Id<"sources">,
        decision: SourceDecision,
    ) => void | Promise<void>;
    onApprove: () => void | Promise<void>;
    onRecompute: () => void | Promise<void>;
    onRebuild?: () => void | Promise<void>;
    isRebuilding?: boolean;
    onRecoverDiscovery?: (
        target: FunctionArgs<
            typeof api.sourceSelectionProposalActions.recoverDiscovery
        >["target"],
    ) => void | Promise<void>;
    isRecovering?: boolean;
    recovery?: SourceRecoveryState;
    onAddManualUrl?: (url: string) => void | Promise<void>;
    onPrepare?: () => void | Promise<void>;
    isStartingPreparation?: boolean;
    inspectionFilter?: Parameters<typeof SourceReview>[0]["filter"];
    onInspectionFilterChange?: Parameters<
        typeof SourceReview
    >[0]["onFilterChange"];
    inspectionSelectedId?: Id<"sources"> | null;
    inspectionSelectedSource?: Parameters<
        typeof SourceReview
    >[0]["selectedSource"];
    onInspectionSelectedIdChange?: Parameters<
        typeof SourceReview
    >[0]["onSelectedIdChange"];
    inspectionHasMore?: boolean;
    inspectionIsLoadingMore?: boolean;
    inspectionIsLoadingInitial?: boolean;
    onLoadMoreInspection?: () => void;
    sourceReviewNavigation?: SourceReviewNavigation;
    onSourceReviewNavigate?: (destination: SourceReviewNavigation) => void;
}) {
    const [internalNavigation, setInternalNavigation] =
        useState<SourceReviewNavigation>({
            view: "overview",
        });
    const { view, coverage: coverageRole } =
        sourceReviewNavigation ?? internalNavigation;
    const navigateSourceReview = (destination: SourceReviewNavigation) => {
        if (sourceReviewNavigation === undefined)
            setInternalNavigation(destination);
        onSourceReviewNavigate?.(destination);
    };
    const isMobile = useMediaQuery("(width < 48rem)");
    const [actionsOpen, setActionsOpen] = useState(false);
    const [addSourceOpen, setAddSourceOpen] = useState(false);
    const actionsTriggerRef = useRef<HTMLButtonElement>(null);
    const includedCount = adjustmentSets.included.length;
    const navigationPreset: ProposalNavigationPreset =
        view === "overview" ? "slide-right" : "slide-left";
    const [hasNavigated, setHasNavigated] = useState(false);
    const shouldReduceMotion = useMediaQuery(
        "(prefers-reduced-motion: reduce)",
    );
    const isApproved = summary.revisionStatus === "approved";
    const isPreparing =
        isStartingPreparation || summary.preparation?.status === "started";
    const allowanceFeedback = sourceSearchAllowanceCopy(
        summary.searchAllowance,
        Date.now(),
    );
    const canSearch =
        !!onRecoverDiscovery &&
        (!summary.preparation || !!summary.searchAllowance);
    const searchDisabled =
        isRecovering ||
        isPreparing ||
        isRebuilding ||
        summary.effectiveStatus !== "ready" ||
        !!allowanceFeedback;
    const preparationCopy = summary.preparation
        ? sourcePreparationCopy(summary.preparation, summary.revisionStatus)
        : null;
    const canApprove =
        !isApproved &&
        !isRecovering &&
        !isRebuilding &&
        !isPreparing &&
        summary.effectiveStatus === "ready" &&
        includedCount > 0;
    const coverageGaps = summary.coverageGaps ?? [];
    const coverageContext = summary.coverageRequirements?.find(
        (item) => item.role === coverageRole,
    );
    const coverageCandidates = [
        ...adjustmentSets.included,
        ...adjustmentSets.available,
    ].filter((source) =>
        coverageContext?.candidateIds.includes(source.sourceId),
    );
    const retryAfterSeconds = recovery?.retryAfterSeconds ?? 0;
    const globalRecovery =
        recovery &&
        (recovery.target.kind === "failed_discovery" ||
            !coverageGaps.includes(recovery.target.role))
            ? recovery
            : undefined;
    const coverageReview = coverageContext
        ? {
              ...inspectionReview,
              total: coverageCandidates.length,
              counts: {
                  accepted: coverageCandidates.filter(
                      (source) => source.decision === "accepted",
                  ).length,
                  pending: coverageCandidates.filter(
                      (source) => source.decision === "pending",
                  ).length,
                  rejected: coverageCandidates.filter(
                      (source) => source.decision === "rejected",
                  ).length,
              },
              sources: coverageCandidates.map((source) => ({
                  ...source,
                  reason: source.decisionReason,
              })),
          }
        : inspectionReview;

    const openSecondaryView = (
        nextView: "adjust" | "inspect",
        coverage?: SourceReviewNavigation["coverage"],
    ) => {
        setActionsOpen(false);
        setHasNavigated(true);
        navigateSourceReview({
            view: nextView,
            ...(coverage ? { coverage } : {}),
        });
    };

    const returnToProposal = () => {
        setHasNavigated(true);
        navigateSourceReview({ view: "overview" });
    };

    const reviewCoverage = (
        role: NonNullable<SourceReviewNavigation["coverage"]>,
        preferIncluded = false,
    ) => {
        onInspectionFilterChange?.("all");
        const requirement = summary.coverageRequirements?.find(
            (item) => item.role === role,
        );
        const first = preferIncluded
            ? (requirement?.includedSourceIds?.[0] ??
              requirement?.candidateIds[0])
            : (requirement?.candidateIds.find(
                  (sourceId) =>
                      !requirement.includedSourceIds?.includes(sourceId),
              ) ?? requirement?.candidateIds[0]);
        onInspectionSelectedIdChange?.(first ?? null);
        openSecondaryView("inspect", role);
    };
    const addSourceDialog =
        !isApproved && onAddManualUrl ? (
            <AddSourceDialog
                open={addSourceOpen}
                onOpenChange={setAddSourceOpen}
                onAdd={onAddManualUrl}
                finalFocus={actionsTriggerRef}
            />
        ) : null;
    const overviewCoverage = (
        <SourceCoverageRail
            requirements={summary.coverageRequirements ?? []}
            readOnly={isApproved}
            onReview={reviewCoverage}
            onSearch={
                canSearch && onRecoverDiscovery
                    ? (role) => onRecoverDiscovery({ kind: "coverage", role })
                    : undefined
            }
            onAddSource={
                !isApproved && onAddManualUrl
                    ? () => setAddSourceOpen(true)
                    : undefined
            }
            searchDisabled={searchDisabled}
            isSearching={isRecovering}
            recovery={recovery}
            allowanceFeedback={allowanceFeedback}
        />
    );

    if (view === "inspect") {
        const contextSearch = coverageContext
            ? sourceCoverageSearchState({
                  role: coverageContext.role,
                  recovery,
                  isSearching: isRecovering,
                  disabled: searchDisabled,
                  allowanceFeedback,
              })
            : null;
        return (
            <ProposalViewTransition
                view={view}
                preset={navigationPreset}
                hasNavigated={hasNavigated}
                shouldReduceMotion={shouldReduceMotion}>
                <section
                    aria-label="Inspect all source candidates"
                    className="space-y-3">
                    {addSourceDialog}
                    <div className="surface-panel flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 p-3">
                        <div className="flex flex-wrap items-center gap-3">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={returnToProposal}>
                                <Icon iconNode={ArrowLeft01Icon} />
                                Back to proposal
                            </Button>
                            <span className="border-l border-border px-3 text-sm text-muted-foreground">
                                {includedCount} sources included
                            </span>
                        </div>
                        {!isApproved && onAddManualUrl ? (
                            <Button
                                ref={actionsTriggerRef}
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setAddSourceOpen(true)}>
                                <Icon iconNode={PlusSignIcon} />
                                Add source link
                            </Button>
                        ) : null}
                    </div>
                    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[auto_minmax(0,1fr)]">
                        <SourceCoverageNavigation
                            requirements={summary.coverageRequirements ?? []}
                            selectedRole={coverageRole}
                            onReview={reviewCoverage}
                        />
                        <div className="min-w-0 space-y-3">
                            <header className="surface-panel space-y-3 rounded-xl border border-border/60 p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <h2 className="text-xl font-medium tracking-tight">
                                            {coverageContext
                                                ? "Review matching candidates"
                                                : "Inspect all candidates"}
                                        </h2>
                                        {coverageContext ? (
                                            <p className="mt-1 text-sm text-muted-foreground">
                                                {sourceCoverageRoleLabel(
                                                    coverageContext.role,
                                                )}{" "}
                                                · {coverageCandidates.length}{" "}
                                                potential{" "}
                                                {coverageCandidates.length === 1
                                                    ? "match"
                                                    : "matches"}
                                            </p>
                                        ) : (
                                            <p className="mt-1 text-sm text-muted-foreground">
                                                Review provenance and individual
                                                source decisions.
                                            </p>
                                        )}
                                    </div>
                                    {coverageContext ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() =>
                                                navigateSourceReview({
                                                    view: "inspect",
                                                })
                                            }>
                                            Show all candidates
                                        </Button>
                                    ) : null}
                                </div>
                                {coverageContext?.relatedCandidateIds
                                    ?.length ? (
                                    <p className="text-sm text-muted-foreground">
                                        {
                                            coverageContext.relatedCandidateIds
                                                .length
                                        }{" "}
                                        other documents from this source family
                                        are available under Show all candidates.
                                        They have not been identified as matches
                                        for this document requirement.
                                    </p>
                                ) : null}
                                {coverageContext ? (
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <p className="max-w-prose text-sm text-muted-foreground">
                                            {
                                                sourceCoverageCopy(
                                                    coverageContext,
                                                ).description
                                            }
                                        </p>
                                        {!isApproved &&
                                        !coverageContext.covered &&
                                        canSearch &&
                                        onRecoverDiscovery ? (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                aria-label={
                                                    contextSearch?.ariaLabel
                                                }
                                                disabled={
                                                    contextSearch?.disabled ??
                                                    true
                                                }
                                                aria-busy={
                                                    contextSearch?.searching
                                                }
                                                onClick={() =>
                                                    void onRecoverDiscovery({
                                                        kind: "coverage",
                                                        role: coverageContext.role,
                                                    })
                                                }>
                                                <Icon iconNode={Search01Icon} />
                                                {contextSearch?.label}
                                            </Button>
                                        ) : null}
                                    </div>
                                ) : null}
                                {coverageContext ? (
                                    <>
                                        <SourceSearchFeedback
                                            feedback={contextSearch?.feedback}
                                            searching={contextSearch?.searching}
                                            retryAfterSeconds={
                                                contextSearch?.retryAfterSeconds
                                            }
                                        />
                                        <SourceSearchFeedback
                                            feedback={
                                                contextSearch?.availabilityFeedback
                                            }
                                        />
                                    </>
                                ) : null}
                            </header>
                            <SourceReview
                                annotation={renderProposalAnnotation}
                                runId={runId}
                                corpusRevisionId={corpusRevisionId}
                                key={coverageRole ?? "all"}
                                review={coverageReview}
                                proposalSources={
                                    coverageContext
                                        ? coverageCandidates
                                        : [
                                              ...adjustmentSets.included,
                                              ...adjustmentSets.available,
                                          ]
                                }
                                onDecide={onDecide}
                                onApprove={onApprove}
                                onAddManualUrl={onAddManualUrl}
                                showToolbar={false}
                                filter={
                                    coverageContext
                                        ? undefined
                                        : inspectionFilter
                                }
                                onFilterChange={
                                    coverageContext
                                        ? undefined
                                        : onInspectionFilterChange
                                }
                                selectedId={inspectionSelectedId}
                                selectedSource={
                                    !coverageContext ||
                                    coverageCandidates.some(
                                        (source) =>
                                            source.sourceId ===
                                            inspectionSelectedSource?.sourceId,
                                    )
                                        ? inspectionSelectedSource
                                        : undefined
                                }
                                onSelectedIdChange={
                                    onInspectionSelectedIdChange
                                }
                                hasMore={!coverageContext && inspectionHasMore}
                                isLoadingMore={
                                    !coverageContext && inspectionIsLoadingMore
                                }
                                isLoadingInitial={
                                    !coverageContext &&
                                    inspectionIsLoadingInitial
                                }
                                onLoadMore={onLoadMoreInspection}
                                showApprovalAction={false}
                                emptyState={
                                    coverageContext
                                        ? {
                                              title: "No matching candidates",
                                              description:
                                                  "Your dossier still has other sources. Show all candidates or add a source link for this requirement.",
                                          }
                                        : undefined
                                }
                            />
                        </div>
                    </div>
                </section>
            </ProposalViewTransition>
        );
    }

    if (view === "adjust") {
        return (
            <ProposalViewTransition
                view={view}
                preset={navigationPreset}
                hasNavigated={hasNavigated}
                shouldReduceMotion={shouldReduceMotion}>
                <section aria-label="Adjust source proposal">
                    <SecondaryViewHeader
                        title="Adjust proposal"
                        description="Drag sources between Included and Available, or use the card actions. Included sources form the corpus."
                        onBack={returnToProposal}
                    />
                    <SourceProposalAdjustmentBoard
                        adjustmentSets={adjustmentSets}
                        runId={runId}
                        corpusRevisionId={corpusRevisionId}
                        reviewStatus={summary.revisionStatus}
                        onDecide={onDecide}
                        annotation={renderProposalAnnotation}
                    />
                </section>
            </ProposalViewTransition>
        );
    }

    const groups = {
        recommended: adjustmentSets.included,
        needs_attention: adjustmentSets.available.filter(
            (source) =>
                source.disposition === "needs_attention" &&
                source.decision === "pending",
        ),
        alternative: adjustmentSets.available.filter(
            (source) =>
                source.disposition !== "needs_attention" ||
                source.decision !== "pending",
        ),
    };
    const tabs = dispositionTabs.map((tab) => ({
        ...tab,
        count: groups[tab.id].length,
    }));

    const proposalActions = (
        <TooltipProvider delay={200}>
            <div
                className={
                    isMobile
                        ? "flex flex-col gap-2 [&_button]:min-h-11 [&_button]:justify-start"
                        : "flex flex-wrap gap-2"
                }>
                {!isApproved && onAddManualUrl ? (
                    <Button
                        ref={isMobile ? undefined : actionsTriggerRef}
                        type="button"
                        variant="outline"
                        disabled={isPreparing}
                        onClick={() => {
                            setActionsOpen(false);
                            setAddSourceOpen(true);
                        }}>
                        <Icon iconNode={PlusSignIcon} />
                        Add source link
                    </Button>
                ) : null}
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => openSecondaryView("adjust")}
                            />
                        }>
                        <Icon iconNode={Settings02Icon} />
                        Adjust proposal
                    </TooltipTrigger>
                    <TooltipContent
                        side="bottom"
                        className="max-w-72 text-center">
                        Refine the proposed corpus by moving sources between
                        Included and Available before approval.
                    </TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => openSecondaryView("inspect")}
                            />
                        }>
                        <Icon iconNode={Search01Icon} />
                        Inspect all candidates
                    </TooltipTrigger>
                    <TooltipContent
                        side="bottom"
                        className="max-w-72 text-center">
                        Review every discovered candidate, its provenance, and
                        its current source decision.
                    </TooltipContent>
                </Tooltip>
            </div>
        </TooltipProvider>
    );

    return (
        <ProposalViewTransition
            view={view}
            preset={navigationPreset}
            hasNavigated={hasNavigated}
            shouldReduceMotion={shouldReduceMotion}>
            <section aria-label="Proposed source set" className="space-y-4">
                {addSourceDialog}
                {summary.effectiveStatus === "outdated" && !isApproved ? (
                    <AlertStatus
                        status="info"
                        variant="outline"
                        closable={false}
                        className="has-data-[slot=alert-action]:pr-4 **:data-[slot=alert-action]:static **:data-[slot=alert-action]:mt-2 sm:has-data-[slot=alert-action]:pr-36 sm:**:data-[slot=alert-action]:absolute sm:**:data-[slot=alert-action]:top-2.5 sm:**:data-[slot=alert-action]:right-3 sm:**:data-[slot=alert-action]:mt-0"
                        title="Improved proposal method available"
                        description="Rebuild this draft source set with the improved selection method before approval."
                        action={
                            <Button
                                type="button"
                                variant="secondary"
                                className="w-full sm:w-auto"
                                disabled={isRebuilding || isPreparing}
                                onClick={() => void onRebuild()}>
                                {isRebuilding
                                    ? "Rebuilding proposal…"
                                    : "Rebuild proposal"}
                            </Button>
                        }
                    />
                ) : null}
                {(summary.rebuildOutcome === "partial" || globalRecovery) &&
                !isApproved &&
                !summary.preparation ? (
                    <AlertStatus
                        status={globalRecovery?.feedback?.status ?? "warning"}
                        closable={false}
                        title={
                            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                                <span>
                                    {globalRecovery?.feedback?.title ??
                                        (isRecovering && globalRecovery
                                            ? "Searching sources…"
                                            : "Some searches failed")}
                                </span>
                                {onRecoverDiscovery &&
                                summary.failedDiscoveryFamilies.length > 0 ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="-my-1 -mr-2 text-foreground"
                                        disabled={
                                            isRecovering ||
                                            retryAfterSeconds > 0 ||
                                            isRebuilding ||
                                            summary.effectiveStatus !== "ready"
                                        }
                                        aria-busy={
                                            isRecovering &&
                                            (!recovery || !!globalRecovery)
                                        }
                                        onClick={() =>
                                            void onRecoverDiscovery({
                                                kind: "failed_discovery",
                                            })
                                        }>
                                        <Icon iconNode={RefreshIcon} />
                                        {isRecovering &&
                                        (!recovery || globalRecovery)
                                            ? "Searching…"
                                            : retryAfterSeconds > 0
                                              ? `Retry in ${retryAfterSeconds}s`
                                              : "Retry searches"}
                                    </Button>
                                ) : null}
                            </div>
                        }
                        description={
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                <span>
                                    {globalRecovery?.feedback?.description ??
                                        "We kept the sources already found."}
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                    {summary.failedDiscoveryFamilies.map(
                                        (family) => (
                                            <SourceFamilyBadge
                                                key={family}
                                                family={family}
                                            />
                                        ),
                                    )}
                                </div>
                            </div>
                        }
                    />
                ) : null}
                <div className="surface-panel space-y-3 rounded-xl border border-border/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <Icon iconNode={CheckListIcon} size={24} />
                            <div>
                                <h2 className="text-base font-medium">
                                    Proposed corpus
                                </h2>
                                <p className="mt-0.5 text-sm text-muted-foreground">
                                    {includedCount}{" "}
                                    {includedCount === 1 ? "source" : "sources"}{" "}
                                    included
                                </p>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {isMobile ? (
                                <Popover
                                    open={actionsOpen}
                                    onOpenChange={setActionsOpen}>
                                    <PopoverTrigger
                                        render={
                                            <Button
                                                ref={actionsTriggerRef}
                                                type="button"
                                                variant="outline"
                                            />
                                        }>
                                        <Icon iconNode={MoreHorizontalIcon} />
                                        Source actions
                                    </PopoverTrigger>
                                    <PopoverContent
                                        align="end"
                                        className="max-w-[calc(100vw-2rem)] gap-3"
                                        finalFocus={
                                            addSourceOpen ? false : undefined
                                        }>
                                        <PopoverTitle>
                                            Source actions
                                        </PopoverTitle>
                                        {proposalActions}
                                    </PopoverContent>
                                </Popover>
                            ) : (
                                proposalActions
                            )}
                            {!isApproved ? (
                                <Button
                                    type="button"
                                    disabled={!canApprove}
                                    onClick={() => void onApprove()}
                                    className="approve-button h-auto min-h-11 max-w-full whitespace-normal text-left">
                                    <Icon iconNode={CheckmarkCircle02Icon} />
                                    Approve proposed corpus
                                </Button>
                            ) : null}
                        </div>
                    </div>
                    {preparationCopy ? (
                        <div className="space-y-2">
                            <AlertStatus
                                status={preparationCopy.status}
                                role={
                                    preparationCopy.status === "danger"
                                        ? "alert"
                                        : "status"
                                }
                                aria-label={preparationCopy.title}
                                title={preparationCopy.title}
                                description={
                                    <div className="space-y-2">
                                        <p>{preparationCopy.description}</p>
                                        <p className="tabular-nums">
                                            {preparationCopy.counts}
                                        </p>
                                    </div>
                                }
                            />
                            {sourcePreparationActionCopy(
                                summary.preparationAction,
                            ) ? (
                                <p className="text-xs text-muted-foreground">
                                    {sourcePreparationActionCopy(
                                        summary.preparationAction,
                                    )}
                                </p>
                            ) : null}
                            {summary.preparation?.canResume && onPrepare ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={
                                        isPreparing ||
                                        !summary.preparationAction?.available
                                    }
                                    onClick={() => void onPrepare()}>
                                    Continue source preparation
                                </Button>
                            ) : null}
                        </div>
                    ) : (
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3 text-sm">
                            <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
                                Selection uses discovery details only; source
                                content has not been read.
                            </p>
                            {!isApproved && onPrepare ? (
                                <div className="space-y-1">
                                    <Button
                                        type="button"
                                        variant="default"
                                        disabled={
                                            isPreparing ||
                                            !summary.preparationAction
                                                ?.available
                                        }
                                        onClick={() => void onPrepare()}>
                                        {isStartingPreparation
                                            ? "Starting source reading…"
                                            : "Prepare source reading"}
                                    </Button>
                                    {summary.preparationAction?.reason ===
                                    "disabled" ? (
                                        <p className="text-xs text-muted-foreground">
                                            Source reading is currently
                                            unavailable.
                                        </p>
                                    ) : summary.preparationAction?.reason ===
                                      "busy" ? (
                                        <p className="text-xs text-muted-foreground">
                                            Finish the running dossier before
                                            preparing this one.
                                        </p>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    )}
                    {isApproved ? (
                        <p className="text-xs text-muted-foreground">
                            This source set is approved and read-only.
                        </p>
                    ) : summary.effectiveStatus !== "ready" ||
                      summary.selectionExplanationRefreshAvailable ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                            <p>
                                {summary.effectiveStatus === "ready"
                                    ? "Refresh to record detailed selection reasons using saved source data. No new search is needed."
                                    : summary.effectiveStatus === "outdated"
                                      ? "Rebuild this proposal before approval."
                                      : "Refresh the proposal before approval. Your source decisions are unchanged."}
                            </p>
                            {summary.effectiveStatus !== "outdated" ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void onRecompute()}>
                                    <Icon iconNode={RefreshIcon} />
                                    Refresh proposal
                                </Button>
                            ) : null}
                        </div>
                    ) : null}
                </div>
                <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[auto_minmax(0,1fr)]">
                    {overviewCoverage}
                    <SourceProposalCarousel
                        group={disposition}
                        items={groups[disposition]}
                        runId={runId}
                        corpusRevisionId={corpusRevisionId}
                        readOnly={isApproved}
                        selectedId={inspectionSelectedId}
                        selectedSource={inspectionSelectedSource}
                        onSelect={onInspectionSelectedIdChange}
                        onDecide={onDecide}
                        annotation={renderProposalAnnotation}
                        toolbar={
                            <div className="space-y-2">
                                <DiscreteTabs
                                    tabs={tabs}
                                    labelVisibility="all"
                                    overflow="wrap"
                                    orientation={
                                        isMobile ? "vertical" : "horizontal"
                                    }
                                    appearance={isMobile ? "plain" : "pill"}
                                    value={disposition}
                                    onValueChange={(value) =>
                                        onDispositionChange(
                                            value as ProposalDisposition,
                                        )
                                    }
                                    ariaLabel="Review source proposal by disposition"
                                    className={
                                        isMobile
                                            ? "gap-0.5 rounded-lg bg-muted/35 p-1"
                                            : "gap-2"
                                    }
                                />
                                {disposition === "needs_attention" ? (
                                    <p className="text-xs text-muted-foreground">
                                        Candidates awaiting your inclusion
                                        decision. Preparation issues are shown
                                        separately above.
                                    </p>
                                ) : null}
                            </div>
                        }
                    />
                </div>
            </section>
        </ProposalViewTransition>
    );
}

function ProposalViewTransition({
    view,
    preset,
    hasNavigated,
    shouldReduceMotion,
    children,
}: {
    view: ProposalView;
    preset: ProposalNavigationPreset;
    hasNavigated: boolean;
    shouldReduceMotion: boolean;
    children: ReactNode;
}) {
    return (
        <MotionAnimatePresence
            contentKey={view}
            mode="popLayout"
            preset={preset}
            initial={
                shouldReduceMotion
                    ? { opacity: 0 }
                    : hasNavigated
                      ? undefined
                      : false
            }
            animate={shouldReduceMotion ? { opacity: 1 } : undefined}
            exit={{ opacity: 0 }}
            duration={shouldReduceMotion ? 0.22 : 0.5}
            wrapperClassName="min-w-0 overflow-x-clip"
            className="min-w-0">
            {children}
        </MotionAnimatePresence>
    );
}

function SecondaryViewHeader({
    title,
    description,
    onBack,
}: {
    title: string;
    description: string;
    onBack: () => void;
}) {
    return (
        <header className="surface-panel mb-4 flex flex-col gap-3 rounded-xl border border-border/60 p-4 sm:flex-row sm:items-center">
            <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onBack}>
                <Icon iconNode={ArrowLeft01Icon} />
                Back to proposal
            </Button>
            <div className="min-w-0 sm:border-l sm:border-border/60 sm:pl-4">
                <h1 className="text-lg font-medium">{title}</h1>
                <p className="text-xs text-muted-foreground">{description}</p>
            </div>
        </header>
    );
}

function renderProposalAnnotation(source: ProposalSource) {
    const explanation = sourceSelectionExplanation(source);
    return (
        <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <div className="flex flex-wrap items-center gap-2">
                <SourceFamilyBadge family={source.sourceFamily} />
                {source.disposition === "needs_attention" && source.included ? (
                    <Badge variant="outline">Needs attention</Badge>
                ) : null}
            </div>
            <p>{explanation.reason}</p>
            <p>{explanation.assessment}</p>
            {explanation.limitations.map((limitation) => (
                <p key={limitation}>{limitation}</p>
            ))}
            {explanation.missingRationale ? (
                <p>
                    A detailed selection reason was not saved for this proposal.
                </p>
            ) : null}
            {source.decision !== "pending" ? (
                <span className="font-medium text-foreground">
                    Analyst override: {humanize(source.decision)}
                </span>
            ) : null}
        </div>
    );
}
