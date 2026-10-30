import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import {
    ConversationActivityGroup,
    type ConversationWorkItem,
} from "@/components/chat/workbench-conversation";

const reference: ConversationWorkItem = {
    id: "reference",
    title: "Check supplied reference",
    state: "completed",
    summary: "Reference recorded; contents have not been retrieved.",
    details: <a href="https://www.sec.gov/">Inspect reference context</a>,
};
const reporting: ConversationWorkItem = {
    id: "reporting",
    title: "Find company reporting",
    state: "running",
    summary: "Looking for filings related to claims coordination.",
};

it("keeps work continuous until the turn ends, then folds retained operations and preserves their details", () => {
    const { rerender } = render(
        <div>
            <ConversationActivityGroup
                id="source-turn"
                title="Source preparation"
                state="running"
                summary="Preparing the documentary basis"
                activities={[reference, reporting]}
            />
        </div>,
    );
    expect(screen.getByText(reference.summary)).toBeTruthy();
    expect(screen.getByText(reporting.summary)).toBeTruthy();
    expect(
        screen.queryByRole("button", { name: "Inspect source preparation" }),
    ).toBeNull();
    const retainedReference = screen.getByRole("button", {
        name: "Inspect Check supplied reference",
    });
    fireEvent.click(retainedReference);
    const link = screen.getByRole("link", {
        name: "Inspect reference context",
    });
    link.focus();

    const activities = [
        reference,
        {
            ...reporting,
            state: "completed" as const,
            summary: "Company reporting found.",
        },
    ];
    rerender(
        <div>
            <ConversationActivityGroup
                id="source-turn"
                title="Source preparation"
                state="running"
                summary="Preparing the next operation"
                activities={activities}
            />
        </div>,
    );
    expect(screen.getByText("Company reporting found.")).toBeTruthy();
    expect(
        screen.getByRole("link", { name: "Inspect reference context" }),
    ).toBe(link);
    expect(
        screen.queryByRole("button", { name: "Inspect source preparation" }),
    ).toBeNull();

    rerender(
        <div>
            <ConversationActivityGroup
                id="source-turn"
                title="Source preparation"
                state="completed"
                summary="Company reporting found; supplied reference remains unread."
                activities={activities}
            />
            <p>The available material is ready for review.</p>
        </div>,
    );
    const group = screen.getByRole("button", {
        name: "Inspect source preparation",
    });
    expect(group.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(group);
    expect(
        screen.queryByRole("link", { name: "Inspect reference context" }),
    ).toBeNull();
    expect(
        screen.getByText("The available material is ready for review."),
    ).toBeTruthy();
    fireEvent.click(group);
    expect(group.getAttribute("aria-expanded")).toBe("true");
    expect(
        screen.getByRole("link", { name: "Inspect reference context" }),
    ).toBeTruthy();
});

it("keeps interrupted work distinct from a successful outcome and omits groups without operations", () => {
    const { rerender } = render(
        <ConversationActivityGroup
            id="empty-turn"
            title="Source preparation"
            state="completed"
            summary="Nothing observed"
            activities={[]}
        />,
    );
    expect(screen.queryByText("Nothing observed")).toBeNull();
    rerender(
        <ConversationActivityGroup
            id="source-turn"
            title="Source preparation"
            state="interrupted"
            summary="Reporting search stopped; reference context is retained."
            activities={[reference, { ...reporting, state: "interrupted" }]}
        />,
    );
    const group = screen.getByRole("button", {
        name: "Inspect source preparation",
    });
    expect(group.textContent).toContain("Interrupted");
    fireEvent.click(group);
    expect(
        within(
            screen.getByRole("region", { name: "Source preparation" }),
        ).getAllByText("Interrupted"),
    ).toHaveLength(2);
    expect(
        screen.getByText(
            "Reporting search stopped; reference context is retained.",
        ),
    ).toBeTruthy();
});
