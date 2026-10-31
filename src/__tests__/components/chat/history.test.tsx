import { render, screen } from "@testing-library/react";
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
                messageIds={["start", "follow-up", "answer"]}
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
    expect(container.querySelectorAll("article")).toHaveLength(3);
});
