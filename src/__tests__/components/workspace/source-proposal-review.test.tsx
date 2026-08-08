import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { sourceDecisionForKanbanMove } from "@/components/workspace/source-proposal-adjustment-board";
import { SourceProposalReview } from "@/components/workspace/source-proposal-review";

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

test("presents a summary-first proposal with only the three proposal tabs", () => {
    render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={summary as never}
            proposalItems={[recommended] as never}
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
        screen.getByRole("button", { name: "Approve source set" }),
    ).toBeTruthy();
    expect(
        screen.getByText(/independent counter-evidence source/i),
    ).toBeTruthy();
    expect(screen.getByText(/source content has not been read/i)).toBeTruthy();
    expect(
        screen.queryByText(
            /sourceSelectionProposals|version 1/i,
        ),
    ).toBeNull();
});

test("requires an outdated draft to be rebuilt before approval", () => {
    const onRebuild = vi.fn();
    render(
        <SourceProposalReview
            runId={"run-1" as never}
            corpusRevisionId={"revision-1" as never}
            summary={{ ...summary, effectiveStatus: "outdated" } as never}
            proposalItems={[recommended] as never}
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
        screen.getByRole("button", { name: "Approve source set" }),
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
            proposalItems={[recommended] as never}
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
        screen.getByText("Some source discovery was unavailable"),
    ).toBeTruthy();
    expect(
        screen.getByText(
            /proposal uses the reliable sources that were available/i,
        ),
    ).toBeTruthy();
    expect(screen.getByText("Investor relations")).toBeTruthy();
    expect(screen.getByText("Official product")).toBeTruthy();
    expect(
        screen.getByRole("button", { name: "Approve source set" }),
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
            proposalItems={[recommended] as never}
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
            proposalItems={[recommended] as never}
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
            proposalItems={[recommended] as never}
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
            proposalItems={[overridden] as never}
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
        screen.getByRole("button", {
            name: /Reset Annual report to proposal/i,
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
            proposalItems={[recommended] as never}
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
            .getByRole("button", { name: "Approve source set" })
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
            proposalItems={[recommended] as never}
            disposition="recommended"
            onDispositionChange={vi.fn()}
            adjustmentSets={
                { included: [recommended], available: [] } as never
            }
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
        screen.queryByRole("button", { name: "Approve source set" }),
    ).toBeNull();
});
