import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { completeSources } from "@convex/domain/sources";
import type { SourcesOperation } from "@convex/domain/sourcesContracts";
import { executionFailureCode } from "@convex/execution/errors";
import { extractObservedDestinations } from "@convex/integrations/evidenceNormalization";
import { afterEach, assert, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import {
    recordDocumentaryRead,
    seedObservedSources,
} from "@/__tests__/setup/sources-mission";

const examiner = vi.hoisted(() => vi.fn());
vi.mock("@convex/integrations/documentaryControl", () => ({
    examineDocumentaryContributions: examiner,
}));
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    examiner.mockReset();
});

async function seedInstructionPreparation() {
    const f = await seedObservedSources();
    const framingId = await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        const id = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Workflow", questions: [] },
            requestKey: "instruction-capacity",
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
            requestKey: "instruction-capacity",
            text: "Research the documentary needs for this activity",
            delivery: "queue",
        });
    return { ...f, framingId, messageId };
}

async function registerInstructions(
    f: Awaited<ReturnType<typeof seedInstructionPreparation>>,
    prefix: string,
    information: string[],
) {
    return f.t.run(async (ctx) => {
        const ids = [];
        for (const [i, interpretedNeed] of information.entries()) {
            const requestId = await ctx.db.insert("agentOperationRequests", {
                runId: f.runId,
                actor: "agent",
                cause: `${prefix}-${i}`,
                input: {
                    kind: "transmit_source_request",
                    messageId: f.messageId,
                    interpretedNeed,
                    coverageRole: null,
                },
                operationVersion: 1,
                expectedGeneration: 4,
                logicalKey: `${prefix}-${i}`,
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

test.each([
    { documentCount: 3, needCount: 80, large: false },
    { documentCount: 48, needCount: 2, large: true },
])("need admission preserves controlled material through fallback after context-capacity refusal: %j", async ({
    documentCount,
    needCount,
    large,
}) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    const f = await seedInstructionPreparation();
    await installModel(
        f.t,
        { model: "z-ai/glm-5.3-flash", reasoningEffort: "low" },
        "sources",
    );
    await registerInstructions(
        f,
        "initial",
        Array.from(
            { length: needCount - 1 },
            (_, i) => `Document activity ${i}`,
        ),
    );
    for (let i = 0; i < Math.ceil((needCount - 1) / 20); i++)
        await f.t.mutation(internal.workbench.processInstructions, {
            runId: f.runId,
        });
    const starting = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    assert(starting?.sourcesMission);
    const originalNeeds = starting.sourcesMission.needs.map((n) => n.id);
    expect(originalNeeds).toHaveLength(needCount);
    const documents = await f.t.run(async (ctx) => {
        const original = await ctx.db.get(f.captureId);
        const preparation = await ctx.db.get(f.preparationId);
        assert(original && preparation?.sourcesMission);
        const { _id, _creationTime, ...capture } = original;
        if (large) {
            capture.observedDestinations = extractObservedDestinations(
                Array.from(
                    { length: 64 },
                    (_, i) =>
                        `<a href="https://example.com/${i}/${"🦉".repeat(150)}${"a".repeat(200)}">Guide</a>`,
                ).join("\n"),
                "https://example.com",
            );
            await ctx.db.patch(f.captureId, {
                observedDestinations: capture.observedDestinations,
            });
        }
        const {
            _id: _passageId,
            _creationTime: _passageTime,
            ...passage
        } = f.passage;
        const documents = [{ sourceId: f.sourceId, captureId: f.captureId }];
        for (let i = 1; i < documentCount; i++) {
            const sourceId = await ctx.db.insert("sources", {
                runId: f.runId,
                canonicalUrl: `https://example.com/instruction-capacity-${i}`,
                title: `Document ${i}`,
                origin: "exa",
                category: "research_lead",
                createdAt: 1,
            });
            const captureId = await ctx.db.insert("sourceCaptures", {
                ...capture,
                sourceId,
                captureKey: `instruction-capacity-${i}`,
            });
            await ctx.db.insert("sourceSearchPassages", {
                ...passage,
                sourceId,
                captureId,
            });
            documents.push({ sourceId, captureId });
        }
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                captureIds: documents.map((d) => d.captureId),
            },
        });
        return documents;
    });
    examiner.mockImplementation(async (input, route, dependencies) => {
        await dependencies.beforeDispatch(
            JSON.stringify({ model: route.model, fixture: true }),
            { effectiveMaxOutputTokens: route.descriptor.maxTokens },
        );
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
    const requestIds: Id<"agentOperationRequests">[] = [];
    for (const document of documents) {
        const readRequestId = await f.t.run((ctx) =>
            recordDocumentaryRead(ctx, {
                runId: f.runId,
                captureId: document.captureId,
                evidence: [
                    {
                        passageOrder: f.passage.order,
                        quotation: f.passage.quotation,
                    },
                ],
            }),
        );
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueueNative,
            {
                runId: f.runId,
                expectedGeneration: 4,
                cause: `qualify-${document.sourceId}`,
                input: {
                    kind: "submit_documentary_qualification",
                    ...document,
                    expectedTaskId: null,
                    changes: Array.from({ length: 15 }, (_, i) => ({
                        contribution: {
                            needIds: originalNeeds,
                            statement: `Context ${i}`,
                            period: "undated",
                            modality: "reported",
                            attribution: "publisher",
                            kind: "context" as const,
                            evidence: [
                                {
                                    readRequestId,
                                    passageOrder: f.passage.order,
                                },
                            ],
                        },
                    })),
                },
            },
        );
        const outcome = await f.t.action(
            internal.execution.operations.dispatch,
            {
                requestId,
                expectedGeneration: 4,
            },
        );
        if (large && outcome.kind !== "success") {
            expect(outcome).toMatchObject({
                kind: "unavailable",
                code: "source_review_capacity",
            });
            break;
        }
        expect(outcome).toMatchObject({ kind: "success" });
        requestIds.push(requestId);
    }
    const before = await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        const result = await completeSources(ctx, f.preparationId, {
            kind: "complete",
            needsRevision: preparation.sourcesMission.needsRevision,
            needs: originalNeeds.map((needId) => ({
                needId,
                unfinished: [],
                workRequestIds: requestIds,
            })),
        });
        await ctx.db.patch(f.preparationId, {
            sourcesMission: preparation.sourcesMission,
        });
        return result;
    });
    expect(before.documents).toHaveLength(requestIds.length);
    expect(requestIds.length).toBeGreaterThan(2);

    const instructionIds = await registerInstructions(
        f,
        "additional",
        Array.from(
            { length: 160 - needCount },
            (_, i) => "研究".repeat(995) + String(i).padStart(10, "0"),
        ),
    );
    for (let i = 0; i < Math.ceil((160 - needCount) / 20); i++)
        await f.t.run((ctx) =>
            ctx.runMutation(
                internal.workbench.processInstructions,
                { runId: f.runId },
                {
                    transactionLimits: {
                        bytesRead: 16 * 1024 * 1024,
                        databaseQueries: 4096,
                    },
                },
            ),
        );
    const instructions = await f.t.run((ctx) =>
        Promise.all(instructionIds.map((id) => ctx.db.get(id))),
    );
    const transmitted = instructions.filter((i) => i?.status === "transmitted");
    const limited = instructions.filter((i) => i?.status === "limited");
    expect(transmitted.length).toBeGreaterThan(0);
    expect(limited.length).toBeGreaterThan(0);
    expect(transmitted.length + limited.length).toBe(instructionIds.length);
    for (const instruction of limited) {
        expect(instruction?.outcome).toMatch(/remaining|capacity|allowance/i);
        expect(instruction?.outcome).not.toMatch(
            /sources_result_capacity|source_review_capacity|processInstructions|preparationId/,
        );
        expect(instruction?.needId).toBeUndefined();
    }
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    assert(preparation?.sourcesMission);
    const data = preparation.sourcesMission;
    expect(data.needs).toHaveLength(originalNeeds.length + transmitted.length);
    const invocation = await f.t.mutation(
        internal.execution.invocations.begin,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            taskKey: "need-capacity-completion",
            provenance: "simulation",
        },
    );
    expect(invocation.kind).toBe("ready");
    if (invocation.kind === "ready")
        expect(Buffer.byteLength(invocation.inputJson)).toBeGreaterThan(
            128 * 1024,
        );
    // Native estimation is covered by the Pi capacity regression; this fixture drives its typed stop into Sources finalization.
    await f.t.run((ctx) =>
        ctx.db.patch(f.missionId, {
            status: "blocked",
            blockCode: "context_capacity",
        }),
    );

    const [lastInstruction] = await registerInstructions(
        f,
        "during-completion",
        [`${"研究".repeat(995)}0000000000`],
    );
    assert(lastInstruction);
    const completion = await f.t.run((ctx) =>
        ctx.runMutation(
            internal.sourcesMission.finish,
            {
                preparationId: f.preparationId,
                missionId: f.missionId,
                expectedGeneration: 4,
            },
            {
                transactionLimits: {
                    bytesRead: 16 * 1024 * 1024,
                    databaseQueries: 4096,
                },
            },
        ),
    );
    expect(completion).toBeNull();
    expect((await f.t.run((ctx) => ctx.db.get(lastInstruction)))?.status).toBe(
        "limited",
    );
    const result = (await f.t.run((ctx) => ctx.db.get(f.preparationId)))
        ?.sourcesMission?.result;
    assert(result);
    expect(result.outcome).toBe("partial");
    expect(result.documents).toEqual(before.documents);
}, 60_000);

test("unavailable controls and later requests retain explicit outcomes within completion capacity", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = await seedInstructionPreparation();

    await f.t.run(async (ctx) => {
        const p = await ctx.db.get(f.preparationId);
        assert(p?.sourcesMission);
        await ctx.db.patch(p._id, {
            sourcesMission: {
                ...p.sourcesMission,
                envelope: { ...p.sourcesMission.envelope, controls: 160 },
            },
        });
    });
    await registerInstructions(
        f,
        "initial",
        Array.from({ length: 79 }, (_, i) => `Document activity ${i}`),
    );
    for (let i = 0; i < 4; i++)
        await f.t.mutation(internal.workbench.processInstructions, {
            runId: f.runId,
        });
    const starting = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    assert(starting?.sourcesMission);
    const originalNeeds = starting.sourcesMission.needs.map((n) => n.id);
    const requestIds: Id<"agentOperationRequests">[] = [];
    for (let i = 0; i < 140; i++) {
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueueNative,
            {
                runId: f.runId,
                expectedGeneration: 4,
                cause: `unavailable-${i}`,
                input: {
                    kind: "submit_documentary_qualification",
                    sourceId: f.sourceId,
                    captureId: f.captureId,
                    expectedTaskId: null,
                    changes: [
                        {
                            contribution: {
                                needIds: originalNeeds,
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
        await f.t.mutation(internal.execution.operations.claim, {
            requestId,
            expectedGeneration: 4,
        });
        try {
            await f.t.mutation(internal.sourcesMission.reserve, {
                requestId,
                expectedGeneration: 4,
            });
        } catch (error) {
            const code = executionFailureCode(error);
            expect([
                "sources_result_capacity",
                "sources_response_capacity",
            ]).toContain(code);
            await f.t.mutation(internal.execution.operations.recordResult, {
                requestId,
                expectedGeneration: 4,
                outcome: {
                    kind: "unavailable",
                    code: code ?? "sources_result_capacity",
                },
            });
            break;
        }
        await f.t.mutation(internal.execution.operations.recordResult, {
            requestId,
            expectedGeneration: 4,
            outcome: { kind: "unavailable", code: "missing_configuration" },
        });
        requestIds.push(requestId);
    }
    expect(requestIds.length).toBeGreaterThan(1);
    expect(requestIds.length).toBeLessThan(140);
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.qualifications,
    ).toEqual([]);
    const instructionIds = await registerInstructions(
        f,
        "additional",
        Array.from(
            { length: 79 },
            (_, i) => "研究".repeat(995) + String(i).padStart(10, "0"),
        ),
    );
    for (let i = 0; i < 4; i++)
        await f.t.mutation(internal.workbench.processInstructions, {
            runId: f.runId,
        });
    const instructions = await f.t.run((ctx) =>
        Promise.all(instructionIds.map((id) => ctx.db.get(id))),
    );
    expect(instructions.some((i) => i?.status === "limited")).toBe(true);
    const p = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    assert(p?.sourcesMission);
    const data = p.sourcesMission;
    const invocation = await f.t.mutation(
        internal.execution.invocations.begin,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            taskKey: "unavailable-work-completion",
            provenance: "simulation",
        },
    );
    assert(invocation.kind === "ready", JSON.stringify(invocation));
    const completion = await f.t.mutation(
        internal.execution.invocations.finish,
        {
            invocationId: invocation.invocationId,
            expectedGeneration: 4,
            response: {
                kind: "complete",

                needs: data.needs.map((n) => ({
                    needId: n.id,
                    unfinished: ["Documentary examination remains unfinished."],
                })),
            },
        },
    );
    expect(completion.kind).toBe("completed");
    const result = (await f.t.run((ctx) => ctx.db.get(f.preparationId)))
        ?.sourcesMission?.result;
    assert(result);
    expect(result.outcome).toBe("blocked");
    expect(result.documents).toEqual([]);
});

test.each([
    "qualification",
    "check",
] as const)("a waiting instruction is reconciled after an engaged %s settles", async (kind) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = await seedInstructionPreparation();
    const [instructionId] = await registerInstructions(f, "during-control", [
        "Inspect interoperability",
    ]);
    assert(instructionId);
    const evidence = [
        {
            readRequestId: f.nativeReadRequestId,
            passageOrder: f.passage.order,
        },
    ];
    const input: SourcesOperation =
        kind === "qualification"
            ? {
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
                              evidence,
                          },
                      },
                  ],
              }
            : {
                  kind: "request_documentary_check",
                  needId: "common-context",
                  sourceId: f.sourceId,
                  proposition: "Context",
                  evidence,
              };
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "engaged-control",
            input,
        },
    );
    await f.t.mutation(internal.execution.operations.claim, {
        requestId,
        expectedGeneration: 4,
    });
    await f.t.mutation(internal.sourcesMission.reserve, {
        requestId,
        expectedGeneration: 4,
    });
    await f.t.mutation(internal.workbench.processInstructions, {
        runId: f.runId,
    });
    expect(await f.t.run((ctx) => ctx.db.get(instructionId))).toMatchObject({
        status: "waiting",
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.needsRevision,
    ).toBe(1);
    await f.t.mutation(internal.execution.operations.recordResult, {
        requestId,
        expectedGeneration: 4,
        outcome: { kind: "unavailable", code: "missing_configuration" },
    });
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "after-control",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    expect(
        await f.t.mutation(internal.execution.invocations.finish, {
            invocationId: begun.invocationId,
            expectedGeneration: 4,
            response: {
                kind: "complete",

                needs: [
                    {
                        needId: "common-context",
                        unfinished: ["Examination remains unavailable."],
                    },
                ],
            },
        }),
    ).toMatchObject({ kind: "blocked", code: "mission_context_changed" });
    expect(await f.t.run((ctx) => ctx.db.get(instructionId))).toMatchObject({
        status: "transmitted",
        needId: `instruction:${instructionId}`,
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.needsRevision,
    ).toBe(2);
    expect((await f.t.run((ctx) => ctx.db.get(f.missionId)))?.status).toBe(
        "running",
    );
});
