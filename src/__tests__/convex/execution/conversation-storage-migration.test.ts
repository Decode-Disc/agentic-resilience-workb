import { api, components, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { MutationCtx } from "@convex/_generated/server";
import { sha256Hex } from "@convex/domain/sourcePassages";
import {
    completeRetainedText,
    retainedTextFragment,
    retainedTextParts,
    stageRetainedText,
} from "@convex/execution/retainedText";
import { readConversationMessages } from "@convex/integrations/agentStorage";
import {
    recoverPiHistoricalPublication,
    recoverPiPublication,
} from "@convex/integrations/piInvocation";
import { createThread, saveMessage } from "@convex-dev/agent";
import agentTest from "@convex-dev/agent/test";
import type { FunctionReturnType } from "convex/server";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedConversation } from "@/__tests__/setup/agent-harness";
import {
    createConversationStorage,
    saveConversationMessage,
} from "@/__tests__/setup/legacy-conversation-storage";
import { readMessageBodies } from "@/__tests__/setup/retained-messages";

afterEach(() => {
    vi.unstubAllEnvs();
});

async function legacyConversation(bytesRead?: number, local = false) {
    const fixture = await seedConversation(
        local,
        bytesRead ? { bytesRead } : false,
    );
    const { t, runId, userId } = fixture;
    const { threadId, conversationId } = await t.run(async (ctx) => {
        const threadId = await createConversationStorage(ctx, userId);
        const conversationId = await ctx.db.insert("agentConversations", {
            runId,
            storageRef: threadId,
            queuedCount: 0,
            createdAt: 1,
        });
        return { threadId, conversationId };
    });
    function delivery(
        ctx: MutationCtx,
        storageMessageRef: string,
        requestKey: string,
        text: string,
    ) {
        return ctx.db.insert("agentMessageDeliveries", {
            runId,
            conversationId,
            storageMessageRef,
            requestKey,
            contentHash: sha256Hex(text),
            role: "user",
            delivery: "queue",
            status: "queued",
            createdAt: 1,
        });
    }
    return { ...fixture, threadId, delivery };
}

async function freezeMigration(
    f: Awaited<ReturnType<typeof legacyConversation>>,
) {
    for (const phase of ["draining", "frozen", "active"] as const)
        await f.t.mutation(
            internal.execution.retainedText.advanceStreamUpgrade,
            { phase },
        );
    await f.t.mutation(internal.execution.conversations.beginMessageMigration, {
        runId: f.runId,
    });
}

test("migration pages resume after a lost response without repeating the switch", async () => {
    const f = await legacyConversation();
    const refs = await f.t.run(async (ctx) => {
        const references = [];
        for (const content of [
            "First historical input",
            "Second historical input",
        ]) {
            const reference = await saveConversationMessage(
                ctx,
                f.threadId,
                "user",
                content,
            );
            await f.delivery(ctx, reference, content, content);
            references.push(reference);
        }
        return references;
    });
    await freezeMigration(f);
    const reconcile =
        internal.integrations.agentStorage.reconcileConversationMigration;
    const preflight = await f.t.action(reconcile, {
        runId: f.runId,
        mode: "source_inventory",
    });
    expect(preflight).toMatchObject({ deliveries: 2, componentMessages: 2 });
    const migrate = internal.integrations.agentStorage.migrateConversationPage;
    const args = { runId: f.runId, kind: "deliveries" as const, cursor: null };
    await expect(f.t.action(migrate, args)).rejects.toThrow(
        "conversation_migration_preflight_required",
    );
    await expect(
        f.t.action(migrate, { ...args, kind: "missions" }),
    ).rejects.toThrow("conversation_migration_preflight_required");
    const prepare = () =>
        f.t.action(
            internal.integrations.agentStorage.prepareConversationMigration,
            { runId: f.runId },
        );
    await expect(prepare()).resolves.toBe(preflight.sourceInventoryHash);
    const reference = refs[0];
    assert(reference);
    const revisePhysicalBody = (content: string) =>
        f.t.run((ctx) =>
            ctx.runMutation(components.agent.messages.updateMessage, {
                messageId: reference,
                patch: { message: { role: "user", content } },
            }),
        );
    await revisePhysicalBody("Modified before copy");
    const changed = await f.t.action(reconcile, {
        runId: f.runId,
        mode: "source_inventory",
    });
    expect(changed.sourceInventoryHash).not.toBe(preflight.sourceInventoryHash);
    await expect(prepare()).rejects.toThrow(
        "conversation_migration_source_changed",
    );
    await revisePhysicalBody("First historical input");
    await expect(prepare()).resolves.toBe(preflight.sourceInventoryHash);
    const first = await f.t.action(migrate, args);
    expect(first).toMatchObject({ migrated: 1, isDone: false });
    expect(await f.t.action(migrate, args)).toEqual({ ...first, migrated: 0 });
    await expect(
        f.t.action(migrate, {
            ...args,
            kind: "missions",
            cursor: first.continueCursor,
        }),
    ).rejects.toThrow("conversation_migration_source_changed");
    const second = await f.t.action(migrate, {
        ...args,
        cursor: first.continueCursor,
    });
    expect(second.migrated).toBe(1);
    const done = second.isDone
        ? second
        : await f.t.action(migrate, {
              ...args,
              cursor: second.continueCursor,
          });
    expect(done.isDone).toBe(true);
    const scope = { runId: f.runId };
    const inventory = await f.t.action(
        internal.integrations.agentStorage.reconcileConversationMigration,
        scope,
    );
    expect(inventory).toMatchObject({ deliveries: 2, componentMessages: 2 });
    await expect(
        f.t.action(
            internal.integrations.agentStorage
                .resumeVerifiedConversationMigration,
            // @ts-expect-error Exercise the validator without the required preflight fingerprint.
            {
                ...scope,
                inventoryHash: inventory.inventoryHash,
            },
        ),
    ).rejects.toThrow(/missing.*sourceInventoryHash/i);
    expect(preflight.sourceInventoryHash).toMatch(/^[a-f0-9]{64}$/);
    expect(inventory.sourceInventoryHash).toBe(preflight.sourceInventoryHash);
    await expect(
        f.t.action(
            internal.integrations.agentStorage
                .resumeVerifiedConversationMigration,
            {
                ...scope,
                inventoryHash: inventory.inventoryHash,
                sourceInventoryHash: "0".repeat(64),
            },
        ),
    ).rejects.toThrow("conversation_migration_source_changed");
    await expect(
        f.t.action(
            internal.integrations.agentStorage
                .resumeVerifiedConversationMigration,
            {
                ...scope,
                inventoryHash: preflight.inventoryHash,
                sourceInventoryHash: preflight.sourceInventoryHash,
            },
        ),
    ).rejects.toThrow("conversation_migration_inventory_changed");
    await f.t.action(
        internal.integrations.agentStorage.resumeVerifiedConversationMigration,
        {
            ...scope,
            inventoryHash: inventory.inventoryHash,
            sourceInventoryHash: preflight.sourceInventoryHash,
        },
    );
    await f.t.mutation(
        internal.execution.conversations.beginMessageMigration,
        scope,
    );
    await prepare();
    await expect(
        f.t.action(migrate, { ...args, cursor: first.continueCursor }),
    ).rejects.toThrow("conversation_migration_source_changed");
});

test("component deletion can resume one large obsolete message at a time", async () => {
    const f = await legacyConversation(512 * 1024);
    const fragment = "界".repeat(25_000);
    const references = [];
    for (const [order, requestKey] of [
        "legacy-first",
        "legacy-second",
        "legacy-third",
    ].entries()) {
        const { messages } = await f.t.run((ctx) =>
            ctx.runMutation(components.agent.messages.addMessages, {
                threadId: f.threadId,
                order,
                messages: [{ message: { role: "user", content: fragment } }],
            }),
        );
        const reference = messages[0]?._id;
        assert(reference);
        await f.t.run((ctx) =>
            f.delivery(ctx, reference, requestKey, fragment),
        );
        references.push(reference);
    }
    await freezeMigration(f);
    await f.t.action(
        internal.integrations.agentStorage.prepareConversationMigration,
        {
            runId: f.runId,
        },
    );
    const migrate = internal.integrations.agentStorage.migrateConversationPage;
    const scan = { runId: f.runId, kind: "deliveries" as const };
    let cursor: FunctionReturnType<typeof migrate>["continueCursor"] | null =
        null;
    let migrated = 0;
    for (;;) {
        const page: FunctionReturnType<typeof migrate> = await f.t.action(
            migrate,
            { ...scan, cursor },
        );
        migrated += page.migrated;
        if (page.isDone) break;
        cursor = page.continueCursor;
    }
    expect(migrated).toBe(references.length);
    const inventory = await f.t.action(
        internal.integrations.agentStorage.reconcileConversationMigration,
        { runId: f.runId },
    );
    expect(inventory).toMatchObject({ deliveries: 3, componentMessages: 3 });

    const retained = await f.t.run((ctx) =>
        ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .collect(),
    );
    expect(retained).toHaveLength(3);
    const readBody = (messageId: Id<"agentMessageDeliveries">) =>
        f.client.query(api.execution.conversations.readMessageBody, {
            runId: f.runId,
            messageId,
            contentHash: sha256Hex(fragment),
            index: 0,
        });
    const remove = (messageId: string) =>
        f.t.run((ctx) =>
            ctx.runMutation(components.agent.messages.deleteByIds, {
                messageIds: [messageId],
            }),
        );
    for (const delivery of retained) {
        const reference = delivery.storageMessageRef;
        assert(reference && delivery.bodyTextId);
        const before = await readBody(delivery._id);
        expect(before).toMatchObject({ content: fragment, nextIndex: null });
        expect(await remove(reference)).toEqual([reference]);
        expect(await remove(reference)).toEqual([]);
        expect(await readBody(delivery._id)).toEqual(before);
    }
});

test("migration discovers legacy and retained conversation scopes before fencing", async () => {
    const f = await legacyConversation();
    const secondRunId = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        const { _id, _creationTime, ...fields } = run;
        const runId = await ctx.db.insert("researchRuns", fields);
        await ctx.db.insert("agentConversations", {
            runId,
            queuedCount: 0,
            createdAt: 2,
        });
        return runId;
    });
    const read = internal.execution.conversations.migrationScopes;
    const first = await f.t.query(read, {
        paginationOpts: { cursor: null, numItems: 1 },
    });
    expect(first.page).toMatchObject([
        { runId: f.runId, storageRef: f.threadId, frozen: false },
    ]);
    expect(first.isDone).toBe(false);
    const second = await f.t.query(read, {
        paginationOpts: { cursor: first.continueCursor, numItems: 1 },
    });
    expect(second.page).toMatchObject([{ runId: secondRunId, frozen: false }]);
    expect(second.page[0]).not.toHaveProperty("storageRef");
    await freezeMigration(f);
    const frozen = await f.t.query(read, {
        paginationOpts: { cursor: null, numItems: 1 },
    });
    expect(frozen.page).toMatchObject([{ runId: f.runId, frozen: true }]);
});

test("component thread inventory exposes threads without application owners", async () => {
    const f = await legacyConversation();
    const orphan = await f.t.run(async (ctx) => {
        const thread = await createConversationStorage(ctx, f.userId);
        await saveConversationMessage(
            ctx,
            thread,
            "user",
            "Unclaimed historical message",
        );
        return thread;
    });
    const read =
        internal.integrations.agentStorage.componentThreadMigrationOwner;
    await expect(f.t.query(read, { threadId: f.threadId })).resolves.toEqual({
        status: "owned",
        runId: f.runId,
    });
    await expect(f.t.query(read, { threadId: orphan })).resolves.toEqual({
        status: "unclaimed",
    });
    const deliveryId = await f.t.run(async (ctx) => {
        const content = "Historical input on a contested thread";
        const reference = await saveConversationMessage(
            ctx,
            f.threadId,
            "user",
            content,
        );
        return f.delivery(ctx, reference, "contested", content);
    });
    await freezeMigration(f);
    const scope = { runId: f.runId, deliveryId };
    const source = await f.t.query(
        internal.integrations.agentStorage.legacyMigrationFragment,
        { ...scope, index: 0 },
    );
    await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        const { _id, _creationTime, ...fields } = run;
        const runId = await ctx.db.insert("researchRuns", fields);
        await ctx.db.insert("agentConversations", {
            runId,
            storageRef: f.threadId,
            queuedCount: 0,
            createdAt: 2,
        });
    });
    await expect(
        f.t.action(internal.integrations.agentStorage.copyLegacyDelivery, {
            runId: f.runId,
            deliveryId,
        }),
    ).rejects.toThrow("conversation_migration_duplicate_component_owner");
    const { manifest } = retainedTextParts(source.text);
    await expect(
        f.t.mutation(internal.execution.conversations.stageMessageMigration, {
            ...scope,
            sourceIdentity: source.sourceIdentity,
            fragment: { ...manifest, index: 0, content: source.text },
        }),
    ).rejects.toThrow("conversation_migration_duplicate_component_owner");
    const delivery = await f.t.run((ctx) => ctx.db.get(deliveryId));
    expect(delivery?.storageMigrationCopy).toBeUndefined();
    expect(delivery?.bodyTextId).toBeUndefined();
    await expect(
        f.t.action(
            internal.integrations.agentStorage.reconcileConversationMigration,
            {
                runId: f.runId,
            },
        ),
    ).rejects.toThrow("conversation_migration_duplicate_component_owner");
    await expect(f.t.query(read, { threadId: f.threadId })).resolves.toEqual({
        status: "ambiguous",
    });
});

test("reconciliation refuses a missing empty legacy thread", async () => {
    const f = await legacyConversation();
    const reconcile =
        internal.integrations.agentStorage.reconcileConversationMigration;
    await freezeMigration(f);
    const inventory = await f.t.action(reconcile, { runId: f.runId });
    expect(inventory).toMatchObject({ componentMessages: 0, deliveries: 0 });
    await f.t.run(async (ctx) => {
        const storageRef = await createConversationStorage(ctx, f.userId);
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .unique();
        assert(conversation);
        await ctx.db.patch(conversation._id, { storageRef });
    });
    const changed = await f.t.action(reconcile, { runId: f.runId });
    expect(changed.inventoryHash).not.toBe(inventory.inventoryHash);
    const anotherComponent = agentTest.register(f.t, "otherAgent");
    const missingThreadId = await f.t.run(async (ctx) => {
        await createThread(ctx, anotherComponent, { userId: f.userId });
        await createThread(ctx, anotherComponent, { userId: f.userId });
        const threadId = await createThread(ctx, anotherComponent, {
            userId: f.userId,
        });
        assert(threadId !== f.threadId);
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .unique();
        assert(conversation);
        await ctx.db.patch(conversation._id, { storageRef: threadId });
        return threadId;
    });
    await expect(
        f.t.query(
            internal.integrations.agentStorage.componentThreadMigrationOwner,
            {
                threadId: missingThreadId,
            },
        ),
    ).resolves.toEqual({ status: "missing" });
    await expect(f.t.action(reconcile, { runId: f.runId })).rejects.toThrow(
        "conversation_migration_component_missing",
    );
});

test("verified migration reopens the same conversation without deleting its legacy thread", async () => {
    const f = await legacyConversation();
    await freezeMigration(f);
    const scope = { runId: f.runId };
    const inventory = await f.t.action(
        internal.integrations.agentStorage.reconcileConversationMigration,
        scope,
    );
    const reopen =
        internal.integrations.agentStorage.resumeVerifiedConversationMigration;
    await expect(
        f.t.action(reopen, {
            ...scope,
            inventoryHash: "0".repeat(64),
            sourceInventoryHash: inventory.sourceInventoryHash,
        }),
    ).rejects.toThrow("conversation_migration_inventory_changed");
    await expect(
        f.t.action(reopen, {
            ...scope,
            inventoryHash: inventory.inventoryHash,
            sourceInventoryHash: inventory.sourceInventoryHash,
        }),
    ).rejects.toThrow("conversation_migration_preflight_required");
    const prepare =
        internal.integrations.agentStorage.prepareConversationMigration;
    await expect(f.t.action(prepare, scope)).resolves.toBe(
        inventory.sourceInventoryHash,
    );
    await expect(f.t.action(prepare, scope)).resolves.toBe(
        inventory.sourceInventoryHash,
    );
    await f.t.action(reopen, {
        ...scope,
        inventoryHash: inventory.inventoryHash,
        sourceInventoryHash: inventory.sourceInventoryHash,
    });
    await f.t.mutation(
        internal.execution.conversations.beginMessageMigration,
        scope,
    );
    await expect(
        f.t.action(reopen, {
            ...scope,
            inventoryHash: inventory.inventoryHash,
            sourceInventoryHash: inventory.sourceInventoryHash,
        }),
    ).rejects.toThrow("conversation_migration_inventory_changed");
    await expect(
        f.t.action(
            internal.integrations.agentStorage.reconcileConversationMigration,
            {
                ...scope,
                expectedEpoch: inventory.epoch,
            },
        ),
    ).rejects.toThrow("conversation_migration_source_changed");
    const refrozen = await f.t.action(
        internal.integrations.agentStorage.reconcileConversationMigration,
        scope,
    );
    await expect(
        f.t.action(reopen, {
            ...scope,
            inventoryHash: refrozen.inventoryHash,
            sourceInventoryHash: refrozen.sourceInventoryHash,
        }),
    ).rejects.toThrow("conversation_migration_preflight_required");
    await expect(f.t.action(prepare, scope)).resolves.toBe(
        refrozen.sourceInventoryHash,
    );
    await f.t.action(reopen, {
        ...scope,
        inventoryHash: refrozen.inventoryHash,
        sourceInventoryHash: refrozen.sourceInventoryHash,
    });
    const messageId = await f.client.mutation(
        api.execution.conversations.submit,
        {
            ...scope,
            requestKey: "after-migration",
            text: "New retained message",
            delivery: "queue",
        },
    );
    expect(await f.t.run((ctx) => ctx.db.get(messageId))).toMatchObject({
        bodyTextId: expect.any(String),
    });
    await expect(
        f.t.query(
            internal.integrations.agentStorage.componentThreadMigrationOwner,
            {
                threadId: f.threadId,
            },
        ),
    ).resolves.toEqual({ status: "owned", runId: f.runId });
});

test("a frozen conversation refuses analyst queue changes without moving the delivery", async () => {
    const f = await legacyConversation();
    const messageId = await f.t.run(async (ctx) => {
        const text = "Queued before maintenance";
        const ref = await saveConversationMessage(
            ctx,
            f.threadId,
            "user",
            text,
        );
        const id = await f.delivery(ctx, ref, "frozen-queue", text);
        const message = await ctx.db.get(id);
        assert(message);
        await ctx.db.patch(message.conversationId, {
            queuedCount: 1,
            queuePaused: true,
        });
        return id;
    });
    await freezeMigration(f);
    const before = await f.t.run(async (ctx) => {
        const message = await ctx.db.get(messageId);
        assert(message);
        return {
            message,
            conversation: await ctx.db.get(message.conversationId),
        };
    });
    await expect(
        f.client.mutation(api.execution.conversations.removeQueued, {
            runId: f.runId,
            messageId,
        }),
    ).rejects.toThrow("conversation_migration_frozen");
    await expect(
        f.client.mutation(api.execution.conversations.resumeQueue, {
            runId: f.runId,
        }),
    ).rejects.toThrow("conversation_migration_frozen");
    expect(
        await f.t.run(async (ctx) => ({
            message: await ctx.db.get(messageId),
            conversation: await ctx.db.get(before.message.conversationId),
        })),
    ).toEqual(before);
});

test("legacy conversation extraction preserves text-part newlines and concatenates component fragments directly", async () => {
    const f = await legacyConversation();
    const single = "Single message 🧭";
    const multiple = "First part\nSecond part 😀Next component\n";
    const ids = await f.t.run(async (ctx) => {
        const first = await saveConversationMessage(
            ctx,
            f.threadId,
            "user",
            single,
        );
        const firstFragment = await saveMessage(ctx, components.agent, {
            threadId: f.threadId,
            message: {
                role: "user",
                content: [
                    { type: "text", text: "First part" },
                    { type: "text", text: "Second part 😀" },
                ],
            },
        });
        const secondFragment = await saveConversationMessage(
            ctx,
            f.threadId,
            "user",
            "Next component\n",
        );
        return [
            await f.delivery(ctx, first, "single", single),
            await f.delivery(
                ctx,
                JSON.stringify([firstFragment.messageId, secondFragment]),
                "multiple",
                multiple,
            ),
        ];
    });
    expect(
        await f.t.run(async (ctx) => {
            const deliveries = await Promise.all(
                ids.map((id) => ctx.db.get(id)),
            );
            const [first, second] = deliveries;
            assert(first && second);
            return readConversationMessages(ctx, f.threadId, [first, second]);
        }),
    ).toEqual([single, multiple]);
    const [singleId, multiId] = ids;
    assert(singleId && multiId);
    const reader = internal.integrations.agentStorage.legacyMigrationFragment;
    const first = await f.t.query(reader, {
        runId: f.runId,
        deliveryId: singleId,
        index: 0,
    });
    expect(first.text).toBe(single);
    expect(first.nextIndex).toBeNull();
    const next = await f.t.query(reader, {
        runId: f.runId,
        deliveryId: multiId,
        index: 0,
    });
    const last = await f.t.query(reader, {
        runId: f.runId,
        deliveryId: multiId,
        index: 1,
        sourceIdentity: next.sourceIdentity,
    });
    expect(next.text + last.text).toBe(multiple);
    expect(last.nextIndex).toBeNull();
    await expect(
        f.t.query(reader, {
            runId: f.runId,
            deliveryId: multiId,
            index: 1,
            sourceIdentity: first.sourceIdentity,
        }),
    ).rejects.toThrow("conversation_migration_source_changed");
    await expect(
        f.t.query(reader, {
            runId: f.runId,
            deliveryId: multiId,
            index: 2,
        }),
    ).rejects.toThrow("conversation_migration_range");

    const foreignDelivery = await f.t.run(async (ctx) => {
        const foreignThread = await createConversationStorage(ctx, f.userId);
        const foreignReference = await saveConversationMessage(
            ctx,
            foreignThread,
            "user",
            "Foreign",
        );
        return f.delivery(ctx, foreignReference, "foreign", "Foreign");
    });
    await expect(
        f.t.query(reader, {
            runId: f.runId,
            deliveryId: foreignDelivery,
            index: 0,
        }),
    ).rejects.toThrow("conversation_message_unavailable");
    const unclaimed = await f.t.run((ctx) =>
        saveConversationMessage(
            ctx,
            f.threadId,
            "assistant",
            "Unclaimed component message",
        ),
    );
    await freezeMigration(f);
    const migration = { runId: f.runId, deliveryId: singleId };
    const stagedId = await f.t.action(
        internal.integrations.agentStorage.copyLegacyDelivery,
        migration,
    );
    await f.t.action(
        internal.integrations.agentStorage.verifyLegacyDeliveryCopy,
        migration,
    );
    await f.t.mutation(
        internal.execution.conversations.switchMessageMigration,
        {
            ...migration,
            sourceIdentity: first.sourceIdentity,
        },
    );
    const deliveries = await f.t.query(
        internal.execution.conversations.messageMigrationInventory,
        {
            runId: f.runId,
            paginationOpts: { cursor: null, numItems: 10 },
        },
    );
    expect(
        deliveries.page.find((row) => row.deliveryId === singleId),
    ).toMatchObject({
        status: "switched",
        verifiedHash: sha256Hex(single),
        textId: stagedId,
    });
    const owners = new Set(
        deliveries.page.flatMap((row) =>
            row.sourceReference?.startsWith("[")
                ? (JSON.parse(row.sourceReference) as string[])
                : row.sourceReference
                  ? [row.sourceReference]
                  : [],
        ),
    );
    const componentIds: string[] = [];
    let cursor: string | null = null;
    for (;;) {
        const page: FunctionReturnType<
            typeof internal.integrations.agentStorage.componentMigrationInventory
        > = await f.t.query(
            internal.integrations.agentStorage.componentMigrationInventory,
            {
                runId: f.runId,
                cursor,
            },
        );
        expect(page.page.length).toBeLessThanOrEqual(1);
        componentIds.push(...page.page.map((row) => row.messageId));
        if (page.isDone) break;
        cursor = page.continueCursor;
    }
    expect(componentIds.filter((id) => !owners.has(id))).toEqual([unclaimed]);
    const reconcile =
        internal.integrations.agentStorage.reconcileConversationMigration;
    await expect(f.t.action(reconcile, { runId: f.runId })).rejects.toThrow(
        "conversation_migration_inventory_incomplete",
    );
    await f.t.run((ctx) => ctx.db.delete(foreignDelivery));
    await expect(
        f.t.action(reconcile, { runId: f.runId, mode: "source_inventory" }),
    ).rejects.toThrow("conversation_migration_unclaimed_component");
    const multiScope = { runId: f.runId, deliveryId: multiId };
    await f.t.action(
        internal.integrations.agentStorage.copyLegacyDelivery,
        multiScope,
    );
    await f.t.action(
        internal.integrations.agentStorage.verifyLegacyDeliveryCopy,
        multiScope,
    );
    await f.t.mutation(
        internal.execution.conversations.switchMessageMigration,
        {
            ...multiScope,
            sourceIdentity: next.sourceIdentity,
        },
    );
    await expect(f.t.action(reconcile, { runId: f.runId })).rejects.toThrow(
        "conversation_migration_unclaimed_component",
    );
    await f.t.action(internal.dossierPurge.purgeResearchDossiers, {
        runIds: [f.runId],
        reason: "Verify migrated delivery ownership during dossier purge",
    });
    expect(await f.t.run((ctx) => ctx.db.get(stagedId))).toBeNull();
});

test("migration reads a large legacy delivery one physical message at a time", async () => {
    const f = await legacyConversation(128 * 1024);
    const text = `${"x".repeat(190_000)} 🧭`;
    const earlierId = await f.t.run(async (ctx) => {
        const ref = await saveConversationMessage(
            ctx,
            f.threadId,
            "user",
            "Earlier message",
        );
        return f.delivery(ctx, ref, "earlier", "Earlier message");
    });
    const ids: string[] = [];
    for (let offset = 0; offset < text.length; offset += 12_000)
        ids.push(
            await f.t.run((ctx) =>
                saveConversationMessage(
                    ctx,
                    f.threadId,
                    "user",
                    text.slice(offset, offset + 12_000),
                ),
            ),
        );
    const deliveryId = await f.t.run((ctx) =>
        f.delivery(ctx, JSON.stringify(ids), "large", text),
    );
    await expect(
        f.t.run(async (ctx) => {
            const row = await ctx.db.get(deliveryId);
            assert(row);
            return readConversationMessages(ctx, f.threadId, [row]);
        }),
    ).rejects.toThrow("Read too much data");
    const requestHash = sha256Hex("control request identity");
    await f.t.run((ctx) =>
        ctx.db.patch(deliveryId, {
            contentHash: requestHash,
            delivery: "control",
        }),
    );
    const historyArgs = { runId: f.runId, bodyAccess: "separate" as const };
    const firstPage = await f.client.query(
        api.execution.conversations.listMessages,
        {
            ...historyArgs,
            paginationOpts: { cursor: null, numItems: 1 },
        },
    );
    expect(firstPage.page[0]?._id).toBe(earlierId);
    const reader = internal.integrations.agentStorage.legacyMigrationFragment;
    let result = "";
    let sourceIdentity: string | undefined;
    for (let index = 0; ; index++) {
        const piece = await f.t.query(reader, {
            runId: f.runId,
            deliveryId,
            index,
            ...(sourceIdentity ? { sourceIdentity } : {}),
        });
        expect(piece.sourceIdentity).toBe(
            sourceIdentity ?? piece.sourceIdentity,
        );
        sourceIdentity = piece.sourceIdentity;
        result += piece.text;
        if (piece.nextIndex === null) break;
        expect(piece.nextIndex).toBe(index + 1);
    }
    expect(result).toBe(text);
    assert(sourceIdentity);
    const frozenDelivery = await f.t.run((ctx) => ctx.db.get(deliveryId));
    const scope = { runId: f.runId };
    await expect(
        f.t.mutation(
            internal.execution.conversations.beginMessageMigration,
            scope,
        ),
    ).rejects.toThrow("retained_stream_upgrade_order");
    await freezeMigration(f);
    await expect(
        f.client.mutation(api.execution.conversations.submit, {
            runId: f.runId,
            requestKey: "new-writer",
            text: "New writer",
            delivery: "queue",
        }),
    ).rejects.toThrow("conversation_migration_frozen");
    expect(
        await f.t.mutation(internal.execution.conversations.claimTurn, scope),
    ).toBeNull();

    const { manifest, parts } = retainedTextParts(text);
    const content = parts[0];
    assert(content);
    const stagedId = await f.t.mutation(
        internal.execution.conversations.stageMessageMigration,
        {
            ...scope,
            deliveryId,
            sourceIdentity,
            fragment: { ...manifest, index: 0, content },
        },
    );
    await expect(
        f.t.run((ctx) => completeRetainedText(ctx, stagedId)),
    ).rejects.toThrow("retained_text_incomplete");
    const switchDelivery =
        internal.execution.conversations.switchMessageMigration;
    const switchArgs = { ...scope, deliveryId, sourceIdentity };
    await expect(f.t.mutation(switchDelivery, switchArgs)).rejects.toThrow(
        "conversation_migration_unverified",
    );

    expect(await f.t.run((ctx) => ctx.db.get(deliveryId))).toEqual({
        ...frozenDelivery,
        storageMigrationCopy: { textId: stagedId, sourceIdentity },
    });

    for (let attempt = 0; attempt < 2; attempt++)
        await expect(
            f.t.action(internal.integrations.agentStorage.copyLegacyDelivery, {
                ...scope,
                deliveryId,
            }),
        ).resolves.toBe(stagedId);
    const staged = await f.t.run((ctx) => completeRetainedText(ctx, stagedId));
    expect(staged.contentHash).toBe(sha256Hex(text));
    const copied = [];
    for (let index = 0; index < staged.fragmentHashes.length; index++)
        copied.push(
            await f.t.run((ctx) => retainedTextFragment(ctx, staged, index)),
        );
    expect(copied.join("")).toBe(text);
    expect(await f.t.run((ctx) => ctx.db.get(deliveryId))).toEqual({
        ...frozenDelivery,
        storageMigrationCopy: { textId: stagedId, sourceIdentity },
    });
    const verify = internal.integrations.agentStorage.verifyLegacyDeliveryCopy;
    const stagedFragment = await f.t.run((ctx) =>
        ctx.db
            .query("retainedTextFragments")
            .withIndex("by_text_and_index", (q) =>
                q.eq("textId", stagedId).eq("index", 0),
            )
            .unique(),
    );
    assert(stagedFragment);
    await f.t.run((ctx) =>
        ctx.db.patch(stagedFragment._id, { content: "corrupt" }),
    );
    await expect(f.t.action(verify, { ...scope, deliveryId })).rejects.toThrow(
        "retained_text_invalid",
    );
    expect(
        (await f.t.run((ctx) => ctx.db.get(deliveryId)))?.storageMigrationCopy
            ?.verifiedHash,
    ).toBeUndefined();
    await f.t.run((ctx) =>
        ctx.db.patch(stagedFragment._id, { content: stagedFragment.content }),
    );
    for (let attempt = 0; attempt < 2; attempt++)
        await expect(
            f.t.action(verify, { ...scope, deliveryId }),
        ).resolves.toBeNull();
    expect(await f.t.run((ctx) => ctx.db.get(deliveryId))).toEqual({
        ...frozenDelivery,
        storageMigrationCopy: {
            textId: stagedId,
            sourceIdentity,
            verifiedHash: sha256Hex(text),
        },
    });
    const original = await f.t.run((ctx) => ctx.db.get(deliveryId));
    assert(original?.storageMessageRef);
    const oldReference = original.storageMessageRef;
    await f.t.run((ctx) =>
        ctx.db.patch(deliveryId, { storageMessageRef: ids[0] }),
    );
    await expect(f.t.mutation(switchDelivery, switchArgs)).rejects.toThrow(
        "conversation_migration_source_changed",
    );
    expect(
        (await f.t.run((ctx) => ctx.db.get(deliveryId)))?.bodyTextId,
    ).toBeUndefined();
    await f.t.run((ctx) =>
        ctx.db.patch(deliveryId, { storageMessageRef: oldReference }),
    );
    const verifiedHash = sha256Hex(text);
    for (let attempt = 0; attempt < 2; attempt++)
        await expect(f.t.mutation(switchDelivery, switchArgs)).resolves.toBe(
            stagedId,
        );
    expect(await f.t.run((ctx) => ctx.db.get(deliveryId))).toEqual({
        ...original,
        bodyTextId: stagedId,
        bodyContentHash: verifiedHash,
    });
    const nextPage = await f.client.query(
        api.execution.conversations.listMessages,
        {
            ...historyArgs,
            paginationOpts: { cursor: firstPage.continueCursor, numItems: 1 },
        },
    );
    expect(nextPage.page).toMatchObject([
        {
            _id: deliveryId,
            text: "",
            body: { contentHash: verifiedHash },
            delivery: "control",
        },
    ]);
    const bodyArgs = { runId: f.runId, messageId: deliveryId };
    await expect(
        f.client.query(api.execution.conversations.readMessageBody, {
            ...bodyArgs,
            contentHash: requestHash,
            index: 0,
        }),
    ).rejects.toThrow("conversation_message_unavailable");
    let body = "";
    let nextIndex: number | null = 0;
    while (nextIndex !== null) {
        const piece: FunctionReturnType<
            typeof api.execution.conversations.readMessageBody
        > = await f.client.query(api.execution.conversations.readMessageBody, {
            ...bodyArgs,
            contentHash: verifiedHash,
            index: nextIndex,
        });
        expect(piece.offset).toBe(body.length);
        body += piece.content;
        nextIndex = piece.nextIndex;
    }
    expect(body).toBe(text);
    const legacy = await f.t.query(reader, {
        ...scope,
        deliveryId,
        index: 0,
        sourceIdentity,
    });
    expect(legacy.text).toBe(text.slice(0, 12_000));
    const earlierScope = { ...scope, deliveryId: earlierId };
    const earlier = await f.t.query(reader, { ...earlierScope, index: 0 });
    await f.t.action(
        internal.integrations.agentStorage.copyLegacyDelivery,
        earlierScope,
    );
    await f.t.action(
        internal.integrations.agentStorage.verifyLegacyDeliveryCopy,
        earlierScope,
    );
    await f.t.mutation(switchDelivery, {
        ...earlierScope,
        sourceIdentity: earlier.sourceIdentity,
    });
    const reconcile =
        internal.integrations.agentStorage.reconcileConversationMigration;
    const inventory = await f.t.action(reconcile, scope);
    expect(inventory).toMatchObject({
        deliveries: 2,
        completedMissions: 0,
        componentMessages: ids.length + 1,
    });
    expect(inventory.inventoryHash).toMatch(/^[0-9a-f]{64}$/);
    await expect(f.t.action(reconcile, scope)).resolves.toEqual(inventory);
    const retained = await f.t.run(async (ctx) => {
        const delivery = await ctx.db.get(deliveryId);
        assert(delivery?.bodyTextId);
        const text = await ctx.db.get(delivery.bodyTextId);
        assert(text);
        await ctx.db.patch(text._id, { key: "foreign-retained-body" });
        return text;
    });
    await expect(f.t.action(reconcile, scope)).rejects.toThrow(
        "conversation_message_unavailable",
    );
    await f.t.run((ctx) => ctx.db.patch(retained._id, { key: retained.key }));
    await expect(f.t.action(reconcile, scope)).resolves.toEqual(inventory);
    await f.t.run((ctx) =>
        ctx.db.patch(stagedFragment._id, { content: "corrupt after switch" }),
    );
    await expect(f.t.action(reconcile, scope)).rejects.toThrow(
        "retained_text_invalid",
    );
    await f.t.run((ctx) =>
        ctx.db.patch(stagedFragment._id, { content: stagedFragment.content }),
    );
    const duplicateId = await f.t.run((ctx) =>
        f.delivery(
            ctx,
            earlier.sourceMessageId,
            "duplicate",
            "Earlier message",
        ),
    );
    const duplicateScope = { ...scope, deliveryId: duplicateId };
    const duplicate = await f.t.query(reader, { ...duplicateScope, index: 0 });
    await f.t.action(
        internal.integrations.agentStorage.copyLegacyDelivery,
        duplicateScope,
    );
    await f.t.action(
        internal.integrations.agentStorage.verifyLegacyDeliveryCopy,
        duplicateScope,
    );
    await f.t.mutation(switchDelivery, {
        ...duplicateScope,
        sourceIdentity: duplicate.sourceIdentity,
    });
    await expect(f.t.action(reconcile, scope)).rejects.toThrow(
        "conversation_migration_duplicate_component_owner",
    );
    await f.t.run(async (ctx) => {
        await ctx.db.delete(duplicateId);
        await ctx.runMutation(components.agent.messages.deleteByIds, {
            messageIds: [earlier.sourceMessageId],
        });
    });
    await expect(f.t.action(reconcile, scope)).rejects.toThrow(
        "conversation_message_unavailable",
    );
});

async function beginHistoricalMission(
    f: Awaited<ReturnType<typeof legacyConversation>>,
) {
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "historical-mission",
        text: "Explain the evidence",
        delivery: "queue",
    });
    const turnId = await f.t.mutation(
        internal.execution.conversations.claimTurn,
        { runId: f.runId },
    );
    assert(turnId);
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        conversationTurnId: turnId,
        definitionId: "conversation_validation_v1",
        scope: { kind: "conversation_validation_v1" },
        requestKey: "historical-mission",
        expectedGeneration: 1,
    });
    return { turnId, missionId };
}

test("an inline historical outcome shares its exact delivered text and refuses a mismatch", async () => {
    const f = await legacyConversation(undefined, true);
    const scope = { runId: f.runId, ...(await beginHistoricalMission(f)) };
    const lease = await f.t.mutation(internal.execution.piStore.claim, {
        missionId: scope.missionId,
        expectedGeneration: 1,
        writer: "migration-replay-writer",
    });
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: scope.missionId,
        expectedGeneration: 1,
        taskKey: "historical-reply",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const body = "Exact historical explanation. 🧭";
    await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
        response: { kind: "complete", text: body },
    });
    const ready = await f.t.run((ctx) => ctx.db.get(scope.missionId));
    assert(ready && "protocolVersion" in ready && ready.textualOutcome);
    const shared = ready.textualOutcome;
    const stored = { kind: "conversation_validation_v1" as const, text: body };
    await f.t.run((ctx) =>
        ctx.db.patch(scope.missionId, {
            textualOutcome: undefined,
            result: { ...stored, text: "Different published reply" },
        }),
    );
    await freezeMigration(f);
    await expect(
        f.t.mutation(internal.execution.piStore.renew, lease),
    ).rejects.toThrow("conversation_migration_frozen");
    await expect(
        f.t.mutation(internal.execution.piStore.claim, {
            missionId: scope.missionId,
            expectedGeneration: 1,
            writer: "late-writer",
        }),
    ).rejects.toThrow("conversation_migration_frozen");
    await f.t.run((ctx) =>
        ctx.db.patch(scope.missionId, { piWakeToken: "frozen-settlement" }),
    );
    await expect(
        f.t.mutation(internal.execution.piControl.prepare, {
            missionId: scope.missionId,
            expectedGeneration: 1,
            token: "frozen-settlement",
            writer: "late-worker",
        }),
    ).resolves.toBe(false);
    expect(await f.t.run((ctx) => ctx.db.get(scope.missionId))).toMatchObject({
        piWakeToken: "frozen-settlement",
    });
    await f.t.run((ctx) =>
        ctx.db.patch(scope.missionId, { piWakeToken: ready.piWakeToken }),
    );
    const beforeClose = await f.t.run((ctx) => ctx.db.get(lease.sessionId));
    await f.t.mutation(internal.execution.piControl.closeWorker, {
        missionId: scope.missionId,
        expectedGeneration: 1,
        writer: lease.writer,
        error: "conversation_migration_frozen",
    });
    expect(await f.t.run((ctx) => ctx.db.get(lease.sessionId))).toEqual(
        beforeClose,
    );
    const move = internal.execution.missionData.migrateLegacyMissionResult;
    const args = { runId: scope.runId, missionId: scope.missionId };
    await expect(f.t.action(move, args)).rejects.toThrow(
        "mission_migration_body_mismatch",
    );
    const reconcile =
        internal.integrations.agentStorage.reconcileConversationMigration;
    const sourceArgs = {
        runId: scope.runId,
        mode: "source_inventory" as const,
    };
    const mismatched = await f.t.action(reconcile, sourceArgs);
    await f.t.run((ctx) => ctx.db.patch(scope.missionId, { result: stored }));
    const preflight = await f.t.action(reconcile, sourceArgs);
    expect(preflight.sourceInventoryHash).not.toBe(
        mismatched.sourceInventoryHash,
    );
    await expect(
        f.t.action(
            internal.integrations.agentStorage.prepareConversationMigration,
            {
                runId: scope.runId,
            },
        ),
    ).resolves.toBe(preflight.sourceInventoryHash);
    const fragment = await f.t.run((ctx) =>
        ctx.db
            .query("retainedTextFragments")
            .withIndex("by_text_and_index", (q) =>
                q.eq("textId", shared.textId).eq("index", 0),
            )
            .unique(),
    );
    assert(fragment);
    await f.t.run((ctx) =>
        ctx.db.patch(fragment._id, { content: "corrupt before adoption" }),
    );
    await expect(f.t.action(move, args)).rejects.toThrow(
        "retained_text_invalid",
    );
    expect(
        await f.t.run((ctx) => ctx.db.get(scope.missionId)),
    ).not.toHaveProperty("textualOutcome");
    await f.t.run((ctx) =>
        ctx.db.patch(fragment._id, { content: fragment.content }),
    );
    for (let attempt = 0; attempt < 2; attempt++)
        await expect(f.t.action(move, args)).resolves.toBe(shared.textId);
    expect(await f.t.run((ctx) => ctx.db.get(scope.missionId))).toEqual({
        ...ready,
        result: stored,
    });
    const inventory = await f.t.action(
        internal.integrations.agentStorage.reconcileConversationMigration,
        {
            runId: scope.runId,
        },
    );
    expect(inventory.sourceInventoryHash).toBe(preflight.sourceInventoryHash);
    await f.t.action(
        internal.integrations.agentStorage.resumeVerifiedConversationMigration,
        {
            runId: scope.runId,
            inventoryHash: inventory.inventoryHash,
            sourceInventoryHash: preflight.sourceInventoryHash,
        },
    );
    const scheduled = await f.t.run(async (ctx) => {
        const updated = await ctx.db.get(scope.missionId);
        assert(updated?.piWakeId);
        return { updated, job: await ctx.db.system.get(updated.piWakeId) };
    });
    expect(scheduled.updated.piWakeToken).not.toBe("frozen-settlement");
    expect(scheduled.job?.state.kind).toBe("pending");
    await f.t.mutation(internal.execution.piControl.closeWorker, {
        missionId: scope.missionId,
        expectedGeneration: 1,
        writer: lease.writer,
        nativeSettled: true,
    });
    expect(await f.t.run((ctx) => ctx.db.get(scope.missionId))).toEqual(
        scheduled.updated,
    );
    expect(await f.t.run((ctx) => ctx.db.get(lease.sessionId))).toMatchObject({
        epoch: lease.epoch + 1,
    });
});

test("a fragmented completed result without a delivery adopts its own exact retained body", async () => {
    const f = await legacyConversation(128 * 1024, true);
    const { missionId, turnId } = await beginHistoricalMission(f);
    const text = `${"x".repeat(176_000)} 🧭`;
    const result = { kind: "conversation_validation_v1", text };
    const { parts, manifest } = retainedTextParts(JSON.stringify(result));
    let resultTextId: Id<"retainedTexts"> | undefined;
    for (const [index, content] of parts.entries())
        resultTextId = await f.t.run((ctx) =>
            stageRetainedText(ctx, `${missionId}:result`, {
                ...manifest,
                index,
                content,
            }),
        );
    assert(resultTextId);
    const sourceTextId = resultTextId;
    await f.t.run(async (ctx) => {
        const turn = await ctx.db.get(turnId);
        assert(turn);
        await ctx.db.patch(turn.conversationId, { activeTurnId: undefined });
        await ctx.db.patch(turnId, { status: "published" });
        await ctx.db.patch(missionId, {
            status: "completed",
            resultTextId: sourceTextId,
        });
    });
    await freezeMigration(f);
    const args = { runId: f.runId, missionId };
    const inventory = () =>
        f.t.query(internal.execution.missionData.missionMigrationInventory, {
            runId: f.runId,
            paginationOpts: { cursor: null, numItems: 1 },
        });
    expect((await inventory()).page).toMatchObject([
        {
            missionId,
            status: "fragmented",
            resultTextId: sourceTextId,
        },
    ]);
    const historicalScope = { missionId, expectedGeneration: 1 };
    const historical = await f.t.query(
        internal.execution.piControl.publicationState,
        historicalScope,
    );
    expect(historical.publishedResult).toEqual({
        contentHash: manifest.contentHash,
        definitionVersion: 3,
    });
    const publishedResult = historical.publishedResult;
    assert(publishedResult);
    expect(
        await f.t.action((ctx) =>
            recoverPiHistoricalPublication(ctx, {
                ...historicalScope,
                ...publishedResult,
            }),
        ),
    ).toBe(text);
    const move = internal.execution.missionData.migrateLegacyMissionResult;
    const migrate = internal.integrations.agentStorage.migrateConversationPage;
    const reconcile =
        internal.integrations.agentStorage.reconcileConversationMigration;
    const preflight = await f.t.action(reconcile, {
        runId: f.runId,
        mode: "source_inventory",
    });
    const pageArgs = {
        runId: f.runId,
        kind: "missions" as const,
        cursor: null,
    };
    await expect(
        f.t.action(
            internal.integrations.agentStorage.prepareConversationMigration,
            {
                runId: f.runId,
            },
        ),
    ).resolves.toBe(preflight.sourceInventoryHash);
    const sourcesMissionId = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(missionId);
        assert(mission && "protocolVersion" in mission);
        const preparationId = await ctx.db.insert(
            "sourceSelectionProposalRebuilds",
            {
                runId: f.runId,
                corpusRevisionId: f.corpusRevisionId,
                executionGeneration: 1,
                policyVersion: "test",
                operationKey: "independent-sources",
                status: "complete",
                failedDiscoveryFamilies: [],
                leaseExpiresAt: 1,
                createdAt: 1,
            },
        );
        const { _id, _creationTime, ...fields } = mission;
        return ctx.db.insert("agentMissions", {
            ...fields,
            definitionId: "sources_v1",
            scope: { kind: "sources_v1", preparationId },
            state: { kind: "sources_v1" },
            requestKey: "independent-sources",
            objectiveKey: "independent-sources",
            conversationTurnId: undefined,
            resultTextId: undefined,
            status: "completed",
        });
    });
    const migrated = await f.t.action(migrate, pageArgs);
    expect(migrated.migrated).toBe(1);
    await expect(f.t.action(migrate, pageArgs)).resolves.toEqual({
        ...migrated,
        migrated: 0,
    });
    const switched = (await inventory()).page[0];
    assert(switched?.status === "switched" && switched.textId);
    const { textId } = switched;
    expect(textId).not.toBe(sourceTextId);
    await expect(f.t.action(move, args)).resolves.toBe(textId);
    expect((await inventory()).page).toMatchObject([
        {
            missionId,
            status: "switched",
            resultTextId: sourceTextId,
            textId,
        },
    ]);
    const mission = await f.t.run((ctx) => ctx.db.get(missionId));
    expect(mission).toMatchObject({
        status: "completed",
        resultTextId: sourceTextId,
        textualOutcome: {
            kind: result.kind,
            ownership: "mission",
            textId,
            contentHash: sha256Hex(text),
        },
    });
    const retained = await f.t.run((ctx) => completeRetainedText(ctx, textId));
    await f.t.run((ctx) =>
        ctx.db.patch(textId, { key: "another-mission-body" }),
    );
    await expect(inventory()).rejects.toThrow("invocation_result_invalid");
    await f.t.run((ctx) => ctx.db.patch(textId, { key: retained.key }));
    const reconciliation = await f.t.action(reconcile, { runId: f.runId });
    expect(reconciliation.sourceInventoryHash).toBe(
        preflight.sourceInventoryHash,
    );
    const fragment = await f.t.run((ctx) =>
        ctx.db
            .query("retainedTextFragments")
            .withIndex("by_text_and_index", (q) =>
                q.eq("textId", textId).eq("index", 0),
            )
            .unique(),
    );
    assert(fragment);
    await f.t.run((ctx) =>
        ctx.db.patch(fragment._id, { content: "corrupted mission text" }),
    );
    await expect(f.t.action(reconcile, { runId: f.runId })).rejects.toThrow(
        "retained_text_invalid",
    );
    await f.t.run((ctx) =>
        ctx.db.patch(fragment._id, { content: fragment.content }),
    );
    await expect(f.t.action(reconcile, { runId: f.runId })).resolves.toEqual(
        reconciliation,
    );
    const body = [];
    for (let index = 0; index < retained.fragmentHashes.length; index++)
        body.push(
            await f.t.run((ctx) => retainedTextFragment(ctx, retained, index)),
        );
    expect(body.join("")).toBe(text);
    const publicationScope = { missionId, expectedGeneration: 1 };
    const publication = await f.t.query(
        internal.execution.piControl.publicationState,
        publicationScope,
    );
    expect(publication).toMatchObject({
        completed: true,
        publishedReply: { contentHash: sha256Hex(text) },
    });
    assert(publication.publishedReply);
    const reply = publication.publishedReply;
    expect(reply.messageId).toBeUndefined();
    expect(
        await f.t.action((ctx) =>
            recoverPiPublication(ctx, {
                ...publicationScope,
                ...reply,
            }),
        ),
    ).toBe(text);

    await f.t.action(
        internal.integrations.agentStorage.resumeVerifiedConversationMigration,
        {
            runId: f.runId,
            inventoryHash: reconciliation.inventoryHash,
            sourceInventoryHash: reconciliation.sourceInventoryHash,
        },
    );
    expect(await f.t.run((ctx) => ctx.db.get(sourcesMissionId))).toMatchObject({
        definitionId: "sources_v1",
        status: "completed",
    });
    expect(await f.t.run((ctx) => ctx.db.get(sourceTextId))).not.toBeNull();
});

test("a legacy approval fixture preserves its published reply without inventing a mission result", async () => {
    const f = await legacyConversation(undefined, true);
    const { missionId, turnId } = await beginHistoricalMission(f);
    const text = "Simulation: please confirm whether to pause research.";
    const { deliveryId, operationId } = await f.t.run(async (ctx) => {
        const turn = await ctx.db.get(turnId);
        assert(turn);
        const request = await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_turn", (q) => q.eq("turnId", turnId))
            .first();
        assert(request?.role === "user");
        const storageMessageRef = await saveConversationMessage(
            ctx,
            f.threadId,
            "assistant",
            text,
        );
        const deliveryId = await ctx.db.insert("agentMessageDeliveries", {
            runId: f.runId,
            conversationId: turn.conversationId,
            turnId,
            storageMessageRef,
            requestKey: "fixture-reply",
            contentHash: sha256Hex(text),
            role: "assistant",
            delivery: "reply",
            status: "processed",
            createdAt: 1,
        });
        await ctx.db.patch(turn.conversationId, { activeTurnId: undefined });
        await ctx.db.patch(turnId, {
            status: "published",
            publishedMessageId: deliveryId,
        });
        await ctx.db.patch(missionId, {
            definitionId: "workbench_v1",
            definitionVersion: 12,
            scope: { kind: "workbench_v1" },
            state: { kind: "workbench_v1" },
            provenance: "simulation",
            status: "completed",
        });
        const operationId = await ctx.db.insert("agentOperationRequests", {
            runId: f.runId,
            missionId,
            actor: "agent",
            cause: "runtime-approval",
            logicalKey: "fixture-request",
            input: {
                kind: "request_approval",
                action: "pause_research",
                messageId: request._id,
            },
            operationVersion: 1,
            expectedGeneration: 1,
            status: "completed",
            createdAt: 1,
        });
        return { deliveryId, operationId };
    });
    await freezeMigration(f);
    const scope = { runId: f.runId };
    const prepare =
        internal.integrations.agentStorage.prepareConversationMigration;
    await expect(f.t.action(prepare, scope)).rejects.toThrow(
        "conversation_migration_inventory_incomplete",
    );
    await f.t.run((ctx) =>
        ctx.db.patch(operationId, { cause: "fixture-request-approval" }),
    );
    const sourceInventoryHash = await f.t.action(prepare, scope);
    for (const kind of ["deliveries", "missions"] as const) {
        let cursor = null;
        for (;;) {
            const page: FunctionReturnType<
                typeof internal.integrations.agentStorage.migrateConversationPage
            > = await f.t.action(
                internal.integrations.agentStorage.migrateConversationPage,
                { ...scope, kind, cursor },
            );
            if (kind === "missions") expect(page.migrated).toBe(0);
            if (page.isDone) break;
            cursor = page.continueCursor;
        }
    }
    const evidence = await f.t.action(
        internal.integrations.agentStorage.reconcileConversationMigration,
        scope,
    );
    expect(evidence).toMatchObject({
        sourceInventoryHash,
        completedMissions: 1,
    });
    await f.t.action(
        internal.integrations.agentStorage.resumeVerifiedConversationMigration,
        {
            ...scope,
            sourceInventoryHash,
            inventoryHash: evidence.inventoryHash,
        },
    );
    const delivered = await f.client.query(
        api.execution.conversations.listMessages,
        {
            ...scope,
            paginationOpts: { cursor: null, numItems: 5 },
        },
    );
    expect(await readMessageBodies(f.client, delivered.page)).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ _id: deliveryId, text }),
        ]),
    );
    const mission = await f.t.run((ctx) => ctx.db.get(missionId));
    assert(mission && "protocolVersion" in mission);
    expect(mission).toMatchObject({ status: "completed" });
    expect(mission.result).toBeUndefined();
    expect(mission.textualOutcome).toBeUndefined();
});
