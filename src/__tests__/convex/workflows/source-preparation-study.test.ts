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
    await expect(
        t.mutation(internal.sourcePreparationEvaluation.copySource, {
            preparationId: reading.preparationId,
            sourceId,
            expectedContentHash: originalTask.output.contentHash,
            replayInputHash: "c".repeat(64),
        }),
    ).rejects.toThrow("Replay hashes are offline-only");
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

test.each([
    "",
    "   ",
    "a".repeat(63),
    "g".repeat(64),
])("frozen imports reject invalid replayInputHash %j without copying material", async (replayInputHash) => {
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
        fixtureKey: "invalid-replay-hash",
        sourceRunId: runId,
        manifestSha256: "b".repeat(64),
        phase: "replay",
        concurrency: 4,
        executionPlanVersion: "inline_controls_v2",
    });
    const task = await t.run((ctx) =>
        ctx.db
            .query("aiTaskResults")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .first(),
    );
    if (task?.output.kind !== "source_qualification")
        throw new Error("Missing fixture qualification");
    await expect(
        t.mutation(internal.sourcePreparationEvaluation.copySource, {
            preparationId: study.preparationId,
            sourceId,
            qualificationTaskId: task._id,
            expectedContentHash: task.output.contentHash,
            replayInputHash,
        }),
    ).rejects.toThrow("replayInputHash must be a lowercase SHA-256 digest");
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (q) => q.eq("runId", study.runId))
                .take(1),
        ),
    ).toEqual([]);
    expect(
        await t.run((ctx) =>
            ctx.db
                .query("aiTaskResults")
                .withIndex("by_run", (q) => q.eq("runId", study.runId))
                .take(1),
        ),
    ).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(task._id))).toEqual(task);
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
            replayInputHash: "",
        }),
    ).rejects.toThrow("replayInputHash must be a lowercase SHA-256 digest");
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
    await expect(
        t.mutation(internal.sourcePreparationEvaluation.copySource, {
            ...args,
            replayInputHash: undefined,
        }),
    ).rejects.toThrow("Frozen copy changed");
    expect(
        await t.run((ctx) => {
            if (!imported.taskId) throw new Error("Missing imported task");
            return ctx.db.get(imported.taskId);
        }),
    ).toMatchObject({
        executionMode: "showcase",
        runId: study.runId,
        inputHash: "c".repeat(64),
    });
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

test("native study seeding freezes the eligible-call envelope rather than an eight-source allowance", async () => {
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    const { t, runId } = await seedInspectedEvidence();
    await t.run((ctx) => ctx.db.patch(runId, { executionStatus: "paused" }));
    const args = {
        slotKey: "source-preparation-test",
        fixtureKey: "quoted-comparison",
        sourceRunId: runId,
        manifestSha256: "a".repeat(64),
        phase: "comparison" as const,
        concurrency: 4,
        executionPlanVersion: "source_actions_v3" as const,
        envelope: {
            version: 1 as const,
            conditionIndex: 0,
            conditions: [
                { phase: "comparison" as const, modelSources: 7 },
                { phase: "comparison" as const, modelSources: 7 },
            ],
            maximumAttempts: 28,
            maximumReservationUsd: 0.6709248,
        },
    };
    const seeded = await t.mutation(seedStudy, args);
    expect(
        await t.run((ctx) => ctx.db.get(seeded.preparationId)),
    ).toMatchObject({
        modelLimits: { work: 7, incidents: 7 },
        preparationStudy: { envelope: args.envelope },
    });
    await expect(
        t.mutation(seedStudy, {
            ...args,
            envelope: { ...args.envelope, maximumReservationUsd: 0.1 },
        }),
    ).rejects.toThrow("envelope mismatch");
    expect(await t.run((ctx) => ctx.db.query("providerCalls").take(1))).toEqual(
        [],
    );
});

test("native quotes include only possible attempts and preserve the global protocol cap", async () => {
    const { quotePreparationStudy } = await import(
        "@convex/sourcePreparationStudyPolicy"
    );
    expect(
        quotePreparationStudy([
            { phase: "comparison", modelSources: 7 },
            { phase: "comparison", modelSources: 7 },
        ]),
    ).toEqual({ maximumAttempts: 28, maximumReservationUsd: 0.6709248 });
    expect(
        quotePreparationStudy([
            { phase: "reading", modelSources: 24 },
            { phase: "reading", modelSources: 24 },
        ]),
    ).toEqual({ maximumAttempts: 96, maximumReservationUsd: 2.3003136 });
    expect(
        quotePreparationStudy([{ phase: "comparison", modelSources: 0 }]),
    ).toEqual({ maximumAttempts: 0, maximumReservationUsd: 0 });
    expect(() =>
        quotePreparationStudy(
            Array.from({ length: 3 }, () => ({
                phase: "reading",
                modelSources: 24,
            })),
        ),
    ).toThrow("Split paid conditions");
});

test("native start accepts a lot-specific grant below the historical flat floor", async () => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    const { t, runId, sourceId, captureId } = await seedInspectedEvidence();
    workflowTest.register(t);
    const originals = await t.run(async (ctx) => {
        await ctx.db.patch(runId, { executionStatus: "paused" });
        const source = await ctx.db.get(sourceId);
        const capture = await ctx.db.get(captureId);
        if (!source || !capture?.contentHash)
            throw new Error("Missing capture fixture");
        const {
            _id: _sourceId,
            _creationTime: _sourceTime,
            ...sourceFields
        } = source;
        const {
            _id: _captureId,
            _creationTime: _captureTime,
            ...captureFields
        } = capture;
        const sources = [sourceId];
        for (let i = 1; i < 24; i++) {
            const id = await ctx.db.insert("sources", {
                ...sourceFields,
                canonicalUrl: `https://www.servicenow.com/fixture/${i}`,
                title: `Frozen document ${i}`,
            });
            await ctx.db.insert("sourceCaptures", {
                ...captureFields,
                sourceId: id,
                captureKey: `frozen-${i}`,
            });
            sources.push(id);
        }
        return { sources, contentHash: capture.contentHash };
    });
    const manifestSha256 = "d".repeat(64);
    const study = await t.mutation(seedStudy, {
        slotKey: "source-preparation-test",
        fixtureKey: "bounded-native-start",
        sourceRunId: runId,
        manifestSha256,
        phase: "reading",
        concurrency: 4,
        executionPlanVersion: "source_actions_v3",
        envelope: {
            version: 1,
            conditionIndex: 0,
            conditions: [{ phase: "reading", modelSources: 24 }],
            maximumAttempts: 48,
            maximumReservationUsd: 1.1501568,
        },
    });
    for (const id of originals.sources)
        await t.mutation(internal.sourcePreparationEvaluation.copySource, {
            preparationId: study.preparationId,
            sourceId: id,
            expectedContentHash: originals.contentHash,
        });
    const args = {
        preparationId: study.preparationId,
        manifestSha256,
        approval: {
            manifestSha256,
            maximumAttempts: 48,
            budgetUsd: 1.15,
            approvedAt: new Date().toISOString(),
        },
    };
    await expect(
        t.mutation(internal.sourcePreparationEvaluation.start, args),
    ).rejects.toThrow("Explicit study authorization required");
    const handle = await t.mutation(
        internal.sourcePreparationEvaluation.start,
        { ...args, approval: { ...args.approval, budgetUsd: 1.16 } },
    );
    expect(await t.run((ctx) => ctx.db.get(study.preparationId))).toMatchObject(
        { workflowId: handle, modelLimits: { work: 24, incidents: 24 } },
    );
    await t.run((ctx) =>
        workflow.cancel(ctx, handle as Parameters<typeof workflow.cancel>[1]),
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100));
    expect(await t.run((ctx) => ctx.db.query("providerCalls").take(1))).toEqual(
        [],
    );
});
