import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    AlertCircleIcon,
    ArrowLeft01Icon,
    CheckListIcon,
    CheckmarkCircle02Icon,
    RefreshIcon,
    Search01Icon,
    Settings02Icon,
} from "@hugeicons/core-free-icons";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useReducedMotion } from "motion/react";
import { type ReactNode, useState } from "react";

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
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { SourceFamilyBadge } from "@/components/workspace/source-family-badge";
import { SourceMasterList } from "@/components/workspace/source-master-list";
import { SourceProposalAdjustmentBoard } from "@/components/workspace/source-proposal-adjustment-board";
import { SourceReview } from "@/components/workspace/source-review";
import {
    sourceCoverageRoleLabel,
    sourceSelectionReasonLabel,
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
    proposalItems,
    disposition,
    onDispositionChange,
    adjustmentSets,
    inspectionReview,
    onDecide,
    onApprove,
    onRecompute,
    onRebuild = () => undefined,
    isRebuilding = false,
    onAddManualUrl,
    proposalHasMore = false,
    proposalIsLoadingMore = false,
    proposalIsLoadingInitial = false,
    onLoadMoreProposal = () => undefined,
    inspectionFilter,
    onInspectionFilterChange,
    inspectionSelectedId,
    inspectionSelectedSource,
    onInspectionSelectedIdChange,
    inspectionHasMore = false,
    inspectionIsLoadingMore = false,
    inspectionIsLoadingInitial = false,
    onLoadMoreInspection = () => undefined,
}: {
    runId: Id<"researchRuns">;
    corpusRevisionId: Id<"corpusRevisions">;
    summary: ProposalSummary;
    proposalItems: ReadonlyArray<ProposalSource>;
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
    onAddManualUrl?: (url: string) => void | Promise<void>;
    proposalHasMore?: boolean;
    proposalIsLoadingMore?: boolean;
    proposalIsLoadingInitial?: boolean;
    onLoadMoreProposal?: () => void;
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
}) {
    const [view, setView] = useState<ProposalView>("overview");
    const [navigationPreset, setNavigationPreset] =
        useState<ProposalNavigationPreset>("slide-right");
    const [hasNavigated, setHasNavigated] = useState(false);
    const shouldReduceMotion = useReducedMotion();
    const isApproved = summary.revisionStatus === "approved";
    const canApprove =
        !isApproved &&
        summary.effectiveStatus === "ready" &&
        summary.effectiveIncludedCount > 0;
    const coverageGaps = summary.coverageGaps ?? [];

    const openSecondaryView = (nextView: "adjust" | "inspect") => {
        setNavigationPreset("slide-left");
        setHasNavigated(true);
        setView(nextView);
    };

    const returnToProposal = () => {
        setNavigationPreset("slide-right");
        setHasNavigated(true);
        setView("overview");
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
                        title="Inspect all candidates"
                        description="Review provenance and override individual source decisions when needed."
                        onBack={returnToProposal}
                    />
                    <SourceReview
                        runId={runId}
                        corpusRevisionId={corpusRevisionId}
                        review={inspectionReview}
                        onDecide={onDecide}
                        onApprove={onApprove}
                        onAddManualUrl={onAddManualUrl}
                        filter={inspectionFilter}
                        onFilterChange={onInspectionFilterChange}
                        selectedId={inspectionSelectedId}
                        selectedSource={inspectionSelectedSource}
                        onSelectedIdChange={onInspectionSelectedIdChange}
                        hasMore={inspectionHasMore}
                        isLoadingMore={inspectionIsLoadingMore}
                        isLoadingInitial={inspectionIsLoadingInitial}
                        onLoadMore={onLoadMoreInspection}
                        showApprovalAction={false}
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
                        reviewStatus={summary.revisionStatus}
                        onDecide={onDecide}
                        annotation={renderProposalAnnotation}
                    />
                </section>
            </ProposalViewTransition>
        );
    }

    const tabs = dispositionTabs.map((tab) => ({
        ...tab,
        count:
            tab.id === "recommended"
                ? summary.counts.recommended
                : tab.id === "needs_attention"
                  ? summary.counts.needsAttention
                  : summary.counts.alternative,
    }));
    const dispositionTotal =
        disposition === "recommended"
            ? summary.counts.recommended
            : disposition === "needs_attention"
              ? summary.counts.needsAttention
              : summary.counts.alternative;

    return (
        <ProposalViewTransition
            view={view}
            preset={navigationPreset}
            hasNavigated={hasNavigated}
            shouldReduceMotion={shouldReduceMotion}>
            <section aria-label="Proposed source set" className="space-y-4">
                {summary.effectiveStatus === "outdated" && !isApproved ? (
                    <AlertStatus
                        status="info"
                        variant="outline"
                        closable={false}
                        className="has-data-[slot=alert-action]:pr-4 [&_[data-slot=alert-action]]:static [&_[data-slot=alert-action]]:mt-2 sm:has-data-[slot=alert-action]:pr-36 sm:[&_[data-slot=alert-action]]:absolute sm:[&_[data-slot=alert-action]]:top-2.5 sm:[&_[data-slot=alert-action]]:right-3 sm:[&_[data-slot=alert-action]]:mt-0"
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
                {summary.rebuildOutcome === "partial" && !isApproved ? (
                    <AlertStatus
                        status="warning"
                        variant="outline"
                        closable={false}
                        title="Some source discovery was unavailable"
                        description={
                            <div className="space-y-2">
                                <p>
                                    The proposal uses the reliable sources that
                                    were available. Review the affected coverage
                                    areas or add a public source before
                                    approval.
                                </p>
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
                <Card className="surface-floating">
                    <CardHeader>
                        <p className="text-micro text-accent-foreground">
                            Proposed source set
                        </p>
                        <CardTitle>
                            {`${summary.effectiveIncludedCount} source${summary.effectiveIncludedCount === 1 ? "" : "s"} included`}
                        </CardTitle>
                        <CardDescription>
                            The system selected a focused corpus from the full
                            candidate list. Review the exceptions or approve it
                            as proposed. Selection uses discovery details only;
                            source content has not been read.
                        </CardDescription>
                        <CardAction>
                            <TooltipProvider delay={200}>
                                <div className="flex flex-wrap gap-2">
                                    <Tooltip>
                                        <TooltipTrigger
                                            render={
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={() =>
                                                        openSecondaryView(
                                                            "adjust",
                                                        )
                                                    }
                                                />
                                            }>
                                            <Icon iconNode={Settings02Icon} />
                                            Adjust proposal
                                        </TooltipTrigger>
                                        <TooltipContent
                                            side="bottom"
                                            className="max-w-72 text-center">
                                            Refine the proposed corpus by moving
                                            sources between Included and
                                            Available before approval.
                                        </TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                        <TooltipTrigger
                                            render={
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={() =>
                                                        openSecondaryView(
                                                            "inspect",
                                                        )
                                                    }
                                                />
                                            }>
                                            <Icon iconNode={Search01Icon} />
                                            Inspect all candidates
                                        </TooltipTrigger>
                                        <TooltipContent
                                            side="bottom"
                                            className="max-w-72 text-center">
                                            Review every discovered candidate,
                                            its provenance, and its current
                                            source decision.
                                        </TooltipContent>
                                    </Tooltip>
                                </div>
                            </TooltipProvider>
                        </CardAction>
                    </CardHeader>
                    {coverageGaps.length > 0 ? (
                        <CardContent>
                            <AlertStatus title="Coverage gaps to keep in view"
                                description={<div className="flex flex-wrap gap-1.5">
                                {coverageGaps.map((gap) => (
                                    <Badge key={gap} variant="outline">
                                        {sourceCoverageRoleLabel(gap)}
                                    </Badge>
                                ))}
                                </div>}
                                status="warning" />
                        </CardContent>
                    ) : null}
                    <CardFooter className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-muted-foreground">
                            {isApproved
                                ? "This source set is approved and read-only."
                                : summary.effectiveStatus === "stale"
                                  ? "The candidate list changed. Refresh the proposal before approval."
                                  : summary.effectiveStatus === "failed"
                                    ? "The proposal could not be prepared. Refresh it before approval."
                                    : summary.effectiveStatus === "outdated"
                                      ? "Rebuild this proposal before approval."
                                      : `${summary.effectiveIncludedCount} source${summary.effectiveIncludedCount === 1 ? " is" : "s are"} currently included.`}
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
                            <Button
                                type="button"
                                size="lg"
                                onClick={() => void onApprove()}
                                disabled={!canApprove}
                                className="bg-approved">
                                <Icon iconNode={CheckmarkCircle02Icon} />
                                {isApproved
                                    ? "Source set approved"
                                    : "Approve source set"}
                            </Button>
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
                        items={proposalItems}
                        total={dispositionTotal}
                        reviewStatus={summary.revisionStatus}
                        collectionLabel={`${humanize(disposition)} source collection`}
                        emptyTitle={`No ${humanize(disposition).toLocaleLowerCase("en")} sources`}
                        emptyDescription="No sources currently match this proposal view."
                        annotation={renderProposalAnnotation}
                        hasMore={proposalHasMore}
                        isLoadingMore={proposalIsLoadingMore}
                        isLoadingInitial={proposalIsLoadingInitial}
                        onLoadMore={onLoadMoreProposal}
                        className="rounded-none rounded-b-(--radius-source-card)"
                        listClassName="grid lg:grid-cols-2 gap-4"
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
    return (
        <div className="mt-3 flex flex-wrap items-center gap-2 px-1 text-[11px] text-muted-foreground">
            <SourceFamilyBadge family={source.sourceFamily} />
            <span>{sourceSelectionReasonLabel(source.reasonCodes)}</span>
            {source.decision !== "pending" ? (
                <span className="font-medium text-foreground">
                    Analyst override: {humanize(source.decision)}
                </span>
            ) : null}
        </div>
    );
}
