import { startSourcesOperation } from "@/__tests__/setup/sources-mission";
import "@convex/execution/agentCatalog";
import { internal } from "@convex/_generated/api";
import { completeSources } from "@convex/domain/sources";
import { sourcesV5Definition } from "@convex/domain/sourcesAgent";
import type { SourcesPreparation } from "@convex/domain/sourcesContracts";
import { afterEach, assert, expect, test, vi } from "vitest";
import { seedObservedSources } from "@/__tests__/setup/sources-mission";

afterEach(() => {
    delete sourcesV5Definition.simulate;
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

async function claimNativeCheck(
    f: Awaited<ReturnType<typeof seedObservedSources>>,
    proposition = "Activity context",
) {
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "late-completion-work",
            input: {
                kind: "request_documentary_check",
                needId: "common-context",
                sourceId: f.sourceId,
                proposition,
                evidence: [
                    {
                        readRequestId: f.nativeReadRequestId,
                        passageOrder: f.passage.order,
                    },
                ],
            },
        },
    );
    expect(
        await startSourcesOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "outcome", outcome: { kind: "waiting" } });
    return requestId;
}

test("Pi refreshes a retained completion after late reservation and completes with exact work accounting", async () => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3212");
    const network = vi.fn(() => {
        throw new Error("Unexpected provider call");
    });
    vi.stubGlobal("fetch", network);
    const f = await seedObservedSources();
    await f.t.run(async (ctx) => {
        const framingId = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Workflow", questions: [] },
            requestKey: "completion-freshness",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            fixedFramingRevisionId: framingId,
        });
        await ctx.db.patch(f.invitationId, { slotKey: "analyst-4" });
    });
    const contextId = await f.t.mutation(
        internal.runWorkspace.openBrowserTestContext,
        {
            slotKey: "analyst-4",
            contextKey: "sources-completion-freshness",
            durationMs: 120000,
        },
    );
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            purpose: "browser_test",
            browserTestContextId: contextId,
        }),
    );
    const requestId = await claimNativeCheck(f);
    sourcesV5Definition.simulate = (input: unknown) => {
        const { activeWork } = input as { activeWork: SourcesPreparation };
        return {
            kind: "complete",

            needs: [
                {
                    needId: "common-context",

                    unfinished: ["Documentary checking remains unfinished."],
                },
            ],
            workingNotes: activeWork.work.length
                ? "Updated completion note."
                : "Initial completion note.",
        };
    };
    await f.t.mutation(internal.execution.missions.resume, {
        missionId: f.missionId,
        expectedGeneration: 4,
        simulation: true,
    });
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const pending = await f.t.run((ctx) => ctx.db.get(f.missionId));
    assert(pending?.lastInvocationId && pending.piWakeAt !== undefined);
    const firstId = pending.lastInvocationId;
    const first = await f.t.run((ctx) => ctx.db.get(firstId));
    expect(first?.blockCode).toBe("pending_operations");
    assert(first);
    expect(JSON.parse(first.inputJson).activeWork.work).toEqual([]);
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("agentInvocations")
                .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
                .take(10),
        ),
    ).toHaveLength(1);
    await f.t.mutation(internal.sourcesMission.reserve, {
        requestId,
        expectedGeneration: 4,
    });
    await f.t.mutation(internal.execution.operations.recordResult, {
        requestId,
        expectedGeneration: 4,
        outcome: { kind: "unavailable", code: "missing_configuration" },
    });
    vi.advanceTimersByTime(Math.max(0, pending.piWakeAt - Date.now()));
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const completed = await f.t.run((ctx) => ctx.db.get(f.missionId));
    expect(completed).toMatchObject({ status: "completed" });
    expect(completed?.lastInvocationId).not.toBe(firstId);
    assert(completed?.lastInvocationId);
    const refreshedId = completed.lastInvocationId;
    const refreshed = await f.t.run((ctx) => ctx.db.get(refreshedId));
    assert(refreshed);
    expect(JSON.parse(refreshed.inputJson).activeWork.work).toMatchObject([
        { requestId },
    ]);
    expect(
        await f.t.run((ctx) =>
            ctx.db
                .query("agentInvocations")
                .withIndex("by_mission", (q) => q.eq("missionId", f.missionId))
                .take(10),
        ),
    ).toHaveLength(2);
    const retained = await f.t.run((ctx) => ctx.db.get(firstId));
    expect(retained?.receivedOutputJson).toBe(first?.receivedOutputJson);
    expect(retained?.outputJson).toBe(first?.outputJson);
    expect(retained?.blockCode).toBe("mission_context_changed");
    expect(
        completed?.workingNotes?.split("Initial completion note."),
    ).toHaveLength(2);
    expect(
        completed?.workingNotes?.split("Updated completion note."),
    ).toHaveLength(2);
    await f.t.mutation(internal.sourcesMission.finish, {
        preparationId: f.preparationId,
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(preparation?.sourcesMission).toMatchObject({
        controls: 1,
        result: {
            outcome: "blocked",
            needs: [{ workRequestIds: [requestId] }],
        },
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        lifecycleState: "sources_prepared",
        executionStatus: "idle",
    });
    expect(network).not.toHaveBeenCalled();
});

test.each([
    "omitted",
    "duplicated",
    "omitted-with-late",
    "duplicated-with-late",
] as const)("direct handoff rejects %s work already present in its admitted context", async (mode) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = await seedObservedSources();
    const requestId = await claimNativeCheck(f);
    await f.t.mutation(internal.sourcesMission.reserve, {
        requestId,
        expectedGeneration: 4,
    });
    await f.t.mutation(internal.execution.operations.recordResult, {
        requestId,
        expectedGeneration: 4,
        outcome: { kind: "unavailable", code: "missing_configuration" },
    });
    const invocation = await f.t.mutation(
        internal.execution.invocations.begin,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            taskKey: "known-work-accounting",
            provenance: "simulation",
        },
    );
    assert(invocation.kind === "ready");
    expect(JSON.parse(invocation.inputJson).activeWork.work).toMatchObject([
        { requestId },
    ]);
    if (mode.endsWith("with-late")) {
        const lateRequest = await claimNativeCheck(
            f,
            "Additional activity context",
        );
        await f.t.mutation(internal.sourcesMission.reserve, {
            requestId: lateRequest,
            expectedGeneration: 4,
        });
        await f.t.mutation(internal.execution.operations.recordResult, {
            requestId: lateRequest,
            expectedGeneration: 4,
            outcome: { kind: "unavailable", code: "missing_configuration" },
        });
    }
    await expect(
        f.t.run((ctx) =>
            completeSources(ctx, f.preparationId, {
                kind: "complete",
                needsRevision: 1,
                needs: [
                    {
                        needId: "common-context",
                        workRequestIds: mode.startsWith("duplicated")
                            ? [requestId, requestId]
                            : [],
                        unfinished: [
                            "Documentary checking remains unfinished.",
                        ],
                    },
                ],
            }),
        ),
    ).rejects.toThrow("sources_work_unaccounted");
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.result,
    ).toBeUndefined();
});

test("Sources v8 native_tool completion refuses stale work accounting with mission_context_changed via tool result and completes on refreshed state", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const { installModel } = await import(
        "@/__tests__/setup/model-configuration"
    );
    const { nativePiFixtureRoute } = await import(
        "@/__tests__/setup/pi-native"
    );
    const f = await seedObservedSources();
    await installModel(f.t, nativePiFixtureRoute, "sources");
    await f.t.run((ctx) => ctx.db.patch(f.missionId, { definitionVersion: 8 }));
    let turn = 0;
    const seenToolResults: string[] = [];
    const network = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}"));
            for (const msg of body.messages ?? [])
                if (msg.role === "tool" && typeof msg.content === "string")
                    seenToolResults.push(msg.content);
            turn++;
            if (turn === 1) {
                // Engage and settle new native check work AFTER turn 1's context was admitted -> mission_context_changed.
                const lateRequest = await claimNativeCheck(
                    f,
                    "Late activity check",
                );
                await f.t.mutation(internal.sourcesMission.reserve, {
                    requestId: lateRequest,
                    expectedGeneration: 4,
                });
                await f.t.mutation(internal.execution.operations.recordResult, {
                    requestId: lateRequest,
                    expectedGeneration: 4,
                    outcome: {
                        kind: "unavailable",
                        code: "missing_configuration",
                    },
                });
            }
            return new Response(
                [
                    `data: ${JSON.stringify({
                        id: `src-v8-fresh-${turn}`,
                        choices: [
                            {
                                index: 0,
                                delta: {
                                    role: "assistant",
                                    tool_calls: [
                                        {
                                            index: 0,
                                            id: `fresh_call_${turn}`,
                                            type: "function",
                                            function: {
                                                name: "submit_completion",
                                                arguments: JSON.stringify({
                                                    kind: "complete",
                                                    needs: [
                                                        {
                                                            needId: "common-context",
                                                            unfinished: [
                                                                "Documentary checking remains unfinished.",
                                                            ],
                                                        },
                                                    ],
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
                        id: `src-v8-fresh-${turn}`,
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
        },
    );
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
    expect(network).toHaveBeenCalledTimes(2);
    expect(
        seenToolResults.some((text) =>
            text.includes('"code":"mission_context_changed"'),
        ),
    ).toBe(true);
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
    }));
    expect(after.mission?.status).toBe("completed");
    expect(after.session?.settledSequence).toBe(after.session?.sequence);
    expect(after.invocations[0]?.blockCode).toBe("mission_context_changed");
    expect(after.invocations[1]?.blockCode).toBeUndefined();
}, 30000);
