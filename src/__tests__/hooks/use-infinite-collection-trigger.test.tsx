import { act, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { useInfiniteCollectionTrigger } from '@/hooks/use-infinite-collection-trigger';

const nearEndViewport = {
    scrollLeft: 0,
    scrollTop: 650,
    scrollWidth: 300,
    scrollHeight: 1_000,
    clientWidth: 300,
    clientHeight: 300,
    canScrollLeft: false,
    canScrollRight: false,
    canScrollUp: true,
    canScrollDown: true,
};

test('loads once near the end and rearms after more items arrive', () => {
    const onLoadMore = vi.fn();
    const { result, rerender } = renderHook(
        ({ itemCount }) =>
            useInfiniteCollectionTrigger({
                hasMore: true,
                isLoading: false,
                itemCount,
                onLoadMore,
            }),
        { initialProps: { itemCount: 12 } },
    );

    act(() => result.current.onViewportScroll(nearEndViewport));
    act(() => result.current.onViewportScroll(nearEndViewport));
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    rerender({ itemCount: 24 });
    act(() => result.current.onViewportScroll(nearEndViewport));
    expect(onLoadMore).toHaveBeenCalledTimes(2);
});
