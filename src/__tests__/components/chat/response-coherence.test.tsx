import type { Doc } from "@convex/_generated/dataModel";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ConversationThread } from "@/components/chat/conversation-thread";
import {
    ConversationMessages,
    useWorkbenchConversation,
} from "@/components/chat/workbench-conversation";

function Reply({
    summary,
}: {
    summary: Doc<"agentMessageDeliveries">["responseControl"];
}) {
    const conversation = useWorkbenchConversation({
        messages: [
            {
                id: "answer",
                role: "assistant",
                content: "The original model explanation is preserved.",
                metadata: { custom: { responseControl: summary } },
            },
        ],
        draft: "",
        onDraftChange: () => {},
        onSend: () => {},
    });
    return (
        <ConversationThread runtime={conversation.runtime}>
            <ConversationMessages ids={["answer"]} />
        </ConversationThread>
    );
}
it("keeps the model explanation and presents a bounded consistency estimate separately", () => {
    render(<Reply summary={{ status: "review_needed", support: 0.62 }} />);
    expect(
        screen.getByText("The original model explanation is preserved."),
    ).toBeTruthy();
    expect(
        screen.getByText("Consistency with recorded actions: review needed"),
    ).toBeTruthy();
    expect(screen.getByText("Estimated consistency: 62%")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(
        /response_coherence|providerCallId|OPENROUTER|Jev/,
    );
});
it("does not invent a numerical score when checking is unavailable", () => {
    render(<Reply summary={{ status: "unavailable" }} />);
    expect(screen.getByText("Consistency check unavailable")).toBeTruthy();
    expect(screen.queryByText(/Estimated consistency:/)).toBeNull();
});
it.each([
    "checked",
    "not_checked",
] as const)("keeps %s replies free of an unnecessary warning", (status) => {
    render(<Reply summary={{ status, support: 0.99 }} />);
    expect(screen.queryByRole("note")).toBeNull();
});
