import { api, internal } from "@convex/_generated/api";
import { readWorkbenchFacts } from "@convex/domain/workbenchContext";
import { workflow } from "@convex/workflow";
import { afterEach, assert, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";
import {
    client,
    seedTimeLimitConversation,
} from "@/__tests__/setup/sources-time-limit";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

test.each([
    "finish",
    "rebind",
])("a historical generation stop notifies its waiting owner through %s", async (path) => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    workflowTest.register(f.t);
    const eventId = await f.t.run(async (ctx) => {
        const workflowId = await workflow.start(
            ctx,
            internal.researchWorkflow.run,
            { runId: f.runId, executionGeneration: 4 },
        );
        const eventId = await workflow.createEvent(ctx, {
            name: "terminal",
            workflowId,
        });
        await ctx.db.patch(f.missionId, {
            status: "blocked",
            blockCode: "invalid_output",
            ...(path === "finish" ? { completionEventId: eventId } : {}),
        });
        return eventId;
    });
    if (path === "finish")
        await f.t.mutation(internal.execution.handoffs.finishChild, {
            missionId: f.missionId,
        });
    else
        await f.t.mutation(internal.execution.missions.rebindCompletionEvent, {
            missionId: f.missionId,
            eventId,
            expectedGeneration: 4,
        });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        completionNotified: true,
    });
});

test.each([
    "invalid_output",
    "repetition_stop",
])("genuine allowance exhaustion hands off retained material after %s", async (code) => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            sourcePreparationBudget: {
                version: 1,
                work: 1000000,
                incidents: 0,
                reserved: 0,
                dispatches: 0,
            },
        });
        await ctx.db.patch(f.missionId, { status: "blocked", blockCode: code });
    });
    await f.t.mutation(internal.execution.handoffs.finishChild, {
        missionId: f.missionId,
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "running",
        executionGeneration: 4,
    });
    await f.t.mutation(internal.sourcesMission.finish, {
        missionId: f.missionId,
        preparationId: f.preparationId,
        expectedGeneration: 4,
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        lifecycleState: "sources_prepared",
        executionStatus: "idle",
    });
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(preparation?.sourcesMission?.result).toBeDefined();
    expect(JSON.stringify(preparation?.sourcesMission?.result)).toContain(
        "searches, retrievals or checks were used up",
    );
});

test.each([
    "resource_limit",
    "context_capacity",
])("a %s interruption returns a handled wait without completing or failing the dossier", async (code) => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
        });
        await ctx.db.patch(f.missionId, { status: "blocked", blockCode: code });
    });
    expect(
        await f.t.mutation(internal.sourcesMission.finish, {
            missionId: f.missionId,
            preparationId: f.preparationId,
            expectedGeneration: 4,
        }),
    ).toEqual({ kind: "waiting" });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        lifecycleState: "discovering_sources",
        executionStatus: "paused",
        pauseReason: "execution_interrupted",
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.result,
    ).toBeUndefined();
});

test("Resume after a technical interruption and expired deadline requests the existing time-limit decision before renewing authority", async () => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
        });
        await ctx.db.patch(f.missionId, {
            status: "blocked",
            blockCode: "invalid_output",
        });
    });
    await seedTimeLimitConversation(f);
    await f.t.mutation(internal.execution.handoffs.finishChild, {
        missionId: f.missionId,
    });
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(preparation?.deadlineAt && run);
    vi.setSystemTime(preparation.deadlineAt + 1);
    await client(f).mutation(api.execution.researchControl.resume, {
        runId: f.runId,
        expectedGeneration: run.executionGeneration,
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.preparationId))).toMatchObject({
        deadlineAt: preparation.deadlineAt,
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "paused",
        pauseReason: "sources_time_limit",
    });
    const snapshot = await client(f).query(api.workbench.snapshot, {
        runId: f.runId,
    });
    assert(snapshot.sourcesDecisionRequestId);
    await client(f).mutation(api.execution.approvals.decide, {
        requestId: snapshot.sourcesDecisionRequestId,
        choice: "once",
    });
    const continued = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(continued);
    await f.t.mutation(internal.execution.researchControl.resumeMissions, {
        runId: f.runId,
        generation: continued.executionGeneration,
        paginationOpts: { numItems: 10, cursor: null },
    });
    const renewed = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        generation: continued.executionGeneration,
        deadlineAt: renewed?.deadlineAt,
    });
    expect(renewed?.deadlineAt).toBeGreaterThan(preparation.deadlineAt);
});

test("an unclassified framed interruption stays inspectable without closing the dossier or pretending Resume can recover it", async () => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
        });
        await ctx.db.patch(f.missionId, {
            status: "blocked",
            blockCode: "configuration_unavailable",
        });
    });
    expect(
        await f.t.mutation(internal.sourcesMission.finish, {
            missionId: f.missionId,
            preparationId: f.preparationId,
            expectedGeneration: 4,
        }),
    ).toEqual({ kind: "waiting" });
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(run);
    expect(run).toMatchObject({
        executionStatus: "paused",
        lifecycleState: "discovering_sources",
    });
    await expect(
        client(f).mutation(api.execution.researchControl.resume, {
            runId: f.runId,
            expectedGeneration: run.executionGeneration,
        }),
    ).rejects.toBeDefined();
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.result,
    ).toBeUndefined();
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "paused",
    });
});

test("an unknown operation outcome inside the window hands off with its uncertainty instead of entering a Resume loop", async () => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
        });
        await ctx.db.patch(f.missionId, {
            status: "blocked",
            blockCode: "operation_outcome_unknown",
        });
    });
    const receipts = await f.t.run((ctx) =>
        ctx.db.query("providerCalls").collect(),
    );
    await f.t.mutation(internal.execution.handoffs.finishChild, {
        missionId: f.missionId,
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "running",
        executionGeneration: 4,
    });
    await expect(
        f.t.mutation(internal.sourcesMission.finish, {
            missionId: f.missionId,
            preparationId: f.preparationId,
            expectedGeneration: 4,
        }),
    ).resolves.toBeNull();
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(JSON.stringify(preparation?.sourcesMission?.result)).toContain(
        "outcome of its last check is unknown",
    );
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        lifecycleState: "sources_prepared",
        executionStatus: "idle",
    });
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual(receipts);
});

test.each([
    "configuration_unavailable",
    "context_capacity",
    "resource_limit",
])("a non-recoverable %s stop offers a real analyst settlement and the workflow completes it without paid work", async (code) => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    workflowTest.register(f.t);
    await seedTimeLimitConversation(f);
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
        });
        await ctx.db.patch(f.missionId, { status: "blocked", blockCode: code });
        const workflowId = await workflow.start(
            ctx,
            internal.researchWorkflow.run,
            {
                runId: f.runId,
                executionGeneration: 4,
                controlled: true,
                reattachSources: { preparationId: f.preparationId },
            },
        );
        await ctx.db.patch(f.runId, { workflowId });
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const snapshot = await client(f).query(api.workbench.snapshot, {
        runId: f.runId,
    });
    expect(snapshot.run).toMatchObject({
        executionStatus: "paused",
        pauseReason: "execution_interrupted",
    });
    expect(snapshot).toMatchObject({
        researchResumeAvailable: false,
        sourcesPhase: "interrupted",
    });
    expect(snapshot.availableCommands).not.toContain("/resume");
    const facts = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return readWorkbenchFacts(ctx, run);
    });
    assert(facts.kind === "ready");
    expect(facts.context).toMatchObject({
        research: { actions: { resume: { applicable: false } } },
    });
    const research = facts.context.research;
    assert(
        research &&
            typeof research === "object" &&
            "summary" in research &&
            typeof research.summary === "string",
    );
    const summary = research.summary;
    expect(summary).not.toContain("Resume research to continue");
    expect(summary).toContain("Use what's prepared");
    expect(snapshot.sourcesWork?.interruptionDetail).toBe(summary);
    const requestId = snapshot.sourcesDecisionRequestId;
    assert(requestId);
    const request = await client(f).query(api.execution.approvals.get, {
        requestId,
    });
    expect(request).toMatchObject({
        action: "settle_sources_preparation",
        status: "pending",
        block: null,
    });
    await expect(
        client(f).mutation(api.execution.researchControl.resume, {
            runId: f.runId,
            expectedGeneration: snapshot.run.executionGeneration,
        }),
    ).rejects.toBeDefined();
    const receipts = await f.t.run((ctx) =>
        ctx.db.query("providerCalls").collect(),
    );
    if (code === "configuration_unavailable")
        await client(f).mutation(api.execution.approvals.usePreparedSources, {
            runId: f.runId,
            expectedGeneration: snapshot.run.executionGeneration,
        });
    else
        await client(f).mutation(api.execution.approvals.decide, {
            requestId,
            choice: "once",
        });
    const handingOff = await client(f).query(api.workbench.snapshot, {
        runId: f.runId,
    });
    expect(handingOff).toMatchObject({
        researchResumeAvailable: false,
        sourcesSettlementAvailable: false,
    });
    expect(handingOff.sourcesWork?.interruptionDetail).toContain(
        "Preparation is finishing",
    );
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        lifecycleState: "sources_prepared",
        executionStatus: "idle",
    });
    const result = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(result?.sourcesMission?.result).toBeDefined();
    expect(result?.deadlineAt).toBe(preparation?.deadlineAt);
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "blocked",
        blockCode: code,
    });
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual(receipts);
});

test.each([
    "configuration_unavailable",
    "operation_outcome_unknown",
])("an existing %s pause waiting at a workflow checkpoint can use prepared material without a pending card", async (code) => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    workflowTest.register(f.t);
    await seedTimeLimitConversation(f);
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            executionStatus: "paused",
            pauseReason: "execution_interrupted",
            executionGeneration: 5,
        });
        await ctx.db.patch(f.missionId, {
            status: "waiting",
            blockCode: undefined,
        });
        const workflowId = await workflow.start(
            ctx,
            internal.researchWorkflow.run,
            {
                runId: f.runId,
                executionGeneration: 5,
                controlled: true,
                reattachSources: { preparationId: f.preparationId },
            },
        );
        await ctx.db.patch(f.runId, { workflowId });
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission?.completionEventId);
        await ctx.db.patch(f.missionId, {
            status: "blocked",
            blockCode: code,
            completionNotified: true,
        });
        await workflow.sendEvent(ctx, {
            id: mission.completionEventId,
            value: { missionId: f.missionId },
        });
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const snapshot = await client(f).query(api.workbench.snapshot, {
        runId: f.runId,
    });
    expect(snapshot).toMatchObject({
        sourcesDecisionRequestId: null,
        sourcesSettlementAvailable: true,
        researchResumeAvailable: false,
    });
    const decision = await client(f).mutation(
        api.execution.approvals.usePreparedSources,
        { runId: f.runId, expectedGeneration: 5 },
    );
    expect(decision).toMatchObject({
        action: "settle_sources_preparation",
        status: "approved",
        decision: {
            choice: "once",
            outcome: { kind: "applied", action: "settle_sources_preparation" },
        },
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        lifecycleState: "sources_prepared",
        executionStatus: "idle",
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.result,
    ).toBeDefined();
});

test.each([
    "stale",
    "cancelled",
    "not admitted",
])("the named settlement action refuses %s authority without recording a decision", async (refusal) => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
        });
        await ctx.db.patch(f.missionId, {
            status: "blocked",
            blockCode: "configuration_unavailable",
        });
    });
    await f.t.mutation(internal.execution.handoffs.finishChild, {
        missionId: f.missionId,
    });
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(run);
    const before = await f.t.run((ctx) =>
        ctx.db.query("approvalRequests").collect(),
    );
    if (refusal === "cancelled")
        await f.t.run((ctx) =>
            ctx.db.patch(f.runId, { executionStatus: "cancelled" }),
        );
    const caller =
        refusal === "not admitted"
            ? f.t.withIdentity({ subject: "another-unadmitted-user" })
            : client(f);
    await expect(
        caller.mutation(api.execution.approvals.usePreparedSources, {
            runId: f.runId,
            expectedGeneration:
                run.executionGeneration - (refusal === "stale" ? 1 : 0),
        }),
    ).rejects.toBeDefined();
    expect(
        await f.t.run((ctx) => ctx.db.query("approvalRequests").collect()),
    ).toEqual(before);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))
            ?.settlementRequestedAt,
    ).toBeUndefined();
});

test.each([
    "context_capacity",
    "resource_limit",
])("an expired %s stop still offers settlement rather than an unusable time-window continuation", async (code) => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await seedTimeLimitConversation(f);
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
        });
        await ctx.db.patch(f.missionId, { status: "blocked", blockCode: code });
    });
    const mission = await f.t.run((ctx) => ctx.db.get(f.missionId));
    assert(mission);
    vi.setSystemTime(mission.deadlineAt + 1);
    await f.t.mutation(internal.execution.handoffs.finishChild, {
        missionId: f.missionId,
    });
    const snapshot = await client(f).query(api.workbench.snapshot, {
        runId: f.runId,
    });
    expect(snapshot.run).toMatchObject({
        executionStatus: "paused",
        pauseReason: "execution_interrupted",
    });
    expect(snapshot.researchResumeAvailable).toBe(false);
    assert(snapshot.sourcesDecisionRequestId);
    expect(
        await client(f).query(api.execution.approvals.get, {
            requestId: snapshot.sourcesDecisionRequestId,
        }),
    ).toMatchObject({ action: "settle_sources_preparation", block: null });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        blockCode: code,
        deadlineAt: mission.deadlineAt,
    });
});
