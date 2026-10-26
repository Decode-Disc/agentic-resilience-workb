import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { useEffect } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
    claimClassificationLabel,
    claimPolicyLabel,
    claimProcessingLabel,
} from "@/lib/presentation/research-copy";

type ClaimListItem = FunctionReturnType<
    typeof api.evidenceMatrix.listClaims
>["page"][number];
type ClaimClassification = ClaimListItem["classification"];

export type EvidenceClassificationFilter = ClaimClassification | "all";

const CLASSIFICATION_FILTERS: ReadonlyArray<{
    value: EvidenceClassificationFilter;
    label: string;
}> = [
    { value: "all", label: "All" },
    { value: "Fact", label: "Fact" },
    { value: "Inference", label: "Inference" },
    { value: "Hypothesis", label: "Hypothesis" },
    { value: "Unknown", label: "Unknown" },
];

/** Read-only, accessible claim list with classification filtering. */
export function EvidenceClaimList({
    items,
    total,
    classificationFilter,
    onClassificationFilterChange,
    selectedId,
    onSelect,
    hasMore,
    isLoadingMore,
    isLoadingInitial,
    onLoadMore,
    autoSelectFirst = false,
    emptyDescription,
}: {
    items: Array<ClaimListItem>;
    total: number;
    classificationFilter: EvidenceClassificationFilter;
    onClassificationFilterChange: (
        filter: EvidenceClassificationFilter,
    ) => void;
    selectedId: Id<"claims"> | null;
    onSelect: (claimId: Id<"claims">) => void;
    hasMore: boolean;
    isLoadingMore: boolean;
    isLoadingInitial: boolean;
    onLoadMore: () => void;
    autoSelectFirst?: boolean;
    emptyDescription: string;
}) {
    const visibleCount = items.length;
    const isFiltered = classificationFilter !== "all";
    const isEmpty = items.length === 0 && !isLoadingInitial && !hasMore;
    // A filtered query pages raw claims; the current raw page may hold no match
    // while later pages do. Render a non-terminal notice instead of a false
    // terminal empty state, and keep Load more visible.
    const isSparse = items.length === 0 && !isLoadingInitial && hasMore;

    // Keep the selection valid when the filter is active (desktop auto-pick).
    useEffect(() => {
        if (autoSelectFirst && !isFiltered && !selectedId && items.length > 0) {
            const firstId = items[0]?.claimId;
            if (firstId) {
                onSelect(firstId);
            }
        }
    }, [autoSelectFirst, isFiltered, items, onSelect, selectedId]);

    return (
        <section
            aria-label="Evidence claims"
            className="flex flex-col gap-4 h-full">
            <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-muted-foreground">
                    {visibleCount} of {total} claims shown
                </p>
                <fieldset
                    aria-label="Filter evidence claims by classification"
                    className="flex flex-wrap gap-1">
                    {CLASSIFICATION_FILTERS.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            aria-pressed={classificationFilter === option.value}
                            className="rounded-lg px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ring-1 ring-border/40 focus-visible:ring-2 focus-visible:ring-ring data-[pressed=true]:bg-muted data-[pressed=true]:text-foreground data-[pressed=true]:ring-ring/40"
                            data-pressed={classificationFilter === option.value}
                            onClick={() =>
                                onClassificationFilterChange(option.value)
                            }>
                            {option.label}
                        </button>
                    ))}
                </fieldset>
            </div>

            {isLoadingInitial ? (
                <div
                    role="status"
                    aria-label="Loading evidence claims"
                    aria-busy="true"
                    className="space-y-3">
                    {["first", "second", "third"].map((key) => (
                        <Skeleton
                            key={key}
                            className="h-24 w-full rounded-xl"
                        />
                    ))}
                </div>
            ) : isSparse ? (
                <Empty className="surface-panel min-h-40 p-6">
                    <EmptyHeader>
                        <EmptyTitle>
                            More evidence claims may be available
                        </EmptyTitle>
                        <EmptyDescription>
                            {isFiltered
                                ? "More claims may match this filter. Load more to keep searching."
                                : "More evidence claims may still be pending. Load more to keep searching."}
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : isEmpty ? (
                <Empty className="surface-panel min-h-40 p-6">
                    <EmptyHeader>
                        <EmptyTitle>No evidence claims</EmptyTitle>
                        <EmptyDescription>{emptyDescription}</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <ul className="space-y-2">
                    {items.map((claim) => {
                        const active = claim.claimId === selectedId;
                        const policyLabel = claimPolicyLabel(claim.policy);
                        return (
                            <li key={claim.claimId}>
                                <button
                                    type="button"
                                    aria-pressed={active}
                                    aria-label={`Open ${claim.classification} claim: ${claim.statement}`}
                                    className="w-full rounded-xl p-3 text-left ring-1 ring-transparent hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:bg-muted data-[active=true]:ring-1 data-[active=true]:ring-foreground/10"
                                    data-active={active}
                                    onClick={() => onSelect(claim.claimId)}>
                                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                                        <Badge variant="outline">
                                            {claimClassificationLabel(
                                                claim.classification,
                                            )}
                                        </Badge>
                                        <Badge variant="secondary">
                                            {claimProcessingLabel(
                                                claim.processing,
                                            )}
                                        </Badge>
                                        {policyLabel ? (
                                            <Badge variant="secondary">
                                                {policyLabel}
                                            </Badge>
                                        ) : null}
                                    </div>
                                    <p className="line-clamp-3 text-sm leading-5">
                                        {claim.statement}
                                    </p>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}

            {hasMore || isLoadingMore ? (
                <Button
                    type="button"
                    variant="secondary"
                    className="self-start"
                    onClick={onLoadMore}
                    disabled={isLoadingMore}>
                    {isLoadingMore ? "Loading more claims" : "Load more claims"}
                </Button>
            ) : null}
        </section>
    );
}
