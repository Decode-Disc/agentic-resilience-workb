import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    AlertCircleIcon,
    ArrowLeft01Icon,
    CheckListIcon,
    CheckmarkCircle02Icon,
    Search01Icon,
    Settings02Icon,
} from "@hugeicons/core-free-icons";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useReducedMotion } from "motion/react";
import { type ReactNode, useState } from "react";

import Icon from "@/components/icon";
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
import { SourceMasterList } from "@/components/workspace/source-master-list";
import { SourceProposalAdjustmentBoard } from "@/components/workspace/source-proposal-adjustment-board";
import { SourceReview } from "@/components/workspace/source-review";

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

function proposalReason(source: ProposalSource): string {
    const reason = source.reasonCodes[0];
    if (reason === "added_by_analyst") {
        return "Added by analyst";
    }
    if (reason === "required_family_coverage") {
        return "Fills a required evidence family";
    }
    if (reason === "ranked_fill") {
        return "Adds breadth within the available source details";
    }
    if (reason === "unrecognized_source_family") {
        return "Source family needs analyst review";
    }
    return "Available as an alternative";
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
                    {summary.gaps.length > 0 ? (
                        <CardContent className="rounded-xl border border-review/30 bg-review/10">
                            <p className="text-xs font-medium text-foreground">
                                Coverage gaps to keep in view
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {summary.gaps.map((gap) => (
                                    <Badge key={gap} variant="outline">
                                        {humanize(gap)}
                                    </Badge>
                                ))}
                            </div>
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
                                    : `${summary.effectiveIncludedCount} source${summary.effectiveIncludedCount === 1 ? " is" : "s are"} currently included.`}
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {summary.effectiveStatus !== "ready" &&
                            !isApproved ? (
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => void onRecompute()}>
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
            duration={shouldReduceMotion ? 0.15 : 0.22}
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
            <Badge variant="outline">{humanize(source.sourceFamily)}</Badge>
            <span>{proposalReason(source)}</span>
            {source.decision !== "pending" ? (
                <span className="font-medium text-foreground">
                    Analyst override: {humanize(source.decision)}
                </span>
            ) : null}
        </div>
    );
}
