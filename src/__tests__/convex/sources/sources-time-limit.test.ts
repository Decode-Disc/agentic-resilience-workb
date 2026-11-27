import { api, internal } from "@convex/_generated/api";
import { approvalActionCopy } from "@convex/domain/approvalCopy";
import {
    formatResearchSummary,
    readResearchState,
} from "@convex/domain/researchState";
import { sourcesSettlementNote } from "@convex/domain/sources";
import { readWorkbenchFacts } from "@convex/domain/workbenchContext";
import { executionFailureCode } from "@convex/execution/errors";
import { pinMissionModel } from "@convex/modelConfiguration";
import { afterEach, assert, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import { documentaryReply } from "@/__tests__/setup/model-stream";
import { readWorkbenchPageWithBodies } from "@/__tests__/setup/retained-messages";
import {
    dispatchSourcesOperation,
    seedCapturedSources,
} from "@/__tests__/setup/sources-mission";
import {
    client,
    reachTimeLimit,
    seedExpiredPreparation,
    seedTimeLimitConversation,
} from "@/__tests__/setup/sources-time-limit";

vi.mock("node:dns/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:dns/promises")>();
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    return { ...actual, default: { ...actual, lookup }, lookup };
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test.each([
    "deadline",
    "budget",
] as const)("system settlement preserves qualified material and consumption after the %s limit", async (limit) => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "offline-only");
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) =>
        documentaryReply(init),
    );
    const f = await seedCapturedSources();
    await installModel(f.t, { model: "z-ai/glm-5.3-flash" }, "sources");
    await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        await pinMissionModel(ctx, mission);
        await ctx.db.patch(f.preparationId, {
            executionPlanVersion: "source_actions_v4",
        });
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "qualify-before-limit",
            input: {
                kind: "submit_documentary_qualification",
                sourceId: f.sourceId,
                captureId: f.captureId,
                expectedTaskId: null,
                changes: [
                    {
                        contribution: {
                            needIds: ["common-context"],
                            statement:
                                "The source describes workflow software.",
                            period: "undated",
                            modality: "description",
                            attribution: "Publisher",
                            kind: "context",
                            evidence: [
                                {
                                    readRequestId: f.readRequestId,
                                    passageOrder: f.passage.order,
                                },
                            ],
                        },
                    },
                ],
            },
        },
    );
    expect(
        await dispatchSourcesOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "success" });
    const qualification = await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        const taskId = preparation?.sourcesMission?.qualifications[0];
        assert(taskId);
        const task = await ctx.db.get(taskId);
        assert(task?.output.kind === "documentary_qualification");
        return { taskId, output: task.output };
    });
    expect(qualification.output.contributions).toHaveLength(1);
    if (limit === "deadline") await seedExpiredPreparation(f);
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.missionId, {
            status: "blocked",
            blockCode:
                limit === "deadline"
                    ? "execution_deadline"
                    : "work_budget_exhausted",
        });
        if (limit === "budget")
            await ctx.db.patch(f.runId, {
                sourcePreparationBudget: {
                    version: 2,
                    work: 1_000_000,
                    incidents: 0,
                    reserved: 0,
                    dispatches: 1,
                },
            });
    });
    const before = await f.t.run(async (ctx) => ({
        run: await ctx.db.get(f.runId),
        preparation: await ctx.db.get(f.preparationId),
        calls: await ctx.db.query("providerCalls").collect(),
    }));
    expect(
        await f.t.mutation(internal.sourcesMission.finish, {
            preparationId: f.preparationId,
            missionId: f.missionId,
            expectedGeneration: 4,
        }),
    ).toBeNull();
    const after = await f.t.run(async (ctx) => ({
        run: await ctx.db.get(f.runId),
        preparation: await ctx.db.get(f.preparationId),
        calls: await ctx.db.query("providerCalls").collect(),
    }));
    expect(after.run).toMatchObject({
        lifecycleState: "sources_prepared",
        executionStatus: "idle",
    });
    expect(after.run?.sourcePreparationBudget).toEqual(
        before.run?.sourcePreparationBudget,
    );
    expect(after.calls).toEqual(before.calls);
    expect(after.preparation?.sourcesMission?.controls).toBe(
        before.preparation?.sourcesMission?.controls,
    );
    expect(after.preparation?.sourcesMission?.qualifications).toEqual([
        qualification.taskId,
    ]);
    const contribution = qualification.output.contributions[0];
    assert(contribution);
    expect(after.preparation?.sourcesMission?.result).toMatchObject({
        outcome: "partial",
        documents: [
            {
                sourceId: f.sourceId,
                captureId: f.captureId,
                contentHash: qualification.output.contentHash,
                qualificationTaskId: qualification.taskId,
                qualificationVersion: 1,
                contributions: [{ id: contribution.id, version: 1 }],
            },
        ],
        needs: [
            expect.objectContaining({
                needId: "common-context",
                contributions: [
                    {
                        qualificationTaskId: qualification.taskId,
                        contributionId: contribution.id,
                        version: 1,
                    },
                ],
                unfinished: expect.arrayContaining([expect.any(String)]),
            }),
        ],
    });
    const overview = await client(f).query(api.sourcesWorkspace.overview, {
        runId: f.runId,
    });
    expect(overview).toMatchObject({
        materialOutcome: "partial",
        organize: { retained: 1, contextOnly: 1 },
        needs: [
            expect.objectContaining({
                id: "common-context",
                outcome: "unfinished",
                documents: 1,
                contributions: 1,
                sourceIds: [f.sourceId],
            }),
        ],
    });
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
    const { sourcesDecisionRequestId: requestId } = await client(f).query(
        api.researchRuns.getMine,
        { runId: f.runId },
    );
    assert(requestId);
    await client(f).mutation(api.execution.approvals.decide, {
        requestId,
        choice: "once",
    });
    const now = Date.now();
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    const generation = run?.executionGeneration ?? 0;
    expect(generation).toBe(6);
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
    const { sourcesDecisionRequestId: requestId } = await client(f).query(
        api.researchRuns.getMine,
        { runId: f.runId },
    );
    assert(requestId);
    await client(f).mutation(api.execution.approvals.decide, {
        requestId,
        choice: "alternative",
    });
    await client(f).mutation(api.execution.approvals.decide, {
        requestId,
        choice: "alternative",
    });
    expect((await f.t.run((ctx) => ctx.db.get(f.missionId)))?.blockCode).toBe(
        "execution_time_limit",
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
    const { sourcesDecisionRequestId: requestId } = await client(f).query(
        api.researchRuns.getMine,
        { runId: f.runId },
    );
    assert(requestId);
    await client(f).mutation(api.execution.approvals.decide, {
        requestId,
        choice: "alternative",
    });
    const continueAfterSettle = await client(f)
        .mutation(api.execution.approvals.decide, {
            requestId,
            choice: "once",
        })
        .catch((caught: unknown) => caught);
    expect(executionFailureCode(continueAfterSettle)).toBe(
        "approval_already_decided",
    );
    const resume = await client(f)
        .mutation(api.execution.researchControl.resume, {
            runId: f.runId,
            expectedGeneration: 5,
        })
        .catch((caught: unknown) => caught);
    expect(executionFailureCode(resume)).toBe("sources_settlement_requested");

    const g = await seedExpiredPreparation();
    await reachTimeLimit(g);
    const { sourcesDecisionRequestId: gRequestId } = await client(g).query(
        api.researchRuns.getMine,
        { runId: g.runId },
    );
    assert(gRequestId);
    await client(g).mutation(api.execution.approvals.decide, {
        requestId: gRequestId,
        choice: "once",
    });
    const settleAfterContinue = await client(g)
        .mutation(api.execution.approvals.decide, {
            requestId: gRequestId,
            choice: "alternative",
        })
        .catch((caught: unknown) => caught);
    expect(executionFailureCode(settleAfterContinue)).toBe(
        "approval_already_decided",
    );
});

test("Continue is refused before any work while paid work is stopped", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);
    const { sourcesDecisionRequestId: requestId } = await client(f).query(
        api.researchRuns.getMine,
        { runId: f.runId },
    );
    assert(requestId);
    await f.t.run((ctx) =>
        ctx.db.insert("paidWorkControls", {
            key: "global",
            enabled: false,
            updatedAt: 1,
        }),
    );
    const resume = await client(f)
        .mutation(api.execution.approvals.decide, {
            requestId,
            choice: "once",
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
    });
    assert(paused.run.sourcesDecisionRequestId);
    expect(paused.snapshot.sourcesDecisionRequestId).toBe(
        paused.run.sourcesDecisionRequestId,
    );
    expect(paused.snapshot.sourcesPhase).toBe("time_limit");
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(run);
    expect(
        formatResearchSummary(
            await f.t.run((ctx) => readResearchState(ctx, run)),
        ),
    ).toContain("The Sources Agent reached its time limit.");
    await f.t.run((ctx) =>
        ctx.db.insert("paidWorkControls", {
            key: "global",
            enabled: false,
            updatedAt: 1,
        }),
    );
    const blockedView = await client(f).query(api.execution.approvals.get, {
        requestId: paused.run.sourcesDecisionRequestId,
    });
    expect(blockedView.block).toBe("paid_work_disabled");
    await client(f).mutation(api.execution.approvals.decide, {
        requestId: paused.run.sourcesDecisionRequestId,
        choice: "alternative",
    });
    await f.t.mutation(internal.sourcesMission.finish, {
        preparationId: f.preparationId,
        missionId: f.missionId,
        expectedGeneration: 5,
    });
    const settled = await read();
    expect(settled.run.sourcesPhase).toBe("ended_without_material");
    expect(settled.run.sourcesDecisionRequestId).toBeNull();
    expect(settled.snapshot.sourcesPhase).toBe("ended_without_material");
    expect(settled.snapshot.sourcesDecisionRequestId).toBeNull();
});

test("needs read on hold while the time-limit decision is pending", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);
    const overview = await client(f).query(api.sourcesWorkspace.overview, {
        runId: f.runId,
    });
    assert(overview);
    expect(overview.needs.length).toBeGreaterThan(0);
    for (const need of overview.needs) {
        expect(need.outcome).toBe("on_hold");
        expect(need.documents).toBeTypeOf("number");
        expect(need.contributions).toBeTypeOf("number");
    }
});

test("needs read unfinished, not on hold, once the dossier can no longer resume", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            executionStatus: "failed",
            pauseReason: undefined,
        }),
    );
    const overview = await client(f).query(api.sourcesWorkspace.overview, {
        runId: f.runId,
    });
    assert(overview);
    expect(overview.needs.length).toBeGreaterThan(0);
    for (const need of overview.needs) expect(need.outcome).toBe("unfinished");
});

test("the handover after a decision explains its cause on each unfinished need", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);
    const { sourcesDecisionRequestId: requestId } = await client(f).query(
        api.researchRuns.getMine,
        { runId: f.runId },
    );
    assert(requestId);
    await client(f).mutation(api.execution.approvals.decide, {
        requestId,
        choice: "alternative",
    });
    await f.t.mutation(internal.sourcesMission.finish, {
        preparationId: f.preparationId,
        missionId: f.missionId,
        expectedGeneration: 5,
    });
    const overview = await client(f).query(api.sourcesWorkspace.overview, {
        runId: f.runId,
    });
    assert(overview);
    for (const need of overview.needs) {
        expect(need.unfinished).toEqual([sourcesSettlementNote("decision")]);
    }
});

test("an automatic handover without remaining capacity says the allowance was used up", async () => {
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
    await f.t.mutation(internal.sourcesMission.finish, {
        preparationId: f.preparationId,
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    const overview = await client(f).query(api.sourcesWorkspace.overview, {
        runId: f.runId,
    });
    assert(overview);
    for (const need of overview.needs) {
        expect(need.unfinished).toEqual([
            sourcesSettlementNote("allowance_exhausted"),
        ]);
    }
});

test("the time limit raises one system request and posts it in the conversation", async () => {
    const f = await seedExpiredPreparation();
    await seedTimeLimitConversation(f);
    await reachTimeLimit(f);

    const requests = await f.t.run((ctx) =>
        ctx.db
            .query("approvalRequests")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", f.runId).eq("status", "pending"),
            )
            .collect(),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
        action: "continue_sources_preparation",
        alternative: "settle_sources_preparation",
        requestedBy: { type: "system" },
        status: "pending",
    });

    const getMine = await client(f).query(api.researchRuns.getMine, {
        runId: f.runId,
    });
    expect(getMine.sourcesDecisionRequestId).toBe(requests[0]?._id);

    const snapshot = await client(f).query(api.workbench.snapshot, {
        runId: f.runId,
    });
    expect(snapshot.sourcesDecisionRequestId).toBe(requests[0]?._id);

    const history = await readWorkbenchPageWithBodies(client(f), {
        runId: f.runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(history.page).toHaveLength(1);
    expect(history.page[0]).toMatchObject({
        role: "assistant",
        delivery: "notice",
        approvalRequestId: requests[0]?._id,
        text: `${approvalActionCopy.continue_sources_preparation.systemTitle}. Choose whether to continue preparation or use what's prepared.`,
    });
});

test("Always continue renews the window at the next time limit without asking", async () => {
    const f = await seedExpiredPreparation();
    await seedTimeLimitConversation(f);
    await reachTimeLimit(f);

    const { sourcesDecisionRequestId: firstRequestId } = await client(f).query(
        api.researchRuns.getMine,
        { runId: f.runId },
    );
    assert(firstRequestId);
    await client(f).mutation(api.execution.approvals.decide, {
        requestId: firstRequestId,
        choice: "always",
    });

    vi.advanceTimersByTime(16 * 60_000);
    const resumedRun = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(resumedRun);
    await f.t.run((ctx) =>
        ctx.db.patch(f.missionId, {
            generation: resumedRun.executionGeneration,
            deadlineAt: Date.now() - 1,
        }),
    );
    await reachTimeLimit(f);

    const now = Date.now();
    const runAfter = await f.t.run((ctx) => ctx.db.get(f.runId));
    expect(runAfter).toMatchObject({
        executionStatus: "running",
    });
    expect(runAfter?.pauseReason).toBeUndefined();
    const preparationAfter = await f.t.run((ctx) =>
        ctx.db.get(f.preparationId),
    );
    expect(preparationAfter?.deadlineAt).toBeGreaterThan(now);

    const requests = await f.t.run((ctx) =>
        ctx.db
            .query("approvalRequests")
            .withIndex("by_run_action_generation", (q) =>
                q
                    .eq("runId", f.runId)
                    .eq("action", "continue_sources_preparation"),
            )
            .collect(),
    );
    expect(requests).toHaveLength(2);
    const secondRequest = requests.find((r) => r._id !== firstRequestId);
    expect(secondRequest).toMatchObject({
        status: "approved",
        decision: {
            choice: "always",
            via: "grant",
        },
    });

    const history = await readWorkbenchPageWithBodies(client(f), {
        runId: f.runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    const notices = history.page.filter((m) => m.delivery === "notice");
    expect(notices).toHaveLength(2);
    expect(
        notices.find((m) => m.approvalRequestId === secondRequest?._id),
    ).toMatchObject({
        text: `${approvalActionCopy.continue_sources_preparation.systemTitle}. Applied automatically for this dossier: Continue preparation.`,
    });
});

test("Always use what's prepared hands over at the next time limit and records it in the conversation", async () => {
    const f = await seedExpiredPreparation();
    await seedTimeLimitConversation(f);
    await f.t.run((ctx) =>
        ctx.db.insert("approvalGrants", {
            runId: f.runId,
            action: "settle_sources_preparation",
            grantedBy: { type: "visitor", visitorId: f.visitorId },
            grantedAt: Date.now(),
        }),
    );
    await reachTimeLimit(f);

    const requests = await f.t.run((ctx) =>
        ctx.db
            .query("approvalRequests")
            .withIndex("by_run_and_status", (q) => q.eq("runId", f.runId))
            .collect(),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
        action: "continue_sources_preparation",
        alternative: "settle_sources_preparation",
        status: "approved",
        decision: {
            choice: "always",
            via: "grant",
            outcome: { kind: "applied", action: "settle_sources_preparation" },
        },
    });
    const requestId = requests[0]?._id;
    assert(requestId);
    const view = await client(f).query(api.execution.approvals.get, {
        requestId,
    });
    expect(view.grantActive).toBe(true);

    const history = await readWorkbenchPageWithBodies(client(f), {
        runId: f.runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(history.page).toHaveLength(1);
    expect(history.page[0]).toMatchObject({
        delivery: "notice",
        approvalRequestId: requestId,
        text: `${approvalActionCopy.continue_sources_preparation.systemTitle}. Applied automatically for this dossier: Use what's prepared.`,
    });

    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(preparation?.settlementRequestedAt).toBeTypeOf("number");
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(run);
    await f.t.mutation(internal.sourcesMission.finish, {
        preparationId: f.preparationId,
        missionId: f.missionId,
        expectedGeneration: run.executionGeneration,
    });
    const overview = await client(f).query(api.sourcesWorkspace.overview, {
        runId: f.runId,
    });
    assert(overview);
    for (const need of overview.needs) {
        expect(need.unfinished).toEqual([sourcesSettlementNote("decision")]);
    }
});

test("the two-option time-limit request cannot be denied", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);
    const { sourcesDecisionRequestId: requestId } = await client(f).query(
        api.researchRuns.getMine,
        { runId: f.runId },
    );
    assert(requestId);
    const refused = await client(f)
        .mutation(api.execution.approvals.decide, {
            requestId,
            choice: "deny",
        })
        .catch((caught: unknown) => caught);
    expect(executionFailureCode(refused)).toBe("approval_choice_unavailable");
    expect(
        (
            await client(f).query(api.researchRuns.getMine, {
                runId: f.runId,
            })
        ).sourcesDecisionRequestId,
    ).toBe(requestId);
});

test("the generic Resume refuses a dossier waiting on its time-limit decision", async () => {
    const f = await seedExpiredPreparation();
    await reachTimeLimit(f);
    const before = await f.t.run((ctx) => ctx.db.get(f.runId));
    const refused = await client(f)
        .mutation(api.execution.researchControl.resume, {
            runId: f.runId,
            expectedGeneration: 5,
        })
        .catch((caught: unknown) => caught);
    expect(executionFailureCode(refused)).toBe("sources_time_limit_decision");
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toEqual(before);
});

test("a dossier paused at the time limit without a decision request gets one", async () => {
    const f = await seedExpiredPreparation();
    await seedTimeLimitConversation(f);
    await reachTimeLimit(f);
    await f.t.run(async (ctx) => {
        for (const request of await ctx.db.query("approvalRequests").collect())
            await ctx.db.delete(request._id);
        for (const message of await ctx.db
            .query("agentMessageDeliveries")
            .collect())
            await ctx.db.delete(message._id);
    });
    expect(
        (
            await client(f).query(api.researchRuns.getMine, {
                runId: f.runId,
            })
        ).sourcesDecisionRequestId,
    ).toBeNull();

    expect(
        await f.t.mutation(
            internal.runRecovery.raiseMissingSourcesDecisions,
            {},
        ),
    ).toEqual({ raised: 1 });
    expect(
        await f.t.mutation(
            internal.runRecovery.raiseMissingSourcesDecisions,
            {},
        ),
    ).toEqual({ raised: 0 });

    const { sourcesDecisionRequestId: requestId } = await client(f).query(
        api.researchRuns.getMine,
        { runId: f.runId },
    );
    assert(requestId);
    const history = await readWorkbenchPageWithBodies(client(f), {
        runId: f.runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(history.page).toHaveLength(1);
    expect(history.page[0]).toMatchObject({
        delivery: "notice",
        approvalRequestId: requestId,
    });
});

test("a decision receipt does not appear in the visible conversation", async () => {
    const f = await seedExpiredPreparation();
    await seedTimeLimitConversation(f);
    await reachTimeLimit(f);

    const { sourcesDecisionRequestId: requestId } = await client(f).query(
        api.researchRuns.getMine,
        { runId: f.runId },
    );
    assert(requestId);
    await client(f).mutation(api.execution.approvals.decide, {
        requestId,
        choice: "once",
    });

    const history = await readWorkbenchPageWithBodies(client(f), {
        runId: f.runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(history.page).toHaveLength(1);
    expect(history.page[0]).toMatchObject({
        delivery: "notice",
        approvalRequestId: requestId,
    });

    // Confirmation messages live separately from their parent exchange across numItems: 1 pages.
    const paginated: Array<(typeof history.page)[number]> = [];
    let cursor: string | null = null;
    let isDone = false;
    while (!isDone) {
        const page: typeof history = await readWorkbenchPageWithBodies(
            client(f),
            {
                runId: f.runId,
                paginationOpts: { numItems: 1, cursor },
            },
        );
        paginated.push(...page.page);
        cursor = page.continueCursor;
        isDone = page.isDone;
    }
    expect(paginated).toHaveLength(1);
    expect(paginated[0]?._id).toBe(history.page[0]?._id);
});

test("Always continue falls back to the card while another dossier holds the slot", async () => {
    const f = await seedExpiredPreparation();
    await seedTimeLimitConversation(f);
    await f.t.run(async (ctx) => {
        await ctx.db.insert("approvalGrants", {
            runId: f.runId,
            action: "continue_sources_preparation",
            grantedBy: { type: "visitor", visitorId: f.visitorId },
            grantedAt: Date.now(),
        });
        await ctx.db.insert("researchRuns", {
            purpose: "research",
            ownerVisitorId: f.visitorId,
            executionGeneration: 1,
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            nextEventSequence: 1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
    });

    await reachTimeLimit(f);

    const { sourcesDecisionRequestId: requestId } = await client(f).query(
        api.researchRuns.getMine,
        { runId: f.runId },
    );
    assert(requestId);
    const view = await client(f).query(api.execution.approvals.get, {
        requestId,
    });
    expect(view).toMatchObject({
        id: requestId,
        status: "pending",
        block: "execution_slot_unavailable",
    });
});

test("an Always continue grant never loops when nothing is left to continue with", async () => {
    const f = await seedExpiredPreparation();
    await f.t.run(async (ctx) => {
        await ctx.db.insert("approvalGrants", {
            runId: f.runId,
            action: "continue_sources_preparation",
            grantedBy: { type: "visitor", visitorId: f.visitorId },
            grantedAt: Date.now(),
        });
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

    const requests = await f.t.run((ctx) =>
        ctx.db
            .query("approvalRequests")
            .withIndex("by_run_and_status", (q) => q.eq("runId", f.runId))
            .collect(),
    );
    expect(requests).toEqual([]);
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "running",
        executionGeneration: 4,
    });

    await f.t.mutation(internal.sourcesMission.finish, {
        preparationId: f.preparationId,
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    const overview = await client(f).query(api.sourcesWorkspace.overview, {
        runId: f.runId,
    });
    assert(overview);
    for (const need of overview.needs) {
        expect(need.unfinished).toEqual([
            sourcesSettlementNote("allowance_exhausted"),
        ]);
    }
});

test("an invalid window setting blocks Continue but not Use what's prepared", async () => {
    const f = await seedExpiredPreparation();
    await seedTimeLimitConversation(f);
    await reachTimeLimit(f);

    const { sourcesDecisionRequestId: requestId } = await client(f).query(
        api.researchRuns.getMine,
        { runId: f.runId },
    );
    assert(requestId);
    vi.stubEnv("SOURCES_PREPARATION_WINDOW_MINUTES", "abc");

    const blockedError = await client(f)
        .mutation(api.execution.approvals.decide, {
            requestId,
            choice: "once",
        })
        .catch((caught: unknown) => caught);
    expect(executionFailureCode(blockedError)).toBe(
        "sources_configuration_unavailable",
    );

    const settledView = await client(f).mutation(
        api.execution.approvals.decide,
        {
            requestId,
            choice: "alternative",
        },
    );
    expect(settledView).toMatchObject({
        id: requestId,
        status: "approved",
        decision: {
            choice: "alternative",
            outcome: {
                kind: "applied",
                action: "settle_sources_preparation",
            },
        },
    });
});

test.each([
    "invalid_output",
    "repetition_stop",
])("a technical %s interruption preserves preparation instead of completing its handoff", async (code) => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
        });
        await ctx.db.patch(f.missionId, { status: "blocked", blockCode: code });
    });
    const before = await f.t.run(async (ctx) => ({
        preparation: await ctx.db.get(f.preparationId),
        run: await ctx.db.get(f.runId),
        mission: await ctx.db.get(f.missionId),
    }));
    await f.t.mutation(internal.execution.handoffs.finishChild, {
        missionId: f.missionId,
    });
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    expect(run).toMatchObject({
        lifecycleState: "discovering_sources",
        executionStatus: "paused",
        pauseReason: "execution_interrupted",
    });
    const snapshot = await client(f).query(api.workbench.snapshot, {
        runId: f.runId,
    });
    expect(snapshot.sourcesPhase).toBe("interrupted");
    expect(snapshot.sourcesWork?.interruptionDetail).toContain(
        code === "invalid_output"
            ? "response could not be used"
            : "repeated attempts made no progress",
    );
    expect(snapshot.sourcesWork?.interruptionDetail).toContain(
        "Retained work remains available",
    );
    expect(snapshot.sourcesWork?.interruptionDetail).toContain(
        "Resume research to continue",
    );
    const facts = await f.t.run(async (ctx) => {
        const current = await ctx.db.get(f.runId);
        assert(current);
        return readWorkbenchFacts(ctx, current);
    });
    assert(facts.kind === "ready");
    expect(facts.context).toMatchObject({
        research: { summary: snapshot.sourcesWork?.interruptionDetail },
    });
    expect(run?.sourcePreparationBudget).toEqual(
        before.run?.sourcePreparationBudget,
    );
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(preparation).toMatchObject({
        status: "started",
        deadlineAt: before.preparation?.deadlineAt,
        modelLimits: before.preparation?.modelLimits,
    });
    await expect(
        f.t.mutation(internal.sourcesMission.finish, {
            preparationId: f.preparationId,
            missionId: f.missionId,
            expectedGeneration: 4,
        }),
    ).rejects.toBeDefined();
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.result,
    ).toBeUndefined();
    assert(run);
    const generation = await client(f).mutation(
        api.execution.researchControl.resume,
        { runId: f.runId, expectedGeneration: run.executionGeneration },
    );
    await f.t.mutation(internal.execution.researchControl.resumeMissions, {
        runId: f.runId,
        generation,
        paginationOpts: { numItems: 10, cursor: null },
    });
    const resumed = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(f.missionId),
        preparation: await ctx.db.get(f.preparationId),
        run: await ctx.db.get(f.runId),
    }));
    expect(resumed.mission).toMatchObject({
        generation,
        deadlineAt: before.mission?.deadlineAt,
    });
    expect(resumed.mission?.blockCode).toBeUndefined();
    expect(resumed.preparation?.deadlineAt).toBe(
        before.preparation?.deadlineAt,
    );
    expect(resumed.preparation?.sourcesMission).toEqual(
        before.preparation?.sourcesMission,
    );
    expect(resumed.run?.sourcePreparationBudget).toEqual(
        before.run?.sourcePreparationBudget,
    );
});

test("a historical unclassified failure retains its technical cause instead of expired-window copy", async () => {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await f.t.run((ctx) =>
        ctx.db.patch(f.missionId, {
            status: "blocked",
            blockCode: "configuration_unavailable",
        }),
    );
    await expect(
        f.t.mutation(internal.sourcesMission.finish, {
            preparationId: f.preparationId,
            missionId: f.missionId,
            expectedGeneration: 4,
        }),
    ).resolves.toBeNull();
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    const result = JSON.stringify(preparation?.sourcesMission?.result);
    expect(result).toContain("technical interruption");
    expect(result).not.toContain("time window ended");
});
