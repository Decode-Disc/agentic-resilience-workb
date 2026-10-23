import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

vi.mock("@/hooks/use-source-preview", () => ({
    useSourcePreview: () => ({ status: "idle" }),
}));

import { SourceReview } from "@/components/workspace/source-review";

test("searches the full bounded candidate set including sources beyond the loaded page", async () => {
    const onSelect = vi.fn();
    const sources = Array.from({ length: 14 }, (_, index) => ({
        sourceId: `source-${index}`,
        canonicalUrl: `https://example.com/${index}`,
        title: index === 13 ? "Customer agreement" : `Annual report ${index}`,
        origin: "exa",
        category: index === 13 ? "official_commercial" : "regulatory",
        documentKind:
            index === 13 ? "official_commercial_terms" : "regulatory_annual",
        authorityTier: "company_primary",
        sourceFamily: "official_commercial",
        companyLinkageBasis: "structural",
        disposition: "alternative",
        reasonCodes: ["not_selected"],
        included: false,
        decision: "pending",
        rank: index,
    }));
    render(
        <SourceReview
            runId={"run" as never}
            corpusRevisionId={"revision" as never}
            review={
                {
                    revision: 1,
                    status: "draft",
                    total: 14,
                    candidateLimit: 60,
                    counts: { pending: 14, accepted: 0, rejected: 0 },
                    sources: sources.slice(0, 1),
                } as never
            }
            proposalSources={sources as never}
            onDecide={vi.fn()}
            onApprove={vi.fn()}
            onSelectedIdChange={onSelect}
            hasMore
            showApprovalAction={false}
        />,
    );
    fireEvent.change(screen.getByLabelText("Search candidates"), {
        target: { value: "Customer agreement" },
    });
    expect(
        await screen.findByRole("button", {
            name: "Open Customer agreement for review",
        }),
    ).toBeTruthy();
    expect(
        screen.queryByRole("button", {
            name: "Open Annual report 0 for review",
        }),
    ).toBeNull();
    await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith("source-13"));
    expect(
        screen.queryByRole("button", { name: "Load more sources" }),
    ).toBeNull();
});
