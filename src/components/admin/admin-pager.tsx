"use client";

import { Button } from "@/components/ui/button";

/**
 * Loads the next page of a Convex paginated query. The caller keeps the query
 * arguments, so this control only owns the shared button treatment.
 */
export function AdminLoadMore({
    page,
    label,
    count = 20,
    focusableWhenDisabled,
}: {
    page: { status: string; loadMore: (count: number) => void };
    label: string;
    count?: number;
    focusableWhenDisabled?: boolean;
}) {
    if (page.status !== "CanLoadMore" && page.status !== "LoadingMore") {
        return null;
    }
    const loading = page.status === "LoadingMore";
    return (
        <Button
            className="mt-3 aria-disabled:opacity-50"
            size="sm"
            variant="outline"
            disabled={loading}
            focusableWhenDisabled={focusableWhenDisabled}
            onClick={() => page.loadMore(count)}>
            {loading ? "Loading…" : label}
        </Button>
    );
}
