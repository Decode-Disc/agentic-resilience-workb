import type { ThreadMessageLike } from "@assistant-ui/react";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ConversationThread } from "@/components/chat/conversation-thread";
import {
    Message,
    MessageAuthor,
    MessageBody,
    MessageContent,
} from "@/components/chat/message";
import {
    ConversationMessages,
    useWorkbenchConversation,
} from "@/components/chat/workbench-conversation";

it("accepts an agent name independently of its assistant role", () => {
    render(
        <Message from="assistant" authorName="Evidence Agent">
            <MessageBody>
                <MessageAuthor />
                <MessageContent>
                    The retained filing supports this passage.
                </MessageContent>
            </MessageBody>
        </Message>,
    );
    const message = screen.getByRole("article", {
        name: "Evidence Agent message",
    });
    expect(message.getAttribute("data-role")).toBe("assistant");
    expect(screen.getByText("Evidence Agent")).toBeTruthy();
});

it("attributes runtime messages to the configured agents without visible author labels", () => {
    render(<ConversationFixture />);
    expect(
        screen.getByRole("article", { name: "Workbench Agent message" }),
    ).toBeTruthy();
    expect(
        screen.getByRole("article", { name: "Evidence Agent message" }),
    ).toBeTruthy();
    expect(screen.getByRole("article", { name: "You message" })).toBeTruthy();
    expect(screen.queryByText("Workbench Agent")).toBeNull();
    expect(screen.queryByText("Evidence Agent")).toBeNull();
});

const messages: ThreadMessageLike[] = [
    {
        id: "workbench",
        role: "assistant",
        content: "I can prepare the framing.",
    },
    {
        id: "evidence",
        role: "assistant",
        content: "The retained filing supports this passage.",
    },
    { id: "analyst", role: "user", content: "Inspect that passage." },
];

function ConversationFixture() {
    const conversation = useWorkbenchConversation({
        messages,
        draft: "",
        onDraftChange: () => {},
        onSend: () => {},
    });
    return (
        <ConversationThread runtime={conversation.runtime}>
            <ConversationMessages ids={["workbench", "analyst"]} />
            <ConversationMessages
                ids={["evidence"]}
                authorName="Evidence Agent"
            />
        </ConversationThread>
    );
}

it("attributes mixed runtime messages by their supplied agent identity", () => {
    const agents = {
        workbench: { id: "workbench", name: "Workbench Agent" },
        partner: { id: "partner", name: "Research Partner" },
    };
    function MixedAgents() {
        const conversation = useWorkbenchConversation({
            messages: [
                {
                    id: "one",
                    role: "assistant",
                    content: "Framing is ready.",
                    metadata: { custom: { agentId: "workbench" } },
                },
                {
                    id: "two",
                    role: "assistant",
                    content: "A competing reading is available.",
                    metadata: { custom: { agentId: "partner" } },
                },
            ],
            draft: "",
            onDraftChange: () => {},
            onSend: () => {},
        });
        return (
            <ConversationThread runtime={conversation.runtime}>
                <ConversationMessages agents={agents} />
            </ConversationThread>
        );
    }
    render(<MixedAgents />);
    expect(
        screen.getByRole("article", { name: "Research Partner message" }),
    ).toBeTruthy();
    expect(
        screen.getByRole("article", { name: "Workbench Agent message" }),
    ).toBeTruthy();
    expect(screen.queryByText("Research Partner")).toBeNull();
});

it("keeps an unresolved author explicit instead of attributing it to the default agent", () => {
    function UnresolvedAgent() {
        const conversation = useWorkbenchConversation({
            messages: [
                {
                    id: "retained",
                    role: "assistant",
                    content: "Retained statement.",
                    metadata: { custom: { agentId: "missing-agent" } },
                },
            ],
            draft: "",
            onDraftChange: () => {},
            onSend: () => {},
        });
        return (
            <ConversationThread runtime={conversation.runtime}>
                <ConversationMessages />
            </ConversationThread>
        );
    }
    render(<UnresolvedAgent />);
    expect(
        screen.getByRole("article", { name: "Unidentified agent message" }),
    ).toBeTruthy();
    expect(screen.getByText("Message attribution unavailable")).toBeTruthy();
    expect(
        screen.queryByRole("article", { name: "Workbench Agent message" }),
    ).toBeNull();
});
