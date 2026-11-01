import { api, internal } from "@convex/_generated/api";
import schema from "@convex/schema";
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { createAdmittedPreflight } from "@/__tests__/setup/research-launch";

const modules = import.meta.glob("/convex/**/*.ts");
afterEach(() => vi.useRealTimers());
test("a committed framing effect is adopted as success", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    agentTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t),
        client = t.withIdentity({ subject: userId });
    const { runId } = await client.mutation(api.framing.confirmCompany, {
        preflightId,
        idempotencyKey: "framing-outcome",
        coveragePreset: "balanced",
    });
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    if (!active) throw new Error("Expected Workbench turn");
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "fixture",
        input: {
            kind: "adjust_framing",
            expectedRevision: 1,
            content: {
                scope: "Accepted claims",
                questions: [
                    {
                        id: "q",
                        text: "Who controls payments?",
                        shortLabel: "Payments",
                        rationale: "Economic control.",
                    },
                ],
            },
        },
    });
    const outcome = await t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    expect(outcome).toMatchObject({ kind: "success" });
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 2,
        content: { scope: "Accepted claims" },
    });
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "completed",
        outcome: { kind: "success" },
        adoptedAt: expect.any(Number),
    });
});

test("a committed research Resume is adopted as success", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    agentTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t),
        client = t.withIdentity({ subject: userId });
    const { runId } = await client.mutation(api.framing.confirmCompany, {
        preflightId,
        idempotencyKey: "resume-outcome",
        coveragePreset: "balanced",
    });
    await client.mutation(api.framing.save, {
        runId,
        expectedRevision: 1,
        requestKey: "program",
        content: {
            scope: "Claims",
            questions: [
                {
                    id: "q",
                    text: "Who controls?",
                    shortLabel: "Control",
                    rationale: "Economic control.",
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
    await t.mutation(internal.execution.researchControl.checkpoint, { runId });
    const active = await t.mutation(
        internal.execution.conversations.startTurn,
        {
            runId,
            definitionId: "workbench_v1",
            scope: { kind: "workbench_v1" },
            simulation: false,
        },
    );
    if (!active) throw new Error("Expected Workbench turn");
    const messageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId,
            requestKey: "resume",
            text: "Resume research",
            delivery: "steer",
            turnId: active.turnId,
        },
    );
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "fixture",
        input: { kind: "control_research", action: "resume", messageId },
    });
    const outcome = await t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    expect(outcome).toMatchObject({ kind: "success" });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "running",
        executionGeneration: 3,
    });
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "completed",
        outcome: { kind: "success" },
        adoptedAt: expect.any(Number),
    });
});

test("a superseded research-control request cannot resume a newer analyst pause", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    agentTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t);
    const client = t.withIdentity({ subject: userId });
    const { runId } = await client.mutation(api.framing.confirmCompany, {
        preflightId,
        idempotencyKey: "review-pin",
        coveragePreset: "balanced",
    });
    await client.mutation(api.framing.save, {
        runId,
        expectedRevision: 1,
        requestKey: "program",
        content: {
            scope: "Claims",
            questions: [
                {
                    id: "q",
                    text: "Who controls?",
                    shortLabel: "Control",
                    rationale: "Inspect control.",
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
    await t.mutation(internal.execution.researchControl.checkpoint, { runId });
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
    const messageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId,
            requestKey: "resume-message",
            text: "Resume research",
            delivery: "steer",
            turnId: active.turnId,
        },
    );
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "analyst_followup",
        input: { kind: "control_research", action: "resume", messageId },
    });
    const claimed = await t.mutation(internal.execution.operations.claim, {
        requestId,
        expectedGeneration: 1,
    });
    expect(claimed.kind).toBe("execute");
    // The dispatch action has committed admission. The analyst now resumes and later pauses again.
    await client.mutation(api.execution.researchControl.resume, {
        runId,
        expectedGeneration: 2,
    });
    await client.mutation(api.execution.researchControl.pause, {
        runId,
        expectedGeneration: 3,
    });
    await t.mutation(internal.execution.researchControl.checkpoint, { runId });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "paused",
        executionGeneration: 4,
        pauseReason: "analyst",
    });
    // Continue the actual effect mutation called by the operation after its claim.

    await expect(
        t.mutation(internal.workbench.performInstruction, {
            requestId,
            expectedGeneration: 1,
        }),
    ).rejects.toMatchObject({ data: { code: "version_conflict" } });

    const after = await t.run((ctx) => ctx.db.get(runId));

    expect(after).toMatchObject({
        executionStatus: "paused",
        executionGeneration: 4,
        pauseReason: "analyst",
    });
});

test("an applied framing receipt is adopted after dispatch is interrupted without applying twice", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    agentTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t),
        client = t.withIdentity({ subject: userId });
    const { runId } = await client.mutation(api.framing.confirmCompany, {
        preflightId,
        idempotencyKey: "effect-replay",
        coveragePreset: "balanced",
    });
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
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "fixture",
        input: {
            kind: "adjust_framing",
            expectedRevision: 1,
            content: { scope: "Claims", questions: [] },
        },
    });
    await t.mutation(internal.execution.operations.claim, {
        requestId,
        expectedGeneration: 1,
    });
    await t.mutation(internal.framing.applyFromWorkbench, {
        requestId,
        expectedGeneration: 1,
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "success" });
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 2,
    });
});

async function framedTurn(key: string, launch = false) {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    agentTest.register(t);
    workflowTest.register(t);
    const { userId, preflightId } = await createAdmittedPreflight(t),
        client = t.withIdentity({ subject: userId });
    const { runId } = await client.mutation(api.framing.confirmCompany, {
        preflightId,
        idempotencyKey: key,
        coveragePreset: "balanced",
    });
    if (launch) {
        await client.mutation(api.framing.save, {
            runId,
            expectedRevision: 1,
            requestKey: "program",
            content: {
                scope: "Claims",
                questions: [
                    {
                        id: "q",
                        text: "Who controls payments?",
                        shortLabel: "Payments",
                        rationale: "Economic control.",
                    },
                ],
            },
        });
        await client.mutation(api.framing.startResearch, {
            runId,
            expectedRevision: 2,
            requestKey: "start",
        });
    }
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
    return { t, client, runId, active };
}
test("a committed pause remains successful after its documentary checkpoint settles", async () => {
    const { t, client, runId, active } = await framedTurn(
        "pause-settlement",
        true,
    );
    const messageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId,
            requestKey: "pause",
            text: "Pause research",
            delivery: "steer",
            turnId: active.turnId,
        },
    );
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "fixture",
        input: { kind: "control_research", action: "pause", messageId },
    });
    await t.mutation(internal.execution.operations.claim, {
        requestId,
        expectedGeneration: 1,
    });
    await t.mutation(internal.workbench.performInstruction, {
        requestId,
        expectedGeneration: 1,
    });
    await t.mutation(internal.execution.researchControl.checkpoint, { runId });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "success" });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
        executionStatus: "paused",
        pauseReason: "analyst",
        executionGeneration: 2,
    });
});
test("a superseded framing receipt settles the request without applying the old edit again", async () => {
    const { t, client, runId, active } = await framedTurn("superseded-effect");
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "fixture",
        input: {
            kind: "adjust_framing",
            expectedRevision: 1,
            content: { scope: "Agent scope", questions: [] },
        },
    });
    await t.mutation(internal.execution.operations.claim, {
        requestId,
        expectedGeneration: 1,
    });
    await t.mutation(internal.framing.applyFromWorkbench, {
        requestId,
        expectedGeneration: 1,
    });
    await client.mutation(api.framing.save, {
        runId,
        expectedRevision: 2,
        requestKey: "analyst",
        content: { scope: "New analyst scope", questions: [] },
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "refused", code: "stale_instructions" });
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "completed",
        outcome: { kind: "success" },
        adoptionRefusalCode: "stale_instructions",
    });
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 3,
        content: { scope: "New analyst scope" },
    });
});
