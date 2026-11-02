import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { recordMissionEvent } from "@convex/execution/authority";
import { consultMissionState } from "@convex/execution/missionHistory";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    dispatchHistory,
    seedHistoryMission,
} from "@/__tests__/setup/execution-history";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

test("history_text_is_unchanged_when_live_request_and_invocation_change", async () => {
    const f = await seedHistoryMission();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 1,
        taskKey: "history-stability",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const finished = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
        response: {
            kind: "operations",
            requests: [
                {
                    callId: "observe",
                    name: "consult_run_state",
                    inputJson: "{}",
                },
            ],
        },
    });
    const requestId = finished.requestIds[0];
    assert(requestId);
    const request = await f.t.run((ctx) => ctx.db.get(requestId));
    assert(request?.admissionEventId);
    const event = await f.t.run((ctx) => ctx.db.get(request.admissionEventId!));
    assert(event?.sequence);
    const read = () =>
        f.t.query(internal.execution.missions.history, {
            missionId: f.missionId,
            expectedGeneration: 1,
            cursor: `${event.sequence}:0`,
        });
    const before = await read();
    await f.t.run(async (ctx) => {
        await ctx.db.patch(requestId, { status: "running" });
        await ctx.db.patch(begun.invocationId, {
            status: "blocked",
            blockCode: "later_incident",
        });
    });
    expect((await read()).entries[0]?.content).toBe(before.entries[0]?.content);
});

test("old_missing_operation_payload_is_explicit", async () => {
    const f = await seedHistoryMission();
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 1,
            cause: "original",
            input: { kind: "consult_run_state" },
        },
    );
    const event = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        const id = await recordMissionEvent(ctx, mission, {
            kind: "operation_observed",
            cause: "pre-projection-record",
            requestId,
        });
        return ctx.db.get(id);
    });
    assert(event?.sequence);
    const page = await f.t.query(internal.execution.missions.history, {
        missionId: f.missionId,
        expectedGeneration: 1,
        cursor: `${event.sequence}:0`,
    });
    expect(page.entries[0]?.content).toContain(
        "operation_observation_unavailable",
    );
    expect(page.entries[0]?.content).not.toContain('"status":"pending"');
});

test("consultation_only_activity_does_not_advance_history_source", async () => {
    const f = await seedHistoryMission();
    async function frontier() {
        const events = await f.t.run((ctx) =>
            ctx.db
                .query("agentExecutionEvents")
                .withIndex("by_mission_and_sequence", (q) =>
                    q.eq("missionId", f.missionId),
                )
                .take(128),
        );
        return Math.max(
            0,
            ...events.map((event) => {
                const value = Reflect.get(event, "historySourceSequence");
                return typeof value === "number" ? value : 0;
            }),
        );
    }
    const before = await frontier();
    expect(before).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++)
        await dispatchHistory(f, { kind: "consult_mission_state" });
    expect(await frontier()).toBe(before);
    await f.client.mutation(api.execution.conversations.submit, {
        runId: f.runId,
        turnId: f.turnId,
        requestKey: "new-steer",
        delivery: "steer",
        text: "Keep the original question and inspect payment terms.",
    });
    expect(await frontier()).toBeGreaterThan(before);
});

test.each([
    "system",
    "agent",
] as const)("an invalid %s history request retains a refusal and permits a corrected read", async (actor) => {
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "history-refusal",
        expectedGeneration: args.executionGeneration,
    });
    let requestId: Id<"agentOperationRequests"> | undefined;
    if (actor === "system") {
        requestId = await t.mutation(internal.execution.operations.enqueue, {
            missionId,
            expectedGeneration: args.executionGeneration,
            cause: "history-refusal",
            input: { kind: "consult_mission_state", cursor: "bad" },
        });
    } else {
        const invocation = await t.mutation(
            internal.execution.invocations.begin,
            {
                missionId,
                expectedGeneration: args.executionGeneration,
                taskKey: "history-refusal",
                provenance: "simulation",
            },
        );
        if (invocation.kind !== "ready") throw new Error("Expected invocation");
        const response = await t.mutation(
            internal.execution.invocations.finish,
            {
                invocationId: invocation.invocationId,
                expectedGeneration: args.executionGeneration,
                response: {
                    kind: "operations",
                    requests: [
                        {
                            callId: "history",
                            name: "consult_mission_state",
                            inputJson: '{"cursor":"bad"}',
                        },
                    ],
                },
            },
        );
        requestId = response.requestIds[0];
    }
    if (!requestId) throw new Error("Expected retained history request");
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: args.executionGeneration,
        }),
    ).toEqual({ kind: "refused", code: "history_cursor_invalid" });
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        actor,
        status: "completed",
        outcome: { kind: "refused", code: "history_cursor_invalid" },
    });
    const correctedId = await t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId,
            expectedGeneration: args.executionGeneration,
            cause: "corrected-history",
            input: { kind: "consult_mission_state", cursor: "1:0" },
        },
    );
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId: correctedId,
            expectedGeneration: args.executionGeneration,
        }),
    ).toMatchObject({ kind: "success" });
    expect(
        await t.mutation(internal.execution.invocations.begin, {
            missionId,
            expectedGeneration: args.executionGeneration,
            taskKey: "after-corrected-history",
            provenance: "simulation",
        }),
    ).toMatchObject({ kind: "ready" });
});

test("unexpected history read failures remain visible as errors", async () => {
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "history-transport",
        expectedGeneration: args.executionGeneration,
    });
    await expect(
        t.action((ctx) => {
            const runQuery: typeof ctx.runQuery = async () => {
                throw new Error("History read channel failed");
            };
            return consultMissionState(
                { ...ctx, runQuery },
                {
                    missionId,
                    expectedGeneration: args.executionGeneration,
                },
            );
        }),
    ).rejects.toThrow("History read channel failed");
});
