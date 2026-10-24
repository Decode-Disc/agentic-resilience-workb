import { api } from "@convex/_generated/api";
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const {
    approve,
    recompute,
    ensureCurrent,
    rebuild,
    startNewRevision,
    renderPreview,
    recover,
    prepare,
} = vi.hoisted(() => ({
    approve: vi.fn(),
    recompute: vi.fn(),
    ensureCurrent: vi.fn(),
    rebuild: vi.fn(),
    startNewRevision: vi.fn(),
    renderPreview: vi.fn(),
    recover: vi.fn(),
    prepare: vi.fn(),
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
    // Clock and subscription tests use reduced motion; protected browser checks cover animated transitions.
    const getMediaQuery = window.matchMedia.bind(window);
    vi.spyOn(window, "matchMedia").mockImplementation((query) => {
        const media = getMediaQuery(query);
        return query === "(prefers-reduced-motion: reduce)"
            ? { ...media, matches: true }
            : media;
    });
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    convexReactHarness.reset();
    approve.mockReset();
    recompute.mockReset();
    ensureCurrent.mockReset();
    rebuild.mockReset();
    startNewRevision.mockReset();
    renderPreview.mockReset();
    recover.mockReset();
    prepare.mockReset();
    convexReactHarness
        .mutation(api.sourcePreparation.startForReview)
        .uses(prepare);
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
        .action(api.sourceSelectionProposalActions.recoverDiscovery)
        .uses(recover);
    convexReactHarness
        .action(api.browserPreview.renderPreview)
        .uses(renderPreview);
    convexReactHarness
        .query(api.browserPreviewInternals.getPreview)
        .returns(undefined);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

function recoveryReview(
    recovery?: unknown,
    source = proposalSource,
    preparation?: unknown,
    readSource?: (args: unknown) => unknown,
    deadlineAt?: number,
    retryAt?: number,
) {
    const proposalSnapshot = {
        proposalId: "proposal-1",
        version: 1,
        status: "ready",
        effectiveStatus: "ready",
        revisionStatus: "draft",
        recommendedTarget: 12,
        recommendationCeiling: 24,
        effectiveIncludedCount: 1,
        counts: { recommended: 1, needsAttention: 0, alternative: 0 },
        gaps: [],
        coverageGaps: ["official_product_platform"],
        coverageRequirements: [
            {
                role: "official_product_platform",
                covered: false,
                candidateIds: [],
            },
        ],
        rebuildOutcome: "partial",
        failedDiscoveryFamilies: ["official_product"],
        recovery,
        preparation,
        preparationAction: {
            deadlineAt,
            retryAt,
            kind: preparation ? "resume" : "start",
            available: true,
        },
    };
    convexReactHarness
        .query(api.sourceSelectionProposals.getCurrent)
        .returns(proposalSnapshot);
    convexReactHarness
        .query(api.sourceSelectionProposals.getAdjustmentSets)
        .returns({ included: [source], available: [] });
    convexReactHarness.query(api.sources.getReviewSummary).returns({
        revision: 1,
        status: "draft",
        counts: { accepted: 0, pending: 1, rejected: 0 },
        total: 1,
        candidateLimit: 48,
    });
    convexReactHarness
        .query(api.sources.getReviewSource)
        .returnsFrom(({ args }) => readSource?.(args));
    convexReactHarness.paginatedQuery(api.sources.listForReviewPage).returns({
        results: [source],
        status: "Exhausted",
        loadMore: vi.fn(),
    });
    const view = render(
        <LiveSourceReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            onDecide={vi.fn()}
        />,
    );
    return { ...view, proposalSnapshot };
}

test("starts source reading explicitly from a current draft using its native preparation result", async () => {
    prepare.mockResolvedValue({
        preparationId: "preparation-1",
        status: "started",
    });
    recoveryReview();
    fireEvent.click(
        screen.getByRole("button", { name: "Prepare source reading" }),
    );
    await waitFor(() =>
        expect(prepare).toHaveBeenCalledWith({
            runId: "run-1",
            corpusRevisionId: "revision-1",
            expectedProposalId: "proposal-1",
            requestId: expect.any(String),
        }),
    );
    expect(rebuild).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
    expect(
        screen.queryByText(/discovery is temporarily unavailable/i),
    ).toBeNull();
});

test("loads the first selected source detail when inspection opens without requiring a second source click", async () => {
    const readSelected = vi.fn();
    recoveryReview(undefined, proposalSource, undefined, (args) => {
        readSelected(args);
        return proposalSource;
    });
    fireEvent.click(
        screen.getByRole("button", { name: "Inspect all candidates" }),
    );
    await waitFor(() =>
        expect(readSelected).toHaveBeenCalledWith({
            runId: "run-1",
            corpusRevisionId: "revision-1",
            sourceId: "source-recommended",
        }),
    );
});

test("loads pinned passages when a prepared source is opened from its overview card", async () => {
    const preparedSource = {
        ...proposalSource,
        inspectionStatus: "partial" as const,
    };
    const readSelected = vi.fn();
    const detail = {
        ...preparedSource,
        qualificationStatus: "available",
        qualificationExecutionMode: "showcase",
        roleAvailability: [
            {
                role: "regulatory_annual",
                state: "limited",
                usage: "attributed_argument_only",
                reasonCodes: [],
            },
        ],
        qualification: {
            companyMatch: "subject",
            companyPassages: [],
            documentKind: "regulatory_annual",
            reportingPeriodEnd: null,
            reportingPeriodPassages: [],
            limitations: [],
            findings: [
                {
                    role: "regulatory_annual",
                    kind: "attributed_argument",
                    findingKey: "illustrative-argument-0",
                    usage: "attributed_argument_only",
                    summary: "An attributed argument",
                    passages: [
                        {
                            passageKey: "p0",
                            quotation:
                                "The author argues that agents could change workflow economics.",
                        },
                    ],
                    period: "unspecified",
                    periodPassages: [],
                    dependsOnFlaggedAssertion: false,
                },
            ],
        },
    };
    recoveryReview(undefined, preparedSource, undefined, (args) => {
        readSelected(args);
        return detail;
    });
    fireEvent.click(
        screen.getByRole("button", { name: "Open Annual report for review" }),
    );
    fireEvent.click(await screen.findByRole("tab", { name: "Source details" }));
    expect(
        await screen.findByText(
            "The author argues that agents could change workflow economics.",
        ),
    ).toBeTruthy();
    expect(readSelected).toHaveBeenCalledWith({
        runId: "run-1",
        corpusRevisionId: "revision-1",
        sourceId: "source-recommended",
    });
    expect(screen.getByText("Illustrative source assessment")).toBeTruthy();
});

test("renders a rejected search at its coverage action without redirecting or hiding the result", async () => {
    recover.mockResolvedValue({
        proposalId: "proposal-1",
        version: 1,
        outcome: "blocked",
        reason: "request_rejected",
        failedDiscoveryFamilies: ["official_product"],
    });
    recoveryReview();
    fireEvent.click(
        screen.getByRole("button", {
            name: "Review coverage: Product documentation",
        }),
    );
    const dialog = await screen.findByRole("region", {
        name: "Product documentation",
    });
    fireEvent.click(
        within(dialog).getByRole("button", {
            name: "Search sources for Product documentation",
        }),
    );
    await waitFor(() =>
        expect(within(dialog).getByRole("alert").textContent).toContain(
            "The search request was rejected.",
        ),
    );
    expect(recover).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
            target: { kind: "coverage", role: "official_product_platform" },
        }),
    );
    expect(dialog.textContent).not.toMatch(
        /temporarily|HTTP|request_rejected|EXA_API_KEY/,
    );
});

test.each([
    false,
    true,
])("counts down the persisted cooldown with shared preparation expiry %s", async (sharedExpiry) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T00:00:00Z"));
    const expiresAt = Date.now() + 15_000;
    recoveryReview(
        {
            status: "blocked",
            target: { kind: "failed_discovery" },
            reason: "unavailable",
            leaseExpiresAt: expiresAt,
        },
        proposalSource,
        undefined,
        undefined,
        undefined,
        sharedExpiry ? expiresAt : undefined,
    );
    const retry = screen.getByRole("button", { name: "Retry in 15s" });
    const queryTimes = () =>
        new Set(
            convexReactHarness.module.useQuery.mock.calls
                .filter(
                    ([reference]) =>
                        getFunctionName(reference) ===
                        "sourceSelectionProposals:getCurrent",
                )
                .map(
                    ([, args]) =>
                        args !== "skip" && (args as { now?: number }).now,
                ),
        );
    expect(retry).toHaveProperty("disabled", true);
    fireEvent.click(retry);
    expect(recover).not.toHaveBeenCalled();
    await act(async () => {
        vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("button", { name: "Retry in 14s" })).toHaveProperty(
        "disabled",
        true,
    );
    expect(queryTimes().size).toBe(1);
    await act(async () => {
        vi.advanceTimersByTime(14_000);
    });
    expect(
        screen.getByRole("button", { name: "Retry searches" }),
    ).toHaveProperty("disabled", false);
    await act(async () => {
        vi.advanceTimersByTime(100);
    });
    expect(queryTimes().size).toBe(2);
});

test("preparation resumes after the later of two distinct cooldown boundaries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T00:00:00Z"));
    const retryAt = Date.now() + 90_000;
    const view = recoveryReview(
        {
            status: "blocked",
            target: { kind: "coverage", role: "official_product_platform" },
            reason: "unavailable",
            leaseExpiresAt: Date.now() + 15_000,
        },
        proposalSource,
        {
            status: "partial",
            checked: 1,
            total: 2,
            captured: 1,
            assessed: 0,
            failed: 1,
            canResume: false,
        },
        undefined,
        undefined,
        retryAt,
    );
    const queryIndex = convexReactHarness.module.useQuery.mock.calls.findIndex(
        ([reference]) =>
            getFunctionName(reference) ===
            "sourceSelectionProposals:getCurrent",
    );
    const initial =
        convexReactHarness.module.useQuery.mock.results[queryIndex]?.value;
    const blocked = {
        ...initial,
        preparationAction: {
            ...initial.preparationAction,
            available: false,
            reason: "cooldown",
        },
    };
    const available = {
        ...blocked,
        preparation: { ...blocked.preparation, canResume: true },
        preparationAction: {
            ...blocked.preparationAction,
            available: true,
            reason: undefined,
            retryAt: undefined,
        },
    };
    convexReactHarness
        .query(api.sourceSelectionProposals.getCurrent)
        .returnsFrom(({ args }) =>
            args !== "skip" && (args.now ?? 0) >= retryAt ? available : blocked,
        );
    view.rerender(
        <LiveSourceReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            onDecide={vi.fn()}
        />,
    );
    expect(
        screen.queryByRole("button", { name: "Resume preparation" }),
    ).toBeNull();
    await act(async () => {
        vi.advanceTimersByTime(16_000);
    });
    await act(async () => {
        vi.advanceTimersByTime(75_000);
    });
    expect(
        screen.getByRole("button", { name: "Resume preparation" }),
    ).toHaveProperty("disabled", false);
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

    fireEvent.click(
        screen.getByRole("button", { name: "Approve proposed corpus" }),
    );
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

test("shows an approved legacy source set without querying missing proposal items", async () => {
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
    convexReactHarness
        .query(api.sources.getReviewSource)
        .returns(inspectionPage.results[0]);
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

    await waitFor(() =>
        expect(screen.getAllByText("Annual report")).toHaveLength(2),
    );
    expect(
        screen.queryByRole("button", { name: "Approve proposed corpus" }),
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

test("retains cached readings when a preparation deadline passes offline and refreshes after reconnecting", async () => {
    vi.useFakeTimers();
    const online = vi
        .spyOn(window.navigator, "onLine", "get")
        .mockReturnValue(true);
    const deadlineAt = Date.now() + 1000;
    recoveryReview(
        undefined,
        proposalSource,
        {
            status: "started",
            checked: 1,
            total: 1,
            captured: 1,
            assessed: 1,
            canResume: false,
        },
        undefined,
        deadlineAt,
    );
    const index = convexReactHarness.module.useQuery.mock.calls.findIndex(
        ([reference]) =>
            getFunctionName(reference) ===
            "sourceSelectionProposals:getCurrent",
    );
    const initial =
        convexReactHarness.module.useQuery.mock.results[index]?.value;
    convexReactHarness
        .query(api.sourceSelectionProposals.getCurrent)
        .returnsFrom(({ args }) =>
            args !== "skip" && (args.now ?? 0) < deadlineAt
                ? initial
                : undefined,
        );
    act(() => {
        online.mockReturnValue(false);
        window.dispatchEvent(new Event("offline"));
    });
    await act(async () => {
        vi.advanceTimersByTime(1500);
    });
    expect(
        screen.getByRole("region", { name: "Selected source reading" }),
    ).toBeTruthy();
    expect(
        screen.queryByLabelText("Loading source proposal summary"),
    ).toBeNull();
    const completed = {
        ...initial,
        preparation: { ...initial.preparation, status: "complete" },
    };
    convexReactHarness
        .query(api.sourceSelectionProposals.getCurrent)
        .returnsFrom(({ args }) =>
            args !== "skip" && (args.now ?? 0) >= deadlineAt
                ? completed
                : initial,
        );
    act(() => {
        online.mockReturnValue(true);
        window.dispatchEvent(new Event("online"));
    });
    await act(async () => {
        vi.advanceTimersByTime(100);
    });
    expect(
        screen.getByText("Ready for your review", { exact: true }),
    ).toBeTruthy();
});

test("shows browser offline immediately even before an existing connection reports disconnection", () => {
    const online = vi
        .spyOn(window.navigator, "onLine", "get")
        .mockReturnValue(true);
    recoveryReview();
    act(() => {
        online.mockReturnValue(false);
        window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText("Live updates paused")).toBeTruthy();
    expect(
        (
            screen.getByRole("button", {
                name: "Approve proposed corpus",
            }) as HTMLButtonElement
        ).disabled,
    ).toBe(true);
    act(() => {
        online.mockReturnValue(true);
        window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByText("Live updates paused")).toBeNull();
    expect(
        (
            screen.getByRole("button", {
                name: "Approve proposed corpus",
            }) as HTMLButtonElement
        ).disabled,
    ).toBe(false);
});

test("explains disconnected updates while retaining readings and restores approval after reconnection", () => {
    const connected = convexReactHarness.module.useConvexConnectionState();
    convexReactHarness.module.useConvexConnectionState.mockReturnValue({
        ...connected,
        isWebSocketConnected: false,
    });
    const view = recoveryReview();
    expect(screen.getByText("Live updates paused")).toBeTruthy();
    expect(
        screen.getByRole("region", { name: "Selected source reading" }),
    ).toBeTruthy();
    expect(
        (
            screen.getByRole("button", {
                name: "Approve proposed corpus",
            }) as HTMLButtonElement
        ).disabled,
    ).toBe(true);
    convexReactHarness.module.useConvexConnectionState.mockReturnValue(
        connected,
    );
    view.rerender(
        <LiveSourceReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            onDecide={vi.fn()}
        />,
    );
    expect(screen.queryByText("Live updates paused")).toBeNull();
    expect(
        (
            screen.getByRole("button", {
                name: "Approve proposed corpus",
            }) as HTMLButtonElement
        ).disabled,
    ).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
    expect(recompute).not.toHaveBeenCalled();
});

test("failed continuation of a saved source remains visible beside its preparation state", async () => {
    prepare.mockRejectedValue(
        new Error("execution_slot_unavailable internal details"),
    );
    recoveryReview(undefined, proposalSource, {
        status: "blocked",
        checked: 0,
        total: 1,
        canResume: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Resume preparation" }));
    expect(
        await screen.findByText(
            "Source reading could not be started. Review the current status and try again when available.",
        ),
    ).toBeTruthy();
    expect(screen.getByText("Source link saved")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(
        /execution_slot_unavailable|internal details/,
    );
});

test("interrupted preparation explains retained progress as an error without blaming source quality", () => {
    recoveryReview(undefined, proposalSource, {
        status: "blocked",
        checked: 2,
        total: 48,
        captured: 2,
        assessed: 0,
        remaining: 46,
        failed: 2,
        stopCode: "missing_configuration",
        canResume: false,
    });
    const alert = screen.getByRole("alert", {
        name: "Source preparation interrupted",
    });
    expect(alert.textContent).toContain("2 saved without assessment");
    expect(alert.textContent).toContain("No sources assessed yet");
    expect(alert.textContent).toContain("46 sources still to prepare");
    expect(alert.textContent).not.toMatch(
        /stronger reference|missing_configuration|OPENROUTER/,
    );
});

test("an expired previous window does not remove explicit recovery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T00:00:00Z"));
    recoveryReview(
        undefined,
        proposalSource,
        {
            status: "partial",
            checked: 1,
            total: 2,
            canResume: true,
        },
        undefined,
        Date.now() + 5000,
    );
    const resume = screen.getByRole("button", {
        name: "Resume preparation",
    });
    expect(resume).toHaveProperty("disabled", false);
    await act(async () => {
        vi.advanceTimersByTime(5100);
    });
    expect(
        screen.getByRole("button", { name: "Resume preparation" }),
    ).toHaveProperty("disabled", false);
    await act(async () => {
        fireEvent.click(resume);
    });
    expect(prepare).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toMatch(
        /start a new dossier|deadline_elapsed/,
    );
});

test("an unconfirmed preparation request reuses its identity when the analyst retries", async () => {
    prepare.mockRejectedValueOnce(new Error("Response lost"));
    recoveryReview(undefined, proposalSource, {
        status: "partial",
        checked: 1,
        total: 2,
        canResume: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Resume preparation" }));
    await screen.findByText(
        "Source reading could not be started. Review the current status and try again when available.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Resume preparation" }));
    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    expect(prepare.mock.calls[1]?.[0]).toEqual(prepare.mock.calls[0]?.[0]);
});

test("refreshes the server projection when a running preparation reaches its deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T00:00:00Z"));
    const deadlineAt = Date.now() + 5000;
    const view = recoveryReview(
        undefined,
        proposalSource,
        {
            status: "started",
            checked: 0,
            total: 2,
            canResume: false,
        },
        undefined,
        deadlineAt,
    );
    const queryIndex = convexReactHarness.module.useQuery.mock.calls.findIndex(
        ([reference]) =>
            getFunctionName(reference) ===
            "sourceSelectionProposals:getCurrent",
    );
    const snapshot =
        convexReactHarness.module.useQuery.mock.results[queryIndex]?.value;
    const recovered = {
        ...snapshot,
        preparation: {
            ...snapshot.preparation,
            status: "partial",
            canResume: true,
        },
    };
    convexReactHarness
        .query(api.sourceSelectionProposals.getCurrent)
        .returnsFrom(({ args }) =>
            args !== "skip" && (args.now ?? 0) >= deadlineAt
                ? recovered
                : snapshot,
        );
    view.rerender(
        <LiveSourceReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            onDecide={vi.fn()}
        />,
    );
    await act(async () => {
        vi.advanceTimersByTime(5100);
    });
    expect(
        screen.getByRole("button", { name: "Resume preparation" }),
    ).toHaveProperty("disabled", false);
});

test("interrupted comparisons remain visible after source reading succeeds", () => {
    recoveryReview(undefined, proposalSource, {
        status: "partial",
        checked: 2,
        total: 2,
        captured: 2,
        assessed: 2,
        pendingComparisons: 1,
        canResume: true,
    });
    expect(screen.getByText("Ready for review with limitations")).toBeTruthy();
    expect(screen.getByText("1 source comparison needs review")).toBeTruthy();
    expect(
        screen.getByText(
            /Review the saved readings and limitations before approving/,
        ),
    ).toBeTruthy();
    expect(
        screen.getByRole("button", { name: "Resume preparation" }),
    ).toHaveProperty("disabled", false);
    expect(document.body.textContent).not.toMatch(
        /provider_unavailable|source_comparison|executionGeneration/,
    );
});

test("keeps the current reader and focus while status reloads and blocks approval until fresh data returns", () => {
    const view = recoveryReview();
    const reader = screen.getByRole("region", {
        name: "Selected source reading",
    });
    const card = screen.getByRole("button", { name: /^Open .* for review$/ });
    card.focus();
    convexReactHarness
        .query(api.sourceSelectionProposals.getCurrent)
        .returns(undefined);
    view.rerender(
        <LiveSourceReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            onDecide={vi.fn()}
        />,
    );
    expect(
        screen.getByRole("region", { name: "Selected source reading" }),
    ).toBe(reader);
    expect(document.activeElement).toBe(card);
    expect(
        screen.getByText(
            "Updating source status. Your current review remains available.",
        ),
    ).toBeTruthy();
    expect(
        screen.getByRole("button", { name: "Approve proposed corpus" }),
    ).toHaveProperty("disabled", true);
    convexReactHarness
        .query(api.sourceSelectionProposals.getCurrent)
        .returns(view.proposalSnapshot);
    view.rerender(
        <LiveSourceReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            onDecide={vi.fn()}
        />,
    );
    expect(
        screen.getByRole("region", { name: "Selected source reading" }),
    ).toBe(reader);
    expect(document.activeElement).toBe(card);
    expect(
        screen.queryByText(
            "Updating source status. Your current review remains available.",
        ),
    ).toBeNull();
    expect(
        screen.getByRole("button", { name: "Approve proposed corpus" }),
    ).toHaveProperty("disabled", false);
});

test("does not retain source readings across a dossier or corpus revision change", () => {
    const view = recoveryReview();
    convexReactHarness
        .query(api.sourceSelectionProposals.getCurrent)
        .returns(undefined);
    view.rerender(
        <LiveSourceReview
            runId={"run-other" as never}
            corpusRevisionId={"revision-other" as never}
            onDecide={vi.fn()}
        />,
    );
    expect(
        screen.queryByRole("region", { name: "Selected source reading" }),
    ).toBeNull();
    expect(
        screen.getByRole("region", { name: "Loading source proposal summary" }),
    ).toBeTruthy();
});
