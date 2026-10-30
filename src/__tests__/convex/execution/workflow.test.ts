import { internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

async function simulatedMissionFixture() {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3212");
    const fixture = await seedInspectedEvidence();
    const { t, args, invitationId } = fixture;
    workflowTest.register(t);
    await t.run((ctx) => ctx.db.patch(invitationId, { slotKey: "analyst-4" }));
    const contextId = await t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        {
            slotKey: "analyst-4",
            contextKey: "harness-workflow",
            durationMs: 2 * 60 * 60 * 1000,
        },
    );
    await t.run((ctx) =>
        ctx.db.patch(args.runId, {
            purpose: "browser_test",
            browserTestContextId: contextId,
        }),
    );
    vi.stubGlobal(
        "fetch",
        vi.fn(() => {
            throw new Error("Unexpected provider I/O");
        }),
    );
    const missionId = await t.mutation(internal.execution.missions.start, {
        generationBackend: { id: "convex-agent", version: 2 },
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "workflow",
        expectedGeneration: 4,
    });
    return { ...fixture, missionId };
}

test("the durable Workflow continues after retaining an invalid history cursor refusal", async () => {
    const { t, missionId, captureId } = await simulatedMissionFixture();
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 4,
        cause: "invalid-history-before-continuation",
        input: { kind: "consult_mission_state", cursor: "bad" },
    });
    await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
        simulation: true,
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "completed",
        outcome: { kind: "refused", code: "history_cursor_invalid" },
    });
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        status: "completed",
        result: {
            kind: "saved_material_inspection_v1",
            captureIds: [captureId],
        },
    });
}, 30_000);

test("the real Workflow recreates simulated invocations around persisted saved-material operations", async () => {
    const { t, missionId, captureId } = await simulatedMissionFixture();
    const workflowId = await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
        simulation: true,
    });
    expect(
        await t.mutation(internal.execution.missions.resume, {
            missionId,
            expectedGeneration: 4,
            simulation: true,
        }),
    ).toBe(workflowId);
    try {
        await t.finishAllScheduledFunctions(
            () => vi.advanceTimersByTime(10),
            500,
        );
    } catch (error) {
        const state = await t.run(async (ctx) => ({
            mission: await ctx.db.get(missionId),
            events: (
                await ctx.db
                    .query("agentExecutionEvents")
                    .withIndex("by_mission_and_sequence", (q) =>
                        q.eq("missionId", missionId),
                    )
                    .order("desc")
                    .take(5)
            ).map((event) => ({ kind: event.kind, code: event.code })),
            invocations: (
                await ctx.db
                    .query("agentInvocations")
                    .withIndex("by_mission", (q) =>
                        q.eq("missionId", missionId),
                    )
                    .collect()
            ).map((invocation) => ({
                status: invocation.status,
                blockCode: invocation.blockCode,
            })),
        }));
        throw new Error(
            JSON.stringify({
                status: state.mission?.status,
                blockCode: state.mission?.blockCode,
                events: state.events,
                invocations: state.invocations,
            }),
            { cause: error },
        );
    }
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        status: "completed",
        result: {
            kind: "saved_material_inspection_v1",
            captureIds: [captureId],
        },
        obligations: [],
    });
    const invocations = await t.run((ctx) =>
        ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .collect(),
    );
    expect(invocations.length).toBeGreaterThan(1);
    const snapshots = await t.run((ctx) =>
        ctx.db.query("agentInvocationPayloads").collect(),
    );
    expect(snapshots).toHaveLength(invocations.length * 2);
    expect(
        snapshots.every(
            (snapshot) =>
                snapshot.state === "complete" &&
                snapshot.json?.includes('"provenance":"simulation"'),
        ),
    ).toBe(true);
    expect(
        invocations.every(
            (invocation) =>
                invocation.provenance === "simulation" &&
                invocation.status === "returned",
        ),
    ).toBe(true);
    expect(
        invocations.some((invocation) =>
            invocation.inputJson.includes(
                "ServiceNow provides workflow software",
            ),
        ),
    ).toBe(true);
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
}, 30_000);

test.each([
    "before_dispatch",
    "after_effect_commit",
])("a confirmed recoverable interruption %s resumes without repeating completed work", async (phase) => {
    const { t, args, sourceId, captureId, missionId } =
        await simulatedMissionFixture();
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 4,
        cause: phase,
        input: { kind: "read_in_context", sourceId, passageOrder: 0 },
    });
    if (phase === "after_effect_commit")
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        });
    const expectedGeneration = phase === "after_effect_commit" ? 5 : 4;
    await t.run((ctx) =>
        ctx.db.patch(args.runId, {
            executionGeneration: expectedGeneration,
            sourcePreparationBudget: {
                version: 1,
                work: 7,
                incidents: 1,
                reserved: 2,
                dispatches: 10,
            },
        }),
    );
    await t.run((ctx) =>
        ctx.db.patch(missionId, {
            status: "blocked",
            blockCode: "execution_interrupted",
            workingNotes: "The pending question must survive recovery.",
        }),
    );
    await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration,
        simulation: true,
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        status: "completed",
        result: {
            kind: "saved_material_inspection_v1",
            captureIds: [captureId],
        },
        workingNotes: "The pending question must survive recovery.",
    });
    const requests = await t.run((ctx) =>
        ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .collect(),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ _id: requestId, status: "completed" });
    expect(await t.run((ctx) => ctx.db.get(args.runId))).toMatchObject({
        executionGeneration: expectedGeneration,
        sourcePreparationBudget: {
            work: 7,
            incidents: 1,
            reserved: 2,
            dispatches: 10,
        },
    });
}, 30_000);

test("an unconfigured live mission blocks explicitly without a fictitious provider receipt", async () => {
    const { t, missionId } = await simulatedMissionFixture();
    await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        status: "blocked",
        blockCode: "missing_authorized_route",
        provenance: "live",
    });
    const invocations = await t.run((ctx) =>
        ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .collect(),
    );
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
        status: "returned",
        blockCode: "missing_authorized_route",
    });
    const snapshots = await t.run((ctx) =>
        ctx.db.query("agentInvocationPayloads").collect(),
    );
    expect(snapshots).toHaveLength(2);
    expect(
        snapshots.every(
            (snapshot) =>
                snapshot.state === "incomplete" &&
                snapshot.code === "not_dispatched" &&
                snapshot.json === undefined,
        ),
    ).toBe(true);
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
}, 30_000);

test("simulation is rejected outside the local reserved browser workspace", async () => {
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        generationBackend: { id: "convex-agent", version: 2 },
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "reject-simulation",
        expectedGeneration: 4,
    });
    await expect(
        t.mutation(internal.execution.missions.resume, {
            missionId,
            expectedGeneration: 4,
            simulation: true,
        }),
    ).rejects.toThrow("simulation_not_authorized");
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});
