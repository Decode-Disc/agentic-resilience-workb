import { api, internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import { seedConversation } from "@/__tests__/setup/agent-harness";

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

async function waitingMission() {
    vi.useFakeTimers();
    const f = await seedConversation(true);
    await import("@convex/execution/agentCatalog");
    const { conversationValidationDefinition } = await import(
        "@convex/domain/conversationValidation"
    );
    vi.spyOn(conversationValidationDefinition, "simulate").mockImplementation(
        (input) => {
            const snapshot = input as {
                triggeringRequestsAndResults: {
                    outcome: { kind: string } | null;
                }[];
            };
            return snapshot.triggeringRequestsAndResults.some(
                (r) => r.outcome?.kind === "success",
            )
                ? { kind: "complete", text: "The confirmed result is 14." }
                : {
                      kind: "operations",
                      requests: [
                          {
                              callId: "deferred",
                              name: "wait_fixture_result",
                              inputJson: '{"value":7}',
                          },
                      ],
                  };
        },
    );
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        requestKey: "wait",
        text: "Compute the deferred result",
        delivery: "queue",
    });
    const started = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "conversation_validation_v1",
            scope: { kind: "conversation_validation_v1" },
            simulation: true,
        },
    );
    if (!started) throw new Error("Expected turn");
    const mission = await f.t.run((ctx) => ctx.db.get(started.missionId));
    if (!mission?.piWakeToken) throw new Error("Expected wake");
    await f.t.action(internal.execution.piWorker.run, {
        missionId: mission._id,
        expectedGeneration: 1,
        token: mission.piWakeToken,
    });
    const request = await f.t.run((ctx) =>
        ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", mission._id))
            .unique(),
    );
    if (request?.status !== "waiting")
        throw new Error("Expected deferred operation");
    return { ...f, missionId: mission._id, requestId: request._id };
}

test("a deferred result wakes Pi immediately while unchanged waiting work has a slower recovery wake", async () => {
    const f = await waitingMission();
    const waiting = await f.t.run((ctx) => ctx.db.get(f.missionId));
    expect((waiting?.piWakeAt ?? 0) - Date.now()).toBeGreaterThanOrEqual(
        30_000,
    );
    if (!waiting?.piWakeToken || waiting.piWakeAt === undefined)
        throw new Error("Expected recovery wake");
    vi.setSystemTime(waiting.piWakeAt);
    await f.t.action(internal.execution.piWorker.run, {
        missionId: f.missionId,
        expectedGeneration: 1,
        token: waiting.piWakeToken,
    });
    const recovering = await f.t.run((ctx) => ctx.db.get(f.missionId));
    expect((recovering?.piWakeAt ?? 0) - Date.now()).toBeGreaterThanOrEqual(
        30_000,
    );
    expect(
        await f.t.run((ctx) => ctx.db.query("agentInvocations").collect()),
    ).toHaveLength(1);
    vi.setSystemTime(Date.now() + 5_000);
    await f.t.mutation(
        internal.domain.conversationValidation.completeDeferred,
        { requestId: f.requestId, expectedGeneration: 1 },
    );
    const ready = await f.t.run((ctx) => ctx.db.get(f.missionId));
    expect(ready?.piWakeAt).toBe(Date.now());
    if (!ready?.piWakeToken) throw new Error("Expected result wake");
    await f.t.action(internal.execution.piWorker.run, {
        missionId: f.missionId,
        expectedGeneration: 1,
        token: ready.piWakeToken,
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "completed",
        result: { text: "The confirmed result is 14." },
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.requestId))).toMatchObject({
        status: "completed",
        outcome: { kind: "success", valueJson: '{"value":14}' },
    });
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
}, 30000);

test("retaining a result after access revocation does not notify a new Pi execution", async () => {
    const f = await waitingMission();
    const waiting = await f.t.run((ctx) => ctx.db.get(f.missionId));
    await f.t.run((ctx) => ctx.db.patch(f.invitationId, { status: "revoked" }));
    await f.t.mutation(
        internal.domain.conversationValidation.completeDeferred,
        { requestId: f.requestId, expectedGeneration: 1 },
    );
    const retained = await f.t.run((ctx) => ctx.db.get(f.requestId));
    expect(retained).toMatchObject({
        status: "observed",
        outcome: { kind: "success" },
    });
    const mission = await f.t.run((ctx) => ctx.db.get(f.missionId));
    expect(mission?.piWakeToken).toBe(waiting?.piWakeToken);
    expect(mission?.piResultWakePending).toBeUndefined();
}, 30000);

test("an expired Pi child notifies its waiting parent through the retained operation result", async () => {
    const f = await waitingMission();
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { executionStatus: "running" }),
    );
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "expired-child",
            input: { kind: "request_fixture_validation", values: [7] },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "waiting" });
    const request = await f.t.run((ctx) => ctx.db.get(requestId));
    if (!request?.childMissionId) throw new Error("Expected child mission");
    const childId = request.childMissionId;
    const child = await f.t.run((ctx) => ctx.db.get(childId));
    if (!child?.piWakeToken) throw new Error("Expected child wake");
    await f.t.run((ctx) =>
        ctx.db.patch(child._id, { deadlineAt: Date.now() - 1 }),
    );
    await f.t.action(internal.execution.piWorker.run, {
        missionId: child._id,
        expectedGeneration: child.generation,
        token: child.piWakeToken,
    });
    expect(await f.t.run((ctx) => ctx.db.get(child._id))).toMatchObject({
        status: "blocked",
        blockCode: "execution_deadline",
    });
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "completed",
        outcome: { kind: "unavailable", code: "child_mission_incomplete" },
    });
    expect((await f.t.run((ctx) => ctx.db.get(f.missionId)))?.piWakeAt).toBe(
        Date.now(),
    );
}, 30000);

test("a result notification survives a busy wake and the previous writer closing afterwards", async () => {
    const f = await waitingMission();
    const waiting = await f.t.run((ctx) => ctx.db.get(f.missionId));
    if (!waiting?.piWakeToken) throw new Error("Expected recovery wake");
    expect(
        await f.t.mutation(internal.execution.piControl.prepare, {
            missionId: f.missionId,
            expectedGeneration: 1,
            token: waiting.piWakeToken,
            writer: "closing-writer",
        }),
    ).toBe(true);
    await f.t.mutation(
        internal.domain.conversationValidation.completeDeferred,
        { requestId: f.requestId, expectedGeneration: 1 },
    );
    const notified = await f.t.run((ctx) => ctx.db.get(f.missionId));
    if (!notified?.piWakeToken) throw new Error("Expected result wake");
    expect(
        await f.t.mutation(internal.execution.piControl.prepare, {
            missionId: f.missionId,
            expectedGeneration: 1,
            token: notified.piWakeToken,
            writer: "busy-writer",
        }),
    ).toBe(false);
    await f.t.mutation(internal.execution.piControl.closeWorker, {
        missionId: f.missionId,
        expectedGeneration: 1,
        writer: "closing-writer",
        at: Date.now() + 30_000,
    });
    const closed = await f.t.run((ctx) => ctx.db.get(f.missionId));
    expect(closed?.piWakeAt).toBe(Date.now());
    if (!closed?.piWakeToken) throw new Error("Expected surviving result wake");
    await f.t.action(internal.execution.piWorker.run, {
        missionId: f.missionId,
        expectedGeneration: 1,
        token: closed.piWakeToken,
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "completed",
    });
}, 30000);
