import { api, internal } from "@convex/_generated/api";
import {
    getAgentDefinition,
    registeredAgentDefinitions,
} from "@convex/execution/agentCatalog";
import schema from "@convex/schema";
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, assert, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { createAdmittedPreflight } from "@/__tests__/setup/research-launch";
import type { seedWorkbench } from "@/__tests__/setup/workbench";

const modules = import.meta.glob("/convex/**/*.ts");
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});
test.each([
    1, 2,
])("dispatches persisted framing operation version %i only when supported", async (version) => {
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
            messageId: await activeMessage(t, active.turnId),
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
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        operationVersion: 2,
    });
    const before = await client.query(api.framing.get, { runId });
    if (version === 1)
        await t.run((ctx) => ctx.db.patch(requestId, { operationVersion: 1 }));
    const outcome = await t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    if (version === 1) {
        expect(outcome).toEqual({ kind: "refused", code: "stale_execution" });
        expect(await client.query(api.framing.get, { runId })).toEqual(before);
        expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
            status: "completed",
            knownNotDispatched: true,
            outcome,
        });
        return;
    }
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
            messageId: await activeMessage(t, active.turnId),
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
test.each([
    1, 2,
])("a refused control leaves documentary dispatch subject to persisted operation version %i", async (version) => {
    const { t, client, runId, active } = await framedTurn(
        "recoverable-refusal",
        true,
    );
    const messageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId,
            requestKey: "documentary-message",
            text: "Please inspect the public commercial terms for switching restrictions.",
            delivery: "steer",
            turnId: active.turnId,
        },
    );
    const refusedId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "incorrect-control",
        input: { kind: "control_research", action: "resume", messageId },
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId: refusedId,
            expectedGeneration: 1,
        }),
    ).toEqual({ kind: "refused", code: "explicit_research_intent_required" });
    expect(await t.run((ctx) => ctx.db.get(refusedId))).toMatchObject({
        status: "completed",
        outcome: { kind: "refused", code: "explicit_research_intent_required" },
    });
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "documentary-request",
        input: {
            kind: "transmit_source_request",
            coverageRole: null,
            messageId,
            interpretedNeed: "Public switching restrictions.",
        },
    });
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        operationVersion: 2,
    });
    if (version === 1)
        await t.run((ctx) => ctx.db.patch(requestId, { operationVersion: 1 }));
    const outcome = await t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    if (version === 1) {
        expect(outcome).toEqual({ kind: "refused", code: "stale_execution" });
        expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
            status: "completed",
            knownNotDispatched: true,
            outcome,
        });
        expect(
            await t.run((ctx) =>
                ctx.db.query("workbenchInstructions").collect(),
            ),
        ).toEqual([]);
        return;
    }
    expect(outcome).toMatchObject({ kind: "success" });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toEqual(outcome);
    const instructions = await t.run((ctx) =>
        ctx.db
            .query("workbenchInstructions")
            .withIndex("by_request", (q) => q.eq("requestId", requestId))
            .collect(),
    );
    expect(instructions).toHaveLength(1);
    expect(instructions[0]).toMatchObject({
        messageId,
        interpretedNeed: "Public switching restrictions.",
    });
});

test("an edit between claim and framing effect returns a refusal without overwriting the analyst", async () => {
    const { t, client, runId, active } = await framedTurn(
        "framing-effect-race",
    );
    const input = {
        kind: "adjust_framing" as const,
        messageId: await activeMessage(t, active.turnId),
        expectedRevision: 1,
        content: { scope: "Superseded model scope", questions: [] },
    };
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "effect-race",
        input,
    });
    expect(
        (
            await t.mutation(internal.execution.operations.claim, {
                requestId,
                expectedGeneration: 1,
            })
        ).kind,
    ).toBe("execute");
    await client.mutation(api.framing.save, {
        runId,
        expectedRevision: 1,
        requestKey: "new-analyst-edit",
        content: { scope: "Latest analyst scope", questions: [] },
    });
    const operation =
        getAgentDefinition("workbench_v1").operations.adjust_framing;
    assert(operation);
    expect(
        await t.action((ctx) =>
            operation.execute(ctx, {
                requestId,
                missionId: active.missionId,
                runId,
                expectedGeneration: 1,
                input,
            }),
        ),
    ).toMatchObject({
        outcome: { kind: "refused", code: "stale_instructions" },
    });
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 2,
        content: { scope: "Latest analyst scope" },
    });
});
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
            messageId: await activeMessage(t, active.turnId),
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

async function activeMessage(
    t: Awaited<ReturnType<typeof seedWorkbench>>["t"],
    turnId: import("@convex/_generated/dataModel").Id<"agentConversationTurns">,
) {
    const message = await t.run((ctx) =>
        ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_turn", (q) => q.eq("turnId", turnId))
            .first(),
    );
    assert(message);
    return message._id;
}

test("the current framing operation preserves analyst authority", async () => {
    const { t, client, runId, active } = await framedTurn(
        "framing-domain-authority",
    );
    const messageId = await activeMessage(t, active.turnId);
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "framing-contract",
        input: {
            kind: "adjust_framing",
            messageId,
            expectedRevision: 1,
            content: { scope: "Model overwrite", questions: [] },
        },
    });
    await t.mutation(internal.execution.operations.claim, {
        requestId,
        expectedGeneration: 1,
    });
    await client.mutation(api.framing.save, {
        runId,
        expectedRevision: 1,
        requestKey: "analyst-edit",
        content: { scope: "Analyst scope", questions: [] },
    });
    const version = await t.run(async (ctx) => {
        const turn = await ctx.db.get(active.turnId);
        assert(turn);
        const request = await ctx.db.get(requestId);
        assert(request);
        expect(request.operationVersion).toBe(2);
        await ctx.db.patch(requestId, {
            instructionVersion: turn.instructionVersion,
            input: {
                ...request.input,
                kind: "adjust_framing",
                messageId,
                expectedRevision: 2,
                content: { scope: "Model overwrite", questions: [] },
            },
        });
        return turn.instructionVersion;
    });
    expect(version).toBeGreaterThan(0);
    await expect(
        t.mutation(internal.framing.applyFromWorkbench, {
            requestId,
            expectedGeneration: 1,
        }),
    ).rejects.toThrow("framing_analyst_conflict");
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 2,
        content: { scope: "Analyst scope" },
    });
});

test.each([
    null,
    "official_commercial_terms",
] as const)("a documentary acknowledgement loss retains one exact receipt for %s", async (coverageRole) => {
    const { t, client, runId, active } = await framedTurn(
        "documentary-lost-ack",
        true,
    );
    const messageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId,
            turnId: active.turnId,
            delivery: "steer",
            requestKey: "documentary",
            text: "Inspect the public terms for switching restrictions.",
        },
    );
    const operation =
        getAgentDefinition("workbench_v1").operations.transmit_source_request;
    assert(operation?.effectKind === "atomic_effect");
    const execute = operation.execute;
    vi.spyOn(operation, "execute").mockImplementation((ctx, args) =>
        execute(
            {
                ...ctx,
                runMutation: async (reference, ...input) => {
                    await ctx.runMutation(reference, ...input);
                    throw new Error("acknowledgement lost");
                },
            },
            args,
        ),
    );
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "lost-ack",
        input: {
            kind: "transmit_source_request",
            messageId,
            coverageRole,
            interpretedNeed: "Switching terms.",
        },
    });
    const result = await t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    expect(result.kind).toBe("success");
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "completed",
        effect: { outcome: result },
        outcome: result,
        adoptedAt: expect.any(Number),
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toEqual(result);
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("workbenchInstructions")
                .withIndex("by_request", (q) => q.eq("requestId", requestId))
                .collect(),
        ),
    ).toHaveLength(1);
});

test("documentary receipt recovery retains the commit and fences adoption after cancellation", async () => {
    const { t, client, runId, active } = await framedTurn(
        "documentary-cancelled",
        true,
    );
    const messageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId,
            turnId: active.turnId,
            delivery: "steer",
            requestKey: "documentary",
            text: "Inspect the public terms for switching restrictions.",
        },
    );
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "cancelled-after-commit",
        input: {
            kind: "transmit_source_request",
            messageId,
            coverageRole: null,
            interpretedNeed: "Switching terms.",
        },
    });
    await t.mutation(internal.execution.operations.claim, {
        requestId,
        expectedGeneration: 1,
    });
    const committed = await t.mutation(internal.workbench.performInstruction, {
        requestId,
        expectedGeneration: 1,
    });
    await t.run((ctx) =>
        ctx.db.patch(active.missionId, { status: "cancelled" }),
    );
    expect(
        await t.mutation(internal.execution.operations.settleDispatchFailure, {
            requestId,
            expectedGeneration: 1,
            failure: {
                category: "uncertain_effect",
                code: "operation_outcome_unknown",
            },
        }),
    ).toEqual({ kind: "refused", code: "mission_cancelled" });
    const request = await t.run((ctx) => ctx.db.get(requestId));
    expect(request).toMatchObject({
        effect: { outcome: { kind: "success", valueJson: committed } },
        outcome: { kind: "success", valueJson: committed },
    });
    expect(request?.adoptedAt).toBeUndefined();
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("workbenchInstructions")
                .withIndex("by_request", (q) => q.eq("requestId", requestId))
                .collect(),
        ),
    ).toHaveLength(1);
});

test.each(
    registeredAgentDefinitions().flatMap((definition) =>
        Object.entries(definition.operations)
            .filter(([, operation]) => operation.effectKind === "atomic_effect")
            .map(([name, operation]) => ({
                definition,
                name,
                operation,
                label: `${definition.id}@${definition.version}/${name}`,
            })),
    ),
)("$label cannot adopt a new success without its atomic receipt", async ({
    definition,
    name,
    operation,
}) => {
    const { t, client, runId, active } = await framedTurn(
        `receipt-${definition.version}-${name}`,
        name !== "adjust_framing",
    );
    await t.run((ctx) =>
        ctx.db.patch(active.missionId, {
            definitionVersion: definition.version,
        }),
    );
    const messageId = await client.mutation(
        api.execution.conversations.submit,
        {
            runId,
            turnId: active.turnId,
            delivery: "steer",
            requestKey: "authorized",
            text:
                name === "adjust_framing"
                    ? "Refine the claims question."
                    : name === "control_research"
                      ? "Resume research"
                      : "Inspect public commercial terms.",
        },
    );
    const input: import("@convex/execution/agentDefinition").OperationInput =
        name === "adjust_framing"
            ? {
                  kind: name,
                  messageId,
                  expectedRevision: 1,
                  content: { scope: "Claims", questions: [] },
              }
            : name === "control_research"
              ? { kind: name, messageId, action: "resume" }
              : {
                    kind: "transmit_source_request",
                    messageId,
                    coverageRole: null,
                    interpretedNeed: "Commercial terms.",
                };
    vi.spyOn(operation, "execute").mockResolvedValue({
        outcome: { kind: "success", value: {} },
    });
    const requestId = await t.mutation(internal.execution.operations.enqueue, {
        missionId: active.missionId,
        expectedGeneration: 1,
        cause: "missing-receipt",
        input,
    });
    expect(
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toEqual({ kind: "refused", code: "operation_effect_receipt_missing" });
    const request = await t.run((ctx) => ctx.db.get(requestId));
    expect(request).toMatchObject({
        outcome: { kind: "success", valueJson: "{}" },
        adoptionRefusalCode: "operation_effect_receipt_missing",
    });
    expect(request?.adoptedAt).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get(active.missionId))).toMatchObject({
        status: "blocked",
        blockCode: "operation_effect_receipt_missing",
        progressKeys: [],
    });
});
