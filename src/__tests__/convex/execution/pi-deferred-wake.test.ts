import { api, internal } from "@convex/_generated/api";
import type { ActionCtx } from "@convex/_generated/server";
import { conversationValidationV3Definition } from "@convex/domain/conversationValidation";
import {
    contextObservationSequence,
    recordContextObservation,
} from "@convex/execution/journal";
import { schedulePiMission } from "@convex/execution/piControl";
import { runPiMission } from "@convex/integrations/piMission";
import {
    nodeActionGenerationDeadline,
    PI_IN_SLICE_WAIT_MS,
    PI_LEASE_RENEW_INTERVAL_MS,
    PI_OPERATION_WAIT_POLL_MS,
    PI_SESSION_LEASE_MS,
} from "@convex/resourcePolicy";
import { type FunctionArgs, getFunctionName } from "convex/server";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedConversation } from "@/__tests__/setup/agent-harness";
import {
    claimFixturePiLease,
    seedPiHistory,
} from "@/__tests__/setup/pi-mission";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

async function preparePiWorker() {
    vi.useFakeTimers();
    const f = await seedConversation(true);
    await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run?.browserTestContextId);
        await ctx.db.patch(run.browserTestContextId, {
            expiresAt: Date.now() + PI_SESSION_LEASE_MS * 2,
        });
    });
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        text: "Wait for the background result",
        delivery: "queue",
        requestKey: "wake",
    });
    const active = await f.t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId: f.runId,
            definitionId: "conversation_validation_v1",
            scope: { kind: "conversation_validation_v1" },
            simulation: true,
        },
    );
    assert(active);
    const { missionId } = active;
    const scope = { missionId, expectedGeneration: 1 };
    const writer = "wake-test";
    const mission = await f.t.run((ctx) => ctx.db.get(missionId));
    assert(mission?.piWakeToken);
    expect(
        await f.t.mutation(internal.execution.piControl.prepare, {
            ...scope,
            writer,
            token: mission.piWakeToken,
        }),
    ).toBe(true);
    const session = await f.t.run((ctx) =>
        ctx.db
            .query("piSessions")
            .filter((q) => q.eq(q.field("missionId"), missionId))
            .first(),
    );
    assert(session);
    const piLease = { sessionId: session._id, writer, epoch: session.epoch };
    return { ...f, scope, missionId, writer, piLease };
}

async function waitingPiOperation() {
    const f = await preparePiWorker();
    const { missionId, scope, writer, piLease } = f;
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            ...scope,
            cause: "scheduled-result",
            input: { kind: "wait_fixture_result", value: 7 },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
            piLease,
        }),
    ).toMatchObject({ kind: "waiting" });
    const complete = () =>
        f.t.mutation(internal.domain.conversationValidation.completeDeferred, {
            requestId,
            expectedGeneration: 1,
        });
    return { ...f, scope, missionId, writer, requestId, complete, piLease };
}

test.each([
    0, 1,
])("a live writer keeps the recovery wake and closes with %i adopted results", async (adoptedWakeCount) => {
    const { t, scope, missionId, writer, complete } =
        await waitingPiOperation();
    const recovering = await t.run((ctx) => ctx.db.get(missionId));
    expect(recovering?.piWakeAt).toBe(Date.now() + PI_SESSION_LEASE_MS);
    await complete();
    const ready = await t.run((ctx) => ctx.db.get(missionId));
    expect(ready).toMatchObject({
        piResultWakeVersion: 1,
        piPreparedWakeVersion: 0,
        piWakeToken: recovering?.piWakeToken,
    });
    expect(ready?.piResultWakePending).toBeUndefined();
    const delayed =
        Date.now() + PI_SESSION_LEASE_MS + PI_OPERATION_WAIT_POLL_MS;
    await t.mutation(internal.execution.piControl.closeWorker, {
        ...scope,
        writer,
        adoptedWakeCount,
        at: delayed,
    });
    const closed = await t.run((ctx) => ctx.db.get(missionId));
    expect(closed?.piWakeAt).toBe(adoptedWakeCount ? delayed : Date.now());
    expect(closed?.piResultWakePending).toBe(
        adoptedWakeCount ? undefined : true,
    );
});

test("a late observation after access revocation is retained without notifying Pi", async () => {
    const { t, missionId, invitationId, piLease, requestId, complete } =
        await waitingPiOperation();
    await t.run(async (ctx) => {
        await ctx.db.patch(piLease.sessionId, { leaseUntil: Date.now() });
        await ctx.db.patch(invitationId, { status: "revoked" });
    });
    const waiting = await t.run((ctx) => ctx.db.get(missionId));
    await complete();
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "observed",
        outcome: { kind: "success", valueJson: '{"value":14}' },
    });
    const mission = await t.run((ctx) => ctx.db.get(missionId));
    expect(mission?.piWakeToken).toBe(waiting?.piWakeToken);
    expect(mission?.piResultWakeVersion).toBeUndefined();
    expect(mission?.piResultWakePending).toBeUndefined();
});

test("an expired Pi child delivers its retained result to the waiting parent", async () => {
    const { t, scope, missionId, piLease, writer, complete, runId } =
        await waitingPiOperation();
    await complete();
    await t.run((ctx) => ctx.db.patch(runId, { executionStatus: "running" }));
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        ...scope,
        cause: "expired-child",
        input: { kind: "request_fixture_validation", values: [7] },
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
            piLease,
        }),
    ).toMatchObject({ kind: "waiting" });
    const request = await t.run((ctx) => ctx.db.get(requestId));
    const childId = request?.childMissionId;
    assert(childId);
    const child = await t.run((ctx) => ctx.db.get(childId));
    assert(child?.piWakeToken);
    await t.mutation(internal.execution.piControl.closeWorker, {
        ...scope,
        writer,
        at: Date.now() + PI_OPERATION_WAIT_POLL_MS,
        adoptedWakeCount: 1,
    });
    await t.run((ctx) =>
        ctx.db.patch(child._id, { deadlineAt: Date.now() - 1 }),
    );
    await t.action(internal.execution.piWorker.run, {
        missionId: child._id,
        expectedGeneration: child.generation,
        token: child.piWakeToken,
    });
    expect(await t.run((ctx) => ctx.db.get(child._id))).toMatchObject({
        status: "blocked",
        blockCode: "execution_deadline",
    });
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "completed",
        outcome: { kind: "unavailable", code: "child_mission_incomplete" },
    });
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        piWakeAt: Date.now(),
        piResultWakePending: true,
        piResultWakeVersion: 2,
    });
});

test("adopting an uncertain acquisition leaves a later result eligible for an immediate wake", async () => {
    vi.useFakeTimers();
    const { t, missionId, sourceId } = await seedCapturedSources();
    await t.run((ctx) => ctx.db.patch(missionId, { definitionVersion: 7 }));
    const scope = { missionId, expectedGeneration: 4 };
    const mission = await t.run(async (ctx) => {
        await schedulePiMission(ctx, missionId, 4);
        return ctx.db.get(missionId);
    });
    assert(mission?.piWakeToken);
    const writer = "sources-result-writer";
    expect(
        await t.mutation(internal.execution.piControl.prepare, {
            ...scope,
            writer,
            token: mission.piWakeToken,
        }),
    ).toBe(true);
    const session = await t.run((ctx) =>
        ctx.db
            .query("piSessions")
            .withIndex("by_mission", (q) => q.eq("missionId", missionId))
            .unique(),
    );
    assert(session);
    const piLease = { sessionId: session._id, writer, epoch: session.epoch };
    const acquire = await t.mutation(internal.execution.operations.enqueue, {
        ...scope,
        cause: "uncertain-acquisition",
        input: {
            kind: "acquire_document",
            reference: JSON.stringify({
                version: 2,
                issuer: "source",
                sourceId,
            }),
        },
    });
    const acquireDispatch = {
        requestId: acquire,
        expectedGeneration: 4,
        piLease,
    };
    expect(
        await t.action(internal.execution.operations.dispatch, acquireDispatch),
    ).toMatchObject({ kind: "waiting" });
    const failure = { requestId: acquire, expectedGeneration: 4, epoch: 1 };
    expect(
        await t.mutation(
            internal.execution.operations.beginScheduledExecution,
            failure,
        ),
    ).toBe(true);
    const uncertain = {
        kind: "unavailable",
        code: "operation_outcome_unknown",
    };
    expect(
        await t.mutation(internal.execution.operations.settleDispatchFailure, {
            ...failure,
            failure: {
                category: "uncertain_effect",
                code: "operation_outcome_unknown",
            },
        }),
    ).toEqual(uncertain);
    expect(
        await t.action(internal.execution.operations.dispatch, acquireDispatch),
    ).toEqual(uncertain);
    // Replaying an already settled dispatch does not add another notification.
    await t.mutation(internal.execution.operations.settleDispatchFailure, {
        ...failure,
        failure: {
            category: "uncertain_effect",
            code: "operation_outcome_unknown",
        },
    });
    const discovery = await t.mutation(internal.execution.operations.enqueue, {
        ...scope,
        cause: "subsequent-discovery",
        input: {
            kind: "discover_sources_for_need",
            needId: "common-context",
            query: "An alternate source",
        },
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId: discovery,
            expectedGeneration: 4,
            piLease,
        }),
    ).toMatchObject({ kind: "waiting" });
    await t.mutation(internal.execution.operations.recordResult, {
        requestId: discovery,
        expectedGeneration: 4,
        epoch: 1,
        outcome: { kind: "unavailable", code: "fixture_result" },
    });
    await t.mutation(internal.execution.piControl.closeWorker, {
        ...scope,
        writer,
        adoptedWakeCount: 1,
        at: Date.now() + PI_OPERATION_WAIT_POLL_MS,
    });
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        piWakeAt: Date.now(),
        piResultWakePending: true,
        piResultWakeVersion: 2,
    });
});

test("publication recovery preserves a result the expired writer did not adopt", async () => {
    const { t, missionId, piLease, complete } = await waitingPiOperation();
    await complete();
    await t.mutation(internal.execution.piControl.holdPublication, {
        held: true,
    });
    await t.run((ctx) =>
        ctx.db.patch(piLease.sessionId, { leaseUntil: Date.now() }),
    );
    await t.mutation(
        internal.execution.piControl.recoverPublicationWorkers,
        {},
    );
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        piResultWakePending: true,
        piResultWakeVersion: 1,
    });
});

test("the existing lease alarm recovers a background result if the live writer crashes", async () => {
    const { t, scope, missionId, complete } = await waitingPiOperation();
    await complete();
    const ready = await t.run((ctx) => ctx.db.get(missionId));
    assert(ready?.piWakeToken && ready.piWakeAt !== undefined);
    expect(ready.piWakeAt).toBe(Date.now() + PI_SESSION_LEASE_MS);
    vi.setSystemTime(new Date(ready.piWakeAt));
    const admitted = await t.mutation(internal.execution.piControl.prepare, {
        ...scope,
        writer: "recovered-worker",
        token: ready.piWakeToken,
    });
    const recovered = await t.run((ctx) => ctx.db.get(missionId));
    expect(
        admitted,
        JSON.stringify({
            code: recovered?.blockCode,
            status: recovered?.status,
            wakeAt: recovered?.piWakeAt,
            now: Date.now(),
        }),
    ).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        piActiveWriter: "recovered-worker",
        piPreparedWakeVersion: 1,
    });
});

test("the Pi worker adopts a deferred result in its current slice without scheduling a second worker", async () => {
    const { t, scope, missionId, writer, complete, requestId } =
        await waitingPiOperation();
    const admitted = await t.run((ctx) => ctx.db.get(missionId));
    assert(admitted?.piWakeId);
    let polled = false;
    await t.action((ctx) =>
        runPiMission(
            {
                ...ctx,
                runQuery: async (reference, ...args) => {
                    if (
                        !polled &&
                        getFunctionName(reference) ===
                            getFunctionName(
                                internal.execution.piControl
                                    .operationWakeStatus,
                            )
                    ) {
                        polled = true;
                        await complete();
                        expect(
                            await t.run((tx) => tx.db.get(missionId)),
                        ).toMatchObject({
                            piWakeId: admitted.piWakeId,
                            piResultWakeVersion: 1,
                        });
                    }
                    return ctx.runQuery(reference, ...args);
                },
            },
            scope,
            writer,
            nodeActionGenerationDeadline(Date.now()),
        ),
    );
    expect(polled).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        status: "completed",
        piResultWakeVersion: 1,
    });
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "completed",
        outcome: { kind: "success" },
    });
});

test("adopting one result preserves another result that completed in the same lease", async () => {
    const { t, scope, missionId, writer, complete, piLease } =
        await waitingPiOperation();
    await complete();
    const second = await t.mutation(internal.execution.operations.enqueue, {
        ...scope,
        cause: "second-background-result",
        input: { kind: "wait_fixture_result", value: 8 },
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId: second,
            expectedGeneration: 1,
            piLease,
        }),
    ).toMatchObject({ kind: "waiting" });
    await t.mutation(internal.domain.conversationValidation.completeDeferred, {
        requestId: second,
        expectedGeneration: 1,
    });
    await t.mutation(internal.execution.piControl.closeWorker, {
        ...scope,
        writer,
        adoptedWakeCount: 1,
        at: Date.now() + PI_OPERATION_WAIT_POLL_MS,
    });
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        piResultWakeVersion: 2,
        piResultWakePending: true,
        piWakeAt: Date.now(),
    });
});

test("an aborted worker retains a completed background result for replay", async () => {
    const { t, scope, missionId, writer, complete, piLease, requestId } =
        await waitingPiOperation();
    let expired = false;
    await expect(
        t.action((ctx) =>
            runPiMission(
                {
                    ...ctx,
                    runQuery: async (reference, ...args) => {
                        const status = await ctx.runQuery(reference, ...args);
                        if (
                            !expired &&
                            getFunctionName(reference) ===
                                getFunctionName(
                                    internal.execution.piControl
                                        .operationWakeStatus,
                                )
                        ) {
                            expired = true;
                            await complete();
                            await t.run((tx) =>
                                tx.db.patch(piLease.sessionId, {
                                    leaseUntil: Date.now(),
                                }),
                            );
                            await vi.advanceTimersByTimeAsync(
                                PI_LEASE_RENEW_INTERVAL_MS,
                            );
                        }
                        return status;
                    },
                },
                scope,
                writer,
                nodeActionGenerationDeadline(Date.now()),
            ),
        ),
    ).rejects.toThrow("pi_writer_fenced");
    expect(expired).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        piResultWakeVersion: 1,
        piResultWakePending: true,
    });
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "completed",
        outcome: { kind: "success" },
    });
});

test("a result ready as the durable wait starts is adopted once", async () => {
    const { t, scope, missionId, writer } = await preparePiWorker();
    let dispatches = 0;
    let adoptedWakeCount: number | undefined;
    vi.spyOn(conversationValidationV3Definition, "simulate").mockImplementation(
        () => ({
            kind: "operations",
            requests:
                dispatches < 2
                    ? [
                          {
                              callId: "fixture-background-call",
                              name: "wait_fixture_result",
                              inputJson: '{"value":7}',
                          },
                      ]
                    : [
                          {
                              callId: "fixture-completion",
                              name: "submit_completion",
                              inputJson:
                                  '{"kind":"complete","text":"The background result is seven."}',
                          },
                      ],
        }),
    );
    await t.action((ctx) =>
        runPiMission(
            {
                ...ctx,
                runQuery: async (reference, ...args) => {
                    const result = await ctx.runQuery(reference, ...args);
                    if (
                        getFunctionName(reference) ===
                            getFunctionName(
                                internal.execution.piControl
                                    .operationWakeStatus,
                            ) &&
                        dispatches === 1
                    )
                        vi.setSystemTime(Date.now() + PI_IN_SLICE_WAIT_MS);
                    return result;
                },
                runAction: async (reference, ...args) => {
                    if (
                        getFunctionName(reference) ===
                            getFunctionName(
                                internal.execution.operations.dispatch,
                            ) &&
                        ++dispatches === 2
                    ) {
                        const { requestId, expectedGeneration } =
                            args[0] as FunctionArgs<
                                typeof internal.execution.operations.dispatch
                            >;
                        await t.mutation(
                            internal.domain.conversationValidation
                                .completeDeferred,
                            { requestId, expectedGeneration },
                        );
                    }
                    return ctx.runAction(reference, ...args);
                },
                runMutation: (reference, ...args) => {
                    if (
                        getFunctionName(reference) ===
                        getFunctionName(
                            internal.execution.piControl.closeWorker,
                        )
                    )
                        adoptedWakeCount = (
                            args[0] as FunctionArgs<
                                typeof internal.execution.piControl.closeWorker
                            >
                        ).adoptedWakeCount;
                    return ctx.runMutation(reference, ...args);
                },
            },
            scope,
            writer,
            nodeActionGenerationDeadline(Date.now()),
        ),
    );
    expect(adoptedWakeCount).toBe(1);
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        status: "completed",
        piResultWakeVersion: 1,
    });
});

async function scheduledResearchWait() {
    vi.useFakeTimers();
    const f = await seedCapturedSources();
    await seedPiHistory(f.t, f.missionId, 4, 1, 64);
    const piLease = await claimFixturePiLease(f.t, f.missionId, 4);
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "owned-wait",
            input: {
                kind: "discover_sources_for_need",
                needId: "common-context",
                query: "Current documentary work",
            },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
            piLease,
        }),
    ).toMatchObject({ kind: "waiting" });
    await f.t.mutation(internal.execution.piControl.closeWorker, {
        missionId: f.missionId,
        expectedGeneration: 4,
        writer: piLease.writer,
    });
    const before = await f.t.run(async (ctx) => {
        const session = await ctx.db
            .query("piSessions")
            .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
            .unique();
        if (!session) throw Error("missing session");
        await ctx.db.patch(session._id, {
            observationSequence: await contextObservationSequence(ctx, f.runId),
        });
        await schedulePiMission(ctx, f.missionId, 4);
        return session;
    });
    return { ...f, before, requestId };
}

test("an unchanged owned scheduled research wait defers hydration but a new observation still claims its writer", async () => {
    const { run } = await import("@convex/execution/piWorker");
    const worker = run as typeof run & {
        _handler(
            ctx: ActionCtx,
            args: FunctionArgs<typeof internal.execution.piWorker.run>,
        ): Promise<null>;
    };
    const f = await scheduledResearchWait();
    await f.t.run((ctx) =>
        ctx.db.patch(f.missionId, { provenance: "simulation" }),
    );
    const replayQueries = new Set([
        getFunctionName(internal.execution.piStore.scan),
        getFunctionName(internal.execution.piStore.readCommitFragment),
    ]);
    const runWake = async () => {
        const mission = await f.t.run((ctx) => ctx.db.get(f.missionId));
        if (!mission?.piWakeToken) throw Error("Missing scheduled wake");
        const token = mission.piWakeToken;
        let bytes = 0;
        await f.t.action((ctx) =>
            worker._handler(
                {
                    ...ctx,
                    runQuery: async (reference, ...args) => {
                        const value = await ctx.runQuery(reference, ...args);
                        if (
                            getFunctionName(reference) ===
                            getFunctionName(
                                internal.execution.piControl
                                    .operationWakeStatus,
                            )
                        )
                            vi.setSystemTime(Date.now() + PI_IN_SLICE_WAIT_MS);
                        if (replayQueries.has(getFunctionName(reference)))
                            bytes += Buffer.byteLength(JSON.stringify(value));
                        return value;
                    },
                },
                { missionId: f.missionId, expectedGeneration: 4, token },
            ),
        );
        return bytes;
    };
    expect(await runWake()).toBe(0);
    expect(await f.t.run((ctx) => ctx.db.get(f.before._id))).toMatchObject({
        epoch: f.before.epoch,
        writer: f.before.writer,
    });
    const deferred = await f.t.run((ctx) => ctx.db.get(f.missionId));
    expect((deferred?.piWakeAt ?? 0) - Date.now()).toBeGreaterThanOrEqual(
        30_000,
    );
    await f.t.run((ctx) =>
        recordContextObservation(ctx, f.runId, {
            key: "changed-replay-measurement",
            topic: "research",
            actor: { type: "system" },
            value: { changed: true },
        }),
    );
    expect(await runWake()).toBeGreaterThan(0);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.before._id)))?.epoch,
    ).toBeGreaterThan(f.before.epoch);
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});

test("a retained scheduled result resumes immediately after an unchanged fallback was deferred", async () => {
    const f = await scheduledResearchWait();
    const mission = await f.t.run((ctx) => ctx.db.get(f.missionId));
    if (!mission?.piWakeToken) throw Error("no wake");
    expect(
        await f.t.mutation(internal.execution.piControl.prepare, {
            missionId: f.missionId,
            expectedGeneration: 4,
            token: mission.piWakeToken,
            writer: "unchanged",
        }),
    ).toBe(false);
    await f.t.mutation(internal.execution.operations.recordResult, {
        requestId: f.requestId,
        expectedGeneration: 4,
        epoch: 1,
        outcome: { kind: "unavailable", code: "fixture_result" },
    });
    const ready = await f.t.run((ctx) => ctx.db.get(f.missionId));
    expect(ready?.piWakeAt).toBe(Date.now());
    if (!ready?.piWakeToken) throw Error("no immediate wake");
    expect(
        await f.t.mutation(internal.execution.piControl.prepare, {
            missionId: f.missionId,
            expectedGeneration: 4,
            token: ready.piWakeToken,
            writer: "retained-result",
        }),
    ).toBe(true);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.before._id)))?.epoch,
    ).toBeGreaterThan(f.before.epoch);
});
