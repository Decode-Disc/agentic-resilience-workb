import { internal } from "@convex/_generated/api";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    beginFixtureInvocation,
    dispatchFixtureOperation,
} from "@/__tests__/setup/pi-mission";
import {
    seedWorkbench,
    workbenchAdmissionInput,
} from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

test("new Workbench conversations pin the current version and refuse superseded unversioned execution", async () => {
    const { t, runId } = await seedWorkbench(
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        null,
    );
    const conversation = await t.run((ctx) =>
        ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .unique(),
    );
    expect(conversation).toMatchObject({
        definitionId: "workbench_v1",
        definitionVersion: getAgentDefinition("workbench_v1").version,
    });
    if (!conversation) throw new Error("Missing conversation");
    await t.run((ctx) =>
        ctx.db.patch(conversation._id, {
            definitionId: undefined,
            definitionVersion: undefined,
        }),
    );
    await expect(
        t.mutation(internal.execution.conversations.startTurn, {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        }),
    ).rejects.toThrow("definition_version_conflict");
});

test("a conversation journal rejects handover until its native tail settles, then fences its former mission", async () => {
    const { t, client, runId } = await seedWorkbench();
    const start = () =>
        t.mutation(internal.execution.conversations.startTurn, {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        });
    const first = await start();
    if (!first) throw new Error("Missing turn");
    const lease = await t.mutation(internal.execution.piStore.claim, {
        missionId: first.missionId,
        expectedGeneration: 1,
        writer: "first",
    });
    await t.mutation(internal.execution.piStore.append, {
        ...lease,
        sequence: 1,
        key: "original",
        payload: "[]",
    });
    await t.run(async (ctx) => {
        await ctx.db.patch(first.missionId, { status: "completed" });
        await ctx.db.patch(first.turnId, { status: "published" });
        const conversation = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .unique();
        assert(conversation);
        await ctx.db.patch(conversation._id, { activeTurnId: undefined });
        await ctx.db.patch(lease.sessionId, { leaseUntil: 0 });
    });
    await client.mutation(
        (await import("@convex/_generated/api")).api.execution.conversations
            .submit,
        {
            runId,
            requestKey: "next",
            text: "Continue the same conversation.",
            delivery: "queue",
        },
    );
    const next = await start();
    if (!next) throw new Error("Missing next turn");
    await expect(
        t.mutation(internal.execution.piStore.claim, {
            missionId: next.missionId,
            expectedGeneration: 1,
            writer: "next",
        }),
    ).rejects.toThrow("pi_previous_unsettled");
    await t.run((ctx) => ctx.db.patch(lease.sessionId, { settledSequence: 1 }));
    const handed = await t.mutation(internal.execution.piStore.claim, {
        missionId: next.missionId,
        expectedGeneration: 1,
        writer: "next",
    });
    expect(handed.sessionId).toBe(lease.sessionId);
    await expect(
        t.mutation(internal.execution.piStore.append, {
            ...lease,
            sequence: 2,
            key: "late",
            payload: "[]",
        }),
    ).rejects.toThrow("pi_writer_fenced");
    expect(await t.run((ctx) => ctx.db.get(lease.sessionId))).toMatchObject({
        sequence: 1,
        retainedBytes: 2,
    });
});

test("successive Workbench responses reopen one native journal and retain the analyst's original user messages", async () => {
    const { t, client, runId } = await seedWorkbench(
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        null,
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const first = await t.run((ctx) =>
        ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", runId).eq("status", "completed"),
            )
            .first(),
    );
    expect(first).toMatchObject({
        definitionVersion: getAgentDefinition("workbench_v1").version,
        status: "completed",
    });
    const { api } = await import("@convex/_generated/api");
    await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "second-native",
        text: "Which participant controls the workflow?",
        delivery: "queue",
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 500);
    const sessions = await t.run((ctx) => ctx.db.query("piSessions").collect());
    expect(sessions).toHaveLength(1);
    const completed = await t.run((ctx) =>
        ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_status", (q) =>
                q.eq("runId", runId).eq("status", "completed"),
            )
            .take(10),
    );
    expect(completed).toHaveLength(2);
    const commits = await t.run((ctx) => ctx.db.query("piCommits").collect());
    expect(
        commits.some((c) =>
            c.payload?.includes("Which participant controls the workflow?"),
        ),
    ).toBe(true);
    expect(
        commits.some((c) => c.payload?.includes("workbench.analyst-input")),
    ).toBe(true);
    assert(sessions[0]);
    expect(sessions[0].settledSequence).toBe(sessions[0].sequence);
}, 30000);

test("mechanical tool arguments use the invocation snapshot and a later framing edit remains protected", async () => {
    const { t, client, runId } = await seedWorkbench(true);
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: true,
        },
    );
    if (!active) throw new Error("Missing turn");
    const nativeInput = await workbenchAdmissionInput(t, active.missionId);
    const begun = await beginFixtureInvocation(t, {
        missionId: active.missionId,
        expectedGeneration: 1,
        taskKey: "snapshot",
        nativeInput,
        provenance: "simulation",
    });
    if (begun.kind !== "ready") throw new Error("Missing invocation");
    const { api } = await import("@convex/_generated/api");
    const content = {
        scope: "Analyst scope",
        questions: [
            {
                id: "control",
                shortLabel: "Control",
                text: "Who controls the workflow?",
                rationale: "Test control.",
            },
        ],
    };
    const original = { content: { ...content, scope: "Model scope" } };
    const finished = await t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 1,
        response: {
            kind: "operations",
            requests: [
                {
                    name: "adjust_framing",
                    callId: "adjust",
                    inputJson: JSON.stringify(original),
                },
            ],
        },
    });
    const requestId = finished.requestIds[0];
    assert(requestId);
    const request = await t.run((ctx) => ctx.db.get(requestId));
    assert(request);
    expect(request?.input).toMatchObject({
        kind: "adjust_framing",
        expectedRevision: 1,
    });
    await client.mutation(api.framing.save, {
        runId,
        expectedRevision: 1,
        requestKey: "newer",
        content,
    });
    expect(
        await dispatchFixtureOperation(t, {
            requestId: request._id,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "refused", code: "stale_instructions" });
    expect(
        (await client.query(api.framing.get, { runId }))?.content.scope,
    ).toBe("Analyst scope");
});
