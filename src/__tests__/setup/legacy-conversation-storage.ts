import { components } from "@convex/_generated/api";
import type { MutationCtx } from "@convex/_generated/server";
import { executionError } from "@convex/execution/errors";
import { retainedTextParts } from "@convex/execution/retainedText";
import { createThread, saveMessage } from "@convex-dev/agent";

/** Seeds the historical component representation for migration and compatibility tests. */
export async function createConversationStorage(
    ctx: MutationCtx,
    owner: string,
) {
    return createThread(ctx, components.agent, { userId: owner });
}
export async function saveConversationMessage(
    ctx: MutationCtx,
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
