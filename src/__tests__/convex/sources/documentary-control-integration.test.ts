import { internal } from "@convex/_generated/api";
import type {
    DocumentaryContribution,
    documentarySubmissionValue,
} from "@convex/domain/sourcesContracts";
import { runPiMission } from "@convex/integrations/piMission";
import {
    nodeActionGenerationDeadline,
    RESOURCE_POLICY_VERSION,
    SOURCES_QUALIFICATION_RESEARCH_WINDOW_MS,
} from "@convex/resourcePolicy";
import { pinMissionModel } from "@convex/modelConfiguration";
import {
    initializeQualificationUsage,
    readQualificationUsage,
    updateQualificationUsage,
} from "@convex/qualificationUsage";
import type { Infer } from "convex/values";
import { afterEach, assert, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

function documentaryReply(init?: RequestInit) {
    const wire = JSON.parse(String(init?.body));
    const ids: string[] =
        wire.response_format.json_schema.schema.properties.findings.required;
    return Response.json({
        id: "offline-valid",
        model: "z-ai/glm-5.3-flash",
        choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    content: JSON.stringify({
                        coherence: true,
                        limitations: ["Publisher description."],
                        findings: Object.fromEntries(
                            ids.map((id) => [
                                id,
                                {
                                    conclusion: "supported",
                                    permittedUse: "context_only",
                                    diagnostic:
                                        "The exact quotation supports this context.",
                                },
                            ]),
                        ),
                    }),
                },
                finish_reason: "stop",
            },
        ],
        usage: {
            prompt_tokens: 10,
            completion_tokens: 10,
            total_tokens: 20,
            cost: 0.00001,
        },
    });
}

test("a paid documentary result past its qualification window preserves billing without adopting material", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run?.ownerVisitorId);
        const visitor = await ctx.db.get(run.ownerVisitorId);
        assert(visitor);
        await ctx.db.patch(visitor.invitationId, { slotKey: "analyst-4" });
    });
    const contextId = await f.t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        {
            slotKey: "analyst-4",
            contextKey: "documentary-window",
            durationMs: 60000,
        },
    );
    const deadlineAt = Date.now() + 20000;
    await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        const mission = await ctx.db.get(f.missionId);
        assert(run && mission?.modelRevisionId);
        const { _id, _creationTime, ...fields } = run;
        const secondId = await ctx.db.insert("researchRuns", {
            ...fields,
            purpose: "browser_test",
            browserTestContextId: contextId,
            executionStatus: "idle",
            sourcePreparationId: undefined,
        });
        await ctx.db.patch(run._id, {
            purpose: "browser_test",
            browserTestContextId: contextId,
            researchStartedAt:
                deadlineAt - SOURCES_QUALIFICATION_RESEARCH_WINDOW_MS,
        });
        await ctx.db.patch(f.preparationId, {
            modelRevisionId: mission.modelRevisionId,
        });
        await ctx.db.patch(contextId, {
            paidQualification: {
                resourcePolicy: RESOURCE_POLICY_VERSION,
                costAccountingPolicy: "known_final_v1",
                runId: run._id,
                modelRevisionId: mission.modelRevisionId,
                maximumRequests: 40,
                maximumCostUsd: 2,
                authorizedAt: Date.now(),
                sourcesLot: [run._id, secondId],
            },
        });
    });
    const beforeTasks = await f.t.run((ctx) =>
        ctx.db.query("aiTaskResults").collect(),
    );
    const requests: string[] = [];
    vi.stubGlobal(
        "fetch",
        async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
            requests.push(new Request(input, init).url);
            vi.setSystemTime(deadlineAt + 1);
            return documentaryReply(init);
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: f.requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "unavailable", code: "execution_deadline" });
    expect(requests).toEqual(["https://openrouter.ai/api/v1/chat/completions"]);
    expect(
        await f.t.run((ctx) => ctx.db.query("aiTaskResults").collect()),
    ).toEqual(beforeTasks);
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("providerCalls")
                .withIndex("by_run", (q) => q.eq("runId", f.runId))
                .collect(),
        ),
    ).toMatchObject([
        {
            status: "succeeded",
            dispatchOutcome: "response_received",
            reportedCost: 0.00001,
        },
    ]);
    expect(
        await f.t.run((ctx) =>
            ctx.db.query("agentInvocationPayloads").collect(),
        ),
    ).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ part: "reply", state: "complete" }),
        ]),
    );
});

test("a real documentary examination retains exact evidence through the Sources handoff", async () => {
    const f = await fixture();
    let calls = 0;
    vi.stubGlobal(
        "fetch",
        async (_url: unknown, init: RequestInit | undefined) => {
            calls++;
            return documentaryReply(init);
        },
    );
    const result = await f.t.action(internal.execution.operations.dispatch, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    expect(result.kind).toBe("success");
    expect(calls).toBe(1);
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "complete-controlled-material",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const completion = await f.t.mutation(
        internal.execution.invocations.finish,
        {
            invocationId: begun.invocationId,
            expectedGeneration: 4,
            response: {
                kind: "complete",
                needs: [{ needId: "common-context", unfinished: [] }],
            },
        },
    );
    expect(completion.kind).toBe("completed");
    await f.t.mutation(internal.sourcesMission.finish, {
        preparationId: f.preparationId,
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    const saved = await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        const taskId = preparation?.sourcesMission?.qualifications[0];
        assert(taskId);
        return {
            run: await ctx.db.get(f.runId),
            preparation,
            task: await ctx.db.get(taskId),
            receipts: await ctx.db
                .query("providerCalls")
                .withIndex("by_run", (q) => q.eq("runId", f.runId))
                .take(5),
        };
    });
    expect(saved.run).toMatchObject({
        lifecycleState: "sources_prepared",
        executionStatus: "idle",
    });
    expect(saved.preparation?.sourcesMission?.result).toMatchObject({
        outcome: "complete",
        documents: [expect.objectContaining({ captureId: f.captureId })],
    });
    expect(saved.task?.output).toMatchObject({
        kind: "documentary_qualification",
        contributions: [
            expect.objectContaining({
                statement: "The source describes workflow software.",
                evidence: [
                    {
                        captureId: f.captureId,
                        passageOrder: f.passage.order,
                        quotation: f.passage.quotation,
                    },
                ],
            }),
        ],
    });
    expect(saved.receipts).toEqual([
        expect.objectContaining({
            status: "succeeded",
            reportedCost: 0.00001,
            reportedCostFinal: true,
            reservedMaxOutputTokens: 8192,
        }),
    ]);
});

test.each([
    { windowMs: 15 * 60000, preparationWindowMs: 15 * 60000, succeeds: true },
    { windowMs: 30000, preparationWindowMs: 15 * 60000, succeeds: false },
])("a responsive documentary examination can continue beyond five minutes within its approved authority: $windowMs ms", async ({
    windowMs,
    preparationWindowMs,
    succeeds,
}) => {
    const f = await fixture();
    const deadlineAt = await f.t.run(async (ctx) => {
        const now = Date.now();
        const deadlineAt = now + windowMs;
        await ctx.db.patch(f.missionId, { deadlineAt });
        await ctx.db.patch(f.preparationId, {
            deadlineAt: now + preparationWindowMs,
        });
        await ctx.db.patch(f.requestId, { deadlineAt });
        return deadlineAt;
    });
    mockControlReply("context_only");
    const respond = globalThis.fetch;
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const deadlines: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
        deadlines.push(ms);
        return timeout(Math.max(1, Math.floor(ms / 100)));
    });
    let leaseMs: number | undefined;
    let leaseExpiresAt: number | undefined;
    vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
        const call = await f.t.run((ctx) =>
            ctx.db.query("providerCalls").first(),
        );
        leaseExpiresAt = call?.leaseExpiresAt;
        leaseMs =
            call?.leaseExpiresAt !== undefined
                ? call.leaseExpiresAt - call.createdAt
                : undefined;
        return new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(() => {
                void respond(url as RequestInfo, init).then(resolve, reject);
            }, 3500);
            init?.signal?.addEventListener(
                "abort",
                () => {
                    clearTimeout(timer);
                    reject(init.signal?.reason);
                },
                { once: true },
            );
        });
    });
    const result = await f.t.action(internal.execution.operations.dispatch, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    expect(result).toMatchObject({
        kind: succeeds ? "success" : "unavailable",
    });
    expect(deadlines.length).toBeGreaterThan(0);
    expect(deadlines.every((ms) => ms > 0 && ms <= windowMs)).toBe(true);
    expect(leaseMs).toBeGreaterThan(0);
    expect(leaseExpiresAt).toBe(deadlineAt + 10000);
    const retained = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(retained?.sourcesMission?.qualifications).toHaveLength(
        succeeds ? 1 : 0,
    );
});

test("the documentary provider lease cannot outlive remaining preparation authority plus its grace", async () => {
    const f = await fixture();
    const deadlineAt = await f.t.run(async (ctx) => {
        const deadlineAt = Date.now() + 30000;
        await ctx.db.patch(f.missionId, { deadlineAt });
        await ctx.db.patch(f.preparationId, { deadlineAt });
        await ctx.db.patch(f.requestId, { deadlineAt });
        return deadlineAt;
    });
    mockControlReply("context_only");
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: f.requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "success" });
    const call = await f.t.run((ctx) => ctx.db.query("providerCalls").first());
    expect(call?.leaseExpiresAt).toBe(deadlineAt + 10000);
});

async function fixture(kind: DocumentaryContribution["kind"] = "context") {
    const f = await seedCapturedSources();
    vi.stubEnv("OPENROUTER_API_KEY", "offline-only");
    await installModel(f.t, { model: "z-ai/glm-5.3-flash" }, "sources");
    await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        assert(mission);
        await pinMissionModel(ctx, mission);
    });
    await f.t.run((ctx) =>
        ctx.db.patch(f.preparationId, {
            executionPlanVersion: "source_actions_v4",
        }),
    );
    const input = {
        kind: "submit_documentary_qualification" as const,
        sourceId: f.sourceId,
        captureId: f.captureId,
        expectedTaskId: null,
        changes: [
            {
                contribution: {
                    needIds: ["common-context"],
                    statement: "The source describes workflow software.",
                    period: "undated",
                    modality: "description",
                    attribution: "Publisher",
                    kind,
                    evidence: [
                        {
                            readRequestId: f.readRequestId,
                            passageOrder: f.passage.order,
                        },
                    ],
                },
            },
        ],
    };
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "real-documentary-examiner",
            input,
        },
    );
    return { ...f, requestId, input };
}

function mockControlReply(permittedUse: "documentary" | "context_only") {
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            const wire = JSON.parse(String(init?.body));
            const input = JSON.parse(wire.messages.at(-1).content);
            return Response.json({
                id: "offline-permission-control",
                model: "z-ai/glm-5.3-flash",
                choices: [
                    {
                        index: 0,
                        message: {
                            role: "assistant",
                            content: JSON.stringify({
                                coherence: true,
                                limitations: ["Attributed context only."],
                                findings: Object.fromEntries(
                                    input.contributions.map(
                                        (c: { id: string }) => [
                                            c.id,
                                            {
                                                conclusion: "supported",
                                                permittedUse,
                                                diagnostic:
                                                    "The passage supports the reported statement.",
                                            },
                                        ],
                                    ),
                                ),
                            }),
                        },
                        finish_reason: "stop",
                    },
                ],
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 10,
                    total_tokens: 20,
                    cost: 0.00001,
                },
            });
        }),
    );
}

test.each([
    "attributed_argument",
    "forecast",
] as const)("an incompatible documentary permission for %s cannot become an admitted control", async (kind) => {
    const f = await fixture(kind);
    mockControlReply("documentary");
    const result = await f.t.action(internal.execution.operations.dispatch, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    expect(result).toMatchObject({
        kind: "unavailable",
        code: "documentary_control_unfinished",
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.qualifications,
    ).toEqual([]);
});

test("a successful submission returns its effective permitted use with the pinned contribution identity", async () => {
    const f = await fixture();
    mockControlReply("context_only");
    const result = await f.t.action(internal.execution.operations.dispatch, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    assert(result.kind === "success");
    const value: Infer<typeof documentarySubmissionValue> = JSON.parse(
        result.valueJson,
    );
    const task = await f.t.run((ctx) => ctx.db.get(value.taskId));
    assert(task?.output.kind === "documentary_qualification");
    expect(value.effectiveContributions).toEqual([
        {
            id: task.output.contributions[0]?.id,
            version: 1,
            permittedUse: "context_only",
            useStatus: "support_with_restrictions",
            diagnostic: "The passage supports the reported statement.",
        },
    ]);
});

test("a reused historical control cannot bypass the contribution-kind permission guard", async () => {
    const f = await fixture("attributed_argument");
    mockControlReply("context_only");
    const first = await f.t.action(internal.execution.operations.dispatch, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    assert(first.kind === "success");
    const { taskId }: Infer<typeof documentarySubmissionValue> = JSON.parse(
        first.valueJson,
    );
    const task = await f.t.run((ctx) => ctx.db.get(taskId));
    assert(task?.output.kind === "documentary_qualification");
    const qualification = task.output;
    const contribution = qualification.contributions[0];
    assert(contribution);
    await f.t.run(async (ctx) => {
        const control = await ctx.db.get(qualification.controlTaskId);
        assert(control?.output.kind === "documentary_control");
        await ctx.db.patch(control._id, {
            output: {
                ...control.output,
                control: {
                    ...control.output.control,
                    findings: control.output.control.findings.map(
                        (finding) => ({
                            ...finding,
                            permittedUse: "documentary" as const,
                        }),
                    ),
                },
            },
        });
    });
    const { id, version, evidence: _evidence, ...content } = contribution;
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "reused-historical-control",
            input: {
                kind: "submit_documentary_qualification",
                sourceId: f.sourceId,
                captureId: f.captureId,
                expectedTaskId: taskId,
                changes: [
                    {
                        contributionId: id,
                        expectedVersion: version,
                        contribution: {
                            ...content,
                            evidence: [
                                {
                                    readRequestId: f.readRequestId,
                                    passageOrder: f.passage.order,
                                },
                            ],
                        },
                    },
                ],
            },
        },
    );
    const result = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 4,
    });
    expect(result).toMatchObject({
        kind: "unavailable",
        code: "documentary_control_invalid",
        validation: {
            path: "control.findings[0].permittedUse",
            expected: expect.stringContaining("attributed_argument"),
        },
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.qualifications,
    ).toEqual([taskId]);
});

test("an unfinished real documentary examination reaches Sources with precise bounded feedback", async () => {
    const f = await fixture();
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
        calls++;
        return Response.json({
            id: `offline-${calls}`,
            model: "z-ai/glm-5.3-flash",
            choices: [
                {
                    index: 0,
                    message: {
                        role: "assistant",
                        content:
                            '{"coherence":true,"limitations":[],"findings":{}}',
                    },
                    finish_reason: "stop",
                },
            ],
            usage: {
                prompt_tokens: 10,
                completion_tokens: 10,
                total_tokens: 20,
                cost: 0.00001,
            },
        });
    });
    const result = await f.t.action(internal.execution.operations.dispatch, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    expect(result).toMatchObject({
        kind: "unavailable",
        code: "documentary_control_unfinished",
        validation: {
            path: "documentaryControl",
            expected:
                "A complete documentary examination matching the submitted contribution identities (schema_invalid).",
        },
    });
    expect(calls).toBe(2);
    const receipts = await f.t.run((ctx) =>
        ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .take(3),
    );
    const inputHash = receipts[0]?.inputHash;
    assert(inputHash);
    expect(
        await f.t.query(internal.providerCalls.nextPreparationAttemptForInput, {
            preparationId: f.preparationId,
            sourceId: f.sourceId,
            operation: "source_documentary_control",
            inputHash,
            now: Date.now(),
        }),
    ).toMatchObject({
        errorCode: "explicit_recovery_required",
        diagnosticReason: "schema_invalid",
    });
    const request = await f.t.run((ctx) => ctx.db.get(f.requestId));
    expect(request?.outcome).toEqual(result);
    const tasks = await f.t.run((ctx) =>
        ctx.db
            .query("aiTaskResults")
            .withIndex("by_run_and_task_type_and_input_hash", (q) =>
                q
                    .eq("runId", f.runId)
                    .eq("taskType", "documentary_qualification"),
            )
            .take(2),
    );
    expect(tasks).toEqual([]);
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "after-control-failure",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    expect(begun.inputJson).toContain("schema_invalid");
});

test("the native Sources continuation actually receives the unfinished examination feedback", async () => {
    const f = await fixture();
    vi.stubEnv("WORKBENCH_AGENT_ENABLED", "true");
    let nativeRequests = 0;
    vi.stubGlobal(
        "fetch",
        async (_url: unknown, init: RequestInit | undefined) => {
            const wire = JSON.parse(String(init?.body));
            if (wire.stream) {
                nativeRequests++;
                expect(JSON.stringify(wire.messages)).toContain(
                    "documentary_control_unfinished",
                );
                expect(JSON.stringify(wire.messages)).toContain(
                    "schema_invalid",
                );
                const content = JSON.stringify({
                    kind: "complete",
                    needs: [
                        {
                            needId: "common-context",
                            unfinished: [
                                "The documentary examination remains technically unfinished.",
                            ],
                        },
                    ],
                });
                return new Response(
                    `data: ${JSON.stringify({ id: "offline-native", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20, cost: 0.00001 } })}\n\ndata: [DONE]\n\n`,
                    { headers: { "content-type": "text/event-stream" } },
                );
            }
            return Response.json({
                id: "offline-invalid",
                model: "z-ai/glm-5.3-flash",
                choices: [
                    {
                        index: 0,
                        message: {
                            role: "assistant",
                            content:
                                '{"coherence":true,"limitations":[],"findings":{}}',
                        },
                        finish_reason: "stop",
                    },
                ],
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 10,
                    total_tokens: 20,
                    cost: 0.00001,
                },
            });
        },
    );
    await f.t.action(internal.execution.operations.dispatch, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    await f.t.action((ctx) =>
        runPiMission(
            ctx,
            { missionId: f.missionId, expectedGeneration: 4 },
            "offline-structured-continuation",
            nodeActionGenerationDeadline(Date.now()),
        ),
    );
    expect(nativeRequests).toBe(1);
    const saved = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(saved?.sourcesMission?.result).toMatchObject({
        outcome: "blocked",
        needs: [
            expect.objectContaining({
                unfinished: [
                    "The documentary examination remains technically unfinished.",
                ],
            }),
        ],
    });
});

test.each([
    { hasIdentity: true, cancelled: true },
    { hasIdentity: true, cancelled: false },
    { hasIdentity: true, cancelled: undefined },
    { hasIdentity: false, cancelled: undefined },
])("an interrupted documentary control retains its observations without replay or adoption: $hasIdentity / cancellation $cancelled", async ({
    hasIdentity,
    cancelled,
}) => {
    const f = await fixture();
    let dispatches = 0;
    let observedBeforeRead: unknown;
    let billingReads = 0;
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (url) => {
            if (
                String(url).startsWith(
                    "https://openrouter.ai/api/v1/generation?",
                )
            ) {
                billingReads++;
                return Response.json({
                    data: {
                        id: "documentary-generation",
                        total_cost: 0.0002137,
                        cancelled,
                    },
                });
            }
            dispatches++;
            return new Response(
                new ReadableStream(
                    {
                        async pull(controller) {
                            observedBeforeRead = await f.t.run((ctx) =>
                                ctx.db
                                    .query("providerCalls")
                                    .withIndex("by_run", (q) =>
                                        q.eq("runId", f.runId),
                                    )
                                    .first(),
                            );
                            controller.error(
                                new DOMException(
                                    "Documentary deadline elapsed token=fixture-private-token",
                                    "TimeoutError",
                                ),
                            );
                        },
                    },
                    { highWaterMark: 0 },
                ),
                {
                    headers: {
                        "content-type": "application/json",
                        ...(hasIdentity
                            ? { "x-generation-id": "documentary-generation" }
                            : {}),
                        "x-request-id": "documentary-request",
                    },
                },
            );
        }),
    );
    const result = await f.t.action(internal.execution.operations.dispatch, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    expect(result).toMatchObject({
        kind: "unavailable",
        code: "request_timeout",
    });
    expect(observedBeforeRead).toMatchObject({
        status: "started",
        providerObservation: {
            ...(hasIdentity ? { generationId: "documentary-generation" } : {}),
            requestId: "documentary-request",
            httpStatus: 200,
        },
    });
    const saved = await f.t.run(async (ctx) => ({
        calls: await ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .take(5),
        preparation: await ctx.db.get(f.preparationId),
    }));
    expect(saved.calls).toHaveLength(1);
    expect(saved.calls[0]).toMatchObject({
        status: "failed",
        dispatchOutcome: "response_received",
        errorCode: "request_timeout",
        transportDiagnostic: {
            phase: "provider_transport",
            name: "TimeoutError",
            message: "Documentary deadline elapsed token=[redacted]",
        },
    });
    const call = saved.calls[0];
    assert(call);
    expect(call.reportedCost).toBeUndefined();
    const contextId = await f.t.run(async (ctx) => {
        const contextId = await ctx.db.insert("browserTestContexts", {
            ownerVisitorId: f.visitorId,
            authUserId: f.userId,
            contextKey: "documentary-cancellation-accounting",
            status: "active",
            expiresAt: Date.now() + 60000,
            createdAt: Date.now(),
        });
        await initializeQualificationUsage(ctx, contextId, [f.runId]);
        const tracking = {
            qualificationContextId: contextId,
            costAccountingPolicy: "known_final_v1" as const,
            qualificationReservationUsd: 1,
        };
        await ctx.db.patch(call._id, tracking);
        await updateQualificationUsage(ctx, null, { ...call, ...tracking });
        return contextId;
    });
    expect(
        await f.t.run((ctx) => readQualificationUsage(ctx, contextId)),
    ).toMatchObject({ unknown: 1 });
    const beforeBudget = (await f.t.run((ctx) => ctx.db.get(f.runId)))
        ?.sourcePreparationBudget;
    assert(beforeBudget);
    if (hasIdentity) {
        expect(call.billing).toMatchObject({ state: "pending" });
        await f.t.action(internal.integrations.openRouterGeneration.reconcile, {
            providerCallId: call._id,
            attempt: 1,
        });
        expect(await f.t.run((ctx) => ctx.db.get(call._id))).toMatchObject({
            status: "failed",
            errorCode: "request_timeout",
            reportedCost: 0.0002137,
            billing: { state: "confirmed" },
        });
        expect(billingReads).toBe(1);
    } else {
        expect(call.billing).toBeUndefined();
        expect(billingReads).toBe(0);
    }
    const verified = hasIdentity && cancelled === true;
    const after = await f.t.run(async (ctx) => ({
        call: await ctx.db.get(call._id),
        run: await ctx.db.get(f.runId),
        preparation: await ctx.db.get(f.preparationId),
        lotUsage: await readQualificationUsage(ctx, contextId),
        runUsage: await readQualificationUsage(ctx, contextId, f.runId),
    }));
    expect(after.lotUsage).toMatchObject({
        unknown: verified ? 0 : 1,
        pending: 0,
        usage: { model: 1 },
    });
    expect(after.lotUsage?.usage.costUsd).toBeCloseTo(
        hasIdentity ? 0.0002137 : 1,
        12,
    );
    expect(after.runUsage).toMatchObject({ unknown: verified ? 0 : 1 });
    expect(after.run?.sourcePreparationBudget).toEqual({
        ...beforeBudget,
        reserved: beforeBudget.reserved - (verified ? 1 : 0),
        incidents: beforeBudget.incidents + (verified ? 1 : 0),
    });
    expect(after.call?.reportedCostFinal).not.toBe(true);
    expect(after.call).toMatchObject({
        status: "failed",
        errorCode: "request_timeout",
    });
    if (verified)
        expect(after.call?.providerObservation).toMatchObject({
            generationId: "documentary-generation",
            cancelled: true,
        });
    expect(after.preparation?.sourcesMission?.qualifications).toEqual([]);
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: f.requestId,
            expectedGeneration: 4,
        }),
    ).toEqual(result);
    if (hasIdentity)
        await f.t.action(internal.integrations.openRouterGeneration.reconcile, {
            providerCallId: call._id,
            attempt: 1,
        });
    expect(await f.t.run((ctx) => ctx.db.get(call._id))).toEqual(after.call);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.runId)))?.sourcePreparationBudget,
    ).toEqual(after.run?.sourcePreparationBudget);
    assert(call.inputHash);
    expect(
        await f.t.query(internal.providerCalls.nextPreparationAttemptForInput, {
            preparationId: f.preparationId,
            sourceId: f.sourceId,
            operation: "source_documentary_control",
            inputHash: call.inputHash,
            now: Date.now(),
        }),
    ).toMatchObject({
        errorCode: verified ? "request_timeout" : "attempt_outcome_unknown",
    });
    if (verified) {
        await f.t.mutation(internal.providerCalls.recordAttempt, {
            preparationId: call.preparationId,
            runId: call.runId,
            corpusRevisionId: call.corpusRevisionId,
            sourceId: call.sourceId,
            executionGeneration: call.executionGeneration,
            workflowVersion: call.workflowVersion,
            stepKey: call.stepKey,
            inputHash: call.inputHash,
            service: "model",
            operation: call.operation,
            operationKey: call.operationKey,
            attempt: call.attempt,
            status: "failed",
            dispatchOutcome: call.dispatchOutcome,
            errorCode: "request_timeout",
            reportedCost: 0.5,
        });
        const conflict = await f.t.run(async (ctx) => ({
            call: await ctx.db.get(call._id),
            run: await ctx.db.get(f.runId),
            usage: await readQualificationUsage(ctx, contextId),
        }));
        expect(conflict.call).toMatchObject({
            reportedCost: 0.0002137,
            billing: { state: "conflict", reason: "amount_conflict" },
        });
        expect(conflict.usage).toMatchObject({ unknown: 1 });
        expect(conflict.run?.sourcePreparationBudget).toEqual(beforeBudget);
    }
    expect(dispatches).toBe(1);
});

test("an oversized Sources submission returns the capacity field and its corrected proposal can be controlled", async () => {
    const f = await fixture();
    const input = f.input;
    const change = input.changes[0];
    assert(change);
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "oversized-documentary-submission",
            input: {
                ...input,
                changes: Array.from({ length: 16 }, () => change),
            },
        },
    );
    const refused = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 4,
    });
    expect(refused).toMatchObject({
        kind: "unavailable",
        code: "qualification_invalid",
        validation: {
            path: "changes",
            expected: expect.stringContaining("15"),
        },
    });
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("providerCalls")
                .withIndex("by_run", (q) => q.eq("runId", f.runId))
                .take(2),
        ),
    ).toEqual([]);
    mockControlReply("context_only");
    const correctedId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "corrected-documentary-submission",
            input: {
                ...input,
                changes: Array.from({ length: 15 }, () => change),
            },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: correctedId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "success" });
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(preparation?.sourcesMission?.qualifications).toHaveLength(1);
    const taskId = preparation?.sourcesMission?.qualifications[0];
    assert(taskId);
    const overflowId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "resulting-qualification-overflow",
            input: { ...input, expectedTaskId: taskId },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: overflowId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({
        kind: "unavailable",
        code: "qualification_capacity",
        validation: {
            path: "changes",
            expected: expect.stringContaining("15"),
        },
    });
    const retained = await f.t.run(async (ctx) => ({
        task: await ctx.db.get(taskId),
        preparation: await ctx.db.get(f.preparationId),
        calls: await ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .take(3),
    }));
    expect(retained.task?.output).toMatchObject({
        kind: "documentary_qualification",
        contributions: expect.arrayContaining([
            expect.objectContaining({
                statement: change.contribution.statement,
            }),
        ]),
    });
    assert(retained.task?.output.kind === "documentary_qualification");
    expect(retained.task.output.contributions).toHaveLength(15);
    expect(retained.preparation?.sourcesMission?.qualifications).toEqual([
        taskId,
    ]);
    expect(retained.calls).toHaveLength(1);
});
