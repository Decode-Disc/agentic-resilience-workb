import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface UsePaginationOptions<Item> {
    items: ReadonlyArray<Item>;
    pageSize: number;
    resetKey?: unknown;
}

export interface UsePaginationResult<Item> {
    page: number;
    pageCount: number;
    pageItems: Array<Item>;
    setPage: (page: number) => void;
}

export function usePagination<Item>({
    items,
    pageSize,
    resetKey,
}: UsePaginationOptions<Item>): UsePaginationResult<Item> {
    if (!Number.isInteger(pageSize) || pageSize < 1) {
        throw new Error('Pagination pageSize must be a positive integer');
    }

    const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
    const [page, setPageState] = useState(1);
    const previousResetKey = useRef(resetKey);

    useEffect(() => {
        if (Object.is(previousResetKey.current, resetKey)) {
            return;
        }
        previousResetKey.current = resetKey;
        setPageState(1);
    }, [resetKey]);

    useEffect(() => {
        setPageState((current) => Math.min(current, pageCount));
    }, [pageCount]);

    const setPage = useCallback(
        (nextPage: number) => {
            if (!Number.isFinite(nextPage)) {
                return;
            }
            setPageState(Math.min(Math.max(Math.trunc(nextPage), 1), pageCount));
        },
        [pageCount],
    );

    const pageItems = useMemo(() => {
        const start = (page - 1) * pageSize;
        return items.slice(start, start + pageSize);
    }, [items, page, pageSize]);

    return { page, pageCount, pageItems, setPage };
}
