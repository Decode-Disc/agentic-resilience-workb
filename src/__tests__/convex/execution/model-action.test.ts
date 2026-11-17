import { api, internal } from "@convex/_generated/api";
import type { ActionCtx } from "@convex/_generated/server";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { invoke as invokeModelAction } from "@convex/execution/modelActions";
import { invokeDeferredAgentTurn } from "@convex/integrations/modelTransport";
import type { WorkflowId } from "@convex-dev/workflow";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { afterEach, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { installModel } from "@/__tests__/setup/model-configuration";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

vi.mock("@convex/integrations/modelTransport", async (importOriginal) => ({
    ...(await importOriginal<
        typeof import("@convex/integrations/modelTransport")
    >()),
    invokeDeferredAgentTurn: vi.fn(),
}));
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
});

async function liveInvocationFixture(requestKey: string) {
    const fixture = await seedInspectedEvidence();
    const { t, args } = fixture;
    await installModel(
        t,
        { model: "test/inspection", provider: "test-provider" },
        "saved_material_inspection",
    );
    const missionId = await t.mutation(internal.execution.missions.start, {
        generationBackend: { id: "convex-agent", version: 2 },
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey,
        expectedGeneration: 4,
    });
    const invocation = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: 4,
        taskKey: "turn",
        provenance: "live",
    });
    if (invocation.kind !== "ready") throw new Error("Expected invocation");
    return { ...fixture, missionId, invocation };
}

test("disabled paid work blocks mission admission without a receipt, charge or transport call", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const { t, args, missionId, invocation } =
        await liveInvocationFixture("paid-work-disabled");
    const budget = (await t.run((ctx) => ctx.db.get(args.runId)))
        ?.sourcePreparationBudget;
    await t.run((ctx) =>
        ctx.db.insert("paidWorkControls", {
            key: "global",
            enabled: false,
            updatedAt: Date.now(),
        }),
    );
    const reply = await t.action(internal.execution.modelActions.invoke, {
        invocationId: invocation.invocationId,
        expectedGeneration: 4,
    });
    expect(reply.response).toEqual({
        kind: "blocked",
        code: "paid_work_disabled",
    });
    expect(await t.run((ctx) => ctx.db.query("providerCalls").take(1))).toEqual(
        [],
    );
    expect(
        (await t.run((ctx) => ctx.db.get(args.runId)))?.sourcePreparationBudget,
    ).toEqual(budget);
    const observed = await t.run((ctx) => ctx.db.get(invocation.invocationId));
    expect(JSON.parse(observed?.receivedOutputJson ?? "null")).toEqual({
        kind: "blocked",
        code: "paid_work_disabled",
    });
    expect(invokeDeferredAgentTurn).not.toHaveBeenCalled();
    const payloads = await t.run((ctx) =>
        ctx.db
            .query("agentInvocationPayloads")
            .withIndex("by_invocation_and_part", (q) =>
                q.eq("invocationId", invocation.invocationId),
            )
            .collect(),
    );
    expect(
        payloads.map(({ part, state, code, json }) => ({
            part,
            state,
            code,
            json,
        })),
    ).toEqual([
        {
            part: "reply",
            state: "incomplete",
            code: "not_dispatched",
            json: undefined,
        },
        {
            part: "request",
            state: "incomplete",
            code: "not_dispatched",
            json: undefined,
        },
    ]);
    await t.mutation(internal.execution.invocations.finish, {
        invocationId: invocation.invocationId,
        expectedGeneration: 4,
        response: reply.response,
    });
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        status: "blocked",
        blockCode: "paid_work_disabled",
    });
});

test("missing model configuration retains non-dispatch markers without a provider receipt", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const { t, invocation } = await liveInvocationFixture(
        "configuration-missing",
    );
    expect(
        await t.action(internal.execution.modelActions.invoke, {
            invocationId: invocation.invocationId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({
        response: { kind: "blocked", code: "missing_configuration" },
    });
    const payloads = await t.run((ctx) =>
        ctx.db.query("agentInvocationPayloads").collect(),
    );
    expect(payloads).toHaveLength(2);
    expect(
        payloads.every(
            (payload) =>
                payload.state === "incomplete" &&
                payload.code === "not_dispatched",
        ),
    ).toBe(true);
    expect(
        await t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
    expect(invokeDeferredAgentTurn).not.toHaveBeenCalled();
});

test("the live mission journals its prepared request and original response through the shared transport", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const { t, invocation } = await liveInvocationFixture("journal-wiring");
    const requestJson = JSON.stringify({
        version: 1,
        input: { prompt: "Actual prepared input" },
    });
    const observableReplyJson = JSON.stringify({
        version: 1,
        content: [
            { type: "text", text: '{"kind":"blocked","code":"test_done"}' },
        ],
    });
    vi.mocked(invokeDeferredAgentTurn).mockImplementation(async (input) => {
        await input.dependencies.beforeDispatch?.(requestJson);
        return {
            status: "succeeded",
            model: "test/inspection",
            latencyMs: 1,
            dispatchOutcome: "response_received",
            finishReason: "stop",
            requests: [],
            assistantOutput: '{"kind":"blocked","code":"test_done"}',
            observableReplyJson,
        };
    });
    await t.action(internal.execution.modelActions.invoke, {
        invocationId: invocation.invocationId,
        expectedGeneration: 4,
    });
    const payloads = await t.run((ctx) =>
        ctx.db
            .query("agentInvocationPayloads")
            .withIndex("by_invocation_and_part", (q) =>
                q.eq("invocationId", invocation.invocationId),
            )
            .collect(),
    );
    expect(payloads.map((payload) => [payload.part, payload.state])).toEqual([
        ["reply", "complete"],
        ["request", "complete"],
    ]);
    expect(
        JSON.parse(payloads.find((p) => p.part === "request")?.json ?? "null"),
    ).toEqual(JSON.parse(requestJson));
    expect(
        JSON.parse(payloads.find((p) => p.part === "reply")?.json ?? "null"),
    ).toEqual(JSON.parse(observableReplyJson));
});

test("an unretainable observation rolls back its receipt and budget settlement", async () => {
    const { t, args, missionId, invocation } =
        await liveInvocationFixture("atomic-observation");
    const attempt = {
        missionId,
        invocationId: invocation.invocationId,
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        executionGeneration: 4,
        workflowVersion: getAgentDefinition("saved_material_inspection_v1")
            .version,
        stepKey: "agent_reasoning",
        service: "model" as const,
        operation: "agent_reasoning",
        operationKey: `mission:${missionId}:invocation:${invocation.invocationId}:attempt:1`,
        attempt: 1,
        inputHash: sha256Hex(invocation.inputJson),
    };
    const admitted = await t.mutation(internal.providerCalls.recordAttempt, {
        ...attempt,
        status: "started",
    });
    await expect(
        t.mutation(internal.execution.invocations.recordModelReply, {
            attempt: {
                ...attempt,
                status: "succeeded",
                dispatchOutcome: "response_received",
            },
            reply: {
                response: { kind: "operations", requests: [] },
                rawOutputJson: "x".repeat(512 * 1024 + 1),
            },
        }),
    ).rejects.toThrow("response_capacity");
    expect(
        await t.run((ctx) => ctx.db.get(admitted.providerCallId)),
    ).toMatchObject({ status: "started" });
    expect(
        (await t.run((ctx) => ctx.db.get(invocation.invocationId)))
            ?.receivedOutputJson,
    ).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get(args.runId))).toMatchObject({
        sourcePreparationBudget: {
            work: 0,
            incidents: 0,
            reserved: 1,
            dispatches: 1,
        },
    });
});

test("a cancelled model turn retains its factual receipt without adopting the late response", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const { t, args, userId, invocation } =
        await liveInvocationFixture("cancelled-response");
    const response = {
        kind: "operations" as const,
        requests: [
            { callId: "late", name: "consult_mission_state", inputJson: "{}" },
        ],
    };
    vi.mocked(invokeDeferredAgentTurn).mockImplementationOnce(async () => {
        await t
            .withIdentity({ subject: `${userId}|cancelled-model-turn` })
            .mutation(api.workflowControls.cancel, { runId: args.runId });
        return {
            status: "succeeded",
            model: "test/inspection",
            latencyMs: 1,
            dispatchOutcome: "response_received",
            finishReason: "tool-calls",
            assistantOutput: "",
            requests: response.requests,
        };
    });
    const reply = await t.action(internal.execution.modelActions.invoke, {
        invocationId: invocation.invocationId,
        expectedGeneration: 4,
    });
    const observed = await t.run((ctx) => ctx.db.get(invocation.invocationId));
    expect(observed?.receivedWhileAuthorized).toBe(false);
    expect(JSON.parse(observed?.receivedOutputJson ?? "null")).toEqual(
        response,
    );
    const providerCallId = observed?.providerCallId;
    const receipt = providerCallId
        ? await t.run((ctx) => ctx.db.get(providerCallId))
        : null;
    expect(receipt).toMatchObject({
        status: "succeeded",
        invocationId: invocation.invocationId,
        dispatchOutcome: "response_received",
    });
    expect(
        await t.mutation(internal.execution.invocations.finish, {
            invocationId: invocation.invocationId,
            expectedGeneration: 4,
            response: reply.response,
        }),
    ).toMatchObject({ kind: "blocked", code: "stale_execution" });
    expect(await t.run((ctx) => ctx.db.get(args.runId))).toMatchObject({
        executionStatus: "cancelled",
        executionGeneration: 5,
        sourcePreparationBudget: { work: 1, reserved: 0, dispatches: 1 },
    });
    expect(
        await t.run((ctx) => ctx.db.query("agentOperationRequests").take(1)),
    ).toEqual([]);
    expect(invokeDeferredAgentTurn).toHaveBeenCalledTimes(1);
});

for (const transport of ["tools", "text"] as const) {
    test.each([
        {
            name: "duplicate call IDs",
            calls: ["same", "same"],
            code: "invalid_tool_correlation",
        },
        {
            name: "empty call ID",
            calls: [""],
            code: "invalid_tool_correlation",
        },
        {
            name: "oversized batch",
            calls: ["a", "b", "c", "d", "e"],
            code: "operation_batch_limit",
        },
    ])(`malformed tool batch from ${transport}: $name consumes incident capacity`, async ({
        calls,
        code,
    }) => {
        vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
        const requests = calls.map((callId) => ({
            callId,
            name: "consult_mission_state",
            inputJson: "{}",
        }));
        vi.mocked(invokeDeferredAgentTurn).mockResolvedValue({
            status: "succeeded",
            model: "test/inspection",
            latencyMs: 1,
            dispatchOutcome: "response_received",
            finishReason: transport === "tools" ? "tool-calls" : "stop",
            assistantOutput:
                transport === "text"
                    ? JSON.stringify({ kind: "operations", requests })
                    : "",
            requests: transport === "tools" ? requests : [],
        });
        const { t, args, invocation } =
            await liveInvocationFixture("invalid-batch");
        const reply = await t.action(internal.execution.modelActions.invoke, {
            invocationId: invocation.invocationId,
            expectedGeneration: 4,
        });
        expect(reply.response).toEqual({ kind: "blocked", code });
        const observed = await t.run((ctx) =>
            ctx.db.get(invocation.invocationId),
        );
        const providerCallId = observed?.providerCallId;
        const receipt = providerCallId
            ? await t.run((ctx) => ctx.db.get(providerCallId))
            : null;
        expect(receipt).toMatchObject({
            status: "failed",
            errorCode: code,
            dispatchOutcome: "response_received",
            diagnostic: { reason: code },
        });
        expect(await t.run((ctx) => ctx.db.get(args.runId))).toMatchObject({
            sourcePreparationBudget: {
                work: 0,
                incidents: 1,
                reserved: 0,
                dispatches: 1,
            },
        });
        expect(
            await t.mutation(internal.execution.invocations.finish, {
                invocationId: invocation.invocationId,
                expectedGeneration: 4,
                response: reply.response,
            }),
        ).toMatchObject({ kind: "blocked", code, requestIds: [] });
    });
}

test("a lost terminal mutation acknowledgement retains the response and resumes without another provider call", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const response = {
        kind: "operations" as const,
        requests: [
            {
                callId: "consult",
                name: "consult_mission_state",
                inputJson: "{}",
            },
        ],
    };
    vi.mocked(invokeDeferredAgentTurn).mockResolvedValue({
        status: "succeeded",
        model: "test/inspection",
        latencyMs: 1,
        dispatchOutcome: "response_received",
        finishReason: "tool-calls",
        assistantOutput: "",
        requests: response.requests,
    });
    const { t, args, missionId, invocation } = await liveInvocationFixture(
        "commit-interruption",
    );
    workflowTest.register(t);
    const workflowId = await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
    });
    await expect(
        t.action(async (ctx) => {
            // Lose only the acknowledgement after a real transaction commits its terminal receipt.
            const runMutation: typeof ctx.runMutation = async (
                reference,
                ...mutationArgs
            ) => {
                const result = await ctx.runMutation(
                    reference,
                    ...mutationArgs,
                );
                const terminal = await t.run(async (dbCtx) => {
                    const current = await dbCtx.db.get(invocation.invocationId);
                    return current?.providerCallId
                        ? dbCtx.db.get(current.providerCallId)
                        : null;
                });
                if (terminal?.status === "succeeded")
                    throw new Error("Simulated lost mutation acknowledgement");
                return result;
            };
            // Convex retains this handler at runtime but strips its internal member from published declarations.
            const registered = invokeModelAction as typeof invokeModelAction & {
                _handler(
                    ctx: ActionCtx,
                    args: FunctionArgs<
                        typeof internal.execution.modelActions.invoke
                    >,
                ): Promise<
                    FunctionReturnType<
                        typeof internal.execution.modelActions.invoke
                    >
                >;
            };
            return registered._handler(
                { ...ctx, runMutation },
                {
                    invocationId: invocation.invocationId,
                    expectedGeneration: 4,
                },
            );
        }),
    ).rejects.toThrow("Simulated lost mutation acknowledgement");
    const observed = await t.run((ctx) => ctx.db.get(invocation.invocationId));
    expect(JSON.parse(observed?.receivedOutputJson ?? "null")).toEqual(
        response,
    );
    expect(JSON.parse(observed?.rawOutputJson ?? "null")).toEqual({
        assistantOutput: "",
        requests: response.requests,
    });
    await t.mutation(internal.execution.missionWorkflow.onComplete, {
        workflowId: workflowId as WorkflowId,
        context: { missionId },
        result: { kind: "failed", error: "Simulated interruption" },
    });
    await t.mutation(internal.execution.missions.resume, {
        missionId,
        expectedGeneration: 4,
    });
    const next = await t.mutation(internal.execution.missionWorkflow.next, {
        missionId,
        expectedGeneration: 4,
    });
    expect(next).toMatchObject({ kind: "adopt", response });
    if (next.kind !== "adopt")
        throw new Error("Expected retained response adoption");
    expect(
        await t.mutation(internal.execution.invocations.finish, {
            invocationId: invocation.invocationId,
            expectedGeneration: 4,
            response: next.response,
        }),
    ).toMatchObject({ kind: "waiting" });
    expect(await t.run((ctx) => ctx.db.get(args.runId))).toMatchObject({
        sourcePreparationBudget: { work: 1, reserved: 0, dispatches: 1 },
    });
    expect(invokeDeferredAgentTurn).toHaveBeenCalledTimes(1);
});

test.each([
    "I am done.",
    '{"kind":"complete"}',
    'Preparation is finished.\n```json\n{"kind":"complete","captureIds":[]}\n```',
])("invalid final output %s is retained as an incident with an explicit outcome", async (assistantOutput) => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    vi.mocked(invokeDeferredAgentTurn).mockResolvedValue({
        status: "succeeded",
        model: "test/inspection",
        latencyMs: 1,
        dispatchOutcome: "response_received",
        finishReason: "stop",
        assistantOutput,
        requests: [],
    });
    const { t, args, invocation, missionId } =
        await liveInvocationFixture("invalid-output");
    const reply = await t.action(internal.execution.modelActions.invoke, {
        invocationId: invocation.invocationId,
        expectedGeneration: 4,
    });
    expect(reply.response).toEqual({ kind: "blocked", code: "invalid_output" });
    const retained = await t.run((ctx) => ctx.db.get(invocation.invocationId));
    expect(retained?.receivedOutputJson).toContain("invalid_output");
    expect(JSON.parse(retained?.rawOutputJson ?? "null")).toMatchObject({
        output: assistantOutput,
    });
    const providerCallId = retained?.providerCallId;
    const receipt = providerCallId
        ? await t.run((ctx) => ctx.db.get(providerCallId))
        : null;
    expect(receipt).toMatchObject({
        status: "failed",
        errorCode: "invalid_output",
        dispatchOutcome: "response_received",
        diagnostic: { reason: "invalid_output", output: assistantOutput },
    });
    const refused = await t.mutation(internal.execution.invocations.finish, {
        invocationId: invocation.invocationId,
        expectedGeneration: 4,
        ...reply,
    });
    expect(refused).toMatchObject({
        kind: "blocked",
        code: "completion_correction_required",
        correction: { code: "invalid_output" },
    });
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        status: "ready",
        noProgressTurns: 1,
    });
    expect(
        await t.mutation(internal.execution.invocations.finish, {
            invocationId: invocation.invocationId,
            expectedGeneration: 4,
            ...reply,
        }),
    ).toEqual(refused);
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        noProgressTurns: 1,
    });
    expect(await t.run((ctx) => ctx.db.get(args.runId))).toMatchObject({
        sourcePreparationBudget: {
            work: 0,
            incidents: 1,
            reserved: 0,
            dispatches: 1,
        },
    });
});

test.each([
    "tool_arguments_invalid",
    "not_dispatched",
    "unknown",
    "missing_receipt",
] as const)("invalid output cannot enter completion correction with %s evidence", async (mode) => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    vi.mocked(invokeDeferredAgentTurn).mockResolvedValue({
        status: "succeeded",
        model: "test/inspection",
        latencyMs: 1,
        dispatchOutcome: "response_received",
        finishReason: "stop",
        assistantOutput: "Not valid JSON",
        requests: [],
    });
    const { t, missionId, invocation } = await liveInvocationFixture(
        `refusal-${mode}`,
    );
    const reply = await t.action(internal.execution.modelActions.invoke, {
        invocationId: invocation.invocationId,
        expectedGeneration: 4,
    });
    await t.run(async (ctx) => {
        const retained = await ctx.db.get(invocation.invocationId);
        const receipt = retained?.providerCallId
            ? await ctx.db.get(retained.providerCallId)
            : null;
        if (!receipt?.diagnostic)
            throw new Error("Expected a received invalid-output receipt");
        if (mode === "missing_receipt") {
            await ctx.db.patch(invocation.invocationId, {
                providerCallId: undefined,
            });
        } else if (mode === "tool_arguments_invalid") {
            await ctx.db.patch(receipt._id, {
                diagnostic: { ...receipt.diagnostic, reason: mode },
            });
        } else {
            await ctx.db.patch(receipt._id, { dispatchOutcome: mode });
        }
    });
    expect(
        await t.mutation(internal.execution.invocations.finish, {
            invocationId: invocation.invocationId,
            expectedGeneration: 4,
            ...reply,
        }),
    ).toEqual({ kind: "blocked", code: "invalid_output", requestIds: [] });
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        status: "blocked",
        noProgressTurns: 0,
    });
    expect(
        (await t.run((ctx) => ctx.db.get(invocation.invocationId)))?.correction,
    ).toBeUndefined();
});
