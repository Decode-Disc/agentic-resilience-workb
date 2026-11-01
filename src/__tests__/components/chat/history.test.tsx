import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { ConversationHistory } from "@/components/chat/conversation-history";
import { ConversationThread } from "@/components/chat/conversation-thread";
import { useWorkbenchConversation } from "@/components/chat/workbench-conversation";

function InterleavedHistory() {
    const conversation = useWorkbenchConversation({
        messages: [
            {
                id: "start",
                role: "assistant",
                content: "I'll prepare the source material.",
            },
            {
                id: "follow-up",
                role: "user",
                content: "Keep the evidence gap explicit.",
            },
            {
                id: "answer",
                role: "assistant",
                content: "The candidate list is ready.",
            },
        ],
        draft: "",
        onDraftChange: () => {},
        onSend: () => {},
    });
    return (
        <ConversationThread runtime={conversation.runtime}>
            <ConversationHistory
                entries={["start", "follow-up", "answer"].map((id) => ({
                    kind: "message" as const,
                    id,
                }))}
                turns={[
                    {
                        id: "preparation",
                        state: "completed",
                        entries: [
                            {
                                kind: "message",
                                id: "start",
                                phase: "commentary",
                            },
                            {
                                kind: "operation",
                                operation: {
                                    id: "reporting",
                                    title: "Find company reporting",
                                    summary: "Candidates recorded.",
                                    state: "completed",
                                },
                            },
                            { kind: "message", id: "answer", phase: "answer" },
                        ],
                    },
                ]}
            />
        </ConversationThread>
    );
}

it("keeps a later completion after the analyst's intervening message", () => {
    const { container } = render(<InterleavedHistory />);
    expect(
        screen
            .getAllByRole("article")
            .map(
                (article) =>
                    article.querySelector('[data-slot="message-content"]')
                        ?.textContent,
            ),
    ).toEqual([
        "Keep the evidence gap explicit.",
        "The candidate list is ready.",
    ]);
    expect(container.querySelectorAll("article")).toHaveLength(2);
    expect(container.querySelectorAll('[role="note"]')).toHaveLength(1);
});

it("renders retained commentary as an activity note without message actions, keeping the answer outside the work details", () => {
    const { container } = render(<InterleavedHistory />);
    const trigger = screen.getByRole("button", {
        name: "Inspect work for this turn",
    });
    fireEvent.click(trigger);
    const note = screen.getByRole("note", {
        name: "Workbench Agent progress note",
    });
    expect(note.textContent).toBe("I'll prepare the source material.");
    expect(
        within(note).queryByRole("group", { name: "Message actions" }),
    ).toBeNull();
    const details = container.querySelector(".chat-work-entries");
    expect(details?.contains(note)).toBe(true);
    expect(
        within(details as HTMLElement).queryByText("Candidates recorded."),
    ).toBeNull();
    fireEvent.click(
        screen.getByRole("button", { name: "Inspect Find company reporting" }),
    );
    expect(
        within(details as HTMLElement).getByText("Candidates recorded."),
    ).toBeTruthy();
    expect(
        details?.contains(screen.getByText("The candidate list is ready.")),
    ).toBe(false);
});
