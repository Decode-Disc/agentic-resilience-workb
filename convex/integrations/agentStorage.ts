import { components, internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
    type ActionCtx,
    internalAction,
    internalQuery,
    type QueryCtx,
} from "@convex/_generated/server";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { executionError } from "@convex/execution/errors";
import {
    completeRetainedText,
    readRetainedText,
    retainedTextFragment,
    retainedTextParts,
} from "@convex/execution/retainedText";
import type { nativeInputBodyValidator } from "@convex/execution/schema";
import { HISTORY_PAGE_SIZE } from "@convex/resourcePolicy";
import {
    type FunctionReturnType,
    paginationResultValidator,
} from "convex/server";
import { type Infer, v } from "convex/values";

function legacyReferenceIds(ref: string): string[] {
    if (!ref.startsWith("[")) return [ref];
    let ids: unknown;
    try {
        ids = JSON.parse(ref);
    } catch {
        throw executionError("conversation_message_unavailable");
    }
    if (
        !Array.isArray(ids) ||
        !ids.length ||
        !ids.every((id) => typeof id === "string")
    )
        throw executionError("conversation_message_unavailable");
    return ids;
}

type LegacyMessage = NonNullable<
    FunctionReturnType<
        typeof components.agent.messages.getMessagesByIds
    >[number]
>;

function legacyMessageText(message: LegacyMessage, threadId: string) {
    if (message.threadId !== threadId || !message.message)
        throw executionError("conversation_message_unavailable");
    const content = message.message.content;
    return typeof content === "string"
        ? content
        : content
              .flatMap((part) => (part.type === "text" ? [part.text] : []))
              .join("\n");
}

async function readLegacyMessages(
    ctx: QueryCtx,
    threadId: string,
    messageIds: string[],
) {
    const groups = messageIds.map(legacyReferenceIds);
    const messages = await ctx.runQuery(
        components.agent.messages.getMessagesByIds,
        { messageIds: groups.flat() },
    );
    let offset = 0;
    return groups.map((ids) =>
        ids
            .map(() => {
                const message = messages[offset++];
                if (!message)
                    throw executionError("conversation_message_unavailable");
                return legacyMessageText(message, threadId);
            })
            .join(""),
    );
}

export function legacyDeliveryIdentity(
    delivery: Doc<"agentMessageDeliveries">,
    conversation: Doc<"agentConversations">,
) {
    return sha256Hex(
        stableStringify({
            deliveryId: delivery._id,
            runId: delivery.runId,
            conversationId: conversation._id,
            threadId: conversation.storageRef,
            reference: delivery.storageMessageRef,
            role: delivery.role,
        }),
    );
}

export function deliveryMigrationTextKey(
    deliveryId: Id<"agentMessageDeliveries">,
) {
    return `delivery:${deliveryId}:migration`;
}

async function legacyThreadOwners(ctx: QueryCtx, threadId: string) {
    return ctx.db
        .query("agentConversations")
        .withIndex("by_storage_ref", (q) => q.eq("storageRef", threadId))
        .take(2);
}

/** Source ownership must stay exclusive across migration reads and writes. */
export async function requireExclusiveLegacyThread(
    ctx: QueryCtx,
    threadId: string,
) {
    const [, duplicate] = await legacyThreadOwners(ctx, threadId);
    if (duplicate)
        throw executionError(
            "conversation_migration_duplicate_component_owner",
        );
}

/** Classifies a physical thread from the migration inventory by its application ownership. */
export const componentThreadMigrationOwner = internalQuery({
    args: { threadId: v.string() },
    returns: v.union(
        v.object({ status: v.literal("owned"), runId: v.id("researchRuns") }),
        v.object({
            status: v.union(
                v.literal("unclaimed"),
                v.literal("ambiguous"),
                v.literal("missing"),
            ),
        }),
    ),
    handler: async (ctx, { threadId }) => {
        const thread = await ctx.runQuery(components.agent.threads.getThread, {
            threadId,
        });
        if (!thread) return { status: "missing" as const };
        const [owner, duplicate] = await legacyThreadOwners(ctx, threadId);
        if (duplicate) return { status: "ambiguous" as const };
        return owner
            ? { status: "owned" as const, runId: owner.runId }
            : { status: "unclaimed" as const };
    },
});

const frozenMigrationScopeValidator = v.object({
    conversationId: v.id("agentConversations"),
    storageRef: v.optional(v.string()),
    epoch: v.number(),
});

async function readFrozenMigrationScope(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
) {
    const run = await ctx.db.get(runId);
    const conversation = await ctx.db
        .query("agentConversations")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .unique();
    if (
        !run ||
        run.withdrawnAt !== undefined ||
        !conversation?.storageMigrationFrozen
    )
        throw executionError("conversation_migration_not_frozen");
    if (conversation.storageRef)
        await requireExclusiveLegacyThread(ctx, conversation.storageRef);
    return {
        scope: {
            conversationId: conversation._id,
            storageRef: conversation.storageRef,
            epoch: conversation.storageMigrationEpoch ?? 0,
        },
        sourceInventoryHash: conversation.storageMigrationSourceHash,
    };
}

export const frozenMigrationScope = internalQuery({
    args: { runId: v.id("researchRuns") },
    returns: v.object({
        scope: frozenMigrationScopeValidator,
        sourceInventoryHash: v.optional(v.string()),
    }),
    handler: (ctx, { runId }) => readFrozenMigrationScope(ctx, runId),
});

/** Enumerates component records separately so unclaimed source records remain visible. */
export const componentMigrationInventory = internalQuery({
    args: {
        runId: v.id("researchRuns"),
        cursor: v.union(v.string(), v.null()),
    },
    returns: v.object({
        ...paginationResultValidator(
            v.object({
                messageId: v.string(),
                order: v.number(),
                stepOrder: v.number(),
                sourceContentHash: v.string(),
            }),
        ).fields,
        scope: frozenMigrationScopeValidator,
    }),
    handler: async (ctx, args) => {
        const { scope } = await readFrozenMigrationScope(ctx, args.runId);
        const { storageRef } = scope;
        if (!storageRef)
            return { scope, page: [], isDone: true, continueCursor: "" };
        const thread = await ctx.runQuery(components.agent.threads.getThread, {
            threadId: storageRef,
        });
        if (!thread)
            throw executionError("conversation_migration_component_missing");
        const page = await ctx.runQuery(
            components.agent.messages.listMessagesByThreadId,
            {
                threadId: storageRef,
                order: "asc",
                paginationOpts: { cursor: args.cursor, numItems: 1 },
            },
        );
        return {
            ...page,
            scope,
            page: page.page.map((message) => ({
                messageId: message._id,
                order: message.order,
                stepOrder: message.stepOrder,
                sourceContentHash: sha256Hex(
                    stableStringify(
                        message.message
                            ? {
                                  role: message.message.role,
                                  text: legacyMessageText(message, storageRef),
                              }
                            : null,
                    ),
                ),
            })),
        };
    },
});

/** Reconciles physical ownership before copying, or verifies switched bodies before reopening. */
export const reconcileConversationMigration = internalAction({
    args: {
        runId: v.id("researchRuns"),
        expectedEpoch: v.optional(v.number()),
        mode: v.optional(v.literal("source_inventory")),
    },
    returns: v.object({
        inventoryHash: v.string(),
        sourceInventoryHash: v.string(),
        conversationId: v.id("agentConversations"),
        epoch: v.number(),
        deliveries: v.number(),
        completedMissions: v.number(),
        componentMessages: v.number(),
    }),
    handler: async (
        ctx,
        { runId, expectedEpoch, mode },
    ): Promise<{
        inventoryHash: string;
        sourceInventoryHash: string;
        conversationId: Id<"agentConversations">;
        epoch: number;
        deliveries: number;
        completedMissions: number;
        componentMessages: number;
    }> => {
        const { scope: componentScope } = await ctx.runQuery(
            internal.integrations.agentStorage.frozenMigrationScope,
            { runId },
        );
        if (
            expectedEpoch !== undefined &&
            expectedEpoch !== componentScope.epoch
        )
            throw executionError("conversation_migration_source_changed");
        const preflight = mode === "source_inventory";
        const owners = new Set<string>();
        let inventoryHash = sha256Hex(
            stableStringify(preflight ? { runId, mode } : { runId }),
        );
        let sourceInventoryHash = sha256Hex(
            stableStringify({ runId, scope: componentScope, version: 3 }),
        );
        let deliveries = 0;
        let completedMissions = 0;
        let componentMessages = 0;
        let cursor: string | null = null;
        const record = (kind: string, row: unknown, source: unknown = row) => {
            inventoryHash = sha256Hex(
                stableStringify({ prior: inventoryHash, kind, row }),
            );
            sourceInventoryHash = sha256Hex(
                stableStringify({
                    prior: sourceInventoryHash,
                    kind,
                    row: source,
                }),
            );
        };
        for (;;) {
            const page: FunctionReturnType<
                typeof internal.execution.conversations.messageMigrationInventory
            > = await ctx.runQuery(
                internal.execution.conversations.messageMigrationInventory,
                {
                    runId,
                    paginationOpts: { cursor, numItems: HISTORY_PAGE_SIZE },
                },
            );
            for (const row of page.page) {
                if (
                    row.status === "inconsistent" ||
                    (!preflight &&
                        row.status !== "switched" &&
                        row.status !== "retained")
                )
                    throw executionError(
                        "conversation_migration_inventory_incomplete",
                    );
                if (row.sourceReference) {
                    for (const id of legacyReferenceIds(row.sourceReference)) {
                        if (owners.has(id))
                            throw executionError(
                                "conversation_migration_duplicate_component_owner",
                            );
                        owners.add(id);
                    }
                }
                if (!preflight && row.sourceReference) {
                    const verified = await compareLegacyDeliveryCopy(ctx, {
                        runId,
                        deliveryId: row.deliveryId,
                        switched: true,
                    });
                    if (
                        verified.textId !== row.textId ||
                        verified.contentHash !== row.retainedHash
                    )
                        throw executionError(
                            "conversation_migration_source_changed",
                        );
                }
                record("delivery", row, {
                    deliveryId: row.deliveryId,
                    sourceReference: row.sourceReference,
                    requestHash: row.requestHash,
                    retainedHash: row.sourceReference
                        ? undefined
                        : row.retainedHash,
                });
                deliveries++;
            }
            if (page.isDone) break;
            if (cursor === page.continueCursor)
                throw executionError(
                    "conversation_migration_inventory_stalled",
                );
            cursor = page.continueCursor;
        }
        cursor = null;
        for (;;) {
            const page: FunctionReturnType<
                typeof internal.execution.missionData.missionMigrationInventory
            > = await ctx.runQuery(
                internal.execution.missionData.missionMigrationInventory,
                {
                    runId,
                    paginationOpts: { cursor, numItems: HISTORY_PAGE_SIZE },
                },
            );
            for (const row of page.page) {
                if (row.status === "other") continue;
                if (
                    row.status === "inconsistent" ||
                    (!preflight &&
                        row.status !== "switched" &&
                        row.status !== "retained" &&
                        row.status !== "delivery_only")
                )
                    throw executionError(
                        "conversation_migration_inventory_incomplete",
                    );
                let sourceIdentity: string | undefined;
                if (!preflight && row.status === "switched") {
                    if (!row.textId || !row.retainedHash)
                        throw executionError(
                            "conversation_migration_inventory_incomplete",
                        );
                    sourceIdentity = await ctx.runAction(
                        internal.execution.missionData
                            .verifySwitchedMissionResult,
                        {
                            runId,
                            missionId: row.missionId,
                            textId: row.textId,
                            contentHash: row.retainedHash,
                        },
                    );
                } else if (
                    preflight &&
                    row.status !== "retained" &&
                    row.status !== "delivery_only"
                ) {
                    sourceIdentity = await ctx.runQuery(
                        internal.execution.missionData
                            .legacyMissionSourceIdentity,
                        { runId, missionId: row.missionId },
                    );
                }
                record("mission", row, {
                    missionId: row.missionId,
                    sourceIdentity,
                    definitionVersion: row.definitionVersion,
                    ...(row.status === "delivery_only"
                        ? { deliveryOnly: row.deliveryOnly }
                        : { resultTextId: row.resultTextId }),
                    retainedHash:
                        row.status === "retained"
                            ? row.retainedHash
                            : undefined,
                });
                completedMissions++;
            }
            if (page.isDone) break;
            if (cursor === page.continueCursor)
                throw executionError(
                    "conversation_migration_inventory_stalled",
                );
            cursor = page.continueCursor;
        }
        cursor = null;
        for (;;) {
            const page: FunctionReturnType<
                typeof internal.integrations.agentStorage.componentMigrationInventory
            > = await ctx.runQuery(
                internal.integrations.agentStorage.componentMigrationInventory,
                {
                    runId,
                    cursor,
                },
            );
            if (stableStringify(page.scope) !== stableStringify(componentScope))
                throw executionError("conversation_migration_source_changed");
            if (cursor === null) record("component_scope", componentScope);
            for (const row of page.page) {
                if (!owners.delete(row.messageId))
                    throw executionError(
                        "conversation_migration_unclaimed_component",
                    );
                const { messageId, order, stepOrder } = row;
                record("component", { messageId, order, stepOrder }, row);
                componentMessages++;
            }
            if (page.isDone) break;
            if (cursor === page.continueCursor)
                throw executionError(
                    "conversation_migration_inventory_stalled",
                );
            cursor = page.continueCursor;
        }
        if (owners.size)
            throw executionError("conversation_migration_component_missing");
        return {
            inventoryHash,
            sourceInventoryHash,
            conversationId: componentScope.conversationId,
            epoch: componentScope.epoch,
            deliveries,
            completedMissions,
            componentMessages,
        };
    },
});

/** Verifies and records the source inventory before the copy pass. */
export const prepareConversationMigration = internalAction({
    args: { runId: v.id("researchRuns") },
    returns: v.string(),
    handler: async (ctx, { runId }): Promise<string> => {
        const { conversationId, epoch, sourceInventoryHash } =
            await ctx.runAction(
                internal.integrations.agentStorage
                    .reconcileConversationMigration,
                { runId, mode: "source_inventory" },
            );
        await ctx.runMutation(
            internal.execution.conversations.recordMigrationSourceInventory,
            { runId, conversationId, epoch, sourceInventoryHash },
        );
        return sourceInventoryHash;
    },
});

/** Verifies the reviewed inventory again before lifting the writer fence. */
export const resumeVerifiedConversationMigration = internalAction({
    args: {
        runId: v.id("researchRuns"),
        inventoryHash: v.string(),
        sourceInventoryHash: v.string(),
    },
    returns: v.null(),
    handler: async (
        ctx,
        { runId, inventoryHash, sourceInventoryHash },
    ): Promise<null> => {
        const verified = await ctx.runAction(
            internal.integrations.agentStorage.reconcileConversationMigration,
            { runId },
        );
        if (verified.inventoryHash !== inventoryHash)
            throw executionError("conversation_migration_inventory_changed");
        if (verified.sourceInventoryHash !== sourceInventoryHash)
            throw executionError("conversation_migration_source_changed");
        return ctx.runMutation(
            internal.execution.conversations.resumeReconciledConversation,
            {
                runId,
                conversationId: verified.conversationId,
                epoch: verified.epoch,
                sourceInventoryHash,
            },
        );
    },
});

/** Reads one component message and binds ordered continuation to its delivery and thread. */
export const legacyMigrationFragment = internalQuery({
    args: {
        runId: v.id("researchRuns"),
        deliveryId: v.id("agentMessageDeliveries"),
        index: v.number(),
        sourceIdentity: v.optional(v.string()),
    },
    returns: v.object({
        sourceIdentity: v.string(),
        sourceMessageId: v.string(),
        order: v.number(),
        stepOrder: v.number(),
        text: v.string(),
        nextIndex: v.union(v.number(), v.null()),
    }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        const delivery = await ctx.db.get(args.deliveryId);
        if (
            !run ||
            run.withdrawnAt !== undefined ||
            !delivery?.storageMessageRef ||
            delivery.runId !== run._id
        )
            throw executionError("conversation_message_unavailable");
        const conversation = await ctx.db.get(delivery.conversationId);
        if (!conversation?.storageRef || conversation.runId !== run._id)
            throw executionError("conversation_message_unavailable");
        await requireExclusiveLegacyThread(ctx, conversation.storageRef);
        const sourceIdentity = legacyDeliveryIdentity(delivery, conversation);
        if (
            args.sourceIdentity !== undefined &&
            args.sourceIdentity !== sourceIdentity
        )
            throw executionError("conversation_migration_source_changed");
        const ids = legacyReferenceIds(delivery.storageMessageRef);
        const sourceMessageId = ids[args.index];
        if (
            !Number.isSafeInteger(args.index) ||
            args.index < 0 ||
            !sourceMessageId
        )
            throw executionError("conversation_migration_range");
        const [message] = await ctx.runQuery(
            components.agent.messages.getMessagesByIds,
            {
                messageIds: [sourceMessageId],
            },
        );
        if (
            !message ||
            message._id !== sourceMessageId ||
            message.message?.role !== delivery.role
        )
            throw executionError("conversation_message_unavailable");
        return {
            sourceIdentity,
            sourceMessageId,
            order: message.order,
            stepOrder: message.stepOrder,
            text: legacyMessageText(message, conversation.storageRef),
            nextIndex: args.index + 1 < ids.length ? args.index + 1 : null,
        };
    },
});

type LegacyDeliveryScope = {
    runId: Id<"researchRuns">;
    deliveryId: Id<"agentMessageDeliveries">;
};

async function readLegacyDeliveryInAction(
    ctx: ActionCtx,
    args: LegacyDeliveryScope,
) {
    const fragments: string[] = [];
    let index: number | null = 0;
    let sourceIdentity: string | undefined;
    while (index !== null) {
        const piece: FunctionReturnType<
            typeof internal.integrations.agentStorage.legacyMigrationFragment
        > = await ctx.runQuery(
            internal.integrations.agentStorage.legacyMigrationFragment,
            {
                ...args,
                index,
                sourceIdentity,
            },
        );
        sourceIdentity = piece.sourceIdentity;
        fragments.push(piece.text);
        index = piece.nextIndex;
    }
    if (!sourceIdentity)
        throw executionError("conversation_message_unavailable");
    return { sourceIdentity, content: fragments.join("") };
}

/** Stages one logical delivery through independent bounded reads and writes. */
export const copyLegacyDelivery = internalAction({
    args: {
        runId: v.id("researchRuns"),
        deliveryId: v.id("agentMessageDeliveries"),
    },
    returns: v.id("retainedTexts"),
    handler: async (ctx, args): Promise<Id<"retainedTexts">> => {
        const { sourceIdentity, content } = await readLegacyDeliveryInAction(
            ctx,
            args,
        );
        const { parts, manifest } = retainedTextParts(content);
        let textId: Id<"retainedTexts"> | undefined;
        for (const [part, content] of parts.entries())
            textId = await ctx.runMutation(
                internal.execution.conversations.stageMessageMigration,
                {
                    ...args,
                    sourceIdentity,
                    fragment: { ...manifest, index: part, content },
                },
            );
        if (!textId) throw executionError("conversation_message_unavailable");
        return textId;
    },
});

export const stagedMigrationFragment = internalQuery({
    args: {
        runId: v.id("researchRuns"),
        deliveryId: v.id("agentMessageDeliveries"),
        sourceIdentity: v.string(),
        index: v.number(),
        switched: v.boolean(),
    },
    returns: v.object({
        textId: v.id("retainedTexts"),
        content: v.string(),
        fragmentCount: v.number(),
    }),
    handler: async (ctx, args) => {
        const delivery = await ctx.db.get(args.deliveryId);
        const run = await ctx.db.get(args.runId);
        if (
            !run ||
            run.withdrawnAt !== undefined ||
            delivery?.runId !== run._id ||
            delivery.storageMigrationCopy?.sourceIdentity !==
                args.sourceIdentity
        )
            throw executionError("conversation_migration_source_changed");
        const copy = delivery.storageMigrationCopy;
        const text = args.switched
            ? await retainedDeliveryBody(ctx, delivery)
            : await completeRetainedText(ctx, copy.textId);
        if (
            text._id !== copy.textId ||
            (args.switched
                ? copy.verifiedHash !== text.contentHash
                : text.key !== deliveryMigrationTextKey(delivery._id))
        )
            throw executionError("conversation_migration_source_changed");
        return {
            textId: text._id,
            content: await retainedTextFragment(ctx, text, args.index),
            fragmentCount: text.fragmentHashes.length,
        };
    },
});

async function compareLegacyDeliveryCopy(
    ctx: ActionCtx,
    {
        switched,
        ...args
    }: {
        runId: Id<"researchRuns">;
        deliveryId: Id<"agentMessageDeliveries">;
        switched: boolean;
    },
) {
    const source = await readLegacyDeliveryInAction(ctx, args);
    const scope = { ...args, sourceIdentity: source.sourceIdentity };
    const reader = internal.integrations.agentStorage.stagedMigrationFragment;
    const first = await ctx.runQuery(reader, { ...scope, switched, index: 0 });
    const fragments = [first.content];
    for (let index = 1; index < first.fragmentCount; index++) {
        const next = await ctx.runQuery(reader, { ...scope, switched, index });
        if (
            next.textId !== first.textId ||
            next.fragmentCount !== first.fragmentCount
        )
            throw executionError("conversation_migration_source_changed");
        fragments.push(next.content);
    }
    if (fragments.join("") !== source.content)
        throw executionError("conversation_migration_body_mismatch");
    return {
        ...scope,
        textId: first.textId,
        contentHash: sha256Hex(source.content),
    };
}

/** Independently reconstructs both sides before recording a durable equality proof. */
export const verifyLegacyDeliveryCopy = internalAction({
    args: {
        runId: v.id("researchRuns"),
        deliveryId: v.id("agentMessageDeliveries"),
    },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        await recordLegacyDeliveryVerification(ctx, args);
        return null;
    },
});

async function recordLegacyDeliveryVerification(
    ctx: ActionCtx,
    args: {
        runId: Id<"researchRuns">;
        deliveryId: Id<"agentMessageDeliveries">;
    },
) {
    const verified = await compareLegacyDeliveryCopy(ctx, {
        ...args,
        switched: false,
    });
    await ctx.runMutation(
        internal.execution.conversations.verifyMessageMigration,
        verified,
    );
    return verified.sourceIdentity;
}

const migrationPageKind = v.union(
    v.literal("deliveries"),
    v.literal("missions"),
);
const migrationPageCursor = v.object({
    scopeHash: v.string(),
    position: v.string(),
});

/** Advances at most one record. Finish the delivery scan before migrating missions. */
export const migrateConversationPage = internalAction({
    args: {
        runId: v.id("researchRuns"),
        kind: migrationPageKind,
        cursor: v.union(migrationPageCursor, v.null()),
    },
    returns: v.object({
        continueCursor: migrationPageCursor,
        isDone: v.boolean(),
        migrated: v.number(),
    }),
    handler: async (
        ctx,
        { runId, kind, cursor },
    ): Promise<{
        continueCursor: Infer<typeof migrationPageCursor>;
        isDone: boolean;
        migrated: number;
    }> => {
        const { scope: frozenScope, sourceInventoryHash } = await ctx.runQuery(
            internal.integrations.agentStorage.frozenMigrationScope,
            { runId },
        );
        if (!sourceInventoryHash)
            throw executionError("conversation_migration_preflight_required");
        const scopeHash = sha256Hex(
            stableStringify({ runId, kind, frozenScope, sourceInventoryHash }),
        );
        if (cursor && cursor.scopeHash !== scopeHash)
            throw executionError("conversation_migration_source_changed");
        const paginationOpts = {
            cursor: cursor?.position ?? null,
            numItems: 1,
        };
        if (kind === "missions") {
            const { page, continueCursor, isDone } = await ctx.runQuery(
                internal.execution.missionData.missionMigrationInventory,
                { runId, paginationOpts },
            );
            const row = page[0];
            if (row?.status === "inconsistent")
                throw executionError(
                    "conversation_migration_inventory_incomplete",
                );
            const needsMigration =
                row?.status === "inline" ||
                row?.status === "fragmented" ||
                row?.status === "copying";
            if (needsMigration)
                await ctx.runAction(
                    internal.execution.missionData.migrateLegacyMissionResult,
                    { runId, missionId: row.missionId },
                );
            return {
                continueCursor: { scopeHash, position: continueCursor },
                isDone,
                migrated: needsMigration ? 1 : 0,
            };
        }

        const { page, continueCursor, isDone } = await ctx.runQuery(
            internal.execution.conversations.messageMigrationInventory,
            { runId, paginationOpts },
        );
        const row = page[0];
        if (row?.status === "inconsistent")
            throw executionError("conversation_migration_inventory_incomplete");
        if (!row || row.status === "switched" || row.status === "retained")
            return {
                continueCursor: { scopeHash, position: continueCursor },
                isDone,
                migrated: 0,
            };

        const scope = { runId, deliveryId: row.deliveryId };
        await ctx.runAction(
            internal.integrations.agentStorage.copyLegacyDelivery,
            scope,
        );
        const sourceIdentity = await recordLegacyDeliveryVerification(
            ctx,
            scope,
        );
        await ctx.runMutation(
            internal.execution.conversations.switchMessageMigration,
            { ...scope, sourceIdentity },
        );
        return {
            continueCursor: { scopeHash, position: continueCursor },
            isDone,
            migrated: 1,
        };
    },
});

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

/** Transitional complete-message reads preserve delivery order across both persisted representations. */
export async function readConversationMessages(
    ctx: QueryCtx,
    threadId: string | undefined,
    deliveries: Doc<"agentMessageDeliveries">[],
    loaded?: Map<Id<"agentMessageDeliveries">, string>,
) {
    const legacyReferences = deliveries.flatMap((delivery) => {
        if (delivery.bodyTextId) return [];
        if (!delivery.storageMessageRef)
            throw executionError("conversation_message_unavailable");
        return [delivery.storageMessageRef];
    });
    if (legacyReferences.length && !threadId)
        throw executionError("conversation_message_unavailable");
    const legacy =
        threadId && legacyReferences.length
            ? await readLegacyMessages(ctx, threadId, legacyReferences)
            : [];
    let index = 0;
    const texts: string[] = [];
    for (const delivery of deliveries) {
        if (delivery.bodyTextId) {
            // Only verified retained bodies are shared within one context assembly.
            const text =
                loaded?.get(delivery._id) ??
                (await readRetainedText(
                    ctx,
                    (
                        await retainedDeliveryBody(ctx, delivery)
                    )._id,
                ));
            loaded?.set(delivery._id, text);
            texts.push(text);
            continue;
        }
        const text = legacy[index++];
        if (text === undefined)
            throw executionError("conversation_message_unavailable");
        texts.push(text);
    }
    return texts;
}

/** Pins a native input body, with inline text only for unmigrated deliveries. */
export async function nativeInputBody(
    ctx: QueryCtx,
    conversation: Doc<"agentConversations">,
    delivery: Doc<"agentMessageDeliveries">,
): Promise<Infer<typeof nativeInputBodyValidator>> {
    const messageId = delivery._id;
    if (delivery.bodyTextId)
        return { messageId, contentHash: deliveryBodyHash(delivery) };
    const [text] = await readConversationMessages(
        ctx,
        conversation.storageRef,
        [delivery],
    );
    if (text === undefined)
        throw executionError("conversation_message_unavailable");
    return { messageId, text };
}

export const conversationBodyAccess = v.optional(v.literal("separate"));
export const conversationBodyReference = v.optional(
    v.object({ contentHash: v.string() }),
);

/** Retained bodies are always read separately so list transactions depend only on delivery metadata. */
export async function readConversationPageBodies(
    ctx: QueryCtx,
    threadId: string | undefined,
    deliveries: Doc<"agentMessageDeliveries">[],
) {
    const inline = deliveries.filter((delivery) => !delivery.bodyTextId);
    const texts = await readConversationMessages(ctx, threadId, inline);
    let index = 0;
    return deliveries.map((delivery) => {
        if (delivery.bodyTextId)
            return {
                text: "",
                body: { contentHash: deliveryBodyHash(delivery) },
            };
        const text = texts[index++];
        if (text === undefined)
            throw executionError("conversation_message_unavailable");
        return { text };
    });
}
