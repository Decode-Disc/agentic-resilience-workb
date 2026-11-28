export {
    isApprovalReceiptMessage,
    recordApprovalNotice,
    recordControlExchange,
} from "./conversationCore";

import {
    event,
    insertRetainedDelivery,
    readTurnInstructions,
} from "./conversationCore";

export {
    conversationInstructions,
    publishTurn,
    readPreparedTurnWording,
    readTurnInstructions,
    requireInstructionVersion,
} from "./conversationCore";

import {
    piRequiredContextTokens,
    piToolMetadata,
} from "@convex/integrations/piModelAdapter";
import { analystTurnDeliveries } from "./conversationBodies";

export { analystTurnDeliveries } from "./conversationBodies";

import { internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    internalMutation,
    type MutationCtx,
    mutation,
    type QueryCtx,
    query,
} from "@convex/_generated/server";
import { savedMaterialBinding } from "@convex/domain/savedMaterialOperations";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import {
    conversationBodyAccess,
    conversationBodyReference,
    conversationPageBodies,
    deliveryBodyHash,
    retainedDeliveryBody,
} from "@convex/execution/conversationBodies";
import { retainedTextFragment } from "@convex/execution/retainedText";
import { readFramingCitationPolicy } from "@convex/framingCitationPolicy";
import {
    piMissionStateText,
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
import { taskMethodDefinitionVersion } from "@convex/qualificationAgentMethods";
import {
    HISTORY_PAGE_SIZE,
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
import { getAgentDefinition, resolveAgentDefinition } from "./agentCatalog";
import { agentToolSchemas } from "./agentDefinition";
import {
    agentDefinitionIdValidator,
    agentScopeValidator,
} from "./agentSchemas";
import { requireDossierAuthority, requireMissionAuthority } from "./authority";
import { executionError, executionFailureCode } from "./errors";
import { missionStatusValidator } from "./executionProtocol";
import { nextNativeInputSequence } from "./journal";
import { cancelPiWake, schedulePiMission } from "./piControl";
import { sessionForMission } from "./piSession";

async function conversationForRun(ctx: QueryCtx, runId: Id<"researchRuns">) {
    return ctx.db
        .query("agentConversations")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .unique();
}

/** Request identities are shared by ordinary messages and explicit control exchanges. */
export function requireConversationRequestKey(requestKey: string) {
    if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(requestKey))
        throw executionError("message_capacity");
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
                      definitionVersion: resolveAgentDefinition({
                          kind: "new",
                          definitionId: "workbench_v1",
                          comparisonVersion: await taskMethodDefinitionVersion(
                              ctx,
                              run,
                              "workbench_v1",
                          ),
                      }).version,
                  }
                : {}),
            runId: run._id,
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
    const messageId = await insertRetainedDelivery(
        ctx,
        {
            runId: args.runId,
            conversationId: conversation._id,
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
        },
        args.text,
    );
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
            ...(conversation.definitionId === "workbench_v1" &&
            savedMaterialBinding(
                conversation.definitionId,
                conversation.definitionVersion,
            ) === "referenced"
                ? {
                      framingCitationPolicy:
                          await readFramingCitationPolicy(ctx),
                  }
                : {}),
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
    .omit("responseControl", "framingCitationPolicy");
/** Public conversation views omit raw drafts, review requests and protected diagnostic observations. */
export function conversationTurnForAnalyst(
    turn: Doc<"agentConversationTurns">,
) {
    const {
        responseControl: _audit,
        framingCitationPolicy: _citationPolicy,
        ...visible
    } = turn;
    return {
        ...visible,
        preview:
            turn.preview?.instructionVersion === turn.instructionVersion
                ? turn.preview
                : undefined,
    };
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

/** History remains readable across research cancellation until the dossier is withdrawn. */
export async function requireConversationHistoryRun(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
) {
    const { run } = await requireWorkspaceRun(ctx, runId);
    if (run.withdrawnAt !== undefined) throw executionError("not_authorized");
}

export const listMessages = query({
    args: {
        runId: v.id("researchRuns"),
        paginationOpts: paginationOptsValidator,
        bodyAccess: conversationBodyAccess,
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
            body: conversationBodyReference,
            responseControl:
                schema.tables.agentMessageDeliveries.validator.fields
                    .responseControl,
        }),
    ),
    handler: async (ctx, args) => {
        await requireConversationHistoryRun(ctx, args.runId);
        if (args.paginationOpts.numItems > HISTORY_PAGE_SIZE)
            throw executionError("history_page_capacity");
        const page = await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run", (q) => q.eq("runId", args.runId))
            .paginate(args.paginationOpts);
        const conversation = await conversationForRun(ctx, args.runId);
        if (!conversation) return { ...page, page: [] };
        const bodies = conversationPageBodies(page.page);
        return {
            ...page,
            page: page.page.map((message, index) => {
                const body = bodies[index];
                if (!body)
                    throw executionError("conversation_message_unavailable");
                return {
                    _id: message._id,
                    runId: message.runId,
                    turnId: message.turnId,
                    role: message.role,
                    delivery: message.delivery,
                    status: message.status,
                    createdAt: message.createdAt,
                    ...body,
                    ...(message.responseControl
                        ? { responseControl: message.responseControl }
                        : {}),
                };
            }),
        };
    },
});

/** A delivery's body continues independently of the delivery list cursor. */
export const readMessageBody = query({
    args: {
        runId: v.id("researchRuns"),
        messageId: v.id("agentMessageDeliveries"),
        contentHash: v.string(),
        index: v.number(),
    },
    returns: v.object({
        content: v.string(),
        offset: v.number(),
        totalCharacters: v.number(),
        nextIndex: v.union(v.number(), v.null()),
    }),
    handler: async (ctx, args) => {
        await requireConversationHistoryRun(ctx, args.runId);
        const delivery = await ctx.db.get(args.messageId);
        if (
            !delivery ||
            delivery.runId !== args.runId ||
            deliveryBodyHash(delivery) !== args.contentHash
        )
            throw executionError("conversation_message_unavailable");
        const text = await retainedDeliveryBody(ctx, delivery);
        const content = await retainedTextFragment(ctx, text, args.index);
        const offset = args.index === 0 ? 0 : text.fragmentEnds[args.index - 1];
        const end = text.fragmentEnds[args.index];
        const nextIndex =
            args.index + 1 === text.fragmentHashes.length
                ? null
                : args.index + 1;
        if (
            offset === undefined ||
            end !== offset + content.length ||
            (nextIndex === null && end !== text.characters)
        )
            throw executionError("conversation_message_unavailable");
        return { content, offset, totalCharacters: text.characters, nextIndex };
    },
});

/** Only the claimed turn's messages enter required context; queued messages remain outside it. */
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
        const { run } = await requireDossierAuthority(ctx, args.runId);
        const comparisonVersion = await taskMethodDefinitionVersion(
            ctx,
            run,
            args.definitionId,
        );
        const definition = resolveAgentDefinition(
            conversation
                ? {
                      kind: "conversation",
                      conversation,
                      definitionId: args.definitionId,
                      comparisonVersion,
                  }
                : {
                      kind: "new",
                      definitionId: args.definitionId,
                      comparisonVersion,
                  },
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
            const messages = await analystTurnDeliveries(
                ctx,
                admitted._id,
            ).collect();
            await ctx.db.patch(turnId, {
                nativeInitialMessageIds: messages.map((message) => message._id),
                nativeInitialInstructionVersion: admitted.instructionVersion,
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
                resolveAgentDefinition({
                    kind: "conversation",
                    conversation,
                    definitionId: "workbench_v1",
                    comparisonVersion: await taskMethodDefinitionVersion(
                        ctx,
                        run,
                        "workbench_v1",
                    ),
                }).nativeConversation
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
            if (
                session?.publicPreview?.turnId === turn._id &&
                session.publicPreview.instructionVersion ===
                    turn.instructionVersion
            ) {
                const { turnId: _turn, ...preview } = session.publicPreview;
                await ctx.db.patch(turn._id, { preview });
            }
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
