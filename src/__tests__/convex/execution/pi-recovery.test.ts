import { api, internal } from "@convex/_generated/api";
import { openMissionPiStorage } from "@convex/integrations/piStorage";
import { PI_COMMIT_MAX_BYTES } from "@convex/resourceLimits";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedPiMission } from "@/__tests__/setup/pi-mission";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test("a late wake closes an expired mission explicitly without provider work", async () => {
    const { t, missionId } = await seedPiMission();
    await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
        simulation: true,
    });
    const scheduled = await t.run((ctx) => ctx.db.get(missionId));
    if (!scheduled?.piWakeToken) throw new Error("Expected worker wake");
    vi.setSystemTime(scheduled.deadlineAt + 1);
    await t.action(internal.execution.piWorker.run, {
        missionId,
        expectedGeneration: 4,
        token: scheduled.piWakeToken,
    });
    const observed = await t.run(async (ctx) => ({
        mission: await ctx.db.get(missionId),
        events: await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_sequence", (q) =>
                q.eq("missionId", missionId),
            )
            .collect(),
        calls: await ctx.db.query("providerCalls").collect(),
    }));
    expect(observed.mission).toMatchObject({
        status: "blocked",
        blockCode: "execution_deadline",
    });
    expect(observed.mission?.piWakeId).toBeUndefined();
    expect(observed.events).toContainEqual(
        expect.objectContaining({
            kind: "mission_blocked",
            code: "execution_deadline",
        }),
    );
    expect(observed.calls).toEqual([]);
});

test("an oversized retained commit blocks the mission permanently before provider work", async () => {
    const { t, missionId } = await seedPiMission();
    const lease = await t.mutation(internal.execution.piStore.claim, {
        missionId,
        expectedGeneration: 4,
        writer: "retained-history",
    });
    // An unsupported retained log must stop explicitly when opened, without rewriting its originals.
    const payload = JSON.stringify([
        {
            type: "conversation",
            value: { id: 1 },
            retained: "x".repeat(PI_COMMIT_MAX_BYTES),
        },
    ]);
    await t.run(async (ctx) => {
        await ctx.db.insert("piCommits", {
            sessionId: lease.sessionId,
            sequence: 1,
            key: "oversized-original",
            payload,
        });
        await ctx.db.patch(lease.sessionId, {
            sequence: 1,
            retainedBytes: new TextEncoder().encode(payload).length,
            leaseUntil: Date.now() - 1,
        });
    });
    await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
        simulation: true,
    });
    const mission = await t.run((ctx) => ctx.db.get(missionId));
    if (!mission?.piWakeToken) throw new Error("Expected worker wake");
    await expect(
        t.action(internal.execution.piWorker.run, {
            missionId,
            expectedGeneration: 4,
            token: mission.piWakeToken,
        }),
    ).resolves.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        status: "blocked",
        blockCode: "pi_commit_capacity",
    });
    await expect(
        t.mutation(internal.execution.missions.resume, {
            missionId,
            expectedGeneration: 4,
            simulation: true,
        }),
    ).rejects.toThrow("pi_commit_capacity");
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("piCommits")
                .withIndex("by_session_and_sequence", (q) =>
                    q.eq("sessionId", lease.sessionId),
                )
                .collect(),
        ),
    ).toEqual([expect.objectContaining({ sequence: 1, payload })]);
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
}, 30000);

test("replay renews its fenced writer lease while loading multiple pages", async () => {
    vi.useFakeTimers();
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "slow-replay",
        expectedGeneration: 4,
    });
    const writer = "slow-replay";
    const lease = await t.mutation(internal.execution.piStore.claim, {
        missionId,
        expectedGeneration: 4,
        writer,
    });
    for (let sequence = 1; sequence <= 96; sequence++)
        await t.mutation(internal.execution.piStore.append, {
            ...lease,
            sequence,
            key: `commit-${sequence}`,
            payload: JSON.stringify([
                sequence === 1
                    ? {
                          type: "conversation",
                          value: { id: ROOT_CONVERSATION_ID },
                      }
                    : {
                          type: "entry",
                          value: {
                              id: sequence + 1,
                              conversationId: ROOT_CONVERSATION_ID,
                              kind: "workbench.original",
                              data: { text: "x".repeat(128 * 1024) },
                          },
                      },
            ]),
        });
    await t.action(async (ctx) => {
        let pages = 0;
        const delayed: typeof ctx = {
            ...ctx,
            runQuery: async (...call) => {
                pages++;
                vi.setSystemTime(Date.now() + 20000);
                return ctx.runQuery(...call);
            },
        };
        const startedAt = Date.now();
        const storage = await openMissionPiStorage(
            delayed,
            missionId,
            4,
            writer,
            BACKGROUND_CONTEXT,
        );
        try {
            expect(pages).toBeGreaterThan(4);
            expect(Date.now() - startedAt).toBe(pages * 20000);
            expect(
                await storage.conversation(
                    ROOT_CONVERSATION_ID,
                    BACKGROUND_CONTEXT,
                ),
            ).toMatchObject({ id: ROOT_CONVERSATION_ID });
            await expect(storage.mintId()).resolves.toBe(98);
            await expect(storage.renewLease()).resolves.toBeUndefined();
        } finally {
            await storage.close(BACKGROUND_CONTEXT);
        }
    });
}, 30000);

test("permanent native-tail failure preserves published work without scheduling another writer", async () => {
    const { t, runId, client } = await seedWorkbench(true);
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
    const lease = await t.mutation(internal.execution.piStore.claim, {
        missionId: active.missionId,
        expectedGeneration: 1,
        writer: "probe-0",
    });
    await t.run(async (ctx) => {
        await ctx.db.patch(active.missionId, {
            status: "completed",
            piActiveWriter: "probe-0",
            deadlineAt: Date.now() - 1,
        });
        await ctx.db.patch(lease.sessionId, {
            sequence: 1,
            settledSequence: 0,
        });
    });
    await t.mutation(internal.execution.piControl.closeWorker, {
        missionId: active.missionId,
        expectedGeneration: 1,
        writer: "probe-0",
        error: "publication_context_unavailable",
    });
    const failed = await t.run((ctx) => ctx.db.get(active.missionId));
    expect(failed?.status).toBe("completed");
    expect(failed?.piWakeToken).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get(lease.sessionId))).toMatchObject({
        settlementFailureCode: "publication_context_unavailable",
    });
    expect(
        await client.query(api.execution.conversations.get, { runId }),
    ).toMatchObject({
        queuePaused: true,
        admissionFailure: { code: "native_settlement_incomplete" },
    });
    await expect(
        client.mutation(api.execution.conversations.resumeQueue, { runId }),
    ).rejects.toThrow("native_settlement_incomplete");
});

test("native settlement retries are bounded and back off without losing a completed result", async () => {
    const { t, runId } = await seedWorkbench(true);
    const turn = await t.mutation(internal.execution.conversations.startTurn, {
        runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        simulation: true,
    });
    assert(turn);
    const lease = await t.mutation(internal.execution.piStore.claim, {
        missionId: turn.missionId,
        expectedGeneration: 1,
        writer: "tail-retry",
    });
    await t.run(async (ctx) => {
        await ctx.db.patch(turn.missionId, {
            status: "completed",
            piActiveWriter: "tail-retry",
        });
        await ctx.db.patch(lease.sessionId, {
            sequence: 1,
            settledSequence: 0,
        });
    });
    for (let attempt = 1; attempt <= 3; attempt++) {
        const writer = attempt === 1 ? "tail-retry" : `tail-retry-${attempt}`;
        await t.mutation(internal.execution.piStore.claim, {
            missionId: turn.missionId,
            expectedGeneration: 1,
            writer,
        });
        await t.run((ctx) =>
            ctx.db.patch(turn.missionId, { piActiveWriter: writer }),
        );
        await t.mutation(internal.execution.piControl.closeWorker, {
            missionId: turn.missionId,
            expectedGeneration: 1,
            writer,
            error: "execution_interrupted",
        });
        const mission = await t.run((ctx) => ctx.db.get(turn.missionId));
        expect(mission?.status).toBe("completed");
        if (attempt < 3)
            expect(mission?.piWakeAt).toBe(
                Date.now() + 1000 * 2 ** (attempt - 1),
            );
        else expect(mission?.piWakeToken).toBeUndefined();
    }
    expect(await t.run((ctx) => ctx.db.get(lease.sessionId))).toMatchObject({
        settlementFailureCode: "native_settlement_incomplete",
        settlementAttempts: 3,
    });
});

test("successful native settlement clears the retry count for the next response", async () => {
    const { t, runId } = await seedWorkbench(true);
    const turn = await t.mutation(internal.execution.conversations.startTurn, {
        runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        simulation: true,
    });
    assert(turn);
    const lease = await t.mutation(internal.execution.piStore.claim, {
        missionId: turn.missionId,
        expectedGeneration: 1,
        writer: "tail-success",
    });
    await t.run(async (ctx) => {
        await ctx.db.patch(turn.missionId, {
            status: "completed",
            piActiveWriter: "tail-success",
        });
        await ctx.db.patch(lease.sessionId, {
            sequence: 2,
            settledSequence: 1,
            settlementAttempts: 2,
        });
    });
    await t.mutation(internal.execution.piControl.closeWorker, {
        missionId: turn.missionId,
        expectedGeneration: 1,
        writer: "tail-success",
        nativeSettled: true,
    });
    expect(await t.run((ctx) => ctx.db.get(lease.sessionId))).toMatchObject({
        settledSequence: 2,
    });
    expect(
        (await t.run((ctx) => ctx.db.get(lease.sessionId)))?.settlementAttempts,
    ).toBeUndefined();
});

test("replaying a worker closure does not consume another native settlement attempt", async () => {
    const { t, runId } = await seedWorkbench(true);
    const turn = await t.mutation(internal.execution.conversations.startTurn, {
        runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        simulation: true,
    });
    assert(turn);
    const lease = await t.mutation(internal.execution.piStore.claim, {
        missionId: turn.missionId,
        expectedGeneration: 1,
        writer: "closure-replay",
    });
    await t.run(async (ctx) => {
        await ctx.db.patch(turn.missionId, {
            status: "completed",
            piActiveWriter: "closure-replay",
        });
        await ctx.db.patch(lease.sessionId, {
            sequence: 1,
            settledSequence: 0,
        });
    });
    const args = {
        missionId: turn.missionId,
        expectedGeneration: 1,
        writer: "closure-replay",
        error: "execution_interrupted",
    };
    await t.mutation(internal.execution.piControl.closeWorker, args);
    const first = await t.run((ctx) => ctx.db.get(turn.missionId));
    await t.mutation(internal.execution.piControl.closeWorker, args);
    expect(await t.run((ctx) => ctx.db.get(lease.sessionId))).toMatchObject({
        settlementAttempts: 1,
    });
    expect(await t.run((ctx) => ctx.db.get(turn.missionId))).toEqual(first);
});
