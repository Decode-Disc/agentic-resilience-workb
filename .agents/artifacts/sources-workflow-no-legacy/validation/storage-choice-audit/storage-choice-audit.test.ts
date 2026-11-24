import { writeFileSync } from "node:fs";
import { api, components, internal } from "@convex/_generated/api";
import schema from "@convex/schema";
import { convexTest } from "convex-test";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";
import { seedConversation } from "@/__tests__/setup/agent-harness";
import { createConversationStorage } from "@convex/integrations/agentStorage";
import { appendRetainedText, sealRetainedText, retainedTextParts, completeRetainedText, retainedTextRange, readRetainedText, retainCompleteText, deleteRetainedTextBatch } from "@convex/execution/retainedText";
import { TEXT_FRAGMENT_CHARACTERS } from "@convex/resourcePolicy";
import { afterEach, assert, expect, test, vi } from "vitest";

const observations: Record<string, unknown> = {};
afterEach(() => {
    vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks();
    writeFileSync(".agents/artifacts/sources-workflow-no-legacy/validation/storage-choice-audit/measurements.json", JSON.stringify(observations, null, 2));
});

test("existing Pi staging publishes an 18 MiB text without hydrating its body", async () => {
    const f = await seedInspectedEvidence({}, convexTest({ schema, modules: import.meta.glob("/convex/**/*.ts"), transactionLimits: true }));
    const missionId = await f.t.mutation(internal.execution.missions.start, { runId: f.runId, corpusRevisionId: f.corpusRevisionId, expectedGeneration: 4, definitionId: "saved_material_inspection_v1", requestKey: "storage-audit" });
    const lease = await f.t.mutation(internal.execution.piStore.claim, { missionId, expectedGeneration: 4, writer: "storage-audit" });
    const content = `${"x".repeat(18 * 1024 * 1024)}!`;
    const { manifest, parts } = retainedTextParts(content);
    const metrics = [];
    let textId;
    for (const [index, part] of parts.entries()) {
        const result = await f.t.run(async ctx => {
            const id = await ctx.runMutation(internal.execution.piStore.stageCommit, { ...lease, key: "large", fragment: { ...manifest, index, content: part } });
            return { id, metrics: await ctx.meta.getTransactionMetrics() };
        });
        textId = result.id;
        if ([0, Math.floor(parts.length / 2), parts.length - 1].includes(index)) metrics.push({ index, ...result.metrics });
        if (index === 0) {
            await expect(f.t.mutation(internal.execution.piStore.publishCommit, { ...lease, key: "large", sequence: 1, textId, nextId: 2 })).rejects.toThrow("retained_text_incomplete");
            await f.t.mutation(internal.execution.piStore.stageCommit, { ...lease, key: "large", fragment: { ...manifest, index, content: part } });
        }
    }
    assert(textId);
    const publication = await f.t.run(async ctx => {
        const args = { ...lease, key: "large", sequence: 1, textId, nextId: 2 };
        expect(await ctx.runMutation(internal.execution.piStore.publishCommit, args)).toBe(1);
        expect(await ctx.runMutation(internal.execution.piStore.publishCommit, args)).toBe(1);
        return ctx.meta.getTransactionMetrics();
    });
    expect((await f.t.run(ctx => ctx.db.get(lease.sessionId)))?.retainedBytes).toBe(manifest.sizeBytes);
    const range = await f.t.run(async ctx => {
        const manifest = await completeRetainedText(ctx, textId);
        const text = await retainedTextRange(ctx, manifest, content.length - 10, 10);
        return { text, metrics: await ctx.meta.getTransactionMetrics() };
    });
    expect(range.text).toBe("xxxxxxxxx!");
    await expect(f.t.run(ctx => readRetainedText(ctx, textId))).rejects.toThrow("Read too much data");
    await expect(f.t.run(ctx => retainCompleteText(ctx, "whole-transaction", content))).rejects.toThrow(/too much data/i);
    const cleanup = [];
    let done = false;
    while (!done) {
        const result = await f.t.run(async ctx => ({ done: await deleteRetainedTextBatch(ctx, textId, `${lease.sessionId}:large`, 100), metrics: await ctx.meta.getTransactionMetrics() }));
        done = result.done;
        cleanup.push(result.metrics);
    }
    expect(await f.t.run(ctx => ctx.db.get(textId))).toBeNull();
    expect(await f.t.run(ctx => ctx.db.query("retainedTextFragments").withIndex("by_text_and_index", q => q.eq("textId", textId)).first())).toBeNull();
    observations.staged = { bytes: manifest.sizeBytes, fragments: parts.length, stageSamples: metrics, twoPublications: publication, range: range.metrics, cleanup };
});

test("stream sealing rereads the entire retained body", async () => {
    const f = await seedConversation(true, true);
    const content = "x".repeat(18 * 1024 * 1024 + 1);
    const { parts } = retainedTextParts(content);
    let textId;
    for (const [sequence, part] of parts.entries()) textId = await f.t.run(ctx => appendRetainedText(ctx, "stream-seal-audit", sequence, part));
    assert(textId);
    await expect(f.t.run(ctx => sealRetainedText(ctx, textId))).rejects.toThrow("Read too much data");
    const record = await f.t.run(ctx => ctx.db.get(textId));
    expect(record?.stream?.sealed).toBe(false);
    expect(record?.receivedBytes).toBe(content.length);
    observations.stream = { bytes: content.length, fragments: parts.length, sealing: "read capacity failure; transaction rolled back; stream remains unsealed" };
});

test.each([false, true])("native Agent storage with hidden search = %s", async (hidden) => {
    const f = await seedConversation(true, true);
    const threadId = await f.t.run(ctx => createConversationStorage(ctx, f.userId));
    const content = "é".repeat(TEXT_FRAGMENT_CHARACTERS);
    const saved = await f.t.run(async ctx => {
        const args = { threadId, hideFromUserIdSearch: hidden, messages: [{ message: { role: "assistant" as const, content } }] };
        const first = await ctx.runMutation(components.agent.messages.addMessages, args);
        const second = await ctx.runMutation(components.agent.messages.addMessages, args);
        expect(first.messages[0]._id).not.toBe(second.messages[0]._id);
        return { id: first.messages[0]._id, metrics: await ctx.meta.getTransactionMetrics() };
    });
    const read = await f.t.run(async ctx => {
        const rows = await ctx.runQuery(components.agent.messages.getMessagesByIds, { messageIds: [saved.id] });
        expect(rows[0]?.message).toEqual({ role: "assistant", content });
        expect(rows[0]?.text).toBe(hidden ? undefined : content);
        return ctx.meta.getTransactionMetrics();
    });
    observations[`agent-hidden-${hidden}`] = { bytes: Buffer.byteLength(content), twoWrites: saved.metrics, oneRead: read, repeatedCall: "distinct message IDs" };
});
