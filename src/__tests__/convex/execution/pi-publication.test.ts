import { internal } from "@convex/_generated/api";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

test("a publication hold defers worker admission and preserves its scheduled continuation", async () => {
    const { t, runId } = await seedWorkbench(true);
    const turn = await t.mutation(internal.execution.conversations.startTurn, {
        runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        simulation: true,
    });
    assert(turn);
    const mission = await t.run((ctx) => ctx.db.get(turn.missionId));
    assert(mission?.piWakeToken);
    await t.mutation(internal.execution.piControl.holdPublication, {
        held: true,
    });
    expect(
        await t.mutation(internal.execution.piControl.prepare, {
            missionId: turn.missionId,
            expectedGeneration: 1,
            token: mission.piWakeToken,
            writer: "held-worker",
        }),
    ).toBe(false);
    expect(
        await t.query(internal.execution.piControl.publicationStatus, {}),
    ).toMatchObject({ held: true, hasActiveWorkers: false });
    expect(await t.run((ctx) => ctx.db.get(turn.missionId))).toMatchObject({
        status: mission.status,
        piWakeAt: Date.now() + 5000,
    });
    expect(await t.run((ctx) => ctx.db.query("piSessions").collect())).toEqual(
        [],
    );
    await t.mutation(internal.execution.piControl.holdPublication, {
        held: false,
    });
    await vi.advanceTimersByTimeAsync(5000);
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(await t.run((ctx) => ctx.db.get(turn.missionId))).toMatchObject({
        status: "completed",
    });
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
}, 30000);

test("publication cannot be released while an admitted writer is still draining", async () => {
    const { t, runId } = await seedWorkbench(true);
    const turn = await t.mutation(internal.execution.conversations.startTurn, {
        runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        simulation: true,
    });
    assert(turn);
    const mission = await t.run((ctx) => ctx.db.get(turn.missionId));
    assert(mission?.piWakeToken);
    expect(
        await t.mutation(internal.execution.piControl.prepare, {
            missionId: turn.missionId,
            expectedGeneration: 1,
            token: mission.piWakeToken,
            writer: "draining",
        }),
    ).toBe(true);
    const lease = await t.mutation(internal.execution.piStore.claim, {
        missionId: turn.missionId,
        expectedGeneration: 1,
        writer: "draining",
    });
    await t.mutation(internal.execution.piControl.holdPublication, {
        held: true,
    });
    expect(
        await t.query(internal.execution.piControl.publicationStatus, {}),
    ).toEqual({ held: true, hasActiveWorkers: true });
    await expect(
        t.mutation(internal.execution.piStore.renew, lease),
    ).resolves.toBeNull();
    await expect(
        t.mutation(internal.execution.piControl.holdPublication, {
            held: false,
        }),
    ).rejects.toThrow("publication_workers_active");
    await t.mutation(internal.execution.piControl.closeWorker, {
        missionId: turn.missionId,
        expectedGeneration: 1,
        writer: "draining",
    });
    expect(
        await t.query(internal.execution.piControl.publicationStatus, {}),
    ).toEqual({ held: true, hasActiveWorkers: false });
    await expect(
        t.mutation(internal.execution.piControl.holdPublication, {
            held: false,
        }),
    ).resolves.toBeNull();
});

test("explicit publication recovery fences an expired admitted writer without provider work", async () => {
    const external = vi.fn(() => {
        throw new Error("External I/O forbidden");
    });
    vi.stubGlobal("fetch", external);
    const { t, runId } = await seedWorkbench(true);
    const turn = await t.mutation(internal.execution.conversations.startTurn, {
        runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        simulation: true,
    });
    assert(turn);
    const mission = await t.run((ctx) => ctx.db.get(turn.missionId));
    assert(mission?.piWakeToken);
    expect(
        await t.mutation(internal.execution.piControl.prepare, {
            missionId: turn.missionId,
            expectedGeneration: 1,
            token: mission.piWakeToken,
            writer: "writer-lost-before-close",
        }),
    ).toBe(true);
    await t.mutation(internal.execution.piControl.holdPublication, {
        held: true,
    });
    const admittedSession = await t.run((ctx) =>
        ctx.db.query("piSessions").first(),
    );
    assert(admittedSession);
    await expect(
        t.mutation(internal.execution.piControl.recoverPublicationWorkers, {}),
    ).rejects.toThrow("publication_workers_active");
    // Model an abrupt host loss: no closeWorker callback can arrive, and the actual lease expires.
    vi.setSystemTime(admittedSession.leaseUntil + 1);
    const retained = await t.run(async (ctx) => ({
        mission: await ctx.db.get(turn.missionId),
        session: await ctx.db.get(admittedSession._id),
        calls: await ctx.db.query("providerCalls").collect(),
    }));
    expect(retained.mission?.piActiveWriter).toBe("writer-lost-before-close");
    expect(retained.session?.leaseUntil).toBeLessThan(Date.now());
    expect(retained.calls).toEqual([]);
    expect(external).not.toHaveBeenCalled();
    await t.mutation(
        internal.execution.piControl.recoverPublicationWorkers,
        {},
    );
    expect(
        await t.query(internal.execution.piControl.publicationStatus, {}),
    ).toEqual({ held: true, hasActiveWorkers: false });
    await expect(
        t.mutation(internal.execution.piControl.holdPublication, {
            held: false,
        }),
    ).resolves.toBeNull();
    await expect(
        t.mutation(internal.execution.piStore.renew, {
            sessionId: admittedSession._id,
            epoch: admittedSession.epoch,
            writer: admittedSession.writer,
            missionId: turn.missionId,
            generation: 1,
        }),
    ).rejects.toThrow();
    const fenced = await t.run((ctx) => ctx.db.get(admittedSession._id));
    await t.mutation(internal.execution.piControl.closeWorker, {
        missionId: turn.missionId,
        expectedGeneration: 1,
        writer: "writer-lost-before-close",
        nativeSettled: true,
    });
    expect(await t.run((ctx) => ctx.db.get(admittedSession._id))).toEqual(
        fenced,
    );
    expect(external).not.toHaveBeenCalled();
});
