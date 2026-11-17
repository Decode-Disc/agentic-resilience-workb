import { api, internal } from "@convex/_generated/api";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedWorkbenchMaterials } from "@/__tests__/setup/workbench-materials";

afterEach(() => vi.useRealTimers());

test("a Workbench response lists only accepted intact captures and admits its queued messages", async () => {
    const { t, runId, corpusRevisionId, sourceId, captureId, start } =
        await seedWorkbenchMaterials(3, 20);
    await t.run(async (ctx) => {
        const head = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_source", (q) =>
                q
                    .eq("corpusRevisionId", corpusRevisionId)
                    .eq("sourceId", sourceId),
            )
            .unique();
        assert(head);
        await ctx.db.patch(head.latestDecisionId, { decision: "rejected" });
        await ctx.db.patch(head._id, { decision: "rejected", decisionRank: 2 });
        const capture = await ctx.db.get(captureId);
        assert(capture);
        const source = await ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (q) =>
                q
                    .eq("runId", runId)
                    .eq("canonicalUrl", "https://example.com/material/1"),
            )
            .unique();
        assert(source);
        const unavailable = await ctx.db
            .query("sourceCaptures")
            .withIndex("by_preparation_and_source", (q) =>
                q
                    .eq("preparationId", capture.preparationId)
                    .eq("sourceId", source._id),
            )
            .unique();
        assert(unavailable);
        await ctx.db.patch(unavailable._id, { status: "unavailable" });
    });
    const turn = await start();
    assert(turn);
    const context = await t.query(internal.execution.context.build, {
        missionId: turn.missionId,
        expectedGeneration: 1,
    });
    assert(context.kind === "ready");
    const input = JSON.parse(context.inputJson);
    expect(input.domain.availableMaterials).toEqual([
        expect.objectContaining({ title: "Material 2" }),
    ]);
    expect(input.conversationInstructions.messages).toHaveLength(20);
    expect(await t.run((ctx) => ctx.db.get(turn.turnId))).toMatchObject({
        runId,
        messageCount: 20,
    });
});

test("the grouped capture listing retains generation, ownership, availability and identity checks", async () => {
    const {
        t,
        runId,
        corpusRevisionId,
        sourceId,
        captureId,
        visitorId,
        start,
    } = await seedWorkbenchMaterials(1, 1);
    const turn = await start();
    assert(turn);
    const args = {
        missionId: turn.missionId,
        expectedGeneration: 1,
        sourceIds: [sourceId],
    };
    const query = internal.sourceRetrieval.availableCapturesForMission;
    expect(await t.query(query, args)).toEqual([sourceId]);
    await expect(
        t.query(query, { ...args, expectedGeneration: 0 }),
    ).rejects.toThrow("stale_execution");
    await expect(
        t.query(query, {
            ...args,
            sourceIds: Array.from({ length: 61 }, () => sourceId),
        }),
    ).rejects.toThrow("context_capacity");
    await t.run((ctx) => ctx.db.patch(captureId, { status: "unavailable" }));
    expect(await t.query(query, args)).toEqual([]);
    await t.run(async (ctx) => {
        await ctx.db.patch(captureId, { status: "committed" });
        const revision = await ctx.db.get(corpusRevisionId);
        assert(revision?.sourceSelectionProposalId);
        const otherRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 2,
            status: "draft",
            createdAt: Date.now(),
        });
        await ctx.db.patch(revision.sourceSelectionProposalId, {
            corpusRevisionId: otherRevisionId,
        });
    });
    await expect(t.query(query, args)).rejects.toThrow(
        "capture_identity_conflict",
    );
    await t.run((ctx) => ctx.db.patch(visitorId, { status: "revoked" }));
    await expect(t.query(query, args)).rejects.toThrow("not_authorized");
});

test("ended documentary treatment has the same current outcome in model context and workspace", async () => {
    const { t, runId, captureId, start, client } = await seedWorkbenchMaterials(
        1,
        1,
    );
    await t.run(async (ctx) => {
        const capture = await ctx.db.get(captureId);
        assert(capture);
        await ctx.db.patch(capture.preparationId, { status: "complete" });
        const message = await ctx.db.query("agentMessageDeliveries").first();
        assert(message);
        const requestId = await ctx.db.insert("agentOperationRequests", {
            runId,
            actor: "agent",
            cause: "fixture",
            input: {
                kind: "transmit_source_request",
                messageId: message._id,
                interpretedNeed: "Commercial terms",
            },
            operationVersion: 1,
            expectedGeneration: 1,
            logicalKey: "finished-instruction",
            status: "completed",
            createdAt: 1,
        });
        const frame = await ctx.db.insert("framingRevisions", {
            runId,
            revision: 1,
            content: { scope: "Workflow", questions: [] },
            contentHash: "fixture",
            requestKey: "fixed",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(runId, {
            currentFramingRevisionId: frame,
            fixedFramingRevisionId: frame,
        });
        const run = await ctx.db.get(runId);
        assert(run?.fixedFramingRevisionId);
        await ctx.db.insert("workbenchInstructions", {
            runId,
            requestId,
            messageId: message._id,
            interpretedNeed: "Commercial terms",
            framingRevisionId: run.fixedFramingRevisionId,
            status: "transmitted",
            outcome: "Its treatment is still in progress.",
            preparationId: capture.preparationId,
            createdAt: 1,
        });
    });
    const turn = await start();
    assert(turn);
    const context = await t.query(internal.execution.context.build, {
        missionId: turn.missionId,
        expectedGeneration: 1,
    });
    assert(context.kind === "ready");
    const request = JSON.parse(context.inputJson).domain.analystRequests[0];
    expect(request).toMatchObject({
        status: "completed",
        transmissionStatus: "transmitted",
    });
    expect(request.outcome).not.toContain("still in progress");
    const workspace = await client.query(api.workbench.snapshot, { runId });
    expect(workspace.instructions[0]).toMatchObject({
        status: request.status,
        outcome: request.outcome,
    });
});
