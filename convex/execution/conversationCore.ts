import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "@convex/_generated/server";
import { sha256Hex } from "@convex/domain/hashing";
import type {
    AnalystTurnWording,
    PreparedAnalystWording,
} from "@convex/domain/preparedAnalystWording";
import { workbenchInstructionMessageIds } from "@convex/domain/workbenchInstructions";
import {
    HISTORY_PAGE_SIZE,
    MAX_CONTEXT_BYTES,
    RESPONSE_CONTROL_MAX_INPUT_BYTES,
    RETAINED_TEXT_INLINE_BYTES,
} from "@convex/resourcePolicy";
import { getAgentAuthority } from "./agentAuthorityCatalog";
import { recordMissionEvent } from "./authority";
import {
    analystTurnDeliveries,
    deliveryBodyHash,
    readConversationWording,
    retainedDeliveryBody,
    retainedDeliveryKey,
    retainedReplyKey,
} from "./conversationBodies";
import { executionError } from "./errors";
import { nextNativeInputSequence } from "./journal";
import {
    adoptRetainedTextKey,
    retainedTextParts,
    stageRetainedText,
} from "./retainedText";
export async function advancePublication(
    ctx: MutationCtx,
    conversationId: Id<"agentConversations">,
) {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw executionError("conversation_unavailable");
    const revision = (conversation.publicationRevision ?? 0) + 1;
    if (!Number.isSafeInteger(revision) || revision < 1)
        throw executionError("conversation_publication_invalid");
    await ctx.db.patch(conversationId, { publicationRevision: revision });
    return revision;
}
export async function event(
    ctx: MutationCtx,
    runId: Id<"researchRuns">,
    kind: string,
    turnId?: Id<"agentConversationTurns">,
    messageId?: Id<"agentMessageDeliveries">,
    actor?: Doc<"agentExecutionEvents">["actor"],
) {
    const run = await ctx.db.get(runId);
    const details: Omit<
        Doc<"agentExecutionEvents">,
        "_id" | "_creationTime"
    > = {
        actor:
            actor ??
            ([
                "message_queued",
                "turn_steered",
                "message_removed",
                "response_stopped",
                "queue_resumed",
                "research_control_command",
                "approval_decision",
            ].includes(kind) && run?.ownerVisitorId
                ? { type: "visitor", visitorId: run.ownerVisitorId }
                : { type: "system" }),
        runId,
        kind,
        cause: "analyst_conversation",
        conversationTurnId: turnId,
        messageId,
        occurredAt: Date.now(),
    };
    if (kind === "turn_steered" && turnId) {
        const turn = await ctx.db.get(turnId);
        const mission = turn?.missionId
            ? await ctx.db.get(turn.missionId)
            : null;
        if (mission) {
            await recordMissionEvent(ctx, mission, {
                ...details,
                historySource: "material",
            });
            return;
        }
    }
    await ctx.db.insert("agentExecutionEvents", details);
}

/** Atomically creates a delivery with its own body while preserving the request identity. */
export async function insertRetainedDelivery(
    ctx: MutationCtx,
    fields: Omit<
        Doc<"agentMessageDeliveries">,
        "_id" | "_creationTime" | "bodyTextId" | "bodyContentHash"
    >,
    text: string | Doc<"retainedTexts">,
) {
    if (typeof text !== "string") {
        if (
            fields.role !== "assistant" ||
            fields.delivery !== "reply" ||
            !fields.turnId ||
            fields.contentHash !== text.contentHash
        )
            throw executionError("publication_conflict");
        await adoptRetainedTextKey(
            ctx,
            text._id,
            retainedReplyKey(fields.turnId),
        );
        // A reply's publication identity already is its body digest.
        return ctx.db.insert("agentMessageDeliveries", {
            ...fields,
            bodyTextId: text._id,
        });
    }
    const deliveryId = await ctx.db.insert("agentMessageDeliveries", fields);
    const key = retainedDeliveryKey({ ...fields, _id: deliveryId });
    if (new TextEncoder().encode(text).length > RETAINED_TEXT_INLINE_BYTES)
        throw executionError("invocation_result_not_prepared");
    const { parts, manifest } = retainedTextParts(text);
    let bodyTextId: Id<"retainedTexts"> | undefined;
    for (const [index, content] of parts.entries())
        bodyTextId = await stageRetainedText(ctx, key, {
            ...manifest,
            index,
            content,
        });
    if (!bodyTextId) throw executionError("conversation_message_unavailable");
    await ctx.db.patch(deliveryId, {
        bodyTextId,
        bodyContentHash: manifest.contentHash,
    });
    return deliveryId;
}

export async function conversationInstructions(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
    loaded?: Map<Id<"agentMessageDeliveries">, string>,
) {
    if (!mission.conversationTurnId) return undefined;
    const turn = await ctx.db.get(mission.conversationTurnId);
    if (!turn || turn.missionId !== mission._id || turn.status !== "active")
        throw executionError("active_turn_required");
    return readTurnInstructions(ctx, turn, loaded);
}

/** Revalidates action-prepared wording against current turn and transmitted request identities. */
export async function readPreparedTurnWording(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
    wording: PreparedAnalystWording,
): Promise<AnalystTurnWording | null> {
    const turn = mission.conversationTurnId
        ? await ctx.db.get(mission.conversationTurnId)
        : null;
    if (turn?.missionId !== mission._id || turn.status !== "active")
        return null;

    const seen = new Set<Id<"agentMessageDeliveries">>();
    let bytes = 0;
    const check = async (delivery: Doc<"agentMessageDeliveries"> | null) => {
        const expected = wording[seen.size];
        if (
            !expected ||
            expected.messageId !== delivery?._id ||
            !delivery.bodyTextId ||
            expected.contentHash !== deliveryBodyHash(delivery) ||
            delivery.role !== "user" ||
            delivery.runId !== mission.runId ||
            delivery.conversationId !== turn.conversationId
        )
            return null;
        const manifest = await retainedDeliveryBody(ctx, delivery);
        if (
            expected.text !== undefined &&
            sha256Hex(expected.text) !== manifest.contentHash
        )
            return null;
        bytes += manifest.sizeBytes;
        seen.add(expected.messageId);
        return expected;
    };
    const messages: AnalystTurnWording["messages"] = [];
    for await (const delivery of analystTurnDeliveries(ctx, turn._id)) {
        const expected = await check(delivery);
        if (!expected) return null;
        messages.push({
            ...expected,
            delivery: delivery.delivery,
            receivedAt: new Date(delivery.createdAt).toISOString(),
        });
    }
    const transmitted: PreparedAnalystWording = [];
    for (const id of await workbenchInstructionMessageIds(ctx, mission.runId)) {
        if (seen.has(id)) continue;
        const expected = await check(await ctx.db.get(id));
        if (!expected) return null;
        transmitted.push(expected);
    }
    if (
        seen.size !== wording.length ||
        wording.some(
            (message) =>
                (message.text !== undefined) !==
                bytes <= RESPONSE_CONTROL_MAX_INPUT_BYTES,
        )
    )
        return null;
    return {
        turnId: turn._id,
        instructionVersion: turn.instructionVersion,
        messages,
        transmitted,
    };
}

export async function readTurnInstructions(
    ctx: QueryCtx,
    turn: Doc<"agentConversationTurns">,
    loaded?: Map<Id<"agentMessageDeliveries">, string>,
) {
    const conversation = await ctx.db.get(turn.conversationId);
    if (!conversation) throw executionError("conversation_unavailable");
    const messages = analystTurnDeliveries(ctx, turn._id);
    const result = {
        turnId: turn._id,
        instructionVersion: turn.instructionVersion,
        messages: [] as Array<{
            messageId: Id<"agentMessageDeliveries">;
            delivery: Doc<"agentMessageDeliveries">["delivery"];
            receivedAt: string;
            text: string;
        }>,
    };
    const mission = turn.missionId ? await ctx.db.get(turn.missionId) : null;
    const native = mission
        ? mission.executionRuntime === "pi-durable"
        : conversation.definitionId
          ? getAgentAuthority(
                conversation.definitionId,
                conversation.definitionVersion ?? 1,
            ).nativeConversation
          : false;
    let bytes = new TextEncoder().encode(JSON.stringify(result)).length;
    const batch: Doc<"agentMessageDeliveries">[] = [];
    const appendBatch = async () => {
        const texts = await readConversationWording(ctx, batch, loaded);
        for (const [index, message] of batch.entries()) {
            const text = texts[index];
            if (text === undefined)
                throw executionError("conversation_message_unavailable");
            const entry = {
                messageId: message._id,
                delivery: message.delivery,
                receivedAt: new Date(message.createdAt).toISOString(),
                text,
            };
            bytes +=
                new TextEncoder().encode(JSON.stringify(entry)).length +
                (result.messages.length ? 1 : 0);
            if (!native && bytes > MAX_CONTEXT_BYTES)
                throw executionError("context_capacity");
            result.messages.push(entry);
        }
        batch.length = 0;
    };
    for await (const message of messages) {
        batch.push(message);
        if (batch.length === HISTORY_PAGE_SIZE) await appendBatch();
    }
    if (batch.length) await appendBatch();
    return result;
}

export async function requireInstructionVersion(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
    instructionVersion: number | undefined,
) {
    if (!mission.conversationTurnId) return;
    const turn = await ctx.db.get(mission.conversationTurnId);
    if (
        !turn ||
        turn.missionId !== mission._id ||
        turn.status !== "active" ||
        turn.instructionVersion !== instructionVersion
    )
        throw executionError("stale_instructions");
}

/** Publishes the retained reply and acknowledges delivery in one transaction. */
export async function publishTurn(
    ctx: MutationCtx,
    mission: Doc<"agentMissions">,
    reply: string | Doc<"retainedTexts">,
    instructionVersion: number | undefined,
    preparedText?: Doc<"retainedTexts">,
) {
    if (!mission.conversationTurnId)
        throw executionError("active_turn_required");
    const turn = await ctx.db.get(mission.conversationTurnId);
    if (!turn) throw executionError("active_turn_required");
    const text = typeof reply === "string" ? reply : undefined;
    const preparedBody = typeof reply === "string" ? preparedText : reply;
    const hash =
        typeof reply === "string" ? sha256Hex(reply) : reply.contentHash;
    if (turn.publishedMessageId) {
        if (turn.publicationHash !== hash)
            throw executionError("publication_conflict");
        const existing = await ctx.db.get(turn.publishedMessageId);
        if (!existing) throw executionError("publication_conflict");
        return { bodyTextId: existing.bodyTextId, contentHash: hash };
    }
    await requireInstructionVersion(ctx, mission, instructionVersion);
    if (text !== undefined && !text.trim())
        throw executionError("response_capacity");
    const conversation = await ctx.db.get(turn.conversationId);
    if (!conversation) throw executionError("conversation_unavailable");
    const publicationRevision = await advancePublication(ctx, conversation._id);
    const requestKey = retainedReplyKey(turn._id);
    if (preparedBody && preparedBody.contentHash !== hash)
        throw executionError("publication_conflict");
    const messageId = await insertRetainedDelivery(
        ctx,
        {
            ...(turn.responseControl?.summary
                ? { responseControl: turn.responseControl.summary }
                : {}),
            runId: mission.runId,
            conversationId: conversation._id,
            requestKey,
            contentHash: hash,
            role: "assistant",
            delivery: "reply",
            status: "processed",
            publicationRevision,
            turnId: turn._id,
            createdAt: Date.now(),
        },
        preparedBody ?? reply,
    );
    const bodyTextId =
        preparedBody?._id ?? (await ctx.db.get(messageId))?.bodyTextId;
    if (!bodyTextId) throw executionError("publication_conflict");
    const messages = ctx.db
        .query("agentMessageDeliveries")
        .withIndex("by_turn", (q) => q.eq("turnId", turn._id));
    for await (const message of messages)
        await ctx.db.patch(message._id, {
            status: "processed",
            publicationRevision,
        });
    await ctx.db.patch(turn._id, {
        status: "published",
        preview: undefined,
        publishedMessageId: messageId,
        publicationHash: hash,
        completedAt: Date.now(),
    });
    await ctx.db.patch(conversation._id, {
        activeTurnId: undefined,
        ...(turn.responseControl?.factsRevisionHash
            ? {
                  responseFactsRevisionHash:
                      turn.responseControl.factsRevisionHash,
              }
            : {}),
    });
    await event(ctx, mission.runId, "turn_published", turn._id, messageId);
    const run = await ctx.db.get(mission.runId);
    if (run?.startMode === "framed" && !conversation.queuePaused)
        await ctx.scheduler.runAfter(
            0,
            internal.execution.conversations.pumpWorkbench,
            { runId: mission.runId },
        );
    return { bodyTextId, contentHash: hash };
}

export { analystTurnDeliveries } from "./conversationBodies";

type ControlCommandFields = NonNullable<
    Doc<"agentMessageDeliveries">["controlCommand"]
>;

export type ControlExchangeInput =
    | {
          kind: "command";
          name: ControlCommandFields["name"];
          expectedGeneration: number;
          outcome: ControlCommandFields["outcome"];
      }
    | {
          kind: "approval";
          requestId: Id<"approvalRequests">;
          text: string;
      };

const APPROVAL_RECEIPT_KEY_PREFIX = "approval-reply:";

/** An approval decision's confirmation stays in the model's history but is not shown: the approval card is the visible receipt. */
export function isApprovalReceiptMessage(
    message: Doc<"agentMessageDeliveries">,
) {
    return (
        message.approvalDecision !== undefined ||
        message.requestKey.startsWith(APPROVAL_RECEIPT_KEY_PREFIX)
    );
}

/** Persists a server-owned control or approval receipt without admitting a response or changing its queue. */
export async function recordControlExchange(
    ctx: MutationCtx,
    conversation: Doc<"agentConversations">,
    args: {
        requestKey: string;
        contentHash: string;
        exchange: ControlExchangeInput;
        text: string;
        nativeInputSequence?: number;
    },
) {
    const existing = await ctx.db
        .query("agentMessageDeliveries")
        .withIndex("by_run_and_key", (q) =>
            q.eq("runId", conversation.runId).eq("requestKey", args.requestKey),
        )
        .unique();
    if (existing) {
        if (existing.contentHash !== args.contentHash)
            throw executionError("message_identity_conflict");
        const confirmationMessageId =
            existing.controlCommand?.confirmationMessageId ??
            existing.approvalDecision?.confirmationMessageId;
        if (!confirmationMessageId)
            throw executionError("conversation_message_unavailable");
        return {
            messageId: existing._id,
            confirmationMessageId,
            text: args.text,
        };
    }
    const createdAt = Date.now();
    const publicationRevision = await advancePublication(ctx, conversation._id);
    const userText =
        args.exchange.kind === "command"
            ? args.exchange.name
            : args.exchange.text;
    const messageId = await insertRetainedDelivery(
        ctx,
        {
            runId: conversation.runId,
            conversationId: conversation._id,
            requestKey: args.requestKey,
            contentHash: args.contentHash,
            role: "user",
            delivery: "control",
            status: "processed",
            publicationRevision,
            createdAt,
        },
        userText,
    );
    const confirmationMessageId = await insertRetainedDelivery(
        ctx,
        {
            runId: conversation.runId,
            conversationId: conversation._id,
            requestKey: `${args.exchange.kind === "approval" ? APPROVAL_RECEIPT_KEY_PREFIX : "control-reply:"}${messageId}`,
            contentHash: sha256Hex(args.text),
            role: "assistant",
            delivery: "reply",
            status: "processed",
            publicationRevision,
            createdAt,
        },
        args.text,
    );
    await ctx.db.patch(messageId, {
        ...(args.exchange.kind === "command"
            ? {
                  controlCommand: {
                      name: args.exchange.name,
                      expectedGeneration: args.exchange.expectedGeneration,
                      outcome: args.exchange.outcome,
                      confirmationMessageId,
                  },
              }
            : {
                  approvalDecision: {
                      requestId: args.exchange.requestId,
                      confirmationMessageId,
                  },
              }),
        nativeControlStatus: "pending",
        nativeInputSequence:
            args.nativeInputSequence ??
            (await nextNativeInputSequence(ctx, conversation.runId)),
    });
    await event(
        ctx,
        conversation.runId,
        args.exchange.kind === "command"
            ? "research_control_command"
            : "approval_decision",
        undefined,
        messageId,
    );
    return {
        messageId,
        confirmationMessageId,
        text: args.text,
    };
}

/** Posts an idempotent display-only approval notice without syncing it to native history. */
export async function recordApprovalNotice(
    ctx: MutationCtx,
    conversation: Doc<"agentConversations">,
    args: { requestId: Id<"approvalRequests">; text: string },
): Promise<Id<"agentMessageDeliveries">> {
    const requestKey = `approval-notice:${args.requestId}`;
    const existing = await ctx.db
        .query("agentMessageDeliveries")
        .withIndex("by_run_and_key", (q) =>
            q.eq("runId", conversation.runId).eq("requestKey", requestKey),
        )
        .unique();
    if (existing) return existing._id;
    const publicationRevision = await advancePublication(ctx, conversation._id);
    return insertRetainedDelivery(
        ctx,
        {
            runId: conversation.runId,
            conversationId: conversation._id,
            requestKey,
            contentHash: sha256Hex(args.text),
            role: "assistant",
            delivery: "notice",
            status: "processed",
            approvalRequestId: args.requestId,
            publicationRevision,
            createdAt: Date.now(),
        },
        args.text,
    );
}
