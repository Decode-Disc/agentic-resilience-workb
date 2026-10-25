import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const { responsive } = vi.hoisted(() => ({
    responsive: {
        isMobile: false,
        isTabletOrBelow: false,
        isDesktop: true,
    },
}));

vi.mock("convex/react", async () => {
    const { convexReactHarness } = await import(
        "@/__tests__/helpers/convex-react-harness"
    );
    return convexReactHarness.module;
});

vi.mock("@/hooks/use-responsive", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/hooks/use-responsive")>()),
    useResponsive: () => responsive,
}));

import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";
import { EvidenceMatrix } from "@/components/workspace/evidence-matrix";

type ClaimDetail = FunctionReturnType<typeof api.evidenceMatrix.getClaimDetail>;

const readySummary = {
    runId: "run-1",
    corpusRevisionId: "revision-1",
    lifecycleState: "evidence_ready",
    executionGeneration: 1,
    executionStatus: "running",
    pauseReason: undefined,
    questionCoverage: {
        total: 3,
        covered: 2,
        buckets: [],
    },
    frozenSources: { accepted: 4, processed: 4, partial: 0, failed: 0 },
    claimCount: 4,
    executionMode: "showcase",
    isShowcase: true,
};

interface ClaimItem {
    claimId: string;
    statement: string;
    canonicalText: string;
    classification: "Fact" | "Inference" | "Hypothesis" | "Unknown";
    researchPlanQuestionId: string | undefined;
    questionKey: string | undefined;
    policy: "pass" | "needs_review" | "blocked" | undefined;
    dimensions: Array<string>;
    hasCounterEvidence: boolean;
    processing: "complete" | "partial" | "failed" | "in_progress";
}

const claimFact: ClaimItem = {
    claimId: "claim-fact",
    statement:
        "CCC connects approximately 30,000 repair facilities and carriers.",
    canonicalText: "30,000 repair facilities",
    classification: "Fact",
    researchPlanQuestionId: "question-1",
    questionKey: undefined,
    policy: "pass",
    dimensions: ["workflow_control"],
    hasCounterEvidence: false,
    processing: "complete",
};

const claimInference: ClaimItem = {
    claimId: "claim-inference",
    statement: "Deep carrier integration implies elevated switching costs.",
    canonicalText: "carrier integration",
    classification: "Inference",
    researchPlanQuestionId: "question-2",
    questionKey: undefined,
    policy: "needs_review",
    dimensions: ["switching_costs"],
    hasCounterEvidence: false,
    processing: "complete",
};

const claimHypothesis: ClaimItem = {
    claimId: "claim-hypothesis",
    statement:
        "Emerging OEM telematics may pressure traditional repair routing.",
    canonicalText: "repair routing",
    classification: "Hypothesis",
    researchPlanQuestionId: "question-3",
    questionKey: undefined,
    policy: "blocked",
    dimensions: ["abstraction_exposure"],
    hasCounterEvidence: true,
    processing: "partial",
};

const claimUnknown: ClaimItem = {
    claimId: "claim-unknown",
    statement: "Adoption velocity of foundation models remains undetermined.",
    canonicalText: "foundation models",
    classification: "Unknown",
    researchPlanQuestionId: "question-4",
    questionKey: "dimension:model_platform_dependency",
    policy: undefined,
    dimensions: ["model_platform_dependency"],
    hasCounterEvidence: false,
    processing: "complete",
};

const allClaims: ClaimItem[] = [
    claimFact,
    claimInference,
    claimHypothesis,
    claimUnknown,
];

function detailBy(item: ClaimItem): ClaimDetail {
    const isUnknown = item.claimId === "claim-unknown";
    const evidence = isUnknown
        ? [
              {
                  relation: "context",
                  sourcePassageId: "passage-unknown",
                  passageKey: "key_3",
                  exactQuotation: "The industry continues to monitor this.",
                  locator: {
                      kind: "web",
                      canonicalUrl: "https://example.com/transcript",
                      sourceVersionHash: "hash-3",
                      exactQuotation: "The industry continues to monitor this.",
                  },
                  contextBefore: "",
                  contextAfter: "",
                  order: 0,
                  sourceVersion: {
                      sourceVersionId: "version-3",
                      contentHash: "hash-3",
                      mediaType: "text/html",
                      byteCount: 900,
                      retrievalVersion: "v1",
                  },
                  source: {
                      sourceId: "source-3",
                      canonicalUrl: "https://example.com/transcript",
                      title: "Industry transcript",
                      origin: "analyst_url",
                      category: "earnings_transcript",
                  },
                  accepted: {
                      acceptedDecisionId: "decision-3",
                      occurredAt: 3,
                  },
              },
          ]
        : [
              {
                  relation: "supporting",
                  sourcePassageId: "passage-1-1",
                  exactQuotation:
                      "Our platform connects participants across the property and casualty economy.",
                  locator: {
                      kind: "pdf",
                      canonicalUrl: "https://example.com/report.pdf",
                      sourceVersionHash: "hash-1",
                      pageNumber: 8,
                      exactQuotation:
                          "Our platform connects participants across the property and casualty economy.",
                  },
                  contextBefore: "Introduction. ",
                  contextAfter: " This supports daily workflows.",
                  order: 0,
                  sourceVersion: {
                      sourceVersionId: "version-1",
                      contentHash: "hash-1",
                      mediaType: "application/pdf",
                      byteCount: 1200,
                      retrievalVersion: "v1",
                  },
                  source: {
                      sourceId: "source-1",
                      canonicalUrl: "https://example.com/report.pdf",
                      title: "Annual report",
                      origin: "sec",
                      category: "regulatory_annual",
                  },
                  accepted: {
                      acceptedDecisionId: "decision-1",
                      occurredAt: 1,
                  },
              },
              ...(item.hasCounterEvidence
                  ? [
                        {
                            relation: "counter",
                            sourcePassageId: "passage-2",
                            exactQuotation:
                                "Adopters may route around the incumbent network.",
                            locator: {
                                kind: "web",
                                canonicalUrl: "https://example.com/analysis",
                                sourceVersionHash: "hash-2",
                                exactQuotation:
                                    "Adopters may route around the incumbent network.",
                            },
                            contextBefore: "",
                            contextAfter: "",
                            order: 1,
                            sourceVersion: {
                                sourceVersionId: "version-2",
                                contentHash: "hash-2",
                                mediaType: "text/html",
                                byteCount: 1100,
                                retrievalVersion: "v1",
                            },
                            source: {
                                sourceId: "source-2",
                                canonicalUrl: "https://example.com/analysis",
                                title: "Independent analysis",
                                origin: "exa",
                                category: "independent_analysis",
                            },
                            accepted: {
                                acceptedDecisionId: "decision-2",
                                occurredAt: 2,
                            },
                        },
                    ]
                  : []),
          ];
    return {
        claim: {
            claimId: item.claimId as never,
            statement: item.statement,
            canonicalText: item.canonicalText,
            classification: item.classification,
            researchPlanQuestionId: item.researchPlanQuestionId as never,
            questionKey: item.questionKey,
            proposingTaskId: "task-1" as never,
        },
        policy: item.policy
            ? { policyVersion: "v1", result: item.policy, reasonCodes: [] }
            : undefined,
        dimensions: item.dimensions.map((dimensionKey) => ({
            dimensionKey: dimensionKey as never,
            origin: "generated" as const,
            rationale: "Public company filings describe this directly.",
        })) as ClaimDetail["dimensions"],
        evidence: evidence as ClaimDetail["evidence"],
    };
}

const detailMap = new Map<string, ClaimDetail | undefined>();
function populateDetailMap() {
    for (const item of allClaims) {
        detailMap.set(item.claimId, detailBy(item));
    }
}

function renderReady() {
    render(<EvidenceMatrix runId={"run-1" as never} />);
}

beforeEach(() => {
    convexReactHarness.reset();
    responsive.isMobile = false;
    responsive.isTabletOrBelow = false;
    responsive.isDesktop = true;
    convexReactHarness
        .query(api.evidenceMatrix.getSummary)
        .returns(readySummary);
    convexReactHarness.paginatedQuery(api.evidenceMatrix.listClaims).returns({
        results: allClaims,
        status: "Exhausted",
        loadMore: vi.fn(),
    } as never);
    convexReactHarness
        .query(api.evidenceMatrix.getClaimDetail)
        .returnsFrom(({ args }) =>
            args === "skip" ? undefined : detailMap.get(args.claimId),
        );
    detailMap.clear();
    populateDetailMap();
});

test("keeps evidence matrix geometry while queries load", () => {
    const loadingPage = {
        results: [],
        status: "LoadingFirstPage",
        loadMore: vi.fn(),
    };
    convexReactHarness.query(api.evidenceMatrix.getSummary).returns(undefined);
    convexReactHarness
        .paginatedQuery(api.evidenceMatrix.listClaims)
        .returns(loadingPage);
    convexReactHarness
        .query(api.evidenceMatrix.getClaimDetail)
        .returns(undefined);

    render(<EvidenceMatrix runId={"run-1" as never} />);

    expect(screen.getByLabelText("Loading evidence matrix")).toBeTruthy();
    expect(screen.getByLabelText("Loading evidence coverage")).toBeTruthy();
    expect(screen.getByLabelText("Loading evidence claims")).toBeTruthy();
    expect(screen.getByLabelText("Loading claim detail")).toBeTruthy();
});

test("retries evidence queries after a load failure", () => {
    const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
    const summaryQuery = convexReactHarness.query(
        api.evidenceMatrix.getSummary,
    );
    summaryQuery.throws(new Error("Evidence query failed"));

    render(<EvidenceMatrix runId={"run-1" as never} />);

    expect(screen.getByText("Evidence could not be loaded")).toBeTruthy();
    convexReactHarness.paginatedQuery(api.evidenceMatrix.listClaims).returns({
        results: [claimFact],
        status: "Loaded",
        loadMore: vi.fn(),
    });
    convexReactHarness
        .query(api.evidenceMatrix.getClaimDetail)
        .returns(detailBy(claimFact));
    convexReactHarness
        .query(api.evidenceMatrix.getSummary)
        .returns(readySummary);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Evidence is ready for review")).toBeTruthy();
    consoleError.mockRestore();
});

test("shows a true empty state after extraction completes without claims", () => {
    convexReactHarness
        .query(api.evidenceMatrix.getSummary)
        .returns({ ...readySummary, claimCount: 0 });
    convexReactHarness
        .paginatedQuery(api.evidenceMatrix.listClaims)
        .returns({ results: [], status: "Loaded", loadMore: vi.fn() });
    convexReactHarness
        .query(api.evidenceMatrix.getClaimDetail)
        .returns(undefined);

    render(<EvidenceMatrix runId={"run-1" as never} />);

    expect(screen.getByText("No evidence claims")).toBeTruthy();
    expect(
        screen.getByText(/Extraction completed without a usable claim/i),
    ).toBeTruthy();
    expect(
        screen.queryByText(
            /claim_generation_unavailable|EXA_API_KEY|request id/i,
        ),
    ).toBeNull();
});

test("shows an analyst-safe unavailable banner without raw pause copy", () => {
    const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
    convexReactHarness.query(api.evidenceMatrix.getSummary).returns({
        ...readySummary,
        lifecycleState: "extracting_evidence",
        executionStatus: "paused",
        executionMode: "unavailable",
        isShowcase: false,
        claimCount: 0,
    });
    convexReactHarness
        .paginatedQuery(api.evidenceMatrix.listClaims)
        .returns({ results: [], status: "Loaded", loadMore: vi.fn() });
    convexReactHarness
        .query(api.evidenceMatrix.getClaimDetail)
        .returns(undefined);

    render(<EvidenceMatrix runId={"run-1" as never} />);

    expect(
        screen.getByText("Evidence is temporarily unavailable"),
    ).toBeTruthy();
    expect(
        screen.getByText(
            /claim generation is not available for this dossier yet/i,
        ),
    ).toBeTruthy();
    expect(screen.queryByText(/claim_generation_unavailable/i)).toBeNull();
    expect(
        screen.queryByText(
            /EXA_API_KEY|request id|workflow|engine|deployment/i,
        ),
    ).toBeNull();
    consoleError.mockRestore();
});

test("declares showcase evidence and shows partial source retrieval limits", () => {
    convexReactHarness.query(api.evidenceMatrix.getSummary).returns({
        ...readySummary,
        frozenSources: {
            accepted: 4,
            processed: 2,
            partial: 1,
            failed: 1,
        },
    });
    convexReactHarness.paginatedQuery(api.evidenceMatrix.listClaims).returns({
        results: [claimHypothesis],
        status: "Loaded",
        loadMore: vi.fn(),
    });
    convexReactHarness
        .query(api.evidenceMatrix.getClaimDetail)
        .returnsFrom(({ args }) =>
            args === "skip" ? undefined : detailBy(claimHypothesis),
        );

    render(<EvidenceMatrix runId={"run-1" as never} />);

    expect(screen.getByText("Showcase evidence")).toBeTruthy();
    expect(
        screen.getByText(/Some sources could not be fully retrieved/i),
    ).toBeTruthy();
    expect(
        screen.getByText(/1 source returned partial evidence/i),
    ).toBeTruthy();
    expect(screen.getByText(/1 source could not be retrieved/i)).toBeTruthy();
});

test("renders all four classifications with counter evidence and Unknown limits", async () => {
    renderReady();

    for (const label of ["Fact", "Inference", "Hypothesis", "Unknown"]) {
        expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }

    fireEvent.click(
        screen.getByRole("button", {
            name: /Open Hypothesis claim: Emerging/i,
        }),
    );
    expect(screen.getByText("Counters this claim")).toBeTruthy();
    expect(screen.getByText(/Counter-evidence is visible/i)).toBeTruthy();
    expect(screen.getByText(/Partial evidence/i)).toBeTruthy();

    fireEvent.click(
        screen.getByRole("button", { name: /Open Unknown claim: Adoption/i }),
    );
    await waitFor(() =>
        expect(
            screen.getByText(/does not resolve the underlying question/i),
        ).toBeTruthy(),
    );
});

test("filters claims by classification through the paginated query args", async () => {
    render(<EvidenceMatrix runId={"run-1" as never} />);
    fireEvent.click(screen.getByRole("button", { name: "Fact" }));
    await waitFor(() =>
        expect(
            convexReactHarness.module.usePaginatedQuery,
        ).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                runId: "run-1",
                filters: { classification: "Fact" },
            }),
            { initialNumItems: expect.any(Number) },
        ),
    );
});

test("shows a non-terminal sparse notice while more raw pages may match", () => {
    convexReactHarness.query(api.evidenceMatrix.getSummary).returns({
        ...readySummary,
        claimCount: 1,
    });
    const loadMore = vi.fn();
    convexReactHarness.paginatedQuery(api.evidenceMatrix.listClaims).returns({
        results: [],
        status: "CanLoadMore",
        loadMore,
    } as never);

    render(<EvidenceMatrix runId={"run-1" as never} />);
    fireEvent.click(screen.getByRole("button", { name: "Fact" }));

    // The filtered first raw page holds no match, but later pages may: the
    // copy must never claim terminal emptiness, and Load more stays visible.
    expect(screen.queryByText("No evidence claims")).toBeNull();
    expect(screen.getByText(/More claims may match this filter/i)).toBeTruthy();
    expect(screen.queryByText("Extraction completed")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Load more claims/i }));
    expect(loadMore).toHaveBeenCalledTimes(1);
});

test("accepts the filtered sparse page through query args without a terminal state", async () => {
    convexReactHarness.query(api.evidenceMatrix.getSummary).returns({
        ...readySummary,
        claimCount: 1,
    });
    const loadMore = vi.fn();
    convexReactHarness.paginatedQuery(api.evidenceMatrix.listClaims).returns({
        results: [],
        status: "CanLoadMore",
        loadMore,
    } as never);

    render(<EvidenceMatrix runId={"run-1" as never} />);
    fireEvent.click(screen.getByRole("button", { name: "Fact" }));
    await waitFor(() =>
        expect(
            convexReactHarness.module.usePaginatedQuery,
        ).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                filters: { classification: "Fact" },
            }),
            { initialNumItems: expect.any(Number) },
        ),
    );
    expect(screen.queryByText("No evidence claims")).toBeNull();
    expect(screen.getByText(/More claims may match this filter/i)).toBeTruthy();
});

test("separates claim list and detail on desktop with resizable panels", () => {
    const { container } = render(<EvidenceMatrix runId={"run-1" as never} />);

    expect(
        container.querySelector('[data-slot="resizable-panel-group"]'),
    ).not.toBeNull();
    expect(screen.getAllByRole("separator").length).toBeGreaterThan(0);
    // The first claim is auto-selected into the detail panel.
    expect(screen.getAllByText(claimFact.statement).length).toBeGreaterThan(1);
});

test("opens claim detail in a drawer on tablet and mobile", () => {
    responsive.isTabletOrBelow = true;
    responsive.isDesktop = false;

    render(<EvidenceMatrix runId={"run-1" as never} />);
    fireEvent.click(screen.getByRole("button", { name: /Open Fact claim:/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Claim detail")).toBeTruthy();

    responsive.isTabletOrBelow = false;
    responsive.isDesktop = true;
});

test("shows an exact quote and a reproducible locator for a cited passage", async () => {
    renderReady();
    await waitFor(() =>
        expect(
            screen.getByText(
                /Our platform connects participants across the property/i,
            ),
        ).toBeTruthy(),
    );
    expect(screen.getByText(/PDF page 8/i)).toBeTruthy();
});

test("queries with owner scoping and never renders decision controls", async () => {
    renderReady();

    expect(convexReactHarness.module.useQuery).toHaveBeenCalledWith(
        expect.anything(),
        { runId: "run-1" },
    );
    await waitFor(() =>
        expect(
            convexReactHarness.module.usePaginatedQuery,
        ).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ runId: "run-1" }),
            { initialNumItems: expect.any(Number) },
        ),
    );
    await waitFor(() =>
        expect(convexReactHarness.module.useQuery).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ runId: "run-1", claimId: "claim-fact" }),
        ),
    );

    expect(
        screen.queryByRole("button", {
            name: /approve|reject|edit/i,
        }),
    ).toBeNull();
    expect(
        screen.queryByText(
            /claim_generation_unavailable|EXA_API_KEY|request id/i,
        ),
    ).toBeNull();
});

test("keeps claim rows keyboard selectable with visible focus", () => {
    renderReady();

    const row = screen.getByRole("button", { name: /Open Fact claim:/i });
    expect(row).toBeTruthy();
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(row.className).toContain("focus-visible:ring-2");
});
