import { api } from "@convex/_generated/api";
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    RouterProvider,
} from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("convex/react", async () => {
    const { convexReactHarness } = await import(
        "@/__tests__/helpers/convex-react-harness"
    );
    return convexReactHarness.module;
});

import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";
import { Route as RunRoute } from "@/routes/workspace/_protected/$runId";

const recover = vi.fn();
const termsCandidate: FunctionReturnType<
    typeof api.sourceSelectionProposals.getAdjustmentSets
>["available"][number] = {
    sourceId: "source-terms" as never,
    canonicalUrl: "https://example.com/terms",
    title: "Subscription and service agreement",
    origin: "exa",
    category: "official_commercial",
    publishedAt: undefined,
    disposition: "alternative",
    sourceFamily: "official_commercial",
    documentKind: "official_commercial_terms",
    authorityTier: "unverified",
    companyLinkageBasis: "unverified",
    recommendationContributions: [],
    declaredCoverageRoles: [],
    eligibleCoverageRoles: [],
    coverageContributions: [],
    duplicateOfSourceId: undefined,
    rank: 0,
    reasonCodes: ["not_selected"],
    decision: "pending",
    included: false,
    decisionReason: undefined,
};

beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const matchMedia = window.matchMedia.bind(window);
    vi.spyOn(window, "matchMedia").mockImplementation((query) => {
        const media = matchMedia(query);
        return query === "(prefers-reduced-motion: reduce)"
            ? { ...media, matches: true }
            : media;
    });
    convexReactHarness.reset();
    convexReactHarness
        .mutation(api.sourcePreparation.startForReview)
        .uses(vi.fn());
    recover.mockReset();
    convexReactHarness.query(api.researchRuns.getMine).returns({
        runId: "run-1",
        company: {
            legalName: "Test Company",
            ticker: "TEST",
            exchange: "NASDAQ",
            cik: "123",
        },
        lifecycleState: "awaiting_source_review",
        executionStatus: "paused",
        pauseReason: "source_review",
        activeCorpusRevisionId: "revision-1",
        providerFailures: [],
        updatedAt: 1,
    });
    convexReactHarness.query(api.researchRuns.listMyEvents).returns([]);
    convexReactHarness.query(api.sourceSelectionProposals.getCurrent).returns({
        proposalId: "proposal-1",
        version: 1,
        status: "ready",
        effectiveStatus: "ready",
        revisionStatus: "draft",
        counts: { recommended: 0, needsAttention: 0, alternative: 1 },
        effectiveIncludedCount: 0,
        recommendedTarget: 12,
        recommendationCeiling: 24,
        gaps: [],
        failedDiscoveryFamilies: [],
        coverageGaps: ["official_commercial_terms"],
        coverageRequirements: [
            {
                role: "official_commercial_terms",
                covered: false,
                candidateIds: [termsCandidate.sourceId],
            },
        ],
    });
    convexReactHarness
        .query(api.sourceSelectionProposals.getAdjustmentSets)
        .returns({ included: [], available: [termsCandidate] });
    convexReactHarness.query(api.sources.getReviewSummary).returns({
        revision: 1,
        status: "draft",
        counts: { accepted: 0, pending: 1, rejected: 0 },
        total: 1,
        candidateLimit: 48,
    });
    convexReactHarness.query(api.sources.getReviewSource).returns(undefined);
    convexReactHarness.paginatedQuery(api.sources.listForReviewPage).returns({
        results: [termsCandidate],
        status: "Exhausted",
        loadMore: vi.fn(),
    });
    convexReactHarness
        .action(api.sourceSelectionProposalActions.recoverDiscovery)
        .uses(recover);
    convexReactHarness.mutation(api.sources.decide).uses(vi.fn());
    convexReactHarness.mutation(api.evidenceSufficiency.decide).uses(vi.fn());
    convexReactHarness
        .mutation(api.sourceSelectionProposals.approveProposedCorpus)
        .uses(vi.fn());
    convexReactHarness
        .mutation(api.sourceSelectionProposals.recompute)
        .uses(vi.fn());
    convexReactHarness
        .mutation(api.sourceSelectionProposals.ensureCurrentForReview)
        .uses(vi.fn());
    convexReactHarness
        .mutation(api.sourceSelectionProposals.startNewCorpusRevision)
        .uses(vi.fn());
    convexReactHarness.action(api.sourceActions.submitManualUrl).uses(vi.fn());
    convexReactHarness
        .action(api.sourceSelectionProposalActions.rebuild)
        .uses(vi.fn());
});

afterEach(() => vi.restoreAllMocks());

function openRun(url: string) {
    const root = createRootRoute();
    const workspace = createRoute({
        getParentRoute: () => root,
        path: "workspace",
    });
    const protectedRoute = createRoute({
        getParentRoute: () => workspace,
        id: "_protected",
    });
    // Initialize the file route with the same parents and path as the generated tree.
    const run = RunRoute.update({
        id: "/$runId",
        path: "/$runId",
        getParentRoute: () => protectedRoute,
    } as never);
    const history = createMemoryHistory({ initialEntries: [url] });
    const router = createRouter({
        routeTree: root.addChildren([
            workspace.addChildren([protectedRoute.addChildren([run])]),
        ]),
        history,
        defaultPendingMinMs: 0,
    });
    return { router, history, ...render(<RouterProvider router={router} />) };
}

test("restores coverage inspection through Back and Forward without running a search", async () => {
    const first = openRun("/workspace/run-1?section=sources");
    const coverage = await screen.findByRole("complementary", {
        name: "Source coverage",
    });
    fireEvent.click(
        within(coverage).getByRole("button", {
            name: "Review coverage: Subscription & service terms",
        }),
    );
    fireEvent.click(
        await within(coverage).findByRole("button", {
            name: "Review candidates for Subscription & service terms",
        }),
    );
    expect(
        await screen.findByRole("heading", {
            name: "Review matching candidates",
        }),
    ).toBeTruthy();
    await waitFor(() =>
        expect(first.router.state.location.search).toMatchObject({
            section: "sources",
            view: "inspect",
            coverage: "official_commercial_terms",
        }),
    );
    first.history.back();
    await waitFor(() =>
        expect(first.router.state.location.search).toEqual({
            section: "sources",
        }),
    );
    expect(
        await screen.findByRole("region", { name: "Proposed source set" }),
    ).toBeTruthy();
    first.history.forward();
    await waitFor(() =>
        expect(first.router.state.location.search).toMatchObject({
            view: "inspect",
            coverage: "official_commercial_terms",
        }),
    );
    expect(
        await screen.findByRole("heading", {
            name: "Review matching candidates",
        }),
    ).toBeTruthy();
    expect(recover).not.toHaveBeenCalled();
}, 10_000);

test("opens a saved coverage URL directly without running a search", async () => {
    openRun(
        "/workspace/run-1?section=sources&view=inspect&coverage=official_commercial_terms",
    );
    expect(
        await screen.findByRole("heading", {
            name: "Review matching candidates",
        }),
    ).toBeTruthy();
    expect(screen.getByText("Subscription & service terms")).toBeTruthy();
    expect(recover).not.toHaveBeenCalled();
});

test("clears coverage when showing all candidates and clears the inspector when returning to the proposal", async () => {
    const reopened = openRun(
        "/workspace/run-1?section=sources&view=inspect&coverage=official_commercial_terms",
    );
    await screen.findByRole("heading", { name: "Review matching candidates" });
    fireEvent.click(
        screen.getByRole("button", { name: "Show all candidates" }),
    );
    await waitFor(() =>
        expect(reopened.router.state.location.search).toEqual({
            section: "sources",
            view: "inspect",
        }),
    );
    expect(
        await screen.findByRole("heading", { name: "Inspect all candidates" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to proposal" }));
    await waitFor(() =>
        expect(reopened.router.state.location.search).toEqual({
            section: "sources",
        }),
    );
    expect(recover).not.toHaveBeenCalled();
});
