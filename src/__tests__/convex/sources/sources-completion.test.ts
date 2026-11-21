import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { documentaryReference } from "@convex/domain/savedMaterialOperations";
import type { SourcesPreparation } from "@convex/domain/sourcesContracts";
import { executionFailureCode } from "@convex/execution/errors";
import { MAX_OPERATION_RESULT_BYTES } from "@convex/resourcePolicy";
import { workflow } from "@convex/workflow";
import { afterEach, assert, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { installModel } from "@/__tests__/setup/model-configuration";
import { providerFixtureResponse } from "@/__tests__/setup/model-stream";
import {
    dispatchSourcesOperation,
    seedObservedSources,
    startSourcesOperation,
} from "@/__tests__/setup/sources-mission";

vi.mock("node:dns/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:dns/promises")>();
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    return { ...actual, default: { ...actual, lookup }, lookup };
});

const examiner = vi.hoisted(() => vi.fn());
vi.mock("@convex/integrations/documentaryControl", () => ({
    examineDocumentaryContributions: examiner,
}));
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    examiner.mockReset();
});

async function seedCompletion() {
    const f = await seedObservedSources();
    const framingId = await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        const id = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Workflow", questions: [] },
            requestKey: "completion",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            fixedFramingRevisionId: id,
        });
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                envelope: {
                    ...preparation.sourcesMission.envelope,
                    maxNeeds: 160,
                    controls: 160,
                },
            },
        });
        return id;
    });
    const messageId = await f.t
        .withIdentity({ subject: f.userId })
        .mutation(api.execution.conversations.submit, {
            runId: f.runId,
            requestKey: "completion",
            text: "Inspect the documentary foundation",
            delivery: "queue",
        });
    const invocation = await f.t.mutation(
        internal.execution.invocations.begin,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            taskKey: "source-completion",
            provenance: "simulation",
        },
    );
    assert(invocation.kind === "ready");
    return {
        ...f,
        framingId,
        messageId,
        invocationId: invocation.invocationId,
    };
}

async function queueInstructions(
    f: Awaited<ReturnType<typeof seedCompletion>>,
    texts: string[],
) {
    return f.t.run(async (ctx) => {
        const ids: Id<"workbenchInstructions">[] = [];
        for (const [i, interpretedNeed] of texts.entries()) {
            const requestId = await ctx.db.insert("agentOperationRequests", {
                runId: f.runId,
                actor: "agent",
                cause: `instruction-${i}`,
                input: {
                    kind: "transmit_source_request",
                    messageId: f.messageId,
                    interpretedNeed,
                    coverageRole: null,
                },
                operationVersion: 1,
                expectedGeneration: 4,
                logicalKey: `${texts.length}:${i}`,
                status: "completed",
                createdAt: i + 1,
            });
            ids.push(
                await ctx.db.insert("workbenchInstructions", {
                    runId: f.runId,
                    requestId,
                    messageId: f.messageId,
                    interpretedNeed,
                    framingRevisionId: f.framingId,
                    status: "waiting",
                    outcome: "Waiting",
                    createdAt: i + 1,
                }),
            );
        }
        return ids;
    });
}

function completion(
    data: SourcesPreparation,
    explanation = "Documentary examination remains unfinished.",
) {
    return {
        kind: "complete" as const,

        needs: data.needs.map((need) => ({
            needId: need.id,
            unfinished: [explanation],
        })),
    };
}

test.each([
    "invocation",
    "fallback",
] as const)("claimed native work holds %s completion before its reservation", async (path) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = await seedCompletion();
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "claimed-before-reservation",
            input: {
                kind: "request_documentary_check",
                needId: "common-context",
                sourceId: f.sourceId,
                proposition: "Context",
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
    const before = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    assert(before?.sourcesMission);
    expect(before.sourcesMission.work).toEqual([]);
    if (path === "fallback")
        await f.t.run((ctx) =>
            ctx.db.patch(f.missionId, {
                status: "blocked",
                blockCode: "resource_limit",
            }),
        );
    const outcome =
        path === "fallback"
            ? await f.t.mutation(internal.sourcesMission.finish, {
                  preparationId: f.preparationId,
                  missionId: f.missionId,
                  expectedGeneration: 4,
              })
            : await f.t.mutation(internal.execution.invocations.finish, {
                  invocationId: f.invocationId,
                  expectedGeneration: 4,
                  response: completion(before.sourcesMission),
              });
    expect(outcome).toMatchObject(
        path === "fallback"
            ? { kind: "waiting" }
            : { kind: "blocked", code: "pending_operations" },
    );
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission,
    ).toMatchObject({ controls: 0, work: [] });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.result,
    ).toBeUndefined();
    await f.t.mutation(internal.sourcesMission.reserve, {
        requestId,
        expectedGeneration: 4,
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission,
    ).toMatchObject({ controls: 1, work: [{ requestId }] });
});

test.each([
    1, 21,
])("completion preserves waiting instructions and reuses its retained response (queued: %s)", async (count) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = await seedCompletion();
    if (count === 21)
        await f.t.run(async (ctx) => {
            const p = await ctx.db.get(f.preparationId);
            assert(p?.sourcesMission);
            await ctx.db.patch(p._id, {
                sourcesMission: {
                    ...p.sourcesMission,
                    envelope: { ...p.sourcesMission.envelope, maxNeeds: 1 },
                },
            });
        });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "engaged",
            input: {
                kind: "request_documentary_check",
                needId: "common-context",
                sourceId: f.sourceId,
                proposition: "Context",
                evidence: [
                    {
                        readRequestId: f.nativeReadRequestId,
                        passageOrder: f.passage.order,
                    },
                ],
            },
        },
    );
    await startSourcesOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    await f.t.mutation(internal.sourcesMission.reserve, {
        requestId,
        expectedGeneration: 4,
    });
    const ids = await queueInstructions(
        f,
        Array.from({ length: count }, (_, i) => `Inspect need ${i}`),
    );
    await f.t.mutation(internal.workbench.processInstructions, {
        runId: f.runId,
    });
    const p = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    assert(p?.sourcesMission);
    const originalNotes = (await f.t.run((ctx) => ctx.db.get(f.missionId)))
        ?.workingNotes;
    const response = {
        ...completion(p.sourcesMission),
        workingNotes: "Retained completion note.",
    };
    if (count === 21)
        await f.t.mutation(internal.execution.operations.recordResult, {
            requestId,
            expectedGeneration: 4,
            outcome: { kind: "unavailable", code: "missing_configuration" },
        });
    const first = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: f.invocationId,
        expectedGeneration: 4,
        response,
    });
    expect(first).toMatchObject({
        kind: "blocked",
        code: "pending_operations",
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.result,
    ).toBeUndefined();
    expect((await f.t.run((ctx) => ctx.db.get(f.missionId)))?.status).toBe(
        "running",
    );
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.workingNotes,
    ).toBe(originalNotes);
    if (count === 1) {
        expect(
            await f.t.mutation(internal.execution.invocations.finish, {
                invocationId: f.invocationId,
                expectedGeneration: 4,
                response,
            }),
        ).toMatchObject({ kind: "blocked", code: "pending_operations" });
        expect(
            (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.workingNotes,
        ).toBe(originalNotes);
    }
    if (count === 1)
        await f.t.mutation(internal.execution.operations.recordResult, {
            requestId,
            expectedGeneration: 4,
            outcome: { kind: "unavailable", code: "missing_configuration" },
        });
    const second = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: f.invocationId,
        expectedGeneration: 4,
        response,
    });
    expect(second).toMatchObject({
        kind: "blocked",
        code: "mission_context_changed",
    });
    if (count === 21) {
        const fresh = await f.t.mutation(internal.execution.invocations.begin, {
            missionId: f.missionId,
            expectedGeneration: 4,
            taskKey: "drained-instructions",
            provenance: "simulation",
        });
        assert(fresh.kind === "ready");
        expect(
            await f.t.mutation(internal.execution.invocations.finish, {
                invocationId: fresh.invocationId,
                expectedGeneration: 4,
                response: completion(p.sourcesMission),
            }),
        ).toMatchObject({ kind: "completed" });
    }
    const instructions = await f.t.run((ctx) =>
        Promise.all(ids.map((id) => ctx.db.get(id))),
    );
    expect(
        instructions.every(
            (row) => row?.status === (count === 21 ? "limited" : "transmitted"),
        ),
    ).toBe(true);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.controls,
    ).toBe(1);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.workingNotes?.split(
            "Retained completion note.",
        ),
    ).toHaveLength(2);
});

test("analyst settlement waits for native qualification and receives its existing operation event", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    const f = await seedCompletion();
    workflowTest.register(f.t);
    await installModel(
        f.t,
        { model: "z-ai/glm-5.3-flash", reasoningEffort: "low" },
        "sources",
    );
    await f.t.run(async (ctx) => {
        const id = await workflow.start(ctx, internal.researchWorkflow.run, {
            runId: f.runId,
            executionGeneration: 4,
        });
        await ctx.db.patch(f.runId, { workflowId: id });
        return id;
    });
    let enter: () => void = () => {};
    let release: () => void = () => {};
    const entered = new Promise<void>((resolve) => {
        enter = resolve;
    });
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    examiner.mockImplementation(async (input, route, dependencies) => {
        await dependencies.beforeDispatch(
            JSON.stringify({ model: route.model, fixture: true }),
            { effectiveMaxOutputTokens: route.descriptor.maxTokens },
        );
        enter();
        await held;
        return {
            status: "succeeded",
            model: route.model,
            latencyMs: 1,
            dispatchOutcome: "response_received",
            output: {
                coherence: true,
                limitations: [],
                findings: input.contributions.map((c: { id: string }) => ({
                    contributionId: c.id,
                    conclusion: "supported",
                    permittedUse: "context_only",
                    diagnostic: "Controlled context.",
                })),
            },
        };
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "native-result",
            input: {
                kind: "submit_documentary_qualification",
                sourceId: f.sourceId,
                captureId: f.captureId,
                expectedTaskId: null,
                changes: [
                    {
                        contribution: {
                            needIds: ["common-context"],
                            statement: "Context",
                            period: "undated",
                            modality: "reported",
                            attribution: "publisher",
                            kind: "context",
                            evidence: [
                                {
                                    readRequestId: f.nativeReadRequestId,
                                    passageOrder: f.passage.order,
                                },
                            ],
                        },
                    },
                ],
            },
        },
    );
    const processing = dispatchSourcesOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    await entered;
    try {
        await f.t.run(async (ctx) => {
            await ctx.db.patch(f.missionId, {
                status: "blocked",
                blockCode: "resource_limit",
            });
            await ctx.db.patch(f.preparationId, {
                settlementRequestedAt: Date.now(),
            });
        });
        expect(
            await f.t.mutation(internal.sourcesMission.finish, {
                preparationId: f.preparationId,
                missionId: f.missionId,
                expectedGeneration: 4,
            }),
        ).toMatchObject({ kind: "waiting" });
        const waiting = await f.t.mutation(internal.sourcesMission.finish, {
            preparationId: f.preparationId,
            missionId: f.missionId,
            expectedGeneration: 4,
        });
        assert(waiting?.kind === "waiting" && waiting.eventId);
        expect(
            (await f.t.run((ctx) => ctx.db.get(requestId)))?.waitEventId,
        ).toBe(waiting.eventId);
        expect(
            (await f.t.run((ctx) => ctx.db.get(f.runId)))?.executionStatus,
        ).toBe("running");
    } finally {
        release();
        await processing;
    }
    expect((await f.t.run((ctx) => ctx.db.get(requestId)))?.waitNotified).toBe(
        true,
    );
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.qualifications,
    ).toHaveLength(1);
    expect(
        await f.t.mutation(internal.sourcesMission.finish, {
            preparationId: f.preparationId,
            missionId: f.missionId,
            expectedGeneration: 4,
        }),
    ).toBeNull();
    expect((await f.t.run((ctx) => ctx.db.get(f.runId)))?.lifecycleState).toBe(
        "sources_prepared",
    );
});

test.each([
    "before reservation",
    "during retrieval",
] as const)("terminal Sources settlement waits for a claimed acquisition %s", async (stage) => {
    vi.useFakeTimers();
    const f = await seedCompletion();
    await f.t.run((ctx) => ctx.db.patch(f.missionId, { definitionVersion: 7 }));
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "acquisition-before-reservation",
            input: {
                kind: "acquire_document",
                reference: documentaryReference({
                    issuer: "source",
                    sourceId: f.sourceId,
                }),
            },
        },
    );
    const args = { requestId, expectedGeneration: 4 };
    let enter: () => void = () => {};
    let release: () => void = () => {};
    const entered = new Promise<void>((resolve) => {
        enter = resolve;
    });
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    let processing: ReturnType<typeof dispatchSourcesOperation> | undefined;
    if (stage === "during retrieval") {
        vi.stubEnv("EXA_API_KEY", "fixture-only");
        const source = await f.t.run((ctx) => ctx.db.get(f.sourceId));
        assert(source);
        vi.stubGlobal("fetch", async (url: string) => {
            expect(url).toMatch(/\/contents$/u);
            enter();
            await held;
            return providerFixtureResponse({
                results: [
                    {
                        id: source.canonicalUrl,
                        url: source.canonicalUrl,
                        text: "The publication describes enterprise workflow approvals.",
                    },
                ],
            });
        });
        processing = dispatchSourcesOperation(f.t, args);
        await Promise.race([
            entered,
            processing.then((outcome) => {
                throw new Error(
                    `Acquisition settled before retrieval: ${JSON.stringify(outcome)}`,
                );
            }),
        ]);
    } else {
        expect(await startSourcesOperation(f.t, args)).toMatchObject({
            kind: "outcome",
            outcome: { kind: "waiting" },
        });
    }
    const settle = () =>
        f.t.mutation(internal.sourcesMission.finish, {
            preparationId: f.preparationId,
            missionId: f.missionId,
            expectedGeneration: 4,
        });
    try {
        await f.t.run(async (ctx) => {
            await ctx.db.patch(f.missionId, {
                status: "blocked",
                blockCode: "resource_limit",
            });
            await ctx.db.patch(f.preparationId, {
                settlementRequestedAt: Date.now(),
            });
        });
        expect(await settle()).toMatchObject({ kind: "waiting" });
        expect(
            (await f.t.run((ctx) => ctx.db.get(f.preparationId)))
                ?.sourcesMission?.result,
        ).toBeUndefined();
    } finally {
        release();
        await processing;
    }
    if (!processing)
        await f.t.mutation(internal.execution.operations.recordResult, {
            ...args,
            outcome: { kind: "unavailable", code: "missing_configuration" },
        });
    if (stage === "during retrieval") {
        const turnId = await f.t.mutation(
            internal.execution.conversations.claimTurn,
            { runId: f.runId, single: true },
        );
        assert(turnId);
        const workbenchId = await f.t.mutation(
            internal.execution.missions.start,
            {
                runId: f.runId,
                definitionId: "workbench_v1",
                scope: { kind: "workbench_v1" },
                conversationTurnId: turnId,
                expectedGeneration: 1,
                requestKey: "workbench-settlement-consultation",
            },
        );
        const context = await f.t.query(internal.execution.context.build, {
            missionId: workbenchId,
            expectedGeneration: 1,
        });
        assert(context.kind === "ready");
        const material = JSON.parse(context.inputJson).domain
            .availableMaterials[0];
        const readId = await f.t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId: workbenchId,
                expectedGeneration: 1,
                cause: "concurrent-workbench-read",
                input: {
                    kind: "read_in_context",
                    reference: material.readingReferences[0].reference,
                },
            },
        );
        expect(
            await f.t.mutation(internal.execution.operations.claim, {
                requestId: readId,
                expectedGeneration: 1,
            }),
        ).toMatchObject({ kind: "execute" });
        expect(await f.t.run((ctx) => ctx.db.get(readId))).toMatchObject({
            status: "running",
            pin: {
                scope: {
                    kind: "workbench_read",
                    preparationId: f.preparationId,
                },
            },
        });
    }
    expect(await settle()).toBeNull();
    expect((await f.t.run((ctx) => ctx.db.get(f.runId)))?.lifecycleState).toBe(
        "sources_prepared",
    );
});

test("reservation admission preserves the shared completion response ceiling before consuming allowance", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = await seedCompletion();
    await queueInstructions(
        f,
        Array.from({ length: 79 }, (_, i) => `Initial need ${i}`),
    );
    for (let i = 0; i < 4; i++)
        await f.t.mutation(internal.workbench.processInstructions, {
            runId: f.runId,
        });
    const initial = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    assert(initial?.sourcesMission);
    const needIds = initial.sourcesMission.needs.map((n) => n.id);
    let admitted = 0;
    for (let i = 0; i < 24; i++) {
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueueNative,
            {
                runId: f.runId,
                expectedGeneration: 4,
                cause: `control-${i}`,
                input: {
                    kind: "submit_documentary_qualification",
                    sourceId: f.sourceId,
                    captureId: f.captureId,
                    expectedTaskId: null,
                    changes: [
                        {
                            contribution: {
                                needIds,
                                statement: `Context ${i}`,
                                period: "undated",
                                modality: "reported",
                                attribution: "publisher",
                                kind: "context",
                                evidence: [
                                    {
                                        readRequestId: f.nativeReadRequestId,
                                        passageOrder: f.passage.order,
                                    },
                                ],
                            },
                        },
                    ],
                },
            },
        );
        await startSourcesOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        });
        try {
            await f.t.mutation(internal.sourcesMission.reserve, {
                requestId,
                expectedGeneration: 4,
            });
        } catch (error) {
            expect(executionFailureCode(error)).toBe(
                "sources_response_capacity",
            );
            await f.t.mutation(internal.execution.operations.recordResult, {
                requestId,
                expectedGeneration: 4,
                outcome: {
                    kind: "unavailable",
                    code: "sources_response_capacity",
                },
            });
            break;
        }
        admitted++;
        await f.t.mutation(internal.execution.operations.recordResult, {
            requestId,
            expectedGeneration: 4,
            outcome: { kind: "unavailable", code: "missing_configuration" },
        });
    }
    expect(admitted).toBeGreaterThan(1);
    expect(admitted).toBeLessThan(24);
    const p = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    assert(p?.sourcesMission);
    expect(p.sourcesMission.controls).toBe(admitted);
    const response = completion(
        p.sourcesMission,
        "A short explanation of the technically unfinished documentary examination.",
    );
    expect(
        new TextEncoder().encode(JSON.stringify(response)).length,
    ).toBeLessThanOrEqual(MAX_OPERATION_RESULT_BYTES);
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: f.invocationId,
            expectedGeneration: 4,
            response,
        }),
    ).toMatchObject({ kind: "blocked", code: "mission_context_changed" });
    const fresh = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "fresh-capacity-completion",
        provenance: "simulation",
    });
    assert(fresh.kind === "ready");
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: fresh.invocationId,
            expectedGeneration: 4,
            response,
        }),
    ).toMatchObject({ kind: "completed" });
});

test("unqualified work retains storage headroom for unfinished explanations through real completion", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = await seedCompletion();
    await queueInstructions(
        f,
        Array.from(
            { length: 159 },
            (_, i) => `${String(i).padStart(4, "0")}${"界".repeat(1996)}`,
        ),
    );
    for (let i = 0; i < 8; i++)
        await f.t.mutation(internal.workbench.processInstructions, {
            runId: f.runId,
        });
    for (let i = 0; i < 160; i++) {
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueueNative,
            {
                runId: f.runId,
                expectedGeneration: 4,
                cause: `check-${i}`,
                input: {
                    kind: "request_documentary_check",
                    needId: "common-context",
                    sourceId: f.sourceId,
                    proposition: `Context ${i}`,
                    evidence: [
                        {
                            readRequestId: f.nativeReadRequestId,
                            passageOrder: f.passage.order,
                        },
                    ],
                },
            },
        );
        await startSourcesOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        });
        try {
            await f.t.mutation(internal.sourcesMission.reserve, {
                requestId,
                expectedGeneration: 4,
            });
        } catch (error) {
            expect([
                "sources_result_capacity",
                "sources_response_capacity",
            ]).toContain(executionFailureCode(error));
            await f.t.mutation(internal.execution.operations.recordResult, {
                requestId,
                expectedGeneration: 4,
                outcome: {
                    kind: "unavailable",
                    code:
                        executionFailureCode(error) ??
                        "sources_result_capacity",
                },
            });
            break;
        }
        await f.t.mutation(internal.execution.operations.recordResult, {
            requestId,
            expectedGeneration: 4,
            outcome: { kind: "unavailable", code: "missing_configuration" },
        });
    }
    const p = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    assert(p?.sourcesMission);
    expect(p.sourcesMission.qualifications).toEqual([]);
    const response = completion(p.sourcesMission, "x".repeat(200));
    expect(
        new TextEncoder().encode(JSON.stringify(response)).length,
    ).toBeLessThanOrEqual(MAX_OPERATION_RESULT_BYTES);
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: f.invocationId,
            expectedGeneration: 4,
            response,
        }),
    ).toMatchObject({ kind: "blocked", code: "mission_context_changed" });
    const fresh = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "fresh-capacity-completion",
        provenance: "simulation",
    });
    expect(fresh.kind).toBe("ready");
    if (fresh.kind === "ready")
        expect(Buffer.byteLength(fresh.inputJson)).toBeGreaterThan(128 * 1024);
    // Native estimation is covered by the Pi capacity regression; this fixture drives its typed stop into Sources finalization.
    await f.t.run((ctx) =>
        ctx.db.patch(f.missionId, {
            status: "blocked",
            blockCode: "context_capacity",
        }),
    );

    expect(
        await f.t.mutation(internal.sourcesMission.finish, {
            preparationId: f.preparationId,
            missionId: f.missionId,
            expectedGeneration: 4,
        }),
    ).toEqual({ kind: "waiting" });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.result,
    ).toBeUndefined();
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "paused",
        pauseReason: "execution_interrupted",
    });
});
