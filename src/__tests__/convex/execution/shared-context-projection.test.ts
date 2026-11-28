import { api, internal } from "@convex/_generated/api";
import { assert, expect, test } from "vitest";
import {
    authorizeFixtureDispatch,
    beginFixtureInvocation,
    dispatchFixtureOperation,
    retainFixtureRequest,
} from "@/__tests__/setup/pi-mission";
import { seedCapturedSources } from "@/__tests__/setup/sources-mission";

test("required Workbench state preserves a rejected statement with its effective source exclusion", async () => {
    const { readWorkbenchFacts } = await import(
        "@convex/domain/workbenchContext"
    );
    const f = await seedCapturedSources();
    const statement =
        "A controlled statement retained for inspection after exclusion.";
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        const capture = await ctx.db.get(f.captureId);
        assert(preparation?.sourcesMission && capture?.contentHash);
        const common = {
            runId: f.runId,
            corpusRevisionId: f.corpusRevisionId,
            sourceId: f.sourceId,
            executionMode: "showcase" as const,
            schemaVersion: "fixture",
            adapterVersion: "fixture",
            inputHash: "fixture",
            createdAt: 1,
        };
        const controlTaskId = await ctx.db.insert("aiTaskResults", {
            ...common,
            taskType: "documentary_control",
            output: {
                kind: "documentary_control",
                preparationId: f.preparationId,
                evidence: [],
                inputHash: "fixture",
                examination: {
                    state: "examined",
                    contractVersion: 2,
                    control: {
                        findings: {
                            retained: {
                                conclusion: "supported",
                                permittedUse: "documentary",
                                diagnostic: "Supported.",
                                needs: { "common-context": "documentary" },
                            },
                        },
                        objections: [],
                    },
                },
            },
        });
        const taskId = await ctx.db.insert("aiTaskResults", {
            ...common,
            taskType: "documentary_qualification",
            output: {
                kind: "documentary_qualification",
                preparationId: f.preparationId,
                captureId: f.captureId,
                contentHash: capture.contentHash,
                version: 1,
                controlTaskId,
                contributions: [
                    {
                        id: "retained",
                        version: 1,
                        needIds: ["common-context"],
                        statement,
                        period: "2026",
                        modality: "reported",
                        attribution: "publisher",
                        kind: "context",
                        evidence: [
                            {
                                captureId: f.captureId,
                                passageOrder: 0,
                                quotation: f.passage.quotation,
                            },
                        ],
                    },
                ],
            },
        });
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                qualifications: [taskId],
            },
        });
    });
    await f.t.withIdentity({ subject: f.userId }).mutation(api.sources.decide, {
        runId: f.runId,
        corpusRevisionId: f.corpusRevisionId,
        sourceId: f.sourceId,
        decision: "rejected",
        decisionKey: "exclude-controlled-source",
    });
    const result = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return readWorkbenchFacts(ctx, run);
    });
    assert(result.kind === "ready");
    expect(result.context).toMatchObject({
        documentaryPreparation: {
            controlledContributions: [
                {
                    sourceId: f.sourceId,
                    sourceDecision: "rejected",
                    contributions: [
                        {
                            statement,
                            permittedUse: "blocked",
                            useStatus: "inspection_only",
                            finding: { reportedUse: "documentary" },
                        },
                    ],
                },
            ],
        },
    });
    const native = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    assert(native.kind === "ready");
    expect(
        JSON.parse(native.inputJson).activeWork.contributionObservations[0],
    ).toMatchObject({
        sourceDecision: "rejected",
        contributions: [{ statement, permittedUse: "blocked" }],
    });
});

test("required context carries a compact outcome and an exact recoverable observation", async () => {
    const f = await seedCapturedSources();
    const context = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    assert(context.kind === "ready");
    const input = JSON.parse(context.inputJson);
    const observed = input.triggeringRequestsAndResults.find(
        (r: { input: { kind: string } }) =>
            r.input.kind === "search_available_material",
    );
    expect(observed.outcome.kind).toBe("success");
    expect(observed.outcome.captureId).toBe(f.captureId);
    expect(observed.outcome).not.toHaveProperty("valueJson");
    expect(observed.input).toEqual({ kind: "search_available_material" });
    expect(observed.historyReference).toBeTruthy();
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "recover-full-outcome",
            input: {
                kind: "consult_mission_state",
                reference: observed.historyReference,
            },
        },
    );
    const result = await dispatchFixtureOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    assert(result.kind === "success");
    expect(result.valueJson).toContain(f.passage.quotation.slice(0, 30));
});

test("Sources candidate projection omits persistence metadata while retaining selection references", async () => {
    const f = await seedCapturedSources();
    const context = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    assert(context.kind === "ready");
    const candidate = JSON.parse(context.inputJson).activeWork.candidates.find(
        (c: { sourceId: string }) => c.sourceId === f.sourceId,
    );
    expect(candidate).toBeDefined();
    expect(candidate.canonicalUrl).toEqual(expect.any(String));
    for (const key of [
        "_creationTime",
        "_id",
        "runId",
        "createdAt",
        "providerReference",
        "providerResultPosition",
        "discoveryQueryIndex",
    ])
        expect(candidate).not.toHaveProperty(key);
});

test("structured completion requirements come from the registered contract in required state", async () => {
    const f = await seedCapturedSources();
    const context = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    assert(context.kind === "ready");
    const completion = JSON.parse(context.inputJson).constraints.completion;
    expect(completion.format).toBe("json");
    expect(JSON.stringify(completion.schema)).toContain("readRequestIds");
    expect(JSON.stringify(completion.schema)).toContain("unfinished");
    expect(JSON.stringify(completion.schema)).not.toContain("workRequestIds");
    expect(JSON.stringify(completion.schema)).not.toContain("needsRevision");
});

test("every compact successful observation points to its retained result rather than only admission", async () => {
    const f = await seedCapturedSources();
    const context = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    assert(context.kind === "ready");
    const input = JSON.parse(context.inputJson);
    for (const observed of input.triggeringRequestsAndResults) {
        if (observed.outcome?.kind !== "success") continue;
        const event = await f.t.run((ctx) =>
            ctx.db.get(observed.historyReference),
        );
        expect(event).toMatchObject({
            kind: expect.stringMatching(/^operation_(completed|observed)$/),
        });
    }
});

test("required state preserves complete controlled statements and adverse findings without copying quotations", async () => {
    const f = await seedCapturedSources();
    const statement =
        "A carefully qualified documentary proposition. ".repeat(20) +
        "Final material restriction.";
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        const capture = await ctx.db.get(f.captureId);
        assert(capture?.contentHash);
        const common = {
            runId: f.runId,
            corpusRevisionId: f.corpusRevisionId,
            executionMode: "showcase" as const,
            schemaVersion: "fixture",
            adapterVersion: "fixture",
            inputHash: "fixture",
            createdAt: 1,
        };
        const controlTaskId = await ctx.db.insert("aiTaskResults", {
            ...common,
            taskType: "documentary_control",
            output: {
                kind: "documentary_control",
                preparationId: f.preparationId,
                evidence: [],
                inputHash: "fixture",
                examination: {
                    state: "examined",
                    contractVersion: 2,
                    control: {
                        findings: {
                            qualified: {
                                conclusion: "not_established",
                                permittedUse: "blocked",
                                diagnostic: "The period is not established.",
                                needs: { "common-context": "blocked" },
                            },
                        },
                        objections: [
                            {
                                targets: [
                                    {
                                        contributionId: "qualified",
                                        needId: "common-context",
                                    },
                                ],
                                maximumUse: "blocked",
                                diagnostic: "Do not infer an annual result.",
                            },
                        ],
                    },
                },
            },
        });
        const taskId = await ctx.db.insert("aiTaskResults", {
            ...common,
            taskType: "documentary_qualification",
            output: {
                kind: "documentary_qualification",
                preparationId: f.preparationId,
                captureId: f.captureId,
                contentHash: capture.contentHash,
                version: 2,
                controlTaskId,
                contributions: [
                    {
                        id: "qualified",
                        version: 2,
                        needIds: ["common-context"],
                        statement,
                        period: "undated",
                        modality: "reported",
                        attribution: "publisher",
                        kind: "context",
                        evidence: [
                            {
                                captureId: f.captureId,
                                passageOrder: 0,
                                quotation: "Exact quote remains on demand",
                            },
                        ],
                    },
                ],
            },
        });
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                qualifications: [taskId],
            },
        });
    });
    const context = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    assert(context.kind === "ready");
    const observations = JSON.parse(context.inputJson).activeWork
        .contributionObservations;
    expect(observations[0].contributions[0]).toMatchObject({
        statement,
        period: "undated",
        modality: "reported",
        attribution: "publisher",
        permittedUse: "blocked",
        finding: { diagnostic: "The period is not established." },
    });
    expect(observations[0].contributions[0].objections).toEqual([
        {
            needIds: ["common-context"],
            maximumUse: "blocked",
            diagnosticPreview: "Do not infer an annual result.",
            diagnosticComplete: true,
        },
    ]);
    expect(JSON.stringify(observations)).not.toContain(
        "Exact quote remains on demand",
    );
});

test("large admitted native state stays immutable and readable without exceeding a Convex document", async () => {
    const { getDocumentSize } = await import("convex/values");
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        const source = await ctx.db.get(f.sourceId);
        const capture = await ctx.db.get(f.captureId);
        assert(preparation?.sourcesMission && source && capture);
        const {
            _id: _sourceId,
            _creationTime: _sourceCreated,
            ...sourceValue
        } = source;
        const {
            _id: _captureId,
            _creationTime: _captureCreated,
            ...captureValue
        } = capture;
        const qualifications = [];
        const captureIds = [];
        for (let index = 0; index < 24; index++) {
            const sourceId = await ctx.db.insert("sources", {
                ...sourceValue,
                canonicalUrl: `https://example.com/large-${index}`,
            });
            const captureId = await ctx.db.insert("sourceCaptures", {
                ...captureValue,
                sourceId,
                captureKey: `large-${index}`,
            });
            captureIds.push(captureId);
            const contributions = Array.from({ length: 15 }, (_, number) => ({
                id: `large-${index}-${number}`,
                version: 1,
                needIds: ["common-context"],
                statement:
                    "Documentary proposition with its exact restrictions. ".repeat(
                        77,
                    ),
                period: "2026",
                modality: "reported",
                attribution: "publisher",
                kind: "context" as const,
                evidence: [
                    {
                        captureId,
                        passageOrder: 0,
                        quotation: "Exact fixture evidence",
                    },
                ],
            }));
            const common = {
                runId: f.runId,
                corpusRevisionId: f.corpusRevisionId,
                executionMode: "showcase" as const,
                schemaVersion: "fixture",
                adapterVersion: "fixture",
                inputHash: `large-${index}`,
                createdAt: 1,
            };
            const controlTaskId = await ctx.db.insert("aiTaskResults", {
                ...common,
                taskType: "documentary_control",
                output: {
                    kind: "documentary_control",
                    preparationId: f.preparationId,
                    evidence: [],
                    inputHash: `large-${index}`,
                    examination: {
                        state: "examined",
                        contractVersion: 2,
                        control: {
                            findings: Object.fromEntries(
                                contributions.map((contribution) => [
                                    contribution.id,
                                    {
                                        conclusion: "supported" as const,
                                        permittedUse: "context_only" as const,
                                        diagnostic: "Context only.",
                                        needs: Object.fromEntries(
                                            contribution.needIds.map(
                                                (needId) => [
                                                    needId,
                                                    "context_only" as const,
                                                ],
                                            ),
                                        ),
                                    },
                                ]),
                            ),
                            objections: [],
                        },
                    },
                },
            });
            qualifications.push(
                await ctx.db.insert("aiTaskResults", {
                    ...common,
                    taskType: "documentary_qualification",
                    output: {
                        kind: "documentary_qualification",
                        preparationId: f.preparationId,
                        captureId,
                        contentHash: capture.contentHash ?? "fixture",
                        version: 1,
                        controlTaskId,
                        contributions,
                    },
                }),
            );
        }
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                qualifications,
                captureIds,
            },
        });
    });
    const begun = await beginFixtureInvocation(f.t, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "large-admitted-input",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    expect(new TextEncoder().encode(begun.inputJson).length).toBeGreaterThan(
        1024 * 1024,
    );
    const stored = await f.t.run((ctx) => ctx.db.get(begun.invocationId));
    assert(stored);
    expect(getDocumentSize(stored)).toBeLessThan(1024 * 1024);
    const scope = { invocationId: begun.invocationId, expectedGeneration: 4 };
    const execution = await f.t.query(
        internal.execution.invocations.forExecution,
        scope,
    );
    expect(execution.invocation.inputJson).toBe("");
    const inputHash = execution.invocation.inputContentHash;
    assert(inputHash);
    const read = internal.execution.invocationLifecycle.executionInputFragment;
    const first = await f.t.query(read, { ...scope, inputHash, index: 0 });
    const parts = [first.content];
    for (let index = 1; index < first.fragmentCount; index++)
        parts.push(
            (await f.t.query(read, { ...scope, inputHash, index })).content,
        );
    expect(parts.join("")).toBe(begun.inputJson);
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "large-state-history",
            input: { kind: "consult_mission_state" },
        },
    );
    const outcome = await dispatchFixtureOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    assert(outcome.kind === "success");
    expect(new TextEncoder().encode(outcome.valueJson).length).toBeLessThan(
        48 * 1024,
    );
    expect(JSON.parse(outcome.valueJson).state.requiredState).toMatchObject({
        section: "workbench_current_state",
        generation: 4,
    });
    expect(JSON.parse(outcome.valueJson).state).not.toHaveProperty(
        "activeWork",
    );
});

test("native preparation binds the method and actual tool declarations as well as the frozen state", async () => {
    const { getAgentDefinition } = await import(
        "@convex/execution/agentCatalog"
    );
    const { agentToolSchemas } = await import(
        "@convex/execution/agentDefinition"
    );
    const { agentToolSetKey, piInstructionSection } = await import(
        "@convex/integrations/modelInput"
    );
    const { NATIVE_MODEL_SERIALIZER } = await import(
        "@convex/integrations/modelRouting"
    );
    const { sha256Hex } = await import("@convex/domain/sourcePassages");
    const f = await seedCapturedSources();
    const context = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    assert(context.kind === "ready");
    const definition = getAgentDefinition("sources_v1", 5);
    const prepared = {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "method-proof",
        provenance: "simulation" as const,
        preparedInputHash: sha256Hex(context.inputJson),
        preparedObservationSequence: JSON.parse(context.inputJson)
            .nativeObservations.throughSequence,
        preparedToolSetKey: await agentToolSetKey(
            agentToolSchemas(definition, JSON.parse(context.inputJson)),
        ),
        preparedInstructionsHash: sha256Hex("Different method"),
        preparedSerializer: NATIVE_MODEL_SERIALIZER,
    };
    expect(await beginFixtureInvocation(f.t, prepared)).toEqual({
        kind: "blocked",
        code: "native_input_changed",
    });
    const begun = await beginFixtureInvocation(f.t, {
        ...prepared,
        preparedInstructionsHash: sha256Hex(
            piInstructionSection(definition.instructions),
        ),
    });
    assert(begun.kind === "ready");
    expect(begun.inputJson).toBe(context.inputJson);
});

test("dispatch rechecks a documentary exclusion committed after native admission", async () => {
    const { getAgentDefinition } = await import(
        "@convex/execution/agentCatalog"
    );
    const { agentToolSchemas } = await import(
        "@convex/execution/agentDefinition"
    );
    const { agentToolSetKey, piInstructionSection } = await import(
        "@convex/integrations/modelInput"
    );
    const { NATIVE_MODEL_SERIALIZER } = await import(
        "@convex/integrations/modelRouting"
    );
    const { sha256Hex } = await import("@convex/domain/sourcePassages");
    const f = await seedCapturedSources();
    const context = await f.t.query(internal.execution.context.build, {
        missionId: f.missionId,
        expectedGeneration: 4,
    });
    assert(context.kind === "ready");
    const definition = getAgentDefinition("sources_v1", 5);
    const begun = await beginFixtureInvocation(f.t, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "dispatch-freshness",
        provenance: "simulation",
        preparedInputHash: sha256Hex(context.inputJson),
        preparedObservationSequence: JSON.parse(context.inputJson)
            .nativeObservations.throughSequence,
        preparedToolSetKey: await agentToolSetKey(
            agentToolSchemas(definition, JSON.parse(context.inputJson)),
        ),
        preparedInstructionsHash: sha256Hex(
            piInstructionSection(definition.instructions),
        ),
        preparedSerializer: NATIVE_MODEL_SERIALIZER,
    });
    assert(begun.kind === "ready");
    const dispatch = {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
    };
    await retainFixtureRequest(f.t, {
        ...dispatch,
        requestJson: JSON.stringify({
            model: "offline",
            input: context.inputJson,
        }),
    });
    await expect(authorizeFixtureDispatch(f.t, dispatch)).resolves.toBeNull();
    await f.t.withIdentity({ subject: f.userId }).mutation(api.sources.decide, {
        runId: f.runId,
        corpusRevisionId: f.corpusRevisionId,
        sourceId: f.sourceId,
        decision: "rejected",
        decisionKey: "exclude-after-admission",
    });
    await expect(authorizeFixtureDispatch(f.t, dispatch)).rejects.toMatchObject(
        { data: { code: "native_input_changed" } },
    );
    expect(
        await f.t.run((ctx) => ctx.db.query("providerCalls").collect()),
    ).toEqual([]);
});
