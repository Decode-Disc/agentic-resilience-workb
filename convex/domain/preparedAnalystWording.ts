import type { Doc, Id } from "@convex/_generated/dataModel";
import { framingMessageUrls } from "@convex/domain/documentaryAccess";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import {
    explicitFramingPreservation,
    explicitResearchCommand,
} from "@convex/domain/workbenchContracts";
import { executionError } from "@convex/execution/errors";
import { RESPONSE_CONTROL_MAX_INPUT_BYTES } from "@convex/resourcePolicy";
import { type Infer, v } from "convex/values";

const analystWording = v.object({
    messageId: v.id("agentMessageDeliveries"),
    contentHash: v.string(),
    command: v.optional(
        v.union(v.literal("start"), v.literal("pause"), v.literal("resume")),
    ),
    preservesFraming: v.boolean(),
    urls: v.array(v.string()),
    text: v.optional(v.string()),
});

export const preparedAnalystWording = v.array(analystWording);
export type PreparedAnalystWording = Infer<typeof preparedAnalystWording>;

export type AnalystTurnWording = {
    turnId: Id<"agentConversationTurns">;
    instructionVersion: number;
    transmitted: PreparedAnalystWording;
    messages: (Omit<Infer<typeof analystWording>, "text"> & {
        delivery: Doc<"agentMessageDeliveries">["delivery"];
        receivedAt: string;
        text?: string;
    })[];
};

/** Exact wording is only needed by the response reviewer when its input can fit. */
export function projectAnalystWording(
    messages: readonly {
        messageId: Id<"agentMessageDeliveries">;
        text: string;
    }[],
): PreparedAnalystWording {
    const fitsReview =
        messages.reduce(
            (size, { text }) => size + new TextEncoder().encode(text).length,
            0,
        ) <= RESPONSE_CONTROL_MAX_INPUT_BYTES;
    return messages.map(({ messageId, text }) => ({
        messageId,
        contentHash: sha256Hex(text),
        command: explicitResearchCommand(text),
        preservesFraming: explicitFramingPreservation(text),
        urls: framingMessageUrls(text),
        ...(fitsReview ? { text } : {}),
    }));
}

/** Restores the exact revision preimage in the action using the same verified instruction bodies. */
export function materializeWordingRevision(
    template: string,
    texts: ReadonlyMap<string, string>,
) {
    const revision: unknown = JSON.parse(template);
    if (
        !revision ||
        typeof revision !== "object" ||
        !("analystRequests" in revision) ||
        !Array.isArray(revision.analystRequests)
    )
        throw executionError("invocation_result_invalid");
    const analystRequests: unknown[] = revision.analystRequests.map(
        (request: unknown) => {
            if (!request || typeof request !== "object")
                throw executionError("invocation_result_invalid");
            if (!("originalTextHash" in request)) return request;
            if (
                !("messageId" in request) ||
                typeof request.messageId !== "string"
            )
                throw executionError("invocation_result_invalid");
            const text = texts.get(request.messageId);
            if (
                text === undefined ||
                sha256Hex(text) !== request.originalTextHash
            )
                throw executionError("conversation_message_unavailable");
            const { originalTextHash, ...facts } = request;
            return { ...facts, originalText: text };
        },
    );
    return sha256Hex(stableStringify({ ...revision, analystRequests }));
}
