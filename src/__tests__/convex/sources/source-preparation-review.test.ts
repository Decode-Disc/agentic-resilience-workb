import { api, internal } from "@convex/_generated/api";
import type { QueryCtx } from "@convex/_generated/server";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { upsertSourceReviewItem } from "@convex/domain/sourceReviewProjection";
import { getCurrent } from "@convex/sourceSelectionProposals";
import { getReviewSource } from "@convex/sources";
import type {
    FunctionArgs,
    FunctionReference,
    FunctionReturnType,
} from "convex/server";
import { expect, test, vi } from "vitest";
import {
    seedInspectedEvidence,
    seedSourcePreparation,
} from "@/__tests__/setup/source-preparation";
import { sourceReadingCopy } from "@/lib/presentation/research-copy";

// The registered handler retains the real query boundary while allowing database read instrumentation.
type InstrumentedQuery<Ref extends FunctionReference<"query">> = {
    _handler: (
        ctx: QueryCtx,
        args: FunctionArgs<Ref>,
    ) => Promise<FunctionReturnType<Ref>>;
};

test("review exposes the persisted comparison phase and rejects progress from a stale execution", async () => {
    const { t, runId, corpusRevisionId, userId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    await t.mutation(internal.sourceSelectionProposals.generateForRun, {
        runId,
        expectedExecutionGeneration: 3,
    });
    await t.run(async (ctx) => {
        await ctx.db.patch(runId, { lifecycleState: "awaiting_source_review" });
        await ctx.db.patch(preparationId, { entryPoint: "source_review" });
    });
    const progress = {
        preparationId,
        phase: "comparison" as const,
        current: 1,
        total: 3,
    };
    await t.mutation(internal.sourcePreparation.recordProgress, progress);
    const eventCount = await t.run(
        async (ctx) => (await ctx.db.query("runEvents").take(20)).length,
    );
    await t.mutation(internal.sourcePreparation.recordProgress, progress);
    expect(
        await t.run(
            async (ctx) => (await ctx.db.query("runEvents").take(20)).length,
        ),
    ).toBe(eventCount);
    const owned = t.withIdentity({ subject: userId });
    const summary = await owned.query(api.sourceSelectionProposals.getCurrent, {
        runId,
        corpusRevisionId,
    });
    expect(summary?.preparation).toMatchObject({
        progress: {
            phase: "comparison",
            current: 1,
            total: 3,
            updatedAt: expect.any(Number),
        },
    });
    await t.run((ctx) => ctx.db.patch(runId, { executionGeneration: 4 }));
    await expect(
        t.mutation(internal.sourcePreparation.recordProgress, {
            ...progress,
            current: 2,
        }),
    ).rejects.toThrow();
    expect(
        (await t.run((ctx) => ctx.db.get(preparationId)))?.progress?.current,
    ).toBe(1);
});

test("excluded sources are shown separately from remaining preparation work", async () => {
    const { t, runId, corpusRevisionId, sourceId, userId } =
        await seedSourcePreparation();
    await t.mutation(internal.sourcePreparation.claimForDiscovery, {
        runId,
        corpusRevisionId,
        expectedExecutionGeneration: 3,
    });
    await t.mutation(internal.sourceSelectionProposals.generateForRun, {
        runId,
        expectedExecutionGeneration: 3,
    });
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
        }),
    );
    const owned = t.withIdentity({ subject: userId });
    await owned.mutation(api.sources.decide, {
        runId,
        corpusRevisionId,
        sourceId,
        decision: "rejected",
        decisionKey: "exclude-before-reading",
    });
    const summary = await owned.query(api.sourceSelectionProposals.getCurrent, {
        runId,
        corpusRevisionId,
    });
    expect(summary?.preparation).toMatchObject({
        total: 0,
        remaining: 0,
        checked: 0,
        excluded: 1,
    });
});

test("an interrupted preparation preserves captured content and distinguishes untouched sources after a failed search", async () => {
    const { t, runId, corpusRevisionId, sourceId, userId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    const { captureId, untouchedId } = await t.run(async (ctx) => {
        const text = "Saved material before assessment stopped.";
        const storageId = await ctx.storage.store(new Blob([text]));
        const captureId = await ctx.db.insert("sourceCaptures", {
            runId,
            corpusRevisionId,
            sourceId,
            preparationId,
            executionGeneration: 3,
            captureKey: "review-capture",
            requestInputHash: sha256Hex("request"),
            status: "committed",
            requestedUrl: "https://www.servicenow.com/products/workflows.html",
            storageId,
            contentHash: sha256Hex(text),
            byteCount: text.length,
            normalizerVersion: "test-v1",
            retrievalVersion: "test-v1",
            retrievedAt: Date.now(),
            readingCompleteness: "complete",
            omittedPassageCount: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
        const untouchedId = await ctx.db.insert("sources", {
            runId,
            canonicalUrl:
                "https://www.sec.gov/Archives/edgar/data/1373715/annual.htm",
            title: "Annual filing",
            origin: "sec",
            category: "regulatory",
            secForm: "10-K",
            createdAt: Date.now(),
        });
        const decisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId,
            sourceId: untouchedId,
            decisionKey: "untouched",
            decision: "pending",
            occurredAt: Date.now(),
        });
        await upsertSourceReviewItem(ctx, {
            runId,
            corpusRevisionId,
            sourceId: untouchedId,
            decision: "pending",
            sourceCreatedAt: Date.now(),
            latestDecisionId: decisionId,
            decisionOccurredAt: Date.now(),
        });
        await ctx.db.patch(preparationId, { entryPoint: "source_review" });
        await ctx.db.patch(runId, { lifecycleState: "awaiting_source_review" });
        return { captureId, untouchedId };
    });
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId,
            result: {
                status: "unavailable",
                sourceCaptureId: captureId,
                reasonCode: "missing_configuration",
            },
        },
    });
    await t.mutation(internal.sourcePreparation.finish, {
        preparationId,
        expectedExecutionGeneration: 3,
    });
    await t.run(async (ctx) => {
        const previous = await ctx.db.get(preparationId);
        if (!previous) throw new Error("Missing preparation");
        const { _id, _creationTime, ...fields } = previous;
        const searchId = await ctx.db.insert(
            "sourceSelectionProposalRebuilds",
            {
                ...fields,
                operationKey: "failed-search",
                entryPoint: "targeted_search",
                target: { kind: "coverage", role: "regulatory_annual" },
                readingSourceIds: [],
                sourceOutcomes: [],
                stopCode: "preparation_failed",
                createdAt: previous.createdAt + 1,
            },
        );
        await ctx.db.patch(runId, { sourcePreparationId: searchId });
    });
    const owned = t.withIdentity({ subject: userId });
    const summary = await owned.query(api.sourceSelectionProposals.getCurrent, {
        runId,
        corpusRevisionId,
    });
    expect(summary?.preparation).toMatchObject({
        total: 2,
        captured: 1,
        assessed: 0,
        remaining: 1,
        stopCode: "missing_configuration",
    });
    expect(
        await owned.query(api.sources.getReviewSource, {
            runId,
            corpusRevisionId,
            sourceId,
        }),
    ).toMatchObject({ readingStatus: "assessment_unavailable" });
    expect(
        await owned.query(api.sources.getReviewSource, {
            runId,
            corpusRevisionId,
            sourceId: untouchedId,
        }),
    ).toMatchObject({ readingStatus: "not_started" });
    expect(
        summary?.coverageRequirements.find(
            (r) => r.role === "regulatory_annual",
        ),
    ).toMatchObject({ assessmentStatus: "pending" });
    expect(await t.run((ctx) => ctx.db.query("providerCalls").take(1))).toEqual(
        [],
    );
});

test("a source blocked before acquisition is unprocessed, not unreadable", async () => {
    const { t, runId, corpusRevisionId, sourceId, userId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId,
            result: {
                status: "unavailable",
                reasonCode: "missing_configuration",
            },
        },
    });
    await t.mutation(internal.sourcePreparation.finish, {
        preparationId,
        expectedExecutionGeneration: 3,
    });
    const owned = t.withIdentity({ subject: userId });
    expect(
        await owned.query(api.sources.getReviewSource, {
            runId,
            corpusRevisionId,
            sourceId,
        }),
    ).toMatchObject({ readingStatus: "not_started" });
    expect(
        (
            await owned.query(api.sourceSelectionProposals.getCurrent, {
                runId,
                corpusRevisionId,
            })
        )?.preparation,
    ).toMatchObject({ captured: 0, assessed: 0, failed: 0, remaining: 1 });
});

test.each([
    "draft",
    "approved",
] as const)("%s reading resolves completed outcomes without changing approved pins", async (status) => {
    const fixture = await seedInspectedEvidence({
        qualification: {
            companyMatch: "subject",
            companyPassages: [
                {
                    passageKey: "p0",
                    quotation:
                        "ServiceNow provides workflow software through its platform.",
                },
            ],
            documentKind: "official_product_documentation",
            reportingPeriodEnd: null,
            reportingPeriodPassages: [],
            findings: [
                {
                    role: "official_product_platform",
                    kind: "asserted_fact",
                    summary: "The platform provides workflow software.",
                    passages: [
                        {
                            passageKey: "p0",
                            quotation:
                                "ServiceNow provides workflow software through its platform.",
                        },
                    ],
                    period: "current",
                    periodPassages: [],
                    dependsOnFlaggedAssertion: false,
                },
            ],
            limitations: [],
        },
    });
    const { t, runId, corpusRevisionId, sourceId, userId, captureId } = fixture;
    const preparationId = await t.run(async (ctx) => {
        const run = await ctx.db.get(runId);
        if (!run?.sourcePreparationId) throw new Error("Missing preparation");
        const task = await ctx.db.query("aiTaskResults").first();
        if (!task) throw new Error("Missing qualification");
        const items = await ctx.db
            .query("sourceSelectionProposalItems")
            .collect();
        for (const item of items)
            await ctx.db.patch(item._id, {
                sourceCaptureId: undefined,
                qualificationTaskId: undefined,
                inspectionStatus: undefined,
                roleAvailability: [
                    {
                        role: "official_product_platform",
                        state: "not_established",
                        usage: "blocked",
                        reasonCodes: ["no_relevant_material"],
                    },
                ],
            });
        await ctx.db.patch(corpusRevisionId, { status: "draft" });
        await ctx.db.patch(runId, {
            executionGeneration: 3,
            executionStatus: "running",
            lifecycleState: "awaiting_source_review",
        });
        await ctx.db.patch(run.sourcePreparationId, {
            entryPoint: "source_review",
        });
        return { id: run.sourcePreparationId, taskId: task._id };
    });
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId: preparationId.id,
        outcome: {
            sourceId,
            result: {
                status: "qualified",
                taskId: preparationId.taskId,
                sourceCaptureId: captureId,
            },
        },
    });
    await t.run((ctx) => ctx.db.patch(corpusRevisionId, { status }));
    const owned = t.withIdentity({ subject: userId });
    const review = await owned.query(api.sources.getReviewSource, {
        runId,
        corpusRevisionId,
        sourceId,
    });
    const summary = await owned.query(api.sourceSelectionProposals.getCurrent, {
        runId,
        corpusRevisionId,
    });
    if (status === "draft") {
        expect(review && sourceReadingCopy(review)).toMatchObject({
            title: "Useful material identified",
        });
        expect(review).toMatchObject({
            readingStatus: "complete",
            qualificationStatus: "available",
            qualification: {
                companyMatch: "subject",
                findings: [{ usage: "documentary" }],
            },
            documentKind: "official_product_documentation",
            roleAvailability: expect.arrayContaining([
                {
                    role: "official_product_platform",
                    state: "available",
                    usage: "documentary",
                    reasonCodes: expect.any(Array),
                },
            ]),
        });
        expect(summary?.preparation).toMatchObject({
            captured: 1,
            assessed: 1,
            failed: 0,
        });
        expect(
            summary?.coverageRequirements.find(
                (requirement) =>
                    requirement.role === "official_product_platform",
            ),
        ).toMatchObject({ availability: "available", covered: true });
        const sets = await owned.query(
            api.sourceSelectionProposals.getAdjustmentSets,
            {
                runId,
                corpusRevisionId,
            },
        );
        expect(
            sets.included.find((source) => source.sourceId === sourceId),
        ).toMatchObject({
            readingStatus: "complete",
            documentKind: "official_product_documentation",
            roleAvailability: expect.arrayContaining([
                {
                    role: "official_product_platform",
                    state: "available",
                    usage: "documentary",
                    reasonCodes: expect.any(Array),
                },
            ]),
        });
    } else {
        expect(review?.qualification).toBeUndefined();
        expect(summary?.preparation?.assessed).toBe(0);
    }
});

test("a failed later source addition remains visible after a completed preparation", async () => {
    const { t, runId, corpusRevisionId, sourceId, userId } =
        await seedInspectedEvidence({
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
    const added = await t.run(async (ctx) => {
        const run = await ctx.db.get(runId);
        const base = run?.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
        if (!base) throw new Error("Missing base preparation");
        await ctx.db.patch(base._id, { status: "complete" });
        const original = await ctx.db.get(sourceId);
        if (!original) throw new Error("Missing source");
        const { _id, _creationTime, ...fields } = original;
        const addedSourceId = await ctx.db.insert("sources", {
            ...fields,
            canonicalUrl: "https://www.servicenow.com/new-reference",
            createdAt: Date.now(),
        });
        const decisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId,
            sourceId: addedSourceId,
            decisionKey: "added-pending",
            decision: "pending",
            occurredAt: Date.now(),
        });
        await upsertSourceReviewItem(ctx, {
            runId,
            corpusRevisionId,
            sourceId: addedSourceId,
            decision: "pending",
            sourceCreatedAt: Date.now(),
            latestDecisionId: decisionId,
            decisionOccurredAt: Date.now(),
        });
        const { _id: baseId, _creationTime: baseTime, ...baseFields } = base;
        const preparationId = await ctx.db.insert(
            "sourceSelectionProposalRebuilds",
            {
                ...baseFields,
                operationKey: "manual-addition",
                entryPoint: "source_review",
                manualSourceIds: [addedSourceId],
                readingSourceIds: [addedSourceId],
                sourceOutcomes: [],
                createdAt: base.createdAt + 1,
            },
        );
        await ctx.db.patch(corpusRevisionId, { status: "draft" });
        await ctx.db.patch(runId, {
            sourcePreparationId: preparationId,
            executionGeneration: 3,
            executionStatus: "running",
            lifecycleState: "awaiting_source_review",
        });
        return { preparationId, sourceId: addedSourceId };
    });
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId: added.preparationId,
        outcome: {
            sourceId: added.sourceId,
            result: {
                status: "unavailable",
                reasonCode: "missing_configuration",
            },
        },
    });
    await t.mutation(internal.sourcePreparation.finish, {
        preparationId: added.preparationId,
        expectedExecutionGeneration: 3,
    });
    const summary = await t
        .withIdentity({ subject: userId })
        .query(api.sourceSelectionProposals.getCurrent, {
            runId,
            corpusRevisionId,
        });
    expect(summary?.preparation).toMatchObject({
        status: "partial",
        captured: 1,
        assessed: 1,
        total: 2,
        remaining: 1,
        stopCode: "missing_configuration",
    });
});

test("metadata-only review does not query captures for an omitted reading projection", async () => {
    const { t, runId, corpusRevisionId, sourceId, userId } =
        await seedSourcePreparation();
    await t.mutation(internal.sourceSelectionProposals.generateForRun, {
        runId,
        expectedExecutionGeneration: 3,
    });
    await t.withIdentity({ subject: userId }).query(async (ctx) => {
        const query = vi.spyOn(ctx.db, "query");
        try {
            const summary = await (
                getCurrent as unknown as InstrumentedQuery<
                    typeof api.sourceSelectionProposals.getCurrent
                >
            )._handler(ctx, { runId, corpusRevisionId });
            const source = await (
                getReviewSource as unknown as InstrumentedQuery<
                    typeof api.sources.getReviewSource
                >
            )._handler(ctx, { runId, corpusRevisionId, sourceId });
            expect(summary?.preparation).toBeUndefined();
            expect(source?.readingStatus).toBeUndefined();
            expect(
                query.mock.calls.filter(
                    ([table]) => table === "sourceCaptures",
                ),
            ).toHaveLength(0);
        } finally {
            query.mockRestore();
        }
    });
});

test("source detail validates each pinned capture and qualification only once", async () => {
    const { t, runId, corpusRevisionId, sourceId, userId, captureId } =
        await seedInspectedEvidence({
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
    const task = await t.run((ctx) => ctx.db.query("aiTaskResults").first());
    if (!task) throw new Error("Missing task");
    await t.withIdentity({ subject: userId }).query(async (ctx) => {
        const get = vi.spyOn(ctx.db, "get");
        try {
            const source = await (
                getReviewSource as unknown as InstrumentedQuery<
                    typeof api.sources.getReviewSource
                >
            )._handler(ctx, { runId, corpusRevisionId, sourceId });
            expect(source?.qualificationStatus).toBe("available");
            expect(
                get.mock.calls.filter(([id]) => id === captureId),
            ).toHaveLength(1);
            expect(
                get.mock.calls.filter(([id]) => id === task._id),
            ).toHaveLength(1);
        } finally {
            get.mockRestore();
        }
    });
});
