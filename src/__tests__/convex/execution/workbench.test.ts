import { api, internal } from "@convex/_generated/api";
import schema from "@convex/schema";
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { createAdmittedPreflight } from "@/__tests__/setup/research-launch";

const modules = import.meta.glob("/convex/**/*.ts");
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});
async function seed() {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    agentTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const client = t.withIdentity({ subject: userId });
    const { runId } = await client.mutation(api.framing.confirmCompany, {
        preflightId,
        idempotencyKey: "workbench",
        coveragePreset: "balanced",
    });
    return { t, client, runId };
}
test("Workbench admits a conversational mission in framing without claiming the research slot", async () => {
    const { t, runId } = await seed();
    const result = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    expect(result?.missionId).toBeTruthy();
    if (!result) throw new Error("Expected active Workbench turn");
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        lifecycleState: "framing",
        executionStatus: "idle",
    });
    const context = await t.query(internal.execution.context.build, {
        missionId: result.missionId,
        expectedGeneration: 1,
    });
    expect(context.kind).toBe("ready");
});

test("queued messages can be promoted or removed without duplicate deliveries", async () => {
    const { t, client, runId } = await seed();
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    const promote = await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "promote",
        text: "Focus on pricing.",
        delivery: "queue",
    });
    if (!active) throw new Error("Expected active Workbench turn");
    const remove = await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "remove",
        text: "Discard this instruction.",
        delivery: "queue",
    });
    await client.mutation(api.execution.conversations.promoteQueued, {
        runId,
        messageId: promote,
        turnId: active.turnId,
    });
    await client.mutation(api.execution.conversations.removeQueued, {
        runId,
        messageId: remove,
    });
    expect(
        await client.query(api.execution.conversations.get, { runId }),
    ).toMatchObject({ queuedCount: 0, activeTurn: { instructionVersion: 2 } });
    expect(await t.run((ctx) => ctx.db.get(promote))).toMatchObject({
        status: "active",
        turnId: active.turnId,
    });
    expect(await t.run((ctx) => ctx.db.get(remove))).toMatchObject({
        status: "removed",
    });
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("agentMessageDeliveries")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .take(10),
        ),
    ).toHaveLength(3);
});

test("stopping a Workbench response retains its queue and research execution", async () => {
    const { t, client, runId } = await seed();
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    const pending = await client.mutation(api.execution.conversations.submit, {
        runId,
        requestKey: "later",
        text: "Continue later.",
        delivery: "queue",
    });
    if (!active) throw new Error("Expected active Workbench turn");
    await client.mutation(api.execution.conversations.stopResponse, {
        runId,
        turnId: active.turnId,
    });
    expect(
        await client.query(api.execution.conversations.get, { runId }),
    ).toMatchObject({ queuedCount: 1, activeTurn: null, queuePaused: true });
    expect(await t.run((ctx) => ctx.db.get(pending))).toMatchObject({
        status: "queued",
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "idle",
        lifecycleState: "framing",
    });
    expect(await t.run((ctx) => ctx.db.get(active.missionId))).toMatchObject({
        status: "cancelled",
    });
});

test("the connected projection exposes framing and independent research state", async () => {
    const { client, runId } = await seed();
    const projection = await client.query(api.workbench.snapshot, { runId });
    expect(projection).toMatchObject({
        run: { lifecycleState: "framing", executionStatus: "idle" },
        framing: { revision: 1 },
        sources: [],
    });
});

test("a framed research pause drains admitted work before releasing the slot and resumes without another analysis", async () => {
    const { t, client, runId } = await seed();
    await client.mutation(api.framing.save, {
        runId,
        expectedRevision: 1,
        requestKey: "program",
        content: {
            scope: "Claims",
            questions: [
                {
                    id: "q",
                    text: "Who controls coordination?",
                    shortLabel: "Control",
                    rationale: "Separate control from supply.",
                },
            ],
        },
    });
    await client.mutation(api.framing.startResearch, {
        runId,
        expectedRevision: 2,
        requestKey: "start",
    });
    await client.mutation(api.execution.researchControl.pause, {
        runId,
        expectedGeneration: 1,
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "running",
        researchPauseRequested: true,
        executionGeneration: 1,
    });
    expect(
        await t.mutation(internal.execution.researchControl.checkpoint, {
            runId,
        }),
    ).toMatchObject({ waiting: true, generation: 2 });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "paused",
        pauseReason: "analyst",
    });
    await client.mutation(api.execution.researchControl.resume, {
        runId,
        expectedGeneration: 2,
    });
    expect(
        await t.mutation(internal.execution.researchControl.checkpoint, {
            runId,
        }),
    ).toMatchObject({ waiting: false, generation: 3 });
    expect(
        await t.run((ctx) => ctx.db.query("visitors").first()),
    ).toMatchObject({ analysesReserved: 1 });
});

test("Workbench retains an analyst's documentary request separately from its eventual treatment", async () => {
    const { t, client, runId } = await seed();
    const turn = await t.mutation(internal.execution.conversations.startTurn, {
        runId,
        definitionId: "workbench_v1",
        scope: { kind: "workbench_v1" },
        simulation: false,
    });
    if (!turn) throw new Error("Expected active Workbench turn");
    await client.mutation(api.framing.save, {
        runId,
        expectedRevision: 1,
        requestKey: "program",
        content: {
            scope: "Claims",
            questions: [
                {
                    id: "q",
                    text: "Who controls coordination?",
                    shortLabel: "Control",
                    rationale: "Separate control from supply.",
                },
            ],
        },
    });
    await client.mutation(api.framing.startResearch, {
        runId,
        expectedRevision: 2,
        requestKey: "start",
    });
    const messageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId,
            requestKey: "request",
            text: "Look for an independent assessment of switching constraints.",
            delivery: "steer",
            turnId: turn.turnId,
        },
    );
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: turn.missionId,
        expectedGeneration: 1,
        cause: "analyst_followup",
        input: {
            kind: "transmit_source_request",
            coverageRole: null,
            messageId,
            interpretedNeed: "Independent assessment of switching constraints",
        },
    });
    const outcome = await t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    expect(outcome.kind).toBe("success");
    const instructions = await t.run((ctx) =>
        ctx.db
            .query("workbenchInstructions")
            .withIndex("by_run_and_status", (q) => q.eq("runId", runId))
            .take(10),
    );
    expect(instructions).toHaveLength(1);
    expect(instructions[0]).toMatchObject({
        messageId,
        interpretedNeed: "Independent assessment of switching constraints",
        status: "limited",
    });
});

test("historical messages defer operation hydration to an authorized turn detail", async () => {
    const { t, client, runId } = await seed();
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    if (!active) throw new Error("Expected turn");
    await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "history-fixture",
        input: { kind: "consult_run_state" },
    });
    await client.mutation(api.execution.conversations.stopResponse, {
        runId,
        turnId: active.turnId,
    });
    const page = await client.query(api.workbench.history, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    const message = page.page.find((m) => m.work);
    expect(message?.work).toMatchObject({ deferred: true, operations: [] });
    const detail = await client.query(api.workbench.turnWork, {
        runId,
        turnId: active.turnId,
    });
    expect(detail.turn._id).toBe(active.turnId);
    await expect(
        t.query(api.workbench.turnWork, { runId, turnId: active.turnId }),
    ).rejects.toThrow();
});

test("a plain historical response does not create an activity disclosure", async () => {
    const { t, client, runId } = await seed();
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    if (!active) throw Error("Expected turn");
    await client.mutation(api.execution.conversations.stopResponse, {
        runId,
        turnId: active.turnId,
    });
    const page = await client.query(api.workbench.history, {
        runId,
        paginationOpts: { numItems: 20, cursor: null },
    });
    expect(page.page.find((m) => m.work)?.work?.deferred).toBe(false);
});
