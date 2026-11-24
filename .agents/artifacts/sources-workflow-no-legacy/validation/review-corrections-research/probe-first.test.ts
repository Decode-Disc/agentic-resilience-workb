import { api, internal } from "@convex/_generated/api";
import { createConversationStorage, saveConversationMessage } from "@convex/integrations/agentStorage";
import { appendRetainedText, sealRetainedText } from "@convex/execution/retainedText";
import { DOSSIER_PURGE_BATCH as B } from "@convex/resourcePolicy";
import { seedConversation } from "@/__tests__/setup/agent-harness";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";
import { afterEach, assert, expect, test, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });

test.each(["listMessages", "history"] as const)("%s reads eight valid large deliveries", async (reader) => {
    const f = await seedConversation(true, true);
    const conversation = await f.t.run(async (ctx) => {
        const storageRef = await createConversationStorage(ctx, f.userId);
        const id = await ctx.db.insert("agentConversations", { runId: f.runId, storageRef, queuedCount: 0, createdAt: 1 });
        return { id, storageRef };
    });
    const text = `${"é".repeat(550000)}!`;
    for (let i = 0; i < 8; i++) await f.t.run(async (ctx) => {
        const storageMessageRef = await saveConversationMessage(ctx, conversation.storageRef, "assistant", text);
        await ctx.db.insert("agentMessageDeliveries", { runId: f.runId, conversationId: conversation.id, storageMessageRef, role: "assistant", delivery: "reply", status: "processed", requestKey: `large-${i}`, contentHash: `fixture-${i}`, createdAt: i + 1 });
    });
    const ref = reader === "history" ? api.workbench.history : api.execution.conversations.listMessages;
    const single = await f.client.query(ref, { runId: f.runId, paginationOpts: { numItems: 1, cursor: null } });
    expect(single.page[0].text).toBe(text);
    const page = await f.client.query(ref, { runId: f.runId, paginationOpts: { numItems: 20, cursor: null } });
    expect(page.page.map(m => m.text)).toEqual(Array(8).fill(text));
});

test("one large logical reply can be saved in the publication transaction", async () => {
    const f = await seedConversation(true, true);
    const thread = await f.t.run(ctx => createConversationStorage(ctx, f.userId));
    await f.t.run(ctx => saveConversationMessage(ctx, thread, "assistant", "x".repeat(8_400_001)));
});

test.each([0, B, 2 * B] as const)("purge reaches owned payloads after %i empty parents", async (empty) => {
    const f = await seedSourcePreparation();
    const other = await seedSourcePreparation({}, f.t);
    const retained = await f.t.run(async ctx => {
        await ctx.db.patch(f.runId, { executionStatus: "completed", withdrawnAt: 1 });
        const parents = [];
        for (let i = 0; i <= empty; i++) parents.push(await ctx.db.insert("agentInvocations", { runId: f.runId, generation: 3, definitionVersion: 1, taskKey: String(i).padStart(5, "0"), status: "completed", provenance: "simulation", inputJson: "{}", createdAt: i + 1 }));
        const invocationId = parents[empty];
        const textId = await appendRetainedText(ctx, `${invocationId}:reply`, 0, "owned diagnostic");
        const text = await sealRetainedText(ctx, textId);
        const payloadId = await ctx.db.insert("agentInvocationPayloads", { runId: f.runId, invocationId, part: "reply", version: 1, state: "complete", textId, contentHash: text.contentHash, sizeBytes: text.sizeBytes, createdAt: 1 });
        return { payloadId, textId };
    });
    for (let i = 0; i < 2; i++) await f.t.action(internal.dossierPurge.purgeResearchDossiers, { runIds: [f.runId], reason: "Research diagnostic cleanup" });
    await f.t.run(async ctx => {
        expect(await ctx.db.get(f.runId)).toBeNull();
        expect(await ctx.db.get(other.runId)).not.toBeNull();
        expect.soft(await ctx.db.get(retained.payloadId)).toBeNull();
        expect.soft(await ctx.db.get(retained.textId)).toBeNull();
    });
});

test("purge reaches a Pi session after two empty mission batches", async () => {
    const f = await seedCapturedSources();
    const sessionId = await f.t.run(async ctx => {
        const mission = await ctx.db.get(f.missionId); assert(mission);
        const { _id, _creationTime, ...fields } = mission;
        await ctx.db.patch(f.runId, { executionStatus: "completed", withdrawnAt: 1 });
        await ctx.db.patch(_id, { status: "completed" });
        let missionId = _id;
        for (let i = 0; i < 2 * B; i++) missionId = await ctx.db.insert("agentMissions", { ...fields, status: "completed", requestKey: `mission-${i}` });
        const id = await ctx.db.insert("piSessions", { missionId, generation: 4, writer: "probe", epoch: 1, leaseUntil: 0, sequence: 1, nextId: 1 });
        await ctx.db.insert("piCommits", { sessionId: id, sequence: 1, key: "probe", payload: "{}" });
        return id;
    });
    await f.t.action(internal.dossierPurge.purgeResearchDossiers, { runIds: [f.runId], reason: "Research diagnostic session cleanup" });
    await f.t.run(async ctx => {
        expect(await ctx.db.get(f.runId)).toBeNull();
        expect(await ctx.db.get(sessionId)).toBeNull();
    });
});
