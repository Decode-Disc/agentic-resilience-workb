import {
    fireEvent,
    render,
    screen,
    waitFor,
    waitForElementToBeRemoved,
    within,
} from "@testing-library/react";
import { useState } from "react";
import { toast } from "sonner";
import { expect, test, vi } from "vitest";

vi.mock("@/hooks/use-source-preview", () => ({
    useSourcePreview: () => ({ status: "idle" }),
}));

import {
    SourceAdjustmentActions,
    sourceDecisionForKanbanMove,
} from "@/components/workspace/source-proposal-adjustment-board";
import { SourceProposalReview } from "@/components/workspace/source-proposal-review";

test("keeps keyboard focus on the selected group while resetting its source search", () => {
    const props = overviewProps();
    function ControlledReview() {
        const [disposition, setDisposition] = useState(props.disposition);
        return (
            <SourceProposalReview
                {...props}
                disposition={disposition}
                onDispositionChange={setDisposition}
            />
        );
    }
    render(<ControlledReview />);
    const search = screen.getByRole("searchbox", {
        name: "Search sources in this group",
    }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "Annual report" } });
    const recommendedTab = screen.getByRole("tab", { name: /Recommended/ });
    recommendedTab.focus();
    fireEvent.keyDown(recommendedTab, { key: "ArrowRight" });
    const attentionTab = screen.getByRole("tab", { name: /Needs attention/ });
    expect(document.activeElement).toBe(attentionTab);
    expect(
        (
            screen.getByRole("searchbox", {
                name: "Search sources in this group",
            }) as HTMLInputElement
        ).value,
    ).toBe("");
    fireEvent.keyDown(attentionTab, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(
        screen.getByRole("tab", { name: /Recommended/ }),
    );
    expect(
        (
            screen.getByRole("searchbox", {
                name: "Search sources in this group",
            }) as HTMLInputElement
        ).value,
    ).toBe("");
});

const recommended = {
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

const alternative = {
    ...recommended,
    sourceId: "source-alternative",
    canonicalUrl: "https://example.com/analysis",
    title: "Independent analysis",
    origin: "exa",
    category: "independent_analysis",
    disposition: "alternative",
    sourceFamily: "independent_analysis",
    rank: 1,
    reasonCodes: ["not_selected"],
    included: false,
} as const;

const metadataLinked = {
    ...alternative,
    sourceId: "source-metadata-linked",
    canonicalUrl:
        "https://www.morningstar.com/stocks/deeply-undervalued-stock-long-term-investors-who-can-handle-uncertainty",
    title: "ServiceNow downside analysis",
    disposition: "recommended",
    companyLinkageBasis: "discovery_metadata",
    declaredCoverageRoles: [
        "counter_evidence_primary",
        "counter_evidence_secondary",
        "independent_analysis_primary",
        "independent_analysis_secondary",
    ],
    eligibleCoverageRoles: [],
    coverageContributions: [
        "company_linkage:discovery_metadata:morningstar.com:uncertainty",
    ],
    reasonCodes: ["additional_coverage"],
    included: true,
} as const;

const summary = {
    proposalId: "proposal-1",
    version: 1,
    status: "ready",
    effectiveStatus: "ready",
    recommendedTarget: 12,
    recommendationCeiling: 24,
    counts: { recommended: 1, needsAttention: 0, alternative: 1 },
    gaps: ["counter_evidence"],
    coverageGaps: ["counter_evidence_primary"],
    coverageRequirements: [
        {
            role: "counter_evidence_primary",
            covered: false,
            availability: "not_established",
            candidateIds: [alternative.sourceId],
            includedSourceIds: [],
        },
    ],
    effectiveIncludedCount: 1,
    revisionStatus: "draft",
} as const;

const inspectionReview = {
    revision: 1,
    status: "draft",
    counts: { accepted: 0, rejected: 0, pending: 2 },
    total: 2,
    candidateLimit: 48,
    sources: [recommended, alternative].map((source) => ({
        sourceId: source.sourceId,
        canonicalUrl: source.canonicalUrl,
        title: source.title,
        origin: source.origin,
        category: source.category,
        publishedAt: source.publishedAt,
        decision: source.decision,
        reason: undefined,
    })),
} as const;

test("presents coverage beside a carousel and an inline source reader", () => {
    render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={
                {
                    ...summary,
                    coverageRequirements: [
                        {
                            role: "regulatory_annual",
                            covered: true,
                            availability: "available",
                            candidateIds: [recommended.sourceId],
                            includedSourceIds: [recommended.sourceId],
                        },
                    ],
                } as never
            }
            disposition="recommended"
            onDispositionChange={vi.fn()}
            adjustmentSets={
                { included: [recommended], available: [alternative] } as never
            }
            inspectionReview={inspectionReview as never}
            onDecide={vi.fn()}
            onApprove={vi.fn()}
            onRecompute={vi.fn()}
        />,
    );
    expect(
        screen.getByRole("complementary", { name: "Source coverage" }),
    ).toBeTruthy();
    expect(
        screen.getByRole("region", { name: "Source carousel" }),
    ).toBeTruthy();
    const reader = screen.getByRole("region", {
        name: "Selected source reading",
    });
    expect(
        within(reader).getByRole("heading", { name: "Annual report" }),
    ).toBeTruthy();
    expect(
        within(reader)
            .getByRole("tab", { name: "Source details" })
            .getAttribute("aria-selected"),
    ).toBe("true");
});

test("keeps a reading skeleton until the selected source query resolves", () => {
    render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={summary as never}
            disposition="recommended"
            onDispositionChange={vi.fn()}
            adjustmentSets={
                { included: [recommended], available: [alternative] } as never
            }
            inspectionReview={inspectionReview as never}
            onDecide={vi.fn()}
            onApprove={vi.fn()}
            onRecompute={vi.fn()}
            inspectionSelectedId={null}
            inspectionSelectedSource={undefined}
            onInspectionSelectedIdChange={vi.fn()}
        />,
    );
    expect(
        screen.getByRole("status", { name: "Loading source reading" }),
    ).toBeTruthy();
    expect(screen.queryByText("Reading not prepared")).toBeNull();
});

test("offers a contextual search on a prepared proposal using its remaining allowance", () => {
    const recover = vi.fn();
    render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={
                {
                    ...summary,
                    preparation: {
                        status: "complete",
                        checked: 2,
                        total: 2,
                        canResume: false,
                    },
                    searchAllowance: {
                        enabled: true,
                        remainingSearches: 1,
                        remainingCandidates: 4,
                        deadlineAt: Date.now() + 30_000,
                    },
                    coverageRequirements: [
                        {
                            role: "official_commercial_terms",
                            covered: false,
                            availability: "not_established",
                            candidateIds: [alternative.sourceId],
                            includedSourceIds: [],
                        },
                    ],
                } as never
            }
            disposition="recommended"
            onDispositionChange={vi.fn()}
            adjustmentSets={
                { included: [recommended], available: [alternative] } as never
            }
            inspectionReview={inspectionReview as never}
            onDecide={vi.fn()}
            onApprove={vi.fn()}
            onRecompute={vi.fn()}
            onRecoverDiscovery={recover}
        />,
    );
    fireEvent.click(
        screen.getByRole("button", {
            name: "Review coverage: Subscription & service terms",
        }),
    );
    fireEvent.click(
        screen.getByRole("button", {
            name: "Search sources for Subscription & service terms",
        }),
    );
    expect(recover).toHaveBeenCalledWith({
        kind: "coverage",
        role: "official_commercial_terms",
    });
});

test("retains the selected source reading when inspecting candidates for a coverage need", async () => {
    const source = {
        ...inspectionReview.sources[0],
        inspectionStatus: "partial",
        qualificationStatus: "available",
        roleAvailability: [
            {
                role: "regulatory_annual",
                state: "limited",
                reasonCodes: [],
                usage: "historical_only",
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
                    kind: "asserted_fact",
                    findingKey: "historical-disclosure-0",
                    usage: "historical_only",
                    summary: "Historical disclosure",
                    passages: [
                        {
                            passageKey: "p0",
                            quotation:
                                "The company described this workflow in its historical annual report.",
                        },
                    ],
                    period: "historical",
                    periodPassages: [],
                    dependsOnFlaggedAssertion: false,
                },
            ],
        },
    };
    render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={
                {
                    ...summary,
                    coverageRequirements: [
                        {
                            role: "regulatory_annual",
                            covered: false,
                            availability: "limited",
                            candidateIds: [recommended.sourceId],
                        },
                    ],
                } as never
            }
            sourceReviewNavigation={{
                view: "inspect",
                coverage: "regulatory_annual",
            }}
            disposition="recommended"
            onDispositionChange={vi.fn()}
            adjustmentSets={
                { included: [recommended], available: [alternative] } as never
            }
            inspectionReview={inspectionReview as never}
            inspectionSelectedId={recommended.sourceId as never}
            inspectionSelectedSource={source as never}
            onDecide={vi.fn()}
            onApprove={vi.fn()}
            onRecompute={vi.fn()}
        />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Source details" }));
    expect(
        await screen.findByText(
            "The company described this workflow in its historical annual report.",
        ),
    ).toBeTruthy();
});

test("shows persisted preparation progress and blocks grouped approval while source reading continues", () => {
    render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={
                {
                    ...summary,
                    preparation: { status: "started", checked: 1, total: 2 },
                } as never
            }
            disposition="recommended"
            onDispositionChange={vi.fn()}
            adjustmentSets={
                { included: [recommended], available: [alternative] } as never
            }
            inspectionReview={inspectionReview as never}
            onDecide={vi.fn()}
            onApprove={vi.fn()}
            onRecompute={vi.fn()}
        />,
    );
    expect(screen.getByText("Preparing source selection")).toBeTruthy();
    expect(screen.getByText("1 of 2 candidates checked.")).toBeTruthy();
    expect(
        (
            screen.getByRole("button", {
                name: "Approve proposed corpus",
            }) as HTMLButtonElement
        ).disabled,
    ).toBe(true);
    expect(screen.queryByText(/source content has not been read/i)).toBeNull();
});

test("describes a prepared selection without the legacy claim that its content was not read", () => {
    render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={
                {
                    ...summary,
                    preparation: { status: "partial", checked: 1, total: 2 },
                } as never
            }
            disposition="recommended"
            onDispositionChange={vi.fn()}
            adjustmentSets={
                { included: [recommended], available: [alternative] } as never
            }
            inspectionReview={inspectionReview as never}
            onDecide={vi.fn()}
            onApprove={vi.fn()}
            onRecompute={vi.fn()}
        />,
    );
    expect(
        screen.getByText("Source selection ready with limitations"),
    ).toBeTruthy();
    expect(screen.queryByText(/source content has not been read/i)).toBeNull();
    expect(
        (
            screen.getByRole("button", {
                name: "Approve proposed corpus",
            }) as HTMLButtonElement
        ).disabled,
    ).toBe(false);
});

test("presents a summary-first proposal with only the three proposal tabs", () => {
    render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={summary as never}
            disposition="recommended"
            onDispositionChange={vi.fn()}
            adjustmentSets={
                {
                    included: [recommended],
                    available: [alternative],
                } as never
            }
            inspectionReview={inspectionReview as never}
            onDecide={vi.fn()}
            onApprove={vi.fn()}
            onRecompute={vi.fn()}
        />,
    );

    expect(screen.getByText(/1 source included/i)).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Recommended.*1/i })).toBeTruthy();
    expect(
        screen.getByRole("tab", { name: /Needs attention.*0/i }),
    ).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Alternatives.*1/i })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Accepted/i })).toBeNull();
    expect(
        screen.getByRole("button", { name: "Adjust proposal" }),
    ).toBeTruthy();
    expect(
        screen.getByRole("button", { name: "Inspect all candidates" }),
    ).toBeTruthy();
    expect(
        screen.getByRole("button", { name: "Approve proposed corpus" }),
    ).toBeTruthy();
    expect(
        screen.getByText(/independent counter-evidence source/i),
    ).toBeTruthy();
    expect(screen.getByText(/source content has not been read/i)).toBeTruthy();
    expect(
        screen.queryByText(/sourceSelectionProposals|version 1/i),
    ).toBeNull();
});

test("labels metadata-linked recommendations without hiding coverage gaps", () => {
    render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={summary as never}
            disposition="recommended"
            onDispositionChange={vi.fn()}
            adjustmentSets={
                {
                    included: [metadataLinked],
                    available: [alternative],
                } as never
            }
            inspectionReview={inspectionReview as never}
            onDecide={vi.fn()}
            onApprove={vi.fn()}
            onRecompute={vi.fn()}
        />,
    );

    fireEvent.click(
        screen.getByRole("button", { name: "Why this source appears" }),
    );
    expect(
        screen.getByText(
            "Linked from discovery metadata; source content has not been read",
        ),
    ).toBeTruthy();
    expect(screen.queryByText(/adds distinct coverage/i)).toBeNull();
    expect(
        screen.getByText(/independent counter-evidence source/i),
    ).toBeTruthy();
});

test("requires an outdated draft to be rebuilt before approval", () => {
    const onRebuild = vi.fn();
    render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={{ ...summary, effectiveStatus: "outdated" } as never}
            disposition="recommended"
            onDispositionChange={vi.fn()}
            adjustmentSets={{ included: [recommended], available: [] } as never}
            inspectionReview={inspectionReview as never}
            onDecide={vi.fn()}
            onApprove={vi.fn()}
            onRecompute={vi.fn()}
            onRebuild={onRebuild}
        />,
    );

    expect(screen.getByText("Improved proposal method available")).toBeTruthy();
    expect(
        screen.queryByRole("button", { name: "Refresh proposal" }),
    ).toBeNull();
    expect(
        screen.getByRole("button", { name: "Approve proposed corpus" }),
    ).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Rebuild proposal" }));
    expect(onRebuild).toHaveBeenCalledTimes(1);
});

test("keeps a partial rebuild visible with analyst-readable coverage consequences", () => {
    render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={
                {
                    ...summary,
                    rebuildOutcome: "partial",
                    failedDiscoveryFamilies: [
                        "investor_relations",
                        "official_product",
                    ],
                } as never
            }
            disposition="recommended"
            onDispositionChange={vi.fn()}
            adjustmentSets={{ included: [recommended], available: [] } as never}
            inspectionReview={inspectionReview as never}
            onDecide={vi.fn()}
            onApprove={vi.fn()}
            onRecompute={vi.fn()}
        />,
    );

    expect(screen.getByText("Some searches failed")).toBeTruthy();
    expect(screen.getByText(/we kept the sources already found/i)).toBeTruthy();
    expect(screen.getByText("Investor relations")).toBeTruthy();
    expect(screen.getByText("Official product")).toBeTruthy();
    expect(
        screen.getByRole("button", { name: "Approve proposed corpus" }),
    ).toHaveProperty("disabled", false);
    expect(
        screen.queryByText(/official_product|EXA_API_KEY|provider/i),
    ).toBeNull();
});

test("explains the purpose of the proposal actions in tooltips", async () => {
    render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={summary as never}
            disposition="recommended"
            onDispositionChange={vi.fn()}
            adjustmentSets={
                {
                    included: [recommended],
                    available: [alternative],
                } as never
            }
            inspectionReview={inspectionReview as never}
            onDecide={vi.fn()}
            onApprove={vi.fn()}
            onRecompute={vi.fn()}
        />,
    );

    const adjustButton = screen.getByRole("button", {
        name: "Adjust proposal",
    });
    fireEvent.mouseOver(adjustButton);
    fireEvent.focus(adjustButton);
    expect(
        await screen.findByText(
            /Refine the proposed corpus by moving sources between Included and Available before approval/i,
        ),
    ).toBeTruthy();

    fireEvent.mouseOut(adjustButton);
    fireEvent.blur(adjustButton);
    const inspectButton = screen.getByRole("button", {
        name: "Inspect all candidates",
    });
    fireEvent.mouseOver(inspectButton);
    fireEvent.focus(inspectButton);
    expect(
        await screen.findByText(
            /Review every discovered candidate, its provenance, and its current source decision/i,
        ),
    ).toBeTruthy();
});

test("groups adjustment choices without showing an inspection filter", () => {
    const onDecide = vi.fn();
    render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={summary as never}
            disposition="recommended"
            onDispositionChange={vi.fn()}
            adjustmentSets={
                {
                    included: [recommended],
                    available: [alternative],
                } as never
            }
            inspectionReview={inspectionReview as never}
            onDecide={onDecide}
            onApprove={vi.fn()}
            onRecompute={vi.fn()}
        />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Adjust proposal" }));

    expect(screen.getByRole("heading", { name: "Included" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Available" })).toBeTruthy();
    expect(screen.queryByLabelText(/Filter candidate sources/i)).toBeNull();
    fireEvent.click(
        screen.getByRole("button", { name: /Include Independent analysis/i }),
    );
    expect(onDecide).toHaveBeenCalledWith("source-alternative", "accepted");
});

test("maps kanban column changes to persisted source decisions", () => {
    expect(sourceDecisionForKanbanMove("available", "included")).toBe(
        "accepted",
    );
    expect(sourceDecisionForKanbanMove("included", "available")).toBe(
        "rejected",
    );
    expect(sourceDecisionForKanbanMove("included", "included")).toBeNull();
});

test("uses the shared kanban interaction with accessible source handles", () => {
    const { container } = render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={summary as never}
            disposition="recommended"
            onDispositionChange={vi.fn()}
            adjustmentSets={
                {
                    included: [recommended],
                    available: [alternative],
                } as never
            }
            inspectionReview={inspectionReview as never}
            onDecide={vi.fn()}
            onApprove={vi.fn()}
            onRecompute={vi.fn()}
        />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Adjust proposal" }));

    expect(container.querySelector('[data-slot="kanban"]')).not.toBeNull();
    expect(
        container.querySelectorAll('[data-slot="kanban-column"]'),
    ).toHaveLength(2);
    expect(
        container.querySelectorAll('[data-slot="kanban-item"]'),
    ).toHaveLength(2);
    expect(
        screen.getByRole("button", {
            name: "Move Independent analysis between proposal sets",
        }),
    ).toBeTruthy();
});

test("lets the analyst reset an explicit override to the proposal", () => {
    const onDecide = vi.fn();
    const overridden = {
        ...recommended,
        decision: "accepted" as const,
        decisionReason: "Analyst included source",
    };
    render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={summary as never}
            disposition="recommended"
            onDispositionChange={vi.fn()}
            adjustmentSets={
                { included: [overridden], available: [alternative] } as never
            }
            inspectionReview={inspectionReview as never}
            onDecide={onDecide}
            onApprove={vi.fn()}
            onRecompute={vi.fn()}
        />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Adjust proposal" }));
    fireEvent.click(
        within(
            screen.getByRole("region", { name: "Adjust source proposal" }),
        ).getByRole("button", {
            name: /Use original recommendation for Annual report/i,
        }),
    );
    expect(onDecide).toHaveBeenCalledWith("source-recommended", "pending");
});

test("requires a stale proposal to be refreshed before approval", () => {
    const onRecompute = vi.fn();
    render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={{ ...summary, effectiveStatus: "stale" } as never}
            disposition="recommended"
            onDispositionChange={vi.fn()}
            adjustmentSets={
                {
                    included: [recommended],
                    available: [alternative],
                } as never
            }
            inspectionReview={inspectionReview as never}
            onDecide={vi.fn()}
            onApprove={vi.fn()}
            onRecompute={onRecompute}
        />,
    );

    expect(
        screen
            .getByRole("button", { name: "Approve proposed corpus" })
            .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Refresh proposal" }));
    expect(onRecompute).toHaveBeenCalledOnce();
});

test("renders approved state without an approve button", () => {
    render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={{ ...summary, revisionStatus: "approved" } as never}
            disposition="recommended"
            onDispositionChange={vi.fn()}
            adjustmentSets={{ included: [recommended], available: [] } as never}
            inspectionReview={inspectionReview as never}
            onDecide={vi.fn()}
            onApprove={vi.fn()}
            onRecompute={vi.fn()}
        />,
    );

    expect(
        screen.getByText("This source set is approved and read-only."),
    ).toBeTruthy();
    expect(
        screen.queryByRole("button", { name: "Approve proposed corpus" }),
    ).toBeNull();
    expect(
        screen.getByRole("button", {
            name: "Review coverage: First independent counter-evidence source",
        }),
    ).toBeTruthy();
    expect(
        screen.queryByRole("button", { name: /^Search sources for/ }),
    ).toBeNull();
    expect(
        screen.getByText("First independent counter-evidence source"),
    ).toBeTruthy();
});

function overviewProps(
    overrides: Partial<Parameters<typeof SourceProposalReview>[0]> = {},
): Parameters<typeof SourceProposalReview>[0] {
    return {
        runId: "run-1" as never,
        corpusRevisionId: "revision-1" as never,
        summary: summary as never,
        disposition: "recommended",
        onDispositionChange: vi.fn(),
        adjustmentSets: {
            included: [recommended],
            available: [alternative],
        } as never,
        inspectionReview: inspectionReview as never,
        onDecide: vi.fn(),
        onApprove: vi.fn(),
        onRecompute: vi.fn(),
        ...overrides,
    };
}

test("moves a recommended source to alternatives directly from its overview card", async () => {
    const onDecide = vi.fn();
    const props = overviewProps({ onDecide });
    const view = render(<SourceProposalReview {...props} />);
    fireEvent.click(
        screen.getByRole("button", {
            name: "Move Annual report to alternatives",
        }),
    );
    await waitFor(() =>
        expect(onDecide).toHaveBeenCalledWith("source-recommended", "rejected"),
    );
    const updated = {
        included: [],
        available: [
            { ...recommended, decision: "rejected", included: false },
            alternative,
        ],
    };
    view.rerender(
        <SourceProposalReview {...props} adjustmentSets={updated as never} />,
    );
    expect(screen.getByRole("tab", { name: /Recommended.*0/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Alternatives.*2/i })).toBeTruthy();
    expect(screen.queryByText("Annual report")).toBeNull();
    view.rerender(
        <SourceProposalReview
            {...props}
            adjustmentSets={updated as never}
            disposition="alternative"
        />,
    );
    expect(
        screen.getByRole("button", { name: "Open Annual report for review" }),
    ).toBeTruthy();
    fireEvent.click(
        screen.getByRole("button", { name: "Why this source appears" }),
    );
    expect(screen.getByText(/Analyst override: Rejected/i)).toBeTruthy();
});

test("includes an alternative from its overview card without changing its original recommendation", async () => {
    const onDecide = vi.fn();
    const props = overviewProps({ onDecide, disposition: "alternative" });
    const view = render(<SourceProposalReview {...props} />);
    fireEvent.click(
        screen.getByRole("button", {
            name: "Include Independent analysis in source set",
        }),
    );
    await waitFor(() =>
        expect(onDecide).toHaveBeenCalledWith("source-alternative", "accepted"),
    );
    const updated = {
        included: [
            recommended,
            { ...alternative, decision: "accepted", included: true },
        ],
        available: [],
    };
    view.rerender(
        <SourceProposalReview
            {...props}
            adjustmentSets={updated as never}
            disposition="recommended"
        />,
    );
    expect(screen.getByRole("tab", { name: /Recommended.*2/i })).toBeTruthy();
    expect(
        screen.getByRole("button", {
            name: "Open Independent analysis for review",
        }),
    ).toBeTruthy();
    fireEvent.click(
        screen.getByRole("button", {
            name: "Open Independent analysis for review",
        }),
    );
    fireEvent.click(
        screen.getByRole("button", { name: "Why this source appears" }),
    );
    expect(screen.getByText(/Analyst override: Accepted/i)).toBeTruthy();
});

test("adds a public source directly from the overview with the existing URL validation", async () => {
    const onAddManualUrl = vi.fn();
    render(<SourceProposalReview {...overviewProps({ onAddManualUrl })} />);
    fireEvent.click(screen.getByRole("button", { name: "Add source link" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Public source link"), {
        target: { value: "http://example.com/report" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(onAddManualUrl).not.toHaveBeenCalled();
    expect(
        await within(dialog).findByText(/beginning with https/i),
    ).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Public source link"), {
        target: { value: "https://example.com/report" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() =>
        expect(onAddManualUrl).toHaveBeenCalledWith(
            "https://example.com/report",
        ),
    );
    expect(
        await within(dialog).findByText("Source added for your review."),
    ).toBeTruthy();
});

test("keeps overview editing controls unavailable after approval", () => {
    render(
        <SourceProposalReview
            {...overviewProps({
                summary: { ...summary, revisionStatus: "approved" } as never,
                onAddManualUrl: vi.fn(),
            })}
        />,
    );
    expect(
        screen.queryByRole("button", { name: "Add source link" }),
    ).toBeNull();
    expect(
        screen.queryByRole("button", {
            name: "Move Annual report to alternatives",
        }),
    ).toBeNull();
});

test("saves a card decision once and offers undo without opening its preview", async () => {
    let finish!: () => void;
    const onDecide = vi
        .fn()
        .mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finish = resolve;
                }),
        )
        .mockResolvedValue(undefined);
    const notification = vi.spyOn(toast, "success");
    render(<SourceProposalReview {...overviewProps({ onDecide })} />);
    fireEvent.click(
        screen.getByRole("button", {
            name: "Move Annual report to alternatives",
        }),
    );
    expect(
        screen
            .getByRole("button", { name: "Move Annual report to alternatives" })
            .hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(notification).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(notification).toHaveBeenCalledOnce());
    const action = notification.mock.calls[0]?.[1]?.action;
    expect(action).toMatchObject({
        label: "Undo",
        onClick: expect.any(Function),
    });
    if (action && typeof action === "object" && "onClick" in action) {
        action.onClick({} as never);
    }
    await waitFor(() =>
        expect(onDecide).toHaveBeenLastCalledWith(
            "source-recommended",
            "pending",
        ),
    );
    notification.mockRestore();
});

test("keeps a failed source move actionable and never announces success", async () => {
    const notification = vi.spyOn(toast, "success");
    const onDecide = vi
        .fn()
        .mockRejectedValue(new Error("internal_provider_failure"));
    render(<SourceProposalReview {...overviewProps({ onDecide })} />);
    fireEvent.click(
        screen.getByRole("button", {
            name: "Move Annual report to alternatives",
        }),
    );
    expect(
        (
            await screen.findByText(
                "We couldn't save that source decision. Try again.",
            )
        ).getAttribute("role"),
    ).toBe("alert");
    expect(screen.queryByText("internal_provider_failure")).toBeNull();
    expect(notification).not.toHaveBeenCalled();
    expect(
        screen
            .getByRole("button", { name: "Move Annual report to alternatives" })
            .hasAttribute("disabled"),
    ).toBe(false);
    notification.mockRestore();
});

test("keeps undecided attention items separate and preserves their warning when included", () => {
    const attention = {
        ...alternative,
        disposition: "needs_attention",
        title: "Company linkage needs review",
    };
    const props = overviewProps({
        disposition: "needs_attention",
        adjustmentSets: {
            included: [recommended],
            available: [attention],
        } as never,
    });
    const view = render(<SourceProposalReview {...props} />);
    expect(
        screen.getByRole("tab", { name: /Needs attention.*1/i }),
    ).toBeTruthy();
    expect(
        screen.getByRole("button", {
            name: "Include Company linkage needs review in source set",
        }),
    ).toBeTruthy();
    view.rerender(
        <SourceProposalReview
            {...props}
            disposition="recommended"
            adjustmentSets={
                {
                    included: [
                        recommended,
                        { ...attention, decision: "accepted", included: true },
                    ],
                    available: [],
                } as never
            }
        />,
    );
    expect(
        screen.getByRole("tab", { name: /Needs attention.*0/i }),
    ).toBeTruthy();
    fireEvent.click(
        screen.getByRole("button", {
            name: "Open Company linkage needs review for review",
        }),
    );
    fireEvent.click(
        screen.getByRole("button", { name: "Why this source appears" }),
    );
    expect(
        screen.getByText("Needs attention", {
            selector: '[data-slot="badge"]',
        }),
    ).toBeTruthy();
});

test("searches the complete carousel and finds removed sources beyond the first page", () => {
    const scrollHeight = vi
        .spyOn(Element.prototype, "scrollHeight", "get")
        .mockReturnValue(1000);
    const clientHeight = vi
        .spyOn(Element.prototype, "clientHeight", "get")
        .mockReturnValue(300);
    try {
        const sources = Array.from({ length: 13 }, (_, index) => ({
            ...recommended,
            sourceId: `source-${index}`,
            title: `Report ${index + 1}`,
            canonicalUrl: `https://example.com/report-${index}`,
            rank: index,
        }));
        const props = overviewProps({
            adjustmentSets: { included: sources, available: [] } as never,
        });
        const view = render(<SourceProposalReview {...props} />);
        expect(
            screen.getByRole("tab", { name: /Recommended.*13/i }),
        ).toBeTruthy();
        fireEvent.change(
            screen.getByLabelText("Search sources in this group"),
            { target: { value: "Report 13" } },
        );
        expect(
            screen.getByRole("button", { name: "Open Report 13 for review" }),
        ).toBeTruthy();
        const removed = {
            ...sources[12],
            decision: "rejected",
            included: false,
        };
        view.rerender(
            <SourceProposalReview
                {...props}
                disposition="alternative"
                adjustmentSets={
                    {
                        included: sources.slice(0, 12),
                        available: [removed],
                    } as never
                }
            />,
        );
        expect(
            screen.getByRole("tab", { name: /Alternatives.*1/i }),
        ).toBeTruthy();
        expect(
            screen.getByRole("button", { name: "Open Report 13 for review" }),
        ).toBeTruthy();
    } finally {
        scrollHeight.mockRestore();
        clientHeight.mockRestore();
    }
});

test.each([
    [
        "recommended",
        "Originally recommended. This will include the source and remove your override.",
    ],
    [
        "alternative",
        "Originally an alternative. This will exclude the source and remove your override.",
    ],
    [
        "needs_attention",
        "Originally flagged for review. This will exclude the source and return it to Needs attention.",
    ],
] as const)("reveals the original %s recommendation on demand without changing the source", async (disposition, description) => {
    const onDecide = vi.fn();
    render(
        <SourceAdjustmentActions
            source={
                {
                    ...alternative,
                    disposition,
                    decision: "accepted",
                    included: true,
                } as never
            }
            disabled={false}
            onDecide={onDecide}
            context="overview"
        />,
    );
    const restore = screen.getByRole("button", {
        name: "Use original recommendation for Independent analysis",
    });
    expect(screen.queryByText(description)).toBeNull();
    fireEvent.click(
        screen.getByRole("button", {
            name: "About the original recommendation for Independent analysis",
        }),
    );
    const explanation = await screen.findByRole("dialog", {
        name: "Original recommendation",
    });
    expect(within(explanation).getByText(description)).toBeTruthy();
    expect(onDecide).not.toHaveBeenCalled();
    fireEvent.keyDown(explanation, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(restore);
    await waitFor(() =>
        expect(onDecide).toHaveBeenCalledExactlyOnceWith(
            "source-alternative",
            "pending",
        ),
    );
});

function mobileViewport() {
    return vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
        matches: query === "(width < 48rem)",
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
    }));
}

test("opens mobile source actions in a dismissible popover while keeping approval and source moves visible", async () => {
    const viewport = mobileViewport();
    try {
        render(
            <SourceProposalReview
                {...overviewProps({ onAddManualUrl: vi.fn() })}
            />,
        );
        const trigger = screen.getByRole("button", { name: "Source actions" });
        expect(
            screen.queryByRole("button", { name: "Add source link" }),
        ).toBeNull();
        expect(
            screen.getByRole("button", { name: "Approve proposed corpus" }),
        ).toBeTruthy();
        expect(
            screen.getByRole("button", {
                name: "Move Annual report to alternatives",
            }),
        ).toBeTruthy();
        fireEvent.click(trigger);
        const popover = await screen.findByRole("dialog", {
            name: "Source actions",
        });
        expect(
            within(popover).getByRole("button", { name: "Add source link" }),
        ).toBeTruthy();
        expect(
            within(popover).getByRole("button", { name: "Adjust proposal" }),
        ).toBeTruthy();
        expect(
            within(popover).getByRole("button", {
                name: "Inspect all candidates",
            }),
        ).toBeTruthy();
        fireEvent.keyDown(popover, { key: "Escape" });
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        await waitFor(() => expect(document.activeElement).toBe(trigger));
    } finally {
        viewport.mockRestore();
    }
});

test("keeps the mobile source dialog open after its popover closes and returns focus to Source actions", async () => {
    const viewport = mobileViewport();
    const onAddManualUrl = vi.fn();
    try {
        render(<SourceProposalReview {...overviewProps({ onAddManualUrl })} />);
        const trigger = screen.getByRole("button", { name: "Source actions" });
        fireEvent.click(trigger);
        fireEvent.click(
            await screen.findByRole("button", { name: "Add source link" }),
        );
        const dialog = await screen.findByRole("dialog", {
            name: "Add public sources",
        });
        await waitFor(() =>
            expect(
                screen.queryByRole("dialog", { name: "Source actions" }),
            ).toBeNull(),
        );
        fireEvent.change(within(dialog).getByLabelText("Public source link"), {
            target: { value: "https://example.com/mobile-report" },
        });
        fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
        await within(dialog).findByText("Source added for your review.");
        expect(onAddManualUrl).toHaveBeenCalledExactlyOnceWith(
            "https://example.com/mobile-report",
        );
        fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        await waitFor(() => expect(document.activeElement).toBe(trigger));
    } finally {
        viewport.mockRestore();
    }
});

test.each([
    ["Adjust proposal", "Adjust source proposal"],
    ["Inspect all candidates", "Inspect all source candidates"],
])("opens %s from mobile actions and returns to a closed popover", async (action, region) => {
    const viewport = mobileViewport();
    try {
        render(<SourceProposalReview {...overviewProps()} />);
        fireEvent.click(screen.getByRole("button", { name: "Source actions" }));
        const actions = await screen.findByRole("dialog", {
            name: "Source actions",
        });
        fireEvent.click(within(actions).getByRole("button", { name: action }));
        await waitForElementToBeRemoved(actions);
        expect(screen.getByRole("region", { name: region })).toBeTruthy();
        fireEvent.click(
            screen.getByRole("button", { name: /Back to proposal/i }),
        );
        expect(
            await screen.findByRole("button", { name: "Source actions" }),
        ).toBeTruthy();
        expect(
            screen.queryByRole("dialog", { name: "Source actions" }),
        ).toBeNull();
    } finally {
        viewport.mockRestore();
    }
});

test("keeps coverage actions behind each gap while failed searches have one retry", async () => {
    const onRecoverDiscovery = vi.fn();
    render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={
                {
                    ...summary,
                    rebuildOutcome: "partial",
                    failedDiscoveryFamilies: ["official_product"],
                    coverageRequirements: [
                        {
                            role: "counter_evidence_primary",
                            covered: false,
                            candidateIds: [alternative.sourceId],
                        },
                    ],
                } as never
            }
            disposition="recommended"
            onDispositionChange={vi.fn()}
            adjustmentSets={
                { included: [recommended], available: [alternative] } as never
            }
            inspectionReview={inspectionReview as never}
            onDecide={vi.fn()}
            onApprove={vi.fn()}
            onRecompute={vi.fn()}
            onRecoverDiscovery={onRecoverDiscovery}
        />,
    );
    expect(screen.getByText("Some searches failed")).toBeTruthy();
    const gaps = within(
        screen.getByRole("complementary", { name: "Source coverage" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry searches" }));
    expect(onRecoverDiscovery).toHaveBeenLastCalledWith({
        kind: "failed_discovery",
    });
    expect(
        gaps.queryByRole("button", { name: /^Search sources for/ }),
    ).toBeNull();
    expect(
        gaps.queryByRole("button", { name: /^Review candidates for/ }),
    ).toBeNull();
    const gap = gaps.getByRole("button", {
        name: "Review coverage: First independent counter-evidence source",
    });
    fireEvent.click(gap);
    const coverage = await screen.findByRole("region", {
        name: "First independent counter-evidence source",
    });
    fireEvent.click(
        within(coverage).getByRole("button", {
            name: "Search sources for First independent counter-evidence source",
        }),
    );
    expect(onRecoverDiscovery).toHaveBeenLastCalledWith({
        kind: "coverage",
        role: "counter_evidence_primary",
    });
    expect(
        screen.getByRole("region", { name: "Proposed source set" }).textContent,
    ).not.toMatch(
        /official_product|counter_evidence_primary|sourceSelectionProposals|EXA_API_KEY/,
    );
    expect(
        screen.getByRole("region", {
            name: "First independent counter-evidence source",
        }),
    ).toBeTruthy();
    fireEvent.click(
        screen.getByRole("button", {
            name: "Review candidates for First independent counter-evidence source",
        }),
    );
    expect(
        screen.getByRole("heading", { name: "Review matching candidates" }),
    ).toBeTruthy();
    expect(screen.getByText("1 potential match")).toBeTruthy();
    expect(screen.queryByText(/^Reviewing coverage:/)).toBeNull();
    expect(
        screen.queryByRole("button", { name: "Independent analysis" }),
    ).toBeNull();
    const inspector = within(
        screen.getByRole("region", { name: "Inspect all source candidates" }),
    );
    expect(
        inspector.queryByRole("button", {
            name: "Open Annual report for review",
        }),
    ).toBeNull();
    expect(
        inspector.getByRole("button", {
            name: "Open Independent analysis for review",
        }),
    ).toBeTruthy();
    expect(
        screen.getByRole("button", { name: "Show all candidates" }),
    ).toBeTruthy();
});

test("shows pending search feedback and blocks repeated search activation", () => {
    const onRecoverDiscovery = vi.fn();
    render(
        <SourceProposalReview
            {...overviewProps({
                isRecovering: true,
                summary: {
                    ...summary,
                    rebuildOutcome: "partial",
                    failedDiscoveryFamilies: ["official_product"],
                } as never,
                onRecoverDiscovery,
            })}
        />,
    );
    const pending = screen.getByRole("button", { name: "Searching…" });
    expect(pending).toHaveProperty("disabled", true);
    expect(pending.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(pending);
    expect(onRecoverDiscovery).not.toHaveBeenCalled();
    expect(
        screen.getByRole("button", { name: "Approve proposed corpus" }),
    ).toHaveProperty("disabled", true);
});

test("keeps a failed coverage search visible beside its disabled countdown action", async () => {
    const onRecoverDiscovery = vi.fn();
    render(
        <SourceProposalReview
            {...overviewProps({
                onRecoverDiscovery,
                recovery: {
                    target: {
                        kind: "coverage",
                        role: "counter_evidence_primary",
                    },
                    retryAfterSeconds: 12,
                    feedback: {
                        status: "danger",
                        title: "Search could not be completed",
                        description:
                            "The search request was rejected. Add a source link or review existing candidates. Your source decisions are unchanged.",
                    },
                },
            } as never)}
        />,
    );
    fireEvent.click(
        screen.getByRole("button", {
            name: "Review coverage: First independent counter-evidence source",
        }),
    );
    const dialog = await screen.findByRole("region", {
        name: "First independent counter-evidence source",
    });
    expect(within(dialog).getByRole("alert").textContent).toContain(
        "Search could not be completed",
    );
    const retry = within(dialog).getByRole("button", { name: /Retry in 12s/ });
    expect(retry).toHaveProperty("disabled", true);
    fireEvent.click(retry);
    expect(onRecoverDiscovery).not.toHaveBeenCalled();
    expect(dialog.textContent).not.toMatch(
        /HTTP|EXA_API_KEY|request_rejected|sourceSelectionProposalActions/,
    );
});

test("distinguishes a directly opened coverage gap from an empty dossier and can restore the full list", async () => {
    const navigate = vi.fn();
    const props = overviewProps({
        onSourceReviewNavigate: navigate,
        sourceReviewNavigation: {
            view: "inspect",
            coverage: "counter_evidence_primary",
        },
        summary: {
            ...summary,
            coverageRequirements: [
                {
                    role: "counter_evidence_primary",
                    covered: false,
                    candidateIds: [],
                },
            ],
        } as never,
    });
    const view = render(<SourceProposalReview {...props} />);
    expect(screen.getByText("No matching candidates")).toBeTruthy();
    expect(
        screen.queryByText("No public sources were found.", { exact: false }),
    ).toBeNull();
    fireEvent.click(
        screen.getByRole("button", { name: "Show all candidates" }),
    );
    expect(navigate).toHaveBeenCalledWith({ view: "inspect" });
    view.rerender(
        <SourceProposalReview
            {...props}
            sourceReviewNavigation={{ view: "inspect" }}
        />,
    );
    const inspector = within(
        screen.getByRole("region", { name: "Inspect all source candidates" }),
    );
    expect(
        inspector.getByRole("button", {
            name: "Open Annual report for review",
        }),
    ).toBeTruthy();
});

test("starts candidate review on an excluded match instead of reopening the included source", () => {
    const selectSource = vi.fn();
    render(
        <SourceProposalReview
            {...overviewProps({
                onInspectionSelectedIdChange: selectSource,
                summary: {
                    ...summary,
                    coverageRequirements: [
                        {
                            role: "counter_evidence_primary",
                            covered: false,
                            candidateIds: [
                                recommended.sourceId,
                                alternative.sourceId,
                            ],
                            includedSourceIds: [recommended.sourceId],
                        },
                    ],
                } as never,
            })}
        />,
    );
    fireEvent.click(
        screen.getByRole("button", {
            name: "Review coverage: First independent counter-evidence source",
        }),
    );
    fireEvent.click(
        screen.getByRole("button", {
            name: "Review candidates for First independent counter-evidence source",
        }),
    );
    expect(selectSource).toHaveBeenLastCalledWith(alternative.sourceId);
});

test("keeps the search result visible when its resolved coverage control disappears", () => {
    render(
        <SourceProposalReview
            {...overviewProps({
                summary: {
                    ...summary,
                    coverageGaps: [],
                    failedDiscoveryFamilies: [],
                    rebuildOutcome: "complete",
                } as never,
                onRecoverDiscovery: vi.fn(),
                recovery: {
                    target: {
                        kind: "coverage",
                        role: "counter_evidence_primary",
                    },
                    retryAfterSeconds: 0,
                    feedback: {
                        status: "success",
                        title: "Search completed",
                        description:
                            "Review the updated proposal and any remaining coverage needs before approval.",
                    },
                },
            })}
        />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Search completed");
    expect(screen.queryByRole("button", { name: "Retry searches" })).toBeNull();
});

test("a terminal preparation keeps inspection and link intake without offering another search series", async () => {
    render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={
                {
                    ...summary,
                    preparation: {
                        status: "partial",
                        checked: 1,
                        total: 2,
                        canResume: false,
                    },
                    rebuildOutcome: "partial",
                    failedDiscoveryFamilies: ["counter_evidence"],
                } as never
            }
            disposition="recommended"
            onDispositionChange={vi.fn()}
            adjustmentSets={
                { included: [recommended], available: [alternative] } as never
            }
            inspectionReview={inspectionReview as never}
            onDecide={vi.fn()}
            onApprove={vi.fn()}
            onRecompute={vi.fn()}
            onRecoverDiscovery={vi.fn()}
            onAddManualUrl={vi.fn()}
        />,
    );
    expect(
        screen.getByRole("button", { name: "Inspect all candidates" }),
    ).toBeTruthy();
    expect(
        screen.getByRole("button", { name: "Add source link" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry searches" })).toBeNull();
    fireEvent.click(
        screen.getByRole("button", {
            name: "Review coverage: First independent counter-evidence source",
        }),
    );
    expect(
        screen.queryByRole("button", { name: /Search sources for/i }),
    ).toBeNull();
    expect(
        await screen.findByRole("button", { name: /Review candidates for/i }),
    ).toBeTruthy();
});

test("a retained new link has an actionable reading continuation without internal diagnostics", () => {
    const recover = vi.fn();
    const { container } = render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={
                {
                    ...summary,
                    preparationAction: { kind: "resume", available: true },
                    preparation: {
                        status: "blocked",
                        checked: 0,
                        total: 1,
                        canResume: true,
                    },
                } as never
            }
            disposition="recommended"
            onDispositionChange={vi.fn()}
            adjustmentSets={
                { included: [recommended], available: [alternative] } as never
            }
            inspectionReview={inspectionReview as never}
            onDecide={vi.fn()}
            onApprove={vi.fn()}
            onRecompute={vi.fn()}
            onPrepare={recover}
            onAddManualUrl={vi.fn()}
        />,
    );
    expect(
        screen.getByText(
            /Finish the other dossier.*read the source you added/i,
        ),
    ).toBeTruthy();
    fireEvent.click(
        screen.getByRole("button", { name: "Continue source preparation" }),
    );
    expect(recover).toHaveBeenCalledOnce();
    expect(container.textContent).not.toMatch(
        /execution_slot|SOURCE_QUALIFICATION|generation|provider|quota/,
    );
});

test("an approved prepared corpus explains inspection and revision instead of asking for approval again", () => {
    render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={
                {
                    ...summary,
                    revisionStatus: "approved",
                    preparation: {
                        status: "partial",
                        checked: 1,
                        total: 2,
                        canResume: false,
                    },
                } as never
            }
            disposition="recommended"
            onDispositionChange={vi.fn()}
            adjustmentSets={
                { included: [recommended], available: [alternative] } as never
            }
            inspectionReview={
                { ...inspectionReview, status: "approved" } as never
            }
            onDecide={vi.fn()}
            onApprove={vi.fn()}
            onRecompute={vi.fn()}
        />,
    );
    expect(
        screen.getByText(
            "Inspect the captured passages and recorded limitations. Changes to the source set need a new revision.",
        ),
    ).toBeTruthy();
    expect(screen.queryByText(/then approve the source set/i)).toBeNull();
    expect(
        screen.queryByRole("button", { name: "Approve proposed corpus" }),
    ).toBeNull();
});
