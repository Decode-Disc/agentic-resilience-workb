import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { workflow } from "@convex/workflow";
import { afterEach, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

test("delayed cancellation cleanup preserves a resumed newer generation", async () => {
    vi.useFakeTimers();
    const { t, userId, args } = await seedInspectedEvidence();
    workflowTest.register(t);
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "delayed-cancel",
        expectedGeneration: 4,
    });
    await t
        .withIdentity({ subject: `${userId}|cancel-harness` })
        .mutation(api.workflowControls.cancel, { runId: args.runId });
    const generation = await t.run(async (ctx) => {
        const { claimCorpusApprovedRunExecution } = await import(
            "@convex/domain/executionClaim"
        );
        await ctx.db.patch(args.runId, {
            lifecycleState: "corpus_approved",
            executionStatus: "idle",
        });
        const run = await ctx.db.get(args.runId);
        const visitor = run?.ownerVisitorId
            ? await ctx.db.get(run.ownerVisitorId)
            : null;
        if (!run || !visitor) throw new Error("Missing owner");
        return claimCorpusApprovedRunExecution(ctx, {
            run,
            visitor,
            now: Date.now(),
        });
    });
    await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: generation,
    });
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: generation,
        cause: "new-generation",
        input: { kind: "consult_mission_state" },
    });
    await t.mutation(internal.execution.cancellation.continueRunCancellation, {
        runId: args.runId,
        cancelledAt: Date.now(),
    });
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        generation,
        status: "ready",
    });
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        expectedGeneration: generation,
        status: "pending",
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100), 200);
    expect(await t.run((ctx) => ctx.db.get(missionId))).not.toMatchObject({
        blockCode: "run_cancelled",
    });
}, 60_000);

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

test.each([
    "worker wake",
    "dispatch",
])("an old queued %s cannot invalidate a recovered generation", async (boundary) => {
    vi.useFakeTimers();
    const { t, args } = await seedInspectedEvidence();
    workflowTest.register(t);
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "stale-callback",
        expectedGeneration: 4,
    });
    await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
    });
    const oldWorker = await t.run((ctx) => ctx.db.get(missionId));
    if (!oldWorker?.piWakeToken) throw new Error("Expected old worker wake");
    await t.run((ctx) => ctx.db.patch(args.runId, { executionGeneration: 5 }));
    await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 5,
    });
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 5,
        cause: "current",
        input: { kind: "consult_mission_state" },
    });
    if (boundary === "worker wake")
        expect(
            await t.mutation(internal.execution.piControl.prepare, {
                missionId,
                expectedGeneration: 4,
                token: oldWorker.piWakeToken,
                writer: "cancelled-worker",
            }),
        ).toBe(false);
    else
        expect(
            await t.mutation(internal.execution.operations.claim, {
                requestId,
                expectedGeneration: 4,
            }),
        ).toMatchObject({
            kind: "outcome",
            outcome: { kind: "refused", code: "stale_execution" },
        });
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        generation: 5,
        status: "ready",
    });
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        expectedGeneration: 5,
        status: "pending",
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100), 200);
});

test("run cancellation fences first and drains mission work in bounded scheduled pages", async () => {
    vi.useFakeTimers();
    const { t, userId, args } = await seedInspectedEvidence();
    workflowTest.register(t);
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "run-cancellation",
        expectedGeneration: args.executionGeneration,
    });
    const requestIds: Id<"agentOperationRequests">[] = [];
    for (let index = 0; index < 5; index++) {
        requestIds.push(
            await t.mutation(internal.execution.operations.enqueue, {
                missionId,
                expectedGeneration: args.executionGeneration,
                cause: `query-${index}`,
                input: {
                    kind: "consult_mission_state",
                    ...(index > 0 ? { cursor: `${index}:0` } : {}),
                },
            }),
        );
    }
    const firstRequestId = requestIds[0];
    if (!firstRequestId) throw new Error("Missing request fixture");
    await t.mutation(internal.execution.operations.claim, {
        requestId: firstRequestId,
        expectedGeneration: args.executionGeneration,
    });
    const lateRead = await t.query(internal.execution.history.read, {
        requestId: firstRequestId,
        expectedGeneration: args.executionGeneration,
    });
    await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: args.executionGeneration,
    });
    expect(await t.run((ctx) => ctx.db.get(missionId))).toHaveProperty(
        "piWakeId",
    );
    const missionIds = await t.run(async (ctx) => {
        const base = await ctx.db.get(missionId);
        if (!base) throw new Error("Missing mission fixture");
        const additional = [];
        for (let index = 0; index < 16; index++) {
            additional.push(
                await ctx.db.insert("agentMissions", {
                    runId: base.runId,
                    corpusRevisionId: args.corpusRevisionId,
                    ownerVisitorId: base.ownerVisitorId,
                    definitionId: "saved_material_inspection_v1",
                    definitionVersion: base.definitionVersion,
                    requestKey: `run-cancellation-${String(index).padStart(2, "0")}`,
                    objectiveKey: `cancellation-test-${index}`,
                    generation: base.generation,
                    deadlineAt: base.deadlineAt,
                    modelLimits: base.modelLimits,
                    status: "ready",
                    noProgressTurns: 0,
                    progressKeys: [],
                    inspectedCaptureIds: [],
                    workingNotes: "",
                    obligations: ["inspect_saved_material"],
                    completionRefs: [],
                    nextEventSequence: 1,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                }),
            );
        }
        return [missionId, ...additional];
    });
    const owner = t.withIdentity({ subject: `${userId}|cancel-harness` });

    await expect(
        owner.mutation(api.workflowControls.cancel, { runId: args.runId }),
    ).resolves.toEqual({ cancelled: true });

    expect(await t.run((ctx) => ctx.db.get(args.runId))).toMatchObject({
        executionStatus: "cancelled",
        executionGeneration: args.executionGeneration + 1,
    });
    const immediatelyOutstanding = await Promise.all(
        requestIds.map((requestId) => t.run((ctx) => ctx.db.get(requestId))),
    );
    expect(
        immediatelyOutstanding.some((request) =>
            request ? ["pending", "running"].includes(request.status) : false,
        ),
    ).toBe(true);

    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100), 200);

    for (const id of missionIds) {
        expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
            status: "cancelled",
            blockCode: "run_cancelled",
        });
        const events = await t.run((ctx) =>
            ctx.db
                .query("agentExecutionEvents")
                .withIndex("by_mission_and_sequence", (query) =>
                    query.eq("missionId", id),
                )
                .take(32),
        );
        expect(events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: "mission_cancelled",
                    code: "run_cancelled",
                }),
            ]),
        );
    }
    for (const requestId of requestIds) {
        const request = await t.run((ctx) => ctx.db.get(requestId));
        if (requestId === firstRequestId) {
            expect(request).toMatchObject({ status: "unknown" });
            expect(request).not.toHaveProperty("outcome");
        } else
            expect(request).toMatchObject({
                status: "completed",
                outcome: { kind: "refused", code: "run_cancelled" },
            });
    }
    expect(
        await t.mutation(internal.execution.operations.recordResult, {
            requestId: firstRequestId,
            expectedGeneration: args.executionGeneration,
            ...lateRead,
        }),
    ).toMatchObject({ kind: "refused" });
    expect(await t.run((ctx) => ctx.db.get(firstRequestId))).toMatchObject({
        status: "observed",
        outcome: { kind: "success" },
    });
    const originalEvents = await t.run((ctx) =>
        ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_sequence", (query) =>
                query.eq("missionId", missionId),
            )
            .take(32),
    );
    for (const requestId of requestIds) {
        expect(originalEvents).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: "operation_refused",
                    requestId,
                    code: "run_cancelled",
                }),
            ]),
        );
    }
    expect(await t.run((ctx) => ctx.db.get(missionId))).not.toHaveProperty(
        "piWakeId",
    );
}, 60_000);

test("browser context teardown paginates runs without nesting mission pagination", async () => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3212");
    const { t, invitationId, args } = await seedInspectedEvidence();
    workflowTest.register(t);
    await t.run((ctx) => ctx.db.patch(invitationId, { slotKey: "analyst-4" }));
    const contextId = await t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        {
            slotKey: "analyst-4",
            contextKey: "mission-cancellation",
            durationMs: 60_000,
        },
    );
    await t.run((ctx) =>
        ctx.db.patch(args.runId, {
            purpose: "browser_test",
            browserTestContextId: contextId,
        }),
    );
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "context-cancellation",
        expectedGeneration: args.executionGeneration,
    });
    await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: args.executionGeneration,
    });
    expect(await t.run((ctx) => ctx.db.get(missionId))).toHaveProperty(
        "piWakeId",
    );

    await expect(
        t.mutation(internal.runWorkspace.closeBrowserTestContext, {
            slotKey: "analyst-4",
            contextKey: "mission-cancellation",
        }),
    ).resolves.toMatchObject({ done: true, cancelled: 1 });
    expect(await t.run((ctx) => ctx.db.get(args.runId))).toMatchObject({
        executionStatus: "cancelled",
        executionGeneration: args.executionGeneration + 1,
    });

    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100), 200);

    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        status: "cancelled",
        blockCode: "run_cancelled",
    });
    expect(await t.run((ctx) => ctx.db.get(missionId))).not.toHaveProperty(
        "piWakeId",
    );
}, 60_000);

test("cancelling a dossier whose workflow already ended does not fail on the finished workflow", async () => {
    vi.useFakeTimers();
    const { t, userId, args } = await seedInspectedEvidence();
    workflowTest.register(t);
    await t.run(async (ctx) => {
        const run = await ctx.db.get(args.runId);
        if (!run) throw new Error("Missing run");
        const workflowId = await workflow.start(
            ctx,
            internal.researchWorkflow.run,
            {
                runId: args.runId,
                executionGeneration: run.executionGeneration,
            },
        );
        expect(await workflow.status(ctx, workflowId)).toMatchObject({
            type: "failed",
        });
        await ctx.db.patch(args.runId, {
            workflowId,
            executionStatus: "paused",
        });
    });
    await t
        .withIdentity({ subject: `${userId}|cancel-ended` })
        .mutation(api.workflowControls.cancel, { runId: args.runId });
    expect(await t.run((ctx) => ctx.db.get(args.runId))).toMatchObject({
        executionStatus: "cancelled",
    });
});
