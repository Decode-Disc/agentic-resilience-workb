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
    expect(screen.getByText("Public progress")).toBeTruthy();
    expect(
        screen.queryByRole("button", { name: "Inspect work for this turn" }),
    ).toBeNull();
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
