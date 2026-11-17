import { api, internal } from "@convex/_generated/api";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { expect, test } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

test.each([
    "source-selection-v12",
    "source-selection-v13",
])("pins inspected bytes during an explicit %s draft refresh when qualification is unavailable", async (legacyPolicy) => {
    const { t, runId, corpusRevisionId, sourceId, userId } =
        await seedSourcePreparation();
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    const captureId = await t.run(async (ctx) => {
        const text = "ServiceNow provides workflow software.";
        const storageId = await ctx.storage.store(new Blob([text]));
        return ctx.db.insert("sourceCaptures", {
            runId,
            corpusRevisionId,
            sourceId,
            preparationId,
            executionGeneration: 3,
            captureKey: "read-without-qualification",
            requestInputHash: "test-input",
            status: "committed",
            requestedUrl: "https://www.servicenow.com/products/workflows.html",
            storageId,
            contentHash: sha256Hex(text),
            byteCount: text.length,
            retrievalVersion: "test-v1",
            normalizerVersion: "test-v1",
            retrievedAt: Date.now(),
            readingCompleteness: "complete",
            omittedPassageCount: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
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
    const sets = await t
        .withIdentity({ subject: userId })
        .query(api.sourceSelectionProposals.getAdjustmentSets, {
            runId,
            corpusRevisionId,
        });
    expect(sets.included[0]).toMatchObject({
        sourceCaptureId: captureId,
        inspectionStatus: "unavailable",
        included: true,
        eligibleCoverageRoles: [],
    });
    expect(sets.included[0]?.qualificationTaskId).toBeUndefined();
    const historical = await t.run(async (ctx) => {
        const proposal = await ctx.db.query("sourceSelectionProposals").first();
        if (!proposal) throw new Error("Missing fixture proposal");
        await ctx.db.patch(proposal._id, {
            policyVersion: legacyPolicy,
        });
        return proposal;
    });
    const refreshed = await t
        .withIdentity({ subject: userId })
        .mutation(api.sourceSelectionProposals.recompute, {
            runId,
            corpusRevisionId,
            expectedProposalId: historical._id,
        });
    expect(refreshed.version).toBe(historical.version + 1);
    expect(
        await t.run(async (ctx) => ({
            previous: (await ctx.db.get(historical._id))?.policyVersion,
            current: (await ctx.db.get(refreshed.proposalId))?.policyVersion,
            captures: (await ctx.db.query("sourceCaptures").collect()).map(
                (capture) => capture._id,
            ),
            calls: (await ctx.db.query("providerCalls").collect()).length,
        })),
    ).toEqual({
        previous: legacyPolicy,
        current: "source-selection-v14",
        captures: [captureId],
        calls: 0,
    });
});
