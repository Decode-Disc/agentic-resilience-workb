import { internal } from "@convex/_generated/api";
import { domainSnapshot } from "@convex/execution/agentDefinition";
import { afterEach, assert, expect, test, vi } from "vitest";
import { installModel } from "@/__tests__/setup/model-configuration";
import { scopedFixtureControl } from "@/__tests__/setup/model-stream";
import {
    beginFixtureInvocation,
    dispatchFixtureOperation,
    retainFixtureOutput,
} from "@/__tests__/setup/pi-mission";
import { readRetainedBody } from "@/__tests__/setup/retained-history";
import {
    dispatchSourcesOperation,
    seedCapturedSources,
} from "@/__tests__/setup/sources-mission";

const examiner = vi.hoisted(() => vi.fn());
vi.mock("@convex/integrations/documentaryControl", () => ({
    examineDocumentaryContributions: examiner,
}));
afterEach(() => {
    vi.unstubAllEnvs();
    examiner.mockReset();
});

async function qualifyObservedPassage() {
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    const f = await seedCapturedSources();
    await installModel(
        f.t,
        { model: "z-ai/glm-5.3-flash", reasoningEffort: "low" },
        "sources",
    );
    const read = await f.t.run((ctx) =>
        ctx.db
            .query("agentOperationRequests")
            .withIndex("by_mission_and_status", (q) =>
                q.eq("missionId", f.missionId).eq("status", "completed"),
            )
            .first(),
    );
    assert(read?.input.kind === "search_available_material");
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
            output: scopedFixtureControl(
                input.contributions,
                input.contributions.map((c: { id: string }) => ({
                    contributionId: c.id,
                    conclusion: "supported",
                    permittedUse: "context_only",
                    diagnostic: "Supported context.",
                })),
            ),
        };
    });
    const begun = await beginFixtureInvocation(f.t, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "observed-evidence",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    expect(
        JSON.parse(begun.inputJson).triggeringRequestsAndResults,
    ).toContainEqual(
        expect.objectContaining({
            requestId: f.readRequestId,
            status: "completed",
            adopted: true,
        }),
    );
    const finished = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "operations",
            requests: [
                {
                    callId: "observed-evidence",
                    name: "submit_documentary_qualification",
                    inputJson: JSON.stringify({
                        sourceId: f.sourceId,
                        captureId: f.captureId,
                        changes: [
                            {
                                contribution: {
                                    needIds: ["common-context"],
                                    statement:
                                        "The source describes the workflow.",
                                    period: "undated",
                                    modality: "description",
                                    attribution: "Publisher",
                                    kind: "context",
                                    evidence: [
                                        {
                                            readRequestId: read._id,
                                            passageOrder: f.passage.order,
                                        },
                                    ],
                                },
                            },
                        ],
                    }),
                },
            ],
        },
    });
    assert(finished.requestIds[0]);
    const result = await dispatchSourcesOperation(f.t, {
        requestId: finished.requestIds[0],
        expectedGeneration: 4,
    });
    expect(result.kind).toBe("success");
    const qualification = await f.t.run((ctx) =>
        ctx.db
            .query("aiTaskResults")
            .withIndex("by_run", (q) => q.eq("runId", f.runId))
            .take(3),
    );
    const retained = qualification.find(
        (task) => task.output.kind === "documentary_qualification",
    );
    assert(retained?.output.kind === "documentary_qualification");
    expect(retained.output.contributions[0]?.evidence).toEqual([
        {
            captureId: f.captureId,
            passageOrder: f.passage.order,
            quotation: f.passage.quotation,
        },
    ]);
    await f.t.mutation(internal.execution.invocations.settle, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
    });
    return {
        ...f,
        qualification: retained,
        qualificationRequestId: finished.requestIds[0],
    };
}

test("a qualification selects an observed passage and retains its exact quotation without model transcription", async () => {
    const f = await qualifyObservedPassage();
    assert(f.qualification.output.kind === "documentary_qualification");
    const [contribution] = f.qualification.output.contributions;
    assert(contribution);
    const observationsRows = await f.t.run(async (ctx) =>
        ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_run_and_native_input_sequence", (q) =>
                q.eq("runId", f.runId).gt("nativeInputSequence", 0),
            )
            .collect(),
    );
    const observations = await Promise.all(
        observationsRows.map(async (event) =>
            event.contextObservation
                ? JSON.parse(
                      await readRetainedBody(
                          f.t,
                          event.contextObservation.textId,
                      ),
                  )
                : null,
        ),
    );
    expect(observations).toContainEqual(
        expect.objectContaining({
            event: "contributions_qualified",
            taskId: f.qualification._id,
            contributions: expect.any(Array),
            control: {
                findings: expect.objectContaining({
                    [contribution.id]: expect.objectContaining({
                        conclusion: "supported",
                        needs: { "common-context": "context_only" },
                    }),
                }),
                objections: [],
            },
        }),
    );
});

test.each([
    { contributionId: "", legacy: false },
    { contributionId: "   ", legacy: false },
    { contributionId: "", legacy: true },
    { contributionId: "   ", legacy: true },
])("Sources refuses a supplied blank contribution identity $contributionId (legacy: $legacy) before documentary control", async ({
    contributionId,
    legacy,
}) => {
    const f = await qualifyObservedPassage();
    assert(f.qualification.output.kind === "documentary_qualification");
    const first = f.qualification.output.contributions[0];
    assert(first);
    const { id: _id, version: _version, ...contribution } = first;
    const begun = await beginFixtureInvocation(f.t, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "blank-contribution-identity",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    if (legacy) {
        const snapshot = JSON.parse(begun.inputJson);
        const work = domainSnapshot(snapshot).activeWork as Record<
            string,
            unknown
        >;
        delete work.qualificationInputVersion;
        await f.t.run((ctx) =>
            ctx.db.patch(begun.invocationId, {
                inputJson: JSON.stringify(snapshot),
                inputContentHash: undefined,
                sourcesOperationAdmission: undefined,
            }),
        );
    }
    const finished = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "operations",
            requests: [
                {
                    callId: "blank-identity",
                    name: "submit_documentary_qualification",
                    inputJson: JSON.stringify({
                        sourceId: f.sourceId,
                        captureId: f.captureId,
                        ...(legacy
                            ? { expectedTaskId: f.qualification._id }
                            : {}),
                        changes: [
                            {
                                contributionId,
                                contribution: {
                                    ...contribution,
                                    evidence: [
                                        {
                                            readRequestId: f.readRequestId,
                                            passageOrder: f.passage.order,
                                        },
                                    ],
                                },
                            },
                        ],
                    }),
                },
            ],
        },
    });
    const requestId = finished.requestIds[0];
    assert(requestId);
    expect(
        await dispatchSourcesOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({
        kind: "unavailable",
        code: "qualification_invalid",
        validation: {
            path: "changes[0].contributionId",
            expected: expect.stringContaining("Omit"),
        },
    });
    expect(examiner).toHaveBeenCalledTimes(1);
    const current = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(current?.sourcesMission?.qualifications).toEqual([
        f.qualification._id,
    ]);
    expect(await f.t.run((ctx) => ctx.db.get(f.qualification._id))).toEqual(
        f.qualification,
    );
});

test.each([
    false,
    true,
])("Sources replays a retained legacy qualification response with stale version %s using its admitted input contract", async (stale) => {
    const f = await qualifyObservedPassage();
    assert(f.qualification.output.kind === "documentary_qualification");
    const first = f.qualification.output.contributions[0];
    assert(first);
    const { id, version, evidence: _evidence, ...content } = first;
    const args = {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "retained-legacy-qualification",
        provenance: "simulation" as const,
    };
    const begun = await beginFixtureInvocation(f.t, args);
    assert(begun.kind === "ready");
    // Reconstruct the immutable snapshot admitted before semantic-only model inputs.
    const snapshot = JSON.parse(begun.inputJson);
    const work = domainSnapshot(snapshot).activeWork as Record<string, unknown>;
    delete work.qualificationInputVersion;
    work.contributionObservations = [
        {
            taskId: f.qualification._id,
            captureId: f.captureId,
        },
    ];
    const inputJson = JSON.stringify(snapshot);
    await f.t.run((ctx) =>
        ctx.db.patch(begun.invocationId, {
            inputJson,
            inputContentHash: undefined,
            sourcesOperationAdmission: undefined,
        }),
    );
    const response = {
        kind: "operations" as const,
        requests: [
            {
                callId: "legacy-correction",
                name: "submit_documentary_qualification",
                inputJson: JSON.stringify({
                    sourceId: f.sourceId,
                    captureId: f.captureId,
                    expectedTaskId: f.qualification._id,
                    changes: [
                        {
                            contributionId: id,
                            expectedVersion: stale ? version + 1 : version,
                            contribution: {
                                ...content,
                                statement:
                                    "A retained legacy correction with an explicit scope.",
                                evidence: [
                                    {
                                        readRequestId: f.readRequestId,
                                        passageOrder: f.passage.order,
                                    },
                                ],
                            },
                        },
                    ],
                }),
            },
        ],
    };
    await retainFixtureOutput(f.t, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        responseJson: JSON.stringify(response),
    });
    const resumed = await beginFixtureInvocation(f.t, args);
    expect(resumed).toEqual({ ...begun, inputJson });
    const retained = await f.t.run((ctx) => ctx.db.get(begun.invocationId));
    assert(retained?.receivedOutputJson);
    const finished = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        response: JSON.parse(retained.receivedOutputJson),
    });
    const requestId = finished.requestIds[0];
    assert(requestId);
    const result = await dispatchSourcesOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    expect(result).toMatchObject(
        stale
            ? { kind: "unavailable", code: "qualification_version_conflict" }
            : { kind: "success" },
    );
    const current = await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        const taskId = preparation?.sourcesMission?.qualifications[0];
        assert(taskId);
        return ctx.db.get(taskId);
    });
    expect(current?.output).toMatchObject({
        contributions: [{ id, version: stale ? 1 : 2 }],
    });
    expect(await f.t.run((ctx) => ctx.db.get(f.qualification._id))).toEqual(
        f.qualification,
    );
});

test("Sources adds to and corrects an observed qualification without model-supplied versions", async () => {
    const f = await qualifyObservedPassage();
    assert(f.qualification.output.kind === "documentary_qualification");
    const first = f.qualification.output.contributions[0];
    assert(first);
    const { id, version: _version, evidence: _evidence, ...content } = first;
    const begun = await beginFixtureInvocation(f.t, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "semantic-qualification-changes",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const finished = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "operations",
            requests: [
                {
                    callId: "semantic-changes",
                    name: "submit_documentary_qualification",
                    inputJson: JSON.stringify({
                        sourceId: f.sourceId,
                        captureId: f.captureId,
                        changes: [
                            {
                                contributionId: id,
                                contribution: {
                                    ...content,
                                    statement:
                                        "The publisher describes the same workflow with an explicit scope.",
                                    evidence: [
                                        {
                                            readRequestId: f.readRequestId,
                                            passageOrder: f.passage.order,
                                        },
                                    ],
                                },
                            },
                            {
                                contribution: {
                                    ...content,
                                    statement:
                                        "This additional context retains its own contribution identity.",
                                    evidence: [
                                        {
                                            readRequestId: f.readRequestId,
                                            passageOrder: f.passage.order,
                                        },
                                    ],
                                },
                            },
                        ],
                    }),
                },
            ],
        },
    });
    const requestId = finished.requestIds[0];
    assert(requestId);
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        input: {
            expectedTaskId: f.qualification._id,
            changes: [
                { contributionId: id, expectedVersion: 1 },
                {
                    contribution: {
                        statement:
                            "This additional context retains its own contribution identity.",
                    },
                },
            ],
        },
    });
    expect(
        await dispatchSourcesOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "success" });
    const current = await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        const taskId = preparation?.sourcesMission?.qualifications[0];
        assert(taskId);
        return ctx.db.get(taskId);
    });
    assert(current?.output.kind === "documentary_qualification");
    expect(current.output.contributions).toHaveLength(2);
    expect(current.output.contributions[0]).toMatchObject({ id, version: 2 });
    expect(current.output.contributions[1]).toMatchObject({ version: 1 });
    expect(await f.t.run((ctx) => ctx.db.get(f.qualification._id))).toEqual(
        f.qualification,
    );
});

test("Sources preserves the invocation's observed qualification when another writer commits a newer one", async () => {
    const f = await qualifyObservedPassage();
    const begun = await beginFixtureInvocation(f.t, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "stale-qualification-observation",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    expect(
        await f.t.run((ctx) => ctx.db.get(begun.invocationId)),
    ).toMatchObject({
        sourcesOperationAdmission: {
            activeWork: {
                qualificationInputVersion: "observed_v1",
                contributionObservations: [
                    { taskId: f.qualification._id, captureId: f.captureId },
                ],
            },
        },
    });
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        const { _id, _creationTime, ...task } = f.qualification;
        assert(task.output.kind === "documentary_qualification");
        const newerId = await ctx.db.insert("aiTaskResults", {
            ...task,
            output: { ...task.output, version: 2, previousTaskId: _id },
        });
        await ctx.db.patch(preparation._id, {
            sourcesMission: {
                ...preparation.sourcesMission,
                qualifications: [newerId],
            },
        });
    });
    const finished = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "operations",
            requests: [
                {
                    callId: "stale-change",
                    name: "submit_documentary_qualification",
                    inputJson: JSON.stringify({
                        sourceId: f.sourceId,
                        captureId: f.captureId,
                        changes: [
                            {
                                contribution: {
                                    needIds: ["common-context"],
                                    statement: "Additional context.",
                                    period: "undated",
                                    modality: "description",
                                    attribution: "Publisher",
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
                    }),
                },
            ],
        },
    });
    const requestId = finished.requestIds[0];
    assert(requestId);
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
        input: { expectedTaskId: f.qualification._id },
    });
    expect(
        await dispatchSourcesOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({
        kind: "unavailable",
        code: "qualification_version_conflict",
    });
    expect(examiner).toHaveBeenCalledTimes(1);
});

test("Sources completes from semantic need outcomes while the domain supplies the admitted revision and mandatory work", async () => {
    const f = await qualifyObservedPassage();
    const begun = await beginFixtureInvocation(f.t, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "observed-completion",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const result = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "complete",
            needs: [{ needId: "common-context", unfinished: [] }],
        },
    });
    expect(result.kind).toBe("completed");
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(preparation?.sourcesMission?.result).toMatchObject({
        outcome: "complete",
        needsRevision: 1,
        needs: [
            {
                needId: "common-context",
                workRequestIds: [f.qualificationRequestId],
            },
        ],
    });
    expect(preparation?.sourcesMission?.result?.documents).toHaveLength(1);
});

test.each([
    "native",
    "mission",
] as const)("%s refuses a passage present in the index but absent from the selected read result before examiner work", async (caller) => {
    const f = await seedCapturedSources();
    const readRequestId =
        caller === "mission"
            ? f.readRequestId
            : await f.t.mutation(internal.execution.operations.enqueueNative, {
                  runId: f.runId,
                  expectedGeneration: 4,
                  cause: "native-observed-read",
                  input: {
                      kind: "search_available_material",
                      sourceId: f.sourceId,
                      query: "workflow",
                  },
              });
    if (caller === "native")
        expect(
            (
                await dispatchSourcesOperation(f.t, {
                    requestId: readRequestId,
                    expectedGeneration: 4,
                })
            ).kind,
        ).toBe("success");
    await f.t.run(async (ctx) => {
        const { _id, _creationTime, ...passage } = f.passage;
        await ctx.db.insert("sourceSearchPassages", { ...passage, order: 999 });
    });
    const input = {
        kind: "submit_documentary_qualification" as const,
        sourceId: f.sourceId,
        captureId: f.captureId,
        expectedTaskId: null,
        changes: [
            {
                contribution: {
                    needIds: ["common-context"],
                    statement: "Context",
                    attribution: "Publisher",
                    period: "undated",
                    modality: "description",
                    kind: "context" as const,
                    evidence: [{ readRequestId, passageOrder: 999 }],
                },
            },
        ],
    };
    const requestId =
        caller === "native"
            ? await f.t.mutation(internal.execution.operations.enqueueNative, {
                  runId: f.runId,
                  expectedGeneration: 4,
                  cause: "unobserved-passage",
                  input,
              })
            : await f.t.mutation(internal.execution.operations.enqueue, {
                  missionId: f.missionId,
                  expectedGeneration: 4,
                  cause: "unobserved-passage",
                  input,
              });
    const result = await dispatchSourcesOperation(f.t, {
        requestId,
        expectedGeneration: 4,
    });
    expect(result).toMatchObject({
        kind: "unavailable",
        code: "documentary_quote_invalid",
    });
    expect(examiner).not.toHaveBeenCalled();
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission
            ?.controls,
    ).toBe(0);
});

test.each([
    "foreign-run",
    "foreign-mission",
    "not-adopted",
    "adoption-refused",
    "failed",
    "capture-hash",
    "changed-quotation",
] as const)("a qualification rejects %s observed material without consuming control allowance", async (variant) => {
    const f = await seedCapturedSources();
    await f.t.run(async (ctx) => {
        const read = await ctx.db.get(f.readRequestId);
        assert(
            read?.pin?.kind === "saved_material_inspection_v1" &&
                read.outcome?.kind === "success",
        );
        if (variant === "foreign-run") {
            const run = await ctx.db.get(f.runId);
            assert(run);
            const { _id, _creationTime, ...fields } = run;
            const otherRun = await ctx.db.insert("researchRuns", {
                ...fields,
                executionStatus: "idle",
            });
            await ctx.db.patch(read._id, { runId: otherRun });
        } else if (variant === "foreign-mission") {
            await ctx.db.patch(read._id, { missionId: undefined });
        } else if (variant === "not-adopted") {
            await ctx.db.patch(read._id, { adoptedAt: undefined });
        } else if (variant === "adoption-refused") {
            await ctx.db.patch(read._id, {
                adoptionRefusalCode: "stale_execution",
            });
        } else if (variant === "failed") {
            await ctx.db.patch(read._id, {
                outcome: { kind: "unavailable", code: "retrieval_failed" },
            });
        } else if (variant === "capture-hash") {
            await ctx.db.patch(read._id, {
                pin: { ...read.pin, expectedContentHash: "different-content" },
            });
        } else {
            const result = JSON.parse(read.outcome.valueJson);
            result.passages[0].exactQuote = "Invented quotation";
            await ctx.db.patch(read._id, {
                outcome: { ...read.outcome, valueJson: JSON.stringify(result) },
            });
        }
    });
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "invalid-observation",
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
                            attribution: "Publisher",
                            period: "undated",
                            modality: "reported",
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
    expect(
        await dispatchSourcesOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "unavailable", code: "documentary_quote_invalid" });
    expect(examiner).not.toHaveBeenCalled();
    expect(
        (await f.t.run((ctx) => ctx.db.get(f.preparationId)))?.sourcesMission,
    ).toMatchObject({ controls: 0, qualifications: [] });
});

test.each([
    "chosen-read",
    "missing-read",
    "duplicate-read",
] as const)("completion preserves explicit semantic gap and %s accounting", async (variant) => {
    const f = await seedCapturedSources();
    const begun = await beginFixtureInvocation(f.t, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "explicit-reading",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    const readRequestIds =
        variant === "chosen-read"
            ? [f.readRequestId]
            : variant === "duplicate-read"
              ? [f.readRequestId, f.readRequestId]
              : [];
    const outcome = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "complete",
            needs: [
                {
                    needId: "common-context",
                    gap: "The examined passage does not establish the requested economics.",
                    unfinished: [],
                    readRequestIds,
                },
            ],
        },
    });
    if (variant === "chosen-read") {
        expect(outcome).toMatchObject({ kind: "completed" });
        expect(
            (await f.t.run((ctx) => ctx.db.get(f.preparationId)))
                ?.sourcesMission?.result,
        ).toMatchObject({
            outcome: "complete",
            documents: [],
            needs: [
                {
                    gap: "The examined passage does not establish the requested economics.",
                    workRequestIds: [f.readRequestId],
                },
            ],
        });
    } else {
        expect(outcome).toMatchObject({
            kind: "blocked",
            code: "completion_correction_required",
        });
        expect(
            (await f.t.run((ctx) => ctx.db.get(f.preparationId)))
                ?.sourcesMission?.result,
        ).toBeUndefined();
    }
});

test.each([
    "adopted",
    "not-adopted",
    "foreign-mission",
    "failed",
    "capture-hash",
] as const)("a contextual-only gap requires an admitted reading: %s", async (variant) => {
    const f = await seedCapturedSources();
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.missionId,
            expectedGeneration: 4,
            cause: "examine-gap-in-context",
            input: {
                kind: "read_in_context",
                sourceId: f.sourceId,
                passageOrder: f.passage.order,
            },
        },
    );
    expect(
        await dispatchFixtureOperation(f.t, {
            requestId,
            expectedGeneration: 4,
        }),
    ).toMatchObject({ kind: "success" });
    const read = await f.t.run((ctx) => ctx.db.get(requestId));
    expect(read).toMatchObject({
        status: "completed",
        input: { kind: "read_in_context" },
        adoptedAt: expect.any(Number),
    });
    const begun = await beginFixtureInvocation(f.t, {
        missionId: f.missionId,
        expectedGeneration: 4,
        taskKey: "contextual-gap",
        provenance: "simulation",
    });
    assert(begun.kind === "ready");
    if (variant !== "adopted") {
        await f.t.run(async (ctx) => {
            const retained = await ctx.db.get(requestId);
            assert(retained?.pin?.kind === "saved_material_inspection_v1");
            if (variant === "not-adopted")
                await ctx.db.patch(requestId, { adoptedAt: undefined });
            else if (variant === "foreign-mission")
                await ctx.db.patch(requestId, { missionId: undefined });
            else if (variant === "failed")
                await ctx.db.patch(requestId, {
                    outcome: { kind: "unavailable", code: "retrieval_failed" },
                });
            else
                await ctx.db.patch(requestId, {
                    pin: {
                        ...retained.pin,
                        expectedContentHash: "different-capture",
                    },
                });
        });
    }
    const gap =
        "The examined passage does not establish the requested economics.";
    const outcome = await f.t.mutation(internal.execution.invocations.finish, {
        invocationId: begun.invocationId,
        expectedGeneration: 4,
        response: {
            kind: "complete",
            needs: [
                {
                    needId: "common-context",
                    gap,
                    unfinished: [],
                    readRequestIds: [requestId],
                },
            ],
        },
    });
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    if (variant === "adopted") {
        expect(outcome, JSON.stringify(outcome)).toMatchObject({
            kind: "completed",
        });
        expect(preparation?.sourcesMission?.result).toMatchObject({
            outcome: "complete",
            documents: [],
            needs: [
                { needId: "common-context", gap, workRequestIds: [requestId] },
            ],
        });
    } else {
        expect(outcome).toMatchObject({
            kind: "blocked",
            code: "completion_correction_required",
        });
        expect(preparation?.sourcesMission?.result).toBeUndefined();
        expect(
            (await f.t.run((ctx) => ctx.db.get(f.missionId)))?.status,
        ).not.toBe("completed");
    }
    expect(preparation?.sourcesMission).toMatchObject({
        controls: 0,
        qualifications: [],
    });
    expect(examiner).not.toHaveBeenCalled();
});

test("an unchanged observed contribution preserves version three and earlier qualification snapshots", async () => {
    const f = await qualifyObservedPassage();
    let before = f.qualification;
    const correctedStatement =
        "The source describes workflow context for the issuer.";
    for (const [cause, statement, expectedVersion] of [
        ["expand-context", "The source describes workflow context.", 2],
        ["issuer-context", correctedStatement, 3],
        ["unchanged-context", correctedStatement, 3],
    ] as const) {
        assert(before.output.kind === "documentary_qualification");
        const contribution = before.output.contributions[0];
        assert(contribution);
        const { id, version, evidence: _evidence, ...content } = contribution;
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId: f.missionId,
                expectedGeneration: 4,
                cause,
                input: {
                    kind: "submit_documentary_qualification",
                    sourceId: f.sourceId,
                    captureId: f.captureId,
                    expectedTaskId: before._id,
                    changes: [
                        {
                            contributionId: id,
                            expectedVersion: version,
                            contribution: {
                                ...content,
                                statement,
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
        expect(
            await dispatchSourcesOperation(f.t, {
                requestId,
                expectedGeneration: 4,
            }),
        ).toMatchObject({ kind: "success" });
        const after = await f.t.run(async (ctx) => {
            const preparation = await ctx.db.get(f.preparationId);
            const taskId = preparation?.sourcesMission?.qualifications[0];
            assert(taskId);
            return ctx.db.get(taskId);
        });
        assert(after?.output.kind === "documentary_qualification");
        expect(after.output.contributions).toEqual([
            {
                ...contribution,
                statement,
                version: expectedVersion,
            },
        ]);
        expect(await f.t.run((ctx) => ctx.db.get(before._id))).toEqual(before);
        if (cause === "unchanged-context") {
            expect(after.output.contributions).toEqual(
                before.output.contributions,
            );
            expect(after.output.controlTaskId).toBe(
                before.output.controlTaskId,
            );
        }
        before = after;
    }
    expect(await f.t.run((ctx) => ctx.db.get(f.qualification._id))).toEqual(
        f.qualification,
    );
    expect(examiner).toHaveBeenCalledTimes(3);
});
