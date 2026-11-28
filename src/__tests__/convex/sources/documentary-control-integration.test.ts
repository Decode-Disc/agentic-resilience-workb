import { api, internal } from "@convex/_generated/api";
import type { ActionCtx } from "@convex/_generated/server";
import { documentaryReference } from "@convex/domain/savedMaterialOperations";
import { readPreparedNeed } from "@convex/domain/sources";
import type {
    DocumentaryContribution,
    DocumentaryControlV2,
    documentarySubmissionValue,
} from "@convex/domain/sourcesContracts";
import { runPiMission } from "@convex/integrations/piMission";
import { pinMissionModel } from "@convex/modelConfiguration";
import {
    initializeQualificationUsage,
    readQualificationUsage,
    updateQualificationUsage,
} from "@convex/qualificationUsage";
import {
    nodeActionGenerationDeadline,
    RESOURCE_POLICY_VERSION,
    SOURCES_QUALIFICATION_RESEARCH_WINDOW_MS,
} from "@convex/resourcePolicy";
import { getFunctionName } from "convex/server";
import type { Infer } from "convex/values";
import { afterEach, assert, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import {
    documentaryReply,
    providerFixtureResponse,
    scopedFixtureControl,
} from "@/__tests__/setup/model-stream";
import {
    beginFixtureInvocation,
    claimFixturePiLease,
    dispatchFixtureOperation,
    recordFixtureAttempt,
} from "@/__tests__/setup/pi-mission";
import { readRetainedBody } from "@/__tests__/setup/retained-history";
import {
    dispatchSourcesOperation,
    seedCapturedSources,
} from "@/__tests__/setup/sources-mission";

vi.mock("node:dns/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:dns/promises")>();
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    return { ...actual, default: { ...actual, lookup }, lookup };
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test("Sources returns a durable wait before documentary I/O and retains its eventual result", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
        entered();
        await gate;
        return documentaryReply(init);
    });
    const dispatch = dispatchFixtureOperation(f.t, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    let worker: Promise<unknown> | undefined;
    try {
        const first = await Promise.race([
            dispatch,
            started.then(() => ({ kind: "synchronous_io" })),
        ]);
        expect(first.kind).toBe("waiting");
        expect(await f.t.run((ctx) => ctx.db.get(f.requestId))).toMatchObject({
            status: "waiting",
            waitReference: expect.any(String),
            scheduledExecution: expect.objectContaining({
                phase: "queued",
                jobId: expect.any(String),
            }),
        });
        worker = f.t.action(internal.sourcesMissionActions.execute, {
            epoch: 1,
            requestId: f.requestId,
            expectedGeneration: 4,
        });
        await started;
        expect(
            await f.t.action(internal.sourcesMissionActions.execute, {
                epoch: 1,
                requestId: f.requestId,
                expectedGeneration: 4,
            }),
        ).toBeNull();
    } finally {
        release();
        await dispatch;
        await worker;
    }
    const result = await dispatchFixtureOperation(f.t, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    expect(result).toMatchObject({ kind: "success" });
    expect(await f.t.run((ctx) => ctx.db.get(f.requestId))).toMatchObject({
        status: "completed",
        outcome: { kind: "success" },
    });
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(preparation?.sourcesMission?.qualifications).toHaveLength(1);
    expect(preparation?.sourcesMission?.work).toHaveLength(1);
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toHaveLength(1);
});

test("an interrupted structured stream keeps its visible prefix without adopting it", async () => {
    const f = await fixture();
    const prefix = '{"coherence":true,';
    vi.stubGlobal("fetch", async () => {
        let pulled = false;
        return new Response(
            new ReadableStream(
                {
                    pull(controller) {
                        if (pulled) {
                            controller.error(
                                new DOMException(
                                    "interrupted stream",
                                    "TimeoutError",
                                ),
                            );
                            return;
                        }
                        pulled = true;
                        controller.enqueue(
                            new TextEncoder().encode(
                                `data: ${JSON.stringify({ id: "partial-control", choices: [{ index: 0, delta: { content: prefix } }] })}\n\n`,
                            ),
                        );
                    },
                },
                { highWaterMark: 0 },
            ),
            {
                headers: {
                    "content-type": "text/event-stream",
                    "x-generation-id": "partial-control",
                },
            },
        );
    });
    await dispatchSourcesOperation(f.t, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    const invocation = await f.t.run((ctx) =>
        ctx.db
            .query("agentInvocations")
            .withIndex("by_mission", (q) => q.eq("missionId", undefined))
            .first(),
    );
    expect(invocation).toHaveProperty("visibleOutput.textId");
    const visible = invocation?.visibleOutput;
    assert(visible);
    expect(visible.complete).toBe(false);
    expect(await readRetainedBody(f.t, visible.textId)).toBe(prefix);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.qualifications,
    ).toEqual([]);
});

test("a scheduled Sources wait blocks another effect while saved-material reads remain available", async () => {
    const f = await fixture();
    const args = { requestId: f.requestId, expectedGeneration: 4 };
    const waiting = await dispatchFixtureOperation(f.t, args);
    expect(waiting.kind).toBe("waiting");
    expect(await dispatchFixtureOperation(f.t, args)).toEqual(waiting);
    const next = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 4,
        cause: "second-effect",
        input: {
            kind: "discover_sources_for_need",
            needId: "common-context",
            query: "Additional evidence",
        },
    });
    expect(
        await dispatchFixtureOperation(f.t, {
            requestId: next,
            expectedGeneration: 4,
        }),
    ).toEqual({ kind: "unavailable", code: "operation_in_progress" });
    const read = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 4,
        cause: "read-while-waiting",
        input: { kind: "consult_mission_state" },
    });
    expect(
        await dispatchFixtureOperation(f.t, {
            requestId: read,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "success" });
    expect(await f.t.run((ctx) => ctx.db.get(next))).toMatchObject({
        status: "pending",
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.preparationId))).toMatchObject({
        sourcesMission: { work: [] },
    });
});

test("a revision refusal before worker start settles waiting work and permits the next effect", async () => {
    const f = await fixture();
    const args = { requestId: f.requestId, expectedGeneration: 4 };
    await dispatchFixtureOperation(f.t, args);
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                needsRevision: preparation.sourcesMission.needsRevision + 1,
            },
        });
    });
    expect(
        await f.t.action(internal.sourcesMissionActions.execute, {
            ...args,
            epoch: 1,
        }),
    ).toMatchObject({ kind: "refused", code: "version_conflict" });
    expect((await f.t.run((ctx) => ctx.db.get(f.requestId)))?.status).toBe(
        "completed",
    );
    const next = await f.t.mutation(internal.execution.operations.enqueue, {
        missionId: f.missionId,
        expectedGeneration: 4,
        cause: "after-refused-start",
        input: {
            kind: "discover_sources_for_need",
            needId: "common-context",
            query: "New evidence",
        },
    });
    expect(
        await dispatchFixtureOperation(f.t, {
            requestId: next,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "waiting" });
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});

test("an inline retained request cannot masquerade as an owned scheduled epoch", async () => {
    const f = await fixture();
    await f.t.run((ctx) => ctx.db.patch(f.requestId, { status: "running" }));
    mockControlReply("context_only");
    expect(
        await f.t.action(internal.sourcesMissionActions.execute, {
            requestId: f.requestId,
            expectedGeneration: 4,
            epoch: 1,
        }),
    ).toBeNull();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.qualifications,
    ).toEqual([]);
});

test("a queued Sources job cannot start under a changed generation", async () => {
    const f = await fixture();
    const args = { requestId: f.requestId, expectedGeneration: 4 };
    await dispatchFixtureOperation(f.t, args);
    await f.t.run((ctx) => ctx.db.patch(f.runId, { executionGeneration: 5 }));
    expect(
        await f.t.action(internal.sourcesMissionActions.execute, {
            ...args,
            epoch: 1,
        }),
    ).toMatchObject({ kind: "refused", code: "stale_execution" });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.requestId)))?.scheduledExecution
            ?.phase === "running",
    ).toBe(false);
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
    expect(await f.t.run((ctx) => ctx.db.get(f.preparationId))).toMatchObject({
        sourcesMission: { work: [] },
    });
});

test("cancellation cancels a queued Sources job before any work starts", async () => {
    const f = await fixture();
    const args = { requestId: f.requestId, expectedGeneration: 4 };
    await dispatchFixtureOperation(f.t, args);
    const request = await f.t.run((ctx) => ctx.db.get(f.requestId));
    const scheduledJobId =
        request?.scheduledExecution?.phase === "queued"
            ? request.scheduledExecution.jobId
            : undefined;
    assert(scheduledJobId);
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            executionStatus: "cancelled",
            executionGeneration: 5,
        }),
    );
    await f.t.mutation(
        internal.execution.cancellation.continueRunCancellation,
        { runId: f.runId, cancelledAt: Date.now(), cancelledGeneration: 4 },
    );
    const job = await f.t.run((ctx) => ctx.db.system.get(scheduledJobId));
    expect(job?.state.kind).toBe("canceled");
    expect(
        await f.t.action(internal.sourcesMissionActions.execute, {
            ...args,
            epoch: 1,
        }),
    ).toBeNull();
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
    expect(await f.t.run((ctx) => ctx.db.get(f.preparationId))).toMatchObject({
        sourcesMission: { work: [] },
    });
});

test("rebinding result adoption cannot start an old scheduled job in a new generation", async () => {
    const f = await fixture();
    await dispatchFixtureOperation(f.t, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, { executionGeneration: 5 });
        await ctx.db.patch(f.missionId, { generation: 5 });
        await ctx.db.patch(f.preparationId, { executionGeneration: 5 });
        await ctx.db.patch(f.requestId, { adoptionGeneration: 5 });
    });
    expect(
        await f.t.mutation(
            internal.execution.operations.beginScheduledExecution,
            { epoch: 1, requestId: f.requestId, expectedGeneration: 5 },
        ),
    ).toBe(false);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.requestId)))?.scheduledExecution
            ?.phase,
    ).toBe("queued");
});

test.each([
    "discovery",
    "acquisition",
    "check",
] as const)("Sources %s records its result through the scheduled worker", async (family) => {
    const f = await fixture();
    vi.stubEnv("EXA_API_KEY", "offline-only");
    const source = await f.t.run((ctx) => ctx.db.get(f.sourceId));
    assert(source);
    vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) =>
        String(url).includes("openrouter")
            ? documentaryReply(init)
            : providerFixtureResponse({
                  results:
                      family === "acquisition"
                          ? [
                                {
                                    id: source.canonicalUrl,
                                    url: source.canonicalUrl,
                                    title: "Workflow documentation",
                                    text: "Workflow software supports enterprise teams and their operational processes.",
                                },
                            ]
                          : [],
                  searchTime: 1,
                  costDollars: { total: 0.01 },
              }),
    );
    const input =
        family === "discovery"
            ? {
                  kind: "discover_sources_for_need" as const,
                  needId: "common-context",
                  query: "Additional evidence",
              }
            : family === "acquisition"
              ? {
                    kind: "make_source_consultable" as const,
                    needId: "common-context",
                    sourceId: f.sourceId,
                }
              : {
                    kind: "request_documentary_check" as const,
                    needId: "common-context",
                    sourceId: f.sourceId,
                    proposition: "The source describes workflow software.",
                    evidence: [
                        {
                            readRequestId: f.readRequestId,
                            passageOrder: f.passage.order,
                        },
                    ],
                };
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: `scheduled-${family}`,
            input,
        },
    );
    const args = { requestId, expectedGeneration: 4 };
    expect(await dispatchFixtureOperation(f.t, args)).toMatchObject({
        kind: "waiting",
    });
    const outcome = await f.t.action(internal.sourcesMissionActions.execute, {
        ...args,
        epoch: 1,
    });
    expect(outcome).toMatchObject({ kind: "success" });
    expect(
        await f.t.action(internal.sourcesMissionActions.execute, {
            ...args,
            epoch: 1,
        }),
    ).toBeNull();
    expect(await dispatchFixtureOperation(f.t, args)).toMatchObject({
        kind: "success",
    });
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        status: "completed",
        scheduledExecution: expect.objectContaining({ phase: "finished" }),
        outcome: { kind: "success" },
    });
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(preparation?.sourcesMission?.work).toHaveLength(1);
    expect(preparation?.sourcesMission?.work[0]?.requestId).toBe(requestId);
    if (family === "discovery")
        expect(preparation?.sourcesMission?.searches).toBe(1);
    if (family === "check") {
        expect(preparation?.sourcesMission?.controls).toBe(1);
        assert(outcome?.kind === "success");
        expect(JSON.parse(outcome.valueJson)).toMatchObject({
            needOrder: ["common-context"],
            effectiveContributions: [
                {
                    id: "target",
                    version: 1,
                    permittedUse: "context_only",
                    usesByNeed: ["context_only"],
                },
            ],
        });
        expect(preparation?.sourcesMission?.qualifications).toEqual([]);
    }
    if (family === "acquisition") {
        assert(outcome?.kind === "success");
        expect(preparation?.sourcesMission?.captureIds).toContain(
            JSON.parse(outcome.valueJson).captureId,
        );
    }
});

test("a transaction rollback cannot leave a scheduled Sources job or waiting request behind", async () => {
    const f = await fixture();
    const piLease = await claimFixturePiLease(f.t, f.missionId, 4);
    const before = await f.t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
    );
    await expect(
        f.t.run(async (ctx) => {
            await ctx.runMutation(internal.execution.operations.claim, {
                requestId: f.requestId,
                expectedGeneration: 4,
                piLease,
            });
            throw new Error("abort scheduling transaction");
        }),
    ).rejects.toThrow("abort scheduling transaction");
    expect(await f.t.run((ctx) => ctx.db.get(f.requestId))).toMatchObject({
        status: "pending",
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.requestId)))?.scheduledExecution,
    ).toBeUndefined();
    expect(
        await f.t.run((ctx) =>
            ctx.db.system.query("_scheduled_functions").collect(),
        ),
    ).toEqual(before);
});

test("a lost scheduled worker remains unknown and cannot be restarted by delivery or polling", async () => {
    const f = await fixture();
    const args = { requestId: f.requestId, expectedGeneration: 4 };
    await dispatchFixtureOperation(f.t, args);
    expect(
        await f.t.mutation(
            internal.execution.operations.beginScheduledExecution,
            { ...args, epoch: 1 },
        ),
    ).toBe(true);
    const mission = await f.t.run((ctx) => ctx.db.get(f.missionId));
    assert(mission);
    vi.setSystemTime(mission.deadlineAt - 1);
    const piLease = await claimFixturePiLease(f.t, f.missionId, 4);
    vi.setSystemTime(mission.deadlineAt);
    await f.t.mutation(internal.execution.operations.expire, args);
    expect(await f.t.run((ctx) => ctx.db.get(f.requestId))).toMatchObject({
        status: "unknown",
    });
    expect(
        await f.t.action(internal.sourcesMissionActions.execute, {
            ...args,
            epoch: 1,
        }),
    ).toBeNull();
    expect(
        await dispatchFixtureOperation(f.t, { ...args, piLease }),
    ).toMatchObject({
        kind: "refused",
    });
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
    expect(await f.t.run((ctx) => ctx.db.get(f.preparationId))).toMatchObject({
        sourcesMission: { work: [] },
    });
});

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
        await dispatchSourcesOperation(f.t, {
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
    const result = await dispatchSourcesOperation(f.t, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    expect(result.kind).toBe("success");
    expect(calls).toBe(1);
    const begun = await beginFixtureInvocation(f.t, {
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
            leaseExpiresAt: now + preparationWindowMs,
        });
        await ctx.db.patch(f.requestId, { deadlineAt });
        return deadlineAt;
    });
    mockControlReply("context_only");
    const respond = globalThis.fetch;
    const deadlines: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
        deadlines.push(ms);
        const controller = new AbortController();
        setTimeout(
            () =>
                controller.abort(new DOMException("Timed out", "TimeoutError")),
            ms,
        );
        return controller.signal;
    });
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    let transportAborted = false;
    let leaseMs: number | undefined;
    let leaseExpiresAt: number | undefined;
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (url, init) => {
            const call = await f.t.run((ctx) =>
                ctx.db.query("providerCalls").first(),
            );
            leaseExpiresAt = call?.leaseExpiresAt;
            leaseMs =
                call?.leaseExpiresAt !== undefined
                    ? call.leaseExpiresAt - call.createdAt
                    : undefined;
            return new Promise<Response>((resolve, reject) => {
                const signal = init?.signal;
                assert(signal);
                const abort = () => {
                    transportAborted = true;
                    reject(signal.reason);
                };
                signal.addEventListener("abort", abort, { once: true });
                release = () => {
                    signal.removeEventListener("abort", abort);
                    void respond(url, init).then(resolve, reject);
                };
                entered();
                if (signal.aborted) abort();
            });
        }),
    );
    const dispatch = dispatchSourcesOperation(f.t, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    await started;
    await vi.advanceTimersByTimeAsync(succeeds ? 350000 : windowMs - 1);
    expect(transportAborted).toBe(false);
    if (!succeeds) await vi.advanceTimersByTimeAsync(1);
    if (!transportAborted) release();
    const result = await dispatch;
    expect(transportAborted).toBe(!succeeds);
    expect(result).toMatchObject(
        succeeds
            ? { kind: "success" }
            : { kind: "refused", code: "execution_deadline" },
    );
    expect(deadlines.length).toBeGreaterThan(0);
    expect(deadlines.every((ms) => ms > 0 && ms <= windowMs)).toBe(true);
    expect(leaseMs).toBeGreaterThan(0);
    expect(leaseExpiresAt).toBe(deadlineAt + 10000);
    const receipts = await f.t.run((ctx) =>
        ctx.db.query("providerCalls").collect(),
    );
    expect(receipts).toEqual([
        expect.objectContaining(
            succeeds
                ? {
                      status: "succeeded",
                      reportedCost: 0.00001,
                      reportedCostFinal: true,
                  }
                : {
                      status: "failed",
                      errorCode: "request_timeout",
                      reportedCostFinal: false,
                  },
        ),
    ]);
    if (!succeeds) expect(receipts[0]).not.toHaveProperty("reportedCost");
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
        await dispatchSourcesOperation(f.t, {
            requestId: f.requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "success" });
    const call = await f.t.run((ctx) => ctx.db.query("providerCalls").first());
    expect(call?.leaseExpiresAt).toBe(deadlineAt + 10000);
});

async function documentaryControlFixture(
    kind: DocumentaryContribution["kind"],
    text?: string,
) {
    vi.useFakeTimers();
    const f = await seedCapturedSources({ text });
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
    return { ...f, input };
}

async function fixture(kind: DocumentaryContribution["kind"] = "context") {
    const f = await documentaryControlFixture(kind);
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "real-documentary-examiner",
            input: f.input,
        },
    );
    return { ...f, requestId };
}

function mockControlReply(
    permittedUse: "documentary" | "context_only",
    finishReason: "stop" | "unknown-provider-reason" | null = "stop",
    generationId?: string,
) {
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            const wire = JSON.parse(String(init?.body));
            const input = JSON.parse(wire.messages.at(-1).content);
            const response = providerFixtureResponse({
                id: "offline-permission-control",
                model: "z-ai/glm-5.3-flash",
                choices: [
                    {
                        index: 0,
                        message: {
                            role: "assistant",
                            content: JSON.stringify({
                                objections: [],
                                findings: Object.fromEntries(
                                    input.contributions.map(
                                        (c: {
                                            id: string;
                                            needIds: string[];
                                        }) => [
                                            c.id,
                                            {
                                                conclusion: "supported",
                                                permittedUse,
                                                needs: Object.fromEntries(
                                                    c.needIds.map((needId) => [
                                                        needId,
                                                        permittedUse,
                                                    ]),
                                                ),
                                                diagnostic:
                                                    "The passage supports the reported statement.",
                                            },
                                        ],
                                    ),
                                ),
                            }),
                        },
                        finish_reason: finishReason,
                    },
                ],
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 10,
                    total_tokens: 20,
                    cost: 0.00001,
                },
            });
            if (generationId)
                response.headers.set("x-generation-id", generationId);
            if (finishReason !== null) return response;
            const body = (await response.text()).replace(
                "data: [DONE]\n\n",
                "",
            );
            return new Response(body, { headers: response.headers });
        }),
    );
}

test.each([
    "attributed_argument",
    "forecast",
] as const)("an incompatible documentary permission for %s cannot become an admitted control", async (kind) => {
    const f = await fixture(kind);
    mockControlReply("documentary");
    const result = await dispatchSourcesOperation(f.t, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    expect(result).toMatchObject({
        kind: "waiting",
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.qualifications,
    ).toEqual([]);
});

test("a successful submission returns its effective permitted use with the pinned contribution identity", async () => {
    const f = await fixture();
    mockControlReply("context_only");
    const result = await dispatchSourcesOperation(f.t, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    assert(result.kind === "success");
    const value: Infer<typeof documentarySubmissionValue> = JSON.parse(
        result.valueJson,
    );
    const task = await f.t.run((ctx) => ctx.db.get(value.taskId));
    assert(task?.output.kind === "documentary_qualification");
    expect(value.needOrder).toEqual(["common-context"]);
    expect(value.effectiveContributions).toEqual([
        {
            id: task.output.contributions[0]?.id,
            version: 1,
            permittedUse: "context_only",
            usesByNeed: ["context_only"],
        },
    ]);
});

test("a reused historical control cannot bypass the contribution-kind permission guard", async () => {
    const f = await fixture("attributed_argument");
    mockControlReply("context_only");
    const first = await dispatchSourcesOperation(f.t, {
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
        assert(
            control?.output.kind === "documentary_control" &&
                "examination" in control.output,
        );
        const exam = control.output.examination;
        assert(exam.state === "examined");
        const finding = exam.control.findings[contribution.id];
        assert(finding);
        await ctx.db.patch(control._id, {
            output: {
                ...control.output,
                examination: {
                    ...exam,
                    control: {
                        ...exam.control,
                        findings: {
                            ...exam.control.findings,
                            [contribution.id]: {
                                ...finding,
                                permittedUse: "documentary",
                            },
                        },
                    },
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
    const result = await dispatchSourcesOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    expect(result).toMatchObject({
        kind: "unavailable",
        code: "documentary_control_invalid",
        validation: {
            path: "control",
            expected: "documentary_control_permission_invalid",
        },
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.qualifications,
    ).toEqual([taskId]);
});

async function settleUnusableExaminations(
    f: Awaited<ReturnType<typeof fixture>>,
) {
    const args = { requestId: f.requestId, expectedGeneration: 4 };
    expect(await dispatchSourcesOperation(f.t, args)).toMatchObject({
        kind: "waiting",
    });
    await f.t.mutation(internal.execution.operations.wakeStructuredExecution, {
        ...args,
        epoch: 1,
    });
    expect(
        await f.t.action(internal.sourcesMissionActions.execute, {
            ...args,
            epoch: 2,
        }),
    ).toMatchObject({ kind: "waiting" });
    await f.t.mutation(internal.execution.operations.wakeStructuredExecution, {
        ...args,
        epoch: 2,
    });
    return dispatchFixtureOperation(f.t, args);
}

test("an unfinished real documentary examination reaches Sources with precise bounded feedback", async () => {
    const f = await fixture();
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
        calls++;
        return providerFixtureResponse({
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
    const result = await settleUnusableExaminations(f);
    expect(result).toMatchObject({
        kind: "unavailable",
        code: "explicit_recovery_required",
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
    const begun = await beginFixtureInvocation(f.t, {
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
            if (wire.stream && !wire.response_format) {
                nativeRequests++;
                expect(JSON.stringify(wire.messages)).toContain(
                    "explicit_recovery_required",
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
            return providerFixtureResponse({
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
    await settleUnusableExaminations(f);
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
                return providerFixtureResponse({
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
                        "content-type": "text/event-stream",
                        ...(hasIdentity
                            ? { "x-generation-id": "documentary-generation" }
                            : {}),
                        "x-request-id": "documentary-request",
                    },
                },
            );
        }),
    );
    const result = await dispatchSourcesOperation(f.t, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    expect(result).toMatchObject(
        hasIdentity
            ? { kind: "waiting", reference: `operation:${f.requestId}` }
            : { kind: "unavailable", code: "request_timeout" },
    );
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
            termination: {
                kind: "cancelled",
                source: "generation_lookup",
                generationId: "documentary-generation",
            },
        });
    expect(after.preparation?.sourcesMission?.qualifications).toEqual([]);
    expect(
        await dispatchSourcesOperation(f.t, {
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
    ).toMatchObject(
        verified ? { attempt: 2 } : { errorCode: "attempt_outcome_unknown" },
    );
    if (cancelled === false) {
        assert(after.call?.billing?.retryAt);
        vi.setSystemTime(after.call.billing.retryAt);
        const lookup = { providerCallId: call._id, attempt: 2 };
        expect(
            await f.t.mutation(internal.providerCalls.claimBilling, lookup),
        ).toEqual({ generationId: "documentary-generation" });
        const usage = () =>
            f.t.run(async (ctx) =>
                Promise.all([
                    readQualificationUsage(ctx, contextId),
                    readQualificationUsage(ctx, contextId, f.runId),
                ]),
            );
        for (const scope of await usage())
            expect(scope?.usage.costUsd).toBeCloseTo(0.0002137, 12);
        await f.t.mutation(internal.providerCalls.settleBilling, {
            ...lookup,
            generationId: "documentary-generation",
            cancelled: true,
            reason: "invalid_response",
        });
        for (const scope of await usage()) {
            expect(scope?.unknown).toBe(0);
            expect(scope?.usage.costUsd).toBeCloseTo(0.0002137, 12);
        }
    }
    if (verified) {
        await recordFixtureAttempt(f.t, {
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
            operationEpoch: call.operationEpoch,
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
        expect(conflict.usage).toMatchObject({
            unknown: 0,
            conflicts: 1,
            usage: { costUsd: 1 },
        });
        expect(conflict.run?.sourcePreparationBudget).toEqual(
            after.run?.sourcePreparationBudget,
        );
        expect(
            await f.t.query(
                internal.providerCalls.nextPreparationAttemptForInput,
                {
                    preparationId: f.preparationId,
                    sourceId: f.sourceId,
                    operation: call.operation,
                    inputHash: call.inputHash,
                    now: Date.now(),
                },
            ),
        ).toEqual(expect.objectContaining({ errorCode: "billing_conflict" }));
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
    const refused = await dispatchSourcesOperation(f.t, {
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
        await dispatchSourcesOperation(f.t, {
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
        await dispatchSourcesOperation(f.t, {
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

test("Sources refresh reserves one new provider attempt and preserves the earlier captured bytes", async () => {
    const f = await seedCapturedSources();
    await f.t.run((ctx) => ctx.db.patch(f.missionId, { definitionVersion: 7 }));
    vi.stubEnv("EXA_API_KEY", "offline-only");
    const source = await f.t.run((ctx) => ctx.db.get(f.sourceId));
    assert(source);
    const original =
        "The initial publication lists local approval of enterprise workflows.";
    const revised =
        "The updated publication lists centralized approval of enterprise workflows.";
    const provider = vi.fn();
    for (const text of [original, revised])
        provider.mockImplementationOnce(async () =>
            providerFixtureResponse({
                results: [
                    { id: source.canonicalUrl, url: source.canonicalUrl, text },
                ],
                searchTime: 1,
                costDollars: { total: 0.01 },
            }),
        );
    vi.stubGlobal("fetch", provider);
    const acquire = async (reference: string, cause: string) => {
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId: f.missionId,
                expectedGeneration: 4,
                cause,
                input: { kind: "acquire_document", reference },
            },
        );
        const result = await dispatchSourcesOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        });
        assert(result.kind === "success", JSON.stringify(result));
        return JSON.parse(result.valueJson);
    };
    const first = await acquire(
        JSON.stringify({ version: 2, issuer: "source", sourceId: f.sourceId }),
        "capture-first",
    );
    const context = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    assert(context.kind === "ready");
    const entry = JSON.parse(context.inputJson).activeWork.captures.find(
        (capture: { captureId: string }) =>
            capture.captureId === first.captureId,
    );
    const refresh = entry.readingReferences[0].refreshReference;
    const second = await acquire(refresh, "capture-revised");
    expect(second).toMatchObject({ sourceId: first.sourceId });
    expect(second.captureId).not.toBe(first.captureId);
    expect(second.contentHash).not.toBe(first.contentHash);
    expect((await acquire(refresh, "reuse-revised")).captureId).toBe(
        second.captureId,
    );
    const state = await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        const older = await ctx.db.get("sourceCaptures", first.captureId);
        const newer = await ctx.db.get("sourceCaptures", second.captureId);
        assert(older?.storageId && newer?.storageId);
        return {
            ids: preparation?.sourcesMission?.captureIds,
            originalText: await (
                await ctx.storage.get(older.storageId)
            )?.text(),
            refreshedText: await (
                await ctx.storage.get(newer.storageId)
            )?.text(),
        };
    });
    expect(state).toMatchObject({
        ids: expect.arrayContaining([first.captureId, second.captureId]),
        originalText: original,
        refreshedText: revised,
    });
    expect(provider).toHaveBeenCalledTimes(2);
});

test("Sources 7 controls the capture cited before a newer capture was registered", async () => {
    const f = await documentaryControlFixture("context");

    await f.t.run((ctx) => ctx.db.patch(f.missionId, { definitionVersion: 7 }));
    const readRequestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "review-v7-first-capture",
            input: {
                kind: "search_available_material",
                reference: JSON.stringify({
                    issuer: "capture",
                    captureId: f.captureId,
                    version: 2,
                }),
                query: "workflow",
            },
        },
    );
    const read = await dispatchSourcesOperation(f.t, {
        requestId: readRequestId,
        expectedGeneration: 4,
    });
    assert(read.kind === "success", JSON.stringify(read));
    const passageOrder = JSON.parse(read.valueJson).passages[0]?.passageOrder;
    expect(passageOrder).toBeTypeOf("number");
    const submission = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "review-v7-submit-first-capture",
            input: {
                ...f.input,
                changes: f.input.changes.map(({ contribution }) => ({
                    contribution: {
                        ...contribution,
                        evidence: [{ readRequestId, passageOrder }],
                    },
                })),
            },
        },
    );
    const newer = await f.t.run(async (ctx) => {
        const capture = await ctx.db.get(f.captureId);
        const preparation = await ctx.db.get(f.preparationId);
        assert(capture && preparation?.sourcesMission);
        const { _id, _creationTime, ...original } = capture;
        const captureId = await ctx.db.insert("sourceCaptures", {
            ...original,
            captureKey: `review-second-capture-${_id}`,
            updatedAt: original.updatedAt + 1,
        });
        await ctx.db.patch(preparation._id, {
            sourcesMission: {
                ...preparation.sourcesMission,
                captureIds: [
                    ...preparation.sourcesMission.captureIds,
                    captureId,
                ],
            },
        });
        return captureId;
    });
    expect(newer).not.toBe(f.captureId);
    const evidence: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
        const wire = JSON.parse(String(init?.body));
        evidence.push(...JSON.parse(wire.messages.at(-1).content).evidence);
        return documentaryReply(init);
    });
    const outcome = await dispatchSourcesOperation(f.t, {
        requestId: submission,
        expectedGeneration: 4,
    });
    assert(outcome.kind === "success", JSON.stringify(outcome));
    const expected = {
        captureId: f.captureId,
        contentHash: f.passage.contentHash,
        passage: expect.objectContaining({
            order: passageOrder,
            quotation: f.passage.quotation,
        }),
    };
    expect(evidence).toEqual([expect.objectContaining(expected)]);
    const begun = await beginFixtureInvocation(f.t, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "complete-exact-capture",
        provenance: "simulation",
    });
    assert(begun.kind === "ready", JSON.stringify(begun));
    const completed = await f.t.mutation(
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
    expect(completed.kind).toBe("completed");
    await f.t.mutation(internal.sourcesMission.finish, {
        preparationId: f.preparationId,
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    const reader = await f.t
        .withIdentity({ subject: f.userId })
        .query(api.sourcesWorkspace.getSource, {
            runId: f.runId,
            sourceId: f.sourceId,
        });
    expect(reader?.capture).toMatchObject({ captureId: f.captureId });
    expect(
        reader?.sections.flatMap((section) => section.passages),
    ).toContainEqual({
        order: passageOrder,
        quotation: f.passage.quotation,
    });
});

test("Sources control uses publication metadata retained only on the capture", async () => {
    const f = await fixture();
    const { sourceDocumentMetadata } = await import(
        "@convex/domain/sourceRetrievalPolicy"
    );
    const publishedAt = Date.parse("2020-01-11T00:00:00.000Z");
    await f.t.run(async (ctx) => {
        const source = await ctx.db.get(f.sourceId);
        assert(source);
        await ctx.db.patch(f.sourceId, {
            origin: "exa",
            publishedAt: undefined,
        });
        await ctx.db.patch(f.captureId, {
            document: sourceDocumentMetadata({
                ...source,
                origin: "exa",
                publishedAt,
            }),
        });
    });
    const received: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
        const wire = JSON.parse(String(init?.body));
        const input = JSON.parse(wire.messages.at(-1).content);
        received.push(input.evidence[0].document);
        return documentaryReply(init);
    });
    const outcome = await dispatchSourcesOperation(f.t, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    assert(outcome.kind === "success", JSON.stringify(outcome));
    expect(received).toEqual([expect.objectContaining({ publishedAt })]);
});

test.each([
    "stop",
    null,
    "unknown-provider-reason",
] as const)("structured stream finish %s is retained only when supplied by the provider", async (finishReason) => {
    const f = await fixture();
    mockControlReply("context_only", finishReason);
    await dispatchSourcesOperation(f.t, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    const [call] = await f.t.run((ctx) =>
        ctx.db.query("providerCalls").collect(),
    );
    assert(call);
    if (finishReason !== "stop") {
        expect(call.providerObservation?.termination).toBeUndefined();
        expect(call.status).toBe("failed");
    } else {
        expect(call.providerObservation?.termination).toEqual({
            kind: "finished",
            source: "stream",
            rawFinishReason: "stop",
            observedAt: expect.any(Number),
        });
        expect(call.status).toBe("succeeded");
    }
});

async function registeredSourcesWorker() {
    const { execute } = await import("@convex/sourcesMissionActions");
    return execute as typeof execute & {
        _handler(
            ctx: ActionCtx,
            args: import("@convex/execution/executionProtocol").ScheduledOperationArgs,
        ): Promise<
            import("convex/server").FunctionReturnType<
                typeof internal.sourcesMissionActions.execute
            >
        >;
    };
}

test.each([
    "execution/invocationLifecycle:finishOneShot",
    "sourcesMission:retainControl",
    "execution/operations:recordResult",
])("a lost acknowledgement after %s recovers the committed qualification exactly once", async (committedMutation) => {
    const f = await fixture();
    mockControlReply("context_only");
    const args = { requestId: f.requestId, expectedGeneration: 4 };
    await dispatchFixtureOperation(f.t, args);
    const execute = await registeredSourcesWorker();
    let lost = false;
    const result = await f.t.action(async (ctx) => {
        const transport: typeof ctx = {
            ...ctx,
            runMutation: async (reference, ...mutationArgs) => {
                const committed = await ctx.runMutation(
                    reference,
                    ...mutationArgs,
                );
                if (!lost && getFunctionName(reference) === committedMutation) {
                    lost = true;
                    throw new Error("Response lost after commit");
                }
                return committed;
            },
        };
        return execute._handler(transport, { ...args, epoch: 1 });
    });
    expect(lost).toBe(true);
    assert(result?.kind === "success");
    const state = await f.t.run(async (ctx) => ({
        request: await ctx.db.get(f.requestId),
        preparation: await ctx.db.get(f.preparationId),
        calls: await ctx.db.query("providerCalls").collect(),
    }));
    expect(state.request?.status).toBe("completed");
    expect(state.preparation?.sourcesMission?.qualifications).toHaveLength(1);
    expect(JSON.parse(result.valueJson).taskId).toBe(
        state.preparation?.sourcesMission?.qualifications[0],
    );
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]?.status).toBe("succeeded");
});

test("a lost acknowledgement after committing a provider wait leaves it recoverable", async () => {
    const f = await fixture();
    mockControlReply("context_only", null, "wait-ack-generation");
    const args = { requestId: f.requestId, expectedGeneration: 4, epoch: 1 };
    await dispatchFixtureOperation(f.t, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    const execute = await registeredSourcesWorker();
    let lost = false;
    const received = await f.t.action((ctx) =>
        execute._handler(
            {
                ...ctx,
                async runMutation(reference, ...mutationArgs) {
                    const result = await ctx.runMutation(
                        reference,
                        ...mutationArgs,
                    );
                    if (
                        !lost &&
                        getFunctionName(reference) ===
                            "execution/operations:recordResult"
                    ) {
                        lost = true;
                        expect(result).toMatchObject({ kind: "waiting" });
                        throw new Error(
                            "Acknowledgement lost after committing the wait",
                        );
                    }
                    return result;
                },
            },
            args,
        ),
    );
    expect(lost).toBe(true);
    expect(received).toMatchObject({ kind: "waiting" });
    const waiting = await f.t.run(async (ctx) => ({
        request: await ctx.db.get(f.requestId),
        call: await ctx.db.query("providerCalls").first(),
        mission: await ctx.db.get(f.missionId),
    }));
    expect(waiting.request).toMatchObject({
        status: "waiting",
        scheduledExecution: {
            phase: "waiting_provider",
            wakeId: expect.any(String),
        },
    });
    expect(waiting.mission?.status).not.toBe("blocked");
    assert(waiting.call);
    vi.stubGlobal("fetch", async () =>
        Response.json({ data: { id: "wait-ack-generation", cancelled: true } }),
    );
    await f.t.action(internal.integrations.openRouterGeneration.reconcile, {
        providerCallId: waiting.call._id,
        attempt: 1,
    });
    await f.t.mutation(
        internal.execution.operations.wakeStructuredExecution,
        args,
    );
    mockControlReply("context_only");
    expect(
        await f.t.action(internal.sourcesMissionActions.execute, {
            ...args,
            epoch: 2,
        }),
    ).toMatchObject({ kind: "success" });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.qualifications,
    ).toHaveLength(1);
});

test("a fenced worker cannot adopt a successful one-shot after Pause takes effect", async () => {
    const f = await fixture();
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
        }),
    );
    mockControlReply("context_only");
    const client = f.t.withIdentity({ subject: f.userId });
    const args = { requestId: f.requestId, expectedGeneration: 4, epoch: 1 };
    await dispatchFixtureOperation(f.t, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    const execute = await registeredSourcesWorker();
    let fenced = false;
    await f.t.action((ctx) =>
        execute._handler(
            {
                ...ctx,
                async runMutation(reference, ...mutationArgs) {
                    const result = await ctx.runMutation(
                        reference,
                        ...mutationArgs,
                    );
                    if (
                        getFunctionName(reference) ===
                        "execution/invocationLifecycle:finishOneShot"
                    ) {
                        expect(
                            await client.mutation(
                                api.execution.researchControl.pause,
                                {
                                    runId: f.runId,
                                    expectedGeneration: 4,
                                },
                            ),
                        ).toBe(4);
                        await f.t.run(async (db) => {
                            const request = await db.db.get(f.requestId);
                            assert(
                                request?.scheduledExecution?.phase ===
                                    "running",
                            );
                            await db.scheduler.cancel(
                                request.scheduledExecution.jobId,
                            );
                        });
                        await f.t.mutation(
                            internal.execution.operations
                                .wakeStructuredExecution,
                            args,
                        );
                        expect(
                            await f.t.run((db) => db.db.get(f.runId)),
                        ).toMatchObject({
                            executionStatus: "paused",
                            executionGeneration: 5,
                            researchPauseRequested: false,
                        });
                        fenced = true;
                        throw new Error(
                            "Successful result acknowledgement arrived after the worker was fenced",
                        );
                    }
                    return result;
                },
            },
            args,
        ),
    );
    expect(fenced).toBe(true);
    const paused = await f.t.run(async (ctx) => ({
        request: await ctx.db.get(f.requestId),
        preparation: await ctx.db.get(f.preparationId),
        calls: await ctx.db.query("providerCalls").collect(),
    }));
    expect(paused.request).toMatchObject({
        status: "waiting",
        scheduledExecution: { phase: "waiting_provider", epoch: 1 },
    });
    expect(paused.preparation?.sourcesMission?.qualifications).toEqual([]);
    expect(paused.calls).toHaveLength(1);
    expect(paused.calls[0]?.status).toBe("succeeded");
});

test("terminal v2 documentary history replays unchanged and an unfinished v2 request cannot run", async () => {
    const f = await fixture();
    const captured = {
        kind: "success" as const,
        valueJson: JSON.stringify({
            taskId: "historical-task",
            control: { coherence: true, findings: [], limitations: [] },
        }),
    };
    await f.t.run((ctx) =>
        ctx.db.patch(f.requestId, {
            operationVersion: 2,
            status: "completed",
            outcome: captured,
        }),
    );
    const args = { requestId: f.requestId, expectedGeneration: 4 };
    expect(await dispatchFixtureOperation(f.t, args)).toEqual(captured);
    await f.t.run((ctx) =>
        ctx.db.patch(f.requestId, {
            status: "waiting",
            outcome: undefined,
        }),
    );
    expect(await dispatchFixtureOperation(f.t, args)).toEqual({
        kind: "refused",
        code: "operation_version_conflict",
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.requestId))).toMatchObject({
        status: "waiting",
        operationVersion: 2,
    });
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});

test("a safe documentary wait cannot settle Pause while another research operation is live", async () => {
    const f = await fixture();
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
        }),
    );
    const client = f.t.withIdentity({ subject: f.userId });
    const otherId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "other-engaged-research",
            input: {
                kind: "discover_sources_for_need",
                needId: "common-context",
                query: "Workflow software",
            },
        },
    );
    await dispatchFixtureOperation(f.t, {
        requestId: otherId,
        expectedGeneration: 4,
    });
    expect(
        await f.t.mutation(
            internal.execution.operations.beginScheduledExecution,
            {
                requestId: otherId,
                expectedGeneration: 4,
                epoch: 1,
            },
        ),
    ).toBe(true);
    mockControlReply("context_only", null, "mixed-pause-generation");
    const args = { requestId: f.requestId, expectedGeneration: 4, epoch: 1 };
    await dispatchFixtureOperation(f.t, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    const execute = await registeredSourcesWorker();
    await f.t.action((ctx) =>
        execute._handler(
            {
                ...ctx,
                async runMutation(reference, ...mutationArgs) {
                    const result = await ctx.runMutation(
                        reference,
                        ...mutationArgs,
                    );
                    if (
                        getFunctionName(reference) ===
                        getFunctionName(
                            internal.execution.providerCallReceipts
                                .observeGeneration,
                        )
                    ) {
                        expect(
                            await client.mutation(
                                api.execution.researchControl.pause,
                                {
                                    runId: f.runId,
                                    expectedGeneration: 4,
                                },
                            ),
                        ).toBe(4);
                    }
                    return result;
                },
            },
            args,
        ),
    );
    expect(await f.t.run((ctx) => ctx.db.get(f.requestId))).toMatchObject({
        status: "waiting",
        scheduledExecution: { phase: "waiting_provider", epoch: 1 },
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "running",
        researchPauseRequested: true,
        executionGeneration: 4,
    });
    await f.t.mutation(internal.execution.operations.recordResult, {
        requestId: otherId,
        expectedGeneration: 4,
        epoch: 1,
        outcome: { kind: "unavailable", code: "missing_configuration" },
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "paused",
        researchPauseRequested: false,
        executionGeneration: 5,
    });
    const first = await f.t.run((ctx) => ctx.db.get(f.requestId));
    await f.t.mutation(
        internal.execution.operations.wakeStructuredExecution,
        args,
    );
    expect(await f.t.run((ctx) => ctx.db.get(f.requestId))).toEqual(first);
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toHaveLength(1);
});

function fixtureExaminationReply(
    init: RequestInit | undefined,
    makeControl: (
        contributions: DocumentaryContribution[],
    ) => DocumentaryControlV2,
) {
    const wire = JSON.parse(String(init?.body));
    const input = JSON.parse(wire.messages.at(-1).content);
    return providerFixtureResponse({
        id: "offline-examination",
        model: "z-ai/glm-5.3-flash",
        choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    content: JSON.stringify(makeControl(input.contributions)),
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

test.each([
    ["unknown need", "documentary_control_target_invalid"],
    ["duplicate target", "documentary_control_target_invalid"],
    ["split group", "documentary_control_objection_invalid"],
    ["blank diagnostic", "documentary_control_objection_invalid"],
    ["unexplained narrower use", "documentary_control_objection_required"],
] as const)("the scheduled examiner rejects %s without adopting a qualification", async (defect, reason) => {
    const f = await fixture();
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) =>
        fixtureExaminationReply(init, (contributions) => {
            const [contribution] = contributions;
            assert(contribution);
            const id = contribution.id;
            const control = scopedFixtureControl(contributions, [
                {
                    contributionId: id,
                    conclusion: "supported",
                    permittedUse: "context_only",
                    diagnostic: "Exact passage",
                },
            ]);
            const finding = control.findings[id];
            assert(finding);
            const target = { contributionId: id, needId: "common-context" };
            const objection = {
                targets: [target],
                maximumUse: "blocked" as const,
                diagnostic: "Limited evidence",
            };
            if (defect === "unknown need")
                control.objections = [
                    {
                        ...objection,
                        targets: [{ ...target, needId: "foreign-need" }],
                    },
                ];
            else if (defect === "duplicate target")
                control.objections = [
                    { ...objection, targets: [target, target] },
                ];
            else if (defect === "split group")
                control.objections = [
                    objection,
                    { ...objection, targets: [{ ...target, needId: null }] },
                ];
            else if (defect === "blank diagnostic")
                control.objections = [{ ...objection, diagnostic: "  " }];
            else finding.needs["common-context"] = "blocked";
            return control;
        }),
    );
    const outcome = await dispatchSourcesOperation(f.t, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    expect(outcome.kind).not.toBe("success");
    const state = await f.t.run(async (ctx) => ({
        preparation: await ctx.db.get(f.preparationId),
        budget: (await ctx.db.get(f.runId))?.sourcePreparationBudget,
        calls: await ctx.db.query("providerCalls").collect(),
    }));
    expect(state.preparation?.sourcesMission?.qualifications).toEqual([]);
    expect(state.preparation?.sourcesMission?.restrictedContributions).toEqual(
        [],
    );
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({
        status: "failed",
        errorCode: "invalid_output",
        diagnostic: { reason },
    });
    expect(state.budget).toMatchObject({
        dispatches: 1,
        incidents: 1,
        reserved: 0,
        work: 0,
    });
});

test("losing the acknowledgement of failed reply retention completes with the retained failure", async () => {
    const f = await documentaryControlFixture("context");
    const [change] = f.input.changes;
    assert(change);
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "lost-retention-failure",
            input: {
                ...f.input,
                changes: Array.from({ length: 15 }, (_, i) => ({
                    contribution: {
                        ...change.contribution,
                        statement: `The document establishes observation ${i}.`,
                    },
                })),
            },
        },
    );
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) =>
        fixtureExaminationReply(init, (contributions) =>
            scopedFixtureControl(
                contributions,
                contributions.map(({ id }) => ({
                    contributionId: id,
                    conclusion: "supported",
                    permittedUse: "context_only",
                    diagnostic: "界".repeat(1800),
                })),
            ),
        ),
    );
    const args = { requestId, expectedGeneration: 4 };
    await dispatchFixtureOperation(f.t, args);
    const execute = await registeredSourcesWorker();
    let unavailable = false;
    let lost = false;
    const outcome = await f.t.action((ctx) =>
        execute._handler(
            {
                ...ctx,
                async runMutation(reference, ...mutationArgs) {
                    const name = getFunctionName(reference);
                    if (
                        name ===
                        "execution/invocationLifecycle:stageObservedReply"
                    ) {
                        unavailable = true;
                        throw new Error("Observation storage was unavailable");
                    }
                    const result = await ctx.runMutation(
                        reference,
                        ...mutationArgs,
                    );
                    if (
                        name === "execution/invocationLifecycle:finishOneShot"
                    ) {
                        lost = true;
                        throw new Error(
                            "Acknowledgement lost after recording retention failure",
                        );
                    }
                    return result;
                },
            },
            { ...args, epoch: 1 },
        ),
    );
    expect(unavailable && lost).toBe(true);
    expect(outcome).toEqual({
        kind: "unavailable",
        code: "observable_reply_unavailable",
    });
    const state = await f.t.run(async (ctx) => ({
        request: await ctx.db.get(requestId),
        preparation: await ctx.db.get(f.preparationId),
        calls: await ctx.db.query("providerCalls").collect(),
    }));
    expect(state.request).toMatchObject({ status: "completed", outcome });
    expect(state.preparation?.sourcesMission?.qualifications).toEqual([]);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]?.status).toBe("succeeded");
});

test("a priced structured stream lacking a finish still reconciles remote termination", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    mockControlReply("context_only", null, "offline-priced-eof");
    await dispatchSourcesOperation(f.t, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    const call = await f.t.run((ctx) => ctx.db.query("providerCalls").first());
    assert(call);
    expect(call).toMatchObject({
        status: "failed",
        reportedCost: 0.00001,
        billing: { state: "pending", attempt: 0 },
    });
    expect(call.providerObservation?.termination).toBeUndefined();
    const lookup = vi.fn(async (url: RequestInfo | URL) => {
        expect(String(url)).toBe(
            "https://openrouter.ai/api/v1/generation?id=offline-priced-eof",
        );
        return Response.json({
            data: { id: "offline-priced-eof", total_cost: 0.00001 },
        });
    });
    vi.stubGlobal("fetch", lookup);
    await f.t.action(internal.integrations.openRouterGeneration.reconcile, {
        providerCallId: call._id,
        attempt: 1,
    });
    const reconciled = await f.t.run((ctx) => ctx.db.get(call._id));
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(reconciled).toMatchObject({
        status: "failed",
        reportedCost: 0.00001,
        billing: { state: "confirmed", attempt: 1 },
    });
    expect(reconciled?.providerObservation?.termination).toBeUndefined();
    assert(call.inputHash);
    expect(
        await f.t.query(internal.providerCalls.nextPreparationAttemptForInput, {
            preparationId: f.preparationId,
            sourceId: f.sourceId,
            operation: "source_documentary_control",
            inputHash: call.inputHash,
            now: Date.now(),
        }),
    ).toMatchObject({ errorCode: "attempt_outcome_unknown" });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.qualifications,
    ).toEqual([]);
});

test("a corrected examination of the same launch passage preserves the launch but excludes the unsupported promise", async () => {
    const text = "The issuer launched workflow software for insurance claims.";
    const f = await documentaryControlFixture("attributed_argument", text);
    const [change] = f.input.changes;
    assert(change);
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "qualify launch and promise independently",
            input: {
                ...f.input,
                changes: [text, "The issuer promises faster reviews."].map(
                    (statement) => ({
                        contribution: { ...change.contribution, statement },
                    }),
                ),
            },
        },
    );
    const args = { requestId, expectedGeneration: 4 };
    let attempt = 0;
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) =>
        fixtureExaminationReply(init, (contributions) => {
            attempt++;
            return scopedFixtureControl(
                contributions,
                contributions.map((c) => ({
                    contributionId: c.id,
                    conclusion:
                        c.statement === text ? "supported" : "not_established",
                    permittedUse:
                        c.statement === text || attempt === 1
                            ? "attributed_argument_only"
                            : "blocked",
                    diagnostic:
                        "The quoted sentence announces the launch only.",
                })),
            );
        }),
    );
    expect(await dispatchSourcesOperation(f.t, args)).toMatchObject({
        kind: "waiting",
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.qualifications,
    ).toEqual([]);
    await f.t.mutation(internal.execution.operations.wakeStructuredExecution, {
        ...args,
        epoch: 1,
    });
    const receipt = await f.t.action(internal.sourcesMissionActions.execute, {
        ...args,
        epoch: 2,
    });
    assert(receipt?.kind === "success", JSON.stringify(receipt));
    const result = JSON.parse(receipt.valueJson);
    expect(
        result.effectiveContributions.map(
            (c: { permittedUse: string }) => c.permittedUse,
        ),
    ).toEqual(["attributed_argument_only", "blocked"]);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.qualifications,
    ).toEqual([result.taskId]);
    expect(attempt).toBe(2);
});

test.each([
    {
        reasons: [
            "The quotation is a vendor expectation.",
            "The quotation gives no measured customer outcome.",
        ],
    },
    { reasons: [null] },
])("scoped objections preserve independent reasons or explicit absence through handoff ($reasons)", async ({
    reasons,
}) => {
    const quotation =
        "The issuer expects its new workflow software to speed up claim review.";
    const f = await documentaryControlFixture("attributed_argument", quotation);
    const outcomes = "customer-outcomes";
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                needs: [
                    ...preparation.sourcesMission.needs,
                    {
                        id: outcomes,
                        version: 1,
                        information: "Independent customer outcomes",
                        questionIds: [],
                        commonContext: false,
                    },
                ],
            },
        });
    });
    const [change] = f.input.changes;
    assert(change);
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "qualify vendor evidence for two needs",
            input: {
                ...f.input,
                changes: [
                    {
                        contribution: {
                            ...change.contribution,
                            statement: quotation,
                            attribution: "Issuer",
                            modality: "expectation",
                            needIds: ["common-context", outcomes],
                        },
                    },
                ],
            },
        },
    );
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
        const wire = JSON.parse(String(init?.body));
        const submitted = JSON.parse(wire.messages.at(-1).content);
        const id = submitted.contributions[0].id;
        return providerFixtureResponse({
            id: "offline-scoped-examination",
            model: "z-ai/glm-5.3-flash",
            choices: [
                {
                    index: 0,
                    message: {
                        role: "assistant",
                        content: JSON.stringify({
                            findings: {
                                [id]: {
                                    conclusion: "supported",
                                    permittedUse: "attributed_argument_only",
                                    diagnostic:
                                        "Faithful to the publisher description.",
                                    needs: {
                                        "common-context":
                                            "attributed_argument_only",
                                        [outcomes]: "blocked",
                                    },
                                },
                            },
                            objections: reasons.map((diagnostic) => ({
                                targets: [
                                    {
                                        contributionId: id,
                                        needId: outcomes,
                                    },
                                ],
                                maximumUse: "blocked",
                                diagnostic,
                            })),
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
    });
    const receipt = await dispatchSourcesOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    assert(receipt.kind === "success", JSON.stringify(receipt));
    const value: Infer<typeof documentarySubmissionValue> = JSON.parse(
        receipt.valueJson,
    );
    expect(value).toMatchObject({
        controlVersion: 2,
        reference: expect.any(String),
        objectionCount: reasons.length,
        needOrder: ["common-context", outcomes],
        effectiveContributions: [
            {
                permittedUse: "attributed_argument_only",
                usesByNeed: ["attributed_argument_only", "blocked"],
            },
        ],
    });
    const retained = await f.t.run(async (ctx) => {
        const event = await ctx.db.get(value.reference);
        const task = await ctx.db.get(value.taskId);
        assert(task?.output.kind === "documentary_qualification");
        const control = await ctx.db.get(task.output.controlTaskId);
        assert(control?.output.kind === "documentary_control");
        assert("examination" in control.output);
        assert(control.output.examination.state === "examined");
        assert(event?.contextObservation);
        return {
            textId: event.contextObservation.textId,
            contribution: task.output.contributions[0],
            control: control.output.examination.control,
        };
    });
    expect(retained.contribution).toMatchObject({
        statement: quotation,
        attribution: "Issuer",
        evidence: [{ captureId: f.captureId, quotation }],
    });
    const journal = await readRetainedBody(f.t, retained.textId);
    expect(JSON.parse(journal)).toMatchObject({
        event: "contributions_qualified",
        taskId: value.taskId,
        control: {
            ...retained.control,
            objections: reasons.map((diagnostic) =>
                expect.objectContaining({ diagnostic }),
            ),
        },
    });
    expect(value).not.toHaveProperty("control");
    const workspaceReading = await f.t
        .withIdentity({ subject: f.userId })
        .query(api.sourcesWorkspace.getSource, {
            runId: f.runId,
            sourceId: f.sourceId,
        });
    expect(workspaceReading?.contributions).toEqual([
        expect.objectContaining({
            diagnostic: "Faithful to the publisher description.",
            objections: reasons.map((diagnosticPreview) =>
                expect.objectContaining({ diagnosticPreview }),
            ),
            needs: {
                "common-context": "attributed_argument_only",
                [outcomes]: "blocked",
            },
        }),
    ]);
    await f.t.run((ctx) => ctx.db.patch(f.missionId, { definitionVersion: 9 }));
    const readingRequestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "read the scoped examination",
            input: {
                kind: "read_in_context",
                reference: documentaryReference({
                    issuer: "capture",
                    captureId: f.captureId,
                }),
            },
        },
    );
    const reading = await dispatchFixtureOperation(f.t, {
        requestId: readingRequestId,
        expectedGeneration: 4,
    });
    assert(reading.kind === "success");
    const { examination } = JSON.parse(reading.valueJson);
    expect(examination).toMatchObject({
        state: "examined",
        qualification: {
            taskId: value.taskId,
            reference: value.reference,
            needOrder: ["common-context", outcomes],
            contributions: [
                {
                    objections: reasons.map((diagnosticPreview) => ({
                        needIndexes: [1],
                        maximumUse: "blocked",
                        diagnosticPreview,
                        diagnosticComplete: true,
                    })),
                },
            ],
        },
    });
    const begun = await beginFixtureInvocation(f.t, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "complete-scoped-material",
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
                needs: [
                    { needId: "common-context", unfinished: [] },
                    {
                        needId: outcomes,
                        unfinished: [
                            "Independent outcomes research is still needed.",
                        ],
                    },
                ],
            },
        },
    );
    expect(completion.kind).toBe("completed");
    await f.t.mutation(internal.sourcesMission.finish, {
        preparationId: f.preparationId,
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    const [common, restricted] = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return Promise.all([
            readPreparedNeed(ctx, run, "common-context"),
            readPreparedNeed(ctx, run, outcomes),
        ]);
    });
    expect(common).toMatchObject({
        kind: "available",
        value: {
            controlledContributions: [
                {
                    contributions: [
                        {
                            permittedUse: "attributed_argument_only",
                            objections: [],
                        },
                    ],
                },
            ],
        },
    });
    expect(restricted).toMatchObject({
        kind: "available",
        value: {
            controlledContributions: [
                {
                    contributions: [
                        {
                            permittedUse: "blocked",
                            objections: reasons.map((diagnosticPreview) =>
                                expect.objectContaining({ diagnosticPreview }),
                            ),
                        },
                    ],
                },
            ],
        },
    });
    const saved = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(saved?.sourcesMission?.result).toMatchObject({
        outcome: "partial",
        documents: [expect.objectContaining({ captureId: f.captureId })],
        needs: [
            expect.objectContaining({
                needId: "common-context",
                contributions: [
                    expect.objectContaining({
                        qualificationTaskId: value.taskId,
                        contributionId: retained.contribution?.id,
                    }),
                ],
            }),
            expect.objectContaining({ needId: outcomes, contributions: [] }),
        ],
    });
    expect(
        saved?.sourcesMission?.result?.needs.find(
            (need) => need.needId === outcomes,
        )?.gap,
    ).toBeUndefined();
});

test.each([
    false,
    true,
])("matching remote cancellation permits one successor epoch on the original work reservation (successor invalid: %s)", async (invalidSuccessor) => {
    const f = await fixture();
    let generations = 0;
    let lookups = 0;
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
        if (init?.method === "GET") {
            lookups++;
            return Response.json({
                data: { id: "offline-recovery", cancelled: true },
            });
        }
        generations++;
        if (generations > 1)
            return invalidSuccessor
                ? providerFixtureResponse({
                      id: "offline-invalid-recovery",
                      model: "z-ai/glm-5.3-flash",
                      choices: [
                          {
                              index: 0,
                              message: { role: "assistant", content: "{}" },
                              finish_reason: "stop",
                          },
                      ],
                  })
                : documentaryReply(init);
        return new Response(
            `data: ${JSON.stringify({
                id: "offline-recovery",
                model: "z-ai/glm-5.3-flash",
                choices: [
                    {
                        index: 0,
                        delta: { content: `{${" ".repeat(4096)}` },
                        finish_reason: null,
                    },
                ],
            })}\n\n`,
            {
                headers: {
                    "content-type": "text/event-stream",
                    "x-generation-id": "offline-recovery",
                },
            },
        );
    });
    const args = { requestId: f.requestId, expectedGeneration: 4 };
    expect(await dispatchSourcesOperation(f.t, args)).toMatchObject({
        kind: "waiting",
    });
    const original = await f.t.run(async (ctx) => ({
        request: await ctx.db.get(f.requestId),
        preparation: await ctx.db.get(f.preparationId),
        call: await ctx.db.query("providerCalls").first(),
    }));
    assert(original.call);
    expect(original.request?.scheduledExecution).toMatchObject({
        phase: "waiting_provider",
        epoch: 1,
        callId: original.call._id,
    });
    expect(original.call).toMatchObject({
        status: "failed",
        errorCode: "structured_output_whitespace",
        operationEpoch: 1,
    });
    await f.t.mutation(internal.execution.operations.wakeStructuredExecution, {
        ...args,
        epoch: 1,
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.requestId)))?.scheduledExecution,
    ).toMatchObject({
        phase: "waiting_provider",
        epoch: 1,
    });
    expect(generations).toBe(1);

    await f.t.action(internal.integrations.openRouterGeneration.reconcile, {
        providerCallId: original.call._id,
        attempt: 1,
    });
    await f.t.mutation(internal.execution.operations.wakeStructuredExecution, {
        ...args,
        epoch: 1,
    });
    const next = await f.t.run((ctx) => ctx.db.get(f.requestId));
    expect(next?.scheduledExecution).toMatchObject({
        phase: "queued",
        epoch: 2,
        firstInvocationId: original.call.invocationId,
    });
    expect(next?.deadlineAt).toBe(original.request?.deadlineAt);
    const late = { ...args, epoch: 1 };
    expect(
        await f.t.mutation(internal.execution.operations.recordResult, {
            ...late,
            outcome: { kind: "unavailable", code: "operation_interrupted" },
        }),
    ).toMatchObject({ kind: "refused", code: "stale_execution" });
    expect(
        await f.t.mutation(
            internal.execution.operations.settleDispatchFailure,
            {
                ...late,
                failure: {
                    category: "uncertain_effect",
                    code: "operation_interrupted",
                },
            },
        ),
    ).toMatchObject({ kind: "refused", code: "stale_execution" });
    expect(await f.t.run((ctx) => ctx.db.get(f.requestId))).toEqual(next);
    expect(
        await f.t.action(internal.sourcesMissionActions.execute, {
            ...args,
            epoch: 1,
        }),
    ).toBeNull();
    const outcome = await f.t.action(internal.sourcesMissionActions.execute, {
        ...args,
        epoch: 2,
    });
    expect(outcome).toMatchObject({
        kind: invalidSuccessor ? "waiting" : "success",
    });
    if (invalidSuccessor) {
        for (const epoch of [2, 1, 2])
            await f.t.mutation(
                internal.execution.operations.wakeStructuredExecution,
                { ...args, epoch },
            );
    }
    const final = await f.t.run(async (ctx) => ({
        request: await ctx.db.get(f.requestId),
        preparation: await ctx.db.get(f.preparationId),
        calls: await ctx.db.query("providerCalls").collect(),
    }));
    expect(final.request?.scheduledExecution).toMatchObject({
        phase: "finished",
        epoch: 2,
    });
    expect(final.preparation?.sourcesMission?.work).toEqual(
        original.preparation?.sourcesMission?.work,
    );
    expect(final.preparation?.sourcesMission?.qualifications).toHaveLength(
        invalidSuccessor ? 0 : 1,
    );
    if (invalidSuccessor)
        expect(final.request?.outcome).toMatchObject({
            kind: "unavailable",
            code: "explicit_recovery_required",
        });
    expect(final.calls).toHaveLength(2);
    expect(final.calls[0]).toMatchObject({
        inputHash: original.call.inputHash,
        operationEpoch: 1,
        providerObservation: {
            termination: {
                kind: "cancelled",
                generationId: "offline-recovery",
            },
        },
    });
    expect(final.calls[0]?.reportedCost).toBeUndefined();
    expect(final.calls[1]).toMatchObject({
        inputHash: original.call.inputHash,
        operationEpoch: 2,
        status: invalidSuccessor ? "failed" : "succeeded",
    });
    expect({ generations, lookups }).toEqual({ generations: 2, lookups: 1 });
});

test.each([
    false,
    true,
])("the analyst can pause and resume documentary work after reclaiming the slot (successor queued: %s)", async (successorQueued) => {
    const f = await fixture();
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
        }),
    );
    const client = f.t.withIdentity({ subject: f.userId });
    const originalFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
        if (init?.method === "GET")
            return Response.json({
                data: { id: "offline-pause", cancelled: true },
            });
        return new Response(
            `data: ${JSON.stringify({
                id: "offline-pause",
                model: "z-ai/glm-5.3-flash",
                choices: [
                    {
                        index: 0,
                        delta: { content: " ".repeat(4096) },
                        finish_reason: null,
                    },
                ],
            })}\n\n`,
            {
                headers: {
                    "content-type": "text/event-stream",
                    "x-generation-id": "offline-pause",
                },
            },
        );
    });
    vi.stubGlobal("fetch", originalFetch);
    const args = { requestId: f.requestId, expectedGeneration: 4 };
    expect(await dispatchSourcesOperation(f.t, args)).toMatchObject({
        kind: "waiting",
    });
    const before = await f.t.run(async (ctx) => ({
        run: await ctx.db.get(f.runId),
        call: await ctx.db.query("providerCalls").first(),
        request: await ctx.db.get(f.requestId),
        preparation: await ctx.db.get(f.preparationId),
    }));
    assert(before.run && before.call && before.request);
    const callId = before.call._id;
    const reconcile = () =>
        f.t.action(internal.integrations.openRouterGeneration.reconcile, {
            providerCallId: callId,
            attempt: 1,
        });
    if (successorQueued) {
        await reconcile();
        await f.t.mutation(
            internal.execution.operations.wakeStructuredExecution,
            { ...args, epoch: 1 },
        );
        expect(
            (await f.t.run((ctx) => ctx.db.get(f.requestId)))
                ?.scheduledExecution,
        ).toMatchObject({
            phase: "queued",
            epoch: 2,
        });
    }
    const paused = await client.mutation(api.execution.researchControl.pause, {
        runId: f.runId,
        expectedGeneration: 4,
    });
    expect(paused).toBe(successorQueued ? 4 : 5);
    if (successorQueued) {
        expect(
            await f.t.action(internal.sourcesMissionActions.execute, {
                ...args,
                epoch: 2,
            }),
        ).toBeNull();
    }
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "paused",
        researchPauseRequested: false,
        executionGeneration: 5,
    });
    if (!successorQueued) await reconcile();
    await f.t.mutation(internal.execution.operations.wakeStructuredExecution, {
        ...args,
        epoch: 1,
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.requestId))).toMatchObject({
        status: "waiting",
        deadlineAt: before.request.deadlineAt,
        scheduledExecution: {
            phase: "waiting_provider",
            epoch: 1,
            callId: before.call._id,
        },
    });
    expect(originalFetch).toHaveBeenCalledTimes(2);
    const queued = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        const { _id, _creationTime, ...record } = run;
        return ctx.db.insert("researchRuns", {
            ...record,
            executionStatus: "running",
        });
    });
    await expect(
        client.mutation(api.execution.researchControl.resume, {
            runId: f.runId,
            expectedGeneration: 5,
        }),
    ).rejects.toThrow("execution_slot_unavailable");
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "paused",
        executionGeneration: 5,
    });
    await f.t.run((ctx) => ctx.db.patch(queued, { executionStatus: "idle" }));
    mockControlReply("context_only");
    expect(
        await client.mutation(api.execution.researchControl.resume, {
            runId: f.runId,
            expectedGeneration: 5,
        }),
    ).toBe(6);
    await f.t.finishAllScheduledFunctions(
        () => vi.advanceTimersByTime(10),
        500,
    );
    const after = await f.t.run(async (ctx) => ({
        request: await ctx.db.get(f.requestId),
        prep: await ctx.db.get(f.preparationId),
        calls: await ctx.db.query("providerCalls").collect(),
    }));
    expect(after.request).toMatchObject({
        status: "completed",
        expectedGeneration: 4,
        outcome: { kind: "success" },
        scheduledExecution: {
            phase: "finished",
            epoch: successorQueued ? 3 : 2,
            dispatchGeneration: 6,
        },
    });
    expect(after.request?.deadlineAt).toBe(before.request.deadlineAt);
    expect(after.prep?.sourcesMission?.work).toEqual(
        before.preparation?.sourcesMission?.work,
    );
    expect(after.prep?.sourcesMission?.qualifications).toHaveLength(1);
    expect(
        after.calls.map(({ operationEpoch, executionGeneration }) => [
            operationEpoch,
            executionGeneration,
        ]),
    ).toEqual([
        [1, 4],
        [successorQueued ? 3 : 2, 6],
    ]);
});

test("the owned wake closes an abandoned generation after an abandoned lookup is reclaimed", async () => {
    const f = await fixture();
    const deadlineAt = Date.now() + SOURCES_QUALIFICATION_RESEARCH_WINDOW_MS;
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.missionId, { deadlineAt });
        await ctx.db.patch(f.requestId, { deadlineAt });
        await ctx.db.patch(f.preparationId, {
            deadlineAt,
            leaseExpiresAt: deadlineAt,
        });
    });
    let generations = 0;
    let lookups = 0;
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
        if (init?.method === "GET") {
            lookups++;
            return Response.json({
                data: { id: "offline-abandoned-worker", cancelled: true },
            });
        }
        generations++;
        if (generations > 1) return documentaryReply(init);
        return new Response("data: [DONE]\n\n", {
            headers: {
                "content-type": "text/event-stream",
                "x-generation-id": "offline-abandoned-worker",
            },
        });
    });
    const args = { requestId: f.requestId, expectedGeneration: 4, epoch: 1 };
    await dispatchFixtureOperation(f.t, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    const execute = await registeredSourcesWorker();
    let lost = false;
    await expect(
        f.t.action(async (ctx) =>
            execute._handler(
                {
                    ...ctx,
                    async runMutation(reference, ...mutationArgs) {
                        const name = getFunctionName(reference);
                        if (
                            name ===
                            "execution/operations:settleDispatchFailure"
                        )
                            throw new Error("Worker terminated");
                        const result = await ctx.runMutation(
                            reference,
                            ...mutationArgs,
                        );
                        if (
                            !lost &&
                            name ===
                                getFunctionName(
                                    internal.execution.providerCallReceipts
                                        .observeGeneration,
                                )
                        ) {
                            lost = true;
                            throw new Error(
                                "Worker terminated after provider observation",
                            );
                        }
                        return result;
                    },
                },
                args,
            ),
        ),
    ).rejects.toThrow("Worker terminated");
    expect(lost).toBe(true);
    const started = await f.t.run(async (ctx) => ({
        request: await ctx.db.get(f.requestId),
        call: await ctx.db.query("providerCalls").first(),
    }));
    const active = started.request?.scheduledExecution;
    assert(active?.phase === "running" && active.wakeId && started.call);
    expect(started.call).toMatchObject({
        status: "started",
        billing: { state: "pending" },
    });
    await f.t.mutation(internal.providerCalls.claimBilling, {
        providerCallId: started.call._id,
        attempt: 1,
    });
    const callId = started.call._id;
    const wakeId = active.wakeId;
    const checking = await f.t.run((ctx) => ctx.db.get(callId));
    assert(checking?.billing?.retryAt && checking.billing.wakeId);
    vi.setSystemTime(checking.billing.retryAt);
    await f.t.action(internal.integrations.openRouterGeneration.reconcile, {
        providerCallId: started.call._id,
        attempt: 2,
    });
    await f.t.mutation(internal.providerCalls.settleBilling, {
        providerCallId: started.call._id,
        attempt: 1,
        generationId: "offline-abandoned-worker",
        cost: 0.5,
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(callId)))?.reportedCost,
    ).toBeUndefined();
    await f.t.mutation(
        internal.execution.operations.wakeStructuredExecution,
        args,
    );
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.requestId)))?.scheduledExecution
            ?.phase,
    ).toBe("running");
    expect(generations).toBe(1);

    vi.setSystemTime(active.platformDeadlineAt);
    const wake = await f.t.run((ctx) => ctx.db.system.get(wakeId));
    expect(wake?.scheduledTime).toBe(active.platformDeadlineAt);
    await f.t.mutation(
        internal.execution.operations.wakeStructuredExecution,
        args,
    );
    expect(await f.t.run((ctx) => ctx.db.get(callId))).toMatchObject({
        status: "failed",
        errorCode: "structured_result_unavailable",
        billing: { state: "unavailable", attempt: 2 },
        providerObservation: { termination: { kind: "cancelled" } },
    });
    const pending = (await f.t.run((ctx) => ctx.db.get(f.requestId)))
        ?.scheduledExecution;
    assert(pending?.phase === "queued" && pending.epoch === 2);
    await f.t.mutation(
        internal.execution.operations.wakeStructuredExecution,
        args,
    );
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.requestId)))?.scheduledExecution,
    ).toEqual(pending);
    expect(
        await f.t.action(internal.sourcesMissionActions.execute, {
            ...args,
            epoch: 2,
        }),
    ).toMatchObject({ kind: "success" });
    expect(generations).toBe(2);
    const end = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(
        end?.sourcesMission?.work.filter(
            (item) => item.requestId === f.requestId,
        ),
    ).toHaveLength(1);
    expect(end?.sourcesMission?.qualifications).toHaveLength(1);
    expect(lookups).toBe(1);
});

test("a boundary-crossing raw delta aborts before its retained append acknowledgement", async () => {
    const f = await fixture();
    const received = " ".repeat(4096) + "x".repeat(64000);
    let aborted = false;
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
        init?.signal?.addEventListener(
            "abort",
            () => {
                aborted = true;
            },
            { once: true },
        );
        return new Response(
            `data: ${JSON.stringify({
                id: "offline-delayed-append",
                model: "z-ai/glm-5.3-flash",
                choices: [
                    {
                        index: 0,
                        delta: { content: received },
                        finish_reason: null,
                    },
                ],
            })}\n\n`,
            { headers: { "content-type": "text/event-stream" } },
        );
    });
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
        enter = resolve;
    });
    const delayed = new Promise<void>((resolve) => {
        release = resolve;
    });
    const args = { requestId: f.requestId, expectedGeneration: 4, epoch: 1 };
    await dispatchFixtureOperation(f.t, {
        requestId: f.requestId,
        expectedGeneration: 4,
    });
    const execute = await registeredSourcesWorker();
    let held = false;
    const worker = f.t.action(async (ctx) =>
        execute._handler(
            {
                ...ctx,
                async runMutation(reference, ...mutationArgs) {
                    const result = await ctx.runMutation(
                        reference,
                        ...mutationArgs,
                    );
                    if (
                        !held &&
                        getFunctionName(reference) ===
                            "execution/invocationLifecycle:appendVisibleOutput"
                    ) {
                        held = true;
                        enter();
                        await delayed;
                    }
                    return result;
                },
            },
            args,
        ),
    );
    await entered;
    try {
        expect(aborted).toBe(true);
    } finally {
        release();
    }
    expect(await worker).toMatchObject({ kind: "waiting" });
    const visible = await f.t.run(async (ctx) => {
        const call = await ctx.db.query("providerCalls").first();
        const invocation = call?.invocationId
            ? await ctx.db.get(call.invocationId)
            : null;
        return invocation?.visibleOutput;
    });
    assert(visible?.textId);
    expect(await readRetainedBody(f.t, visible.textId)).toBe(received);
});
