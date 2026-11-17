import { api, internal } from "@convex/_generated/api";
import { executionFailureCode } from "@convex/execution/errors";
import { afterEach, assert, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import {
    client,
    seedExpiredPreparation,
    seedTimeLimitConversation,
} from "@/__tests__/setup/sources-time-limit";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

async function failLikeNovember15(
    f: Awaited<ReturnType<typeof seedExpiredPreparation>>,
) {
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    workflowTest.register(f.t);
    const workflowId = "wf-nov-15";
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, { workflowId });
        await ctx.db.patch(f.missionId, {
            status: "blocked",
            blockCode: "operation_outcome_unknown",
        });
    });
    await f.t.mutation(internal.researchWorkflow.onComplete, {
        workflowId: workflowId as never,
        result: { kind: "failed", error: "stale_execution" },
        context: { runId: f.runId },
    });
    return workflowId;
}

test("a dossier failed by the time-limit defect reopens at the decision", async () => {
    const f = await seedExpiredPreparation();
    await seedTimeLimitConversation(f);
    const oldWorkflowId = await failLikeNovember15(f);

    const reopened = await f.t.mutation(
        internal.runRecovery.reopenAtSourcesTimeLimit,
        {
            runId: f.runId,
            reason: "Failed by the Sources time-limit settlement defect of 2026-11-15",
        },
    );
    expect(reopened.reopened).toBe(true);
    expect(reopened.workflowId).toBeTruthy();
    expect(reopened.workflowId).not.toBe(oldWorkflowId);

    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    expect(run).toMatchObject({
        lifecycleState: "discovering_sources",
        executionStatus: "paused",
        pauseReason: "sources_time_limit",
        executionGeneration: 5,
        workflowId: reopened.workflowId,
    });
    const mission = await f.t.run((ctx) => ctx.db.get(f.missionId));
    expect(mission).toMatchObject({
        status: "blocked",
        blockCode: "execution_time_limit",
    });
    // The same offset as a live time-limit pause, which the settlement fence admits.
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))
            ?.executionGeneration,
    ).toBe((run?.executionGeneration ?? 0) - 1);

    const mine = await client(f).query(api.researchRuns.getMine, {
        runId: f.runId,
    });
    assert(mine?.sourcesDecisionRequestId);
    expect(mine.sourcesPhase).toBe("time_limit");
    const view = await client(f).query(api.execution.approvals.get, {
        requestId: mine.sourcesDecisionRequestId,
    });
    expect(view).toMatchObject({
        action: "continue_sources_preparation",
        alternative: "settle_sources_preparation",
        status: "pending",
        block: null,
    });
    await expect(
        f.t.mutation(internal.sourcesMission.reattach, {
            preparationId: f.preparationId,
            workflowId: oldWorkflowId,
        }),
    ).rejects.toThrow("stale_execution");
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toEqual(mission);
});

test("Continue after reopening restarts the same mission", async () => {
    const f = await seedExpiredPreparation();
    await failLikeNovember15(f);

    await f.t.mutation(internal.runRecovery.reopenAtSourcesTimeLimit, {
        runId: f.runId,
        reason: "Failed by the Sources time-limit settlement defect of 2026-11-15",
    });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);

    const mine = await client(f).query(api.researchRuns.getMine, {
        runId: f.runId,
    });
    assert(mine?.sourcesDecisionRequestId);

    await client(f).mutation(api.execution.approvals.decide, {
        requestId: mine.sourcesDecisionRequestId,
        choice: "once",
    });

    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    const generation = run?.executionGeneration ?? 0;
    expect(generation).toBe(6);
    expect(run?.executionStatus).toBe("running");
    expect(run?.pauseReason).toBeUndefined();

    await f.t.mutation(internal.execution.researchControl.resumeMissions, {
        runId: f.runId,
        generation,
        paginationOpts: { numItems: 20, cursor: null },
    });
    const mission = await f.t.run((ctx) => ctx.db.get(f.missionId));
    expect(mission).toMatchObject({
        _id: f.missionId,
        status: "ready",
        generation,
    });
    expect(mission?.deadlineAt).toBe(run?.executionHarnessDeadlineAt);
});

test.each([
    "once",
    "grant",
] as const)("reopening survives %s continuation before the workflow attaches", async (mode) => {
    const f = await seedExpiredPreparation();
    await failLikeNovember15(f);
    if (mode === "grant") {
        await f.t.run((ctx) =>
            ctx.db.insert("approvalGrants", {
                runId: f.runId,
                action: "continue_sources_preparation",
                grantedBy: { type: "visitor", visitorId: f.visitorId },
                grantedAt: Date.now(),
            }),
        );
    }
    await f.t.mutation(internal.runRecovery.reopenAtSourcesTimeLimit, {
        runId: f.runId,
        reason: "Recover the Sources time-limit failure without losing an early continuation",
    });
    if (mode === "once") {
        const mine = await client(f).query(api.researchRuns.getMine, {
            runId: f.runId,
        });
        assert(mine?.sourcesDecisionRequestId);
        await client(f).mutation(api.execution.approvals.decide, {
            requestId: mine.sourcesDecisionRequestId,
            choice: "once",
        });
    }
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        lifecycleState: "sources_prepared",
        executionStatus: "idle",
        executionGeneration: 6,
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        generation: 6,
        completionNotified: true,
    });
    const mission = await f.t.run((ctx) => ctx.db.get(f.missionId));
    expect(mission?.completionEventId).toBeTruthy();
});

test("Use what's prepared after reopening hands over with limits", async () => {
    const f = await seedExpiredPreparation();
    await failLikeNovember15(f);

    const { workflowId } = await f.t.mutation(
        internal.runRecovery.reopenAtSourcesTimeLimit,
        {
            runId: f.runId,
            reason: "Failed by the Sources time-limit settlement defect of 2026-11-15",
        },
    );
    assert(workflowId);
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);

    const reattachedMission = await f.t.run((ctx) => ctx.db.get(f.missionId));
    expect(reattachedMission?.completionEventId).toBeTruthy();
    expect(reattachedMission?.completionNotified).toBe(false);

    const mine = await client(f).query(api.researchRuns.getMine, {
        runId: f.runId,
    });
    assert(mine?.sourcesDecisionRequestId);
    await client(f).mutation(api.execution.approvals.decide, {
        requestId: mine.sourcesDecisionRequestId,
        choice: "alternative",
    });

    const finished = await f.t.mutation(internal.sourcesMission.finish, {
        preparationId: f.preparationId,
        missionId: f.missionId,
        expectedGeneration: 5,
    });
    expect(finished).toBeNull();
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    expect(run).toMatchObject({
        lifecycleState: "sources_prepared",
        executionStatus: "idle",
    });
});

test("a reopened dossier without remaining capacity goes straight to the handover", async () => {
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
    await failLikeNovember15(f);

    const reopened = await f.t.mutation(
        internal.runRecovery.reopenAtSourcesTimeLimit,
        {
            runId: f.runId,
            reason: "Failed by the Sources time-limit settlement defect of 2026-11-15",
        },
    );
    expect(reopened.reopened).toBe(true);
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);

    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    expect(run).toMatchObject({
        lifecycleState: "sources_prepared",
        executionStatus: "idle",
    });
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    const overview = await client(f).query(api.sourcesWorkspace.overview, {
        runId: f.runId,
    });
    assert(overview);
    expect(overview.needs.length).toBeGreaterThan(0);
    for (const need of overview.needs) {
        expect(need.unfinished).toEqual([
            "The Sources Agent stopped here because the dossier's searches, retrievals or checks were used up.",
        ]);
    }
    expect(preparation?.settlementRequestedAt).toBeUndefined();
    expect(preparation?.sourcesMission?.result?.outcome).toBeDefined();
});

test.each([
    [
        "not failed",
        async (f: Awaited<ReturnType<typeof seedExpiredPreparation>>) => {
            await f.t.run((ctx) =>
                ctx.db.patch(f.missionId, {
                    status: "blocked",
                    blockCode: "operation_outcome_unknown",
                }),
            );
        },
        "run_not_eligible",
    ],
    [
        "withdrawn",
        async (f: Awaited<ReturnType<typeof seedExpiredPreparation>>) => {
            await failLikeNovember15(f);
            await f.t.run((ctx) =>
                ctx.db.patch(f.runId, { withdrawnAt: Date.now() }),
            );
        },
        "run_not_eligible",
    ],
    [
        "settled preparation",
        async (f: Awaited<ReturnType<typeof seedExpiredPreparation>>) => {
            await failLikeNovember15(f);
            await f.t.run((ctx) =>
                ctx.db.patch(f.preparationId, {
                    status: "partial",
                    settlementRequestedAt: Date.now(),
                }),
            );
        },
        "preparation_not_eligible",
    ],
    [
        "mission not blocked",
        async (f: Awaited<ReturnType<typeof seedExpiredPreparation>>) => {
            await failLikeNovember15(f);
            await f.t.run((ctx) =>
                ctx.db.patch(f.missionId, {
                    status: "running",
                    blockCode: undefined,
                }),
            );
        },
        "mission_not_eligible",
    ],
])("reopening refuses a dossier that did not fail this way: %s", async (_label, prepare, expectedCode) => {
    const f = await seedExpiredPreparation();
    await prepare(f);
    const caught = await f.t
        .mutation(internal.runRecovery.reopenAtSourcesTimeLimit, {
            runId: f.runId,
            reason: "Attempt to reopen ineligible dossier for test coverage",
        })
        .catch((error: unknown) => error);
    expect(executionFailureCode(caught)).toBe(expectedCode);
});

test("reopening twice does not repeat effects", async () => {
    const f = await seedExpiredPreparation();
    await failLikeNovember15(f);

    const first = await f.t.mutation(
        internal.runRecovery.reopenAtSourcesTimeLimit,
        {
            runId: f.runId,
            reason: "Failed by the Sources time-limit settlement defect of 2026-11-15",
        },
    );
    const second = await f.t.mutation(
        internal.runRecovery.reopenAtSourcesTimeLimit,
        {
            runId: f.runId,
            reason: "Failed by the Sources time-limit settlement defect of 2026-11-15",
        },
    );
    expect(first.reopened).toBe(true);
    expect(second).toEqual({
        reopened: false,
        workflowId: first.workflowId,
    });
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    expect(run?.executionGeneration).toBe(5);
    const audits = await f.t.run((ctx) =>
        ctx.db
            .query("auditEvents")
            .withIndex("by_target", (q) =>
                q.eq("targetType", "research_run").eq("targetId", f.runId),
            )
            .collect(),
    );
    expect(
        audits.filter((a) => a.action === "run_reopened_at_time_limit"),
    ).toHaveLength(1);
});

test("reopening while another dossier runs succeeds and Continue shows the slot reason", async () => {
    const f = await seedExpiredPreparation();
    await failLikeNovember15(f);

    await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        await ctx.db.insert("researchRuns", {
            purpose: "research",
            ownerVisitorId: run.ownerVisitorId,
            companyId: run.companyId,
            coveragePreset: "balanced",
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            executionGeneration: 1,
            workflowVersion: 2,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: Date.now(),
        });
    });

    const reopened = await f.t.mutation(
        internal.runRecovery.reopenAtSourcesTimeLimit,
        {
            runId: f.runId,
            reason: "Failed by the Sources time-limit settlement defect of 2026-11-15",
        },
    );
    expect(reopened.reopened).toBe(true);

    const mine = await client(f).query(api.researchRuns.getMine, {
        runId: f.runId,
    });
    assert(mine?.sourcesDecisionRequestId);
    const view = await client(f).query(api.execution.approvals.get, {
        requestId: mine.sourcesDecisionRequestId,
    });
    expect(view).toMatchObject({
        status: "pending",
        block: "execution_slot_unavailable",
    });
});

async function seedAdmin(
    f: Awaited<ReturnType<typeof seedExpiredPreparation>>,
) {
    const userId = await f.t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "reopen-admin",
            role: "admin",
            codeDigest: "reopen-admin-digest",
            status: "claimed",
            createdAt: 1,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: userId,
            invitationId,
            role: "admin",
            status: "active",
            analysesReserved: 0,
            admittedAt: 1,
        });
        await ctx.db.patch(invitationId, { claimedByVisitorId: visitorId });
        return userId;
    });
    return f.t.withIdentity({ subject: userId });
}

test("an administrator reopens an eligible failed dossier with an audited reason", async () => {
    const f = await seedExpiredPreparation();
    await seedTimeLimitConversation(f);
    await failLikeNovember15(f);
    const admin = await seedAdmin(f);

    expect(
        (await admin.query(api.adminOperations.inspectRun, { runId: f.runId }))
            .reopenable,
    ).toBe(true);
    const result = await admin.mutation(api.admin.reopenAtSourcesTimeLimit, {
        runId: f.runId,
        reason: "Analyst asked to keep the gathered sources",
    });
    expect(result).toEqual({ reopened: true });

    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "paused",
        pauseReason: "sources_time_limit",
    });
    const audit = await f.t.run((ctx) =>
        ctx.db
            .query("auditEvents")
            .withIndex("by_target", (q) =>
                q.eq("targetType", "research_run").eq("targetId", f.runId),
            )
            .collect(),
    );
    expect(
        audit.find((event) => event.action === "run_reopened_at_time_limit"),
    ).toMatchObject({
        actor: { type: "visitor" },
        reason: "Analyst asked to keep the gathered sources",
    });
    expect(
        (await admin.query(api.adminOperations.inspectRun, { runId: f.runId }))
            .reopenable,
    ).toBe(false);
});

test("only an administrator can reopen a failed dossier", async () => {
    const f = await seedExpiredPreparation();
    await failLikeNovember15(f);
    await expect(
        client(f).mutation(api.admin.reopenAtSourcesTimeLimit, {
            runId: f.runId,
            reason: "Owner tries to reopen their own dossier",
        }),
    ).rejects.toThrow();
    expect((await f.t.run((ctx) => ctx.db.get(f.runId)))?.executionStatus).toBe(
        "failed",
    );
});
