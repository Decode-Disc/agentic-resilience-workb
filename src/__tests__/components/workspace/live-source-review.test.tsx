import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, test, vi } from "vitest";

const {
    useQuery,
    usePaginatedQuery,
    useMutation,
    useAction,
    approve,
    recompute,
    ensureCurrent,
    rebuild,
} = vi.hoisted(() => ({
    useQuery: vi.fn(),
    usePaginatedQuery: vi.fn(),
    useMutation: vi.fn(),
    useAction: vi.fn(),
    approve: vi.fn(),
    recompute: vi.fn(),
    ensureCurrent: vi.fn(),
    rebuild: vi.fn(),
}));

vi.mock("convex/react", () => ({
    useQuery,
    usePaginatedQuery,
    useMutation,
    useAction,
}));

import { LiveSourceReview } from "@/components/workspace/live-source-review";

const proposalSource = {
    sourceId: "source-recommended",
    canonicalUrl: "https://sec.gov/report",
    title: "Annual report",
    origin: "sec",
    category: "regulatory",
    publishedAt: undefined,
    disposition: "recommended",
    sourceFamily: "regulatory",
    documentKind: "regulatory_annual",
    authorityTier: "regulator_primary",
    coverageContributions: ["regulatory_annual"],
    duplicateOfSourceId: undefined,
    rank: 0,
    reasonCodes: ["required_family_coverage"],
    decision: "pending",
    included: true,
    decisionReason: undefined,
} as const;

beforeEach(() => {
    useQuery.mockReset();
    usePaginatedQuery.mockReset();
    useMutation.mockReset();
    useAction.mockReset();
    approve.mockReset();
    recompute.mockReset();
    ensureCurrent.mockReset();
    rebuild.mockReset();
    useAction.mockReturnValue(rebuild);
    useMutation.mockImplementation((reference) => {
        const name = getFunctionName(reference);
        if (name === "sourceSelectionProposals:approveProposedCorpus") {
            return approve;
        }
        if (name === "sourceSelectionProposals:recompute") {
            return recompute;
        }
        if (name === "sourceSelectionProposals:ensureCurrentForReview") {
            return ensureCurrent;
        }
        return vi.fn();
    });
});

test("retries source review queries after a load failure", () => {
    const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
    let shouldFail = true;
    useQuery.mockImplementation(() => {
        if (shouldFail) {
            throw new Error("Source review query failed");
        }
        return undefined;
    });
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
        />,
    );

    expect(screen.getByText("Source review could not be loaded")).toBeTruthy();
    shouldFail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
        screen.getByLabelText("Loading source proposal summary"),
    ).toBeTruthy();
    consoleError.mockRestore();
});

test("keeps proposal summary, source list, and detail geometry while loading", () => {
    useQuery.mockReturnValue(undefined);
    const loadingPage = {
        results: [],
        status: "LoadingFirstPage",
        loadMore: vi.fn(),
    };
    usePaginatedQuery.mockReturnValue(loadingPage);

    render(
        <LiveSourceReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            onDecide={vi.fn()}
        />,
    );

    expect(
        screen.getByLabelText("Loading source proposal summary"),
    ).toBeTruthy();
    expect(screen.getByLabelText("Loading source list")).toBeTruthy();
    expect(screen.getByLabelText("Loading source detail")).toBeTruthy();
});

test("queries proposal dispositions and approves the exact visible version", async () => {
    const currentProposal = {
        proposalId: "proposal-1",
        version: 2,
        status: "ready",
        effectiveStatus: "ready",
        recommendedTarget: 12,
        recommendationCeiling: 24,
        coverageGaps: [],
        counts: {
            recommended: 1,
            needsAttention: 0,
            alternative: 1,
        },
        gaps: [],
        effectiveIncludedCount: 1,
        revisionStatus: "draft",
    };
    const adjustmentSets = { included: [proposalSource], available: [] };
    const reviewSummary = {
        revision: 1,
        status: "draft",
        counts: { accepted: 0, rejected: 0, pending: 1 },
        total: 1,
        candidateLimit: 48,
    };
    const recommendedPage = {
        results: [proposalSource],
        status: "Exhausted",
        loadMore: vi.fn(),
    };
    const alternativePage = {
        results: [],
        status: "Exhausted",
        loadMore: vi.fn(),
    };
    const inspectionPage = {
        results: [
            {
                sourceId: proposalSource.sourceId,
                canonicalUrl: proposalSource.canonicalUrl,
                title: proposalSource.title,
                origin: proposalSource.origin,
                category: proposalSource.category,
                decision: proposalSource.decision,
                publishedAt: undefined,
                reason: undefined,
            },
        ],
        status: "Exhausted",
        loadMore: vi.fn(),
    };
    useQuery.mockImplementation((reference, args) => {
        const functionName = getFunctionName(reference);
        if (functionName === "sourceSelectionProposals:getCurrent") {
            return currentProposal;
        }
        if (functionName === "sourceSelectionProposals:getAdjustmentSets") {
            return adjustmentSets;
        }
        if (functionName === "sources:getReviewSummary") {
            return reviewSummary;
        }
        if (functionName === "sources:getReviewSource") {
            return args === "skip" ? undefined : proposalSource;
        }
        return undefined;
    });
    usePaginatedQuery.mockImplementation((reference, args) => {
        const functionName = getFunctionName(reference);
        if (functionName === "sourceSelectionProposals:listItemsPage") {
            return args.disposition === "recommended"
                ? recommendedPage
                : alternativePage;
        }
        return inspectionPage;
    });

    render(
        <LiveSourceReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            onDecide={vi.fn()}
        />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Alternatives.*1/i }));
    await waitFor(() =>
        expect(usePaginatedQuery).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                disposition: "alternative",
                proposalId: "proposal-1",
            }),
            { initialNumItems: 12 },
        ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve source set" }));
    await waitFor(() =>
        expect(approve).toHaveBeenCalledWith({
            runId: "run-1",
            corpusRevisionId: "revision-1",
            proposalId: "proposal-1",
            proposalVersion: 2,
            decisionKey: expect.stringMatching(/^corpus-approval:/),
        }),
    );
});

test("explains a blocked rebuild without exposing provider or configuration details", async () => {
    rebuild.mockResolvedValue({
        proposalId: "proposal-1",
        version: 1,
        outcome: "blocked",
        failedDiscoveryFamilies: ["regulatory", "official_product"],
    });
    const currentProposal = {
        proposalId: "proposal-1",
        version: 1,
        status: "ready",
        effectiveStatus: "outdated",
        recommendedTarget: 12,
        recommendationCeiling: 24,
        rebuildOutcome: undefined,
        failedDiscoveryFamilies: [],
        coverageGaps: [],
        counts: {
            recommended: 1,
            needsAttention: 0,
            alternative: 0,
        },
        gaps: [],
        effectiveIncludedCount: 1,
        revisionStatus: "draft",
    };
    const adjustmentSets = { included: [proposalSource], available: [] };
    const reviewSummary = {
        revision: 1,
        status: "draft",
        counts: { accepted: 0, rejected: 0, pending: 1 },
        total: 1,
        candidateLimit: 48,
    };
    const proposalPage = {
        results: [proposalSource],
        status: "Exhausted",
        loadMore: vi.fn(),
    };
    const inspectionPage = {
        results: [],
        status: "Exhausted",
        loadMore: vi.fn(),
    };
    useQuery.mockImplementation((reference, args) => {
        const functionName = getFunctionName(reference);
        if (functionName === "sourceSelectionProposals:getCurrent") {
            return currentProposal;
        }
        if (functionName === "sourceSelectionProposals:getAdjustmentSets") {
            return adjustmentSets;
        }
        if (functionName === "sources:getReviewSummary") {
            return reviewSummary;
        }
        if (functionName === "sources:getReviewSource") {
            return args === "skip" ? undefined : proposalSource;
        }
        return undefined;
    });
    usePaginatedQuery.mockImplementation((reference) => {
        const functionName = getFunctionName(reference);
        return functionName === "sourceSelectionProposals:listItemsPage"
            ? proposalPage
            : inspectionPage;
    });

    render(
        <LiveSourceReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            onDecide={vi.fn()}
        />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rebuild proposal" }));

    expect(
        await screen.findByText(/Source discovery is temporarily unavailable/i),
    ).toBeTruthy();
    expect(
        screen.getByText(/existing draft and source decisions are unchanged/i),
    ).toBeTruthy();
    expect(
        screen.queryByText(/SEC_USER_AGENT|EXA_API_KEY|provider|blocked/i),
    ).toBeNull();
});

test("shows an approved legacy source set without querying missing proposal items", () => {
    const reviewSummary = {
        revision: 1,
        status: "approved",
        counts: { accepted: 1, rejected: 0, pending: 0 },
        total: 1,
        candidateLimit: 48,
    };
    const skippedProposalPage = {
        results: [],
        status: "LoadingFirstPage",
        loadMore: vi.fn(),
    };
    const inspectionPage = {
        results: [
            {
                sourceId: proposalSource.sourceId,
                canonicalUrl: proposalSource.canonicalUrl,
                title: proposalSource.title,
                origin: proposalSource.origin,
                category: proposalSource.category,
                decision: "accepted",
                publishedAt: undefined,
                reason: undefined,
            },
        ],
        status: "Exhausted",
        loadMore: vi.fn(),
    };
    useQuery.mockImplementation((reference, args) => {
        const functionName = getFunctionName(reference);
        if (functionName === "sourceSelectionProposals:getCurrent") {
            return null;
        }
        if (functionName === "sourceSelectionProposals:getAdjustmentSets") {
            return args === "skip"
                ? undefined
                : { included: [], available: [] };
        }
        if (functionName === "sources:getReviewSummary") {
            return reviewSummary;
        }
        return undefined;
    });
    usePaginatedQuery.mockImplementation((reference) => {
        const functionName = getFunctionName(reference);
        if (functionName === "sourceSelectionProposals:listItemsPage") {
            return skippedProposalPage;
        }
        return inspectionPage;
    });

    render(
        <LiveSourceReview
            runId={"run-legacy" as never}
            corpusRevisionId={"revision-legacy" as never}
            onDecide={vi.fn()}
        />,
    );

    expect(screen.getAllByText("Annual report")).toHaveLength(2);
    expect(
        screen.queryByRole("button", { name: "Approve source set" }),
    ).toBeNull();
    expect(ensureCurrent).not.toHaveBeenCalled();
    expect(usePaginatedQuery).toHaveBeenCalledWith(expect.anything(), "skip", {
        initialNumItems: 12,
    });
});

test("repairs an authorized legacy draft before loading proposal items", async () => {
    ensureCurrent.mockResolvedValue({
        proposalId: "proposal-created",
        version: 1,
        status: "ready",
    });
    const reviewSummary = {
        revision: 1,
        status: "draft",
        counts: { accepted: 0, rejected: 0, pending: 1 },
        total: 1,
        candidateLimit: 48,
    };
    useQuery.mockImplementation((reference) => {
        const functionName = getFunctionName(reference);
        if (functionName === "sourceSelectionProposals:getCurrent") {
            return null;
        }
        if (functionName === "sources:getReviewSummary") {
            return reviewSummary;
        }
        return undefined;
    });
    usePaginatedQuery.mockReturnValue({
        results: [],
        status: "LoadingFirstPage",
        loadMore: vi.fn(),
    });

    render(
        <LiveSourceReview
            runId={"run-draft" as never}
            corpusRevisionId={"revision-draft" as never}
            onDecide={vi.fn()}
        />,
    );

    await waitFor(() =>
        expect(ensureCurrent).toHaveBeenCalledWith({
            runId: "run-draft",
            corpusRevisionId: "revision-draft",
        }),
    );
    expect(usePaginatedQuery).toHaveBeenCalledWith(expect.anything(), "skip", {
        initialNumItems: 12,
    });
});
