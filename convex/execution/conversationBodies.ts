import type { Doc, Id } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import { executionError } from "@convex/execution/errors";
import {
    completeRetainedText,
    retainedTextRange,
} from "@convex/execution/retainedText";
import type { nativeInputBodyValidator } from "@convex/execution/schema";
import { MAX_OPERATION_RESULT_BYTES } from "@convex/resourcePolicy";
import { type Infer, v } from "convex/values";

export function retainedReplyKey(turnId: Id<"agentConversationTurns">) {
    return `reply:${turnId}`;
}

export function retainedDeliveryKey(
    delivery: Pick<
        Doc<"agentMessageDeliveries">,
        "_id" | "role" | "delivery" | "turnId"
    >,
) {
    return delivery.role === "assistant" &&
        delivery.delivery === "reply" &&
        delivery.turnId
        ? retainedReplyKey(delivery.turnId)
        : `delivery:${delivery._id}`;
}

export function deliveryBodyHash(
    delivery: Pick<
        Doc<"agentMessageDeliveries">,
        "bodyContentHash" | "contentHash"
    >,
) {
    return delivery.bodyContentHash ?? delivery.contentHash;
}

/** Resolves a retained body using the delivery's ownership and independent body digest. */
export async function retainedDeliveryBody(
    ctx: QueryCtx,
    delivery: Doc<"agentMessageDeliveries">,
) {
    if (!delivery.bodyTextId)
        throw executionError("conversation_message_unavailable");
    if (
        delivery.role === "assistant" &&
        delivery.delivery === "reply" &&
        delivery.turnId
    ) {
        const turn = await ctx.db.get(delivery.turnId);
        if (
            !turn ||
            turn.runId !== delivery.runId ||
            turn.conversationId !== delivery.conversationId ||
            turn.publishedMessageId !== delivery._id
        )
            throw executionError("conversation_message_unavailable");
    } else if (!delivery.bodyContentHash) {
        throw executionError("conversation_message_unavailable");
    }
    const text = await completeRetainedText(ctx, delivery.bodyTextId);
    if (
        text.key !== retainedDeliveryKey(delivery) ||
        text.contentHash !== deliveryBodyHash(delivery)
    )
        throw executionError("conversation_message_unavailable");
    return text;
}

/** Reads admitted analyst input and server receipts within the existing message-admission capacity; generated replies use body ranges. */
export async function readConversationWording(
    ctx: QueryCtx,
    deliveries: Doc<"agentMessageDeliveries">[],
    loaded?: Map<Id<"agentMessageDeliveries">, string>,
) {
    const texts: string[] = [];
    for (const delivery of deliveries) {
        const cached = loaded?.get(delivery._id);
        if (cached !== undefined) {
            texts.push(cached);
            continue;
        }
        const body = await retainedDeliveryBody(ctx, delivery);
        if (
            (delivery.role !== "user" && delivery.turnId) ||
            body.sizeBytes > MAX_OPERATION_RESULT_BYTES
        )
            throw executionError("message_capacity");
        const text = await retainedTextRange(ctx, body, 0, body.characters);
        loaded?.set(delivery._id, text);
        texts.push(text);
    }
    return texts;
}

/** Native inputs retain the delivery identity; the worker reads exact bodies in fragment queries. */
export function nativeInputBody(
    delivery: Doc<"agentMessageDeliveries">,
): Infer<typeof nativeInputBodyValidator> {
    if (!delivery.bodyTextId)
        throw executionError("conversation_message_unavailable");
    return { messageId: delivery._id, contentHash: deliveryBodyHash(delivery) };
}

export const conversationBodyAccess = v.optional(v.literal("separate"));
export const conversationBodyReference = v.optional(
    v.object({ contentHash: v.string() }),
);

/** Listing never reads message bodies, independently of the number or width of the replies. */
export function conversationPageBodies(
    deliveries: Doc<"agentMessageDeliveries">[],
): Array<{ text: string; body?: { contentHash: string } }> {
    return deliveries.map((delivery) => {
        if (!delivery.bodyTextId)
            throw executionError("conversation_message_unavailable");
        return { text: "", body: { contentHash: deliveryBodyHash(delivery) } };
    });
}
