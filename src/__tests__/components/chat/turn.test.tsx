import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import {
    ConversationTurn,
    type ConversationTurnSnapshot,
} from "@/components/chat/conversation-turn";

it("folds intermediate commentary and operations only when the turn ends, keeping the answer visible", () => {
    const turn: ConversationTurnSnapshot = {
        id: "t1",
        state: "running",
        entries: [
            { kind: "message", id: "comment", phase: "commentary" },
            {
                kind: "operation",
                operation: {
                    id: "op",
                    title: "Read retained material",
                    summary: "Network participation",
                    state: "completed",
                },
            },
            { kind: "message", id: "answer", phase: "answer" },
        ],
    };
    const renderMessage = (id: string) => (
        <a href={id === "answer" ? "#answer" : "#progress"}>
            {id === "answer" ? "Final interpretation" : "Public progress"}
        </a>
    );
    const { rerender } = render(
        <ConversationTurn turn={turn} renderMessage={renderMessage} />,
    );
    fireEvent.click(
        screen.getByRole("button", { name: "Inspect work for this turn" }),
    );
    expect(screen.getByRole("link", { name: "Public progress" })).toBeTruthy();
    rerender(
        <ConversationTurn
            turn={{ ...turn, state: "completed" }}
            renderMessage={renderMessage}
        />,
    );
    expect(screen.queryByRole("link", { name: "Public progress" })).toBeNull();
    expect(screen.getByText("Final interpretation")).toBeTruthy();
    fireEvent.click(
        screen.getByRole("button", { name: "Inspect work for this turn" }),
    );
    expect(screen.getByText("Public progress")).toBeTruthy();
});

it("keeps intermediate work inside its disclosure and the final answer outside it", () => {
    const turn: ConversationTurnSnapshot = {
        id: "mixed-turn",
        state: "running",
        entries: [
            { kind: "message", id: "comment", phase: "commentary" },
            {
                kind: "operation",
                operation: {
                    id: "work",
                    title: "Inspect reporting",
                    summary: "Retained",
                    state: "completed",
                },
            },
            { kind: "message", id: "answer", phase: "answer" },
        ],
    };
    render(
        <ConversationTurn
            turn={turn}
            renderMessage={(id) => (
                <p>
                    {id === "answer"
                        ? "Final interpretation"
                        : "Intermediate observation"}
                </p>
            )}
        />,
    );
    expect(screen.getByText("Final interpretation")).toBeTruthy();
    expect(
        screen.queryByRole("region", { name: "Agent activities" }),
    ).toBeNull();
    fireEvent.click(
        screen.getByRole("button", { name: "Inspect work for this turn" }),
    );
    expect(
        screen
            .getByText("Intermediate observation")
            .compareDocumentPosition(screen.getByText("Inspect reporting")) &
            Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("Final interpretation")).toBeTruthy();
});
