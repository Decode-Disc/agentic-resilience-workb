import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    AlertCircleIcon,
    ArrowLeft01Icon,
    CheckListIcon,
    CheckmarkCircle02Icon,
    ArrowDown01Icon,
    MoreHorizontalIcon,
    RefreshIcon,
    Search01Icon,
    Settings02Icon,
    PlusSignIcon,
} from "@hugeicons/core-free-icons";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useReducedMotion } from "motion/react";
import { type ReactNode, useRef, useState } from "react";

import Icon from "@/components/icon";
import { AlertStatus } from "@/components/ui/alert-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardAction,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import DiscreteTabs, {
    type DiscreteTabItem,
} from "@/components/ui/discrete-tabs";
import MotionAnimatePresence from "@/components/ui/motion-animate-presence";
import {
    Popover,
    PopoverContent,
    PopoverDescription,
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
import { SourceFamilyBadge } from "@/components/workspace/source-family-badge";
import {
    SourceMasterList,
    SOURCE_REVIEW_PAGE_SIZE,
} from "@/components/workspace/source-master-list";
import {
    SourceAdjustmentActions,
    SourceProposalAdjustmentBoard,
} from "@/components/workspace/source-proposal-adjustment-board";
import { SourceReview } from "@/components/workspace/source-review";
import { useMediaQuery } from "@/hooks/use-responsive";
import {
    sourceCompanyLinkageLabel,
    sourceCoverageRoleLabel,
    sourceSelectionReasonLabel,
    type sourceRecoveryFeedback,
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
    runId: Id<"researchRuns">;
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
    recovery?: {
        target: FunctionArgs<
            typeof api.sourceSelectionProposalActions.recoverDiscovery
        >["target"];
        feedback: ReturnType<typeof sourceRecoveryFeedback> | null;
        retryAfterSeconds: number;
    };
    onAddManualUrl?: (url: string) => void | Promise<void>;
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
        useState<SourceReviewNavigation>({ view: "overview" });
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
    const [visibleCounts, setVisibleCounts] = useState<
        Record<ProposalDisposition, number>
    >({
        recommended: SOURCE_REVIEW_PAGE_SIZE,
        needs_attention: SOURCE_REVIEW_PAGE_SIZE,
        alternative: SOURCE_REVIEW_PAGE_SIZE,
    });
    const includedCount = adjustmentSets.included.length;
    const navigationPreset: ProposalNavigationPreset =
        view === "overview" ? "slide-right" : "slide-left";
    const [hasNavigated, setHasNavigated] = useState(false);
    const shouldReduceMotion = useReducedMotion();
    const isApproved = summary.revisionStatus === "approved";
    const canApprove =
        !isApproved &&
        !isRecovering &&
        !isRebuilding &&
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

    if (view === "inspect") {
        return (
            <ProposalViewTransition
                view={view}
                preset={navigationPreset}
                hasNavigated={hasNavigated}
                shouldReduceMotion={shouldReduceMotion}>
                <section aria-label="Inspect all source candidates">
                    <SecondaryViewHeader
                        title={
                            coverageContext
                                ? "Review matching candidates"
                                : "Inspect all candidates"
                        }
                        description="Review provenance and override individual source decisions when needed."
                        onBack={returnToProposal}
                    />
                    {coverageContext ? (
                        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 pb-3 text-sm">
                            <span className="font-medium">
                                {sourceCoverageRoleLabel(coverageContext.role)}
                            </span>
                            <span className="text-muted-foreground">
                                {coverageCandidates.length} potential{" "}
                                {coverageCandidates.length === 1
                                    ? "match"
                                    : "matches"}
                            </span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                    navigateSourceReview({ view: "inspect" })
                                }>
                                Show all candidates
                            </Button>
                            <p className="w-full text-xs text-muted-foreground">
                                Check provenance before including a source.
                                Inclusion alone does not confirm coverage.
                            </p>
                        </div>
                    ) : null}
                    <SourceReview
                        runId={runId}
                        corpusRevisionId={corpusRevisionId}
                        key={coverageRole ?? "all"}
                        review={coverageReview}
                        onDecide={onDecide}
                        onApprove={onApprove}
                        onAddManualUrl={onAddManualUrl}
                        filter={coverageContext ? undefined : inspectionFilter}
                        onFilterChange={
                            coverageContext
                                ? undefined
                                : onInspectionFilterChange
                        }
                        selectedId={inspectionSelectedId}
                        selectedSource={
                            coverageContext
                                ? undefined
                                : inspectionSelectedSource
                        }
                        onSelectedIdChange={onInspectionSelectedIdChange}
                        hasMore={!coverageContext && inspectionHasMore}
                        isLoadingMore={
                            !coverageContext && inspectionIsLoadingMore
                        }
                        isLoadingInitial={
                            !coverageContext && inspectionIsLoadingInitial
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
    const dispositionTotal = groups[disposition].length;
    const proposalItems = groups[disposition].slice(
        0,
        visibleCounts[disposition],
    );
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
                {!isApproved && onAddManualUrl ? (
                    <AddSourceDialog
                        open={addSourceOpen}
                        onOpenChange={setAddSourceOpen}
                        onAdd={onAddManualUrl}
                        finalFocus={actionsTriggerRef}
                    />
                ) : null}
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
                                disabled={isRebuilding}
                                onClick={() => void onRebuild()}>
                                {isRebuilding
                                    ? "Rebuilding proposal…"
                                    : "Rebuild proposal"}
                            </Button>
                        }
                    />
                ) : null}
                {(summary.rebuildOutcome === "partial" || globalRecovery) &&
                !isApproved ? (
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
                <Card className="surface-floating gap-2 @container/source-proposal">
                    <CardHeader className="flex flex-col @3xl/source-proposal:grid">
                        <p className="text-micro text-accent-foreground">
                            Proposed source set
                        </p>
                        <CardTitle>
                            {`${includedCount} source${includedCount === 1 ? "" : "s"} included`}
                        </CardTitle>
                        <CardDescription>
                            The system selected a focused corpus from the full
                            candidate list. Review the exceptions or approve it
                            as proposed. Selection uses discovery details only;
                            source content has not been read.
                        </CardDescription>
                        <CardAction>
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
                                        align="start"
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
                        </CardAction>
                    </CardHeader>
                    {coverageGaps.length > 0 ? (
                        <CardContent>
                            <AlertStatus
                                title="Source coverage needs review"
                                closable={false}
                                description={
                                    <div className="space-y-2">
                                        {isApproved ? (
                                            <span>
                                                These limitations remain in the
                                                approved source set. Changes
                                                need a new revision.
                                            </span>
                                        ) : null}
                                        <ul
                                            className="flex flex-wrap gap-1.5"
                                            aria-label="Unconfirmed source requirements">
                                            {coverageGaps.map((gap) => (
                                                <li
                                                    key={gap}
                                                    className="max-w-full">
                                                    {isApproved ? (
                                                        <Badge variant="outline">
                                                            {sourceCoverageRoleLabel(
                                                                gap,
                                                            )}
                                                        </Badge>
                                                    ) : (
                                                        <CoverageGapControl
                                                            role={gap}
                                                            onReview={() => {
                                                                onInspectionFilterChange?.(
                                                                    "all",
                                                                );
                                                                const first =
                                                                    summary.coverageRequirements?.find(
                                                                        (
                                                                            item,
                                                                        ) =>
                                                                            item.role ===
                                                                            gap,
                                                                    )
                                                                        ?.candidateIds[0];
                                                                if (first)
                                                                    onInspectionSelectedIdChange?.(
                                                                        first,
                                                                    );
                                                                openSecondaryView(
                                                                    "inspect",
                                                                    gap,
                                                                );
                                                            }}
                                                            onSearch={
                                                                onRecoverDiscovery
                                                                    ? () =>
                                                                          onRecoverDiscovery(
                                                                              {
                                                                                  kind: "coverage",
                                                                                  role: gap,
                                                                              },
                                                                          )
                                                                    : undefined
                                                            }
                                                            searchDisabled={
                                                                isRecovering ||
                                                                retryAfterSeconds >
                                                                    0 ||
                                                                isRebuilding ||
                                                                summary.effectiveStatus !==
                                                                    "ready"
                                                            }
                                                            isSearching={
                                                                isRecovering &&
                                                                recovery?.target
                                                                    .kind ===
                                                                    "coverage" &&
                                                                recovery.target
                                                                    .role ===
                                                                    gap
                                                            }
                                                            retryAfterSeconds={
                                                                retryAfterSeconds
                                                            }
                                                            feedback={
                                                                recovery?.target
                                                                    .kind ===
                                                                    "coverage" &&
                                                                recovery.target
                                                                    .role ===
                                                                    gap
                                                                    ? recovery.feedback
                                                                    : null
                                                            }
                                                        />
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                }
                                status="warning"
                            />
                        </CardContent>
                    ) : null}
                    <CardFooter className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-muted-foreground">
                            {isApproved
                                ? "This source set is approved and read-only."
                                : summary.effectiveStatus === "stale"
                                  ? "The candidate list changed. Refresh the proposal before approval."
                                  : summary.effectiveStatus === "failed"
                                    ? "The proposal could not be prepared. Refresh it before approval."
                                    : summary.effectiveStatus === "outdated"
                                      ? "Rebuild this proposal before approval."
                                      : `${includedCount} source${includedCount === 1 ? " is" : "s are"} currently included.`}
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {(summary.effectiveStatus === "stale" ||
                                summary.effectiveStatus === "failed") &&
                            !isApproved ? (
                                <Button
                                    type="button"
                                    variant="default"
                                    onClick={() => void onRecompute()}>
                                    <Icon iconNode={RefreshIcon} />
                                    Refresh proposal
                                </Button>
                            ) : null}
                            {!isApproved ? (
                                <Button
                                    type="button"
                                    size="lg"
                                    onClick={() => void onApprove()}
                                    disabled={!canApprove}
                                    className="approve-button uppercase">
                                    <Icon iconNode={CheckmarkCircle02Icon} />
                                    Approve source set
                                </Button>
                            ) : null}
                        </div>
                    </CardFooter>
                </Card>

                <div>
                    <div className="bg-card rounded-t-(--radius-source-card) border border-border/60 p-3">
                        <DiscreteTabs
                            tabs={tabs}
                            value={disposition}
                            onValueChange={(value) =>
                                onDispositionChange(
                                    value as ProposalDisposition,
                                )
                            }
                            ariaLabel="Review source proposal by disposition"
                            className="gap-4"
                        />
                    </div>

                    <SourceMasterList
                        heading={
                            dispositionTabs.find(({ id }) => id === disposition)
                                ?.title ?? "Proposal sources"
                        }
                        description={
                            disposition === "recommended"
                                ? "Sources selected for the proposed corpus."
                                : disposition === "needs_attention"
                                  ? "Sources whose discovery details need analyst review."
                                  : "Other candidates retained for comparison."
                        }
                        runId={runId}
                        items={proposalItems}
                        hasMore={proposalItems.length < dispositionTotal}
                        onLoadMore={() =>
                            setVisibleCounts((current) => ({
                                ...current,
                                [disposition]:
                                    current[disposition] +
                                    SOURCE_REVIEW_PAGE_SIZE,
                            }))
                        }
                        total={dispositionTotal}
                        reviewStatus={summary.revisionStatus}
                        collectionLabel={`${humanize(disposition)} source collection`}
                        emptyTitle={`No ${humanize(disposition).toLocaleLowerCase("en")} sources`}
                        emptyDescription="No sources currently match this proposal view."
                        annotation={renderProposalAnnotation}
                        rowAction={
                            isApproved
                                ? undefined
                                : (source) => (
                                      <SourceAdjustmentActions
                                          source={source}
                                          disabled={false}
                                          onDecide={onDecide}
                                          context="overview"
                                      />
                                  )
                        }
                        className="rounded-none rounded-b-(--radius-source-card)"
                        listClassName="grid grid-cols-1 lg:grid-cols-2 gap-4"
                    />
                </div>
            </section>
        </ProposalViewTransition>
    );
}

function CoverageGapControl({
    role,
    onReview,
    onSearch,
    searchDisabled,
    isSearching,
    retryAfterSeconds,
    feedback,
}: {
    role: ProposalSummary["coverageRequirements"][number]["role"];
    onReview: () => void;
    onSearch?: () => void | Promise<void>;
    searchDisabled: boolean;
    isSearching: boolean;
    retryAfterSeconds: number;
    feedback: ReturnType<typeof sourceRecoveryFeedback> | null;
}) {
    const [open, setOpen] = useState(false);
    const label = sourceCoverageRoleLabel(role);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                aria-label={`Review coverage: ${label}`}
                render={
                    <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        className="h-auto min-h-8 max-w-full whitespace-normal py-1 text-left font-normal text-foreground"
                    />
                }>
                {label}
                <Icon iconNode={ArrowDown01Icon} />
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="max-w-[calc(100vw-2rem)] gap-3">
                <PopoverTitle className="text-sm">{label}</PopoverTitle>
                <PopoverDescription>
                    Not yet confirmed in your included sources. You can approve
                    with this limitation, review candidates, or search for more.
                </PopoverDescription>
                <div className="flex flex-col gap-2 [&_button]:justify-start">
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={`Review candidates for ${label}`}
                        onClick={() => {
                            setOpen(false);
                            onReview();
                        }}>
                        Review candidates
                    </Button>
                    {onSearch ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            aria-label={
                                isSearching
                                    ? `Searching sources for ${label}`
                                    : retryAfterSeconds > 0
                                      ? `Retry in ${retryAfterSeconds}s for ${label}`
                                      : `Search sources for ${label}`
                            }
                            disabled={searchDisabled}
                            aria-busy={isSearching}
                            onClick={() => {
                                void onSearch();
                            }}>
                            <Icon iconNode={Search01Icon} />
                            {isSearching
                                ? "Searching…"
                                : retryAfterSeconds > 0
                                  ? `Retry in ${retryAfterSeconds}s`
                                  : "Search sources"}
                        </Button>
                    ) : null}
                </div>
                {feedback ? (
                    <AlertStatus
                        status={feedback.status}
                        size="sm"
                        closable={false}
                        title={feedback.title}
                        description={feedback.description}
                    />
                ) : isSearching ? (
                    <p role="status" className="text-sm font-medium">
                        Searching for matching sources…
                    </p>
                ) : null}
            </PopoverContent>
        </Popover>
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
    shouldReduceMotion: boolean | null;
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
    const companyLinkageLabel = sourceCompanyLinkageLabel(
        source.companyLinkageBasis,
    );
    return (
        <div className="mt-3 flex flex-wrap items-center gap-2 px-1 text-[11px] text-muted-foreground">
            <SourceFamilyBadge family={source.sourceFamily} />
            {source.disposition === "needs_attention" && source.included ? (
                <Badge variant="outline">Needs attention</Badge>
            ) : null}
            <span>
                {companyLinkageLabel ??
                    sourceSelectionReasonLabel(source.reasonCodes)}
            </span>
            {source.decision !== "pending" ? (
                <span className="font-medium text-foreground">
                    Analyst override: {humanize(source.decision)}
                </span>
            ) : null}
        </div>
    );
}
