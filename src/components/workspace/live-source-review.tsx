"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { RefreshIcon } from "@hugeicons/core-free-icons";
import {
    useAction,
    useMutation,
    usePaginatedQuery,
    useQuery,
} from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import Icon from "@/components/icon";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SOURCE_REVIEW_PAGE_SIZE } from "@/components/workspace/source-master-list";
import {
    SourceProposalReview,
    type SourceReviewNavigation,
} from "@/components/workspace/source-proposal-review";
import {
    type SourceFilter,
    SourceReview,
} from "@/components/workspace/source-review";
import { sourceRecoveryFeedback } from "@/lib/presentation/research-copy";

type LiveSourceReviewProps = {
    runId: Id<"researchRuns">;
    corpusRevisionId: Id<"corpusRevisions">;
    canStartNewRevision?: boolean;
    sourceReviewNavigation?: SourceReviewNavigation;
    onSourceReviewNavigate?: (destination: SourceReviewNavigation) => void;
    onDecide: Parameters<typeof SourceProposalReview>[0]["onDecide"];
    onAddManualUrl?: Parameters<
        typeof SourceProposalReview
    >[0]["onAddManualUrl"];
};

type RecoveryAttempt = {
    requestId: string;
    target: FunctionArgs<
        typeof api.sourceSelectionProposalActions.recoverDiscovery
    >["target"];
} & (
    | { status: "running" }
    | { status: "failed" }
    | {
          status: "finished";
          result: FunctionReturnType<
              typeof api.sourceSelectionProposalActions.recoverDiscovery
          >;
      }
);

export function LiveSourceReview(props: LiveSourceReviewProps) {
    const {
        runId,
        corpusRevisionId,
        onDecide,
        onAddManualUrl,
        canStartNewRevision = false,
        sourceReviewNavigation,
        onSourceReviewNavigate,
    } = props;
    const [disposition, setDisposition] = useState<
        "recommended" | "needs_attention" | "alternative"
    >("recommended");
    const [inspectionFilter, setInspectionFilter] =
        useState<SourceFilter>("all");
    const [selectedId, setSelectedId] = useState<Id<"sources"> | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [isRebuilding, setIsRebuilding] = useState(false);
    const [isPreparingRequest, setIsPreparingRequest] = useState(false);
    const [requestedPreparationId, setRequestedPreparationId] =
        useState<Id<"sourceSelectionProposalRebuilds"> | null>(null);
    const [recoveryAttempt, setRecoveryAttempt] =
        useState<RecoveryAttempt | null>(null);
    const [clock, setClock] = useState(Date.now);
    const [repairStatus, setRepairStatus] = useState<
        "idle" | "loading" | "complete" | "failed"
    >("idle");
    const [queries, setQueries] = useState<SourceReviewQuerySnapshot | null>(
        null,
    );
    const prepareSources = useMutation(api.sourcePreparation.startForReview);
    const approveProposal = useMutation(
        api.sourceSelectionProposals.approveProposedCorpus,
    );
    const recomputeProposal = useMutation(
        api.sourceSelectionProposals.recompute,
    );
    const recoverDiscovery = useAction(
        api.sourceSelectionProposalActions.recoverDiscovery,
    );
    const rebuildProposal = useAction(
        api.sourceSelectionProposalActions.rebuild,
    );
    const ensureCurrentProposal = useMutation(
        api.sourceSelectionProposals.ensureCurrentForReview,
    );
    const startNewRevision = useMutation(
        api.sourceSelectionProposals.startNewCorpusRevision,
    );
    const queryBridge = (
        <LoadErrorBoundary
            title="Source review could not be loaded"
            description="The candidate source collection is temporarily unavailable. Try loading it again."
            variant="inline">
            <SourceReviewQueryBridge
                runId={runId}
                corpusRevisionId={corpusRevisionId}
                inspectionFilter={inspectionFilter}
                selectedId={selectedId}
                setQueries={setQueries}
            />
        </LoadErrorBoundary>
    );

    const proposal = queries?.proposal;
    const inspectionSummary = queries?.inspectionSummary;
    const recovery = proposal?.recovery;
    const recovering =
        recovery?.status === "started" && recovery.leaseExpiresAt > clock;
    const recoveryLeaseExpiresAt = recovery?.leaseExpiresAt;
    const recoveryPending = recoveryAttempt?.status === "running";
    const retryAfterSeconds =
        recovery?.status === "blocked"
            ? Math.max(0, Math.ceil((recovery.leaseExpiresAt - clock) / 1000))
            : 0;
    const recoveryTarget = recoveryAttempt?.target ?? recovery?.target;
    const persistedResult =
        recovery &&
        recovery.status !== "started" &&
        (!recoveryAttempt || recovery.requestId === recoveryAttempt.requestId)
            ? sourceRecoveryFeedback({
                  outcome: recovery.status,
                  reason: recovery.reason,
                  insertedCount: recovery.insertedCount,
              })
            : null;
    const feedback =
        persistedResult ??
        (recoveryAttempt?.status === "finished"
            ? sourceRecoveryFeedback(recoveryAttempt.result)
            : recoveryAttempt?.status === "failed"
              ? sourceRecoveryFeedback({
                    outcome: "blocked",
                    reason: "unavailable",
                })
              : null);
    const awaitingRecoverySnapshot =
        recoveryAttempt?.status === "finished" &&
        recoveryAttempt.result.reason === "in_progress" &&
        recovery?.requestId !== recoveryAttempt.requestId;
    const isStartingPreparation =
        isPreparingRequest ||
        (requestedPreparationId !== null &&
            proposal?.preparation?.preparationId !== requestedPreparationId);
    useEffect(() => {
        if (!recoveryLeaseExpiresAt || recoveryLeaseExpiresAt <= Date.now())
            return;
        if (recovery?.status === "blocked") {
            setClock(Date.now());
            const timer = setInterval(() => {
                const now = Date.now();
                setClock(now);
                if (now >= recoveryLeaseExpiresAt) clearInterval(timer);
            }, 1000);
            return () => clearInterval(timer);
        }
        const timer = setTimeout(
            () => setClock(Date.now()),
            recoveryLeaseExpiresAt - Date.now() + 25,
        );
        return () => clearTimeout(timer);
    }, [recoveryLeaseExpiresAt, recovery?.status]);

    useEffect(() => {
        if (
            !queries ||
            proposal !== null ||
            inspectionSummary?.status !== "draft" ||
            repairStatus !== "idle"
        ) {
            return;
        }
        setRepairStatus("loading");
        void ensureCurrentProposal({ runId, corpusRevisionId })
            .then(() => setRepairStatus("complete"))
            .catch(() => setRepairStatus("failed"));
    }, [
        corpusRevisionId,
        ensureCurrentProposal,
        inspectionSummary?.status,
        proposal,
        queries,
        repairStatus,
        runId,
    ]);

    if (!queries) {
        return (
            <>
                {queryBridge}
                <LiveSourceReviewSkeleton />
            </>
        );
    }

    const { adjustmentSets, inspectionPage, selectedSource } = queries;

    if (proposal === undefined || inspectionSummary === undefined) {
        return (
            <>
                {queryBridge}
                <LiveSourceReviewSkeleton />
            </>
        );
    }

    if (proposal === null) {
        if (inspectionSummary.status === "approved") {
            return (
                <>
                    {queryBridge}
                    <div className="space-y-3">
                        <ApprovedRevisionBanner
                            canStartNewRevision={canStartNewRevision}
                            onStartNewRevision={async () => {
                                setActionError(null);
                                try {
                                    await startNewRevision({
                                        runId,
                                        corpusRevisionId,
                                    });
                                } catch {
                                    setActionError(
                                        "We couldn't start a new revision. Try again.",
                                    );
                                }
                            }}
                        />
                        <SourceReview
                            runId={runId}
                            corpusRevisionId={corpusRevisionId}
                            review={{
                                ...inspectionSummary,
                                sources: [...inspectionPage.results],
                            }}
                            filter={inspectionFilter}
                            onFilterChange={(nextFilter) => {
                                setInspectionFilter(nextFilter);
                                if (nextFilter !== "all") {
                                    setSelectedId(null);
                                }
                            }}
                            selectedId={selectedId}
                            selectedSource={
                                selectedId ? selectedSource : undefined
                            }
                            onSelectedIdChange={setSelectedId}
                            hasMore={inspectionPage.status === "CanLoadMore"}
                            isLoadingMore={
                                inspectionPage.status === "LoadingMore"
                            }
                            isLoadingInitial={
                                inspectionPage.status === "LoadingFirstPage"
                            }
                            onLoadMore={() =>
                                inspectionPage.loadMore(SOURCE_REVIEW_PAGE_SIZE)
                            }
                            onDecide={onDecide}
                            onApprove={() => undefined}
                            showApprovalAction={false}
                        />
                    </div>
                </>
            );
        }
        if (repairStatus === "failed") {
            return (
                <>
                    {queryBridge}
                    <div
                        role="alert"
                        className="surface-panel rounded-xl border border-destructive/30 p-5">
                        <h2 className="text-base font-medium">
                            Source proposal could not be prepared
                        </h2>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Your candidate sources are unchanged. Try preparing
                            the proposal again.
                        </p>
                        <Button
                            type="button"
                            variant="secondary"
                            className="mt-4"
                            onClick={() => setRepairStatus("idle")}>
                            Try again
                        </Button>
                    </div>
                </>
            );
        }
        return (
            <>
                {queryBridge}
                <LiveSourceReviewSkeleton />
            </>
        );
    }

    if (adjustmentSets === undefined) {
        return (
            <>
                {queryBridge}
                <LiveSourceReviewSkeleton />
            </>
        );
    }

    return (
        <>
            {queryBridge}
            <div className="space-y-3">
                {actionError ? (
                    <p
                        role="alert"
                        className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                        {actionError}
                    </p>
                ) : null}
                {inspectionSummary.status === "approved" ? (
                    <ApprovedRevisionBanner
                        canStartNewRevision={canStartNewRevision}
                        onStartNewRevision={async () => {
                            setActionError(null);
                            try {
                                await startNewRevision({
                                    runId,
                                    corpusRevisionId,
                                });
                            } catch {
                                setActionError(
                                    "We couldn't start a new revision. Try again.",
                                );
                            }
                        }}
                    />
                ) : null}
                <SourceProposalReview
                    sourceReviewNavigation={sourceReviewNavigation}
                    onSourceReviewNavigate={onSourceReviewNavigate}
                    runId={runId}
                    corpusRevisionId={corpusRevisionId}
                    summary={proposal}
                    disposition={disposition}
                    onDispositionChange={setDisposition}
                    adjustmentSets={adjustmentSets}
                    inspectionReview={{
                        ...inspectionSummary,
                        sources: inspectionPage.results,
                    }}
                    onDecide={onDecide}
                    onApprove={async () => {
                        setActionError(null);
                        try {
                            await approveProposal({
                                runId,
                                corpusRevisionId,
                                proposalId: proposal.proposalId,
                                proposalVersion: proposal.version,
                                decisionKey: `corpus-approval:${crypto.randomUUID()}`,
                            });
                        } catch {
                            setActionError(
                                "We couldn't approve this source set. Refresh the proposal and try again.",
                            );
                        }
                    }}
                    onRecompute={async () => {
                        setActionError(null);
                        try {
                            await recomputeProposal({
                                runId,
                                corpusRevisionId,
                                expectedProposalId: proposal.proposalId,
                            });
                        } catch {
                            setActionError(
                                "We couldn't refresh the source proposal. Try again.",
                            );
                        }
                    }}
                    isRecovering={
                        recoveryPending ||
                        recovering ||
                        awaitingRecoverySnapshot
                    }
                    recovery={
                        recoveryTarget
                            ? {
                                  target: recoveryTarget,
                                  feedback,
                                  retryAfterSeconds,
                              }
                            : undefined
                    }
                    onRecoverDiscovery={async (target) => {
                        if (
                            recoveryPending ||
                            recovering ||
                            retryAfterSeconds > 0
                        )
                            return;
                        setActionError(null);
                        const requestId = crypto.randomUUID();
                        setRecoveryAttempt({
                            target,
                            requestId,
                            status: "running",
                        });
                        try {
                            const result = await recoverDiscovery({
                                runId,
                                corpusRevisionId,
                                expectedProposalId: proposal.proposalId,
                                requestId,
                                target,
                            });
                            setRecoveryAttempt({
                                target,
                                requestId,
                                status: "finished",
                                result,
                            });
                        } catch {
                            setRecoveryAttempt({
                                target,
                                requestId,
                                status: "failed",
                            });
                            if (proposal.preparation)
                                setActionError(
                                    "Source preparation could not be confirmed. Check the current status before trying again.",
                                );
                        } finally {
                            setClock(Date.now());
                        }
                    }}
                    isRebuilding={isRebuilding}
                    onRebuild={async () => {
                        setActionError(null);
                        setIsRebuilding(true);
                        try {
                            const result = await rebuildProposal({
                                runId,
                                corpusRevisionId,
                                expectedProposalId: proposal.proposalId,
                            });
                            if (
                                result.outcome === "blocked" &&
                                result.reason !== "in_progress"
                            ) {
                                setActionError(
                                    "Source discovery is temporarily unavailable. Your existing draft and source decisions are unchanged. Try again later or add a public source.",
                                );
                            }
                        } catch {
                            setActionError(
                                "We couldn't rebuild the source proposal. Your source decisions are unchanged. Try again.",
                            );
                        } finally {
                            setIsRebuilding(false);
                        }
                    }}
                    onPrepare={async () => {
                        if (isStartingPreparation) return;
                        setActionError(null);
                        setIsPreparingRequest(true);
                        try {
                            const result = await prepareSources({
                                runId,
                                corpusRevisionId,
                                expectedProposalId: proposal.proposalId,
                                requestId: crypto.randomUUID(),
                            });
                            if (result.status === "started")
                                setRequestedPreparationId(result.preparationId);
                            else if (result.status === "blocked")
                                setActionError(
                                    "Source reading could not finish. Review the available sources or add a public source link.",
                                );
                        } catch {
                            setActionError(
                                "Source reading could not be started. Review the current status and try again when available.",
                            );
                        } finally {
                            setIsPreparingRequest(false);
                        }
                    }}
                    isStartingPreparation={isStartingPreparation}
                    onAddManualUrl={onAddManualUrl}
                    inspectionFilter={inspectionFilter}
                    onInspectionFilterChange={(nextFilter) => {
                        setInspectionFilter(nextFilter);
                        if (nextFilter !== "all") {
                            setSelectedId(null);
                        }
                    }}
                    inspectionSelectedId={selectedId}
                    inspectionSelectedSource={
                        selectedId ? selectedSource : undefined
                    }
                    onInspectionSelectedIdChange={setSelectedId}
                    inspectionHasMore={inspectionPage.status === "CanLoadMore"}
                    inspectionIsLoadingMore={
                        inspectionPage.status === "LoadingMore"
                    }
                    inspectionIsLoadingInitial={
                        inspectionPage.status === "LoadingFirstPage"
                    }
                    onLoadMoreInspection={() =>
                        inspectionPage.loadMore(SOURCE_REVIEW_PAGE_SIZE)
                    }
                />
            </div>
        </>
    );
}

function useSourceReviewQueries({
    runId,
    corpusRevisionId,
    inspectionFilter,
    selectedId,
}: Pick<LiveSourceReviewProps, "runId" | "corpusRevisionId"> & {
    inspectionFilter: SourceFilter;
    selectedId: Id<"sources"> | null;
}) {
    const proposal = useQuery(api.sourceSelectionProposals.getCurrent, {
        runId,
        corpusRevisionId,
    });
    const hasProposal = proposal !== undefined && proposal !== null;
    const adjustmentSets = useQuery(
        api.sourceSelectionProposals.getAdjustmentSets,
        hasProposal ? { runId, corpusRevisionId } : "skip",
    );
    const inspectionSummary = useQuery(api.sources.getReviewSummary, {
        runId,
        corpusRevisionId,
    });
    const inspectionPage = usePaginatedQuery(
        api.sources.listForReviewPage,
        { runId, corpusRevisionId, filter: inspectionFilter },
        { initialNumItems: SOURCE_REVIEW_PAGE_SIZE },
    );
    const selectedSource = useQuery(
        api.sources.getReviewSource,
        selectedId ? { runId, corpusRevisionId, sourceId: selectedId } : "skip",
    );

    return {
        proposal,
        adjustmentSets,
        inspectionSummary,
        inspectionPage,
        selectedSource,
    };
}

type SourceReviewQuerySnapshot = ReturnType<typeof useSourceReviewQueries>;

function SourceReviewQueryBridge({
    setQueries,
    ...queryArgs
}: Parameters<typeof useSourceReviewQueries>[0] & {
    setQueries: Dispatch<SetStateAction<SourceReviewQuerySnapshot | null>>;
}) {
    const queries = useSourceReviewQueries(queryArgs);

    useEffect(() => {
        setQueries((current) =>
            current !== null &&
            current.proposal === queries.proposal &&
            current.adjustmentSets === queries.adjustmentSets &&
            current.inspectionSummary === queries.inspectionSummary &&
            current.inspectionPage.results === queries.inspectionPage.results &&
            current.inspectionPage.status === queries.inspectionPage.status &&
            current.inspectionPage.loadMore ===
                queries.inspectionPage.loadMore &&
            current.selectedSource === queries.selectedSource
                ? current
                : queries,
        );
    }, [queries, setQueries]);

    return null;
}

function LiveSourceReviewSkeleton() {
    return (
        <div
            role="status"
            aria-label="Loading source review"
            aria-busy="true"
            className="space-y-4">
            <section
                aria-label="Loading source proposal summary"
                className="surface-floating h-48 space-y-4 rounded-2xl p-5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-8 w-56" />
                <Skeleton className="h-4 w-3/4" />
                <div className="flex gap-2">
                    <Skeleton className="h-9 w-32 rounded-lg" />
                    <Skeleton className="h-9 w-40 rounded-lg" />
                </div>
            </section>
            <div className="grid min-h-168 gap-4 md:grid-cols-[minmax(18rem,36%)_minmax(26rem,1fr)]">
                <section
                    aria-label="Loading source list"
                    className="surface-panel space-y-4 rounded-xl p-4">
                    <Skeleton className="h-8 w-full" />
                    {["first", "second", "third"].map((key) => (
                        <Skeleton
                            key={key}
                            className="h-28 w-full rounded-xl"
                        />
                    ))}
                </section>
                <section
                    aria-label="Loading source detail"
                    className="surface-panel min-h-168 space-y-5 rounded-xl p-6">
                    <Skeleton className="h-5 w-28" />
                    <Skeleton className="h-9 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-28 w-full rounded-xl" />
                </section>
            </div>
        </div>
    );
}

function ApprovedRevisionBanner({
    onStartNewRevision,
    canStartNewRevision,
}: {
    onStartNewRevision: () => void | Promise<void>;
    canStartNewRevision: boolean;
}) {
    return (
        <div className="surface-floating rounded-2xl border border-border/60 p-5">
            <p className="text-micro text-accent-foreground">Corpus approved</p>
            <h2 className="mt-1 text-lg font-medium">
                Source set is approved and read-only
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
                {canStartNewRevision
                    ? "Start a new revision to re-discover sources and rebuild the proposal with the current selection method."
                    : "Your approved sources remain available for inspection while evidence is prepared and reviewed."}
            </p>
            <Button
                type="button"
                variant="outline"
                className="mt-3"
                disabled={!canStartNewRevision}
                onClick={() => void onStartNewRevision()}>
                <Icon iconNode={RefreshIcon} />
                Start new revision
            </Button>
        </div>
    );
}
