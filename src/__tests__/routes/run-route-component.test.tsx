import { api } from "@convex/_generated/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const {
    decideSource,
    approveCorpus,
    decideSufficiency,
    submitManualUrl,
    navigate,
    recompute,
    ensureCurrent,
    startNewRevision,
    rebuild,
    renderPreview,
} = vi.hoisted(() => ({
    decideSource: vi.fn(),
    approveCorpus: vi.fn(),
    decideSufficiency: vi.fn(),
    submitManualUrl: vi.fn(),
    navigate: vi.fn(),
    recompute: vi.fn(),
    ensureCurrent: vi.fn(),
    startNewRevision: vi.fn(),
    rebuild: vi.fn(),
    renderPreview: vi.fn(),
}));

vi.mock("convex/react", async () => {
    const { convexReactHarness } = await import(
        "@/__tests__/helpers/convex-react-harness"
    );
    return convexReactHarness.module;
});
vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
    Link: ({ children, ...props }: React.ComponentProps<"a">) => (
        <a {...props}>{children}</a>
    ),
}));

import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";
import { RunRouteComponent } from "@/components/workspace/run-route-component";

beforeEach(() => {
    convexReactHarness.reset();
    decideSource.mockReset();
    approveCorpus.mockReset();
    decideSufficiency.mockReset();
    submitManualUrl.mockReset();
    navigate.mockReset();
    recompute.mockReset();
    ensureCurrent.mockReset();
    startNewRevision.mockReset();
    rebuild.mockReset();
    renderPreview.mockReset();
    convexReactHarness.query(api.researchRuns.listMyEvents).returns([]);
    convexReactHarness.mutation(api.sources.decide).uses(decideSource);
    convexReactHarness
        .mutation(api.evidenceSufficiency.decide)
        .uses(decideSufficiency);
    convexReactHarness
        .mutation(api.sourceSelectionProposals.approveProposedCorpus)
        .uses(approveCorpus);
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
        .action(api.sourceActions.submitManualUrl)
        .uses(submitManualUrl);
    convexReactHarness
        .action(api.sourceSelectionProposalActions.rebuild)
        .uses(rebuild);
    convexReactHarness
        .action(api.browserPreview.renderPreview)
        .uses(renderPreview);
    convexReactHarness
        .query(api.browserPreviewInternals.getPreview)
        .returns(undefined);
    const emptyPage = {
        results: [],
        status: "Exhausted",
        loadMore: vi.fn(),
    };
    convexReactHarness
        .paginatedQuery(api.sourceSelectionProposals.listItemsPage)
        .returns(emptyPage);
    convexReactHarness
        .paginatedQuery(api.sources.listForReviewPage)
        .returns(emptyPage);
});

test("wires the evidence sufficiency checkpoint", async () => {
    convexReactHarness.query(api.researchRuns.getMine).returns({
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
    } as never);
    convexReactHarness.query(api.sources.getReviewSummary).returns(undefined);
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
    convexReactHarness.query(api.researchRuns.getMine).returns({
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
    } as never);

    render(<RunRouteComponent runId={"run-1" as never} section="sources" />);

    expect(
        screen.getByText(/We’re gathering public sources for your review/i),
    ).toBeTruthy();
    expect(
        screen.queryByRole("button", { name: /Approve corpus/i }),
    ).toBeNull();
});

test("routes the analyst to the active source-review checkpoint", async () => {
    convexReactHarness.query(api.researchRuns.getMine).returns({
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
    } as never);
    convexReactHarness.query(api.sources.getReviewSummary).returns({
        revision: 1,
        status: "draft",
        counts: { accepted: 0, rejected: 0, pending: 0 },
        total: 0,
        candidateLimit: 48,
    });
    convexReactHarness
        .query(api.sourceSelectionProposals.getCurrent)
        .returns(undefined);
    convexReactHarness
        .query(api.sourceSelectionProposals.getAdjustmentSets)
        .returns(undefined);
    convexReactHarness.query(api.sources.getReviewSource).returns(undefined);

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

test.each([
    ["corpus_approved", "idle"],
    ["extracting_evidence", "running"],
    ["extracting_evidence", "paused"],
    ["extracting_evidence", "failed"],
    ["evidence_ready", "idle"],
] as const)("keeps approved sources inspectable during %s / %s", (lifecycleState, executionStatus) => {
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
    convexReactHarness
        .paginatedQuery(api.sourceSelectionProposals.listItemsPage)
        .returns({
            results: [proposalSource],
            status: "Exhausted",
            loadMore: vi.fn(),
        });
    convexReactHarness.paginatedQuery(api.sources.listForReviewPage).returns({
        results: [reviewSource],
        status: "Exhausted",
        loadMore: vi.fn(),
    });
    convexReactHarness.query(api.researchRuns.getMine).returns({
        runId: "run-1",
        company: {
            legalName: "Example Corp",
            ticker: "EXM",
            exchange: "NASDAQ",
            cik: "123",
        },
        lifecycleState,
        executionStatus,
        corpusRevisionStatus: "approved",
        canStartNewCorpusRevision: lifecycleState === "corpus_approved",
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
    } as never);
    convexReactHarness.query(api.sources.getReviewSummary).returns({
        revision: 1,
        status: "approved",
        counts: { accepted: 1, rejected: 0, pending: 0 },
        total: 1,
        candidateLimit: 48,
    });
    convexReactHarness.query(api.sourceSelectionProposals.getCurrent).returns({
        proposalId: "proposal-1" as never,
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
    } as never);
    convexReactHarness
        .query(api.sourceSelectionProposals.getAdjustmentSets)
        .returns({ included: [proposalSource], available: [] } as never);
    convexReactHarness
        .query(api.sources.getReviewSource)
        .returns(reviewSource as never);

    render(<RunRouteComponent runId={"run-1" as never} section="sources" />);

    expect(
        screen.getByRole("heading", {
            name: "Source set is approved and read-only",
        }),
    ).toBeTruthy();
    if (lifecycleState !== "corpus_approved") {
        expect(
            screen
                .getByRole("button", { name: "Start new revision" })
                .hasAttribute("disabled"),
        ).toBe(true);
    }
    fireEvent.click(
        screen.getByRole("button", { name: "Inspect all candidates" }),
    );
    expect(
        screen.getAllByRole("button", {
            name: /Open Approved report for review/i,
        }).length,
    ).toBeGreaterThan(0);
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
    convexReactHarness.query(api.researchRuns.getMine).returns({
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
    } as never);

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

test.each([
    ["running", undefined, "Evidence is being prepared"],
    [
        "paused",
        "claim_generation_unavailable",
        "Evidence is temporarily unavailable",
    ],
    ["failed", undefined, "Evidence could not be prepared"],
] as const)("explains persisted evidence preparation state %s", (executionStatus, pauseReason, title) => {
    convexReactHarness.query(api.researchRuns.getMine).returns({
        runId: "run-1",
        company: {
            legalName: "Example Corp",
            ticker: "EXM",
            exchange: "NASDAQ",
            cik: "123",
        },
        lifecycleState: "extracting_evidence",
        executionStatus,
        pauseReason,
        activeCorpusRevisionId: "revision-1",
        corpusRevisionStatus: "approved",
        canStartNewCorpusRevision: false,
        providerFailures: [{ service: "exa", errorCode: "http_503" }],
        updatedAt: 2,
    });
    render(<RunRouteComponent runId={"run-1" as never} section="progress" />);
    expect(screen.getByText(title)).toBeTruthy();
    expect(
        screen.getByText(
            "Some research sources were unavailable. Inspect the approved set in Sources and consider any evidence gaps during review.",
        ),
    ).toBeTruthy();
    expect(
        screen.queryByText(/Independent web discovery is unavailable/),
    ).toBeNull();
    expect(
        screen.getByRole("region", { name: "Research progress" }).textContent,
    ).not.toMatch(
        /claim_generation_unavailable|EXA_API_KEY|evidenceExecution|extracting_evidence/,
    );
});
