import { getFunctionName } from "convex/server";
import { api } from "@convex/_generated/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const {
    approve,
    recompute,
    ensureCurrent,
    rebuild,
    startNewRevision,
    renderPreview,
} = vi.hoisted(() => ({
    approve: vi.fn(),
    recompute: vi.fn(),
    ensureCurrent: vi.fn(),
    rebuild: vi.fn(),
    startNewRevision: vi.fn(),
    renderPreview: vi.fn(),
}));

vi.mock("convex/react", async () => {
    const { convexReactHarness } = await import(
        "@/__tests__/helpers/convex-react-harness"
    );
    return convexReactHarness.module;
});

import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";
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
    convexReactHarness.reset();
    approve.mockReset();
    recompute.mockReset();
    ensureCurrent.mockReset();
    rebuild.mockReset();
    startNewRevision.mockReset();
    renderPreview.mockReset();
    convexReactHarness
        .mutation(api.sourceSelectionProposals.approveProposedCorpus)
        .uses(approve);
    convexReactHarness
        .mutation(api.sourceSelectionProposals.recompute)
        .uses(recompute);
    convexReactHarness
        .mutation(api.sourceSelectionProposals.ensureCurrentForReview)
        .uses(ensureCurrent);
    convexReactHarness
        .mutation(api.sourceSelectionProposals.startNewCorpusRevision)
        .uses(startNewRevision);
    convexReactHarness
        .action(api.sourceSelectionProposalActions.rebuild)
        .uses(rebuild);
    convexReactHarness
        .action(api.browserPreview.renderPreview)
        .uses(renderPreview);
    convexReactHarness
        .query(api.browserPreviewInternals.getPreview)
        .returns(undefined);
});

test("retries source review queries after a load failure", () => {
    const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
    const queryError = new Error("Source review query failed");
    const proposalQuery = convexReactHarness.query(
        api.sourceSelectionProposals.getCurrent,
    );
    proposalQuery.throws(queryError);
    const loadingPage = {
        results: [],
        status: "LoadingFirstPage",
        loadMore: vi.fn(),
    };

    render(
        <LiveSourceReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            onDecide={vi.fn()}
        />,
    );

    expect(screen.getByText("Source review could not be loaded")).toBeTruthy();
    proposalQuery.returns(undefined);
    convexReactHarness
        .query(api.sourceSelectionProposals.getAdjustmentSets)
        .returns(undefined);
    convexReactHarness.query(api.sources.getReviewSummary).returns(undefined);
    convexReactHarness.query(api.sources.getReviewSource).returns(undefined);
    convexReactHarness
        .paginatedQuery(api.sourceSelectionProposals.listItemsPage)
        .returns(loadingPage);
    convexReactHarness
        .paginatedQuery(api.sources.listForReviewPage)
        .returns(loadingPage);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
        screen.getByLabelText("Loading source proposal summary"),
    ).toBeTruthy();
    consoleError.mockRestore();
});

test("keeps proposal summary, source list, and detail geometry while loading", () => {
    const loadingPage = {
        results: [],
        status: "LoadingFirstPage",
        loadMore: vi.fn(),
    };
    convexReactHarness
        .query(api.sourceSelectionProposals.getCurrent)
        .returns(undefined);
    convexReactHarness
        .query(api.sourceSelectionProposals.getAdjustmentSets)
        .returns(undefined);
    convexReactHarness.query(api.sources.getReviewSummary).returns(undefined);
    convexReactHarness.query(api.sources.getReviewSource).returns(undefined);
    convexReactHarness
        .paginatedQuery(api.sourceSelectionProposals.listItemsPage)
        .returns(loadingPage);
    convexReactHarness
        .paginatedQuery(api.sources.listForReviewPage)
        .returns(loadingPage);

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

test("shows current source groups and approves the exact visible version", async () => {
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
    const adjustmentSets = {
        included: [proposalSource],
        available: [
            {
                ...proposalSource,
                sourceId: "source-alternative",
                title: "Independent analysis",
                canonicalUrl: "https://example.com/analysis",
                disposition: "alternative",
                included: false,
            },
        ],
    };
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
    convexReactHarness
        .query(api.sourceSelectionProposals.getCurrent)
        .returns(currentProposal);
    convexReactHarness
        .query(api.sourceSelectionProposals.getAdjustmentSets)
        .returns(adjustmentSets);
    convexReactHarness
        .query(api.sources.getReviewSummary)
        .returns(reviewSummary);
    convexReactHarness
        .query(api.sources.getReviewSource)
        .returnsFrom(({ args }) =>
            args === "skip" ? undefined : proposalSource,
        );
    convexReactHarness
        .paginatedQuery(api.sourceSelectionProposals.listItemsPage)
        .returnsFrom(({ args }) =>
            args === "skip" || args.disposition === "recommended"
                ? recommendedPage
                : alternativePage,
        );
    convexReactHarness
        .paginatedQuery(api.sources.listForReviewPage)
        .returns(inspectionPage);

    render(
        <LiveSourceReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            onDecide={vi.fn()}
        />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Alternatives.*1/i }));
    expect(
        screen.getByRole("button", {
            name: "Open Independent analysis for review",
        }),
    ).toBeTruthy();

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
    convexReactHarness
        .query(api.sourceSelectionProposals.getCurrent)
        .returns(currentProposal);
    convexReactHarness
        .query(api.sourceSelectionProposals.getAdjustmentSets)
        .returns(adjustmentSets);
    convexReactHarness
        .query(api.sources.getReviewSummary)
        .returns(reviewSummary);
    convexReactHarness
        .query(api.sources.getReviewSource)
        .returnsFrom(({ args }) =>
            args === "skip" ? undefined : proposalSource,
        );
    convexReactHarness
        .paginatedQuery(api.sourceSelectionProposals.listItemsPage)
        .returns(proposalPage);
    convexReactHarness
        .paginatedQuery(api.sources.listForReviewPage)
        .returns(inspectionPage);

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
    convexReactHarness
        .query(api.sourceSelectionProposals.getCurrent)
        .returns(null);
    convexReactHarness
        .query(api.sourceSelectionProposals.getAdjustmentSets)
        .returnsFrom(({ args }) =>
            args === "skip" ? undefined : { included: [], available: [] },
        );
    convexReactHarness
        .query(api.sources.getReviewSummary)
        .returns(reviewSummary);
    convexReactHarness.query(api.sources.getReviewSource).returns(undefined);
    convexReactHarness
        .paginatedQuery(api.sourceSelectionProposals.listItemsPage)
        .returns(skippedProposalPage);
    convexReactHarness
        .paginatedQuery(api.sources.listForReviewPage)
        .returns(inspectionPage);

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
    expect(
        convexReactHarness.module.useQuery.mock.calls.some(
            ([reference, args]) =>
                getFunctionName(reference) ===
                    "sourceSelectionProposals:getAdjustmentSets" &&
                args === "skip",
        ),
    ).toBe(true);
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
    convexReactHarness
        .query(api.sourceSelectionProposals.getCurrent)
        .returns(null);
    convexReactHarness
        .query(api.sourceSelectionProposals.getAdjustmentSets)
        .returns(undefined);
    convexReactHarness
        .query(api.sources.getReviewSummary)
        .returns(reviewSummary);
    convexReactHarness.query(api.sources.getReviewSource).returns(undefined);
    const loadingPage = {
        results: [],
        status: "LoadingFirstPage",
        loadMore: vi.fn(),
    };
    convexReactHarness
        .paginatedQuery(api.sourceSelectionProposals.listItemsPage)
        .returns(loadingPage);
    convexReactHarness
        .paginatedQuery(api.sources.listForReviewPage)
        .returns(loadingPage);

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
    expect(
        convexReactHarness.module.useQuery.mock.calls.some(
            ([reference, args]) =>
                getFunctionName(reference) ===
                    "sourceSelectionProposals:getAdjustmentSets" &&
                args === "skip",
        ),
    ).toBe(true);
});
