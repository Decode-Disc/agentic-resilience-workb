import { act, renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';

import { usePagination } from '@/hooks/use-pagination';

test('exposes a controlled page window without changing the source collection', () => {
    const items = Array.from({ length: 18 }, (_, index) => `item-${index + 1}`);
    const { result } = renderHook(() =>
        usePagination({ items, pageSize: 8, resetKey: 'query-one' }),
    );

    expect(result.current.page).toBe(1);
    expect(result.current.pageCount).toBe(3);
    expect(result.current.pageItems).toEqual(items.slice(0, 8));

    act(() => result.current.setPage(2));

    expect(result.current.page).toBe(2);
    expect(result.current.pageItems).toEqual(items.slice(8, 16));
    expect(items).toHaveLength(18);
});

test('returns to the first page when the reset key changes', () => {
    const items = Array.from({ length: 18 }, (_, index) => index + 1);
    const { result, rerender } = renderHook(
        ({ resetKey }) => usePagination({ items, pageSize: 8, resetKey }),
        { initialProps: { resetKey: 'first-search' } },
    );

    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);

    rerender({ resetKey: 'second-search' });

    expect(result.current.page).toBe(1);
    expect(result.current.pageItems).toEqual(items.slice(0, 8));
});
