import { useCallback, useEffect, useRef } from 'react';

import type { ScrollAreaViewportState } from '@/components/ui/scroll-area';

export interface UseInfiniteCollectionTriggerOptions {
    hasMore: boolean;
    isLoading: boolean;
    itemCount: number;
    onLoadMore: () => void;
    thresholdPx?: number;
}

export function useInfiniteCollectionTrigger({
    hasMore,
    isLoading,
    itemCount,
    onLoadMore,
    thresholdPx = 192,
}: UseInfiniteCollectionTriggerOptions) {
    const triggeredAtItemCount = useRef<number | null>(null);
    const previousItemCount = useRef(itemCount);

    useEffect(() => {
        if (previousItemCount.current === itemCount) {
            return;
        }
        previousItemCount.current = itemCount;
        triggeredAtItemCount.current = null;
    }, [itemCount]);

    const onViewportScroll = useCallback(
        (viewport: ScrollAreaViewportState) => {
            const remaining =
                viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
            if (
                !hasMore ||
                isLoading ||
                remaining > thresholdPx ||
                triggeredAtItemCount.current === itemCount
            ) {
                return;
            }
            triggeredAtItemCount.current = itemCount;
            onLoadMore();
        },
        [hasMore, isLoading, itemCount, onLoadMore, thresholdPx],
    );

    return { onViewportScroll };
}
