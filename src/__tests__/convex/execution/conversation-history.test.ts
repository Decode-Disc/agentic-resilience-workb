import { api, internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import { seedConversation } from "@/__tests__/setup/agent-harness";

afterEach(() => vi.unstubAllEnvs());

test("common conversation reading retrieves prior published turns and excludes queued instructions", async () => {
    const f = await seedConversation(true);
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "prior",
        delivery: "queue",
        text: "Original prior question",
    });
    const turnId = await f.t.mutation(
        internal.execution.conversations.claimTurn,
        { runId: f.runId },
    );
    if (!turnId) throw new Error("Expected turn");
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        expectedGeneration: 1,
        conversationTurnId: turnId,
        definitionId: "conversation_validation_v1",
        scope: { kind: "conversation_validation_v1" },
        requestKey: "prior",
    });
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 1,
        taskKey: "reply",
        provenance: "simulation",
    });
    if (begun.kind !== "ready") throw new Error("Expected invocation");
    await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
        response: { kind: "complete", text: "Retained prior answer" },
    });
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "current",
        delivery: "queue",
        text: "Current question",
    });
    const nextTurn = await f.t.mutation(
        internal.execution.conversations.claimTurn,
        { runId: f.runId },
    );
    if (!nextTurn) throw new Error("Expected turn");
    const nextMission = await f.t.mutation(internal.execution.missions.start, {
        runId: f.runId,
        expectedGeneration: 1,
        conversationTurnId: nextTurn,
        definitionId: "conversation_validation_v1",
        scope: { kind: "conversation_validation_v1" },
        requestKey: "current",
    });
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "queued",
        delivery: "queue",
        text: "DO NOT DELIVER YET",
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: nextMission,
            expectedGeneration: 1,
            cause: "earlier-turns",
            input: { kind: "consult_conversation" },
        },
    );
    const outcome = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    expect(outcome.kind).toBe("success");
    if (outcome.kind !== "success") throw new Error("Expected exact history");
    expect(outcome.valueJson).toContain("Original prior question");
    expect(outcome.valueJson).not.toContain("DO NOT DELIVER YET");
});
