import { components } from "@convex/_generated/api";
import { retainedTextParts } from "@convex/execution/retainedText";
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
    const ids: string[] = [];
    for (const part of retainedTextParts(text).parts) {
        const saved = await saveMessage(ctx, components.agent, {
            threadId,
            message: { role, content: part },
        });
        ids.push(saved.messageId);
    }
    // One application delivery can own several component messages; old single-message references remain valid.
    const first = ids[0];
    if (!first) throw executionError("conversation_message_unavailable");
    return ids.length === 1 ? first : JSON.stringify(ids);
}
export async function readConversationMessages(
    ctx: import("@convex/_generated/server").QueryCtx,
    threadId: string,
    messageIds: string[],
) {
    const groups = messageIds.map((ref) => {
        if (!ref.startsWith("[")) return [ref];
        const ids: unknown = JSON.parse(ref);
        if (
            !Array.isArray(ids) ||
            !ids.length ||
            !ids.every((id) => typeof id === "string")
        )
            throw executionError("conversation_message_unavailable");
        return ids;
    });
    const messages = await ctx.runQuery(
        components.agent.messages.getMessagesByIds,
        { messageIds: groups.flat() },
    );
    let offset = 0;
    return groups.map((ids) =>
        ids
            .map(() => {
                const message = messages[offset++];
                if (
                    !message ||
                    message.threadId !== threadId ||
                    !message.message
                )
                    throw executionError("conversation_message_unavailable");
                const content = message.message.content;
                return typeof content === "string"
                    ? content
                    : content
                          .flatMap((part) =>
                              part.type === "text" ? [part.text] : [],
                          )
                          .join("\n");
            })
            .join(""),
    );
}
