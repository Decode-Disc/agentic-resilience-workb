import { components, internal } from "@convex/_generated/api";
import { internalMutation } from "@convex/_generated/server";
import { executionError } from "@convex/execution/errors";
import { createThread, saveMessage } from "@convex-dev/agent";
import { v } from "convex/values";

/** Component storage is an adapter detail correlated atomically to its admitted invocation. */
export const prepare = internalMutation({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
    },
    returns: v.string(),
    handler: async (ctx, args): Promise<string> => {
        const { invocation, mission } = await ctx.runQuery(
            internal.execution.invocationLifecycle.forExecution,
            args,
        );
        if (
            invocation.generationBackend?.id !== "convex-agent" ||
            ![1, 2].includes(invocation.generationBackend.version)
        )
            throw executionError("generation_backend_unknown");
        if (invocation.receivedOutputJson)
            throw executionError("invocation_already_observed");
        if (invocation.generationStorageRef)
            return invocation.generationStorageRef;
        if (
            invocation.generationBackend.version === 2 &&
            mission.generationStorageRef
        ) {
            await ctx.db.patch(invocation._id, {
                generationStorageRef: mission.generationStorageRef,
            });
            return mission.generationStorageRef;
        }
        const reference = await createThread(ctx, components.agent, {
            userId: mission.ownerVisitorId,
            title: `Invocation ${invocation._id}`,
        });
        if (invocation.generationBackend.version === 2)
            await ctx.db.patch(mission._id, {
                generationStorageRef: reference,
            });
        await ctx.db.patch(invocation._id, { generationStorageRef: reference });
        return reference;
    },
});

/** Application transactions own delivery; the Agent component owns message bodies. */
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
