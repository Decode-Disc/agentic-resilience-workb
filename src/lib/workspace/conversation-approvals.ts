import type { ThreadMessageLike } from "@assistant-ui/react";

/**
 * Builds runtime message parts with text followed by one approval tool-call part per request.
 * Each part carries a result because the request is a recorded record whose live state the card reads;
 * without one, assistant-ui would report the message as waiting for a tool action forever.
 * The part id is scoped to the message, since a later reply may show the same request again.
 */
export function conversationMessageContent(
    messageId: string,
    text: string,
    approvalRequestIds: readonly string[],
): ThreadMessageLike["content"] {
    const parts: Exclude<ThreadMessageLike["content"], string>[number][] = [];
    if (text || approvalRequestIds.length === 0) {
        parts.push({ type: "text", text });
    }
    for (const id of approvalRequestIds) {
        parts.push({
            type: "tool-call",
            toolCallId: `${messageId}:approval:${id}`,
            toolName: "approval",
            args: { requestId: id },
            result: { requestId: id },
        });
    }
    return parts;
}
