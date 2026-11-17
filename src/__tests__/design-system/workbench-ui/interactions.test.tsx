import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { EvidenceMatrixIllustration } from "@/components/landing/evidence-matrix-illustration";
import { EvidenceMatrix } from "@/components/workbench-ui/evidence-matrix";
import { InventorySheet } from "@/components/workbench-ui/inventory-sheet";

describe("workbench controls", () => {
    it("opens the selected use rationale and passage and delegates its actions", async () => {
        const challenge = vi.fn();
        const passage = vi.fn();
        const reasoning = vi.fn();
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
                        passage: {
                            text: "The insurer configures routing.",
                            meta: "Report · p. 8 ¶3",
                            kind: "fact",
                        },
                        useDetails: {
                            q1: {
                                rationale:
                                    "One workflow connects the participants.",
                                control: "Supported within this scope",
                                limitation:
                                    "Execution does not establish decision authority.",
                                judgment: "In Q1 appraisal v1 · for review",
                            },
                        },
                    },
                ]}
                selectedAssertion="a1"
                selectedQuestion="q1"
                onSelectUse={vi.fn()}
                onChallengeUse={challenge}
                onOpenPassage={passage}
                onOpenQuestionReasoning={reasoning}
            />,
        );
        const trigger = screen.getByRole("button", {
            name: "a1 · Q1 · Supports",
        });
        fireEvent.click(trigger);
        const popup = await screen.findByRole("dialog", {
            name: "a1 used for Q1",
        });
        expect(
            within(popup).getByText("One workflow connects the participants."),
        ).toBeTruthy();
        expect(
            within(popup).getByText(/The insurer configures routing/),
        ).toBeTruthy();
        expect(
            within(popup).getByText(
                "Execution does not establish decision authority.",
            ),
        ).toBeTruthy();
        fireEvent.click(
            within(popup).getByRole("button", { name: "Challenge this use" }),
        );
        fireEvent.click(
            within(popup).getByRole("button", { name: "Open passage" }),
        );
        fireEvent.click(
            within(popup).getByRole("button", { name: "See Q1 reasoning" }),
        );
        expect(challenge).toHaveBeenCalledWith("a1", "q1");
        expect(passage).toHaveBeenCalledWith("a1", "q1");
        expect(reasoning).toHaveBeenCalledWith("q1");
        fireEvent.click(
            within(popup).getByRole("button", { name: "Close use details" }),
        );
        await waitFor(() =>
            expect(
                screen.queryByRole("dialog", { name: "a1 used for Q1" }),
            ).toBeNull(),
        );
    });
    it("always shows the supplied source checks independently of assertion classification", () => {
        render(
            <EvidenceMatrix
                questions={[{ id: "q1", label: "Q1", title: "Control" }]}
                rows={[
                    {
                        id: "a1",
                        text: "Checked assertion",
                        kind: "fact",
                        meta: "p. 8",
                        uses: {},
                        sourceStatus: "verified",
                    },
                    {
                        id: "a2",
                        text: "Conflicting passages",
                        kind: "fact",
                        meta: "p. 9",
                        uses: {},
                        sourceStatus: "disputed",
                    },
                    {
                        id: "a3",
                        text: "Missing support",
                        kind: "fact",
                        meta: "p. 10",
                        uses: {},
                        sourceStatus: "unestablished",
                    },
                    {
                        id: "a4",
                        text: "Awaiting inspection",
                        kind: "fact",
                        meta: "p. 11",
                        uses: {},
                    },
                ]}
                onSelectUse={vi.fn()}
            />,
        );
        expect(
            screen.getByRole("columnheader", { name: "Source" }),
        ).toBeTruthy();
        for (const label of [
            "Verified",
            "Sources disagree",
            "Not established",
            "Not checked",
        ]) {
            expect(screen.getByRole("cell", { name: label })).toBeTruthy();
        }
    });
    it("keeps the landing illustration explicitly fictional while exploring assertion uses", () => {
        render(<EvidenceMatrixIllustration />);
        expect(
            screen.getByText(/Fictional company, assertions and sources/),
        ).toBeTruthy();
        expect(screen.getByText(/5 fictional assertions/)).toBeTruthy();
        fireEvent.click(
            screen.getByRole("button", { name: "A-033 · Q4 · Supports" }),
        );
        expect(
            screen
                .getByRole("button", { name: "A-033 · Q4 · Supports" })
                .getAttribute("aria-pressed"),
        ).toBe("true");
        expect(
            screen
                .getByRole("button", { name: "A-014 · Q1 · Supports" })
                .getAttribute("aria-pressed"),
        ).toBe("false");
        expect(
            screen.getByText("Illustrative hypothesis · to be tested"),
        ).toBeTruthy();
        expect(screen.queryByText(/CCC/)).toBeNull();
    });
    it("identifies the selected assertion use and follows controlled selection changes", () => {
        function MatrixSelection() {
            const [assertion, setAssertion] = useState<string>();
            const [question, setQuestion] = useState<string>();
            return (
                <EvidenceMatrix
                    questions={[
                        { id: "q1", label: "Q1", title: "Control" },
                        { id: "q2", label: "Q2", title: "Durability" },
                    ]}
                    rows={[
                        {
                            id: "a1",
                            text: "Insurer-owned rules",
                            kind: "fact",
                            meta: "p. 8",
                            uses: { q1: "supports", q2: "context" },
                        },
                        {
                            id: "a2",
                            text: "Context can move",
                            kind: "hypothesis",
                            meta: "To investigate",
                            uses: { q2: "opposes" },
                        },
                    ]}
                    selectedAssertion={assertion}
                    selectedQuestion={question}
                    onSelectQuestion={setQuestion}
                    onSelectUse={(a, q) => {
                        setAssertion(a);
                        setQuestion(q);
                    }}
                />
            );
        }
        render(<MatrixSelection />);
        expect(screen.queryByText(/· selected/)).toBeNull();
        expect(
            screen
                .getByRole("button", { name: "a1 · Q1 · Supports" })
                .getAttribute("aria-pressed"),
        ).toBe("false");
        fireEvent.click(
            screen.getByRole("button", { name: "a1 · Q1 · Supports" }),
        );
        expect(
            screen
                .getByRole("button", { name: "a1 · Q1 · Supports" })
                .getAttribute("aria-pressed"),
        ).toBe("true");
        expect(screen.getByText("a1 · selected")).toBeTruthy();
        fireEvent.click(
            screen.getByRole("button", { name: "a2 · Q2 · Opposes" }),
        );
        expect(
            screen
                .getByRole("button", { name: "a2 · Q2 · Opposes" })
                .getAttribute("aria-pressed"),
        ).toBe("true");
        expect(
            screen
                .getByRole("button", { name: "a1 · Q1 · Supports" })
                .getAttribute("aria-pressed"),
        ).toBe("false");
        expect(
            screen
                .getByRole("button", { name: "Q2 Durability" })
                .getAttribute("aria-pressed"),
        ).toBe("true");
        expect(screen.getByText("a2 · selected")).toBeTruthy();
    });
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
});
