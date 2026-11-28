import { internal } from "@convex/_generated/api";
import type { StorageWrite } from "@earendil-works/pi-durable";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    claimFixturePiLease,
    dispatchFixtureOperation,
    retainFixtureOutput,
    seedPiHistory,
    seedPiMission as simulatedPiMissionFixture,
} from "@/__tests__/setup/pi-mission";

import {
    seedInspectedEvidence,
    startRetainedInspection,
} from "@/__tests__/setup/source-preparation";

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
            c.payload?.includes('"kind":"pi.compaction"'),
        ),
    ).toBe(true);
    expect(
        snapshots.commits.some((c) => c.payload?.includes("EXACT-ORIGINAL-0")),
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
    await dispatchFixtureOperation(f.t, {
        requestId: reading,
        expectedGeneration: 4,
    });
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 4,
        piLease: await claimFixturePiLease(f.t, f.missionId, 4),
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
    await retainFixtureOutput(f.t, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        responseJson: JSON.stringify(finish.response),
    });
    expect(
        await f.t.mutation(internal.execution.invocations.finish, finish),
    ).toMatchObject({ kind: "blocked", code: "pending_operations" });
    expect(
        await f.t.run((ctx) => ctx.db.get(begun.invocationId)),
    ).toMatchObject({
        receivedOutputJson: expect.stringContaining("Retained once"),
    });
    await dispatchFixtureOperation(f.t, {
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

test("Pi cannot begin an invocation without its writer lease", async () => {
    const { t, missionId } = await simulatedPiMissionFixture();
    await expect(
        t.mutation(internal.execution.invocations.begin, {
            missionId,
            expectedGeneration: 4,
            taskKey: "no-lease",
            provenance: "simulation",
        }),
    ).rejects.toThrow("pi_writer_fenced");
});

test("Pi fences an expired lease and its superseded epoch while retaining observed output", async () => {
    const { t, missionId } = await simulatedPiMissionFixture();
    const scope = { missionId, expectedGeneration: 4 };
    const first = await t.mutation(internal.execution.piStore.claim, {
        ...scope,
        writer: "first-writer",
    });
    const lease = {
        sessionId: first.sessionId,
        writer: first.writer,
        epoch: first.epoch,
    };
    const begin = internal.execution.invocations.begin;
    const beginArgs = {
        ...scope,
        taskKey: "lease-turn",
        provenance: "simulation" as const,
    };
    const begun = await t.mutation(begin, { ...beginArgs, piLease: lease });
    if (begun.kind !== "ready") throw new Error("Expected retained invocation");
    const invocation = {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
    };
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        ...scope,
        cause: "lease-guard",
        input: { kind: "consult_mission_state" },
    });
    await t.mutation(internal.execution.invocationLifecycle.retainRequest, {
        ...invocation,
        piLease: lease,
        requestJson: '{"messages":[]}',
    });

    await t.run((ctx) =>
        ctx.db.patch(first.sessionId, { leaseUntil: Date.now() }),
    );
    const expectFenced = async () => {
        await expect(
            t.mutation(begin, {
                ...beginArgs,
                taskKey: "new-turn",
                piLease: lease,
            }),
        ).rejects.toThrow("pi_writer_fenced");
        await expect(
            t.mutation(internal.execution.invocationLifecycle.retainRequest, {
                ...invocation,
                piLease: lease,
                requestJson: '{"messages":[]}',
            }),
        ).rejects.toThrow("pi_writer_fenced");
        await expect(
            t.query(internal.execution.invocationLifecycle.authorizeDispatch, {
                ...invocation,
                piLease: lease,
            }),
        ).rejects.toThrow("pi_writer_fenced");
        await expect(
            t.mutation(internal.execution.operations.claim, {
                requestId,
                expectedGeneration: 4,
                piLease: lease,
            }),
        ).rejects.toThrow("pi_writer_fenced");
        expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
            status: "pending",
        });
        expect(
            await t.run((ctx) =>
                ctx.db
                    .query("agentInvocations")
                    .withIndex("by_mission", (q) =>
                        q.eq("missionId", missionId),
                    )
                    .collect(),
            ),
        ).toHaveLength(1);
    };
    // The writer, epoch, mission and generation still match exactly at expiry.
    await expectFenced();
    const second = await t.mutation(internal.execution.piStore.claim, {
        ...scope,
        writer: first.writer,
    });
    expect(second).toMatchObject({
        sessionId: first.sessionId,
        generation: 4,
        epoch: first.epoch + 1,
    });
    // The renewed lease has the same writer and scope. Only the epoch differs.
    await expectFenced();

    const current = {
        sessionId: second.sessionId,
        writer: second.writer,
        epoch: second.epoch,
    };
    await expect(
        t.query(internal.execution.invocationLifecycle.authorizeDispatch, {
            ...invocation,
            piLease: current,
        }),
    ).resolves.toBeNull();
    await t.run((ctx) =>
        ctx.db.patch(second.sessionId, { leaseUntil: Date.now() }),
    );
    const responseJson = JSON.stringify({
        code: "known_result",
        kind: "blocked",
    });
    await expect(
        t.mutation(internal.execution.invocations.retainOutput, {
            ...invocation,
            piLease: current,
            responseJson,
        }),
    ).rejects.toThrow("pi_writer_fenced");
    await retainFixtureOutput(t, {
        ...invocation,
        responseJson,
    });
    expect(await t.run((ctx) => ctx.db.get(begun.invocationId))).toMatchObject({
        receivedOutputJson: responseJson,
    });
});

test("Pi dispatch rejects a lease with a different scope or writer", async () => {
    const { t, missionId } = await simulatedPiMissionFixture();
    const expectedGeneration = 4;
    const lease = await claimFixturePiLease(t, missionId, expectedGeneration);
    const foreign = await seedInspectedEvidence({}, t);
    const otherMissionId = await startRetainedInspection(t, {
        runId: foreign.runId,
        corpusRevisionId: foreign.corpusRevisionId,
        generationBackend: { id: "pi-durable", version: 1 },
        expectedGeneration,
        requestKey: "independent-mission",
    });
    const otherLease = await claimFixturePiLease(
        t,
        otherMissionId,
        expectedGeneration,
    );
    expect(otherLease.sessionId).not.toBe(lease.sessionId);
    expect(otherLease).toMatchObject({
        epoch: lease.epoch,
        writer: lease.writer,
    });
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId,
        expectedGeneration,
        cause: "persisted-consultation",
        input: { kind: "consult_mission_state" },
    });
    const claim = (piLease: typeof lease) =>
        t.mutation(internal.execution.operations.claim, {
            requestId,
            expectedGeneration,
            piLease,
        });
    await expect(claim(otherLease)).rejects.toThrow("pi_writer_fenced");
    await expect(claim({ ...lease, writer: "another-writer" })).rejects.toThrow(
        "pi_writer_fenced",
    );
    await t.run((ctx) =>
        ctx.db.patch(lease.sessionId, { generation: expectedGeneration - 1 }),
    );
    await expect(claim(lease)).rejects.toThrow("pi_writer_fenced");
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "pending",
    });
});

test.each([
    { live: false, deadlineInMs: 0, code: "node_action_deadline" },
    { live: true, deadlineInMs: 1_000, code: "missing_authorized_route" },
])("pre-call bundle preserves $code when the input fragment is corrupt", async ({
    live,
    deadlineInMs,
    code,
}) => {
    const { invokeControlledGeneration } = await import(
        "@convex/execution/invokeAgentModel"
    );
    const { t, missionId } = await simulatedPiMissionFixture();
    const scope = { missionId, expectedGeneration: 4 };
    const { sessionId, writer, epoch } = await t.mutation(
        internal.execution.piStore.claim,
        { ...scope, writer: "bundle-writer" },
    );
    const piLease = { sessionId, writer, epoch };
    const begun = await t.mutation(internal.execution.invocations.begin, {
        ...scope,
        piLease,
        taskKey: "bundle-input",
        provenance: "simulation",
    });
    if (begun.kind !== "ready") throw new Error("Expected retained invocation");
    const args = { invocationId: begun.invocationId, expectedGeneration: 4 };
    await t.run((ctx) =>
        ctx.db.patch(args.invocationId, {
            inputJson: "{}",
            ...(live ? { provenance: "live" as const } : {}),
        }),
    );
    expect(
        await t.query(
            internal.execution.invocationLifecycle.forExecutionBundle,
            args,
        ),
    ).toMatchObject({
        firstFragment: { kind: "error", code: "invocation_input_invalid" },
    });
    const reply = await t.action((ctx) =>
        invokeControlledGeneration(
            ctx,
            args,
            Date.now() + deadlineInMs,
            {
                id: "pi-durable",
                version: 1,
                generate: async () => {
                    throw new Error("Unexpected provider dispatch");
                },
            },
            piLease,
        ),
    );
    expect(reply.response).toEqual({ kind: "blocked", code });
    const record = await t.run((ctx) => ctx.db.get(args.invocationId));
    expect(JSON.parse(record?.receivedOutputJson ?? "{}")).toEqual(
        reply.response,
    );
    expect(record?.providerCallId).toBeUndefined();
});

test("Pi prepares the next tool round with one shared context read", async () => {
    const { getFunctionName } = await import("convex/server");
    const { runPiMission } = await import("@convex/integrations/piMission");
    const { nodeActionGenerationDeadline } = await import(
        "@convex/resourcePolicy"
    );
    const { t, missionId, captureId } = await simulatedPiMissionFixture();
    const scope = { missionId, expectedGeneration: 4 };
    await t.mutation(internal.execution.missions.resume, {
        ...scope,
        simulation: true,
    });
    const mission = await t.run((ctx) => ctx.db.get(missionId));
    if (!mission?.piWakeToken) throw new Error("Missing scheduled Pi worker");
    const writer = "turn-context-probe";
    expect(
        await t.mutation(internal.execution.piControl.prepare, {
            ...scope,
            writer,
            token: mission.piWakeToken,
        }),
    ).toBe(true);
    const readContext = getFunctionName(internal.execution.context.build);
    let contextReads = 0;
    const readsAtAdmission: number[] = [];
    await t.action((ctx) =>
        runPiMission(
            {
                ...ctx,
                runMutation: (ref, ...args) => {
                    if (
                        getFunctionName(ref) ===
                        getFunctionName(internal.execution.invocations.begin)
                    )
                        readsAtAdmission.push(contextReads);
                    return ctx.runMutation(ref, ...args);
                },
                runQuery: (ref, ...args) => {
                    if (getFunctionName(ref) === readContext) contextReads++;
                    return ctx.runQuery(ref, ...args);
                },
            },
            scope,
            writer,
            nodeActionGenerationDeadline(Date.now()),
        ),
    );
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        status: "completed",
        result: { captureIds: [captureId] },
    });
    const commits = await t.run(async (ctx) => {
        const session = await ctx.db
            .query("piSessions")
            .filter((q) => q.eq(q.field("missionId"), missionId))
            .unique();
        assert(session);
        return ctx.db
            .query("piCommits")
            .withIndex("by_session_and_sequence", (q) =>
                q.eq("sessionId", session._id),
            )
            .collect();
    });
    const writes = commits.flatMap(({ payload }) =>
        payload ? (JSON.parse(payload) as StorageWrite[]) : [],
    );
    const agentIds = new Set(
        writes.flatMap((write) =>
            write.type === "document.create" && write.record.kind === "pi.agent"
                ? [write.record.id]
                : [],
        ),
    );
    const configurations = writes.flatMap((write) =>
        write.type === "document.change" &&
        agentIds.has(write.id) &&
        write.content.kind === "base"
            ? [write.content.value.modelTools]
            : [],
    );
    expect(configurations).toEqual([expect.any(Array)]);
    expect({ contextReads, readsAtAdmission }).toEqual({
        contextReads: 5,
        readsAtAdmission: [2, 3, 4, 5],
    });
});

test("a superseded Pi writer cannot retain a refusal on the replacement epoch's invocation", async () => {
    const { invokeControlledGeneration } = await import(
        "@convex/execution/invokeAgentModel"
    );
    const { t, missionId } = await simulatedPiMissionFixture();
    const scope = { missionId, expectedGeneration: 4 };
    const original = await claimFixturePiLease(t, missionId, 4);
    const start = {
        ...scope,
        taskKey: "shared-pi-turn",
        provenance: "simulation" as const,
    };
    const begun = await t.mutation(internal.execution.invocations.begin, {
        ...start,
        piLease: original,
    });
    assert(begun.kind === "ready");
    await t.run((ctx) =>
        ctx.db.patch(original.sessionId, { leaseUntil: Date.now() }),
    );
    const current = await claimFixturePiLease(t, missionId, 4);
    expect(current.epoch).toBe(original.epoch + 1);
    expect(
        await t.mutation(internal.execution.invocations.begin, {
            ...start,
            piLease: current,
        }),
    ).toMatchObject({ kind: "ready", invocationId: begun.invocationId });
    const invocation = {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
    };
    const invoke = (piLease: typeof original, deadlineInMs: number) =>
        t.action((ctx) =>
            invokeControlledGeneration(
                ctx,
                invocation,
                Date.now() + deadlineInMs,
                {
                    id: "pi-durable",
                    version: 1,
                    async generate(_input, lifecycle) {
                        await lifecycle.beforeDispatch('{"messages":[]}', {
                            effectiveMaxOutputTokens: 32,
                        });
                        return {
                            status: "blocked",
                            reason: "generation_backend_unknown",
                        };
                    },
                },
                piLease,
            ),
        );
    await expect(invoke(original, 10_000)).rejects.toThrow("pi_writer_fenced");
    await expect(invoke(original, 0)).rejects.toThrow("pi_writer_fenced");
    await expect(
        t.mutation(internal.execution.invocations.retainOutput, {
            ...invocation,
            piLease: current,
            responseJson: '{"kind":"blocked","code":"pi_writer_fenced"}',
        }),
    ).rejects.toThrow("pi_writer_fenced");
    const retained = () => t.run((ctx) => ctx.db.get(begun.invocationId));
    expect((await retained())?.receivedOutputJson).toBeUndefined();
    await expect(invoke(current, 10_000)).resolves.toMatchObject({
        response: { kind: "blocked", code: "generation_backend_unknown" },
    });
    expect(JSON.parse((await retained())?.receivedOutputJson ?? "{}")).toEqual({
        kind: "blocked",
        code: "generation_backend_unknown",
    });
});
