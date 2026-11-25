import { writeFileSync } from "node:fs";
import { api, internal } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import { readResearchState } from "@convex/domain/researchState";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { commonOperations } from "@convex/execution/commonOperations";
import { operationReuseIdentity } from "@convex/execution/missionData";
import { currentRunStateResultValidator } from "@convex/execution/operationContracts";
import type { FunctionReturnType } from "convex/server";
import { getDocumentSize, type Value } from "convex/values";
import { validate } from "convex-helpers/validators";
import { afterEach, assert, expect, test, vi } from "vitest";
import workflowTest from "@/__tests__/convex/workflows/workflow-test-register.js";
import { seedResearchStateScenario } from "@/__tests__/setup/research-state";
import { readRetainedBody } from "@/__tests__/setup/retained-history";

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
                captureId,
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

function measureDbReads<T extends object>(db: T, table?: "sourceCaptures") {
    const totals = { rows: 0, bytes: 0, gets: 0, queries: 0 };
    const recordRow = (row: unknown) => {
        if (!row || typeof row !== "object") return;
        totals.rows++;
        totals.bytes += getDocumentSize(row as Record<string, Value>);
    };
    const wrapQuery = <Q extends object>(query: Q): Q =>
        new Proxy(query, {
            get(target, key, receiver) {
                const value = Reflect.get(target, key, receiver);
                if (typeof value !== "function") return value;
                if (key === Symbol.asyncIterator)
                    return async function* () {
                        for await (const row of target as Q &
                            AsyncIterable<unknown>) {
                            recordRow(row);
                            yield row;
                        }
                    };
                return (...params: unknown[]) => {
                    const result = Reflect.apply(value, target, params);
                    if (key === "first" || key === "unique")
                        return Promise.resolve(result).then((row) => {
                            recordRow(row);
                            return row;
                        });
                    if (key === "take" || key === "collect")
                        return Promise.resolve(result).then(
                            (rows: unknown[]) => {
                                for (const row of rows) recordRow(row);
                                return rows;
                            },
                        );
                    if (key === "paginate")
                        return Promise.resolve(result).then(
                            (page: { page: unknown[] }) => {
                                for (const row of page.page) recordRow(row);
                                return page;
                            },
                        );
                    return result &&
                        typeof result === "object" &&
                        !(result instanceof Promise)
                        ? wrapQuery(result)
                        : result;
                };
            },
        });
    const proxy = new Proxy(db, {
        get(target, key, receiver) {
            const value = Reflect.get(target, key, receiver);
            if (key === "system" && value && typeof value === "object")
                return wrapQuery(value);
            if (typeof value !== "function") return value;
            return (...params: unknown[]) => {
                const result = Reflect.apply(value, target, params);
                if (key === "get") {
                    if (table) return result;
                    totals.gets++;
                    return Promise.resolve(result).then((row) => {
                        recordRow(row);
                        return row;
                    });
                }
                if (key === "query") {
                    if (table && params[0] !== table) return result;
                    totals.queries++;
                    return result && typeof result === "object"
                        ? wrapQuery(result)
                        : result;
                }
                return result;
            };
        },
    });
    return { db: proxy, totals };
}

test("Sources, Workbench and standalone projections stay within their measured logical-read budgets", async () => {
    const f = await seedResearchStateScenario({
        outcome: "partial",
        blockCode: "invalid_output",
        historicalTimeLimitNote: true,
        retainedDocumentCount: 4,
        capturedDocumentCount: 5,
        uncapturedDocumentCount: 2,
    });
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, {
            lifecycleState: "discovering_sources",
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
        await ctx.db.patch(f.missionId, {
            status: "running",
            blockCode: undefined,
        });
    });

    const measurements = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        const sourcesMission = await ctx.db.get(f.missionId);
        const workbenchMission = await ctx.db.get(f.workbenchMissionId);
        assert(run && sourcesMission && workbenchMission);

        const sourcesProbe = measureDbReads(ctx.db);
        const sourcesContext = await getAgentDefinition("sources_v1").context(
            { ...ctx, db: sourcesProbe.db },
            sourcesMission,
            run,
        );
        assert(sourcesContext.kind === "ready");

        const workbenchProbe = measureDbReads(ctx.db);
        const workbenchContext = await getAgentDefinition(
            "workbench_v1",
        ).context({ ...ctx, db: workbenchProbe.db }, workbenchMission, run);
        assert(workbenchContext.kind === "ready");

        const consultationProbe = measureDbReads(ctx.db);
        const consultation = await readResearchState(
            { ...ctx, db: consultationProbe.db },
            run,
        );
        expect(consultation.sources?.preparationId).toBe(f.preparationId);

        return {
            sourcesContext: sourcesProbe.totals,
            workbenchContext: workbenchProbe.totals,
            standaloneConsultation: consultationProbe.totals,
        };
    });

    if (process.env.PROJECTION_PERF_OUTPUT)
        writeFileSync(
            process.env.PROJECTION_PERF_OUTPUT,
            JSON.stringify(
                {
                    boundary:
                        "Logical rows and serialized Convex document bytes read by real query handlers across all db.get/db.query calls (including outside SourceReviewReads); does not measure physical Convex billing or deployed latency.",
                    measurements,
                },
                null,
                2,
            ),
        );
    // Characterized ceilings for this frozen five-capture fixture, not application limits or billing estimates.
    const rowBudgets = {
        sourcesContext: 53,
        workbenchContext: 52,
        standaloneConsultation: 24,
    };
    for (const name of Object.keys(rowBudgets) as (keyof typeof rowBudgets)[]) {
        expect(measurements[name].rows, name).toBeGreaterThan(0);
        expect(measurements[name].rows, name).toBeLessThanOrEqual(
            rowBudgets[name],
        );
    }
});

test("running preparation exposes compact progress across Sources, Workbench and consult_run_state v3 without conflating handoff or human pauses", async () => {
    const f = await seedResearchStateScenario({
        outcome: "partial",
        retainedDocumentCount: 1,
        capturedDocumentCount: 3,
        uncapturedDocumentCount: 3,
    });
    const seeded = await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        const baseCapture = await ctx.db.get(f.captureId);
        const sourcesMission = await ctx.db.get(f.missionId);
        assert(preparation?.sourcesMission && baseCapture && sourcesMission);
        const captureIds = [...preparation.sourcesMission.captureIds];
        assert(captureIds.length === 3);
        const [capFullId, capPartialId, capUnknownId] = captureIds;
        assert(capFullId && capPartialId && capUnknownId);
        const capFull = await ctx.db.get(capFullId);
        const capPartial = await ctx.db.get(capPartialId);
        const capUnknown = await ctx.db.get(capUnknownId);
        assert(capFull && capPartial && capUnknown);

        // Distinct capture availability states on the 3 committed captures
        await ctx.db.patch(capFullId, {
            representationCompleteness: "complete",
        });
        await ctx.db.patch(capPartialId, {
            representationCompleteness: "partial",
        });
        await ctx.db.patch(capUnknownId, {
            representationCompleteness: undefined,
            readingCompleteness: undefined,
        });

        // Add capturing, unavailable, and not-captured preparation work sources
        const [capturingSourceId, unavailableSourceId, notCapturedSourceId] =
            f.uncapturedSourceIds;
        assert(capturingSourceId && unavailableSourceId && notCapturedSourceId);
        const { _id: _cid, _creationTime: _ct, ...capFields } = baseCapture;
        await ctx.db.insert("sourceCaptures", {
            ...capFields,
            sourceId: capturingSourceId,
            captureKey: "progress-capturing",
            status: "reserved",
            contentHash: undefined,
        });
        await ctx.db.insert("sourceCaptures", {
            ...capFields,
            sourceId: unavailableSourceId,
            captureKey: "progress-unavailable",
            status: "unavailable",
            contentHash: undefined,
        });

        // Create a newer capture for capUnknown's source so an obsolete qualification is ignored
        const newerCaptureId = await ctx.db.insert("sourceCaptures", {
            ...capFields,
            sourceId: capUnknown.sourceId,
            captureKey: "progress-newer-unqualified",
            contentHash: "newer-unqualified-hash",
            representationCompleteness: undefined,
            readingCompleteness: undefined,
            updatedAt: capUnknown.updatedAt + 10,
        });

        // Qualification 1 on capFull with 4 contributions covering all 4 effectiveUses categories
        const control1Id = await ctx.db.insert("aiTaskResults", {
            runId: f.runId,
            corpusRevisionId: f.corpusRevisionId,
            sourceId: capFull.sourceId,
            sourceCaptureId: capFullId,
            taskType: "documentary_control",
            executionMode: "live",
            schemaVersion: "sources_mission_v1",
            adapterVersion: "fixture",
            inputHash: "ctrl-1",
            createdAt: 10,
            output: {
                kind: "documentary_control",
                preparationId: f.preparationId,
                evidence: [],
                inputHash: "ctrl-1",
                control: {
                    coherence: true,
                    limitations: [],
                    findings: [
                        {
                            contributionId: "c-doc",
                            conclusion: "supported",
                            permittedUse: "documentary",
                            diagnostic: "ok",
                        },
                        {
                            contributionId: "c-attr",
                            conclusion: "supported",
                            permittedUse: "attributed_argument_only",
                            diagnostic: "attributed",
                        },
                        {
                            contributionId: "c-ctx",
                            conclusion: "supported",
                            permittedUse: "context_only",
                            diagnostic: "context",
                        },
                        {
                            contributionId: "c-blk",
                            conclusion: "not_established",
                            permittedUse: "blocked",
                            diagnostic: "blocked",
                        },
                    ],
                },
            },
        });
        const evidenceQuote = {
            captureId: capFullId,
            passageOrder: 0,
            quotation: "Quoted fact",
        };
        const qual1Id = await ctx.db.insert("aiTaskResults", {
            runId: f.runId,
            corpusRevisionId: f.corpusRevisionId,
            sourceId: capFull.sourceId,
            sourceCaptureId: capFullId,
            taskType: "documentary_qualification",
            executionMode: "live",
            schemaVersion: "sources_mission_v1",
            adapterVersion: "fixture",
            inputHash: "qual-1",
            createdAt: 10,
            output: {
                kind: "documentary_qualification",
                preparationId: f.preparationId,
                captureId: capFullId,
                contentHash: capFull.contentHash ?? "",
                version: 1,
                controlTaskId: control1Id,
                contributions: [
                    {
                        id: "c-doc",
                        version: 1,
                        needIds: ["common-context"],
                        statement: "Fact",
                        period: "2026",
                        modality: "reported",
                        attribution: "10-K",
                        kind: "asserted_fact",
                        evidence: [evidenceQuote],
                    },
                    {
                        id: "c-attr",
                        version: 1,
                        needIds: ["common-context"],
                        statement: "Management argument",
                        period: "2026",
                        modality: "asserted",
                        attribution: "CEO",
                        kind: "attributed_argument",
                        evidence: [evidenceQuote],
                    },
                    {
                        id: "c-ctx",
                        version: 1,
                        needIds: ["common-context"],
                        statement: "Industry backdrop",
                        period: "2026",
                        modality: "background",
                        attribution: "10-K",
                        kind: "context",
                        evidence: [evidenceQuote],
                    },
                    {
                        id: "c-blk",
                        version: 1,
                        needIds: ["common-context"],
                        statement: "Unverified claim",
                        period: "2026",
                        modality: "claimed",
                        attribution: "Press",
                        kind: "asserted_fact",
                        evidence: [evidenceQuote],
                    },
                ],
            },
        });

        // Obsolete qualification on old capUnknown (superseded by newerCaptureId)
        const controlObsId = await ctx.db.insert("aiTaskResults", {
            runId: f.runId,
            corpusRevisionId: f.corpusRevisionId,
            sourceId: capUnknown.sourceId,
            sourceCaptureId: capUnknownId,
            taskType: "documentary_control",
            executionMode: "live",
            schemaVersion: "sources_mission_v1",
            adapterVersion: "fixture",
            inputHash: "ctrl-obs",
            createdAt: 9,
            output: {
                kind: "documentary_control",
                preparationId: f.preparationId,
                evidence: [],
                inputHash: "ctrl-obs",
                control: {
                    coherence: true,
                    limitations: [],
                    findings: [
                        {
                            contributionId: "c-obs",
                            conclusion: "supported",
                            permittedUse: "documentary",
                            diagnostic: "ok",
                        },
                    ],
                },
            },
        });
        const qualObsId = await ctx.db.insert("aiTaskResults", {
            runId: f.runId,
            corpusRevisionId: f.corpusRevisionId,
            sourceId: capUnknown.sourceId,
            sourceCaptureId: capUnknownId,
            taskType: "documentary_qualification",
            executionMode: "live",
            schemaVersion: "sources_mission_v1",
            adapterVersion: "fixture",
            inputHash: "qual-obs",
            createdAt: 9,
            output: {
                kind: "documentary_qualification",
                preparationId: f.preparationId,
                captureId: capUnknownId,
                contentHash: capUnknown.contentHash ?? "",
                version: 1,
                controlTaskId: controlObsId,
                contributions: [
                    {
                        id: "c-obs",
                        version: 1,
                        needIds: ["common-context"],
                        statement: "Stale capture fact",
                        period: "2026",
                        modality: "reported",
                        attribution: "Old",
                        kind: "asserted_fact",
                        evidence: [
                            {
                                captureId: capUnknownId,
                                passageOrder: 0,
                                quotation: "Old quote",
                            },
                        ],
                    },
                ],
            },
        });

        // Insert 33 admitted search_available_material readings to exercise incomplete window (> 32)
        const dummyWorkRequestIds: Id<"agentOperationRequests">[] = [];
        for (const sourceId of [
            capturingSourceId,
            unavailableSourceId,
            notCapturedSourceId,
        ]) {
            const reqId = await ctx.db.insert("agentOperationRequests", {
                runId: f.runId,
                missionId: f.missionId,
                logicalKey: `work-${sourceId}`,
                operationVersion: 2,
                actor: "agent",
                cause: "acquire",
                expectedGeneration: 1,
                input: {
                    kind: "make_source_consultable",
                    needId: "common-context",
                    sourceId,
                },
                status: "running",
                createdAt: 1,
            });
            dummyWorkRequestIds.push(reqId);
        }
        for (let i = 0; i < 33; i++) {
            await ctx.db.insert("agentOperationRequests", {
                runId: f.runId,
                missionId: f.missionId,
                logicalKey: `read-window-${i}`,
                operationVersion: 1,
                actor: "agent",
                cause: `read-${i}`,
                expectedGeneration: 1,
                pin: {
                    kind: "saved_material_inspection_v1",
                    expectedCaptureId: capFullId,
                    expectedContentHash: capFull.contentHash ?? "",
                },
                input: {
                    kind: "search_available_material",
                    sourceId: capFull.sourceId,
                    query: `q-${i}`,
                },
                status: "completed",
                adoptedAt: 10 + i,
                outcome: {
                    kind: "success",
                    valueJson: JSON.stringify({
                        kind: "search_available_material",
                        sourceId: capFull.sourceId,
                        captureId: capFullId,
                        contentHash: capFull.contentHash ?? "",
                        canonicalUrl: "https://example.com/workflow/1",
                        retrievedAt: 1,
                        passages: [
                            {
                                passageOrder: i,
                                exactQuote: `Match ${i}`,
                                headingPath: [],
                            },
                        ],
                        omittedPassageCount: 0,
                        limitReached: false,
                    }),
                },
                createdAt: 10 + i,
                completedAt: 10 + i,
            });
        }

        const [capturingWorkId, unavailableWorkId, notCapturedWorkId] =
            dummyWorkRequestIds;
        assert(capturingWorkId && unavailableWorkId && notCapturedWorkId);

        await ctx.db.patch(f.preparationId, {
            status: "started",
            completedAt: undefined,
            sourcesMission: {
                ...preparation.sourcesMission,
                captureIds: [...captureIds, newerCaptureId],
                qualifications: [qual1Id, qualObsId],
                restrictedContributions: [],
                work: [
                    {
                        requestId: capturingWorkId,
                        sourceId: capturingSourceId,
                        kind: "make_source_consultable",
                        needIds: ["common-context"],
                    },
                    {
                        requestId: unavailableWorkId,
                        sourceId: unavailableSourceId,
                        kind: "make_source_consultable",
                        needIds: ["common-context"],
                    },
                    {
                        requestId: notCapturedWorkId,
                        sourceId: notCapturedSourceId,
                        kind: "make_source_consultable",
                        needIds: ["common-context"],
                    },
                ],
                result: undefined,
            },
        });
        await ctx.db.patch(f.runId, {
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            pauseReason: undefined,
            researchPauseRequested: false,
        });
        await ctx.db.patch(f.missionId, {
            status: "running",
            blockCode: undefined,
        });
        return { qual1Id, control1Id };
    });

    const expectedProgress = {
        version: 1,
        handoff: "pending",
        captures: {
            full: 1,
            partial: 1,
            unknown: 1,
            capturing: 1,
            unavailable: 1,
            notCaptured: 1,
        },
        qualifications: {
            recordedSources: 1,
            effectiveUses: {
                documentary: 1,
                attributed_argument_only: 1,
                context_only: 1,
                blocked: 1,
            },
        },
        readings: {
            visibleReferenceCount: 32,
            referencesComplete: false,
        },
    };

    // 1. Standalone consult_run_state v3
    const consulted = await dispatchState(f, "running-progress");
    const consultedRequest = await f.t.run((ctx) =>
        ctx.db.get(consulted.requestId),
    );
    expect(consultedRequest?.operationVersion).toBe(3);
    expect(consulted.value.research).toMatchObject({
        status: "running",
        actions: {
            pause: { applicable: true, reason: null },
            resume: { applicable: false, reason: "action_not_applicable" },
            continuePreparation: {
                applicable: false,
                reason: "action_not_applicable",
            },
        },
        sources: {
            outcome: null,
            retainedDocuments: [],
            executionStop: null,
            progress: expectedProgress,
        },
    });

    // 2. Workbench context agrees on progress and action applicability
    const wb = await facts(f);
    expect(wb.research).toMatchObject({
        sources: {
            retainedDocuments: [],
            progress: expectedProgress,
        },
        actions: {
            resume: { applicable: false, reason: "action_not_applicable" },
            continuePreparation: {
                applicable: false,
                reason: "action_not_applicable",
            },
        },
    });

    // 3. Sources context exposes the same progress inside activeWork
    const sourcesContext = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        const mission = await ctx.db.get(f.missionId);
        assert(run && mission);
        const result = await getAgentDefinition("sources_v1").context(
            ctx,
            mission,
            run,
        );
        assert(result.kind === "ready");
        return result.context;
    });
    expect(sourcesContext.activeWork).toMatchObject({
        progress: expectedProgress,
    });

    // 4. Adding an analyst restriction changes effectiveUses category and invalidates consultation pin
    const pinBefore = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.workbenchMissionId);
        assert(mission);
        return commonOperations.consult_run_state.pin(ctx, mission, {
            kind: "consult_run_state",
        });
    });
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        await ctx.db.patch(f.preparationId, {
            sourcesMission: {
                ...preparation.sourcesMission,
                restrictedContributions: [
                    {
                        qualificationTaskId: seeded.qual1Id,
                        contributionId: "c-doc",
                        version: 1,
                        controlTaskId: seeded.control1Id,
                        permittedUse: "context_only",
                    },
                ],
            },
        });
    });
    const pinAfter = await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.workbenchMissionId);
        assert(mission);
        return commonOperations.consult_run_state.pin(ctx, mission, {
            kind: "consult_run_state",
        });
    });
    expect(pinAfter).not.toEqual(pinBefore);
    const afterRestriction = await dispatchState(f, "after-restriction");
    expect(afterRestriction.value.research.sources.progress).toMatchObject({
        qualifications: {
            recordedSources: 1,
            effectiveUses: {
                documentary: 0,
                attributed_argument_only: 1,
                context_only: 2,
                blocked: 1,
            },
        },
    });

    // 5. True human review pause preserves human_prerequisite_required (distinct from running action_not_applicable)
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, {
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
        }),
    );
    const pausedHuman = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return readResearchState(ctx, run);
    });
    expect(pausedHuman.actions).toMatchObject({
        pause: { applicable: false, reason: "action_not_applicable" },
        resume: { applicable: false, reason: "human_prerequisite_required" },
        continuePreparation: {
            applicable: false,
            reason: "human_prerequisite_required",
        },
    });
});

test("completed version-two consultation replays byte-identically, pending version-two refuses, and revoked authority is rejected", async () => {
    const f = await scenario();
    const { requestId, value } = await dispatchState(f, "v2-baseline");
    const v2Research = {
        ...value.research,
        sources: {
            ...value.research.sources,
            progress: undefined,
        },
    };
    delete v2Research.sources.progress;
    const legacyV2Outcome = {
        kind: "success" as const,
        valueJson: JSON.stringify({
            lifecycleState: value.lifecycleState,
            executionStatus: value.executionStatus,
            executionGeneration: value.executionGeneration,
            research: v2Research,
        }),
    };
    // Historical result without progress still satisfies current validator without fabricating zero work
    expect(
        validate(
            currentRunStateResultValidator,
            JSON.parse(legacyV2Outcome.valueJson),
            { db: undefined },
        ),
    ).toBe(true);
    expect(
        JSON.parse(legacyV2Outcome.valueJson).research.sources.progress,
    ).toBeUndefined();

    // Seed completed v2 receipt with its historical (pre-progress) pin and v2 logical key
    await f.t.run(async (ctx) => {
        const request = await ctx.db.get(requestId);
        const mission = await ctx.db.get(f.workbenchMissionId);
        assert(request && mission);
        const historicalPin = {
            kind: "run_state" as const,
            stateHash: "historical-v2-hash",
        };
        const logicalKey = sha256Hex(
            stableStringify(
                operationReuseIdentity({
                    mission,
                    runId: f.runId,
                    version: 2,
                    input: request.input,
                    pin: historicalPin,
                }),
            ),
        );
        await ctx.db.patch(requestId, {
            operationVersion: 2,
            pin: historicalPin,
            logicalKey,
            outcome: legacyV2Outcome,
        });
    });
    const before = await f.t.run((ctx) => ctx.db.get(requestId));
    const business = await businessSnapshot(f);
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 1,
        }),
    ).toEqual(legacyV2Outcome);
    expect(await f.t.run((ctx) => ctx.db.get(requestId))).toEqual(before);
    expect(await businessSnapshot(f)).toEqual(business);

    // Revoked authority still rejects replay of completed v2 receipt
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 99,
        }),
    ).toEqual({ kind: "refused", code: "stale_execution" });

    // Pending v2 request returns operation_version_conflict without rewriting its version
    const pendingV2Id = await f.t.mutation(
        internal.execution.operations.enqueue,
        {
            missionId: f.workbenchMissionId,
            expectedGeneration: 1,
            cause: "pending-v2",
            input: { kind: "consult_run_state" },
        },
    );
    await f.t.run(async (ctx) => {
        const request = await ctx.db.get(pendingV2Id);
        const mission = await ctx.db.get(f.workbenchMissionId);
        assert(request && mission);
        const logicalKey = sha256Hex(
            stableStringify(
                operationReuseIdentity({
                    mission,
                    runId: f.runId,
                    version: 2,
                    input: request.input,
                    pin: { kind: "run_state", stateHash: "historical-v2-hash" },
                }),
            ),
        );
        await ctx.db.patch(pendingV2Id, {
            operationVersion: 2,
            pin: { kind: "run_state", stateHash: "historical-v2-hash" },
            logicalKey,
        });
    });
    expect(
        await f.t.action(internal.execution.operations.dispatch, {
            requestId: pendingV2Id,
            expectedGeneration: 1,
        }),
    ).toMatchObject({ kind: "refused", code: "operation_version_conflict" });
    expect(
        (await f.t.run((ctx) => ctx.db.get(pendingV2Id)))?.operationVersion,
    ).toBe(2);

    // Fresh v3 admission succeeds with settled handoff progress
    const fresh = await dispatchState(f, "fresh-v3");
    expect(
        (await f.t.run((ctx) => ctx.db.get(fresh.requestId)))?.operationVersion,
    ).toBe(3);
    expect(fresh.value.research.sources.progress).toMatchObject({
        version: 1,
        handoff: "settled",
        captures: { full: 5 },
        qualifications: { recordedSources: 4 },
    });
});

test("progress projection surfaces explicit read-capacity refusal and missing capture failure rather than zero work", async () => {
    const { SourceReviewReads } = await import(
        "@convex/domain/sourceReviewReads"
    );
    const f = await scenario();
    await expect(
        f.t.run(async (ctx) => {
            const run = await ctx.db.get(f.runId);
            assert(run);
            return readResearchState(ctx, run, {
                reads: new SourceReviewReads(ctx.db, f.runId, {
                    bytes: 1,
                    ranges: 1,
                }),
            });
        }),
    ).rejects.toMatchObject({ data: { code: "source_review_capacity" } });

    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        const fifthCaptureId = preparation.sourcesMission.captureIds[4];
        assert(fifthCaptureId);
        await ctx.db.delete(fifthCaptureId);
    });
    await expect(
        f.t.run(async (ctx) => {
            const run = await ctx.db.get(f.runId);
            assert(run);
            return readResearchState(ctx, run);
        }),
    ).rejects.toMatchObject({ data: { code: "capture_unavailable" } });
});

test.each([
    false,
    true,
])("reading reference window skips empty capture sets and shares transaction reads (empty=%s)", async (empty) => {
    const { SourceReviewReads } = await import(
        "@convex/domain/sourceReviewReads"
    );
    const { sourcesReadingReferenceWindow } = await import(
        "@convex/domain/sources"
    );
    const f = await scenario();
    await f.t.run(async (ctx) => {
        const mission = await ctx.db.get(f.missionId);
        const preparation = await ctx.db.get(f.preparationId);
        assert(mission && preparation?.sourcesMission);
        const data = {
            ...preparation.sourcesMission,
            captureIds: empty ? [] : preparation.sourcesMission.captureIds,
        };
        const probe = measureDbReads(ctx.db);
        const reads = new SourceReviewReads(probe.db, f.runId, {
            bytes: 1000000,
            ranges: 2,
        });
        const first = await sourcesReadingReferenceWindow(
            { ...ctx, db: probe.db },
            mission,
            data,
            reads,
        );
        const before = { ...probe.totals };
        expect(before.queries).toBe(empty ? 0 : 2);
        expect(
            await sourcesReadingReferenceWindow(
                { ...ctx, db: probe.db },
                mission,
                data,
                reads,
            ),
        ).toEqual(first);
        expect(probe.totals).toEqual(before);
        if (empty)
            expect(first).toEqual({ references: [], referencesComplete: true });
    });
});

test.each([
    "reserved",
    "unavailable",
] as const)("unadmitted committed captures do not hide %s preparation state", async (status) => {
    const { projectSourcesPreparationProgress } = await import(
        "@convex/domain/sources"
    );
    const f = await scenario();
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        const captureId = preparation.sourcesMission.captureIds[0];
        assert(captureId);
        const capture = await ctx.db.get(captureId);
        assert(capture);
        const { _id, _creationTime, ...fields } = capture;
        await ctx.db.insert("sourceCaptures", {
            ...fields,
            captureKey: `unadmitted:${status}`,
            updatedAt: capture.updatedAt + 1,
        });
        await ctx.db.patch(_id, { status });
        const progress = await projectSourcesPreparationProgress(ctx, {
            preparation,
            mission: null,
            controlled: [],
        });
        expect(
            progress.captures[
                status === "reserved" ? "capturing" : "unavailable"
            ],
        ).toBe(1);
        expect(progress.captures.notCaptured).toBe(0);
    });
});

test("permissive source decisions reuse verified strict reads in one transaction", async () => {
    const { SourceReviewReads } = await import(
        "@convex/domain/sourceReviewReads"
    );
    const f = await scenario();
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        const captureId = preparation.sourcesMission.captureIds[0];
        assert(captureId);
        const capture = await ctx.db.get(captureId);
        assert(capture);
        const probe = measureDbReads(ctx.db);
        const reads = new SourceReviewReads(probe.db, f.runId);
        const strict = await reads.decision(
            preparation.corpusRevisionId,
            capture.sourceId,
        );
        const before = { ...probe.totals };
        expect(
            await reads.decision(
                preparation.corpusRevisionId,
                capture.sourceId,
                true,
            ),
        ).toEqual(strict);
        expect(probe.totals).toEqual(before);
    });
});

test("legacy snapshot and standalone research facts preserve the same protocol boundary", async () => {
    const f = await scenario();
    await f.t.run((ctx) =>
        ctx.db.patch(f.runId, { sourcesProtocol: undefined }),
    );
    const snapshot = await f.t
        .withIdentity({ subject: f.userId })
        .query(api.workbench.snapshot, { runId: f.runId });
    const standalone = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        assert(run);
        return readResearchState(ctx, run);
    });
    expect(standalone.sources).toBeNull();
    expect(snapshot.research.sources).toBeNull();
    expect(standalone.nextCapability).toBeNull();
    expect(snapshot.research.nextCapability).toBeNull();
});

test.each([
    "pause",
    "command",
    "interruption",
    "capacity",
    "worker_close",
] as const)("research controls persist without optional evidence progress (%s)", async (route) => {
    const f = await scenario();
    await f.t.run(async (ctx) => {
        await ctx.db.patch(f.runId, {
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            pauseReason: undefined,
            researchPauseRequested: false,
        });
        await ctx.db.patch(f.missionId, {
            status: "blocked",
            blockCode: "execution_interrupted",
        });
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        await ctx.db.patch(preparation._id, {
            status: "started",
            sourcesMission: {
                ...preparation.sourcesMission,
                result: undefined,
            },
        });
        if (route !== "capacity") {
            const captureId = preparation.sourcesMission.captureIds[0];
            assert(captureId);
            await ctx.db.delete(captureId);
        }
    });
    if (route === "pause")
        await f.t
            .withIdentity({ subject: f.userId })
            .mutation(api.execution.researchControl.pause, {
                runId: f.runId,
                expectedGeneration: 4,
            });
    else if (route === "command") {
        const result = await f.t
            .withIdentity({ subject: f.userId })
            .mutation(api.workbench.command, {
                runId: f.runId,
                expectedGeneration: 4,
                requestKey: "pause-without-progress",
                command: "/pause",
            });
        expect(result.outcome).toBe("applied");
        expect(result.text).toContain("Pause requested");
    } else if (route === "worker_close") {
        await f.t.run((ctx) =>
            ctx.db.patch(f.missionId, {
                status: "running",
                blockCode: undefined,
            }),
        );
        await f.t.mutation(internal.execution.piStore.claim, {
            missionId: f.missionId,
            expectedGeneration: 4,
            writer: "interrupted-writer",
        });
        await f.t.run((ctx) =>
            ctx.db.patch(f.missionId, { piActiveWriter: "interrupted-writer" }),
        );
        await f.t.mutation(internal.execution.piControl.closeWorker, {
            missionId: f.missionId,
            expectedGeneration: 4,
            writer: "interrupted-writer",
            error: "generation_backend_interrupted",
        });
    } else {
        const { suspendInterruptedResearch } = await import(
            "@convex/execution/researchControl"
        );
        const { SourceReviewReads } = await import(
            "@convex/domain/sourceReviewReads"
        );
        await f.t.run(async (ctx) => {
            const mission = await ctx.db.get(f.missionId);
            assert(mission);
            const reads =
                route === "capacity"
                    ? new SourceReviewReads(ctx.db, f.runId, {
                          bytes: 1,
                          ranges: 1,
                      })
                    : undefined;
            if (reads) {
                const run = await ctx.db.get(f.runId);
                assert(run);
                await expect(
                    readResearchState(ctx, run, { reads }),
                ).rejects.toMatchObject({
                    data: { code: "source_review_capacity" },
                });
            }
            expect(await suspendInterruptedResearch(ctx, mission)).toBe(true);
        });
    }
    const retainedObservation = await f.t.run(async (ctx) => {
        const run = await ctx.db.get(f.runId);
        const event = await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_run_and_native_input_sequence", (q) =>
                q.eq("runId", f.runId),
            )
            .order("desc")
            .first();
        assert(event?.contextObservation);

        return {
            run,
            textId: event.contextObservation.textId,
        };
    });
    const observed = {
        run: retainedObservation.run,
        observation: JSON.parse(
            await readRetainedBody(f.t, retainedObservation.textId),
        ),
    };
    const interrupted =
        route === "interruption" ||
        route === "capacity" ||
        route === "worker_close";
    expect(observed.run).toMatchObject(
        interrupted
            ? {
                  executionStatus: "paused",
                  executionGeneration: 5,
                  pauseReason: "execution_interrupted",
              }
            : {
                  executionStatus: "running",
                  executionGeneration: 4,
                  researchPauseRequested: true,
              },
    );
    expect(observed.observation.sources?.progress).toBeUndefined();
    expect(observed.observation.sourcesProgress).toEqual({
        status: "not_loaded",
        reason: "control_transition",
    });
    expect(observed.observation.summary).toContain(
        interrupted ? "interrupted" : "Pause requested",
    );
});

test.each(
    [5, 60].flatMap((count) =>
        (
            ["reserved", "unavailable", "unadmitted_committed", "none"] as const
        ).map((status) => ({ count, status })),
    ),
)("authenticated snapshot reuses raw capture reads across admission views ($count, $status)", async ({
    count,
    status,
}) => {
    const f = await scenario();
    await f.t.run(async (ctx) => {
        const preparation = await ctx.db.get(f.preparationId);
        assert(preparation?.sourcesMission);
        const templateCaptureId = preparation.sourcesMission.captureIds[0];
        const templateSourceId = f.sourceIds[0];
        assert(templateCaptureId && templateSourceId);
        const templateCapture = await ctx.db.get(templateCaptureId);
        const templateSource = await ctx.db.get(templateSourceId);
        assert(templateCapture && templateSource);
        const {
            _id: _sourceId,
            _creationTime: _sourceCreation,
            ...sourceFields
        } = templateSource;
        const {
            _id: _captureId,
            _creationTime: _captureCreation,
            ...captureFields
        } = templateCapture;
        for (const capture of await ctx.db.query("sourceCaptures").collect())
            await ctx.db.delete(capture._id);
        for (const source of await ctx.db.query("sources").collect())
            await ctx.db.delete(source._id);
        const captureIds: Id<"sourceCaptures">[] = [];
        const work: NonNullable<
            Doc<"sourceSelectionProposalRebuilds">["sourcesMission"]
        >["work"] = [];
        for (let i = 0; i < count; i++) {
            const id = await ctx.db.insert("sources", {
                ...sourceFields,
                canonicalUrl: `https://example.com/measurement/${i}`,
            });
            if (status !== "none")
                captureIds.push(
                    await ctx.db.insert("sourceCaptures", {
                        ...captureFields,
                        sourceId: id,
                        captureKey: `pending:${i}`,
                        status:
                            status === "unadmitted_committed"
                                ? "reserved"
                                : status,
                    }),
                );
            if (status === "unadmitted_committed")
                await ctx.db.insert("sourceCaptures", {
                    ...captureFields,
                    sourceId: id,
                    captureKey: `unadmitted:${i}`,
                    updatedAt: captureFields.updatedAt + 1,
                });
            // Work membership makes never-captured sources part of preparation progress.
            work.push({
                kind: "capture_source",
                sourceId: id,
                requestId: f.readRequestId,
                needIds: [],
            });
        }
        await ctx.db.patch(preparation._id, {
            sourcesMission: {
                ...preparation.sourcesMission,
                captureIds,
                qualifications: [],
                work,
                result: undefined,
            },
        });
    });
    const { snapshot } = await import("@convex/workbench");
    const registered = snapshot as typeof snapshot & {
        _handler: (
            ctx: QueryCtx,
            args: { runId: Id<"researchRuns"> },
        ) => Promise<FunctionReturnType<typeof api.workbench.snapshot>>;
    };
    const original = registered._handler;
    let measurement = { rows: 0, bytes: 0, gets: 0, queries: 0 };
    const observer = vi
        .spyOn(registered, "_handler")
        .mockImplementation(async (ctx, args) => {
            const probe = measureDbReads(ctx.db, "sourceCaptures");
            const result = await original({ ...ctx, db: probe.db }, args);
            measurement = { ...probe.totals };
            return result;
        });
    try {
        const snapshot = await f.t
            .withIdentity({ subject: f.userId })
            .query(api.workbench.snapshot, { runId: f.runId });
        expect(snapshot.sources).toHaveLength(count);
        expect(
            snapshot.sources.every(
                (source) =>
                    source.state ===
                    (status === "unadmitted_committed"
                        ? "captured"
                        : status === "reserved"
                          ? "capturing"
                          : "found"),
            ),
        ).toBe(true);
        const captures = snapshot.research.sources?.progress?.captures;
        expect(captures).toEqual({
            full: 0,
            partial: 0,
            unknown: 0,
            capturing:
                status === "reserved" || status === "unadmitted_committed"
                    ? count
                    : 0,
            unavailable: status === "unavailable" ? count : 0,
            notCaptured: status === "none" ? count : 0,
        });
        if (process.env.CAPTURE_READ_PERF_OUTPUT)
            writeFileSync(
                `${process.env.CAPTURE_READ_PERF_OUTPUT}-${count}-${status}.json`,
                JSON.stringify({ count, status, ...measurement }, null, 2),
            );
        expect(measurement.queries).toBe(
            count * (status === "none" ? 1 : status === "unavailable" ? 4 : 3),
        );
    } finally {
        observer.mockRestore();
    }
});
