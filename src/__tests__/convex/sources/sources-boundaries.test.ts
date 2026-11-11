import { api, internal } from "@convex/_generated/api";
import { controlledDocumentaryUse } from "@convex/domain/sourceSelectionPolicy";
import { completeSources } from "@convex/domain/sources";
import { readRetainedText } from "@convex/execution/retainedText";
import { afterEach, assert, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import {
    recordDocumentaryRead,
    seedCapturedSources,
} from "@/__tests__/setup/sources-mission";

const examiner = vi.hoisted(() => vi.fn());
vi.mock("@convex/integrations/documentaryControl", () => ({
    examineDocumentaryContributions: examiner,
}));
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    examiner.mockReset();
});

test("a controlled reply after public Resume settles its original receipt without adopting stale material", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const framing = await ctx.db.insert("framingRevisions", {
            runId: f.runId,
            revision: 1,
            content: { scope: "Fixed workflow", questions: [] },
            requestKey: "resume-control",
            contentHash: "fixture",
            origin: "analyst",
            createdAt: 1,
        });
        await ctx.db.patch(f.runId, {
            startMode: "framed",
            agentExecutionVersion: 3,
            fixedFramingRevisionId: framing,
        });
        await ctx.db.patch(f.missionId, { piActiveWriter: "control-writer" });
    });
    await installModel(
        f.t,
        { model: "z-ai/glm-5.3-flash", reasoningEffort: "low" },
        "sources",
    );
    examiner.mockImplementation(async (input, route, dependencies) => {
        await dependencies.beforeDispatch(
            JSON.stringify({ model: route.model, fixture: true }),
            { effectiveMaxOutputTokens: route.descriptor.maxTokens },
        );
        await f.t.mutation(internal.execution.piControl.closeWorker, {
            missionId: f.missionId,
            expectedGeneration: 4,
            writer: "control-writer",
            error: "execution_interrupted",
        });
        await f.t
            .withIdentity({ subject: f.userId })
            .mutation(api.execution.researchControl.resume, {
                runId: f.runId,
                expectedGeneration: 5,
            });
        return {
            status: "succeeded",
            model: route.model,
            latencyMs: 1,
            reportedCost: 0.01,
            dispatchOutcome: "response_received",
            output: {
                coherence: true,
                limitations: [],
                findings: input.contributions.map((c: { id: string }) => ({
                    contributionId: c.id,
                    conclusion: "supported",
                    permittedUse: "context_only",
                    diagnostic: "Supported context.",
                })),
            },
        };
    });
    expect((await qualify(f)).outcome).not.toMatchObject({ kind: "success" });
    const calls = await f.t.run((ctx) =>
        ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .take(10),
    );
    const receipt = calls.find(
        (c) => c.operation === "source_documentary_control",
    );
    expect(receipt).toMatchObject({
        status: "succeeded",
        reportedCost: 0.01,
        dispatchOutcome: "response_received",
        executionGeneration: 4,
    });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.runId)))?.sourcePreparationBudget,
    ).toMatchObject({ reserved: 0, work: 1, dispatches: 1 });
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.qualifications,
    ).toEqual([]);
    assert(receipt);
    await expect(
        f.t.mutation(internal.providerCalls.recordAttempt, {
            runId: f.runId,
            corpusRevisionId: f.corpusRevisionId,
            preparationId: f.preparationId,
            sourceId: f.sourceId,
            executionGeneration: 6,
            workflowVersion: receipt.workflowVersion,
            stepKey: "source_preparation",
            service: "model",
            operation: receipt.operation,
            operationKey: receipt.operationKey,
            inputHash: receipt.inputHash,
            attempt: receipt.attempt,
            status: "succeeded",
            reportedCost: 0.01,
        }),
    ).rejects.toThrow("attempt_identity_conflict");
});

async function qualify(f: Awaited<ReturnType<typeof seedCapturedSources>>) {
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "qualification",
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
                                "The publisher describes workflow software.",
                            period: "undated",
                            modality: "publisher statement",
                            attribution: "ServiceNow",
                            kind: "context",
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
    return {
        requestId,
        outcome: await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        }),
    };
}

test("capacity planning preserves independent qualification when earlier contribution evidence is unavailable", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    const f = await seedCapturedSources();
    await installModel(
        f.t,
        { model: "z-ai/glm-5.3-flash", reasoningEffort: "low" },
        "sources",
    );
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
    expect((await qualify(f)).outcome.kind).toBe("success");
    const next = await f.t.run(async (ctx) => {
        const original = await ctx.db.get(f.captureId);
        const preparation = await ctx.db.get(f.preparationId);
        assert(original && preparation?.sourcesMission);
        const { _id, _creationTime, ...capture } = original;
        const {
            _id: _passageId,
            _creationTime: _passageTime,
            ...passage
        } = f.passage;
        const sourceId = await ctx.db.insert("sources", {
            runId: f.runId,
            canonicalUrl: "https://example.com/independent",
            title: "Independent document",
            origin: "exa",
            category: "research_lead",
            createdAt: 1,
        });
        const captureId = await ctx.db.insert("sourceCaptures", {
            ...capture,
            sourceId,
            captureKey: "independent-capture",
        });
        const passageId = await ctx.db.insert("sourceSearchPassages", {
            ...passage,
            sourceId,
            captureId,
        });
        await ctx.db.delete(f.passage._id);
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                captureIds: [
                    ...preparation.sourcesMission.captureIds,
                    captureId,
                ],
            },
        });
        const indexed = await ctx.db.get(passageId);
        assert(indexed);
        const readRequestId = await recordDocumentaryRead(ctx, {
            runId: f.runId,
            missionId: f.missionId,
            captureId,
            evidence: [
                { passageOrder: indexed.order, quotation: indexed.quotation },
            ],
        });
        return { sourceId, captureId, passage: indexed, readRequestId };
    });
    expect((await qualify({ ...f, ...next })).outcome.kind).toBe("success");
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    assert(preparation?.sourcesMission);
    const result = await f.t.run((ctx) =>
        completeSources(ctx, f.preparationId, {
            kind: "complete",
            needsRevision: 1,
            needs: [
                {
                    needId: "common-context",
                    unfinished: [],
                    workRequestIds:
                        preparation.sourcesMission?.work.map(
                            (w) => w.requestId,
                        ) ?? [],
                },
            ],
        }),
    );
    expect(result.documents.map((d) => d.sourceId)).toEqual([next.sourceId]);
});

test.each([
    "context_only",
    "attributed_argument_only",
] as const)("targeted checks retain %s for the exact qualified contribution", async (narrowerUse) => {
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    const f = await seedCapturedSources();
    await installModel(
        f.t,
        { model: "z-ai/glm-5.3-flash", reasoningEffort: "low" },
        "sources",
    );
    let permittedUse = "documentary";
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
                    permittedUse,
                    diagnostic: "Use within the examined scope only.",
                })),
            },
        };
    });
    const qualification = await qualify(f);
    expect(qualification.outcome).toMatchObject({ kind: "success" });
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    const taskId = preparation?.sourcesMission?.qualifications[0];
    assert(taskId);
    const task = await f.t.run((ctx) => ctx.db.get(taskId));
    assert(task?.output.kind === "documentary_qualification");
    const contribution = task.output.contributions[0];
    assert(contribution);
    permittedUse = narrowerUse;
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "narrow-use",
            input: {
                kind: "request_documentary_check",
                needId: "common-context",
                sourceId: f.sourceId,
                proposition: contribution.statement,
                evidence: contribution.evidence.map((e) => ({
                    readRequestId: f.readRequestId,
                    passageOrder: e.passageOrder,
                })),
                targets: [
                    {
                        qualificationTaskId: taskId,
                        contributionId: contribution.id,
                        version: contribution.version,
                    },
                ],
            },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "success" });
    const current = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    const originalControl = await f.t.run((ctx) =>
        ctx.db.get(
            task.output.kind === "documentary_qualification"
                ? task.output.controlTaskId
                : taskId,
        ),
    );
    assert(originalControl?.output.kind === "documentary_control");
    expect(
        controlledDocumentaryUse(
            contribution,
            originalControl.output.control,
            current?.sourcesMission?.restrictedContributions,
        ),
    ).toBe(narrowerUse);
    const observations = await f.t.run(async (ctx) => {
        const rows = await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_run_and_native_input_sequence", (q) =>
                q.eq("runId", f.runId).gt("nativeInputSequence", 0),
            )
            .collect();
        return Promise.all(
            rows.map(async (row) =>
                row.contextObservation
                    ? JSON.parse(
                          await readRetainedText(
                              ctx,
                              row.contextObservation.textId,
                          ),
                      )
                    : null,
            ),
        );
    });
    expect(observations).toContainEqual(
        expect.objectContaining({
            event: "contributions_restricted",
            restrictions: expect.arrayContaining([
                expect.objectContaining({ permittedUse: narrowerUse }),
            ]),
        }),
    );
    expect(
        controlledDocumentaryUse(
            { ...contribution, version: contribution.version + 1 },
            originalControl.output.control,
            current?.sourcesMission?.restrictedContributions,
        ),
    ).toBe("documentary");
    const readRequestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "read-restricted-contribution",
            input: {
                kind: "search_available_material",
                sourceId: f.sourceId,
                query: "workflow",
            },
        },
    );
    const reading = await f.t.action(internal.execution.operations.dispatch, {
        requestId: readRequestId,
        expectedGeneration: 4,
    });
    assert(reading.kind === "success");
    expect(
        JSON.parse(reading.valueJson).documentaryStatus.qualification
            .contributions,
    ).toContainEqual(
        expect.objectContaining({
            id: contribution.id,
            version: contribution.version,
            permittedUse: narrowerUse,
        }),
    );
    const result = await f.t.run((ctx) =>
        completeSources(ctx, f.preparationId, {
            kind: "complete",
            needsRevision: 1,
            needs: [
                {
                    needId: "common-context",
                    unfinished: [],
                    workRequestIds: [
                        qualification.requestId,
                        requestId,
                        readRequestId,
                    ],
                },
            ],
        }),
    );
    expect(result.documents).toEqual([
        expect.objectContaining({
            sourceId: f.sourceId,
            qualificationTaskId: taskId,
            contributions: [
                { id: contribution.id, version: contribution.version },
            ],
        }),
    ]);
});

test("one examination loads a shared capture once and supplies each exact contextual quotation once", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    const f = await seedCapturedSources();
    await installModel(
        f.t,
        { model: "z-ai/glm-5.3-flash", reasoningEffort: "low" },
        "sources",
    );
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
                    diagnostic: "Supported context.",
                })),
            },
        };
    });
    const capture = await f.t.run((ctx) => ctx.db.get(f.captureId));
    assert(capture?.byteCount);
    const reads = vi.spyOn(Blob.prototype, "text");
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "shared-evidence",
            input: {
                kind: "submit_documentary_qualification",
                sourceId: f.sourceId,
                captureId: f.captureId,
                expectedTaskId: null,
                changes: Array.from({ length: 4 }, (_, i) => ({
                    contribution: {
                        needIds: ["common-context"],
                        statement: `Publisher context ${i}`,
                        period: "undated",
                        modality: "reported",
                        attribution: "publisher",
                        kind: "context" as const,
                        evidence: Array.from({ length: 5 }, () => ({
                            readRequestId: f.readRequestId,
                            passageOrder: f.passage.order,
                        })),
                    },
                })),
            },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "success" });
    expect(
        reads.mock.contexts.filter(
            (blob) => blob instanceof Blob && blob.size === capture.byteCount,
        ),
    ).toHaveLength(1);
    expect(examiner.mock.calls[0]?.[0].evidence).toHaveLength(1);
    expect(examiner.mock.calls[0]?.[0].evidence[0]).toMatchObject({
        captureId: f.captureId,
        passage: { quotation: f.passage.quotation },
    });
});

test("controlled material is handed off partially with exact contribution versions and unfinished work", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    const f = await seedCapturedSources();
    await installModel(
        f.t,
        { model: "z-ai/glm-5.3-flash", reasoningEffort: "low" },
        "sources",
    );
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
                    diagnostic:
                        "The publisher's statement is supported as context.",
                })),
            },
        };
    });
    const { requestId, outcome } = await qualify(f);
    expect(outcome, JSON.stringify(outcome)).toMatchObject({ kind: "success" });
    const material = await f.t.run((ctx) =>
        completeSources(ctx, f.preparationId, {
            kind: "complete",
            needsRevision: 1,
            needs: [
                {
                    needId: "common-context",
                    unfinished: [
                        "An independent source has not yet been examined.",
                    ],
                    workRequestIds: [requestId],
                },
            ],
        }),
    );
    expect(material.needs[0]).toHaveProperty("contributions");
    expect(material).toMatchObject({
        outcome: "partial",
        retentionAuthority: "system_mandate",
        documents: [
            {
                captureId: f.captureId,
                qualificationVersion: 1,
                contributions: [{ version: 1 }],
            },
        ],
    });
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    assert(preparation?.sourcesMission);
    expect(preparation.sourcesMission.qualifications).toHaveLength(1);
    expect(examiner).toHaveBeenCalledOnce();
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toEqual(outcome);
    expect(examiner).toHaveBeenCalledOnce();
    expect(
        await f.t.run((ctx) => ctx.db.get(f.corpusRevisionId)),
    ).toMatchObject({ status: "draft" });
    const begun = await f.t.mutation(internal.execution.invocations.begin, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "controlled-completion",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const finished = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "complete",

            needs: material.needs.map(({ needId, gap, unfinished }) => ({
                needId,
                gap,
                unfinished,
            })),
        },
    });
    expect(finished).toMatchObject({ kind: "completed" });
    await f.t.mutation(internal.sourcesMission.finish, {
        preparationId: f.preparationId,
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        lifecycleState: "sources_prepared",
        executionStatus: "idle",
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).not.toHaveProperty(
        "completionOutcome",
    );
    await expect(
        f.t.query(api.sourcesMission.getPreparedMaterial, { runId: f.runId }),
    ).rejects.toThrow();
    expect(
        await f.t
            .withIdentity({ subject: f.userId })
            .query(api.sourcesMission.getPreparedMaterial, { runId: f.runId }),
    ).toMatchObject({
        nextCapability: "investigation_unavailable",
        material: { outcome: "partial", retentionAuthority: "system_mandate" },
    });
});

test("missing control configuration retains unfinished work and creates no qualified material", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const f = await seedCapturedSources();
    const { requestId, outcome } = await qualify(f);
    expect(outcome).toMatchObject({
        kind: "unavailable",
        code: "missing_configuration",
    });
    expect(examiner).not.toHaveBeenCalled();
    await expect(
        f.t.run((ctx) =>
            completeSources(ctx, f.preparationId, {
                kind: "complete",
                needsRevision: 1,
                needs: [
                    {
                        needId: "common-context",
                        unfinished: [],
                        workRequestIds: [requestId],
                    },
                ],
            }),
        ),
    ).rejects.toThrow("sources_work_unfinished");
});

test("a control already dispatched when the analyst pauses retains its controlled material without advancing research", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    const f = await seedCapturedSources();
    await f.t.run((ctx) => ctx.db.patch(f.runId, { agentExecutionVersion: 3 }));
    await installModel(
        f.t,
        { model: "z-ai/glm-5.3-flash", reasoningEffort: "low" },
        "sources",
    );
    examiner.mockImplementation(async (input, route, dependencies) => {
        await dependencies.beforeDispatch(
            JSON.stringify({ model: route.model, fixture: true }),
            { effectiveMaxOutputTokens: route.descriptor.maxTokens },
        );
        await f.t
            .withIdentity({ subject: f.userId })
            .mutation(api.execution.researchControl.pause, {
                runId: f.runId,
                expectedGeneration: 4,
            });
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
                    diagnostic: "Supported as attributed context.",
                })),
            },
        };
    });
    const { outcome } = await qualify(f);
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
        executionStatus: "paused",
        pauseReason: "analyst",
    });
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(preparation?.sourcesMission?.qualifications).toHaveLength(1);
    expect(preparation?.sourcesMission?.result).toBeUndefined();
    expect(outcome).toMatchObject({ kind: "refused", code: "stale_execution" });
    expect(examiner).toHaveBeenCalledOnce();
});

test("need outcomes can reference canonical shared readings without duplicating their work records", async () => {
    const f = await seedCapturedSources();
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueueNative,
        {
            runId: f.runId,
            expectedGeneration: 4,
            cause: "need-reading",
            input: {
                kind: "read_in_context",
                sourceId: f.sourceId,
                passageOrder: f.passage.order,
            },
        },
    );
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "success" });
    const material = await f.t.run((ctx) =>
        completeSources(ctx, f.preparationId, {
            kind: "complete",
            needsRevision: 1,
            needs: [
                {
                    needId: "common-context",
                    workRequestIds: [requestId],
                    unfinished: ["Qualification has not been performed."],
                },
            ],
        }),
    );
    expect(material).toMatchObject({
        outcome: "blocked",
        needs: [
            {
                workRequestIds: [requestId],
                unfinished: ["Qualification has not been performed."],
            },
        ],
    });
});
