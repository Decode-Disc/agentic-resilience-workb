import { internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import {
    seedPiHistory,
    seedPiMission as simulatedPiMissionFixture,
} from "@/__tests__/setup/pi-mission";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test("Pi continues a mission when its domain requires refreshed completion context", async () => {
    const { savedMaterialInspectionDefinition } = await import(
        "@convex/domain/savedMaterialInspection"
    );
    const completion = vi
        .spyOn(savedMaterialInspectionDefinition, "complete")
        .mockImplementationOnce(async () => ({ kind: "continue" }));
    try {
        const { t, missionId, captureId } = await simulatedPiMissionFixture();
        await t.mutation(internal.execution.missions.resume, {
            missionId,
            expectedGeneration: 4,
            simulation: true,
        });
        await t.finishAllScheduledFunctions(
            () => vi.advanceTimersByTime(10),
            500,
        );
        expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
            status: "completed",
            result: { captureIds: [captureId] },
        });
        expect(completion.mock.calls.length).toBeGreaterThan(1);
    } finally {
        completion.mockRestore();
    }
}, 30000);

test("Pi owns the generation and tool loop and retains durable checkpoints through saved-material completion", async () => {
    const { t, missionId, captureId } = await simulatedPiMissionFixture();
    await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
        simulation: true,
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        status: "completed",
        result: {
            kind: "saved_material_inspection_v1",
            captureIds: [captureId],
        },
    });
    const session = await t.run((ctx) =>
        ctx.db
            .query("piSessions")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .unique(),
    );
    expect(session?.sequence).toBeGreaterThan(0);
    expect(await t.run((ctx) => ctx.db.get(missionId))).not.toHaveProperty(
        "workflowId",
    );
}, 30000);

test("eight canonical tools in one Pi response execute without a four-request ceiling", async () => {
    const { executionValidationDefinition } = await import(
        "@convex/domain/executionValidationAgent"
    );
    const script = vi
        .spyOn(executionValidationDefinition, "simulate")
        .mockImplementation((input) => {
            const snapshot = input as {
                activeWork: { checkedIndices: number[] };
            };
            return snapshot.activeWork.checkedIndices.length === 8
                ? { kind: "complete", total: 36 }
                : {
                      kind: "operations",
                      requests: Array.from({ length: 8 }, (_, index) => ({
                          callId: `value-${index}`,
                          name: "check_fixture_value",
                          inputJson: JSON.stringify({ index }),
                      })),
                  };
        });
    try {
        const { t } = await simulatedPiMissionFixture();
        const run = await t.run((ctx) => ctx.db.query("researchRuns").first());
        if (!run) throw new Error("Fixture run missing");
        const missionId = await t.mutation(internal.execution.missions.start, {
            runId: run._id,
            expectedGeneration: 4,
            definitionId: "execution_validation_v1",
            scope: {
                kind: "execution_validation_v1",
                values: [1, 2, 3, 4, 5, 6, 7, 8],
            },
            generationBackend: { id: "pi-durable", version: 1 },
            requestKey: "pi-eight",
        });
        await t.mutation(internal.execution.missions.resume, {
            missionId,
            expectedGeneration: 4,
            simulation: true,
        });
        await t.finishAllScheduledFunctions(
            () => vi.advanceTimersByTime(10),
            500,
        );
        expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
            status: "completed",
            result: { kind: "execution_validation_v1", total: 36 },
            state: { checkedIndices: [0, 1, 2, 3, 4, 5, 6, 7] },
        });
    } finally {
        script.mockRestore();
    }
}, 30000);

test("automatic Pi compaction retains exact originals and journals its own bounded model invocation", async () => {
    const { t, missionId, captureId } = await simulatedPiMissionFixture();
    await seedPiHistory(t, missionId, 4, 8, 16250);
    await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
        simulation: true,
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        status: "completed",
        result: { captureIds: [captureId] },
    });
    const snapshots = await t.run(async (ctx) => ({
        commits: await ctx.db.query("piCommits").collect(),
        invocations: await ctx.db.query("agentInvocations").collect(),
        calls: await ctx.db.query("providerCalls").collect(),
    }));
    expect(
        snapshots.commits.some((c) =>
            c.payload.includes('"kind":"pi.compaction"'),
        ),
    ).toBe(true);
    expect(
        snapshots.commits.some((c) => c.payload.includes("EXACT-ORIGINAL-0")),
    ).toBe(true);
    expect(snapshots.invocations).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                purpose: "compaction",
                provenance: "simulation",
                status: "returned",
            }),
        ]),
    );
    expect(snapshots.calls).toHaveLength(0);
}, 30000);

test("public Resume drains more than four retained operations across the generation change", async () => {
    const { api } = await import("@convex/_generated/api");
    const f = await simulatedPiMissionFixture();
    const client = f.t.withIdentity({ subject: f.userId });
    await f.t.run((ctx) =>
        ctx.db.patch(f.args.runId, { agentExecutionVersion: 3 }),
    );
    const requests = [];
    for (let i = 0; i < 6; i++)
        requests.push(
            await f.t.mutation(internal.execution.operations.enqueue, {
                missionId: f.missionId,
                expectedGeneration: 4,
                cause: `retained-${i}`,
                input: {
                    kind: "search_available_material",
                    sourceId: f.args.sourceId,
                    query: `unmatched-word-${i}`,
                },
            }),
        );
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: 4,
        simulation: true,
    });
    await client.mutation(api.execution.researchControl.pause, {
        runId: f.args.runId,
        expectedGeneration: 4,
    });
    await client.mutation(api.execution.researchControl.resume, {
        runId: f.args.runId,
        expectedGeneration: 5,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "completed",
        generation: 6,
    });
    for (const id of requests)
        expect(await f.t.run((ctx) => ctx.db.get(id))).toMatchObject({
            expectedGeneration: 6,
            status: "completed",
            outcome: { kind: "success" },
        });
}, 30000);

test("a confirmed Pi completion refused for pending work can be adopted after that work settles", async () => {
    const f = await simulatedPiMissionFixture();
    const reading = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 4,
        cause: "reading",
        input: {
            kind: "read_in_context",
            sourceId: f.args.sourceId,
            passageOrder: 0,
        },
    });
    await f.t.action(internal.execution.operations.dispatch, {
        requestId: reading,
        expectedGeneration: 4,
    });
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "pi:completion-race",
        provenance: "simulation",
    });
    if (begun.kind !== "ready") throw new Error("Expected invocation");
    const late = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 4,
        cause: "late-work",
        input: { kind: "consult_mission_state" },
    });
    const finish = {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "complete" as const,
            captureIds: [f.captureId],
            workingNotes: "Retained once",
        },
    };
    expect(
        await f.t.mutation(internal.execution.invocations.finish, finish),
    ).toMatchObject({ kind: "blocked", code: "pending_operations" });
    await f.t.action(internal.execution.operations.dispatch, {
        requestId: late,
        expectedGeneration: 4,
    });
    expect(
        await f.t.mutation(internal.execution.invocations.finish, finish),
    ).toMatchObject({ kind: "completed" });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "completed",
        workingNotes: "Retained once",
    });
});

test("retained Workflow missions keep working notes when completion waits for native work", async () => {
    vi.useFakeTimers();
    const { seedInspectedEvidence } = await import(
        "@/__tests__/setup/source-preparation"
    );
    const f = await seedInspectedEvidence();
    const missionId = await f.t.mutation(internal.execution.missions.start, {
        runId: f.args.runId,
        corpusRevisionId: f.args.corpusRevisionId,
        expectedGeneration: 4,
        definitionId: "saved_material_inspection_v1",
        requestKey: "historical-notes",
        generationBackend: { id: "convex-agent", version: 2 },
    });
    expect(await f.t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        generationBackend: { id: "convex-agent", version: 2 },
    });
    expect(await f.t.run((ctx) => ctx.db.get(missionId))).not.toHaveProperty(
        "executionRuntime",
    );
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "historical-proposal",
        provenance: "simulation",
    });
    if (begun.kind !== "ready") throw new Error("Expected invocation");
    await f.t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration: 4,
        cause: "native-pending",
        input: { kind: "consult_mission_state" },
    });
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: begun.invocationId,
            expectedGeneration: 4,
            response: {
                kind: "complete",
                captureIds: [],
                workingNotes: "Retained historical working notes",
            },
        }),
    ).toMatchObject({ kind: "blocked", code: "pending_operations" });
    expect(await f.t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        workingNotes: "Retained historical working notes",
    });
});
