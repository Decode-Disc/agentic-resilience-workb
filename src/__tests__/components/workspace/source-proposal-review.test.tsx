import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

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
    counts: { recommended: 1, needsAttention: 0, alternative: 1 },
    gaps: ["counter_evidence"],
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
    expect(screen.getByText(/Counter evidence/i)).toBeTruthy();
    expect(screen.getByText(/source content has not been read/i)).toBeTruthy();
    expect(
        screen.queryByText(
            /SOURCE_RECOMMENDED_TARGET|sourceSelectionProposals|version 1/i,
        ),
    ).toBeNull();
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
