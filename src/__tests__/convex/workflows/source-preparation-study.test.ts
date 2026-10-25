import { internal } from "@convex/_generated/api";
import "@convex/sourcePreparationActions";
import { workflow } from "@convex/workflow";
import { afterEach, expect, test, vi } from "vitest";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";
import workflowTest from "./workflow-test-register.js";

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

const seedStudy = internal.sourcePreparationEvaluation.seed;

test("comparison studies pin qualifications from a completed owned reading study", async () => {
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    const { t, runId, sourceId } = await seedInspectedEvidence({
        qualification: {
            companyMatch: "uncertain",
            companyPassages: [],
            documentKind: "unknown",
            reportingPeriodEnd: null,
            reportingPeriodPassages: [],
            findings: [],
            limitations: [],
        },
    });
    await t.run((ctx) => ctx.db.patch(runId, { executionStatus: "paused" }));
    const reading = await t.mutation(seedStudy, {
        slotKey: "source-preparation-test",
        fixtureKey: "reference-reading",
        sourceRunId: runId,
        manifestSha256: "1".repeat(64),
        phase: "reading",
        concurrency: 2,
        executionPlanVersion: "source_actions_v3",
    });
    const originalTask = await t.run((ctx) =>
        ctx.db.query("aiTaskResults").first(),
    );
    if (originalTask?.output.kind !== "source_qualification")
        throw new Error("Missing qualification");
    const copied = await t.mutation(
        internal.sourcePreparationEvaluation.copySource,
        {
            preparationId: reading.preparationId,
            sourceId,
            expectedContentHash: originalTask.output.contentHash,
        },
    );
    const args = {
        slotKey: "source-preparation-test",
        fixtureKey: "reference-comparison",
        sourceRunId: runId,
        manifestSha256: "2".repeat(64),
        phase: "comparison" as const,
        concurrency: 4,
        executionPlanVersion: "source_actions_v3" as const,
        qualificationReferencePreparationId: reading.preparationId,
    };
    await expect(t.mutation(seedStudy, args)).rejects.toThrow(
        "Completed owned reading study required",
    );
    const referenceTaskId = await t.run(async (ctx) => {
        const {
            _id: _originalId,
            _creationTime: _originalTime,
            ...metadata
        } = originalTask;
        if (metadata.output.kind !== "source_qualification")
            throw new Error("Missing qualification");
        const readingPreparation = await ctx.db.get(reading.preparationId);
        if (!readingPreparation) throw new Error("Missing reading preparation");
        const taskId = await ctx.db.insert("aiTaskResults", {
            ...metadata,
            runId: reading.runId,
            corpusRevisionId: readingPreparation.corpusRevisionId,
            sourceId: copied.sourceId,
            sourceCaptureId: copied.captureId,
            output: { ...metadata.output, sourceCaptureId: copied.captureId },
        });
        await ctx.db.patch(reading.preparationId, {
            status: "complete",
            completedAt: Date.now(),
            sourceOutcomes: [
                {
                    sourceId: copied.sourceId,
                    result: {
                        status: "qualified",
                        taskId,
                        sourceCaptureId: copied.captureId,
                    },
                },
            ],
        });
        await ctx.db.patch(reading.runId, { executionStatus: "paused" });
        return taskId;
    });
    const comparison = await t.mutation(seedStudy, args);
    const imported = await t.mutation(
        internal.sourcePreparationEvaluation.copySource,
        {
            preparationId: comparison.preparationId,
            sourceId,
            expectedContentHash: originalTask.output.contentHash,
            qualificationTaskId: referenceTaskId,
        },
    );
    const importedTaskId = imported.taskId;
    if (!importedTaskId)
        throw new Error("Reference qualification was not imported");
    expect(await t.run((ctx) => ctx.db.get(importedTaskId))).toMatchObject({
        runId: comparison.runId,
        sourceId: imported.sourceId,
        sourceCaptureId: imported.captureId,
        schemaVersion: originalTask.schemaVersion,
        inputHash: originalTask.inputHash,
    });
    await expect(
        t.mutation(internal.sourcePreparationEvaluation.copySource, {
            preparationId: comparison.preparationId,
            sourceId,
            expectedContentHash: originalTask.output.contentHash,
            qualificationTaskId: originalTask._id,
        }),
    ).rejects.toThrow("Frozen qualification mismatch");
    expect(await t.run((ctx) => ctx.db.query("providerCalls").take(1))).toEqual(
        [],
    );
});

test("study seeding requires loopback fixtures and preserves the admitted visitor quota", async () => {
    const fixture = await seedInspectedEvidence();
    const { t, runId } = fixture;
    const args = {
        slotKey: "source-preparation-test",
        fixtureKey: "native-preparation-test",
        sourceRunId: runId,
        manifestSha256: "a".repeat(64),
        phase: "replay" as const,
        concurrency: 4,
        executionPlanVersion: "inline_controls_v2" as const,
    };
    await expect(t.mutation(seedStudy, args)).rejects.toThrow(
        "Local retrieval fixtures are disabled",
    );
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "https://example.convex.cloud");
    await expect(t.mutation(seedStudy, args)).rejects.toThrow(
        "Local retrieval fixtures are disabled",
    );
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    await expect(t.mutation(seedStudy, args)).rejects.toThrow(
        "Visitor execution slot occupied",
    );
    await t.run((ctx) => ctx.db.patch(runId, { executionStatus: "paused" }));
    const study = await t.mutation(seedStudy, args);
    expect(await t.run((ctx) => ctx.db.get(study.preparationId))).toMatchObject(
        {
            maxConcurrentSources: 4,
            modelLimits: { work: 0, incidents: 0 },
            preparationStudy: {
                sourceRunId: runId,
                manifestSha256: args.manifestSha256,
                phase: "replay",
            },
        },
    );
    expect(await t.run((ctx) => ctx.db.get(fixture.visitorId))).toMatchObject({
        analysesReserved: 1,
    });
    expect(await t.run((ctx) => ctx.db.query("providerCalls").take(1))).toEqual(
        [],
    );
    expect(await t.mutation(seedStudy, args)).toEqual(study);
    await expect(
        t.mutation(seedStudy, { ...args, concurrency: 2 }),
    ).rejects.toThrow("Frozen preparation study changed");
});

test("frozen imports are idempotent and replay cannot dispatch a cache miss", async () => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const fixture = await seedInspectedEvidence({
        qualification: {
            companyMatch: "uncertain",
            companyPassages: [],
            documentKind: "unknown",
            reportingPeriodEnd: null,
            reportingPeriodPassages: [],
            findings: [],
            limitations: [],
        },
    });
    const { t, runId, sourceId } = fixture;
    workflowTest.register(t);
    await t.run((ctx) => ctx.db.patch(runId, { executionStatus: "paused" }));
    const study = await t.mutation(seedStudy, {
        slotKey: "source-preparation-test",
        fixtureKey: "native-replay",
        sourceRunId: runId,
        manifestSha256: "b".repeat(64),
        phase: "replay",
        concurrency: 4,
        executionPlanVersion: "inline_controls_v2",
    });
    const task = await t.run((ctx) => ctx.db.query("aiTaskResults").first());
    if (!task) throw new Error("Missing fixture qualification");
    const args = {
        preparationId: study.preparationId,
        sourceId,
        qualificationTaskId: task._id,
        expectedContentHash:
            task.output.kind === "source_qualification"
                ? task.output.contentHash
                : "",
        replayInputHash: "c".repeat(64),
    };
    const imported = await t.mutation(
        internal.sourcePreparationEvaluation.copySource,
        args,
    );
    expect(
        await t.mutation(internal.sourcePreparationEvaluation.copySource, args),
    ).toEqual(imported);
    await expect(
        t.mutation(internal.sourcePreparationEvaluation.copySource, {
            ...args,
            expectedContentHash: "f".repeat(64),
        }),
    ).rejects.toThrow("Frozen copy changed");
    await expect(
        t.mutation(internal.sourcePreparationEvaluation.copySource, {
            ...args,
            replayInputHash: "d".repeat(64),
        }),
    ).rejects.toThrow("Frozen copy changed");
    expect(
        await t.run((ctx) => {
            if (!imported.taskId) throw new Error("Missing imported task");
            return ctx.db.get(imported.taskId);
        }),
    ).toMatchObject({ executionMode: "showcase", runId: study.runId });
    const handle = await t.mutation(
        internal.sourcePreparationEvaluation.start,
        { preparationId: study.preparationId, manifestSha256: "b".repeat(64) },
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100));
    expect(
        await t.run((ctx) =>
            workflow.status(
                ctx,
                handle as Parameters<typeof workflow.status>[1],
            ),
        ),
    ).toMatchObject({ type: "completed" });
    const state = await t.query(internal.sourcePreparationEvaluation.inspect, {
        preparationId: study.preparationId,
    });
    expect(state.calls).toEqual([]);
    expect(state.run.executionStatus).toBe("paused");
    expect(state.preparation.sourceOutcomes).toEqual([
        expect.objectContaining({
            result: expect.objectContaining({
                status: "unavailable",
                reasonCode: "work_budget_exhausted",
            }),
        }),
    ]);
    expect(state.steps.length).toBeGreaterThan(0);
    const progress = await t.query(
        internal.sourcePreparationEvaluation.inspect,
        { preparationId: study.preparationId, details: false },
    );
    expect(progress.preparation._id).toBe(study.preparationId);
    expect(progress.steps).toEqual([]);
    expect(progress.tasks).toEqual([]);
    expect(progress.calls).toEqual([]);
}, 10000);

test("paid study rejects a grant below the full lot reservation", async () => {
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    const { t, runId, sourceId } = await seedInspectedEvidence({
        qualification: {
            companyMatch: "uncertain",
            companyPassages: [],
            documentKind: "unknown",
            reportingPeriodEnd: null,
            reportingPeriodPassages: [],
            findings: [],
            limitations: [],
        },
    });
    await t.run((ctx) => ctx.db.patch(runId, { executionStatus: "paused" }));
    const study = await t.mutation(seedStudy, {
        slotKey: "source-preparation-test",
        fixtureKey: "paid-grant",
        sourceRunId: runId,
        manifestSha256: "e".repeat(64),
        phase: "comparison",
        concurrency: 4,
        executionPlanVersion: "inline_controls_v2",
    });
    const task = await t.run((ctx) => ctx.db.query("aiTaskResults").first());
    if (!task) throw new Error("Missing fixture qualification");
    await t.mutation(internal.sourcePreparationEvaluation.copySource, {
        preparationId: study.preparationId,
        sourceId,
        qualificationTaskId: task._id,
        expectedContentHash:
            task.output.kind === "source_qualification"
                ? task.output.contentHash
                : "",
    });
    await expect(
        t.mutation(internal.sourcePreparationEvaluation.start, {
            preparationId: study.preparationId,
            manifestSha256: "e".repeat(64),
            approval: {
                manifestSha256: "e".repeat(64),
                maximumAttempts: 128,
                budgetUsd: 0.01,
                approvedAt: new Date().toISOString(),
            },
        }),
    ).rejects.toThrow("Explicit study authorization required");
    expect(await t.run((ctx) => ctx.db.query("providerCalls").take(1))).toEqual(
        [],
    );
});
