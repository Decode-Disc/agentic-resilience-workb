import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useInfiniteCollectionTrigger } from "@/hooks/use-infinite-collection-trigger";
import { cn } from "@/lib/utils";

export interface InfiniteCollectionViewportProps {
    children: ReactNode;
    hasMore: boolean;
    isLoadingMore: boolean;
    itemCount: number;
    onLoadMore: () => void;
    ariaLabel: string;
    loadMoreLabel?: string;
    loadingFallback?: ReactNode;
    progressContent?: ReactNode;
    endContent?: ReactNode;
    className?: string;
    viewportClassName?: string;
    thresholdPx?: number;
}

export function InfiniteCollectionViewport({
    children,
    hasMore,
    isLoadingMore,
    itemCount,
    onLoadMore,
    ariaLabel,
    loadMoreLabel = "Load more",
    loadingFallback,
    progressContent,
    endContent,
    className,
    viewportClassName,
    thresholdPx,
}: InfiniteCollectionViewportProps) {
    const { onViewportScroll } = useInfiniteCollectionTrigger({
        hasMore,
        isLoading: isLoadingMore,
        itemCount,
        onLoadMore,
        thresholdPx,
    });

    return (
        <ScrollArea
            role="region"
            aria-label={ariaLabel}
            className={cn("min-h-0", className)}
            viewportClassName={cn("min-h-0", viewportClassName)}
            viewportProps={{ tabIndex: 0 }}
            onViewportScroll={onViewportScroll}>
            {children}
            <div className="flex min-h-12 items-center justify-center px-2 py-3">
                {hasMore ? (
                    <div className="flex w-full flex-col items-center gap-2">
                        {progressContent}
                        {isLoadingMore && loadingFallback ? (
                            <div
                                role="status"
                                aria-label="Loading more items"
                                aria-live="polite"
                                className="w-full">
                                {loadingFallback}
                            </div>
                        ) : (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={isLoadingMore}
                                onClick={onLoadMore}>
                                {isLoadingMore ? "Loading…" : loadMoreLabel}
                            </Button>
                        )}
                    </div>
                ) : (
                    endContent
                )}
            </div>
        </ScrollArea>
    );
}
