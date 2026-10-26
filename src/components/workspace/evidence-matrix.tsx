"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";

import { LoadErrorBoundary } from "@/components/load-error-boundary";
import {
    Drawer,
    DrawerContent,
    DrawerDescription,
    DrawerHeader,
    DrawerTitle,
} from "@/components/ui/drawer";
import MotionAnimatePresence from "@/components/ui/motion-animate-presence";
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Skeleton } from "@/components/ui/skeleton";
import { EvidenceClaimDetail } from "@/components/workspace/evidence-claim-detail";
import {
    EvidenceClaimList,
    type EvidenceClassificationFilter,
} from "@/components/workspace/evidence-claim-list";
import { EvidenceCoverageSummary } from "@/components/workspace/evidence-coverage-summary";
import { useResponsive } from "@/hooks/use-responsive";

const EVIDENCE_PAGE_SIZE = 10;

/**
 * Read-only reactive evidence matrix. Selection, classification filter, and
 * narrow drawer visibility are owned here, above the LoadErrorBoundary, so a
 * query subtree remount (retry) never discards the analyst's current view.
 * The boundary wraps a child that owns the Convex hooks and renders directly;
 * there is no query-to-parent state bridge that could rerender-loop.
 */
export function EvidenceMatrix({ runId }: { runId: Id<"researchRuns"> }) {
    const [classificationFilter, setClassificationFilter] =
        useState<EvidenceClassificationFilter>("all");
    const [selectedId, setSelectedId] = useState<Id<"claims"> | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const { isTabletOrBelow } = useResponsive();

    return (
        <LoadErrorBoundary
            title="Evidence could not be loaded"
            description="The evidence matrix is temporarily unavailable. Try loading it again."
            variant="inline">
            <EvidenceMatrixContent
                runId={runId}
                classificationFilter={classificationFilter}
                selectedId={selectedId}
                onSelect={(claimId) => {
                    setSelectedId(claimId);
                    if (isTabletOrBelow) {
                        setDrawerOpen(true);
                    }
                }}
                onFilterChange={(nextFilter) => {
                    setClassificationFilter(nextFilter);
                    setSelectedId(null);
                }}
                drawerOpen={drawerOpen}
                onDrawerOpenChange={setDrawerOpen}
                isTabletOrBelow={isTabletOrBelow}
            />
        </LoadErrorBoundary>
    );
}

function EvidenceMatrixContent({
    runId,
    classificationFilter,
    selectedId,
    onSelect,
    onFilterChange,
    drawerOpen,
    onDrawerOpenChange,
    isTabletOrBelow,
}: {
    runId: Id<"researchRuns">;
    classificationFilter: EvidenceClassificationFilter;
    selectedId: Id<"claims"> | null;
    onSelect: (claimId: Id<"claims">) => void;
    onFilterChange: (filter: EvidenceClassificationFilter) => void;
    drawerOpen: boolean;
    onDrawerOpenChange: (open: boolean) => void;
    isTabletOrBelow: boolean;
}) {
    const summary = useQuery(api.evidenceMatrix.getSummary, { runId });
    const hasSummary = summary !== undefined;
    const claimPage = usePaginatedQuery(
        api.evidenceMatrix.listClaims,
        hasSummary
            ? {
                  runId,
                  filters:
                      classificationFilter === "all"
                          ? undefined
                          : { classification: classificationFilter },
              }
            : "skip",
        { initialNumItems: EVIDENCE_PAGE_SIZE },
    );
    const detail = useQuery(
        api.evidenceMatrix.getClaimDetail,
        hasSummary && selectedId !== null
            ? { runId, claimId: selectedId }
            : "skip",
    );

    if (summary === undefined || claimPage === undefined) {
        return <EvidenceMatrixSkeleton />;
    }

    const claims = claimPage.results;
    const selectedClaim =
        selectedId === null
            ? null
            : detail !== undefined && detail !== null
              ? detail
              : null;

    const claimList = (
        <EvidenceClaimList
            items={claims}
            total={summary.claimCount}
            classificationFilter={classificationFilter}
            onClassificationFilterChange={onFilterChange}
            selectedId={selectedId}
            onSelect={onSelect}
            hasMore={claimPage.status === "CanLoadMore"}
            isLoadingMore={claimPage.status === "LoadingMore"}
            isLoadingInitial={claimPage.status === "LoadingFirstPage"}
            onLoadMore={() => claimPage.loadMore(EVIDENCE_PAGE_SIZE)}
            autoSelectFirst={!isTabletOrBelow}
            emptyDescription={
                summary.claimCount === 0
                    ? "Extraction completed without a usable claim in this dossier."
                    : "No claims match the selected classification."
            }
        />
    );

    return (
        <section aria-label="Evidence matrix" className="space-y-5">
            <EvidenceCoverageSummary summary={summary} />
            {summary.claimCount > 0 ? (
                isTabletOrBelow ? (
                    <>
                        {claimList}
                        <Drawer
                            open={drawerOpen}
                            onOpenChange={onDrawerOpenChange}
                            showSwipeHandle>
                            <DrawerContent>
                                <DrawerHeader>
                                    <DrawerTitle>Claim detail</DrawerTitle>
                                    <DrawerDescription>
                                        Review cited passages and provenance.
                                    </DrawerDescription>
                                </DrawerHeader>
                                <div className="min-h-0 overflow-y-auto p-4">
                                    {selectedClaim ? (
                                        <EvidenceClaimDetail
                                            detail={selectedClaim}
                                        />
                                    ) : null}
                                </div>
                            </DrawerContent>
                        </Drawer>
                    </>
                ) : (
                    <ResizablePanelGroup
                        data-group="evidence-matrix"
                        orientation="horizontal"
                        defaultLayout={{
                            "evidence-claims": 40,
                            "evidence-detail": 60,
                        }}
                        className="min-h-168">
                        <ResizablePanel
                            id="evidence-claims"
                            data-panel="evidence-claims"
                            minSize="16rem"
                            maxSize="50%">
                            {claimList}
                        </ResizablePanel>
                        <ResizableHandle withHandle className="mx-2" />
                        <ResizablePanel
                            id="evidence-detail"
                            data-panel="evidence-detail"
                            minSize="24rem">
                            <div className="h-full min-w-0">
                                <MotionAnimatePresence
                                    contentKey={
                                        selectedClaim
                                            ? selectedClaim.claim.claimId
                                            : "empty"
                                    }
                                    mode="sync"
                                    preset="shrink-pop"
                                    className="h-full"
                                    wrapperClassName="h-full">
                                    <EvidenceClaimDetail
                                        detail={selectedClaim}
                                    />
                                </MotionAnimatePresence>
                            </div>
                        </ResizablePanel>
                    </ResizablePanelGroup>
                )
            ) : null}
        </section>
    );
}

function EvidenceMatrixSkeleton() {
    return (
        <div
            role="status"
            aria-label="Loading evidence matrix"
            aria-busy="true"
            className="space-y-4">
            <section
                aria-label="Loading evidence coverage"
                className="surface-floating h-40 space-y-4 p-5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-8 w-56" />
                <Skeleton className="h-4 w-3/4" />
                <div className="grid gap-3 sm:grid-cols-3">
                    <Skeleton className="h-16 rounded-xl" />
                    <Skeleton className="h-16 rounded-xl" />
                    <Skeleton className="h-16 rounded-xl" />
                </div>
            </section>
            <div className="grid min-h-168 gap-4 md:grid-cols-[minmax(16rem,40%)_minmax(24rem,1fr)]">
                <section
                    aria-label="Loading evidence claims"
                    className="surface-panel space-y-4 p-4">
                    <Skeleton className="h-8 w-full" />
                    {["first", "second", "third"].map((key) => (
                        <Skeleton
                            key={key}
                            className="h-24 w-full rounded-xl"
                        />
                    ))}
                </section>
                <section
                    aria-label="Loading claim detail"
                    className="surface-panel min-h-168 space-y-5 p-6">
                    <Skeleton className="h-5 w-28" />
                    <Skeleton className="h-9 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-28 w-full rounded-xl" />
                </section>
            </div>
        </div>
    );
}
