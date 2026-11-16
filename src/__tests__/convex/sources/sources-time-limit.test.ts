import { api, internal } from "@convex/_generated/api";
import { executionFailureCode } from "@convex/execution/errors";
import { researchStateSummary } from "@convex/execution/researchControl";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

/** A framed Sources run whose mission reached its preparation deadline. */
async function seedExpiredPreparation() {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const frameId = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Fixed workflow", questions: [] },
            requestKey: "fixed",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            fixedFramingRevisionId: frameId,
        });
    });
    vi.advanceTimersByTime(61_000);
    return f;
}

test("the system hands off retained material after the preparation deadline", async () => {
    const f = await seedExpiredPreparation();
    await f.t.run((ctx) =>
        ctx.db.patch(f.missionId, {
            status: "blocked",
            blockCode: "execution_deadline",
        }),
    );
    expect(
        await f.t.mutation(internal.sourcesMission.finish, {
            preparationId: f.preparationId,
            missionId: f.missionId,
            expectedGeneration: 4,
        }),
    ).toBeNull();
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    expect(run).toMatchObject({
        lifecycleState: "sources_prepared",
        executionStatus: "idle",
    });
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(preparation?.sourcesMission?.result?.outcome).toBeDefined();
    expect(
        preparation?.sourcesMission?.result?.needs.every(
            (need) => need.unfinished.length > 0 || need.contributions.length,
        ),
    ).toBe(true);
});

test("the system hands off retained material after the preparation budget is exhausted", async () => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.missionId, {
            status: "blocked",
            blockCode: "work_budget_exhausted",
        });
        await ctx.db.patch(f.runId, {
            sourcePreparationBudget: {
                version: 1,
                work: 1_000_000,
                incidents: 0,
                reserved: 0,
                dispatches: 0,
            },
        });
    });
    expect(
        await f.t.mutation(internal.sourcesMission.finish, {
            preparationId: f.preparationId,
            missionId: f.missionId,
            expectedGeneration: 4,
        }),
    ).toBeNull();
    expect((await f.t.run((ctx) => ctx.db.get(f.runId)))?.lifecycleState).toBe(
        "sources_prepared",
    );
});

test("settlement still refuses a cancelled run after the deadline", async () => {
    const f = await seedExpiredPreparation();
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.missionId, {
            status: "blocked",
            blockCode: "execution_deadline",
        });
        await ctx.db.patch(f.runId, { executionStatus: "cancelled" });
    });
    const error = await f.t
        .mutation(internal.sourcesMission.finish, {
            preparationId: f.preparationId,
            missionId: f.missionId,
            expectedGeneration: 4,
        })
        .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((await f.t.run((ctx) => ctx.db.get(f.runId)))?.lifecycleState).toBe(
        "discovering_sources",
    );
});

/** Reaches the deadline with a mission blocked by an unconfirmed operation, as observed on 2026-11-15. */
async function reachTimeLimit(
    f: Awaited<ReturnType<typeof seedExpiredPreparation>>,
    options: { completionEventId?: string } = {},
) {
    await f.t.run((ctx) =>
        ctx.db.patch(f.missionId, {
            status: "blocked",
            blockCode: "operation_outcome_unknown",
            ...(options.completionEventId
                ? { completionEventId: options.completionEventId as never }
                : {}),
        }),
    );
    await f.t.mutation(internal.execution.handoffs.finishChild, {
        missionId: f.missionId,
    });
}

const client = (f: Awaited<ReturnType<typeof seedExpiredPreparation>>) =>
    f.t.withIdentity({ subject: f.userId });

test("a time limit with remaining capacity pauses for the analyst instead of handing off", async () => {
    const f = await seedExpiredPreparation();
    const before = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    // An unregistered completion event would fail if notification were attempted.
    await reachTimeLimit(f, { completionEventId: "unregistered-event" });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        lifecycleState: "discovering_sources",
        executionStatus: "paused",
        pauseReason: "sources_time_limit",
        executionGeneration: 5,
    });
    const mission = await f.t.run((ctx) => ctx.db.get(f.missionId));
    expect(mission).toMatchObject({
        status: "blocked",
        blockCode: "execution_time_limit",
    });
    expect(mission?.completionNotified).toBeUndefined();
    const after = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(after?.sourcesMission).toEqual(before?.sourcesMission);
    expect(
        await f.t.mutation(internal.execution.researchControl.checkpoint, {
            runId: f.runId,
        }),
    ).toEqual({ waiting: true, generation: 5 });
});

test("a time limit without remaining capacity hands off with limits automatically", async () => {
    const f = await seedExpiredPreparation();
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        const { envelope } = preparation.sourcesMission;
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                searches: envelope.initialSearches,
                acquisitions: envelope.acquisitions,
                controls: envelope.controls,
            },
        });
    });
    await reachTimeLimit(f);
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "running",
        executionGeneration: 4,
    });
    expect((await f.t.run((ctx) => ctx.db.get(f.missionId)))?.blockCode).toBe(
        "operation_outcome_unknown",
    );
    expect(
        await f.t.mutation(internal.sourcesMission.finish, {
            preparationId: f.preparationId,
            missionId: f.missionId,
            expectedGeneration: 4,
        }),
    ).toBeNull();
    expect((await f.t.run((ctx) => ctx.db.get(f.runId)))?.lifecycleState).toBe(
        "sources_prepared",
    );
});

test("Continue renews the window without resetting counters and resumes the same mission", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);
    const before = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    const generation = await client(f).mutation(
        api.execution.researchControl.resume,
        { runId: f.runId, expectedGeneration: 5 },
    );
    expect(generation).toBe(6);
    const now = Date.now();
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    expect(run).toMatchObject({ executionStatus: "running" });
    expect(run?.pauseReason).toBeUndefined();
    expect(run?.executionHarnessDeadlineAt).toBeGreaterThan(now);
    const after = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(after?.deadlineAt).toBeGreaterThan(now);
    expect(after?.leaseExpiresAt).toBe(after?.deadlineAt);
    expect(after?.sourcesMission).toEqual(before?.sourcesMission);
    await f.t.mutation(internal.execution.researchControl.resumeMissions, {
        runId: f.runId,
        generation,
        paginationOpts: { numItems: 20, cursor: null },
    });
    const mission = await f.t.run((ctx) => ctx.db.get(f.missionId));
    expect(mission).toMatchObject({ status: "ready", generation });
    expect(mission?.deadlineAt).toBe(run?.executionHarnessDeadlineAt);
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});

test("Use what's prepared lets the waiting handoff settle without claiming the execution slot", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);
    await client(f).mutation(api.sourcesMission.settle, {
        runId: f.runId,
        expectedGeneration: 5,
    });
    await client(f).mutation(api.sourcesMission.settle, {
        runId: f.runId,
        expectedGeneration: 5,
    });
    expect((await f.t.run((ctx) => ctx.db.get(f.missionId)))?.blockCode).toBe(
        "execution_deadline",
    );
    expect(
        await f.t.mutation(internal.execution.researchControl.checkpoint, {
            runId: f.runId,
        }),
    ).toEqual({ waiting: false, generation: 5 });
    expect(
        await f.t.mutation(internal.sourcesMission.finish, {
            preparationId: f.preparationId,
            missionId: f.missionId,
            expectedGeneration: 5,
        }),
    ).toBeNull();
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    expect(run).toMatchObject({
        lifecycleState: "sources_prepared",
        executionStatus: "idle",
    });
    expect(run?.pauseReason).toBeUndefined();
    const resume = await client(f)
        .mutation(api.execution.researchControl.resume, {
            runId: f.runId,
            expectedGeneration: 5,
        })
        .catch((caught: unknown) => caught);
    expect(executionFailureCode(resume)).toBeDefined();
});

test("Continue and settlement cannot both apply", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);
    await client(f).mutation(api.sourcesMission.settle, {
        runId: f.runId,
        expectedGeneration: 5,
    });
    const resume = await client(f)
        .mutation(api.execution.researchControl.resume, {
            runId: f.runId,
            expectedGeneration: 5,
        })
        .catch((caught: unknown) => caught);
    expect(executionFailureCode(resume)).toBe("sources_settlement_requested");

    const g = await seedExpiredPreparation();
    await reachTimeLimit(g);
    await client(g).mutation(api.execution.researchControl.resume, {
        runId: g.runId,
        expectedGeneration: 5,
    });
    const settle = await client(g)
        .mutation(api.sourcesMission.settle, {
            runId: g.runId,
            expectedGeneration: 5,
        })
        .catch((caught: unknown) => caught);
    expect(executionFailureCode(settle)).toBe("stale_execution");
});

test("Continue is refused before any work while paid work is stopped", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);
    await f.t.run((ctx) =>
        ctx.db.insert("paidWorkControls", {
            key: "global",
            enabled: false,
            updatedAt: 1,
        }),
    );
    const resume = await client(f)
        .mutation(api.execution.researchControl.resume, {
            runId: f.runId,
            expectedGeneration: 5,
        })
        .catch((caught: unknown) => caught);
    expect(executionFailureCode(resume)).toBe("paid_work_disabled");
    expect((await f.t.run((ctx) => ctx.db.get(f.runId)))?.pauseReason).toBe(
        "sources_time_limit",
    );
});

test("an analyst pause that outlives the window renews it on Resume", async () => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const frameId = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Fixed workflow", questions: [] },
            requestKey: "fixed",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            fixedFramingRevisionId: frameId,
        });
    });
    await client(f).mutation(api.execution.researchControl.pause, {
        runId: f.runId,
        expectedGeneration: 4,
    });
    const paused = await f.t.mutation(
        internal.execution.researchControl.checkpoint,
        { runId: f.runId, preparationId: f.preparationId },
    );
    vi.advanceTimersByTime(61_000);
    await reachTimeLimit(f);
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        pauseReason: "analyst",
        executionGeneration: paused.generation,
    });
    expect((await f.t.run((ctx) => ctx.db.get(f.missionId)))?.blockCode).toBe(
        "execution_time_limit",
    );
    await client(f).mutation(api.execution.researchControl.resume, {
        runId: f.runId,
        expectedGeneration: paused.generation,
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.deadlineAt,
    ).toBeGreaterThan(Date.now());
});

test("one Sources phase reaches the workspace and Workbench before and after settlement", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);
    const read = async () => ({
        run: await client(f).query(api.researchRuns.getMine, {
            runId: f.runId,
        }),
        snapshot: await client(f).query(api.workbench.snapshot, {
            runId: f.runId,
        }),
    });
    const paused = await read();
    expect(paused.run).toMatchObject({
        sourcesPhase: "time_limit",
        sourcesContinueBlock: null,
    });
    expect(paused.snapshot.sourcesPhase).toBe("time_limit");
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(run);
    expect(researchStateSummary(run)).toContain(
        "Sources reached its time limit.",
    );
    await f.t.run((ctx) =>
        ctx.db.insert("paidWorkControls", {
            key: "global",
            enabled: false,
            updatedAt: 1,
        }),
    );
    expect((await read()).run.sourcesContinueBlock).toBe("paid_work_disabled");
    await client(f).mutation(api.sourcesMission.settle, {
        runId: f.runId,
        expectedGeneration: 5,
    });
    await f.t.mutation(internal.sourcesMission.finish, {
        preparationId: f.preparationId,
        missionId: f.missionId,
        expectedGeneration: 5,
    });
    const settled = await read();
    expect(settled.run.sourcesPhase).toBe("completed_with_limits");
    expect(settled.snapshot.sourcesPhase).toBe("completed_with_limits");
});
