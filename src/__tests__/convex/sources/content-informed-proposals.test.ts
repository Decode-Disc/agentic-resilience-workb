import { api, internal } from "@convex/_generated/api";
import { SOURCE_COMPARISON_VERSION } from "@convex/domain/sourceComparison";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { SOURCE_QUALIFICATION_VERSION } from "@convex/domain/sourceQualification";
import { expect, test } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

async function historicalPreparedProposal() {
    const fixture = await seedSourcePreparation();
    const { t, runId, corpusRevisionId, sourceId } = fixture;
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    const qualification = {
        companyMatch: "subject" as const,
        companyPassages: [{ passageKey: "p0", quotation: "ServiceNow" }],
        documentKind: "official_commercial_terms" as const,
        reportingPeriodEnd: null,
        reportingPeriodPassages: [],
        findings: [
            {
                role: "official_commercial_terms" as const,
                kind: "asserted_fact" as const,
                summary: "Historical subscription agreement",
                passages: [{ passageKey: "p0", quotation: "2012 agreement" }],
                period: "historical" as const,
                periodPassages: [
                    { passageKey: "p0", quotation: "2012 agreement" },
                ],
                dependsOnFlaggedAssertion: false,
            },
        ],
        limitations: [],
    };
    const { sourceCaptureId, taskId } = await t.run(async (ctx) => {
        await ctx.db.patch(sourceId, {
            canonicalUrl: "https://www.servicenow.com/legal/old-agreement",
            title: "Subscription agreement",
            category: "official_commercial",
        });
        const text = "ServiceNow 2012 agreement";
        const contentHash = sha256Hex(text);
        const storageId = await ctx.storage.store(new Blob([text]));
        const sourceCaptureId = await ctx.db.insert("sourceCaptures", {
            runId,
            corpusRevisionId,
            sourceId,
            preparationId,
            executionGeneration: 3,
            captureKey: "test-capture",
            requestInputHash: "test-input",
            status: "committed",
            requestedUrl: "https://www.servicenow.com/legal/old-agreement",
            storageId,
            contentHash,
            normalizerVersion: "test-v1",
            readingCompleteness: "complete",
            omittedPassageCount: 0,
            createdAt: 1,
            updatedAt: 1,
        });
        const taskId = await ctx.db.insert("aiTaskResults", {
            runId,
            corpusRevisionId,
            sourceId,
            sourceCaptureId,
            taskType: "source_qualification",
            executionMode: "live",
            schemaVersion: SOURCE_QUALIFICATION_VERSION,
            adapterVersion: "test-v1",
            inputHash: "test-qualification-input",
            output: {
                kind: "source_qualification",
                sourceCaptureId,
                contentHash,
                qualification,
                readingCompleteness: "complete",
                omittedPassageCount: 0,
                selectedPassages: [
                    {
                        passageKey: "p0",
                        startOffset: 0,
                        endOffset: text.length,
                    },
                ],
            },
            createdAt: 2,
        });
        return { sourceCaptureId, taskId };
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
    return {
        ...fixture,
        sourceCaptureId,
        taskId,
        qualification,
        preparationId,
    };
}

test("projects actual preparation outcomes before and after completion", async () => {
    const {
        t,
        userId,
        runId,
        corpusRevisionId,
        sourceId,
        sourceCaptureId,
        taskId,
        preparationId,
    } = await historicalPreparedProposal();
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            lifecycleState: "discovering_sources",
            executionStatus: "running",
        }),
    );
    await t.mutation(internal.sourcePreparation.recordResult, {
        preparationId,
        outcome: {
            sourceId,
            result: { status: "qualified", sourceCaptureId, taskId },
        },
    });
    const owner = t.withIdentity({ subject: userId });
    expect(
        await owner.query(api.sourceSelectionProposals.getCurrent, {
            runId,
            corpusRevisionId,
        }),
    ).toMatchObject({
        preparation: { status: "started", checked: 1, total: 1 },
    });
    await t.mutation(internal.sourcePreparation.finish, {
        preparationId,
        expectedExecutionGeneration: 3,
    });
    expect(
        await owner.query(api.sourceSelectionProposals.getCurrent, {
            runId,
            corpusRevisionId,
        }),
    ).toMatchObject({
        preparation: { status: "complete", checked: 1, total: 1 },
    });
});

test("comparison history overflow cannot authorize from a truncated history", async () => {
    const { t, runId, sourceId, sourceCaptureId, taskId, corpusRevisionId } =
        await historicalPreparedProposal();
    await t.run(async (ctx) => {
        await ctx.db.patch(runId, {
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            pauseReason: undefined,
        });
        for (let index = 0; index < 121; index += 1) {
            const inputHash = sha256Hex(`unrelated comparison ${index}`);
            await ctx.db.insert("aiTaskResults", {
                runId,
                corpusRevisionId,
                sourceId,
                sourceCaptureId,
                taskType: "source_comparison",
                executionMode: "live",
                schemaVersion: SOURCE_COMPARISON_VERSION,
                adapterVersion: "comparison-fixture",
                inputHash,
                output: {
                    kind: "source_comparison",
                    comparisonVersion: SOURCE_COMPARISON_VERSION,
                    checkStatus: "compared",
                    runId: String(runId),
                    corpusRevisionId: String(corpusRevisionId),
                    inputHash,
                    targetSourceId: sourceId,
                    targetCaptureId: sourceCaptureId,
                    targetContentHash: sha256Hex(`another capture ${index}`),
                    qualificationTaskId: taskId,
                    completeness: "complete",
                    omittedFindingIndexes: [],
                    omittedPrimaryCaptureCount: 0,
                    omittedPrimaryPassageCount: 0,
                    findings: [],
                },
                createdAt: 10 + index,
            });
        }
    });
    await expect(
        t.mutation(internal.sourceSelectionProposals.generateForRun, {
            runId,
            expectedExecutionGeneration: 3,
        }),
    ).rejects.toThrow("Source comparison history exceeds its limit");
});

test("the owned inspector exposes pinned content while collection responses retain only concise selection metadata", async () => {
    const {
        t,
        runId,
        corpusRevisionId,
        sourceId,
        userId,
        sourceCaptureId,
        taskId,
        qualification,
    } = await historicalPreparedProposal();
    const owner = t.withIdentity({ subject: userId });
    const sets = await owner.query(
        api.sourceSelectionProposals.getAdjustmentSets,
        { runId, corpusRevisionId },
    );
    expect(sets.included[0]).toMatchObject({
        sourceCaptureId,
        qualificationTaskId: taskId,
        inspectionStatus: "complete",
    });
    expect(sets.included[0]).not.toHaveProperty("qualification");
    const selected = await owner.query(api.sources.getReviewSource, {
        runId,
        corpusRevisionId,
        sourceId,
    });
    expect(selected).toMatchObject({
        qualification,
        qualificationStatus: "available",
        qualificationExecutionMode: "live",
        inspectionStatus: "complete",
    });
    expect(
        selected?.roleAvailability?.find(
            (item) => item.role === "official_commercial_terms",
        ),
    ).toMatchObject({ state: "limited", reasonCodes: ["historical"] });
    const current = await owner.query(api.sourceSelectionProposals.getCurrent, {
        runId,
        corpusRevisionId,
    });
    expect(current?.effectiveStatus).toBe("ready");
    expect(
        current?.coverageRequirements.find(
            (item) => item.role === "official_commercial_terms",
        ),
    ).toMatchObject({
        covered: false,
        availability: "limited",
        reasonCodes: ["historical"],
    });
    await expect(
        t.query(api.sourceSelectionProposals.getCurrent, {
            runId,
            corpusRevisionId,
        }),
    ).rejects.toThrow("Not authenticated");
    await expect(
        t.query(api.sources.getReviewSource, {
            runId,
            corpusRevisionId,
            sourceId,
        }),
    ).rejects.toThrow("Not authenticated");
});

test.each([
    "content_hash",
    "source_identity",
    "capture_status",
    "protocol",
])("does not expose qualification with a mismatched %s pin", async (mismatch) => {
    const {
        t,
        userId,
        runId,
        corpusRevisionId,
        sourceId,
        taskId,
        sourceCaptureId,
    } = await historicalPreparedProposal();
    await t.run(async (ctx) => {
        const task = await ctx.db.get(taskId);
        if (task?.output.kind !== "source_qualification")
            throw new Error("Expected the seeded qualification");
        if (mismatch === "content_hash")
            await ctx.db.patch(taskId, {
                output: { ...task.output, contentHash: "different-content" },
            });
        if (mismatch === "source_identity") {
            const otherSourceId = await ctx.db.insert("sources", {
                runId,
                canonicalUrl: "https://www.servicenow.com/other",
                title: "Another document",
                origin: "exa",
                category: "official_product",
                createdAt: 1,
            });
            await ctx.db.patch(taskId, { sourceId: otherSourceId });
        }
        if (mismatch === "capture_status")
            await ctx.db.patch(sourceCaptureId, { status: "unavailable" });
        if (mismatch === "protocol")
            await ctx.db.patch(taskId, { schemaVersion: "obsolete" });
    });
    const selected = await t
        .withIdentity({ subject: userId })
        .query(api.sources.getReviewSource, {
            runId,
            corpusRevisionId,
            sourceId,
        });
    expect(selected).toMatchObject({
        sourceId,
        qualificationStatus: "unavailable",
    });
    expect(selected).not.toHaveProperty("qualification");
});
