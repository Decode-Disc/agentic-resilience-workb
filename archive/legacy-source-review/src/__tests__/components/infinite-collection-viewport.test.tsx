import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { InfiniteCollectionViewport } from "@/components/infinite-collection-viewport";

test("keeps an accessible manual load action alongside automatic loading", () => {
    const onLoadMore = vi.fn();
    render(
        <InfiniteCollectionViewport
            ariaLabel="Candidate sources"
            hasMore
            isLoadingMore={false}
            itemCount={2}
            onLoadMore={onLoadMore}
            loadMoreLabel="Load more sources">
            <ul>
                <li>Source one</li>
                <li>Source two</li>
            </ul>
        </InfiniteCollectionViewport>,
    );

    expect(
        screen.getByRole("region", { name: "Candidate sources" }),
    ).toBeTruthy();
    const callsBeforeManualLoad = onLoadMore.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Load more sources" }));
    expect(onLoadMore).toHaveBeenCalledTimes(callsBeforeManualLoad + 1);
});
