import { api, components, internal } from "@convex/_generated/api";
import type { ActionCtx } from "@convex/_generated/server";
import { invoke } from "@convex/execution/invokeAgentModel";
import { saveMessages } from "@convex-dev/agent";
import agentTest from "@convex-dev/agent/test";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { afterEach, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

const registeredModelAction = invoke as typeof invoke & {
    _handler(
        ctx: ActionCtx,
        args: FunctionArgs<typeof internal.execution.modelActions.invoke>,
    ): Promise<
        FunctionReturnType<typeof internal.execution.modelActions.invoke>
    >;
};

vi.mock("@convex/integrations/modelRouting", async (original) => ({
    ...(await original<typeof import("@convex/integrations/modelRouting")>()),
    missionRoutes: {
        saved_material_inspection_v1: {
            model: "test/agent",
            provider: "test",
            authorizedForAgent: true,
        },
    },
}));
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

for (const [backend, backendVersion] of [
    ["ai-sdk", 1],
    ["convex-agent", 1],
    ["convex-agent", 2],
] as const) {
    for (const definition of ["inspection", "validation"] as const) {
        test(`the durable Workflow runs ${definition} with ${backend} v${backendVersion} without a paid route`, async () => {
            vi.useFakeTimers();
            vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
            vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
            const network = vi.fn(() => {
                throw new Error("Unexpected external I/O");
            });
            vi.stubGlobal("fetch", network);
            const { t, args, invitationId, captureId } =
                await seedInspectedEvidence();
            agentTest.register(t);
            workflowTest.register(t);
            await t.run((ctx) =>
                ctx.db.patch(invitationId, { slotKey: "analyst-4" }),
            );
            const contextId = await t.mutation(
                internal.runWorkspace.openBrowserTestContext,
                {
                    slotKey: "analyst-4",
                    contextKey: "backend-workflow",
                    durationMs: 60_000,
                },
            );
            await t.run((ctx) =>
                ctx.db.patch(args.runId, {
                    purpose: "browser_test",
                    browserTestContextId: contextId,
                    ...(definition === "validation"
                        ? { activeCorpusRevisionId: undefined }
                        : {}),
                }),
            );
            const missionId = await t.mutation(
                internal.execution.missions.start,
                {
                    runId: args.runId,
                    ...(definition === "validation"
                        ? {
                              definitionId: "execution_validation_v1" as const,
                              scope: {
                                  kind: "execution_validation_v1" as const,
                                  values: [3, 7],
                              },
                          }
                        : {
                              definitionId:
                                  "saved_material_inspection_v1" as const,
                              corpusRevisionId: args.corpusRevisionId,
                          }),
                    requestKey: "backend-workflow",
                    expectedGeneration: args.executionGeneration,
                    generationBackend: { id: backend, version: backendVersion },
                },
            );
            await t.mutation(internal.execution.missions.resume, {
                missionId,
                expectedGeneration: args.executionGeneration,
                simulation: true,
            });
            await t.finishAllScheduledFunctions(
                () => vi.advanceTimersByTime(10),
                500,
            );
            expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
                status: "completed",
                result:
                    definition === "validation"
                        ? { kind: "execution_validation_v1", total: 10 }
                        : {
                              kind: "saved_material_inspection_v1",
                              captureIds: [captureId],
                          },
            });
            const invocations = await t.run((ctx) =>
                ctx.db
                    .query("agentInvocations")
                    .withIndex("by_mission", (q) =>
                        q.eq("missionId", missionId),
                    )
                    .collect(),
            );
            expect(invocations).toHaveLength(
                definition === "validation" ? 3 : 4,
            );
            expect(
                invocations.every(
                    (invocation) =>
                        invocation.generationBackend?.id === backend,
                ),
            ).toBe(true);
            expect(
                invocations.every(
                    (invocation) =>
                        (invocation.generationStorageRef !== undefined) ===
                        (backend === "convex-agent"),
                ),
            ).toBe(true);
            if (backend === "convex-agent")
                expect(
                    new Set(
                        invocations.map(
                            (invocation) => invocation.generationStorageRef,
                        ),
                    ).size,
                ).toBe(backendVersion === 2 ? 1 : invocations.length);
            expect(
                await t.run((ctx) => ctx.db.query("providerCalls").collect()),
            ).toEqual([]);
            expect(network).not.toHaveBeenCalled();
        }, 30_000);
    }
}

test("the Convex Agent backend retains the same common reply and its observable messages", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-secret");
    const fetch = vi.fn(
        async () =>
            new Response(
                JSON.stringify({
                    id: "agent-reply",
                    created: 1,
                    model: "test/agent",
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: "assistant",
                                content:
                                    '{"kind":"blocked","code":"fixture_done"}',
                                reasoning: "private reasoning",
                            },
                            finish_reason: "stop",
                        },
                    ],
                    usage: {
                        prompt_tokens: 8,
                        completion_tokens: 4,
                        total_tokens: 12,
                    },
                }),
                { headers: { "Content-Type": "application/json" } },
            ),
    );
    vi.stubGlobal("fetch", fetch);
    const { t, args } = await seedInspectedEvidence();
    agentTest.register(t);
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "convex-backend",
        expectedGeneration: args.executionGeneration,
        generationBackend: { id: "convex-agent", version: 1 },
    });
    const begun = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: args.executionGeneration,
        taskKey: "turn",
        provenance: "live",
    });
    if (begun.kind !== "ready") throw new Error("Expected invocation");
    const reply = await t.action(internal.execution.modelActions.invoke, {
        invocationId: begun.invocationId,
        expectedGeneration: args.executionGeneration,
    });
    expect(reply.response).toEqual({ kind: "blocked", code: "fixture_done" });
    const invocation = await t.run((ctx) => ctx.db.get(begun.invocationId));
    expect(invocation?.generationStorageRef).toBeTypeOf("string");
    const messages = await t.query(
        components.agent.messages.listMessagesByThreadId,
        {
            threadId: invocation?.generationStorageRef ?? "missing",
            order: "asc",
            paginationOpts: { cursor: null, numItems: 20 },
        },
    );
    expect(
        messages.page.some(
            (message) =>
                message.text === '{"kind":"blocked","code":"fixture_done"}',
        ),
    ).toBe(true);
    expect(JSON.stringify(messages)).not.toContain("private reasoning");
    expect(JSON.stringify(messages)).not.toContain("test-secret");
    const providerCallId = invocation?.providerCallId;
    if (!providerCallId) throw new Error("Expected provider receipt");
    const receipt = await t.run((ctx) => ctx.db.get(providerCallId));
    expect(receipt).toMatchObject({
        status: "succeeded",
        usage: { inputTokens: 8, outputTokens: 4 },
    });
    expect(fetch).toHaveBeenCalledOnce();
});

test("interruption after Agent message storage keeps the common result and resumes without regeneration", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-secret");
    const fetch = vi.fn(
        async () =>
            new Response(
                JSON.stringify({
                    id: "stored-reply",
                    created: 1,
                    model: "test/agent",
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: "assistant",
                                content:
                                    '{"kind":"blocked","code":"fixture_done"}',
                            },
                            finish_reason: "stop",
                        },
                    ],
                    usage: {
                        prompt_tokens: 8,
                        completion_tokens: 4,
                        total_tokens: 12,
                    },
                }),
                { headers: { "Content-Type": "application/json" } },
            ),
    );
    vi.stubGlobal("fetch", fetch);
    const { t, args } = await seedInspectedEvidence();
    agentTest.register(t);
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "backend-interruption",
        expectedGeneration: args.executionGeneration,
        generationBackend: { id: "convex-agent", version: 1 },
    });
    const begun = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: args.executionGeneration,
        taskKey: "turn",
        provenance: "live",
    });
    if (begun.kind !== "ready") throw new Error("Expected invocation");
    let interrupted = false;
    await expect(
        t.action(async (ctx) => {
            const runMutation: typeof ctx.runMutation = async (
                reference,
                ...mutationArgs
            ) => {
                const result = await ctx.runMutation(
                    reference,
                    ...mutationArgs,
                );
                const current = await t.run((db) =>
                    db.db.get(begun.invocationId),
                );
                if (!interrupted && current?.generationStorageRef) {
                    const messages = await t.query(
                        components.agent.messages.listMessagesByThreadId,
                        {
                            threadId: current.generationStorageRef,
                            order: "asc",
                            paginationOpts: { cursor: null, numItems: 20 },
                        },
                    );
                    if (
                        messages.page.some(
                            (message) =>
                                message.text ===
                                '{"kind":"blocked","code":"fixture_done"}',
                        )
                    ) {
                        interrupted = true;
                        throw new Error("Lost Agent storage acknowledgement");
                    }
                }
                return result;
            };
            return registeredModelAction._handler(
                { ...ctx, runMutation },
                {
                    invocationId: begun.invocationId,
                    expectedGeneration: args.executionGeneration,
                },
            );
        }),
    ).rejects.toThrow("generation_backend_interrupted");
    const current = await t.run((ctx) => ctx.db.get(begun.invocationId));
    expect(JSON.parse(current?.receivedOutputJson ?? "null")).toEqual({
        kind: "blocked",
        code: "fixture_done",
    });
    const events = await t.run((ctx) =>
        ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_mission_and_sequence", (q) =>
                q.eq("missionId", missionId),
            )
            .collect(),
    );
    expect(
        events.some((event) => event.kind === "generation_backend_interrupted"),
    ).toBe(true);
    const next = await t.mutation(internal.execution.missionWorkflow.next, {
        missionId,
        expectedGeneration: args.executionGeneration,
    });
    expect(next).toMatchObject({
        kind: "adopt",
        invocationId: begun.invocationId,
    });
    if (next.kind !== "adopt") throw new Error("Expected retained observation");
    await t.mutation(internal.execution.invocations.finish, {
        invocationId: next.invocationId,
        expectedGeneration: args.executionGeneration,
        response: next.response,
        rawOutputJson: next.rawOutputJson,
    });
    expect(await t.run((ctx) => ctx.db.get(missionId))).toMatchObject({
        status: "blocked",
        blockCode: "fixture_done",
    });
    expect(fetch).toHaveBeenCalledOnce();
});

test("new invocations pin the default generation backend without changing mission identity", async () => {
    const { t, args } = await seedInspectedEvidence();
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "backend-default",
        expectedGeneration: args.executionGeneration,
    });
    const begun = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: args.executionGeneration,
        taskKey: "turn",
        provenance: "live",
    });
    if (begun.kind !== "ready") throw new Error("Expected invocation");
    const invocation = await t.run((ctx) => ctx.db.get(begun.invocationId));
    expect(invocation).toMatchObject({
        generationBackend: { id: "convex-agent", version: 2 },
    });
    expect(
        await t.mutation(internal.execution.invocations.begin, {
            missionId,
            expectedGeneration: args.executionGeneration,
            taskKey: "turn",
            provenance: "live",
        }),
    ).toEqual(begun);
});

async function liveBackendTurn(backend: { id: string; version: number }) {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const fixture = await seedInspectedEvidence();
    const { t, args } = fixture;
    agentTest.register(t);
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "backend-boundary",
        expectedGeneration: args.executionGeneration,
        generationBackend: backend,
    });
    const begun = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: args.executionGeneration,
        taskKey: "turn",
        provenance: "live",
    });
    if (begun.kind !== "ready") throw new Error("Expected invocation");
    return {
        ...fixture,
        missionId,
        invocationId: begun.invocationId,
        invokeArgs: {
            invocationId: begun.invocationId,
            expectedGeneration: args.executionGeneration,
        },
    };
}

for (const backend of [
    { id: "other-runtime", version: 1 },
    { id: "convex-agent", version: 99 },
]) {
    test(`unsupported backend ${backend.id} version ${backend.version} blocks before provider admission`, async () => {
        const network = vi.fn(() => {
            throw new Error("Unexpected network");
        });
        vi.stubGlobal("fetch", network);
        const { t, invokeArgs } = await liveBackendTurn(backend);
        expect(
            (await t.action(internal.execution.modelActions.invoke, invokeArgs))
                .response,
        ).toEqual({ kind: "blocked", code: "generation_backend_unknown" });
        expect(
            await t.run((ctx) => ctx.db.query("providerCalls").collect()),
        ).toEqual([]);
        expect(network).not.toHaveBeenCalled();
    });
}

function providerResponse(
    message: Record<string, unknown>,
    finishReason = "stop",
) {
    return new Response(
        JSON.stringify({
            id: "backend-contract",
            created: 1,
            model: "test/agent",
            choices: [
                {
                    index: 0,
                    message: { role: "assistant", ...message },
                    finish_reason: finishReason,
                },
            ],
            usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
        }),
        { headers: { "Content-Type": "application/json" } },
    );
}

test("a model reply received during an analyst pause remains adoptable after public resume", async () => {
    vi.useFakeTimers();
    const f = await liveBackendTurn({ id: "convex-agent", version: 2 });
    workflowTest.register(f.t);
    const client = f.t.withIdentity({ subject: f.userId });
    await f.t.run((ctx) =>
        ctx.db.patch(f.args.runId, { agentExecutionVersion: 3 }),
    );
    const network = vi.fn(async () => {
        await client.mutation(api.execution.researchControl.pause, {
            runId: f.args.runId,
            expectedGeneration: f.args.executionGeneration,
        });
        return providerResponse(
            {
                content: null,
                tool_calls: [
                    {
                        id: "retained-state",
                        type: "function",
                        function: {
                            name: "consult_run_state",
                            arguments: "{}",
                        },
                    },
                ],
            },
            "tool_calls",
        );
    });
    vi.stubGlobal("fetch", network);
    const reply = await f.t.action(
        internal.execution.modelActions.invoke,
        f.invokeArgs,
    );
    expect(reply.response.kind).toBe("operations");
    expect(await f.t.run((ctx) => ctx.db.get(f.invocationId))).toMatchObject({
        status: "started",
        receivedWhileAuthorized: true,
    });
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            ...f.invokeArgs,
            ...reply,
        }),
    ).toMatchObject({ kind: "blocked", code: "stale_execution" });
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("agentOperationRequests")
                .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
                .collect(),
        ),
    ).toEqual([]);
    const generation = await client.mutation(
        api.execution.researchControl.resume,
        {
            runId: f.args.runId,
            expectedGeneration: f.args.executionGeneration + 1,
        },
    );
    await f.t.mutation(internal.execution.researchControl.resumeMissions, {
        runId: f.args.runId,
        generation,
        paginationOpts: { cursor: null, numItems: 20 },
    });
    expect(
        await f.t.mutation(internal.execution.missionWorkflow.next, {
            missionId: f.missionId,
            expectedGeneration: generation,
        }),
    ).toMatchObject({ kind: "adopt", invocationId: f.invocationId });
    const adopted = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: f.invocationId,
        expectedGeneration: generation,
        ...reply,
    });
    expect(adopted.kind).toBe("waiting");
    expect(adopted.requestIds).toHaveLength(1);
    const requestId = adopted.requestIds[0];
    if (!requestId) throw new Error("Expected adopted operation");
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        input: { kind: "consult_run_state" },
        expectedGeneration: generation,
    });
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([
        expect.objectContaining({
            status: "succeeded",
            dispatchOutcome: "response_received",
        }),
    ]);
    expect(network).toHaveBeenCalledOnce();
}, 30_000);

test.each([
    "revocation",
    "withdrawal",
    "cancellation",
    "scope_change",
] as const)("pause does not authorize a late response after %s", async (change) => {
    const f = await liveBackendTurn({ id: "convex-agent", version: 2 });
    const client = f.t.withIdentity({ subject: f.userId });
    await f.t.run((ctx) =>
        ctx.db.patch(f.args.runId, { agentExecutionVersion: 3 }),
    );
    const network = vi.fn(async () => {
        await client.mutation(api.execution.researchControl.pause, {
            runId: f.args.runId,
            expectedGeneration: f.args.executionGeneration,
        });
        await f.t.run(async (ctx) => {
            if (change === "revocation")
                await ctx.db.patch(f.visitorId, { status: "revoked" });
            else if (change === "withdrawal")
                await ctx.db.patch(f.args.runId, { withdrawnAt: Date.now() });
            else if (change === "cancellation")
                await ctx.db.patch(f.args.runId, {
                    executionStatus: "cancelled",
                });
            else
                await ctx.db.patch(f.args.runId, {
                    activeCorpusRevisionId: undefined,
                });
        });
        return providerResponse({
            content: '{"kind":"blocked","code":"fixture_done"}',
        });
    });
    vi.stubGlobal("fetch", network);
    const reply = await f.t.action(
        internal.execution.modelActions.invoke,
        f.invokeArgs,
    );
    expect(await f.t.run((ctx) => ctx.db.get(f.invocationId))).toMatchObject({
        receivedWhileAuthorized: false,
        receivedOutputJson: expect.any(String),
    });
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            ...f.invokeArgs,
            ...reply,
        }),
    ).toMatchObject({ kind: "blocked" });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).not.toHaveProperty(
        "result",
    );
    expect(network).toHaveBeenCalledOnce();
}, 30_000);

for (const id of ["ai-sdk", "convex-agent"] as const) {
    test(`${id} preserves a late observation without adopting it after a generation change`, async () => {
        const fixture = await liveBackendTurn({ id, version: 1 });
        const { t, args, missionId, invocationId, invokeArgs } = fixture;
        const network = vi.fn(async () => {
            await t.run((ctx) =>
                ctx.db.patch(args.runId, {
                    executionGeneration: args.executionGeneration + 1,
                }),
            );
            return providerResponse({
                content: '{"kind":"blocked","code":"fixture_done"}',
            });
        });
        vi.stubGlobal("fetch", network);
        const reply = await t.action(
            internal.execution.modelActions.invoke,
            invokeArgs,
        );
        expect(await t.run((ctx) => ctx.db.get(invocationId))).toMatchObject({
            receivedWhileAuthorized: false,
        });
        const adopted = await t.mutation(
            internal.execution.invocations.finish,
            {
                ...invokeArgs,
                response: reply.response,
                rawOutputJson: reply.rawOutputJson,
            },
        );
        expect(adopted.kind).toBe("blocked");
        expect(await t.run((ctx) => ctx.db.get(missionId))).not.toHaveProperty(
            "result",
        );
        const receipt = await t.run(async (ctx) => {
            const invocation = await ctx.db.get(invocationId);
            return invocation?.providerCallId
                ? ctx.db.get(invocation.providerCallId)
                : null;
        });
        expect(receipt).toMatchObject({
            status: "succeeded",
            executionGeneration: args.executionGeneration,
        });
        expect(network).toHaveBeenCalledOnce();
    });

    test(`${id} marks an oversized original reply incomplete without adopting its content`, async () => {
        const { t, invocationId, invokeArgs } = await liveBackendTurn({
            id,
            version: 1,
        });
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                providerResponse({ content: "x".repeat(530 * 1024) }),
            ),
        );
        const reply = await t.action(
            internal.execution.modelActions.invoke,
            invokeArgs,
        );
        expect(reply.response).toEqual({
            kind: "blocked",
            code: "response_capacity",
        });
        const payload = await t.run((ctx) =>
            ctx.db
                .query("agentInvocationPayloads")
                .withIndex("by_invocation_and_part", (q) =>
                    q.eq("invocationId", invocationId).eq("part", "reply"),
                )
                .unique(),
        );
        expect(payload).toMatchObject({
            state: "incomplete",
            code: "journal_reply_capacity",
        });
        expect(payload).not.toHaveProperty("json");
    });

    test(`${id} prevents provider dispatch when request persistence fails`, async () => {
        const { t, invocationId, invokeArgs } = await liveBackendTurn({
            id,
            version: 1,
        });
        const network = vi.fn(() => {
            throw new Error("Unexpected provider call");
        });
        vi.stubGlobal("fetch", network);
        const reply = await t.action((ctx) => {
            const runMutation: typeof ctx.runMutation = async (
                reference,
                ...mutationArgs
            ) => {
                const mutationInput = mutationArgs[0];
                if (
                    mutationInput !== undefined &&
                    Object.hasOwn(mutationInput, "requestJson")
                )
                    throw new Error("Request persistence unavailable");
                return ctx.runMutation(reference, ...mutationArgs);
            };
            return registeredModelAction._handler(
                { ...ctx, runMutation },
                invokeArgs,
            );
        });
        expect(reply.response).toEqual({
            kind: "blocked",
            code: "journal_request_unavailable",
        });
        expect(network).not.toHaveBeenCalled();
        const request = await t.run((ctx) =>
            ctx.db
                .query("agentInvocationPayloads")
                .withIndex("by_invocation_and_part", (q) =>
                    q.eq("invocationId", invocationId).eq("part", "request"),
                )
                .unique(),
        );
        expect(request).toMatchObject({
            state: "incomplete",
            code: "not_dispatched",
        });
    });
}

test("a backend change affects the next invocation and preserves the operation result", async () => {
    const { t, args, missionId, invocationId, invokeArgs } =
        await liveBackendTurn({ id: "ai-sdk", version: 1 });
    const wireRequests: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            wireRequests.push(JSON.parse(String(init?.body)));
            return wireRequests.length === 1
                ? providerResponse(
                      {
                          content: null,
                          tool_calls: [
                              {
                                  id: "consult",
                                  type: "function",
                                  function: {
                                      name: "consult_mission_state",
                                      arguments: "{}",
                                  },
                              },
                          ],
                      },
                      "tool_calls",
                  )
                : providerResponse({
                      content: '{"kind":"blocked","code":"fixture_done"}',
                  });
        }),
    );
    await t.run((ctx) =>
        ctx.db.patch(missionId, {
            generationBackend: { id: "convex-agent", version: 1 },
        }),
    );
    const first = await t.action(
        internal.execution.modelActions.invoke,
        invokeArgs,
    );
    expect(await t.run((ctx) => ctx.db.get(invocationId))).not.toHaveProperty(
        "generationStorageRef",
    );
    const adopted = await t.mutation(internal.execution.invocations.finish, {
        ...invokeArgs,
        response: first.response,
        rawOutputJson: first.rawOutputJson,
    });
    for (const requestId of adopted.requestIds)
        await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: args.executionGeneration,
        });
    await t.mutation(internal.execution.invocations.settle, invokeArgs);
    const next = await t.mutation(internal.execution.invocations.begin, {
        missionId,
        expectedGeneration: args.executionGeneration,
        taskKey: "next-turn",
        provenance: "live",
    });
    if (next.kind !== "ready") throw new Error("Expected continuation");
    const invocation = await t.run((ctx) => ctx.db.get(next.invocationId));
    expect(invocation?.generationBackend).toEqual({
        id: "convex-agent",
        version: 1,
    });
    expect(JSON.parse(next.inputJson)).toMatchObject({
        triggeringRequestsAndResults: [
            {
                input: { kind: "consult_mission_state" },
                outcome: { kind: "success" },
            },
        ],
    });
    await t.action(internal.execution.modelActions.invoke, {
        invocationId: next.invocationId,
        expectedGeneration: args.executionGeneration,
    });
    expect(await t.run((ctx) => ctx.db.get(next.invocationId))).toHaveProperty(
        "generationStorageRef",
    );
    expect(wireRequests).toHaveLength(2);
    for (const [index, currentId] of [
        invocationId,
        next.invocationId,
    ].entries()) {
        const snapshot = await t.run((ctx) =>
            ctx.db
                .query("agentInvocationPayloads")
                .withIndex("by_invocation_and_part", (q) =>
                    q.eq("invocationId", currentId).eq("part", "request"),
                )
                .unique(),
        );
        const request = JSON.parse(snapshot?.json ?? "null");
        expect(request.input.maxOutputTokens).toBe(6144);
        expect(request.input.temperature).toBe(0);
        const tools = request.input.tools as Array<{
            name: string;
            inputSchema: unknown;
        }>;
        const wireRequest = wireRequests[index];
        if (!wireRequest) throw new Error("Expected provider request");
        expect(
            tools.find((tool) => tool.name === "consult_mission_state")
                ?.inputSchema,
        ).toEqual(
            (
                wireRequest.tools as Array<{
                    function: { name: string; parameters: unknown };
                }>
            ).find((tool) => tool.function.name === "consult_mission_state")
                ?.function.parameters,
        );
        expect(JSON.stringify(request.input.prompt)).toContain(
            "unfinishedObligations",
        );
    }
});

test("an invocation without backend metadata retains the historical direct generation path", async () => {
    const { t, invocationId, invokeArgs } = await liveBackendTurn({
        id: "convex-agent",
        version: 1,
    });
    await t.run((ctx) =>
        ctx.db.patch(invocationId, { generationBackend: undefined }),
    );
    const network = vi.fn(async () =>
        providerResponse({
            content: '{"kind":"blocked","code":"fixture_done"}',
        }),
    );
    vi.stubGlobal("fetch", network);
    expect(
        (await t.action(internal.execution.modelActions.invoke, invokeArgs))
            .response,
    ).toEqual({ kind: "blocked", code: "fixture_done" });
    expect(await t.run((ctx) => ctx.db.get(invocationId))).not.toHaveProperty(
        "generationStorageRef",
    );
    expect(network).toHaveBeenCalledOnce();
});

for (const id of ["ai-sdk", "convex-agent"] as const) {
    test(`${id} reuses a confirmed observation when the common settlement acknowledgement is lost`, async () => {
        const { t, missionId, invocationId, invokeArgs } =
            await liveBackendTurn({ id, version: 1 });
        const network = vi.fn(async () =>
            providerResponse({
                content: '{"kind":"blocked","code":"fixture_done"}',
            }),
        );
        vi.stubGlobal("fetch", network);
        let interrupted = false;
        await expect(
            t.action((ctx) => {
                const runMutation: typeof ctx.runMutation = async (
                    reference,
                    ...mutationArgs
                ) => {
                    const result = await ctx.runMutation(
                        reference,
                        ...mutationArgs,
                    );
                    const mutationInput = mutationArgs[0];
                    if (
                        !interrupted &&
                        mutationInput !== undefined &&
                        Object.hasOwn(mutationInput, "attempt") &&
                        Object.hasOwn(mutationInput, "reply")
                    ) {
                        interrupted = true;
                        throw new Error("Lost settlement acknowledgement");
                    }
                    return result;
                };
                return registeredModelAction._handler(
                    { ...ctx, runMutation },
                    invokeArgs,
                );
            }),
        ).rejects.toThrow("generation_backend_interrupted");
        const next = await t.mutation(internal.execution.missionWorkflow.next, {
            missionId,
            expectedGeneration: invokeArgs.expectedGeneration,
        });
        expect(next).toMatchObject({ kind: "adopt", invocationId });
        const receipts = await t.run((ctx) =>
            ctx.db.query("providerCalls").collect(),
        );
        expect(receipts).toHaveLength(1);
        expect(receipts[0]).toMatchObject({
            status: "succeeded",
            dispatchOutcome: "response_received",
        });
        expect(network).toHaveBeenCalledOnce();
    });
}

test("Agent history cannot replace or expand the harness continuation context", async () => {
    const { t, invocationId, invokeArgs } = await liveBackendTurn({
        id: "convex-agent",
        version: 1,
    });
    const reference = await t.mutation(
        internal.integrations.agentStorage.prepare,
        invokeArgs,
    );
    await t.run((ctx) =>
        saveMessages(ctx, components.agent, {
            threadId: reference,
            messages: [{ role: "user", content: "IRRELEVANT_SAVED_HISTORY" }],
        }),
    );
    let wire = "";
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            wire = String(init?.body);
            return providerResponse({
                content: '{"kind":"blocked","code":"fixture_done"}',
            });
        }),
    );
    await t.action(internal.execution.modelActions.invoke, invokeArgs);
    expect(wire).not.toContain("IRRELEVANT_SAVED_HISTORY");
    expect(wire).toContain("unfinishedObligations");
    expect(wire).toContain("triggeringRequestsAndResults");
    const invocation = await t.run((ctx) => ctx.db.get(invocationId));
    expect(wire).toContain(
        JSON.parse(invocation?.inputJson ?? "null").mission.objective,
    );
});

test("provider exceptions cannot leak credentials or private diagnostics into Agent storage", async () => {
    const { t, invocationId, invokeArgs } = await liveBackendTurn({
        id: "convex-agent",
        version: 1,
    });
    const network = vi.fn(
        async () =>
            new Response(
                JSON.stringify({
                    error: {
                        code: 400,
                        message:
                            "provider echoed test-only-key and private-reasoning-marker",
                    },
                }),
                {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                },
            ),
    );
    vi.stubGlobal("fetch", network);
    const result = await t.action(
        internal.execution.modelActions.invoke,
        invokeArgs,
    );
    expect(result.response).toEqual({
        kind: "blocked",
        code: "request_invalid",
    });
    const invocation = await t.run((ctx) => ctx.db.get(invocationId));
    if (!invocation?.generationStorageRef)
        throw new Error("Expected component storage");
    const messages = await t.query(
        components.agent.messages.listMessagesByThreadId,
        {
            threadId: invocation.generationStorageRef,
            order: "asc",
            paginationOpts: { cursor: null, numItems: 20 },
        },
    );
    expect(JSON.stringify(messages)).not.toContain("test-only-key");
    expect(JSON.stringify(messages)).not.toContain("private-reasoning-marker");
    expect(network).toHaveBeenCalledOnce();
});
