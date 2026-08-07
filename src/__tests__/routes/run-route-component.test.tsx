import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, test, vi } from "vitest";

const {
    useQuery,
    usePaginatedQuery,
    useMutation,
    useAction,
    decideSource,
    approveCorpus,
    decideSufficiency,
    submitManualUrl,
    navigate,
} = vi.hoisted(() => ({
    useQuery: vi.fn(),
    usePaginatedQuery: vi.fn(),
    useMutation: vi.fn(),
    useAction: vi.fn(),
    decideSource: vi.fn(),
    approveCorpus: vi.fn(),
    decideSufficiency: vi.fn(),
    submitManualUrl: vi.fn(),
    navigate: vi.fn(),
}));

vi.mock("convex/react", () => ({
    useQuery,
    usePaginatedQuery,
    useMutation,
    useAction,
}));
vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
    Link: ({ children, ...props }: React.ComponentProps<"a">) => (
        <a {...props}>{children}</a>
    ),
}));

import { RunRouteComponent } from "@/components/workspace/run-route-component";

beforeEach(() => {
    useQuery.mockReset();
    usePaginatedQuery.mockReset();
    useMutation.mockReset();
    useAction.mockReset();
    decideSource.mockReset();
    approveCorpus.mockReset();
    decideSufficiency.mockReset();
    submitManualUrl.mockReset();
    navigate.mockReset();
    useMutation.mockImplementation((reference) => {
        const functionName = getFunctionName(reference);
        if (functionName === "sources:decide") {
            return decideSource;
        }
        if (functionName === "evidenceSufficiency:decide") {
            return decideSufficiency;
        }
        if (functionName === "sourceSelectionProposals:approveProposedCorpus") {
            return approveCorpus;
        }
        return vi.fn();
    });
    useAction.mockReturnValue(submitManualUrl);
    usePaginatedQuery.mockReturnValue({
        results: [],
        status: "Exhausted",
        loadMore: vi.fn(),
    });
});

test("wires the evidence sufficiency checkpoint", async () => {
    useQuery.mockImplementation(() => {
        const index = (useQuery.mock.calls.length - 1) % 3;
        return [
            {
                runId: "run-1",
                company: {
                    legalName: "Example Corp",
                    ticker: "EXM",
                    exchange: "NASDAQ",
                    cik: "123",
                },
                lifecycleState: "awaiting_evidence_sufficiency_review",
                executionStatus: "paused",
                pauseReason: "evidence_sufficiency_review",
                activeCorpusRevisionId: "revision-1",
                providerFailures: [],
                updatedAt: 1,
            },
            [],
            undefined,
        ][index];
    });
    submitManualUrl.mockResolvedValue({
        kind: "persisted",
        sourceId: "source-1",
        canonicalUrl: "https://example.com/report",
        title: "Public report",
    });
    decideSufficiency.mockResolvedValue({ accepted: true });

    render(<RunRouteComponent runId={"run-1" as never} section="progress" />);

    fireEvent.click(
        screen.getByRole("button", { name: /Add public source link/i }),
    );
    fireEvent.change(screen.getByLabelText(/Public source link/i), {
        target: { value: "https://example.com/report" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/i }));
    await waitFor(() =>
        expect(submitManualUrl).toHaveBeenCalledWith({
            requestKey: expect.any(String),
            url: "https://example.com/report",
            target: {
                kind: "run",
                runId: "run-1",
                corpusRevisionId: "revision-1",
            },
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Done/i }));

    fireEvent.click(screen.getByRole("button", { name: /Recheck evidence/i }));
    await waitFor(() =>
        expect(decideSufficiency).toHaveBeenCalledWith({
            runId: "run-1",
            decision: expect.objectContaining({ kind: "recheck" }),
        }),
    );

    fireEvent.change(screen.getByLabelText(/Reason for this decision/i), {
        target: {
            value: "Public evidence remains too limited for a credible review.",
        },
    });
    fireEvent.click(
        screen.getByRole("button", { name: /Finish with limited evidence/i }),
    );
    await waitFor(() =>
        expect(decideSufficiency).toHaveBeenCalledWith({
            runId: "run-1",
            decision: expect.objectContaining({
                kind: "complete_insufficient",
                reason: "Public evidence remains too limited for a credible review.",
            }),
        }),
    );
});

test("does not expose corpus approval while discovery is running", () => {
    useQuery.mockImplementation(() => {
        const index = (useQuery.mock.calls.length - 1) % 3;
        return [
            {
                runId: "run-1",
                company: {
                    legalName: "Example Corp",
                    ticker: "EXM",
                    exchange: "NASDAQ",
                    cik: "123",
                },
                lifecycleState: "discovering_sources",
                executionStatus: "running",
                activeCorpusRevisionId: "revision-1",
                providerFailures: [],
                updatedAt: 1,
            },
            [],
            {
                revision: 1,
                status: "draft",
                counts: { accepted: 0, rejected: 0, pending: 0 },
                sources: [],
            },
        ][index];
    });

    render(<RunRouteComponent runId={"run-1" as never} section="sources" />);

    expect(
        screen.getByText(/We’re gathering public sources for your review/i),
    ).toBeTruthy();
    expect(
        screen.queryByRole("button", { name: /Approve corpus/i }),
    ).toBeNull();
});

test("routes the analyst to the active source-review checkpoint", async () => {
    useQuery.mockImplementation(() => {
        const index = (useQuery.mock.calls.length - 1) % 3;
        return [
            {
                runId: "run-1",
                company: {
                    legalName: "Example Corp",
                    ticker: "EXM",
                    exchange: "NASDAQ",
                    cik: "123",
                },
                lifecycleState: "awaiting_source_review",
                executionStatus: "paused",
                pauseReason: "source_review",
                activeCorpusRevisionId: "revision-1",
                providerFailures: [
                    {
                        service: "exa",
                        operation: "search",
                        errorCode: "exa_not_configured",
                        occurredAt: 1,
                    },
                ],
                updatedAt: 1,
            },
            [],
            {
                revision: 1,
                status: "draft",
                counts: { accepted: 0, rejected: 0, pending: 0 },
                sources: [],
            },
        ][index];
    });

    render(<RunRouteComponent runId={"run-1" as never} section="progress" />);

    await waitFor(() =>
        expect(navigate).toHaveBeenCalledWith({
            to: "/workspace/$runId",
            params: { runId: "run-1" },
            search: { section: "sources" },
            replace: true,
        }),
    );
    expect(
        screen.getAllByText(
            /Independent web discovery is unavailable.*filing sources remain available/i,
        ).length,
    ).toBeTruthy();
    expect(screen.getByText(/Review source set/i)).toBeTruthy();
    expect(
        screen.queryByText(
            /EXA_API_KEY|Convex deployment|awaiting_source_review|exa_not_configured/i,
        ),
    ).toBeNull();
});

test("keeps the approved source set visible for inspection", () => {
    const reviewSource = {
        sourceId: "source-1",
        canonicalUrl: "https://example.com/report",
        title: "Approved report",
        origin: "exa",
        category: "independent_analysis",
        decision: "accepted",
        publishedAt: undefined,
        reason: undefined,
    } as const;
    const proposalSource = {
        ...reviewSource,
        disposition: "recommended",
        sourceFamily: "independent_analysis",
        rank: 0,
        reasonCodes: ["ranked_fill"],
        included: true,
        decisionReason: undefined,
    } as const;
    usePaginatedQuery.mockImplementation((reference) => ({
        results:
            getFunctionName(reference) ===
            "sourceSelectionProposals:listItemsPage"
                ? [proposalSource]
                : [reviewSource],
        status: "Exhausted",
        loadMore: vi.fn(),
    }));
    useQuery.mockImplementation((reference) => {
        const functionName = getFunctionName(reference);
        if (functionName === "researchRuns:getMine") {
            return {
                runId: "run-1",
                company: {
                    legalName: "Example Corp",
                    ticker: "EXM",
                    exchange: "NASDAQ",
                    cik: "123",
                },
                lifecycleState: "corpus_approved",
                executionStatus: "idle",
                activeCorpusRevisionId: "revision-1",
                providerFailures: [
                    {
                        service: "exa",
                        operation: "search",
                        errorCode: "exa_not_configured",
                        occurredAt: 1,
                    },
                ],
                updatedAt: 2,
            };
        }
        if (functionName === "researchRuns:listMyEvents") {
            return [];
        }
        if (functionName === "sources:getReviewSummary") {
            return {
                revision: 1,
                status: "approved",
                counts: { accepted: 1, rejected: 0, pending: 0 },
                total: 1,
                candidateLimit: 48,
            };
        }
        if (functionName === "sourceSelectionProposals:getCurrent") {
            return {
                proposalId: "proposal-1",
                version: 1,
                status: "ready",
                effectiveStatus: "ready",
                recommendedTarget: 12,
                counts: {
                    recommended: 1,
                    needsAttention: 0,
                    alternative: 0,
                },
                gaps: [],
                effectiveIncludedCount: 1,
                revisionStatus: "approved",
            };
        }
        if (functionName === "sourceSelectionProposals:getAdjustmentSets") {
            return { included: [proposalSource], available: [] };
        }
        if (functionName === "sources:getReviewSource") {
            return reviewSource;
        }
        return undefined;
    });

    render(<RunRouteComponent runId={"run-1" as never} section="sources" />);

    expect(screen.getAllByText("Source set approved").length).toBeGreaterThan(
        0,
    );
    fireEvent.click(
        screen.getByRole("button", { name: "Inspect all candidates" }),
    );
    expect(
        screen.getByRole("button", {
            name: /Open Approved report for review/i,
        }),
    ).toBeTruthy();
    expect(
        screen
            .getByRole("button", {
                name: /Accepted Approved report as accepted/i,
            })
            .hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: /Add source/i })).toBeNull();
    expect(
        screen.queryByText(/Sources will appear here when discovery is ready/i),
    ).toBeNull();
});

test("does not advertise manual source intake after corpus approval", () => {
    useQuery.mockImplementation((reference) => {
        const functionName = getFunctionName(reference);
        if (functionName === "researchRuns:getMine") {
            return {
                runId: "run-1",
                company: {
                    legalName: "Example Corp",
                    ticker: "EXM",
                    exchange: "NASDAQ",
                    cik: "123",
                },
                lifecycleState: "corpus_approved",
                executionStatus: "idle",
                activeCorpusRevisionId: "revision-1",
                providerFailures: [
                    {
                        service: "exa",
                        operation: "search",
                        errorCode: "exa_not_configured",
                        occurredAt: 1,
                    },
                ],
                updatedAt: 2,
            };
        }
        if (functionName === "researchRuns:listMyEvents") {
            return [];
        }
        return undefined;
    });

    render(<RunRouteComponent runId={"run-1" as never} section="progress" />);

    expect(
        screen.queryByText(/you can add a public source manually/i),
    ).toBeNull();
    expect(
        screen.getByText(
            /Independent web discovery was unavailable.*filing sources remain available in this approved source set/i,
        ),
    ).toBeTruthy();
});
