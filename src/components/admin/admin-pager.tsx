"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Loads the next page of a Convex paginated query. The caller keeps the query
 * arguments, so this control only owns the shared button treatment.
 */
export function AdminLoadMore({
    page,
    label,
    count = 20,
    focusableWhenDisabled,
    className,
}: {
    page: { status: string; loadMore: (count: number) => void };
    label: string;
    count?: number;
    focusableWhenDisabled?: boolean;
    className?: string;
}) {
    if (page.status !== "CanLoadMore" && page.status !== "LoadingMore") {
        return null;
    }
    const loading = page.status === "LoadingMore";
    return (
        <Button
            className={cn("aria-disabled:opacity-50", className)}
            size="sm"
            variant="outline"
            disabled={loading}
            focusableWhenDisabled={focusableWhenDisabled}
            onClick={() => page.loadMore(count)}>
            {loading ? "Loading…" : label}
        </Button>
    );
}

/** One footer line under an admin list: what is shown on the left, Load more on the right. */
export function AdminListFooter({
    summary,
    page,
    label,
}: {
    summary?: ReactNode;
    page?: { status: string; loadMore: (count: number) => void };
    label?: string;
}) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-1">
            {summary ? (
                <p className="text-xs text-muted-foreground">{summary}</p>
            ) : (
                <span />
            )}
            {page && label ? <AdminLoadMore page={page} label={label} /> : null}
        </div>
    );
}
