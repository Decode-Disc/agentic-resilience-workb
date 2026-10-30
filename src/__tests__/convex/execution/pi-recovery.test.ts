import { internal } from "@convex/_generated/api";
import { openMissionPiStorage } from "@convex/integrations/piStorage";
import { PI_COMMIT_MAX_BYTES } from "@convex/resourceLimits";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import { afterEach, expect, test, vi } from "vitest";
import { seedPiMission } from "@/__tests__/setup/pi-mission";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

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
                              data: { text: "x".repeat(1024) },
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
            expect(pages).toBe(6);
            expect(Date.now() - startedAt).toBe(120000);
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
