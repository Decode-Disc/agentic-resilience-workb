import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";

import { usePagination } from "@/hooks/use-pagination";

test("exposes a controlled page window without changing the source collection", () => {
    const items = Array.from({ length: 18 }, (_, index) => `item-${index + 1}`);
    const { result } = renderHook(() =>
        usePagination({ items, pageSize: 8, resetKey: "query-one" }),
    );

    expect(result.current.page).toBe(1);
    expect(result.current.pageCount).toBe(3);
    expect(result.current.pageItems).toEqual(items.slice(0, 8));

    act(() => result.current.setPage(2));

    expect(result.current.page).toBe(2);
    expect(result.current.pageItems).toEqual(items.slice(8, 16));
    act(() => result.current.setPage(3));
    expect(result.current.pageItems).toEqual(["item-17", "item-18"]);
    expect(items).toEqual(
        Array.from({ length: 18 }, (_, index) => `item-${index + 1}`),
    );
});

test.each([
    { label: "below the first page", requested: 0, page: 1, items: [1, 2] },
    { label: "above the final page", requested: 99, page: 3, items: [5] },
    { label: "a fractional page", requested: 2.9, page: 2, items: [3, 4] },
    {
        label: "a non-finite page",
        requested: Number.NaN,
        page: 2,
        items: [3, 4],
    },
])("handles $label without losing the page window", ({
    requested,
    page,
    items,
}) => {
    const { result } = renderHook(() =>
        usePagination({ items: [1, 2, 3, 4, 5], pageSize: 2 }),
    );
    act(() => result.current.setPage(2));
    act(() => result.current.setPage(requested));
    expect(result.current.page).toBe(page);
    expect(result.current.pageCount).toBe(3);
    expect(result.current.pageItems).toEqual(items);
});

test.each([0, 1.5])("rejects invalid page size %s", (pageSize) => {
    expect(() =>
        renderHook(() => usePagination({ items: [1, 2], pageSize })),
    ).toThrow("Pagination pageSize must be a positive integer");
});

test("clamps the current page as the collection shrinks to empty", () => {
    const { result, rerender } = renderHook(
        ({ items }) => usePagination({ items, pageSize: 2 }),
        { initialProps: { items: [1, 2, 3, 4, 5] } },
    );
    act(() => result.current.setPage(3));
    expect(result.current.pageItems).toEqual([5]);
    rerender({ items: [1] });
    expect(result.current.page).toBe(1);
    expect(result.current.pageCount).toBe(1);
    expect(result.current.pageItems).toEqual([1]);
    rerender({ items: [] });
    expect(result.current.page).toBe(1);
    expect(result.current.pageCount).toBe(1);
    expect(result.current.pageItems).toEqual([]);
});

test("returns to the first page when the reset key changes", () => {
    const items = Array.from({ length: 18 }, (_, index) => index + 1);
    const { result, rerender } = renderHook(
        ({ resetKey }) => usePagination({ items, pageSize: 8, resetKey }),
        { initialProps: { resetKey: "first-search" } },
    );

    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);

    rerender({ resetKey: "second-search" });

    expect(result.current.page).toBe(1);
    expect(result.current.pageItems).toEqual(items.slice(0, 8));
});
