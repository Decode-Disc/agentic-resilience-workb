import { internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

afterEach(() => vi.useRealTimers());
test("source qualification receives the committed scope and questions", async () => {
    vi.useFakeTimers();
    const f = await seedSourcePreparation();
    const { t, runId, corpusRevisionId, sourceId } = f;
    const preparationId = await t.mutation(
        internal.sourcePreparation.claimForDiscovery,
        { runId, corpusRevisionId, expectedExecutionGeneration: 3 },
    );
    const captureId = await t.run(async (ctx) => {
        const framingId = await ctx.db.insert("framingRevisions", {
            runId,
            revision: 2,
            content: {
                scope: "Accepted claims payment workflow",
                questions: [
                    {
                        id: "q",
                        shortLabel: "Fees",
                        text: "Who controls claim payment fees?",
                        rationale: "Economic control.",
                    },
                ],
            },
            contentHash: "fixture",
            requestKey: "saved",
            origin: "analyst",
            createdAt: Date.now(),
        });
        await ctx.db.patch(runId, {
            startMode: "framed",
            currentFramingRevisionId: framingId,
            fixedFramingRevisionId: framingId,
            researchAngle: "Discarded recruitment workflow",
        });
        const storageId = await ctx.storage.store(
            new Blob(["A captured source."]),
        );
        return ctx.db.insert("sourceCaptures", {
            runId,
            corpusRevisionId,
            sourceId,
            preparationId,
            executionGeneration: 3,
            captureKey: "review",
            requestInputHash: "fixture",
            status: "committed",
            requestedUrl: "https://www.servicenow.com/products/workflows.html",
            storageId,
            normalizerVersion: "fixture",
            retrievalVersion: "fixture",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
    });
    const result = await t.query(
        internal.sourcePreparation.getQualificationInput,
        { preparationId, sourceCaptureId: captureId, now: Date.now() },
    );
    expect(result.researchAngle).toContain("Accepted claims payment workflow");
    expect(result.researchAngle).toContain("Who controls claim payment fees?");
    expect(result.researchAngle).not.toContain(
        "Discarded recruitment workflow",
    );
});

test.each([
    "Discarded recruitment workflow",
    undefined,
])("discovery uses committed framing with original angle %s", async (original) => {
    vi.useFakeTimers();
    const { t, runId } = await seedSourcePreparation();
    await t.run(async (ctx) => {
        const id = await ctx.db.insert("framingRevisions", {
            runId,
            revision: 1,
            content: {
                scope: "Accepted payment workflow",
                questions: [
                    {
                        id: "q",
                        text: "Who controls payment fees?",
                        shortLabel: "Fees",
                        rationale: "Economic control.",
                    },
                ],
            },
            contentHash: "fixture",
            requestKey: "fixed",
            origin: "analyst",
            createdAt: Date.now(),
        });
        await ctx.db.patch(runId, {
            startMode: "framed",
            fixedFramingRevisionId: id,
            currentFramingRevisionId: id,
            researchAngle: original,
        });
    });
    await t.mutation(internal.researchPlanning.createForRun, {
        runId,
        expectedExecutionGeneration: 3,
    });
    const context = await t.query(
        internal.researchPlanning.getDiscoveryContext,
        { runId },
    );
    expect(context.researchAngle).toContain("Accepted payment workflow");
    expect(context.researchAngle).toContain("Who controls payment fees?");
    expect(context.researchAngle).not.toContain(
        "Discarded recruitment workflow",
    );
});

test("source selection retains the committed brief rather than the discarded angle", async () => {
    const { t, runId } = await seedSourcePreparation();
    await t.run(async (ctx) => {
        const id = await ctx.db.insert("framingRevisions", {
            runId,
            revision: 1,
            content: { scope: "Accepted payment workflow", questions: [] },
            contentHash: "fixture",
            requestKey: "fixed",
            origin: "analyst",
            createdAt: Date.now(),
        });
        await ctx.db.patch(runId, {
            startMode: "framed",
            fixedFramingRevisionId: id,
            currentFramingRevisionId: id,
            researchAngle: "Discarded recruitment workflow",
        });
    });
    const { proposalId } = await t.mutation(
        internal.sourceSelectionProposals.generateForRun,
        { runId, expectedExecutionGeneration: 3 },
    );
    expect(await t.run((ctx) => ctx.db.get(proposalId))).toMatchObject({
        researchAngle: "Accepted payment workflow",
    });
});
