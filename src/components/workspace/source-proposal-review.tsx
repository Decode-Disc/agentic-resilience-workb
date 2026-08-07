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
import DiscreteTabs, {
    type DiscreteTabItem,
} from "@/components/ui/discrete-tabs";
import MotionAnimatePresence from "@/components/ui/motion-animate-presence";
import { SourceMasterList } from "@/components/workspace/source-master-list";
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
        const actionDisabled = isApproved;
        return (
            <ProposalViewTransition
                view={view}
                preset={navigationPreset}
                hasNavigated={hasNavigated}
                shouldReduceMotion={shouldReduceMotion}>
                <section aria-label="Adjust source proposal">
                    <SecondaryViewHeader
                        title="Adjust proposal"
                        description="Included sources form the corpus. Available sources stay excluded unless you add them."
                        onBack={returnToProposal}
                    />
                    <div className="grid gap-4 md:grid-cols-2">
                        <section aria-labelledby="included-sources-heading">
                            <h2
                                id="included-sources-heading"
                                className="mb-2 text-section">
                                Included
                            </h2>
                            <SourceMasterList
                                heading="Included in proposal"
                                description="Sources currently selected for the proposed corpus."
                                items={adjustmentSets.included}
                                total={adjustmentSets.included.length}
                                reviewStatus={summary.revisionStatus}
                                collectionLabel="Included proposal sources"
                                emptyTitle="No included sources"
                                emptyDescription="Include at least one source before approval."
                                annotation={renderProposalAnnotation}
                                rowAction={(source) => (
                                    <>
                                        <Button
                                            type="button"
                                            size="xs"
                                            variant="outline"
                                            disabled={actionDisabled}
                                            aria-label={`Remove ${source.title} from proposal`}
                                            onClick={() =>
                                                void onDecide(
                                                    source.sourceId,
                                                    "rejected",
                                                )
                                            }>
                                            Remove
                                        </Button>
                                        {source.decision !== "pending" ? (
                                            <Button
                                                type="button"
                                                size="xs"
                                                variant="ghost"
                                                disabled={actionDisabled}
                                                aria-label={`Reset ${source.title} to proposal`}
                                                onClick={() =>
                                                    void onDecide(
                                                        source.sourceId,
                                                        "pending",
                                                    )
                                                }>
                                                Reset to proposal
                                            </Button>
                                        ) : null}
                                    </>
                                )}
                            />
                        </section>
                        <section aria-labelledby="available-sources-heading">
                            <h2
                                id="available-sources-heading"
                                className="mb-2 text-section">
                                Available
                            </h2>
                            <SourceMasterList
                                heading="Available alternatives"
                                description="Candidates excluded from the proposal unless you include them."
                                items={adjustmentSets.available}
                                total={adjustmentSets.available.length}
                                reviewStatus={summary.revisionStatus}
                                collectionLabel="Available proposal sources"
                                emptyTitle="No available alternatives"
                                emptyDescription="Every candidate source is already included."
                                annotation={renderProposalAnnotation}
                                rowAction={(source) => (
                                    <>
                                        <Button
                                            type="button"
                                            size="xs"
                                            variant="outline"
                                            disabled={actionDisabled}
                                            aria-label={`Include ${source.title}`}
                                            onClick={() =>
                                                void onDecide(
                                                    source.sourceId,
                                                    "accepted",
                                                )
                                            }>
                                            Include
                                        </Button>
                                        {source.decision !== "pending" ? (
                                            <Button
                                                type="button"
                                                size="xs"
                                                variant="ghost"
                                                disabled={actionDisabled}
                                                aria-label={`Reset ${source.title} to proposal`}
                                                onClick={() =>
                                                    void onDecide(
                                                        source.sourceId,
                                                        "pending",
                                                    )
                                                }>
                                                Reset to proposal
                                            </Button>
                                        ) : null}
                                    </>
                                )}
                            />
                        </section>
                    </div>
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
                <div className="surface-floating rounded-2xl border border-border/60 p-4 sm:p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                            <p className="text-micro text-brand-purple">
                                Proposed source set
                            </p>
                            <h2 className="mt-2 text-xl font-medium">
                                {`${summary.effectiveIncludedCount} source${summary.effectiveIncludedCount === 1 ? "" : "s"} included`}
                            </h2>
                            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                                The system selected a focused corpus from the
                                full candidate list. Review the exceptions or
                                approve it as proposed. Selection uses discovery
                                details only; source content has not been read.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => openSecondaryView("adjust")}>
                                <Icon iconNode={Settings02Icon} />
                                Adjust proposal
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => openSecondaryView("inspect")}>
                                <Icon iconNode={Search01Icon} />
                                Inspect all candidates
                            </Button>
                        </div>
                    </div>

                    {summary.gaps.length > 0 ? (
                        <div className="mt-4 rounded-xl border border-review/30 bg-review/10 p-3">
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
                        </div>
                    ) : null}

                    <div className="mt-4 flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
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
                    </div>
                </div>

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
