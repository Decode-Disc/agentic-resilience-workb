import { internal } from "@convex/_generated/api";
import type {
    DocumentaryContribution,
    documentarySubmissionValue,
} from "@convex/domain/sourcesContracts";
import { runPiMission } from "@convex/integrations/piMission";
import { pinMissionModel } from "@convex/modelConfiguration";
import type { Infer } from "convex/values";
import { afterEach, assert, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test("a real documentary examination retains exact evidence through the Sources handoff", async () => {
    const f = await fixture();
    let calls = 0;
    vi.stubGlobal(
        "fetch",
        async (_url: unknown, init: RequestInit | undefined) => {
            calls++;
            const wire = JSON.parse(String(init?.body));
            const ids: string[] =
                wire.response_format.json_schema.schema.properties.findings
                    .required;
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
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "real-documentary-examiner",
            input: {
                kind: "submit_documentary_qualification",
                sourceId: f.sourceId,
                captureId: f.captureId,
                expectedTaskId: null,
                changes: [
                    {
                        contribution: {
                            needIds: ["common-context"],
                            statement:
                                "The source describes workflow software.",
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
            },
        },
    );
    return { ...f, requestId };
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
