import { api, internal } from "@convex/_generated/api";
import schema from "@convex/schema";
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { createAdmittedPreflight } from "@/__tests__/setup/research-launch";

const modules = import.meta.glob("/convex/**/*.ts");
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});
test("native conversation admission preserves recoverable refusal against the configured model capacity", async () => {
    vi.useFakeTimers();
    const network = vi.fn(() => {
        throw new Error("Unexpected external IO");
    });
    vi.stubGlobal("fetch", network);
    const t = convexTest(schema, modules);
    agentTest.register(t);
    workflowTest.register(t);
    vi.stubEnv("WORKBENCH_AGENT_ENABLED", "true");
    const { installModel } = await import(
        "@/__tests__/setup/model-configuration"
    );
    const { nativePiFixtureRoute } = await import(
        "@/__tests__/setup/pi-native"
    );
    await installModel(t, nativePiFixtureRoute, "workbench", {
        contextWindow: 32768,
    });
    const { userId, preflightId } = await createAdmittedPreflight(t),
        client = t.withIdentity({ subject: userId });
    const { runId } = await client.mutation(api.framing.confirmCompany, {
        preflightId,
        idempotencyKey: "review",
        coveragePreset: "balanced",
    });
    const initial = await t.run((ctx) =>
        ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .first(),
    );
    if (!initial) throw new Error("Expected initial instruction");
    await client.mutation(api.execution.conversations.removeQueued, {
        runId,
        messageId: initial._id,
    });
    const large = await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "large",
        text: '"'.repeat(65536),
        delivery: "queue",
    });
    await t.mutation(internal.execution.conversations.pumpWorkbench, { runId });
    const state = await client.query(api.execution.conversations.get, {
        runId,
    });
    expect(state).toMatchObject({
        queuedCount: 1,
        queuePaused: true,
        admissionFailure: { code: "context_capacity", messageId: large },
        activeTurn: null,
        execution: null,
    });
    expect(network).not.toHaveBeenCalled();
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "small",
        text: "A concise follow-up.",
        delivery: "queue",
    });
    expect(
        await client.query(api.execution.conversations.get, { runId }),
    ).toMatchObject({ queuePaused: true });
    await client.mutation(api.execution.conversations.removeQueued, {
        runId,
        messageId: large,
    });
    await t.mutation(internal.execution.conversations.pumpWorkbench, { runId });
    expect(
        await client.query(api.execution.conversations.get, { runId }),
    ).toMatchObject({ queuedCount: 0, queuePaused: false });
});

test("a successful queue retry clears its retained admission failure", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    agentTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t),
        client = t.withIdentity({ subject: userId });
    const { runId } = await client.mutation(api.framing.confirmCompany, {
        preflightId,
        idempotencyKey: "recover-admission",
        coveragePreset: "balanced",
    });
    await t.run(async (ctx) => {
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .unique();
        if (!conversation) throw Error("Expected conversation");
        await ctx.db.patch(conversation._id, {
            queuePaused: true,
            admissionFailure: { code: "configuration_unavailable" },
        });
    });
    await client.mutation(api.execution.conversations.resumeQueue, { runId });
    await t.mutation(internal.execution.conversations.pumpWorkbench, { runId });
    const state = await client.query(api.execution.conversations.get, {
        runId,
    });
    expect(state.activeTurn).not.toBeNull();
    expect(state.admissionFailure).toBeUndefined();
});
