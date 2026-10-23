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
) {
    convexReactHarness.query(api.sourceSelectionProposals.getCurrent).returns({
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
            kind: preparation ? "resume" : "start",
            available: true,
        },
    });
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
    return render(
        <LiveSourceReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            onDecide={vi.fn()}
        />,
    );
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

test("counts down the persisted cooldown and enables retry only after it expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T00:00:00Z"));
    recoveryReview({
        status: "blocked",
        target: { kind: "failed_discovery" },
        reason: "unavailable",
        leaseExpiresAt: Date.now() + 15_000,
    });
    const retry = screen.getByRole("button", { name: "Retry in 15s" });
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
    await act(async () => {
        vi.advanceTimersByTime(14_000);
    });
    expect(
        screen.getByRole("button", { name: "Retry searches" }),
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
    fireEvent.click(
        screen.getByRole("button", { name: "Continue source preparation" }),
    );
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
    expect(alert.textContent).toContain("2 of 48 source contents saved");
    expect(alert.textContent).toContain("0 assessed");
    expect(alert.textContent).toContain("46 not yet processed");
    expect(alert.textContent).not.toMatch(
        /stronger reference|missing_configuration|OPENROUTER/,
    );
});

test("expires source preparation without a new subscription snapshot", async () => {
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
        name: "Continue source preparation",
    });
    expect(resume).toHaveProperty("disabled", false);
    await act(async () => {
        vi.advanceTimersByTime(5100);
    });
    expect(
        screen.queryByRole("button", { name: "Continue source preparation" }),
    ).toBeNull();
    expect(screen.getByText(/The preparation window has ended/)).toBeTruthy();
    expect(prepare).not.toHaveBeenCalled();
});
