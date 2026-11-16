import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { ConversationHistory } from "@/components/chat/conversation-history";
import { ConversationThread } from "@/components/chat/conversation-thread";
import { ConversationTurn } from "@/components/chat/conversation-turn";
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

function PartialHistory({
    withoutMessages = false,
    outsideCommentary = false,
}: {
    withoutMessages?: boolean;
    outsideCommentary?: boolean;
}) {
    const conversation = useWorkbenchConversation({
        messages: withoutMessages
            ? []
            : [
                  {
                      id: "answer",
                      role: "assistant",
                      content: "Retained answer on this page.",
                  },
              ],
        draft: "",
        onDraftChange: () => {},
        onSend: () => {},
    });
    return (
        <ConversationThread runtime={conversation.runtime}>
            <ConversationHistory
                entries={
                    withoutMessages ? [] : [{ kind: "message", id: "answer" }]
                }
                turns={[
                    {
                        id: "partial-turn",
                        state: withoutMessages ? "running" : "completed",
                        entries: [
                            ...(!withoutMessages || outsideCommentary
                                ? [
                                      {
                                          kind: "message" as const,
                                          id: "earlier-commentary",
                                          phase: "commentary" as const,
                                      },
                                  ]
                                : []),
                            {
                                kind: "operation",
                                operation: {
                                    id: "lookup",
                                    title: "Inspect company context",
                                    summary: "Checking recorded context.",
                                    state: withoutMessages
                                        ? "running"
                                        : "completed",
                                },
                            },
                            ...(!withoutMessages
                                ? [
                                      {
                                          kind: "message" as const,
                                          id: "answer",
                                          phase: "answer" as const,
                                      },
                                  ]
                                : []),
                        ],
                    },
                ]}
            />
        </ConversationThread>
    );
}

it("renders the answer when the first turn message is outside the supplied history page", () => {
    render(<PartialHistory />);
    expect(screen.getByText("Retained answer on this page.")).toBeTruthy();
    expect(screen.getAllByRole("article")).toHaveLength(1);
});

it("renders running work before the turn has any public message", () => {
    render(<PartialHistory withoutMessages />);
    expect(
        screen.getByRole("button", { name: "Inspect Inspect company context" }),
    ).toBeTruthy();
    expect(
        screen.getByRole("region", { name: "Work in progress" }),
    ).toBeTruthy();
});

it("keeps running work visible when its commentary is outside the supplied page", () => {
    render(<PartialHistory withoutMessages outsideCommentary />);
    expect(
        screen.getByRole("button", { name: "Inspect Inspect company context" }),
    ).toBeTruthy();
});

it("keeps a newly admitted turn visible before its first operation or public message", () => {
    render(
        <ConversationTurn
            turn={{ id: "new-turn", state: "running", entries: [] }}
            renderMessage={() => null}
        />,
    );
    expect(screen.getByRole("status").textContent).toBe("Working…");
});
it("shows a blocked turn without implying ongoing generation", () => {
    render(
        <ConversationTurn
            turn={{ id: "blocked-turn", state: "blocked", entries: [] }}
            renderMessage={() => null}
        />,
    );
    expect(screen.getByRole("status").textContent).toBe(
        "Response unavailable. Recorded work remains available.",
    );
});

it("loads retained work only while its disclosure is open", () => {
    render(
        <ConversationTurn
            turn={{
                id: "deferred",
                state: "completed",
                entries: [],
                workDetails: (open) =>
                    open ? <p>Retained operation detail</p> : null,
            }}
            renderMessage={() => null}
        />,
    );
    expect(screen.queryByText("Retained operation detail")).toBeNull();
    fireEvent.click(
        screen.getByRole("button", { name: "Inspect work for this turn" }),
    );
    expect(screen.getByText("Retained operation detail")).toBeTruthy();
    fireEvent.click(
        screen.getByRole("button", { name: "Inspect work for this turn" }),
    );
    expect(screen.queryByText("Retained operation detail")).toBeNull();
});
