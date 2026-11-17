import { api, internal } from "@convex/_generated/api";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

test.each([
    1, 2, 3,
])("Stop cancels a retained Workbench v%s response without restoring its definition", async (version) => {
    const { t, client, runId } = await seedWorkbench();
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    assert(active);
    const conversationId = await t.run(async (ctx) => {
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .unique();
        assert(conversation);
        await ctx.db.patch(conversation._id, { definitionVersion: version });
        await ctx.db.patch(active.missionId, { definitionVersion: version });
        return conversation._id;
    });
    await expect(
        client.mutation(api.execution.conversations.stopResponse, {
            runId,
            turnId: active.turnId,
        }),
    ).resolves.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(active.missionId))).toMatchObject({
        status: "cancelled",
        definitionVersion: version,
    });
    expect(await t.run((ctx) => ctx.db.get(active.turnId))).toMatchObject({
        status: "interrupted",
    });
    expect(await t.run((ctx) => ctx.db.get(conversationId))).toMatchObject({
        queuePaused: true,
    });
    expect(
        (await t.run((ctx) => ctx.db.get(conversationId)))?.activeTurnId,
    ).toBeUndefined();
    expect(() => getAgentDefinition("workbench_v1", version)).toThrow(
        "definition_version_conflict",
    );
});

test("a retained unsupported conversation records its queue admission refusal", async () => {
    const { t, runId } = await seedWorkbench();
    const conversationId = await t.run(async (ctx) => {
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .unique();
        assert(conversation);
        await ctx.db.patch(conversation._id, { definitionVersion: 2 });
        return conversation._id;
    });
    await expect(
        t.mutation(internal.execution.conversations.pumpWorkbench, { runId }),
    ).resolves.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(conversationId))).toMatchObject({
        queuedCount: 1,
        queuePaused: true,
        admissionFailure: { code: "definition_version_conflict" },
    });
});

test("Workbench consultation preserves authoritative facts without duplicating the domain payload", async () => {
    const { t, client, runId } = await seedWorkbench(true);
    await client.mutation(api.framing.save, {
        runId,
        expectedRevision: 1,
        requestKey: "large-consultation-framing",
        content: { scope: "A".repeat(28000), questions: [] },
    });
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    assert(active);
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "consultation-facts",
        input: { kind: "consult_mission_state" },
    });
    const outcome = await t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    expect(outcome).toMatchObject({ kind: "success" });
    assert(outcome.kind === "success");
    const page = JSON.parse(outcome.valueJson);
    expect(page.state.requiredState.section).toBe("workbench_current_state");
    expect(page.state.mission.id).toBe(active.missionId);
    expect(page.state).not.toHaveProperty("framing");
    expect(outcome.valueJson).not.toContain("A".repeat(28000));
    const current = await t.query(internal.execution.context.build, {
        missionId: active.missionId,
        expectedGeneration: 1,
    });
    assert(current.kind === "ready");
    expect(JSON.parse(current.inputJson).domain.framing.scope).toBe(
        "A".repeat(28000),
    );
});
