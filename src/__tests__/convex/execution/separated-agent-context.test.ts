import { api, internal } from "@convex/_generated/api";
import { completeSources } from "@convex/domain/sources";
import { readWorkbenchFacts } from "@convex/domain/workbenchContext";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { completionFeedbackValidator } from "@convex/execution/operationContracts";
import {
    piInputProfileKey,
    piMissionMessages,
} from "@convex/integrations/modelInput";
import { MAX_OPERATION_RESULT_BYTES } from "@convex/resourcePolicy";
import { ConvexError } from "convex/values";
import { validate } from "convex-helpers/validators";
import { afterEach, assert, expect, test, vi } from "vitest";
import {
    seedObservedSources,
    startSourcesOperation,
} from "@/__tests__/setup/sources-mission";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

test("Sources projects adopted reading references independently of compactable conversation text", async () => {
    const f = await seedObservedSources();
    const context = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        const run = await ctx.db.get(f.runId);
        assert(mission && run);
        await ctx.db.patch(mission._id, {
            workingNotes: "Compacted notes without documentary identifiers.",
        });
        return getAgentDefinition("sources_v1").context(ctx, mission, run);
    });
    assert(context.kind === "ready");
    expect(context.context.activeWork).toMatchObject({
        readingReferences: expect.arrayContaining([
            expect.objectContaining({
                readRequestId: f.readRequestId,
                sourceId: f.sourceId,
                captureId: f.captureId,
                passageOrders: expect.arrayContaining([f.passage.order]),
            }),
        ]),
    });
    expect(JSON.stringify(context.context.activeWork)).not.toContain(
        f.nativeReadRequestId,
    );
    await f.t.run((ctx) =>
        ctx.db.patch(f.readRequestId, { adoptedAt: undefined }),
    );
    const withoutAdoption = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        const run = await ctx.db.get(f.runId);
        assert(mission && run);
        return getAgentDefinition("sources_v1").context(ctx, mission, run);
    });
    assert(withoutAdoption.kind === "ready");
    expect(withoutAdoption.context.activeWork).toMatchObject({
        readingReferences: [],
        readingReferencesComplete: true,
    });
});

test("Sources declares incomplete reading coverage when its bounded context window is exceeded", async () => {
    const f = await seedObservedSources();
    await f.t.run(async (ctx) => {
        const read = await ctx.db.get(f.readRequestId);
        assert(read);
        const { _id, _creationTime, ...fields } = read;
        for (let index = 0; index < 33; index++)
            await ctx.db.insert("agentOperationRequests", {
                ...fields,
                logicalKey: `retained-reading-${index}`,
            });
    });
    const context = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        const run = await ctx.db.get(f.runId);
        assert(mission && run);
        return getAgentDefinition("sources_v1").context(ctx, mission, run);
    });
    assert(context.kind === "ready");
    const activeWork = context.context.activeWork as {
        readingReferences: unknown[];
        readingReferencesComplete: boolean;
    };
    expect(activeWork.readingReferences).toHaveLength(32);
    expect(activeWork.readingReferencesComplete).toBe(false);
});

test("new definitions keep stable instructions at the root independently of conversational transport", async () => {
    for (const [id, version] of [
        ["sources_v1", 4],
        ["workbench_v1", 4],
    ] as const) {
        const definition = getAgentDefinition(id, version);
        expect(definition.contextRendering).toBe("separated_v1");
        const messages = piMissionMessages(
            definition.instructions,
            '{"domain":{}}',
            [],
            0,
            definition.nativeConversation,
            definition.contextRendering,
        );
        expect(messages).toEqual([
            {
                role: "system",
                content: 'Required current mission state:\n{"domain":{}}',
                timestamp: 0,
            },
        ]);
        const input = {
            instructions: definition.instructions,
            prompt: "",
            operations: {},
            definitionVersion: version,
        };
        expect(
            await piInputProfileKey({
                ...input,
                contextRendering: "separated_v1",
            }),
        ).not.toBe(await piInputProfileKey(input));
    }
});

test("current Sources context exposes task obligations rather than its persistence record", async () => {
    const f = await seedObservedSources();
    const context = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        const run = await ctx.db.get(f.runId);
        assert(mission && run);
        return getAgentDefinition(
            mission.definitionId,
            mission.definitionVersion,
        ).context(ctx, mission, run);
    });
    assert(context.kind === "ready");
    expect(context.context.activeWork).toMatchObject({
        preparationId: f.preparationId,
        needsRevision: 1,
        allowance: expect.any(Object),
        needs: expect.any(Array),
        work: expect.any(Array),
    });
    expect(context.context.activeWork).not.toHaveProperty("protocol");
    expect(context.context.activeWork).not.toHaveProperty("searches");
    expect(context.context.activeWork).toHaveProperty(
        "qualificationReferences",
    );
});

test("authorized availability exposes capture limitations without confusing them with response trimming", async () => {
    const f = await seedObservedSources();
    await f.t.run((ctx) =>
        ctx.db.patch(f.captureId, {
            readingCompleteness: "partial",
            omittedPassageCount: 7,
        }),
    );
    const metadata = await f.t.query(
        internal.sourceRetrieval.availableCaptureMetadataForMission,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            sourceIds: [f.sourceId],
        },
    );
    expect(metadata).toEqual([
        expect.objectContaining({
            sourceId: f.sourceId,
            captureId: f.captureId,
            readingCompleteness: "partial",
            captureOmittedPassageCount: 7,
            index: expect.objectContaining({
                status: "indexed",
                coverage: "bounded_candidates",
            }),
        }),
    ]);
});

test("Sources reports all detectable accounting defects in one bounded correction", async () => {
    const f = await seedObservedSources();
    const result = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        const preparation = await ctx.db.get(f.preparationId);
        assert(mission && preparation?.sourcesMission);
        const invocationId = await ctx.db.insert("agentInvocations", {
            missionId: mission._id,
            runId: f.runId,
            corpusRevisionId: f.corpusRevisionId,
            generation: mission.generation,
            definitionVersion: mission.definitionVersion,
            taskKey: "aggregate-diagnostics",
            provenance: "simulation",
            status: "started",
            inputJson: JSON.stringify({
                activeWork: {
                    preparationId: f.preparationId,
                    needsRevision: preparation.sourcesMission.needsRevision,
                    work: preparation.sourcesMission.work,
                },
            }),
            createdAt: Date.now(),
        });
        const invocation = await ctx.db.get(invocationId);
        assert(invocation);
        return getAgentDefinition("sources_v1").complete(
            ctx,
            mission,
            {
                kind: "complete",
                needs: [
                    {
                        needId: "common-context",
                        unfinished: [" "],
                        gap: " ",
                    },
                ],
            },
            {
                activeWork: {
                    preparationId: f.preparationId,
                    needsRevision: preparation.sourcesMission.needsRevision,
                    work: preparation.sourcesMission.work,
                },
            },
            invocation,
        );
    });
    assert(result.kind === "correct");
    expect(result.feedback.issues.map((issue) => issue.path)).toEqual(
        expect.arrayContaining(["needs[0].unfinished", "needs[0].gap"]),
    );
    expect(
        result.feedback.issues.some((issue) =>
            issue.expected.startsWith("Omit gap unless"),
        ),
    ).toBe(true);
});

test("action facts agree with the Start admission guard and distinguish a completed start", async () => {
    const f = await seedWorkbench();
    const facts = () =>
        f.t.run(async (ctx) => {
            const run = await ctx.db.get(f.runId);
            assert(run);
            return readWorkbenchFacts(ctx, run);
        });
    const before = await facts();
    assert(before.kind === "ready");
    expect(before.context.research).toMatchObject({
        started: false,
        actions: {
            start: {
                actor: "analyst_only",
                applicable: false,
                reason: "framing_invalid",
            },
            pause: { applicable: false },
            resume: { applicable: false },
        },
    });
    await expect(
        f.client.mutation(api.framing.startResearch, {
            runId: f.runId,
            expectedRevision: 1,
            requestKey: "start-empty",
        }),
    ).rejects.toThrow("framing_invalid");
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            researchStartedAt: 1,
            lifecycleState: "sources_prepared",
            executionStatus: "idle",
        }),
    );
    const after = await facts();
    assert(after.kind === "ready");
    expect(after.context.research).toMatchObject({
        started: true,
        actions: {
            start: { applicable: false, reason: "research_already_started" },
            resume: { applicable: false },
        },
    });
});

test("Sources distinguishes reserved work observations from exact completion references", async () => {
    const f = await seedObservedSources();
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "task-context",
            input: {
                kind: "discover_sources_for_need",
                needId: "common-context",
                query: "workflow",
            },
        },
    );
    await startSourcesOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    await f.t.mutation(internal.sourcesMission.reserve, {
        epoch: 1,
        requestId,
        expectedGeneration: 4,
    });
    const context = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        const run = await ctx.db.get(f.runId);
        assert(mission && run);
        return getAgentDefinition("sources_v1").context(ctx, mission, run);
    });
    assert(context.kind === "ready");
    expect(context.context.activeWork.workOutcomes).toEqual([
        expect.objectContaining({
            requestId,
            status: "waiting",
            outcome: null,
        }),
    ]);
    expect(context.context.activeWork.work).toEqual([
        expect.objectContaining({ requestId, needIds: ["common-context"] }),
    ]);
});

test("resume applicability includes the same occupied execution slot as the command", async () => {
    const f = await seedWorkbench();
    await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        await ctx.db.patch(run._id, {
            agentExecutionVersion: 3,
            executionStatus: "paused",
            pauseReason: "analyst",
            lifecycleState: "discovering_sources",
        });
        const { _id, _creationTime, ...fields } = run;
        await ctx.db.insert("researchRuns", {
            ...fields,
            executionStatus: "running",
            lifecycleState: "discovering_sources",
        });
    });
    const facts = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return readWorkbenchFacts(ctx, run);
    });
    assert(facts.kind === "ready");
    expect(facts.context.research).toMatchObject({
        actions: {
            resume: { applicable: false, reason: "execution_slot_unavailable" },
        },
    });
    await expect(
        f.client.mutation(api.execution.researchControl.resume, {
            runId: f.runId,
            expectedGeneration: 1,
        }),
    ).rejects.toThrow("execution_slot_unavailable");
});

test("all maximum-need accounting defects fit one correction without omitting affected paths", async () => {
    const f = await seedObservedSources();
    const needs = await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        const prototype = preparation.sourcesMission.needs[0];
        assert(prototype);
        const needs = Array.from({ length: 160 }, (_, index) => ({
            ...prototype,
            id: `need-${index}`,
        }));
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                needsRevision: 2,
                needs,
                envelope: {
                    ...preparation.sourcesMission.envelope,
                    maxNeeds: 160,
                },
            },
        });
        return needs;
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "maximum-accounting",
            input: {
                kind: "submit_documentary_qualification",
                sourceId: f.sourceId,
                captureId: f.captureId,
                expectedTaskId: null,
                changes: [
                    {
                        contribution: {
                            needIds: needs.map((need) => need.id),
                            statement: "Documentary context.",
                            period: "current",
                            modality: "reported",
                            attribution: "source",
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
    await f.t.mutation(internal.sourcesMission.reserve, {
        epoch: 1,
        requestId,
        expectedGeneration: 4,
    });
    await f.t.mutation(internal.execution.operations.recordResult, {
        requestId,
        expectedGeneration: 4,
        outcome: { kind: "unavailable", code: "missing_configuration" },
    });
    try {
        await f.t.run((ctx) =>
            completeSources(ctx, f.preparationId, {
                kind: "complete",
                needsRevision: 2,
                needs: needs.map((need) => ({
                    needId: need.id,
                    workRequestIds: [],
                    unfinished: [],
                    gap: " ",
                })),
            }),
        );
        assert.fail("Invalid accounting must not complete");
    } catch (error) {
        assert(error instanceof ConvexError);
        assert(validate(completionFeedbackValidator, error.data));
        expect(
            new TextEncoder().encode(JSON.stringify(error.data)).length,
        ).toBeLessThanOrEqual(MAX_OPERATION_RESULT_BYTES);
        const paths = new Set(
            error.data.issues.flatMap((issue) => issue.path.split(", ")),
        );
        for (let index = 0; index < needs.length; index++) {
            expect(paths.has(`needs[${index}].workRequestIds`)).toBe(true);
            expect(paths.has(`needs[${index}].gap`)).toBe(true);
        }
    }
});

test("directed framing selects the current method while retaining explicit historical definitions", () => {
    const retained = getAgentDefinition("workbench_v1", 4);
    const directed = getAgentDefinition("workbench_v1", 5);
    expect(getAgentDefinition("workbench_v1").version).toBe(13);
    for (const version of [6, 7, 8, 9])
        expect(getAgentDefinition("workbench_v1", version).version).toBe(
            version,
        );
    expect(directed.version).toBe(5);
    expect(directed.operations).toHaveProperty("search_public_context");
    expect(directed.operations).not.toHaveProperty("verify_public_context");
    for (const [name, operation] of Object.entries(retained.operations)) {
        if (name !== "verify_public_context")
            expect(directed.operations[name]).toBe(operation);
    }
    expect(() => getAgentDefinition("workbench_v1", 3)).toThrow();
});

test.each([
    "independent_scrutiny",
    undefined,
] as const)("coverage priority survives factual consultation including historical absence (%s)", async (preset) => {
    const f = await seedWorkbench();
    await f.t.run((ctx) => ctx.db.patch(f.runId, { coveragePreset: preset }));
    const facts = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return readWorkbenchFacts(ctx, run);
    });
    assert(facts.kind === "ready");
    const consult = getAgentDefinition("workbench_v1", 5).consultationContext?.(
        { contextRendering: "separated_v1", domain: facts.context },
    );
    expect(consult?.coveragePreset).toBe(preset ?? null);
    expect(consult?.coverageGuidance).toBe(
        preset
            ? "Prioritize independent material that can test the account."
            : "Coverage priority is unknown for this historical dossier.",
    );
});
