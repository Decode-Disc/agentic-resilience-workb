import { api, internal } from "@convex/_generated/api";
import { readSourceCandidateCapacity } from "@convex/domain/sourceCandidateCapacity";
import { upsertSourceReviewItem } from "@convex/domain/sourceReviewProjection";
import { afterEach, expect, test, vi } from "vitest";
import { seedSourcePreparation } from "@/__tests__/setup/source-preparation";

afterEach(() => vi.unstubAllEnvs());

async function preparedCandidates(count: number) {
    const fixture = await seedSourcePreparation();
    const { t, runId, corpusRevisionId } = fixture;
    await t.mutation(internal.sourcePreparation.claimForDiscovery, {
        runId,
        corpusRevisionId,
        expectedExecutionGeneration: 3,
    });
    await t.run(async (ctx) => {
        for (let index = 1; index < count; index++) {
            const sourceId = await ctx.db.insert("sources", {
                runId,
                canonicalUrl: `https://www.servicenow.com/products/candidate-${index}`,
                title: `Workflow candidate ${index}`,
                origin: "exa",
                category: "official_product",
                createdAt: index,
            });
            const decisionId = await ctx.db.insert("sourceDecisions", {
                runId,
                corpusRevisionId,
                sourceId,
                decisionKey: `candidate-${index}`,
                decision: "pending",
                occurredAt: index,
            });
            await upsertSourceReviewItem(ctx, {
                runId,
                corpusRevisionId,
                sourceId,
                decision: "pending",
                sourceCreatedAt: index,
                latestDecisionId: decisionId,
                decisionOccurredAt: index,
            });
        }
    });
    return fixture;
}

test("a prepared dossier retains sixty candidates in proposals and owned review projections", async () => {
    const { t, runId, corpusRevisionId, userId } = await preparedCandidates(60);
    expect(
        await t.run((ctx) => readSourceCandidateCapacity(ctx.db, runId)),
    ).toEqual({ limit: 60, total: 60, remaining: 0 });
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
    const sets = await owned.query(
        api.sourceSelectionProposals.getAdjustmentSets,
        { runId, corpusRevisionId },
    );
    expect(sets.included.length + sets.available.length).toBe(60);
    expect(
        await owned.query(api.sources.getReviewSummary, {
            runId,
            corpusRevisionId,
        }),
    ).toMatchObject({ total: 60, candidateLimit: 60 });
});

test("initial discovery remains capped at forty-eight even for a previously prepared dossier", async () => {
    const { t, runId, corpusRevisionId } = await preparedCandidates(60);
    expect(
        await t.query(internal.sourceDiscovery.getCandidateCapacity, {
            runId,
            executionGeneration: 3,
        }),
    ).toEqual({ limit: 48, total: 60, remaining: 0 });
    expect(
        await t.mutation(internal.sourceDiscovery.persistCandidates, {
            runId,
            corpusRevisionId,
            executionGeneration: 3,
            operationKey: "initial-discovery-resume",
            candidates: [
                {
                    canonicalUrl: "https://www.servicenow.com/products/extra",
                    title: "Extra initial result",
                    origin: "exa",
                    category: "official_product",
                },
            ],
        }),
    ).toEqual({ inserted: 0, total: 60 });
});

test("a sixty-first historical candidate is an explicit limit violation", async () => {
    const { t, runId } = await preparedCandidates(61);
    await expect(
        t.run((ctx) => readSourceCandidateCapacity(ctx.db, runId)),
    ).rejects.toThrow("source candidate limit");
});

test("preparation cannot raise the twenty-four-source recommendation ceiling", async () => {
    vi.stubEnv("SOURCE_CANDIDATE_LIMIT", "200");
    vi.stubEnv("SOURCE_RECOMMENDATION_CEILING", "60");
    const { t, runId, corpusRevisionId, userId } = await preparedCandidates(3);
    await t.mutation(internal.sourceSelectionProposals.generateForRun, {
        runId,
        expectedExecutionGeneration: 3,
    });
    const proposal = await t
        .withIdentity({ subject: userId })
        .query(api.sourceSelectionProposals.getCurrent, {
            runId,
            corpusRevisionId,
        });
    expect(proposal?.recommendationCeiling).toBe(24);
});

test("a raised configuration cannot reopen initial discovery beyond forty-eight candidates", async () => {
    vi.stubEnv("SOURCE_CANDIDATE_LIMIT", "200");
    const { t, runId } = await preparedCandidates(60);
    expect(
        await t.query(internal.sourceDiscovery.getCandidateCapacity, {
            runId,
            executionGeneration: 3,
        }),
    ).toEqual({ limit: 48, total: 60, remaining: 0 });
});
