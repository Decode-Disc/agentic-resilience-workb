import { api, internal } from "@convex/_generated/api";
import { readResearchState } from "@convex/domain/researchState";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { commonOperations } from "@convex/execution/commonOperations";
import { operationReuseIdentity } from "@convex/execution/missionData";
import { afterEach, assert, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { seedResearchStateScenario } from "@/__tests__/setup/research-state";

const scenario = (blockCode: string | undefined = "invalid_output") =>
    seedResearchStateScenario({
        outcome: "partial",
        blockCode,
        historicalTimeLimitNote: true,
        retainedDocumentCount: 4,
        capturedDocumentCount: 5,
    });
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});
async function facts(f: Awaited<ReturnType<typeof scenario>>) {
    return f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId),
            mission = await ctx.db.get(f.workbenchMissionId);
        assert(run && mission);
        const result = await getAgentDefinition("workbench_v1").context(
            ctx,
            mission,
            run,
        );
        assert(result.kind === "ready");
        return result.context;
    });
}
test("settled model failure remains visible in fresh Workbench facts", async () => {
    const f = await scenario();
    const context = await facts(f);
    expect(context.research).toMatchObject({
        sources: {
            outcome: "partial",
            executionStop: {
                missionId: f.missionId,
                blockCode: "invalid_output",
            },
        },
        actions: {
            resume: { applicable: false },
            usePrepared: { applicable: false },
        },
        nextCapability: "investigation_unavailable",
    });
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(JSON.stringify(preparation?.sourcesMission?.result)).toBe(
        f.resultJson,
    );
});
test("retained document membership is distinct from consultable captures", async () => {
    const f = await scenario();
    const context = await facts(f);
    expect(context.research).toMatchObject({
        sources: {
            retainedDocuments: f.sourceIds.slice(0, 4).map((sourceId, i) => ({
                sourceId,
                title:
                    i === 0
                        ? "Workflow products"
                        : `Retained workflow document ${i + 1}`,
            })),
        },
    });
    expect(context.availableMaterials).toHaveLength(5);
    expect(context.documentaryPreparation).toMatchObject({
        executionStop: { blockCode: "invalid_output" },
        result: {
            documents: expect.arrayContaining([
                expect.objectContaining({ title: "Workflow products" }),
            ]),
        },
    });
});
test("missing stop cause remains unknown", async () => {
    const f = await scenario();
    await f.t.run((ctx) => ctx.db.patch(f.missionId, { blockCode: undefined }));
    expect((await facts(f)).research).toMatchObject({
        sources: { executionStop: { blockCode: null } },
    });
});
test("changed stop cause invalidates facts with unchanged run metadata", async () => {
    const f = await scenario();
    const beforeRun = await f.t.run((ctx) => ctx.db.get(f.runId));
    const before = await facts(f);
    await f.t.run((ctx) =>
        ctx.db.patch(f.missionId, { blockCode: "execution_time_limit" }),
    );
    expect((await facts(f)).factsRevisionHash).not.toBe(
        before.factsRevisionHash,
    );
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toEqual(beforeRun);
});
test.each([
    "running",
    "cancelled",
    "failed",
    "paused",
] as const)("later %s preserves the partial documentary outcome and completed-with-limits Sources phase", async (executionStatus) => {
    const f = await scenario();
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            lifecycleState: "extracting_evidence",
            executionStatus,
        }),
    );
    const research = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return readResearchState(ctx, run);
    });
    expect(research).toMatchObject({
        status: executionStatus,
        sources: { outcome: "partial", phase: "completed_with_limits" },
    });
    const overview = await f.t
        .withIdentity({ subject: f.userId })
        .query(api.sourcesWorkspace.overview, { runId: f.runId });
    expect(overview).toMatchObject({
        materialOutcome: "partial",
        research: {
            status: executionStatus,
            sources: { phase: "completed_with_limits" },
        },
    });
    expect(
        JSON.stringify(
            (await f.t.run((ctx) => ctx.db.get(f.preparationId)))
                ?.sourcesMission?.result,
        ),
    ).toBe(f.resultJson);
});
test.each([
    "invalid_output",
    undefined,
] as const)("real cancellation cleanup retains the earlier documentary stop (%s) without rewriting history", async (blockCode) => {
    const f = await seedResearchStateScenario({
        outcome: "partial",
        blockCode,
        retainedDocumentCount: 1,
        capturedDocumentCount: 1,
        historicalTimeLimitNote: true,
    });
    workflowTest.register(f.t);
    const before = await businessSnapshot(f);
    const observations = await f.t.run((ctx) =>
        ctx.db.query("agentExecutionEvents").collect(),
    );
    const expected = (await facts(f)).research;
    await f.t
        .withIdentity({ subject: f.userId })
        .mutation(api.workflowControls.cancel, { runId: f.runId });
    const cancelled = await f.t.run((ctx) => ctx.db.get(f.runId));
    assert(cancelled);
    const cleanup = {
        runId: f.runId,
        cancelledAt: cancelled.updatedAt,
        cancelledGeneration: cancelled.executionGeneration - 1,
    };
    await f.t.mutation(
        internal.execution.cancellation.continueRunCancellation,
        cleanup,
    );
    const mission = await f.t.run((ctx) => ctx.db.get(f.missionId));
    expect(mission).toMatchObject({
        status: "cancelled",
        blockCode: "run_cancelled",
    });
    const snapshot = await f.t
        .withIdentity({ subject: f.userId })
        .query(api.workbench.snapshot, { runId: f.runId });
    const research = snapshot.research;
    expect(research).toMatchObject({
        status: "cancelled",
        sources: {
            outcome: "partial",
            phase: "completed_with_limits",
            executionStop: {
                missionId: f.missionId,
                blockCode: blockCode ?? null,
            },
        },
    });
    assert(expected && typeof expected === "object" && "sources" in expected);
    expect(research).toMatchObject({ sources: expected.sources });
    const after = await businessSnapshot(f);
    expect(after.preparation).toEqual(before.preparation);
    expect(after.providers).toEqual(before.providers);
    await f.t.run(async (ctx) => {
        for (const event of observations)
            expect(await ctx.db.get(event._id)).toEqual(event);
    });
    const retained = await f.t.run((ctx) =>
        ctx.db.query("agentExecutionEvents").collect(),
    );
    await f.t.mutation(
        internal.execution.cancellation.continueRunCancellation,
        cleanup,
    );
    expect(
        await f.t.run((ctx) => ctx.db.query("agentExecutionEvents").collect()),
    ).toEqual(retained);
});

test("cancelled historical material without a retained stop does not infer one from prose", async () => {
    const f = await scenario();
    await f.t.run((ctx) =>
        ctx.db.patch(f.missionId, {
            status: "cancelled",
            blockCode: "run_cancelled",
        }),
    );
    const snapshot = await f.t
        .withIdentity({ subject: f.userId })
        .query(api.workbench.snapshot, { runId: f.runId });
    expect(snapshot.research.sources).toMatchObject({
        outcome: "partial",
        executionStop: null,
    });
});

test("a generic resource stop does not claim exhaustion of documentary authorization", async () => {
    const f = await scenario("resource_limit");
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    assert(preparation?.sourcesMission);
    const usage = preparation.sourcesMission;
    expect(usage.controls).toBeLessThan(usage.envelope.controls);
    expect(usage.acquisitions).toBeLessThan(usage.envelope.acquisitions);
    expect(usage.searches).toBeLessThan(usage.envelope.initialSearches);
    const context = await facts(f);
    expect(context.research).toMatchObject({
        sources: {
            outcome: "partial",
            executionStop: { blockCode: "resource_limit" },
        },
        summary: expect.stringContaining("technical limit"),
    });
    expect(context.research).toHaveProperty(
        "summary",
        expect.not.stringContaining("reaching its authorized capacity"),
    );
});

test("temporary slot refusal does not imply settlement availability", async () => {
    const f = await scenario();
    await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        const { _id, _creationTime, ...other } = run;
        await ctx.db.insert("researchRuns", {
            ...other,
            executionStatus: "running",
        });
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        await ctx.db.patch(f.preparationId, {
            status: "started",
            completedAt: undefined,
            sourcesMission: {
                ...preparation.sourcesMission,
                result: undefined,
            },
        });
        await ctx.db.patch(f.runId, {
            lifecycleState: "discovering_sources",
            executionStatus: "paused",
            pauseReason: "analyst",
        });
    });
    expect((await facts(f)).research).toMatchObject({
        actions: {
            resume: { applicable: false, reason: "execution_slot_unavailable" },
            usePrepared: { applicable: false },
        },
    });
});

async function dispatchState(
    f: Awaited<ReturnType<typeof scenario>>,
    cause = "current-state",
) {
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.workbenchMissionId,
            expectedGeneration: 1,
            cause,
            input: { kind: "consult_run_state" },
        },
    );
    const outcome = await f.t.action(internal.execution.operations.dispatch, {
        requestId,
        expectedGeneration: 1,
    });
    assert(outcome.kind === "success", JSON.stringify(outcome));
    return { requestId, outcome, value: JSON.parse(outcome.valueJson) };
}
async function businessSnapshot(f: Awaited<ReturnType<typeof scenario>>) {
    return f.t.run(async (ctx) => ({
        run: await ctx.db.get(f.runId),
        preparation: await ctx.db.get(f.preparationId),
        framing: await ctx.db.query("framingRevisions").collect(),
        approvals: await ctx.db.query("approvalRequests").collect(),
        grants: await ctx.db.query("approvalGrants").collect(),
        providers: await ctx.db.query("providerCalls").collect(),
    }));
}
test("registered consultation agrees with automatic research facts", async () => {
    const f = await scenario();
    const before = await businessSnapshot(f);
    const read = await dispatchState(f);
    const automatic = (await facts(f)).research;
    assert(automatic && typeof automatic === "object");
    expect(automatic).toEqual({
        ...read.value.research,
        summary: expect.any(String),
    });
    expect(await businessSnapshot(f)).toEqual(before);
});
test("completed version-one read replays its original receipt", async () => {
    const f = await scenario();
    const { requestId } = await dispatchState(f);
    const legacy = {
        kind: "success" as const,
        valueJson:
            '{"lifecycleState":"sources_prepared","executionStatus":"idle","executionGeneration":4}',
    };
    await f.t.run((ctx) =>
        ctx.db.patch(requestId, { operationVersion: 1, outcome: legacy }),
    );
    const before = await f.t.run((ctx) => ctx.db.get(requestId));
    const business = await businessSnapshot(f);
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toEqual(legacy);
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toEqual(before);
    expect(await businessSnapshot(f)).toEqual(business);
});
test("pending version-one read reports operation version conflict", async () => {
    const f = await scenario();
    const requestId = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.workbenchMissionId,
            expectedGeneration: 1,
            cause: "old-read",
            input: { kind: "consult_run_state" },
        },
    );
    await f.t.run(async (ctx) => {
        const request = await ctx.db.get(requestId),
            mission = await ctx.db.get(f.workbenchMissionId);
        assert(request && mission);
        const logicalKey = sha256Hex(
            stableStringify(
                operationReuseIdentity({
                    mission,
                    runId: f.runId,
                    version: 1,
                    input: request.input,
                    pin: request.pin,
                }),
            ),
        );
        await ctx.db.patch(requestId, { operationVersion: 1, logicalKey });
    });
    const before = await businessSnapshot(f);
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "refused", code: "operation_version_conflict" });
    expect(await businessSnapshot(f)).toEqual(before);
    expect(
        (await f.t.run((ctx) => ctx.db.get(requestId)))?.operationVersion,
    ).toBe(1);
    expect(
        (await dispatchState(f, "fresh-read")).value.research.sources
            .executionStop.blockCode,
    ).toBe("invalid_output");
});
test("state pin detects a changed Sources stop without a run update", async () => {
    const f = await scenario();
    const pin = () =>
        f.t.run(async (ctx) => {
            const mission = await ctx.db.get(f.workbenchMissionId);
            assert(mission);
            return commonOperations.consult_run_state.pin(ctx, mission, {
                kind: "consult_run_state",
            });
        });
    const before = await pin();
    const run = await f.t.run((ctx) => ctx.db.get(f.runId));
    await f.t.run((ctx) =>
        ctx.db.patch(f.missionId, { blockCode: "resource_limit" }),
    );
    expect(await pin()).not.toEqual(before);
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toEqual(run);
});
test("dossier consultation rejects foreign and stale authority", async () => {
    const f = await scenario();
    const foreignId = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        const { _id, _creationTime, ...fields } = run;
        return ctx.db.insert("researchRuns", fields);
    });
    await expect(
        f.t.query(internal.execution.operations.readRunState, {
            runId: foreignId,
            missionId: f.workbenchMissionId,
            expectedGeneration: 1,
        }),
    ).rejects.toMatchObject({ data: { code: "not_authorized" } });
    await expect(
        f.t.query(internal.execution.operations.readRunState, {
            runId: f.runId,
            missionId: f.workbenchMissionId,
            expectedGeneration: 0,
        }),
    ).rejects.toMatchObject({ data: { code: "stale_execution" } });
    await expect(
        f.t.query(internal.execution.operations.readRunState, {
            runId: f.runId,
            expectedGeneration: 3,
        }),
    ).rejects.toMatchObject({ data: { code: "stale_execution" } });
});
test("foreign retained document metadata is rejected while missing metadata stays unknown", async () => {
    const f = await scenario();
    const sourceId = f.sourceIds[0];
    assert(sourceId);
    await f.t.run((ctx) => ctx.db.delete(sourceId));
    const state = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return readResearchState(ctx, run);
    });
    expect(state.sources?.retainedDocuments[0]).toEqual({
        sourceId,
        title: null,
    });
    const foreignSource = f.sourceIds[1];
    assert(foreignSource);
    await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        const { _id, _creationTime, ...fields } = run;
        const foreignId = await ctx.db.insert("researchRuns", fields);
        await ctx.db.patch(foreignSource, { runId: foreignId });
    });
    await expect(
        f.t.query(internal.execution.operations.readRunState, {
            runId: f.runId,
            expectedGeneration: 4,
        }),
    ).rejects.toMatchObject({ data: { code: "not_authorized" } });
});

test("historical non-mission preparation does not acquire Sources mission semantics", async () => {
    const f = await scenario();
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { sourcesProtocol: undefined }),
    );
    const state = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return readResearchState(ctx, run);
    });
    expect(state.sources).toBeNull();
    expect(state.nextCapability).toBeNull();
});
test("registered consultation preserves full labels or explicitly reports result capacity", async () => {
    const f = await seedResearchStateScenario({
        outcome: "partial",
        retainedDocumentCount: 60,
        capturedDocumentCount: 60,
    });
    for (const length of [100, 1_100]) {
        const title = "é".repeat(length);
        await f.t.run(async (ctx) => {
            for (const sourceId of f.sourceIds)
                await ctx.db.patch(sourceId, { title });
        });
        const before = await businessSnapshot(f);
        const requestId = await f.t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId: f.workbenchMissionId,
                expectedGeneration: 1,
                cause: `labels-${length}`,
                input: { kind: "consult_run_state" },
            },
        );
        const outcome = await f.t.action(
            internal.execution.operations.dispatch,
            {
                requestId,
                expectedGeneration: 1,
            },
        );
        if (length === 100) {
            assert(outcome.kind === "success");
            expect(
                JSON.parse(outcome.valueJson).research.sources
                    .retainedDocuments,
            ).toEqual(f.sourceIds.map((sourceId) => ({ sourceId, title })));
        } else {
            expect(outcome).toEqual({
                kind: "unavailable",
                code: "operation_result_capacity",
            });
            expect(
                await f.t.action(internal.execution.operations.dispatch, {
                    requestId,
                    expectedGeneration: 1,
                }),
            ).toEqual(outcome);
        }
        expect(await businessSnapshot(f)).toEqual(before);
        expect(
            await f.t.run(async (ctx) => {
                const run = await ctx.db.get(f.runId);
                assert(run);
                return (await readResearchState(ctx, run)).sources
                    ?.retainedDocuments;
            }),
        ).toEqual(f.sourceIds.map((sourceId) => ({ sourceId, title })));
    }
});

test("large retained handoff stays on detail paths rather than expanding compact consultation", async () => {
    const { MAX_OPERATION_RESULT_BYTES } = await import(
        "@convex/resourcePolicy"
    );
    const f = await scenario();
    const before = await dispatchState(f);
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission?.result);
        const need = preparation.sourcesMission.result.needs[0];
        assert(need);
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                result: {
                    ...preparation.sourcesMission.result,
                    needs: [
                        {
                            ...need,
                            gap: "Retained detailed gap. ".repeat(
                                Math.floor(MAX_OPERATION_RESULT_BYTES / 24),
                            ),
                        },
                    ],
                },
            },
        });
    });
    const after = await dispatchState(f, "large-handoff");
    expect(after.value).toEqual(before.value);
    expect(after.outcome.valueJson).not.toContain("Retained detailed gap");
    expect(after.outcome.valueJson).not.toContain("contributions");
});

test.each([
    ["complete", 1, "Sources preparation is complete."],
    ["blocked", 0, "Sources preparation ended without usable material."],
] as const)("a %s documentary handoff remains distinct from research completion", async (outcome, retainedDocumentCount, summary) => {
    const f = await seedResearchStateScenario({
        outcome,
        retainedDocumentCount,
        capturedDocumentCount: 1,
    });
    const context = await facts(f);
    expect(context.research).toMatchObject({
        status: "idle",
        sources: { outcome, retainedDocuments: expect.any(Array) },
        summary: expect.stringContaining(summary),
    });
    const projected = context.research as {
        summary: string;
        sources: { retainedDocuments: unknown[] };
    };
    expect(projected.sources.retainedDocuments).toHaveLength(
        retainedDocumentCount,
    );
    expect(projected.summary).not.toContain("Research is complete.");
});

test("captured-only material keeps its qualification and membership distinct in both consumers", async () => {
    const f = await seedResearchStateScenario({
        outcome: "partial",
        blockCode: "invalid_output",
        historicalTimeLimitNote: true,
        retainedDocumentCount: 4,
        capturedDocumentCount: 5,
        uncapturedDocumentCount: 4,
    });
    const fifthId = f.sourceIds[4];
    assert(fifthId);
    await f.t.run((ctx) =>
        ctx.db.patch(fifthId, { title: "8-K · 2026-10-28" }),
    );
    const owner = f.t.withIdentity({ subject: f.userId });
    const rows = await owner.query(api.sourcesWorkspace.listSources, {
        runId: f.runId,
    });
    const overview = await owner.query(api.sourcesWorkspace.overview, {
        runId: f.runId,
    });
    expect(rows).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                sourceId: f.sourceIds[4],
                reading: "full",
                membership: "not_retained",
                qualification: { status: "not_recorded" },
                contributions: null,
            }),
        ]),
    );
    const context = await facts(f);
    expect(context.availableMaterials).toHaveLength(5);
    expect(context.availableMaterials).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                sourceId: f.sourceIds[4],
                documentaryState: expect.objectContaining({
                    membership: "not_retained",
                    qualification: { status: "not_recorded" },
                    contributions: null,
                }),
            }),
        ]),
    );
    expect(overview).toMatchObject({
        collect: { candidates: 9 },
        reading: { captured: 5 },
        organize: {
            retained: 4,
            notRetainedCaptured: 1,
            notRetainedWithoutAvailableCapture: 4,
        },
    });
    const preparation = await f.t.run((ctx) => ctx.db.get(f.preparationId));
    expect(JSON.stringify(preparation?.sourcesMission?.result)).toBe(
        f.resultJson,
    );
});

test("same-source capture does not inherit another capture's qualification", async () => {
    const f = await scenario();
    const captureId = await f.t.run(async (ctx) => {
        const capture = await ctx.db.get(f.captureId);
        const preparation = await ctx.db.get(f.preparationId);
        assert(capture && preparation?.sourcesMission);
        const { _id, _creationTime, ...fields } = capture;
        const nextId = await ctx.db.insert("sourceCaptures", {
            ...fields,
            captureKey: "later-unqualified",
            contentHash: "another-hash",
            updatedAt: capture.updatedAt + 1,
        });
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                captureIds: [...preparation.sourcesMission.captureIds, nextId],
            },
        });
        return nextId;
    });
    const owner = f.t.withIdentity({ subject: f.userId });
    const rows = await owner.query(api.sourcesWorkspace.listSources, {
        runId: f.runId,
    });
    expect(rows?.find((row) => row.sourceId === f.sourceId)).toMatchObject({
        capture: { captureId, contentHash: "another-hash" },
        qualification: { status: "not_recorded" },
        contributions: null,
        retainedSnapshot: { captureId: f.captureId, needsRevision: 1 },
    });
    expect((await facts(f)).availableMaterials).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                sourceId: f.sourceId,
                capture: expect.objectContaining({ captureId }),
                documentaryState: expect.objectContaining({
                    qualification: { status: "not_recorded" },
                    contributions: null,
                    retainedSnapshot: expect.objectContaining({
                        captureId: f.captureId,
                    }),
                }),
            }),
        ]),
    );
    const reader = await owner.query(api.sourcesWorkspace.getSource, {
        runId: f.runId,
        sourceId: f.sourceId,
    });
    expect(reader).toMatchObject({
        capture: { captureId: f.captureId },
        source: {
            capture: { captureId: f.captureId },
            qualification: { status: "recorded", captureId: f.captureId },
        },
    });
    expect(
        JSON.stringify(
            (await f.t.run((ctx) => ctx.db.get(f.preparationId)))
                ?.sourcesMission?.result,
        ),
    ).toBe(f.resultJson);
});

test("a qualification from another preparation is rejected", async () => {
    const f = await scenario();
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        const { _id, _creationTime, ...fields } = preparation;
        const otherId = await ctx.db.insert(
            "sourceSelectionProposalRebuilds",
            fields,
        );
        const taskId = preparation.sourcesMission.qualifications[0];
        assert(taskId);
        const task = await ctx.db.get(taskId);
        assert(task?.output.kind === "documentary_qualification");
        await ctx.db.patch(taskId, {
            output: { ...task.output, preparationId: otherId },
        });
    });
    const owner = f.t.withIdentity({ subject: f.userId });
    await expect(
        owner.query(api.sourcesWorkspace.listSources, { runId: f.runId }),
    ).rejects.toThrow(/qualification_invalid/);
    await expect(facts(f)).rejects.toThrow(/qualification_invalid/);
});

test("retained aggregate refuses a mismatched frozen qualification pin", async () => {
    const f = await scenario();
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission?.result);
        const data = preparation.sourcesMission;
        const result = data.result;
        assert(result);
        const second = result.documents[1];
        assert(second);
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...data,
                result: {
                    ...result,
                    documents: result.documents.map((document, i) =>
                        i === 0
                            ? {
                                  ...document,
                                  qualificationTaskId:
                                      second.qualificationTaskId,
                              }
                            : document,
                    ),
                },
            },
        });
    });
    await expect(
        f.t
            .withIdentity({ subject: f.userId })
            .query(api.sourcesWorkspace.overview, { runId: f.runId }),
    ).rejects.toThrow(/qualification_invalid/);
});

test("current Sources summary preserves an older handoff explanation as recorded history", async () => {
    const f = await scenario();
    const overview = await f.t
        .withIdentity({ subject: f.userId })
        .query(api.sourcesWorkspace.overview, { runId: f.runId });
    expect(overview).toMatchObject({
        research: {
            sources: {
                outcome: "partial",
                executionStop: { blockCode: "invalid_output" },
                settledAt: 2,
            },
        },
    });
    const context = await facts(f);
    const research = context.research as { summary: string };
    expect(overview).toHaveProperty("researchSummary", research.summary);
    expect(research.summary).toContain("model response could not be used");
    // Every surface states the current stop with the same sentence.
    expect(overview?.currentStop).toBe(
        "The Sources Agent stopped because its model response could not be used.",
    );
    expect(research.summary).toContain(overview?.currentStop);
    expect(
        JSON.stringify(
            (await f.t.run((ctx) => ctx.db.get(f.preparationId)))
                ?.sourcesMission?.result,
        ),
    ).toBe(f.resultJson);
});

test("not-retained unavailable and in-progress captures do not become never-captured claims", async () => {
    const f = await seedResearchStateScenario({
        outcome: "partial",
        retainedDocumentCount: 4,
        capturedDocumentCount: 5,
        uncapturedDocumentCount: 4,
    });
    const acquisitions = await f.t.run(async (ctx) => {
        const source = await ctx.db.get(f.sourceId),
            capture = await ctx.db.get(f.captureId);
        assert(source && capture);
        const {
            _id: sourceId,
            _creationTime: sourceTime,
            ...sourceFields
        } = source;
        const {
            _id: captureId,
            _creationTime: captureTime,
            ...captureFields
        } = capture;
        const acquisitions = [];
        for (const status of ["unavailable", "reserved"] as const) {
            const id = await ctx.db.insert("sources", {
                ...sourceFields,
                title: status,
                canonicalUrl: `https://example.com/${status}`,
            });
            await ctx.db.insert("sourceCaptures", {
                ...captureFields,
                sourceId: id,
                captureKey: status,
                status,
            });
            acquisitions.push({ sourceId: id, status });
        }
        return acquisitions;
    });
    const overview = await f.t
        .withIdentity({ subject: f.userId })
        .query(api.sourcesWorkspace.overview, { runId: f.runId });
    expect(overview).toMatchObject({
        collect: { candidates: 11 },
        reading: { captured: 5, notCaptured: 4, unavailable: 1, capturing: 1 },
        organize: {
            retained: 4,
            notRetainedCaptured: 1,
            notRetainedWithoutAvailableCapture: 6,
        },
    });
    const client = f.t.withIdentity({ subject: f.userId });
    const rows = await client.query(api.sourcesWorkspace.listSources, {
        runId: f.runId,
    });
    for (const acquisition of acquisitions) {
        const expected =
            acquisition.status === "reserved" ? "capturing" : "unavailable";
        expect(
            rows?.find((row) => row.sourceId === acquisition.sourceId),
        ).toMatchObject({ reading: expected });
        const reader = await client.query(api.sourcesWorkspace.getSource, {
            runId: f.runId,
            sourceId: acquisition.sourceId,
        });
        expect(reader).toMatchObject({
            source: { reading: expected, capture: null },
            capture: null,
            excerpts: "none",
        });
    }
});

test("native material state does not expose a workspace-only capture", async () => {
    const f = await scenario();
    const sourceId = await f.t.run(async (ctx) => {
        const source = await ctx.db.get(f.sourceId),
            capture = await ctx.db.get(f.captureId);
        assert(source && capture);
        const {
            _id: oldSourceId,
            _creationTime: sourceTime,
            ...sourceFields
        } = source;
        const {
            _id: captureId,
            _creationTime: captureTime,
            ...captureFields
        } = capture;
        const id = await ctx.db.insert("sources", {
            ...sourceFields,
            title: "Workspace-only capture",
            canonicalUrl: "https://example.com/workspace-only",
        });
        await ctx.db.insert("sourceCaptures", {
            ...captureFields,
            sourceId: id,
            captureKey: "workspace-only",
        });
        return id;
    });
    const rows = await f.t
        .withIdentity({ subject: f.userId })
        .query(api.sourcesWorkspace.listSources, { runId: f.runId });
    expect(rows).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                sourceId,
                reading: "full",
                qualification: { status: "not_recorded" },
            }),
        ]),
    );
    expect((await facts(f)).availableMaterials).toHaveLength(5);
    expect((await facts(f)).availableMaterials).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ sourceId })]),
    );
});

test("an analyst exclusion keeps an unqualified capture visible only to the workspace", async () => {
    const f = await scenario();
    const sourceId = f.sourceIds[4];
    assert(sourceId);
    await f.t.withIdentity({ subject: f.userId }).mutation(api.sources.decide, {
        runId: f.runId,
        corpusRevisionId: f.corpusRevisionId,
        sourceId,
        decision: "rejected",
        decisionKey: "exclude-unqualified",
    });
    const rows = await f.t
        .withIdentity({ subject: f.userId })
        .query(api.sourcesWorkspace.listSources, { runId: f.runId });
    expect(rows?.find((row) => row.sourceId === sourceId)).toMatchObject({
        membership: "excluded",
    });
    expect((await facts(f)).availableMaterials).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ sourceId })]),
    );
});

test("a saved capture without indexed passages does not claim an opening excerpt", async () => {
    const f = await scenario();
    const sourceId = f.sourceIds[4];
    assert(sourceId);
    const reader = await f.t
        .withIdentity({ subject: f.userId })
        .query(api.sourcesWorkspace.getSource, { runId: f.runId, sourceId });
    expect(reader).toMatchObject({
        sections: [],
        excerpts: "none",
        source: { qualification: { status: "not_recorded" } },
    });
    expect(reader?.capture).not.toBeNull();
});

test("dossier reads distinguish a settled partial handoff from pending settlement", async () => {
    const f = await scenario();
    const owner = f.t.withIdentity({ subject: f.userId });
    const settled = await owner.query(api.researchRuns.getMine, {
        runId: f.runId,
    });
    expect(settled.sourcesPhase).toBe("completed_with_limits");
    const visitor = await owner.query(api.visitors.current, {});
    assert(visitor?.workspace);
    const { page } = await owner.query(api.researchRuns.listMine, {
        workspaceKey: visitor.workspace.key,
        paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.find((run) => run.runId === f.runId)).toMatchObject({
        sourcesPhase: "completed_with_limits",
    });
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, {
            lifecycleState: "discovering_sources",
            executionStatus: "running",
        });
        await ctx.db.patch(f.preparationId, { status: "started" });
        await ctx.db.patch(f.missionId, { status: "completed" });
    });
    const pending = await owner.query(api.researchRuns.getMine, {
        runId: f.runId,
    });
    expect(pending.sourcesPhase).toBe("waiting");
    const overview = await owner.query(api.sourcesWorkspace.overview, {
        runId: f.runId,
    });
    expect(overview?.researchSummary).not.toContain(
        "Sources preparation ended",
    );
});

test("a settled inquiry with no retained documents reports no usable material", async () => {
    const f = await seedResearchStateScenario({
        outcome: "complete",
        retainedDocumentCount: 0,
        capturedDocumentCount: 1,
    });
    const run = await f.t
        .withIdentity({ subject: f.userId })
        .query(api.researchRuns.getMine, { runId: f.runId });
    expect(run.sourcesPhase).toBe("ended_without_material");
    const context = await facts(f);
    expect(context.research).toMatchObject({
        summary: expect.stringContaining(
            "Sources preparation ended without usable material.",
        ),
    });
});
