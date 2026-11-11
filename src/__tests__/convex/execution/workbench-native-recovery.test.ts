import { api, internal } from "@convex/_generated/api";
import { executionError } from "@convex/execution/errors";
import { runPiMission } from "@convex/integrations/piMission";
import { nodeActionGenerationDeadline } from "@convex/resourcePolicy";
import { PiConvexStorage } from "@convex/integrations/piStorage";
import { type FunctionArgs, getFunctionName } from "convex/server";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

test("a reopened final reply adopts once after an operation arrived before completion", async () => {
    const { t, client, runId } = await seedWorkbench(true);
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
    const message = await t.run((ctx) =>
        ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_turn", (q) => q.eq("turnId", active.turnId))
            .first(),
    );
    assert(message);
    let interrupted = false;
    await t.action((ctx) =>
        runPiMission(
            {
                ...ctx,
                runMutation: async (reference, args) => {
                    if (
                        !interrupted &&
                        getFunctionName(reference) ===
                            "execution/invocations:finish"
                    ) {
                        const finish = args as FunctionArgs<
                            typeof internal.execution.invocations.finish
                        >;
                        if (finish.response.kind === "complete") {
                            const run = await t.run((c) => c.db.get(runId));
                            assert(run?.currentFramingRevisionId);
                            const revisionId = run.currentFramingRevisionId;
                            const framing = await t.run((c) =>
                                c.db.get(revisionId),
                            );
                            assert(framing);
                            await ctx.runMutation(
                                internal.execution.operations.enqueue,
                                {
                                    missionId: active.missionId,
                                    expectedGeneration: 1,
                                    cause: "late-retained-work",
                                    input: {
                                        kind: "adjust_framing",
                                        messageId: message._id,
                                        expectedRevision: framing.revision,
                                        content: framing.content,
                                    },
                                },
                            );
                            const result = await ctx.runMutation(
                                reference,
                                args,
                            );
                            expect(result).toMatchObject({
                                kind: "blocked",
                                code: "pending_operations",
                            });
                            interrupted = true;
                            throw executionError("pi_slice_complete");
                        }
                    }
                    return ctx.runMutation(reference, args);
                },
            },
            { missionId: active.missionId, expectedGeneration: 1 },
            "before-late-work",
            nodeActionGenerationDeadline(Date.now()),
        ),
    );
    expect(interrupted).toBe(true);
    const before = await t.run((ctx) =>
        ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", active.missionId))
            .collect(),
    );
    expect(before.some((i) => i.blockCode === "pending_operations")).toBe(true);
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(await t.run((ctx) => ctx.db.get(active.missionId))).toMatchObject({
        status: "completed",
    });
    const after = await t.run((ctx) =>
        ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", active.missionId))
            .collect(),
    );
    expect(after).toHaveLength(before.length);
    expect(after.every((i) => !i.blockCode)).toBe(true);
    const messages = await client.query(
        api.execution.conversations.listMessages,
        { runId, paginationOpts: { numItems: 20, cursor: null } },
    );
    expect(
        messages.page.filter((message) => message.role === "assistant"),
    ).toHaveLength(1);
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
}, 30000);

test("reopening after a stale tool reply preserves its refusal instead of executing its raw calls", async () => {
    const { t, client, runId } = await seedWorkbench(true);
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
    let interrupted = false;
    await t.action((ctx) =>
        runPiMission(
            {
                ...ctx,
                runMutation: async (reference, args) => {
                    if (
                        !interrupted &&
                        getFunctionName(reference) ===
                            "execution/invocations:finish"
                    ) {
                        const finish = args as FunctionArgs<
                            typeof internal.execution.invocations.finish
                        >;
                        if (finish.response.kind === "operations") {
                            await client.mutation(
                                api.execution.conversations.submit,
                                {
                                    runId,
                                    requestKey: "steer-before-crash",
                                    text: "Preserve the analyst's new direction.",
                                    delivery: "steer",
                                    turnId: active.turnId,
                                },
                            );
                            const result = await ctx.runMutation(
                                reference,
                                args,
                            );
                            expect(result).toMatchObject({
                                kind: "blocked",
                                code: "stale_instructions",
                            });
                            interrupted = true;
                            throw executionError("pi_slice_complete");
                        }
                    }
                    return ctx.runMutation(reference, args);
                },
            },
            { missionId: active.missionId, expectedGeneration: 1 },
            "before-stale-crash",
            nodeActionGenerationDeadline(Date.now()),
        ),
    );
    expect(interrupted).toBe(true);
    const refused = await t.run((ctx) =>
        ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", active.missionId))
            .first(),
    );
    assert(refused);
    expect(refused.blockCode).toBe("stale_instructions");
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(await t.run((ctx) => ctx.db.get(active.missionId))).toMatchObject({
        status: "completed",
    });
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("agentOperationRequests")
                .withIndex("by_invocation", (q) =>
                    q.eq("invocationId", refused._id),
                )
                .collect(),
        ),
    ).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(refused._id))).toMatchObject({
        blockCode: "stale_instructions",
        rawOutputJson: refused.rawOutputJson,
    });
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
}, 30000);

test("a crash after publication settles the original native task before the next mission without replaying model work", async () => {
    const { t, client, runId } = await seedWorkbench(true);
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    if (!active) throw new Error("Missing active turn");
    const commit = PiConvexStorage.prototype.commit;
    const fault = vi
        .spyOn(PiConvexStorage.prototype, "commit")
        .mockImplementation(async function (
            this: PiConvexStorage,
            writes,
            context,
        ) {
            const mission = await t.run((ctx) => ctx.db.get(active.missionId));
            if (mission?.status === "completed")
                throw executionError("simulated_native_tail_crash");
            return commit.call(this, writes, context);
        });
    try {
        await expect(
            t.action((ctx) =>
                runPiMission(
                    ctx,
                    { missionId: active.missionId, expectedGeneration: 1 },
                    "crashed",
                    nodeActionGenerationDeadline(Date.now()),
                ),
            ),
        ).rejects.toThrow();
    } finally {
        fault.mockRestore();
    }
    const before = await t.run(async (ctx) => ({
        mission: await ctx.db.get(active.missionId),
        invocations: await ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", active.missionId))
            .collect(),
        session: await ctx.db
            .query("piSessions")
            .withIndex("by_mission", (q) => q.eq("missionId", active.missionId))
            .unique(),
    }));
    expect(before.mission?.status).toBe("completed");
    expect(before.session?.settledSequence).not.toBe(before.session?.sequence);
    const sessionId = before.session?._id;
    assert(sessionId);
    await t.run((ctx) => ctx.db.patch(sessionId, { leaseUntil: 0 }));
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "after-crash",
        text: "Continue from the saved program.",
        delivery: "queue",
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const after = await t.run(async (ctx) => ({
        invocations: await ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", active.missionId))
            .collect(),
        sessions: await ctx.db.query("piSessions").collect(),
        completed: await ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", runId).eq("status", "completed"),
            )
            .take(10),
    }));
    expect(after.invocations).toEqual(before.invocations);
    expect(after.sessions).toHaveLength(1);
    assert(after.sessions[0]);
    expect(after.sessions[0].settledSequence).toBe(after.sessions[0].sequence);
    expect(after.completed).toHaveLength(2);
}, 30000);

test("journal exhaustion preserves the journal and stops the entire conversation without a new-message escape", async () => {
    const { PI_SESSION_MAX_BYTES } = await import("@convex/resourcePolicy");
    const { t, client, runId } = await seedWorkbench(true);
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    if (!active) throw new Error("Missing active turn");
    const lease = await t.mutation(internal.execution.piStore.claim, {
        missionId: active.missionId,
        expectedGeneration: 1,
        writer: "full",
    });
    await t.run((ctx) =>
        ctx.db.patch(lease.sessionId, {
            retainedBytes: PI_SESSION_MAX_BYTES,
            leaseUntil: 0,
        }),
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(
        await client.query(api.execution.conversations.get, { runId }),
    ).toMatchObject({
        queuePaused: true,
        admissionFailure: { code: "pi_storage_capacity" },
    });
    await expect(
        client.mutation(api.execution.conversations.resumeQueue, { runId }),
    ).rejects.toThrow("pi_storage_capacity");
    expect(await t.run((ctx) => ctx.db.get(lease.sessionId))).toMatchObject({
        retainedBytes: PI_SESSION_MAX_BYTES,
        sequence: 0,
    });
    expect(
        await t.run((ctx) => ctx.db.query("piSessions").collect()),
    ).toHaveLength(1);
}, 30000);

test("native compaction and a later response preserve the same journal and exact originals", async () => {
    const { seedPiHistory } = await import("@/__tests__/setup/pi-mission");
    const { t, client, runId } = await seedWorkbench(true);
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    if (!active) throw new Error("Missing active turn");
    await seedPiHistory(t, active.missionId, 1, 8, 16250);
    await t.mutation(internal.execution.missions.resume, {
        missionId: active.missionId,
        expectedGeneration: 1,
        simulation: true,
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "after-compaction",
        text: "Continue with the same research program.",
        delivery: "queue",
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const observed = await t.run(async (ctx) => ({
        sessions: await ctx.db.query("piSessions").collect(),
        commits: await ctx.db.query("piCommits").collect(),
        invocations: await ctx.db.query("agentInvocations").collect(),
        completed: await ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", runId).eq("status", "completed"),
            )
            .take(10),
    }));
    expect(observed.sessions).toHaveLength(1);
    expect(
        observed.completed,
        JSON.stringify({
            missions: await t
                .run((ctx) => ctx.db.query("agentMissions").collect())
                .then((ms) =>
                    ms.map((m) => ({ status: m.status, code: m.blockCode })),
                ),
            invocations: observed.invocations.map((i) => ({
                purpose: i.purpose,
                status: i.status,
                code: i.blockCode,
                output: i.receivedOutputJson,
            })),
        }),
    ).toHaveLength(2);
    expect(
        observed.invocations.some(
            (invocation) =>
                invocation.purpose === "compaction" &&
                invocation.status === "returned",
        ),
    ).toBe(true);
    expect(
        observed.commits.some((commit) =>
            commit.payload?.includes("EXACT-ORIGINAL-0"),
        ),
    ).toBe(true);
}, 30000);
