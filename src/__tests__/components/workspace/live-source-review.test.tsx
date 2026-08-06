import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, test, vi } from "vitest";

const { useQuery, usePaginatedQuery } = vi.hoisted(() => ({
    useQuery: vi.fn(),
    usePaginatedQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({ useQuery, usePaginatedQuery }));

import { LiveSourceReview } from "@/components/workspace/live-source-review";

const pendingSource = {
    sourceId: "source-pending",
    canonicalUrl: "https://example.com/pending",
    title: "Pending report",
    origin: "exa",
    category: "independent_analysis",
    decision: "pending",
    publishedAt: undefined,
    reason: undefined,
} as const;

const acceptedSource = {
    sourceId: "source-accepted",
    canonicalUrl: "https://example.com/accepted",
    title: "Accepted report",
    origin: "sec",
    category: "regulatory",
    decision: "accepted",
    publishedAt: undefined,
    reason: undefined,
} as const;

beforeEach(() => {
    useQuery.mockReset();
    usePaginatedQuery.mockReset();
});

test("keeps filters, source list, and detail geometry while loading", () => {
    useQuery.mockReturnValue(undefined);
    usePaginatedQuery.mockReturnValue({
        results: [],
        status: "LoadingFirstPage",
        loadMore: vi.fn(),
    });

    render(
        <LiveSourceReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            onDecide={vi.fn()}
            onApprove={vi.fn()}
        />,
    );

    expect(screen.getByLabelText("Loading source filters")).toBeTruthy();
    expect(screen.getByLabelText("Loading source list")).toBeTruthy();
    expect(screen.getByLabelText("Loading source detail")).toBeTruthy();
});

test("resets the paginated query by filter and preserves selection in All while a source reorders", async () => {
    let allSources: ReadonlyArray<
        typeof pendingSource | typeof acceptedSource | RejectedSource
    > = [pendingSource, acceptedSource];
    let acceptedDetail: typeof acceptedSource | RejectedSource = acceptedSource;
    useQuery.mockImplementation((reference, args) => {
        const functionName = getFunctionName(reference);
        if (functionName === "sources:getReviewSummary") {
            return {
                revision: 1,
                status: "draft",
                counts: { accepted: 1, rejected: 0, pending: 1 },
                total: 2,
                candidateLimit: 48,
            };
        }
        if (functionName === "sources:getReviewSource") {
            if (args === "skip") {
                return undefined;
            }
            return args.sourceId === pendingSource.sourceId
                ? pendingSource
                : acceptedDetail;
        }
        return undefined;
    });
    usePaginatedQuery.mockImplementation((_reference, args) => ({
        results:
            args.filter === "all"
                ? allSources
                : allSources.filter(
                      (source) => source.decision === args.filter,
                  ),
        status: "Exhausted",
        loadMore: vi.fn(),
    }));
    const props = {
        runId: "run-1" as never,
        corpusRevisionId: "revision-1" as never,
        onDecide: vi.fn(),
        onApprove: vi.fn(),
    };
    const { rerender } = render(<LiveSourceReview {...props} />);

    await waitFor(() =>
        expect(
            screen
                .getByRole("button", {
                    name: /Open Pending report for review/i,
                })
                .getAttribute("aria-pressed"),
        ).toBe("true"),
    );
    fireEvent.click(screen.getByRole("tab", { name: /Accepted.*1/i }));

    await waitFor(() =>
        expect(usePaginatedQuery).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({ filter: "accepted" }),
            { initialNumItems: 12 },
        ),
    );
    expect(
        screen.queryByRole("button", {
            name: /Open Pending report for review/i,
        }),
    ).toBeNull();
    await waitFor(() =>
        expect(
            screen
                .getByRole("button", {
                    name: /Open Accepted report for review/i,
                })
                .getAttribute("aria-pressed"),
        ).toBe("true"),
    );

    fireEvent.click(screen.getByRole("tab", { name: /All.*2/i }));
    const rejectedSource: RejectedSource = {
        ...acceptedSource,
        decision: "rejected",
    };
    acceptedDetail = rejectedSource;
    allSources = [pendingSource, rejectedSource];
    rerender(<LiveSourceReview {...props} />);

    await waitFor(() =>
        expect(
            screen
                .getByRole("button", {
                    name: /Open Accepted report for review/i,
                })
                .getAttribute("aria-pressed"),
        ).toBe("true"),
    );
});

type RejectedSource = Omit<typeof acceptedSource, "decision"> & {
    decision: "rejected";
};
