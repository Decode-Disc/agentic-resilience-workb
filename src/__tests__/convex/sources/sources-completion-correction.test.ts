import "@convex/execution/agentCatalog";
import { internal } from "@convex/_generated/api";
import type { SourcesPreparation } from "@convex/domain/sourcesContracts";
import { MAX_OPERATION_RESULT_BYTES } from "@convex/resourcePolicy";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test("a completion using another definition's schema receives field feedback before fresh completion", async () => {
    const f = await seedCapturedSources();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "wrong-completion-schema",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const response = {
        kind: "complete" as const,
        text: "Finished.",
        workingNotes: "Refused notes must not survive.",
    };
    const refused = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        response,
    });
    expect(refused).toMatchObject({
        code: "completion_correction_required",
        correction: {
            code: "invalid_completion",
            issues: [
                expect.objectContaining({
                    path: expect.stringContaining("needs"),
                    expected: "array",
                }),
            ],
        },
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.missionId))).toMatchObject({
        status: "ready",
        workingNotes: "",
        noProgressTurns: 1,
    });
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: begun.invocationId,
            expectedGeneration: 4,
            response,
        }),
    ).toEqual(refused);
    const next = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "fresh-completion-schema",
        provenance: "simulation",
    });
    assert(next.kind === "ready");
    const context = JSON.parse(next.inputJson);
    expect(context.lastObservableInvocation.correction).toEqual(
        refused.correction,
    );
    const complete = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: next.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "complete",
            needs: context.activeWork.needs.map((need: { id: string }) => ({
                needId: need.id,
                unfinished: ["Not examined"],
            })),
        },
    });
    expect(complete.kind).toBe("completed");
    expect(
        await f.t.run((ctx) => ctx.db.get(begun.invocationId)),
    ).toMatchObject({
        outputJson: expect.any(String),
        correction: refused.correction,
    });
});

test.each([
    800, 1000,
])("an oversized need array receives bounded correction without rewriting its response: %s", async (rowCount) => {
    const f = await seedCapturedSources();
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "excess-need-feedback",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const response = {
        kind: "complete" as const,

        workingNotes: "These notes must not enter working memory.",
        needs: Array.from({ length: rowCount }, () => ({
            needId: "x",

            unfinished: [" "],
            gap: " ",
        })),
    };
    expect(
        new TextEncoder().encode(JSON.stringify(response)).byteLength,
    ).toBeLessThanOrEqual(MAX_OPERATION_RESULT_BYTES);
    const result = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        response,
    });
    expect(result).toMatchObject({
        kind: "blocked",
        code: "completion_correction_required",
    });
    assert("correction" in result && result.correction);
    expect(
        new TextEncoder().encode(JSON.stringify(result.correction)).byteLength,
    ).toBeLessThanOrEqual(MAX_OPERATION_RESULT_BYTES);
    const invocation = await f.t.run((ctx) => ctx.db.get(begun.invocationId));
    expect(JSON.parse(invocation?.outputJson ?? "null")).toEqual(response);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.workingNotes,
    ).toBe("");
});

test.each([
    1, 4,
])("Pi preserves every missing-need correction before adopting a valid completion after %i refusals", async (refusalCount) => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3212");
    const network = vi.fn(() => {
        throw new Error("Provider forbidden");
    });
    vi.stubGlobal("fetch", network);
    const f = await seedCapturedSources({
        modelResponse(input) {
            const { activeWork } = input as {
                activeWork: SourcesPreparation & { noProgressTurns: number };
            };
            return {
                kind: "complete",

                workingNotes: "Completion note.",
                needs:
                    activeWork.noProgressTurns < refusalCount
                        ? []
                        : activeWork.needs.map((n) => ({
                              needId: n.id,
                              unfinished: ["Not yet examined"],
                          })),
            };
        },
    });
    await f.t.run(async (ctx) => {
        const id = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Workflow", questions: [] },
            requestKey: "correction",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            fixedFramingRevisionId: id,
        });
        await ctx.db.patch(f.invitationId, { slotKey: "analyst-4" });
    });
    const contextId = await f.t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        { slotKey: "analyst-4", contextKey: "correction", durationMs: 120000 },
    );
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            purpose: "browser_test",
            browserTestContextId: contextId,
        }),
    );
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: 4,
        simulation: true,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const mission = await f.t.run((ctx) => ctx.db.get(f.missionId));
    assert(mission);
    const invocations = await f.t.run((ctx) =>
        ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
            .collect(),
    );
    expect(mission).toMatchObject({
        status: "completed",
        workingNotes: "Completion note.",
    });
    expect(mission.blockCode).toBeUndefined();
    expect(invocations).toHaveLength(refusalCount + 1);
    assert(invocations[0]);
    expect(invocations[0].outputJson).toContain('"needs":[]');
    const correctiveInputs = await f.t.run(async (ctx) =>
        Promise.all(
            invocations.slice(1).map(async (invocation, index) => {
                const previous = invocations[index];
                assert(previous);
                const reply = await ctx.db
                    .query("agentInvocationPayloads")
                    .withIndex("by_invocation_and_part", (q) =>
                        q.eq("invocationId", previous._id).eq("part", "reply"),
                    )
                    .unique();
                const request = await ctx.db
                    .query("agentInvocationPayloads")
                    .withIndex("by_invocation_and_part", (q) =>
                        q
                            .eq("invocationId", invocation._id)
                            .eq("part", "request"),
                    )
                    .unique();
                assert(reply?.state === "complete" && reply.json);
                assert(request?.state === "complete" && request.json);
                return {
                    replyJson: reply.json,
                    requestJson: request.json,
                    correction: previous.correction,
                };
            }),
        ),
    );
    for (const { replyJson, requestJson, correction } of correctiveInputs) {
        const reply = JSON.parse(replyJson);
        const request = JSON.parse(requestJson);
        const texts: string[] = request.messages.flatMap(
            (message: {
                content: string | { type: string; text?: string }[];
                sections?: Record<string, string | null>;
            }) => [
                ...(typeof message.content === "string"
                    ? [message.content]
                    : message.content.flatMap((part) =>
                          part.type === "text" && typeof part.text === "string"
                              ? [part.text]
                              : [],
                      )),
                ...Object.values(message.sections ?? {}).filter(
                    (value): value is string => value !== null,
                ),
            ],
        );
        for (const part of reply.content) {
            if (part.type === "text") expect(texts).toContain(part.text);
        }
        assert(correction);
        expect(
            texts.some((text) => text.includes(JSON.stringify(correction))),
        ).toBe(true);
        expect(
            texts.some((text) => text.includes('"id":"common-context"')),
        ).toBe(true);
    }
    const requests = await f.t.run((ctx) =>
        ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
            .take(3),
    );
    expect(requests.map((request) => request._id)).toEqual([f.readRequestId]);
    expect(network).not.toHaveBeenCalled();
});

test("Sources v8 native_tool completion allows >3 refused proposals within authority, handles mission_context_changed, and settles cleanly", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const { installModel } = await import(
        "@/__tests__/setup/model-configuration"
    );
    const { nativePiFixtureRoute } = await import(
        "@/__tests__/setup/pi-native"
    );
    const f = await seedCapturedSources();
    await installModel(f.t, nativePiFixtureRoute, "sources");
    await f.t.run((ctx) => ctx.db.patch(f.missionId, { definitionVersion: 8 }));
    const initialContext = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    assert(initialContext.kind === "ready");
    const parsedInitial = JSON.parse(initialContext.inputJson);
    expect(parsedInitial.constraints.completion).toEqual({
        format: "tool",
        tool: "submit_completion",
    });
    const needs = parsedInitial.activeWork.needs as { id: string }[];
    assert(needs.length >= 1);

    let turn = 0;
    const network = vi.fn(async () => {
        turn++;
        // Turns 1..4: domain-refused completion proposals (missing needs -> 4 refusals > 3).
        if (turn <= 4) {
            return new Response(
                [
                    `data: ${JSON.stringify({
                        id: `src-v8-refuse-${turn}`,
                        choices: [
                            {
                                index: 0,
                                delta: {
                                    role: "assistant",
                                    tool_calls: [
                                        {
                                            index: 0,
                                            id: `src_refuse_${turn}`,
                                            type: "function",
                                            function: {
                                                name: "submit_completion",
                                                arguments: JSON.stringify({
                                                    kind: "complete",
                                                    needs: [],
                                                }),
                                            },
                                        },
                                    ],
                                },
                                finish_reason: null,
                            },
                        ],
                    })}`,
                    `data: ${JSON.stringify({
                        id: `src-v8-refuse-${turn}`,
                        choices: [
                            {
                                index: 0,
                                delta: {},
                                finish_reason: "tool_calls",
                            },
                        ],
                        usage: { prompt_tokens: 10, completion_tokens: 5 },
                    })}`,
                    "data: [DONE]",
                    "",
                ].join("\n\n"),
                { headers: { "content-type": "text/event-stream" } },
            );
        }
        // Turn 5: valid sole completion covering all current needs.
        if (turn === 5) {
            // A queued consultation does not change the engaged documentary work.
            await f.t.mutation(internal.execution.operations.enqueue, {
                missionId: f.missionId,
                expectedGeneration: 4,
                cause: "late-engaged-read",
                input: {
                    kind: "consult_mission_state",
                },
            });
        }
        return new Response(
            [
                `data: ${JSON.stringify({
                    id: `src-v8-valid-${turn}`,
                    choices: [
                        {
                            index: 0,
                            delta: {
                                role: "assistant",
                                tool_calls: [
                                    {
                                        index: 0,
                                        id: `src_valid_${turn}`,
                                        type: "function",
                                        function: {
                                            name: "submit_completion",
                                            arguments: JSON.stringify({
                                                kind: "complete",
                                                needs: needs.map((need) => ({
                                                    needId: need.id,
                                                    unfinished: [
                                                        "Not yet examined",
                                                    ],
                                                })),
                                            }),
                                        },
                                    },
                                ],
                            },
                            finish_reason: null,
                        },
                    ],
                })}`,
                `data: ${JSON.stringify({
                    id: `src-v8-valid-${turn}`,
                    choices: [
                        { index: 0, delta: {}, finish_reason: "tool_calls" },
                    ],
                    usage: { prompt_tokens: 10, completion_tokens: 5 },
                })}`,
                "data: [DONE]",
                "",
            ].join("\n\n"),
            { headers: { "content-type": "text/event-stream" } },
        );
    });
    vi.stubGlobal("fetch", network);
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: 4,
        simulation: false,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(100),
        1000,
    );
    // The consultation does not prevent the valid completion from being adopted.
    expect(network).toHaveBeenCalledTimes(5);
    const after = await f.t.run(async (ctx) => ({
        mission: await ctx.db.get(f.missionId),
        session: await ctx.db
            .query("piSessions")
            .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
            .unique(),
        invocations: await ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
            .collect(),
        calls: await ctx.db.query("providerCalls").collect(),
    }));
    expect(after.mission?.status).toBe("completed");
    expect(after.session?.settledSequence).toBe(after.session?.sequence);
    expect(after.calls).toHaveLength(5);
    expect(after.calls.every((call) => call.status === "succeeded")).toBe(true);
    expect(
        after.invocations.filter(
            (inv) => inv.blockCode === "completion_correction_required",
        ),
    ).toHaveLength(4);
}, 30000);

test("invalid long need identifiers receive a bounded actionable summary", async () => {
    const f = await seedCapturedSources();
    const { completeSources } = await import("@convex/domain/sources");
    const { ConvexError } = await import("convex/values");
    const response = {
        kind: "complete" as const,
        needsRevision: 1,
        needs: Array.from({ length: 1 }, (_, i) => ({
            needId: `${i}:${"x".repeat(60000)}`,
            unfinished: ["Not examined"],
            workRequestIds: [],
        })),
    };
    const error = await f.t
        .run((ctx) => completeSources(ctx, f.preparationId, response))
        .catch((error) => error);
    expect(error).toBeInstanceOf(ConvexError);
    const summary = error.data.issues.find(
        (issue: { path: string; expected: string }) =>
            issue.path === "needs" &&
            issue.expected.startsWith("Outcome indexes"),
    );
    expect(summary).toBeDefined();
    expect(
        new TextEncoder().encode(summary.expected).length,
    ).toBeLessThanOrEqual(2048);
});

test("native completion refuses feedback that only fits before its tool wrapper", async () => {
    const f = await seedCapturedSources();
    const count = 1480;
    // A nondefault admitted envelope exercises feedback capacity independently of normal preparation size.
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        await ctx.db.patch(preparation._id, {
            sourcesMission: {
                ...preparation.sourcesMission,
                envelope: {
                    ...preparation.sourcesMission.envelope,
                    maxNeeds: count,
                },
            },
        });
        await ctx.db.patch(f.missionId, { definitionVersion: 8 });
    });
    const needs = Array.from({ length: count }, () => ({
        needId: "",
        unfinished: [],
    }));
    const { completeSources } = await import("@convex/domain/sources");
    const diagnostic: unknown = await f.t
        .run((ctx) =>
            completeSources(ctx, f.preparationId, {
                kind: "complete",
                needsRevision: 1,
                needs: needs.map((need) => ({ ...need, workRequestIds: [] })),
            }),
        )
        .catch((error: unknown) => error);
    const { ConvexError } = await import("convex/values");
    const { validate } = await import("convex-helpers/validators");
    const { completionFeedbackValidator } = await import(
        "@convex/execution/operationContracts"
    );
    assert(diagnostic instanceof ConvexError);
    const feedback: unknown = diagnostic.data;
    assert(validate(completionFeedbackValidator, feedback));
    expect(
        new TextEncoder().encode(JSON.stringify(feedback)).length,
    ).toBeLessThanOrEqual(MAX_OPERATION_RESULT_BYTES);
    const { renderCompletionToolRefusal } = await import(
        "@convex/execution/agentDefinition"
    );
    expect(() =>
        renderCompletionToolRefusal("completion_correction_required", feedback),
    ).toThrow("operation_result_capacity");
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "refusal-wrapper-capacity",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const response = {
        kind: "complete" as const,
        needs,
        workingNotes: "Refused notes must not survive.",
    };
    expect(
        new TextEncoder().encode(JSON.stringify(response)).length,
    ).toBeLessThanOrEqual(65536);
    const result = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        response,
    });
    expect(result).toMatchObject({ code: "operation_result_capacity" });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.workingNotes,
    ).toBe("");
});
