import { components } from "@convex/_generated/api";
import { executionError } from "@convex/execution/errors";
import { createThread, saveMessage } from "@convex-dev/agent";

export async function createConversationStorage(
    ctx: import("@convex/_generated/server").MutationCtx,
    owner: string,
) {
    return createThread(ctx, components.agent, { userId: owner });
}
export async function saveConversationMessage(
    ctx: import("@convex/_generated/server").MutationCtx,
    threadId: string,
    role: "user" | "assistant",
    text: string,
) {
    const saved = await saveMessage(ctx, components.agent, {
        threadId,
        message: { role, content: text },
    });
    return saved.messageId;
}
export async function readConversationMessages(
    ctx: import("@convex/_generated/server").QueryCtx,
    threadId: string,
    messageIds: string[],
) {
    const messages = await ctx.runQuery(
        components.agent.messages.getMessagesByIds,
        { messageIds },
    );
    return messages.map((message) => {
        if (!message || message.threadId !== threadId || !message.message)
            throw executionError("conversation_message_unavailable");
        const content = message.message.content;
        return typeof content === "string"
            ? content
            : content
                  .flatMap((part) => (part.type === "text" ? [part.text] : []))
                  .join("\n");
    });
}
