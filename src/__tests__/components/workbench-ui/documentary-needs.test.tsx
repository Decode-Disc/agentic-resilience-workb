import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { DocumentaryNeeds } from "@/components/workbench-ui/documentary-needs";

const longNeed =
    "Where does the Now Platform sit in the enterprise workflow chain, which processes run through its orchestration layer, and what does it control, observe or gate in those flows?";

function renderNeeds() {
    const onOpenSource = vi.fn();
    render(
        <DocumentaryNeeds
            questions={[{ id: "q1", label: "Q1", question: "Position" }]}
            notice="The Sources Agent stopped here because its time window ended."
            onOpenSource={onOpenSource}
            needs={[
                {
                    id: "workflow",
                    label: longNeed,
                    questions: ["q1"],
                    outcome: "unfinished",
                    documents: 2,
                    contributions: 5,
                    sources: [
                        {
                            id: "annual",
                            title: "10-K · 2026-01-29",
                            meta: "4 contributions",
                            reading: "partial",
                        },
                        {
                            id: "register",
                            title: "Salesforce is taking on ServiceNow in ITSM",
                            meta: "1 contribution",
                            reading: "full",
                        },
                    ],
                },
            ]}
        />,
    );
    return { onOpenSource };
}

test("a shared reason appears once; the full need and its documents each have an explicit control", () => {
    const { onOpenSource } = renderNeeds();
    expect(
        screen.getAllByText(
            "The Sources Agent stopped here because its time window ended.",
        ),
    ).toHaveLength(1);
    // The need text itself is not a hidden trigger.
    expect(screen.queryByRole("button", { name: longNeed })).toBeNull();
    const more = screen.getByRole("button", { name: "Show full need" });
    fireEvent.click(more);
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();

    // The narrow-layout copy of the outcome is hidden by CSS, which jsdom does not apply.
    const [documents] = screen.getAllByRole("button", { name: /^2 documents/ });
    if (!documents) throw new Error("Documents control missing");
    expect(documents.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(documents);
    expect(documents.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(
        within(
            screen.getAllByRole("list", {
                name: "Documents for this need",
            })[0] as HTMLElement,
        ).getByRole("button", {
            name: /Salesforce is taking on ServiceNow in ITSM/,
        }),
    );
    expect(onOpenSource).toHaveBeenCalledWith("register", "workflow");
});
