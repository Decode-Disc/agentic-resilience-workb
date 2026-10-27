import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EvidenceMatrix } from "@/components/workbench-ui/evidence-matrix";
import { InventorySheet } from "@/components/workbench-ui/inventory-sheet";
import { SourceReader } from "@/components/workbench-ui/source-reader";

describe("workbench controls", () => {
    it("exposes query, class and recency changes without changing the supplied evidence", () => {
        const query = vi.fn(),
            filter = vi.fn(),
            recent = vi.fn();
        render(
            <InventorySheet
                open
                onOpenChange={vi.fn()}
                total={2}
                query=""
                onQueryChange={query}
                filters={[
                    { id: "all", label: "All", count: 2 },
                    { id: "fact", label: "Fact", count: 1, kind: "fact" },
                ]}
                selectedFilter="all"
                onFilterChange={filter}
                recentFirst
                onRecentFirstChange={recent}>
                <span>Supplied evidence</span>
            </InventorySheet>,
        );
        fireEvent.change(
            screen.getByRole("searchbox", { name: "Search assertions" }),
            { target: { value: "routing" } },
        );
        fireEvent.click(screen.getByRole("button", { name: "Fact 1" }));
        fireEvent.click(
            screen.getByRole("checkbox", { name: "Changed recently first" }),
        );
        expect(query).toHaveBeenCalledWith("routing");
        expect(filter).toHaveBeenCalledWith("fact");
        expect(recent).toHaveBeenCalledWith(false);
        expect(screen.getByText("Supplied evidence")).toBeTruthy();
    });
    it("opens the selected assertion use with its question identity", () => {
        const select = vi.fn();
        render(
            <EvidenceMatrix
                questions={[{ id: "q1", label: "Q1", title: "Control" }]}
                rows={[
                    {
                        id: "a1",
                        text: "Insurer-owned rules",
                        kind: "fact",
                        meta: "p. 8",
                        uses: { q1: "supports" },
                    },
                ]}
                onSelectUse={select}
            />,
        );
        fireEvent.click(
            screen.getByRole("button", { name: "a1 · Q1 · Supports" }),
        );
        expect(select).toHaveBeenCalledWith("a1", "q1");
    });
    it("moves through supplied pages and disables the document boundaries", () => {
        render(
            <SourceReader
                title="Annual report"
                meta="Illustrative"
                pages={[
                    {
                        id: "p8",
                        label: "p. 8",
                        section: "Business",
                        passages: [{ id: "one", text: "First passage" }],
                    },
                    {
                        id: "p9",
                        label: "p. 9",
                        section: "Business",
                        passages: [{ id: "two", text: "Second passage" }],
                    },
                ]}
                contributionLabel="Company-authored"
                contributions={[]}
            />,
        );
        expect(
            screen
                .getByRole("button", { name: "Previous passage" })
                .hasAttribute("disabled"),
        ).toBe(true);
        fireEvent.click(screen.getByRole("button", { name: "Next passage" }));
        expect(screen.getByText("Second passage")).toBeTruthy();
        expect(
            screen
                .getByRole("button", { name: "Next passage" })
                .hasAttribute("disabled"),
        ).toBe(true);
    });
});
