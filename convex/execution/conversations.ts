import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    type MutationCtx,
    mutation,
    type QueryCtx,
    query,
} from "@convex/_generated/server";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import {
    createConversationStorage,
    readConversationMessages,
    saveConversationMessage,
} from "@convex/integrations/agentStorage";
import {
    piMissionStateText,
    piRequiredContextTokens,
    piToolMetadata,
    requiredAnalystInput,
} from "@convex/integrations/modelInput";
import { SIMULATION_CONTEXT_WINDOW } from "@convex/integrations/modelRouting";
import {
    missionModel,
    modelPrepared,
    readResponseControlPolicy,
    requireReasoningEffort,
    resolveAgentModel,
} from "@convex/modelConfiguration";
import type { initialModelSelection } from "@convex/modelConfigurationSchema";
import {
    HISTORY_PAGE_SIZE,
    MAX_CONTEXT_BYTES,
    MAX_OPERATION_RESULT_BYTES,
} from "@convex/resourcePolicy";
import {
    localBrowserFixturesEnabled,
    readWorkbenchQualification,
    requireWorkspaceRun,
} from "@convex/runWorkspace";
import schema from "@convex/schema";
import {
    paginationOptsValidator,
    paginationResultValidator,
} from "convex/server";
import { type Infer, v } from "convex/values";
import { getAgentDefinition } from "./agentCatalog";
import { agentToolSchemas } from "./agentDefinition";
import {
    agentDefinitionIdValidator,
    agentScopeValidator,
} from "./agentSchemas";
import {
    recordMissionEvent,
    requireDossierAuthority,
    requireMissionAuthority,
} from "./authority";
import { executionError, executionFailureCode } from "./errors";
import { missionStatusValidator } from "./executionProtocol";
import { nextNativeInputSequence } from "./journal";
import { cancelPiWake, schedulePiMission } from "./piControl";
import { sessionForMission } from "./piStore";

async function conversationForRun(ctx: QueryCtx, runId: Id<"researchRuns">) {
    return ctx.db
        .query("agentConversations")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .unique();
}

/** Every newly processed batch receives one atomic, immutable visibility revision. */
async function advancePublication(
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
async function event(
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

/** Request identities are shared by ordinary messages and explicit control exchanges. */
export function requireConversationRequestKey(requestKey: string) {
    if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(requestKey))
        throw executionError("message_capacity");
}

/** Persists a server-owned control receipt without admitting a response or changing its queue. */
export async function recordControlExchange(
    ctx: MutationCtx,
    conversation: Doc<"agentConversations">,
    args: {
        requestKey: string;
        contentHash: string;
        name: NonNullable<
            Doc<"agentMessageDeliveries">["controlCommand"]
        >["name"];
        expectedGeneration: number;
        outcome: NonNullable<
            Doc<"agentMessageDeliveries">["controlCommand"]
        >["outcome"];
        text: string;
        nativeInputSequence?: number;
    },
) {
    const createdAt = Date.now();
    const publicationRevision = await advancePublication(ctx, conversation._id);
    const storageMessageRef = await saveConversationMessage(
        ctx,
        conversation.storageRef,
        "user",
        args.name,
    );
    const messageId = await ctx.db.insert("agentMessageDeliveries", {
        runId: conversation.runId,
        conversationId: conversation._id,
        requestKey: args.requestKey,
        contentHash: args.contentHash,
        storageMessageRef,
        role: "user",
        delivery: "control",
        status: "processed",
        publicationRevision,
        createdAt,
    });
    const confirmationRef = await saveConversationMessage(
        ctx,
        conversation.storageRef,
        "assistant",
        args.text,
    );
    const confirmationMessageId = await ctx.db.insert(
        "agentMessageDeliveries",
        {
            runId: conversation.runId,
            conversationId: conversation._id,
            requestKey: `control-reply:${messageId}`,
            contentHash: sha256Hex(args.text),
            storageMessageRef: confirmationRef,
            role: "assistant",
            delivery: "reply",
            status: "processed",
            publicationRevision,
            createdAt,
        },
    );
    await ctx.db.patch(messageId, {
        controlCommand: {
            name: args.name,
            expectedGeneration: args.expectedGeneration,
            outcome: args.outcome,
            confirmationMessageId,
        },
        nativeControlStatus: "pending",
        nativeInputSequence:
            args.nativeInputSequence ??
            (await nextNativeInputSequence(ctx, conversation.runId)),
    });
    await event(
        ctx,
        conversation.runId,
        "research_control_command",
        undefined,
        messageId,
    );
    return {
        messageId,
        confirmationMessageId,
        outcome: args.outcome,
        text: args.text,
    };
}

const messageInput = v.object({
    runId: v.id("researchRuns"),
    requestKey: v.string(),
    text: v.string(),
    delivery: v.union(v.literal("queue"), v.literal("steer")),
    turnId: v.optional(v.id("agentConversationTurns")),
});

/** Creates the owned thread and pins its initial model without inventing an analyst message. */
export async function ensureDossierConversation(
    ctx: MutationCtx,
    scope: Awaited<ReturnType<typeof requireDossierAuthority>>,
    initialModel?: Infer<typeof initialModelSelection>,
) {
    const { run, visitor } = scope;
    if (run.ownerVisitorId !== visitor._id)
        throw executionError("not_authorized");
    let conversation = await conversationForRun(ctx, run._id);
    if (!conversation) {
        const storageRef = await createConversationStorage(ctx, visitor._id);
        const setting = await ctx.db
            .query("agentModelSettings")
            .withIndex("by_agent", (q) => q.eq("agent", "workbench"))
            .unique();
        const selected = initialModel;
        const selectedConfiguration = selected
            ? await resolveAgentModel(ctx, "workbench", selected.catalogId)
            : null;
        const defaultModel = selected
            ? await ctx.db.get(selected.catalogId)
            : setting
              ? await ctx.db.get(setting.catalogId)
              : null;
        const defaultConfiguration =
            selectedConfiguration ??
            (defaultModel?.currentRevisionId
                ? await ctx.db.get(defaultModel.currentRevisionId)
                : null);
        const effort =
            selected?.reasoningEffort ?? defaultConfiguration?.reasoningEffort;
        if (selectedConfiguration)
            requireReasoningEffort(selectedConfiguration, effort);
        const id = await ctx.db.insert("agentConversations", {
            ...(defaultModel?.enabled && modelPrepared(defaultModel)
                ? {
                      modelCatalogId: defaultModel._id,
                      ...(effort ? { reasoningEffort: effort } : {}),
                  }
                : {}),
            ...((await ctx.db.get(run._id))?.startMode === "framed"
                ? {
                      definitionId: "workbench_v1" as const,
                      definitionVersion:
                          getAgentDefinition("workbench_v1").version,
                  }
                : {}),
            runId: run._id,
            storageRef,
            queuedCount: 0,
            createdAt: Date.now(),
        });
        conversation = await ctx.db.get(id);
    }
    if (!conversation) throw executionError("conversation_unavailable");
    return conversation;
}

/** Shared admission for application callers and explicitly labelled native fixture messages. */
export async function submitAuthorizedMessage(
    ctx: MutationCtx,
    args: Infer<typeof messageInput> & {
        initialModel?: Infer<typeof initialModelSelection>;
    },
    actor?: { type: "system" },
): Promise<Id<"agentMessageDeliveries">> {
    const { visitor, run } = await requireDossierAuthority(ctx, args.runId);
    requireConversationRequestKey(args.requestKey);
    if (
        !args.text.trim() ||
        new TextEncoder().encode(args.text).length > MAX_OPERATION_RESULT_BYTES
    )
        throw executionError("message_capacity");
    const contentHash = sha256Hex(
        stableStringify({
            text: args.text,
            delivery: args.delivery,
            turnId: args.turnId ?? null,
            ...(args.initialModel ? { initialModel: args.initialModel } : {}),
        }),
    );
    const previous = await ctx.db
        .query("agentMessageDeliveries")
        .withIndex("by_run_and_key", (q) =>
            q.eq("runId", args.runId).eq("requestKey", args.requestKey),
        )
        .unique();
    if (previous) {
        if (previous.contentHash !== contentHash)
            throw executionError("message_identity_conflict");
        return previous._id;
    }
    const conversation = await ensureDossierConversation(
        ctx,
        { run, visitor },
        args.initialModel,
    );
    const turn = args.turnId ? await ctx.db.get(args.turnId) : null;
    if (
        args.delivery === "steer" &&
        (turn?.status !== "active" ||
            conversation.activeTurnId !== turn._id ||
            turn.runId !== args.runId ||
            turn.conversationId !== conversation._id)
    )
        throw executionError("active_turn_required");
    if (args.delivery === "queue" && args.turnId)
        throw executionError("invalid_delivery_target");
    const storageMessageRef = await saveConversationMessage(
        ctx,
        conversation.storageRef,
        "user",
        args.text,
    );
    const messageId = await ctx.db.insert("agentMessageDeliveries", {
        runId: args.runId,
        conversationId: conversation._id,
        storageMessageRef,
        framingBaseRevisionId: run.currentFramingRevisionId,
        requestKey: args.requestKey,
        contentHash,
        role: "user",
        ...(args.delivery === "steer"
            ? {
                  nativeInputSequence: await nextNativeInputSequence(
                      ctx,
                      args.runId,
                  ),
              }
            : {}),
        delivery: args.delivery,
        status: args.delivery === "steer" ? "active" : "queued",
        turnId: args.delivery === "steer" ? turn?._id : undefined,
        createdAt: Date.now(),
    });
    if (args.delivery === "steer" && turn) {
        await ctx.db.patch(turn._id, {
            instructionVersion: turn.instructionVersion + 1,
            messageCount: turn.messageCount + 1,
        });
        if (turn.missionId) {
            const mission = await ctx.db.get(turn.missionId);
            if (!mission) throw executionError("mission_unavailable");
            const context = await ctx.runQuery(
                internal.execution.context.build,
                {
                    missionId: mission._id,
                    expectedGeneration: mission.generation,
                },
            );
            if (context.kind === "blocked") throw executionError(context.code);
        } else {
            await readTurnInstructions(ctx, {
                ...turn,
                instructionVersion: turn.instructionVersion + 1,
            });
        }
    } else
        await ctx.db.patch(conversation._id, {
            queuedCount: conversation.queuedCount + 1,
        });
    await event(
        ctx,
        args.runId,
        args.delivery === "steer" ? "turn_steered" : "message_queued",
        args.delivery === "steer" ? turn?._id : undefined,
        messageId,
        actor,
    );
    return messageId;
}
export const submit = mutation({
    args: messageInput.fields,
    returns: v.id("agentMessageDeliveries"),
    handler: async (ctx, args) => {
        await requireWorkspaceRun(ctx, args.runId);
        const existing = await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run_and_key", (q) =>
                q.eq("runId", args.runId).eq("requestKey", args.requestKey),
            )
            .unique();
        if (existing) return submitAuthorizedMessage(ctx, args);
        if (args.delivery === "queue") {
            const conversation = await conversationForRun(ctx, args.runId);
            const turn = conversation?.activeTurnId
                ? await ctx.db.get(conversation.activeTurnId)
                : null;
            const mission = turn?.missionId
                ? await ctx.db.get(turn.missionId)
                : null;
            if (turn && mission?.status === "blocked")
                await stopActiveResponse(ctx, {
                    runId: args.runId,
                    turnId: turn._id,
                });
        }
        const id = await submitAuthorizedMessage(ctx, args);
        const { run } = await requireDossierAuthority(ctx, args.runId);
        if (run.startMode === "framed") {
            const conversation = await conversationForRun(ctx, args.runId);
            if (conversation && !conversation.admissionFailure)
                await ctx.db.patch(conversation._id, { queuePaused: false });
            await ctx.scheduler.runAfter(
                0,
                internal.execution.conversations.pumpWorkbench,
                { runId: args.runId },
            );
        }
        return id;
    },
});

export const claimTurn = internalMutation({
    args: { runId: v.id("researchRuns"), single: v.optional(v.boolean()) },
    returns: v.union(v.id("agentConversationTurns"), v.null()),
    handler: async (ctx, { runId, single }) => {
        await requireDossierAuthority(ctx, runId);
        const conversation = await conversationForRun(ctx, runId);
        if (!conversation) return null;
        if (conversation.activeTurnId) return conversation.activeTurnId;
        const messages = await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", runId).eq("status", "queued"),
            )
            .take(single ? 1 : HISTORY_PAGE_SIZE);
        if (!messages.length) return null;
        const turnId = await ctx.db.insert("agentConversationTurns", {
            responseControl: {
                policy: await readResponseControlPolicy(ctx),
                checks: [],
            },
            runId,
            conversationId: conversation._id,
            status: "active",
            instructionVersion: 1,
            generation: 1,
            messageCount: messages.length,
            hasOperations: false,
            createdAt: Date.now(),
        });
        for (const message of messages)
            await ctx.db.patch(message._id, {
                turnId,
                status: "active",
                nativeInputSequence: await nextNativeInputSequence(ctx, runId),
            });
        await ctx.db.patch(conversation._id, {
            activeTurnId: turnId,
            queuedCount: conversation.queuedCount - messages.length,
        });
        await event(ctx, runId, "turn_started", turnId);
        return turnId;
    },
});

export const analystConversationTurn = schema
    .doc("agentConversationTurns")
    .omit("responseControl");
/** Public conversation views omit raw drafts, review requests and protected diagnostic observations. */
export function conversationTurnForAnalyst(
    turn: Doc<"agentConversationTurns">,
) {
    const { responseControl: _audit, ...visible } = turn;
    return visible;
}

export const get = query({
    args: { runId: v.id("researchRuns") },
    returns: v.object({
        queuedCount: v.number(),
        queuePaused: v.boolean(),
        admissionFailure:
            schema.tables.agentConversations.validator.fields.admissionFailure,
        execution: v.union(
            v.object({
                status: missionStatusValidator,
                code: v.optional(v.string()),
            }),
            v.null(),
        ),
        activeTurn: v.union(analystConversationTurn, v.null()),
    }),
    handler: async (ctx, { runId }) => {
        await requireWorkspaceRun(ctx, runId);
        const conversation = await conversationForRun(ctx, runId);
        const activeTurn = conversation?.activeTurnId
            ? await ctx.db.get(conversation.activeTurnId)
            : null;
        const mission = activeTurn?.missionId
            ? await ctx.db.get(activeTurn.missionId)
            : null;
        return {
            queuedCount: conversation?.queuedCount ?? 0,
            queuePaused: conversation?.queuePaused ?? false,
            admissionFailure: conversation?.admissionFailure,
            activeTurn: activeTurn
                ? conversationTurnForAnalyst(activeTurn)
                : null,
            execution: mission
                ? { status: mission.status, code: mission.blockCode }
                : null,
        };
    },
});

export const listMessages = query({
    args: {
        runId: v.id("researchRuns"),
        paginationOpts: paginationOptsValidator,
    },
    returns: paginationResultValidator(
        v.object({
            ...schema.tables.agentMessageDeliveries.validator.pick(
                "runId",
                "turnId",
                "role",
                "delivery",
                "status",
                "createdAt",
            ).fields,
            _id: v.id("agentMessageDeliveries"),
            text: v.string(),
            responseControl:
                schema.tables.agentMessageDeliveries.validator.fields
                    .responseControl,
        }),
    ),
    handler: async (ctx, args) => {
        await requireWorkspaceRun(ctx, args.runId);
        if (args.paginationOpts.numItems > HISTORY_PAGE_SIZE)
            throw executionError("history_page_capacity");
        const page = await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run", (q) => q.eq("runId", args.runId))
            .paginate(args.paginationOpts);
        const conversation = await conversationForRun(ctx, args.runId);
        if (!conversation) return { ...page, page: [] };
        const texts = await readConversationMessages(
            ctx,
            conversation.storageRef,
            page.page.map((message) => message.storageMessageRef),
        );
        return {
            ...page,
            page: page.page.map((message, index) => {
                const text = texts[index];
                if (text === undefined)
                    throw executionError("conversation_message_unavailable");
                return {
                    _id: message._id,
                    runId: message.runId,
                    turnId: message.turnId,
                    role: message.role,
                    delivery: message.delivery,
                    status: message.status,
                    createdAt: message.createdAt,
                    text,
                    ...(message.responseControl
                        ? { responseControl: message.responseControl }
                        : {}),
                };
            }),
        };
    },
});

/** Only the claimed turn's messages enter required context; queued messages remain outside it. */
export async function conversationInstructions(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
) {
    if (!mission.conversationTurnId) return undefined;
    const turn = await ctx.db.get(mission.conversationTurnId);
    if (!turn || turn.missionId !== mission._id || turn.status !== "active")
        throw executionError("active_turn_required");
    return readTurnInstructions(ctx, turn);
}

export async function readTurnInstructions(
    ctx: QueryCtx,
    turn: Doc<"agentConversationTurns">,
) {
    const conversation = await ctx.db.get(turn.conversationId);
    if (!conversation) throw executionError("conversation_unavailable");
    const messages = ctx.db
        .query("agentMessageDeliveries")
        .withIndex("by_turn", (q) => q.eq("turnId", turn._id));
    const result = {
        turnId: turn._id,
        instructionVersion: turn.instructionVersion,
        messages: [] as Array<{
            messageId: Id<"agentMessageDeliveries">;
            delivery: Doc<"agentMessageDeliveries">["delivery"];
            text: string;
        }>,
    };
    const mission = turn.missionId ? await ctx.db.get(turn.missionId) : null;
    const native = mission
        ? mission.executionRuntime === "pi-durable"
        : conversation.definitionId
          ? getAgentDefinition(
                conversation.definitionId,
                conversation.definitionVersion ?? 1,
            ).nativeConversation
          : false;
    let bytes = new TextEncoder().encode(JSON.stringify(result)).length;
    const batch: Doc<"agentMessageDeliveries">[] = [];
    const appendBatch = async () => {
        const texts = await readConversationMessages(
            ctx,
            conversation.storageRef,
            batch.map((message) => message.storageMessageRef),
        );
        for (const [index, message] of batch.entries()) {
            const text = texts[index];
            if (text === undefined)
                throw executionError("conversation_message_unavailable");
            const entry = {
                messageId: message._id,
                delivery: message.delivery,
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
        if (message.role !== "user") continue;
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

/** Publication and delivery acknowledgement share the application/component transaction. */
export async function publishTurn(
    ctx: MutationCtx,
    mission: Doc<"agentMissions">,
    text: string,
    instructionVersion: number | undefined,
) {
    if (!mission.conversationTurnId)
        throw executionError("active_turn_required");
    const turn = await ctx.db.get(mission.conversationTurnId);
    if (!turn) throw executionError("active_turn_required");
    const hash = sha256Hex(text);
    if (turn.publishedMessageId) {
        if (turn.publicationHash !== hash)
            throw executionError("publication_conflict");
        return turn.publishedMessageId;
    }
    await requireInstructionVersion(ctx, mission, instructionVersion);
    if (
        !text.trim() ||
        new TextEncoder().encode(text).length > MAX_OPERATION_RESULT_BYTES
    )
        throw executionError("response_capacity");
    const conversation = await ctx.db.get(turn.conversationId);
    if (!conversation) throw executionError("conversation_unavailable");
    const publicationRevision = await advancePublication(ctx, conversation._id);
    const storageMessageRef = await saveConversationMessage(
        ctx,
        conversation.storageRef,
        "assistant",
        text,
    );
    const messageId = await ctx.db.insert("agentMessageDeliveries", {
        ...(turn.responseControl?.summary
            ? { responseControl: turn.responseControl.summary }
            : {}),
        runId: mission.runId,
        conversationId: conversation._id,
        storageMessageRef,
        requestKey: `reply:${turn._id}`,
        contentHash: hash,
        role: "assistant",
        delivery: "reply",
        status: "processed",
        publicationRevision,
        turnId: turn._id,
        createdAt: Date.now(),
    });
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
    return messageId;
}

/** Cancellation drains deliveries in bounded transactions, retaining every original message. */
export const cancelPending = internalMutation({
    args: { runId: v.id("researchRuns"), cancelledAt: v.number() },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        const run = await ctx.db.get(args.runId);
        if (
            run?.executionStatus !== "cancelled" ||
            run.updatedAt !== args.cancelledAt
        )
            return null;
        const conversation = await conversationForRun(ctx, run._id);
        if (!conversation) return null;
        if (conversation.activeTurnId) {
            await ctx.db.patch(conversation.activeTurnId, {
                status: "cancelled",
                completedAt: args.cancelledAt,
            });
            await ctx.db.patch(conversation._id, { activeTurnId: undefined });
            await event(
                ctx,
                run._id,
                "turn_cancelled",
                conversation.activeTurnId,
            );
        }
        const queued = await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", run._id).eq("status", "queued"),
            )
            .take(HISTORY_PAGE_SIZE);
        const active = await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", run._id).eq("status", "active"),
            )
            .take(HISTORY_PAGE_SIZE);
        for (const message of [...queued, ...active])
            await ctx.db.patch(message._id, { status: "interrupted" });
        await ctx.db.patch(conversation._id, {
            queuedCount: Math.max(0, conversation.queuedCount - queued.length),
        });
        if (
            queued.length === HISTORY_PAGE_SIZE ||
            active.length === HISTORY_PAGE_SIZE
        )
            await ctx.scheduler.runAfter(
                0,
                internal.execution.conversations.cancelPending,
                args,
            );
        return null;
    },
});

const startTurnResult = v.union(
    v.object({
        turnId: v.id("agentConversationTurns"),
        missionId: v.id("agentMissions"),
    }),
    v.null(),
);

/** FIFO admission must leave an oversized next message queued before the native worker starts. */
async function requireConversationCapacity(
    ctx: QueryCtx,
    missionId: Id<"agentMissions">,
    inputJson: string,
) {
    const mission = await ctx.db.get(missionId);
    if (mission?.executionRuntime !== "pi-durable") return;
    const definition = getAgentDefinition(
        mission.definitionId,
        mission.definitionVersion,
    );
    const model = await missionModel(ctx, mission);
    const simulated = mission.provenance === "simulation";
    if (!simulated && !model) return;
    const contextWindow = simulated
        ? SIMULATION_CONTEXT_WINDOW
        : (model?.descriptor.contextWindow ?? SIMULATION_CONTEXT_WINDOW);
    const input: unknown = JSON.parse(inputJson);
    const tools = await Promise.all(
        Object.entries(agentToolSchemas(definition, input)).map(
            ([name, operation]) => piToolMetadata(name, operation),
        ),
    );
    const tokens = piRequiredContextTokens(
        definition.instructions,
        piMissionStateText(
            definition.instructions,
            inputJson,
            definition.nativeConversation,
            definition.contextRendering,
        ),
        tools,
        definition.nativeConversation
            ? requiredAnalystInput(inputJson)
            : undefined,
    );
    if (tokens >= contextWindow) throw executionError("context_capacity");
}

/** Claims only instructions that fit the assembled context before admitting the mission. */
export const startTurn = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        definitionId: agentDefinitionIdValidator,
        scope: agentScopeValidator,
        simulation: v.boolean(),
    },
    returns: startTurnResult,
    handler: async (ctx, args): Promise<Infer<typeof startTurnResult>> => {
        const conversation = await conversationForRun(ctx, args.runId);
        const currentDefinition = getAgentDefinition(args.definitionId);
        const definition = getAgentDefinition(
            args.definitionId,
            conversation?.definitionId === args.definitionId
                ? (conversation.definitionVersion ?? 1)
                : currentDefinition.nativeConversation && conversation
                  ? 1
                  : currentDefinition.version,
        );
        if (
            definition.executionScope !== "conversation" ||
            !definition.conversationReply
        )
            throw executionError("conversation_definition_required");
        const existingTurnId = (await conversationForRun(ctx, args.runId))
            ?.activeTurnId;
        const turnId = await ctx.runMutation(
            internal.execution.conversations.claimTurn,
            { runId: args.runId, single: true },
        );
        if (!turnId) return null;
        const turn = await ctx.db.get(turnId);
        if (!turn) throw executionError("active_turn_required");
        const missionId = await ctx.runMutation(
            internal.execution.missions.start,
            {
                runId: args.runId,
                definitionId: args.definitionId,
                scope: args.scope,
                conversationTurnId: turnId,
                expectedGeneration: turn.generation,
                requestKey: `turn:${turnId}`,
            },
        );
        await ctx.runMutation(internal.execution.missions.resume, {
            missionId,
            expectedGeneration: turn.generation,
            simulation: args.simulation,
        });
        const initialContext = await ctx.runQuery(
            internal.execution.context.build,
            { missionId, expectedGeneration: turn.generation },
        );
        if (initialContext.kind === "blocked")
            throw executionError(initialContext.code);
        await requireConversationCapacity(
            ctx,
            missionId,
            initialContext.inputJson,
        );
        for (
            let count = 1;
            !existingTurnId && count < HISTORY_PAGE_SIZE;
            count++
        ) {
            try {
                if (
                    !(await ctx.runMutation(
                        internal.execution.conversations.appendQueuedToTurn,
                        { missionId, expectedGeneration: turn.generation },
                    ))
                )
                    break;
            } catch (error) {
                if (executionFailureCode(error) !== "context_capacity")
                    throw error;
                break;
            }
        }
        if (!existingTurnId && definition.nativeConversation) {
            const admitted = await ctx.db.get(turnId);
            if (!admitted) throw executionError("active_turn_required");
            const instructions = await readTurnInstructions(ctx, admitted);
            await ctx.db.patch(turnId, {
                nativeInitialMessageIds: instructions.messages.map(
                    (message) => message.messageId,
                ),
                nativeInitialInstructionVersion:
                    instructions.instructionVersion,
            });
        }
        return { turnId, missionId };
    },
});

/** Each tentative delivery is a subtransaction, so capacity rejection leaves it queued. */
export const appendQueuedToTurn = internalMutation({
    args: { missionId: v.id("agentMissions"), expectedGeneration: v.number() },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        const { mission } = await requireMissionAuthority(
            ctx,
            args.missionId,
            args.expectedGeneration,
        );
        const turn = mission.conversationTurnId
            ? await ctx.db.get(mission.conversationTurnId)
            : null;
        if (turn?.status !== "active")
            throw executionError("active_turn_required");
        const conversation = await ctx.db.get(turn.conversationId);
        if (!conversation) throw executionError("conversation_unavailable");
        const next = await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", mission.runId).eq("status", "queued"),
            )
            .first();
        if (!next) return false;
        await ctx.db.patch(next._id, {
            status: "active",
            turnId: turn._id,
            nativeInputSequence: await nextNativeInputSequence(
                ctx,
                mission.runId,
            ),
        });
        await ctx.db.patch(turn._id, { messageCount: turn.messageCount + 1 });
        await ctx.db.patch(conversation._id, {
            queuedCount: conversation.queuedCount - 1,
        });
        const context = await ctx.runQuery(
            internal.execution.context.build,
            args,
        );
        if (context.kind === "blocked") throw executionError(context.code);
        await requireConversationCapacity(ctx, mission._id, context.inputJson);
        return true;
    },
});

export const removeQueued = mutation({
    args: {
        runId: v.id("researchRuns"),
        messageId: v.id("agentMessageDeliveries"),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await requireWorkspaceRun(ctx, args.runId);
        await requireDossierAuthority(ctx, args.runId);
        const message = await ctx.db.get(args.messageId);
        if (message?.runId !== args.runId)
            throw executionError("not_authorized");
        if (message.status === "removed") return null;
        if (message.status !== "queued")
            throw executionError("message_not_queued");
        const conversation = await ctx.db.get(message.conversationId);
        if (!conversation) throw executionError("conversation_unavailable");
        await ctx.db.patch(message._id, { status: "removed" });
        await ctx.db.patch(conversation._id, {
            queuedCount: Math.max(0, conversation.queuedCount - 1),
            ...(conversation.admissionFailure?.messageId === message._id
                ? { admissionFailure: undefined, queuePaused: false }
                : {}),
        });
        if (
            conversation.admissionFailure?.messageId === message._id &&
            conversation.queuedCount > 1
        )
            await ctx.scheduler.runAfter(
                0,
                internal.execution.conversations.pumpWorkbench,
                { runId: args.runId },
            );
        await event(ctx, args.runId, "message_removed", undefined, message._id);
        return null;
    },
});

export const promoteQueued = mutation({
    args: {
        runId: v.id("researchRuns"),
        messageId: v.id("agentMessageDeliveries"),
        turnId: v.id("agentConversationTurns"),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await requireWorkspaceRun(ctx, args.runId);
        await requireDossierAuthority(ctx, args.runId);
        const message = await ctx.db.get(args.messageId);
        const turn = await ctx.db.get(args.turnId);
        const conversation = await conversationForRun(ctx, args.runId);
        if (
            !message ||
            message.runId !== args.runId ||
            turn?.runId !== args.runId
        )
            throw executionError("not_authorized");
        if (message.status === "active" && message.turnId === turn._id)
            return null;
        if (
            message.status !== "queued" ||
            turn.status !== "active" ||
            conversation?.activeTurnId !== turn._id
        )
            throw executionError("active_turn_required");
        await ctx.db.patch(message._id, {
            status: "active",
            nativeInputSequence: await nextNativeInputSequence(ctx, args.runId),
            delivery: "steer",
            turnId: turn._id,
        });
        await ctx.db.patch(turn._id, {
            instructionVersion: turn.instructionVersion + 1,
            messageCount: turn.messageCount + 1,
        });
        await ctx.db.patch(conversation._id, {
            queuedCount: Math.max(0, conversation.queuedCount - 1),
        });
        if (turn.missionId) {
            const mission = await ctx.db.get(turn.missionId);
            if (!mission) throw executionError("mission_unavailable");
            const context = await ctx.runQuery(
                internal.execution.context.build,
                {
                    missionId: mission._id,
                    expectedGeneration: mission.generation,
                },
            );
            if (context.kind === "blocked") throw executionError(context.code);
        }
        await event(ctx, args.runId, "turn_steered", turn._id, message._id);
        return null;
    },
});

export const stopResponse = mutation({
    args: {
        runId: v.id("researchRuns"),
        turnId: v.id("agentConversationTurns"),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await requireWorkspaceRun(ctx, args.runId);
        return stopActiveResponse(ctx, args);
    },
});

export const resumeQueue = mutation({
    args: { runId: v.id("researchRuns") },
    returns: v.null(),
    handler: async (ctx, { runId }) => {
        await requireWorkspaceRun(ctx, runId);
        await requireDossierAuthority(ctx, runId);
        const conversation = await conversationForRun(ctx, runId);
        if (
            conversation?.admissionFailure?.code === "pi_storage_capacity" ||
            conversation?.admissionFailure?.code === "pi_commit_capacity" ||
            conversation?.admissionFailure?.code ===
                "native_settlement_incomplete"
        )
            throw executionError(conversation.admissionFailure.code);
        if (conversation)
            await ctx.db.patch(conversation._id, { queuePaused: false });
        await ctx.scheduler.runAfter(
            0,
            internal.execution.conversations.pumpWorkbench,
            { runId },
        );
        return null;
    },
});

/** Wakes one dossier's conversational work; research slots and research generation remain untouched. */
export const pumpWorkbench = internalMutation({
    args: { runId: v.id("researchRuns") },
    returns: v.null(),
    handler: async (ctx, { runId }): Promise<null> => {
        const { run } = await requireDossierAuthority(ctx, runId);
        const conversation = await conversationForRun(ctx, runId);
        if (
            run.startMode !== "framed" ||
            !conversation ||
            conversation.activeTurnId ||
            conversation.queuePaused ||
            !conversation.queuedCount
        )
            return null;
        try {
            if (
                conversation.definitionId &&
                getAgentDefinition(
                    conversation.definitionId,
                    conversation.definitionVersion ?? 1,
                ).nativeConversation
            ) {
                const session = await ctx.db
                    .query("piSessions")
                    .withIndex("by_conversation", (q) =>
                        q.eq("conversationId", conversation._id),
                    )
                    .unique();
                if (
                    session &&
                    (session.settledSequence !== session.sequence ||
                        session.leaseUntil > Date.now())
                ) {
                    await schedulePiMission(
                        ctx,
                        session.missionId,
                        session.generation,
                        Math.max(Date.now(), session.leaseUntil),
                    );
                    return null;
                }
            }
            await ctx.runMutation(internal.execution.conversations.startTurn, {
                runId,
                definitionId: "workbench_v1",
                scope: { kind: "workbench_v1" },
                simulation:
                    run.purpose === "browser_test" &&
                    localBrowserFixturesEnabled() &&
                    !(await readWorkbenchQualification(ctx, run)),
            });
            await ctx.db.patch(conversation._id, {
                admissionFailure: undefined,
            });
        } catch (error) {
            const code = executionFailureCode(error);
            if (!code) throw error;
            const message = await ctx.db
                .query("agentMessageDeliveries")
                .withIndex("by_run_and_status", (q) =>
                    q.eq("runId", runId).eq("status", "queued"),
                )
                .first();
            await ctx.db.patch(conversation._id, {
                queuePaused: true,
                admissionFailure: { code, messageId: message?._id },
            });
            await event(
                ctx,
                runId,
                "conversation_admission_blocked",
                undefined,
                message?._id,
            );
        }
        return null;
    },
});

async function stopActiveResponse(
    ctx: MutationCtx,
    args: { runId: Id<"researchRuns">; turnId: Id<"agentConversationTurns"> },
) {
    await requireDossierAuthority(ctx, args.runId);
    const conversation = await conversationForRun(ctx, args.runId);
    const turn = await ctx.db.get(args.turnId);
    if (turn?.runId !== args.runId) throw executionError("not_authorized");
    if (turn.status === "interrupted") return null;
    if (turn.status !== "active" || conversation?.activeTurnId !== turn._id)
        throw executionError("active_turn_required");
    if (turn.missionId) {
        const mission = await ctx.db.get(turn.missionId);
        if (mission) {
            if (mission.piWakeId) await cancelPiWake(ctx, mission.piWakeId);
            await ctx.db.patch(mission._id, {
                status: "cancelled",
                updatedAt: Date.now(),
                piWakeId: undefined,
                piWakeToken: undefined,
            });
            const session = await sessionForMission(ctx, mission);
            if (session?.conversationId && session.missionId === mission._id)
                await schedulePiMission(
                    ctx,
                    mission._id,
                    mission.generation,
                    Math.max(Date.now(), session.leaseUntil),
                );
        }
    }
    await ctx.db.patch(turn._id, {
        status: "interrupted",
        completedAt: Date.now(),
    });
    await ctx.db.patch(conversation._id, {
        activeTurnId: undefined,
        queuePaused: true,
    });
    await event(ctx, args.runId, "response_stopped", turn._id);
    return null;
}
