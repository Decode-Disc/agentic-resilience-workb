import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test } from "vitest";

const modules = import.meta.glob("/convex/**/*.ts");
const originalRecommendedTarget = process.env.SOURCE_RECOMMENDED_TARGET;

afterEach(() => {
    if (originalRecommendedTarget === undefined) {
        delete process.env.SOURCE_RECOMMENDED_TARGET;
    } else {
        process.env.SOURCE_RECOMMENDED_TARGET = originalRecommendedTarget;
    }
});
const generateForRun = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        expectedExecutionGeneration: number;
    },
    {
        proposalId: Id<"sourceSelectionProposals">;
        version: number;
        status: "ready" | "failed";
    }
>("sourceSelectionProposals:generateForRun");
const getCurrent = makeFunctionReference<
    "query",
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
    },
    unknown
>("sourceSelectionProposals:getCurrent");
const ensureCurrentForReview = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
    },
    {
        proposalId: Id<"sourceSelectionProposals">;
        version: number;
        status: "ready" | "failed";
    }
>("sourceSelectionProposals:ensureCurrentForReview");
const listItemsPage = makeFunctionReference<
    "query",
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        disposition: "recommended" | "needs_attention" | "alternative";
        paginationOpts: { numItems: number; cursor: string | null };
    },
    {
        page: Array<{
            sourceId: Id<"sources">;
            disposition: "recommended" | "needs_attention" | "alternative";
            decision: "accepted" | "rejected" | "pending";
            included: boolean;
        }>;
    }
>("sourceSelectionProposals:listItemsPage");
const getAdjustmentSets = makeFunctionReference<
    "query",
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
    },
    {
        included: Array<{ sourceId: Id<"sources"> }>;
        available: Array<{ sourceId: Id<"sources"> }>;
    }
>("sourceSelectionProposals:getAdjustmentSets");
const recompute = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        expectedProposalId: Id<"sourceSelectionProposals">;
    },
    {
        proposalId: Id<"sourceSelectionProposals">;
        version: number;
        status: "ready" | "failed";
    }
>("sourceSelectionProposals:recompute");
const backfillSourceSelectionProposals = makeFunctionReference<
    "mutation",
    { paginationOpts: { numItems: number; cursor: string | null } },
    {
        page: Array<{
            revisionId: Id<"corpusRevisions">;
            proposalId: Id<"sourceSelectionProposals"> | null;
            outcome: "created" | "unchanged" | "skipped";
        }>;
        isDone: boolean;
        continueCursor: string;
    }
>("adminOperations:backfillSourceSelectionProposals");

test("persists one versioned source-selection proposal after discovery", async () => {
    const t = convexTest(schema, modules);
    const { runId, corpusRevisionId } = await t.run(async (ctx) => {
        const runId = await ctx.db.insert("researchRuns", {
            coveragePreset: "balanced",
            researchAngle: "workflow migration",
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            executionGeneration: 3,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 1,
        });
        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "draft",
            createdAt: 1,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });
        await ctx.db.insert("sources", {
            runId,
            canonicalUrl: "https://www.sec.gov/filing",
            title: "10-K filing",
            origin: "sec",
            category: "regulatory",
            providerResultPosition: 0,
            discoveryQueryIndex: 0,
            publishedAt: 20,
            createdAt: 1,
        });
        await ctx.db.insert("sources", {
            runId,
            canonicalUrl: "https://example.com/counter",
            title: "Workflow migration risks",
            origin: "exa",
            category: "counter_evidence",
            providerResultPosition: 0,
            discoveryQueryIndex: 4,
            publishedAt: 30,
            createdAt: 2,
        });
        return { runId, corpusRevisionId };
    });

    const generated = await t.mutation(generateForRun, {
        runId,
        expectedExecutionGeneration: 3,
    });

    expect(generated).toMatchObject({ version: 1, status: "ready" });
    await expect(
        t.run(async (ctx) => ctx.db.get(corpusRevisionId)),
    ).resolves.toMatchObject({
        sourceSelectionProposalId: generated.proposalId,
    });
    await expect(
        t.run(async (ctx) => ctx.db.get(generated.proposalId)),
    ).resolves.toMatchObject({
        runId,
        corpusRevisionId,
        version: 1,
        policyVersion: "source-selection-v1",
        coveragePreset: "balanced",
        recommendedTarget: 12,
        status: "ready",
        counts: { recommended: 2, needsAttention: 0, alternative: 0 },
        gaps: ["investor_relations", "official_product", "official_commercial"],
    });
    const items = await t.run(async (ctx) =>
        ctx.db
            .query("sourceSelectionProposalItems")
            .withIndex("by_proposal_and_rank_and_source", (query) =>
                query.eq("proposalId", generated.proposalId),
            )
            .collect(),
    );
    expect(items).toHaveLength(2);
    expect(items.map(({ disposition }) => disposition)).toEqual([
        "recommended",
        "recommended",
    ]);
});

test("rejects proposal generation for a stale execution generation", async () => {
    const t = convexTest(schema, modules);
    const runId = await t.run(async (ctx) =>
        ctx.db.insert("researchRuns", {
            coveragePreset: "balanced",
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            executionGeneration: 2,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 1,
        }),
    );

    await expect(
        t.mutation(generateForRun, {
            runId,
            expectedExecutionGeneration: 1,
        }),
    ).rejects.toThrow("no longer active");
});

test("returns no current proposal for an authorized legacy approved revision", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const otherUserId = await ctx.db.insert("users", {
            isAnonymous: true,
        });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "legacy-approved-owner",
            role: "analyst",
            codeDigest: "legacy-approved-digest",
            status: "claimed",
            createdAt: 1,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: userId,
            invitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 0,
            admittedAt: 1,
        });
        const runId = await ctx.db.insert("researchRuns", {
            ownerVisitorId: visitorId,
            coveragePreset: "balanced",
            lifecycleState: "corpus_approved",
            executionStatus: "idle",
            executionGeneration: 2,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 1,
        });
        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "approved",
            approvedByVisitorId: visitorId,
            approvedAt: 2,
            createdAt: 1,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });
        return { userId, otherUserId, runId, corpusRevisionId };
    });
    const owner = t.withIdentity({
        subject: `${fixture.userId}|legacy-approved-session`,
    });

    await expect(
        owner.query(getCurrent, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
        }),
    ).resolves.toBeNull();
    const otherUser = t.withIdentity({
        subject: `${fixture.otherUserId}|legacy-approved-other-session`,
    });
    await expect(
        otherUser.query(getCurrent, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
        }),
    ).rejects.toThrow("Unauthorized");
});

test("creates a missing proposal for an authorized legacy draft idempotently", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "legacy-draft-owner",
            role: "analyst",
            codeDigest: "legacy-draft-digest",
            status: "claimed",
            createdAt: 1,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: userId,
            invitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 1,
            admittedAt: 1,
        });
        const runId = await ctx.db.insert("researchRuns", {
            ownerVisitorId: visitorId,
            coveragePreset: "balanced",
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 1,
        });
        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "draft",
            createdAt: 1,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });
        const sourceId = await ctx.db.insert("sources", {
            runId,
            canonicalUrl: "https://www.sec.gov/legacy-filing",
            title: "Legacy filing",
            origin: "sec",
            category: "regulatory",
            createdAt: 1,
        });
        const decisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId,
            sourceId,
            decisionKey: "legacy-pending",
            decision: "pending",
            reviewerVisitorId: visitorId,
            occurredAt: 1,
        });
        await ctx.db.insert("sourceReviewItems", {
            runId,
            corpusRevisionId,
            sourceId,
            decision: "pending",
            decisionRank: 0,
            sourceCreatedAt: 1,
            latestDecisionId: decisionId,
            decisionOccurredAt: 1,
        });
        return { userId, runId, corpusRevisionId };
    });
    const owner = t.withIdentity({
        subject: `${fixture.userId}|legacy-draft-session`,
    });
    const args = {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
    };

    const first = await owner.mutation(ensureCurrentForReview, args);
    const second = await owner.mutation(ensureCurrentForReview, args);

    expect(first).toMatchObject({ version: 1, status: "ready" });
    expect(second).toEqual(first);
    await expect(owner.query(getCurrent, args)).resolves.toMatchObject({
        proposalId: first.proposalId,
        version: 1,
        effectiveStatus: "ready",
    });
});

test("projects recommendation pages and adjustment sets through analyst decisions", async () => {
    process.env.SOURCE_RECOMMENDED_TARGET = "2";
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-1",
            role: "analyst",
            codeDigest: "proposal-digest",
            status: "claimed",
            createdAt: 1,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: userId,
            invitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 1,
            admittedAt: 1,
        });
        const runId = await ctx.db.insert("researchRuns", {
            ownerVisitorId: visitorId,
            coveragePreset: "balanced",
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 1,
        });
        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "draft",
            createdAt: 1,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });
        const sources = [];
        for (const [index, category] of [
            "regulatory",
            "counter_evidence",
            "independent_analysis",
        ].entries()) {
            const sourceId = await ctx.db.insert("sources", {
                runId,
                canonicalUrl: `https://example.com/${category}`,
                title: `${category} source`,
                origin: "exa",
                category,
                providerResultPosition: index,
                discoveryQueryIndex: index,
                createdAt: index + 1,
            });
            const decisionId = await ctx.db.insert("sourceDecisions", {
                runId,
                corpusRevisionId,
                sourceId,
                decisionKey: `initial-${index}`,
                decision: index === 0 ? "rejected" : "pending",
                reviewerVisitorId: visitorId,
                occurredAt: index + 1,
            });
            await ctx.db.insert("sourceReviewItems", {
                runId,
                corpusRevisionId,
                sourceId,
                decision: index === 0 ? "rejected" : "pending",
                decisionRank: index === 0 ? 2 : 0,
                sourceCreatedAt: index + 1,
                latestDecisionId: decisionId,
                decisionOccurredAt: index + 1,
            });
            sources.push(sourceId);
        }
        return { userId, runId, corpusRevisionId, sources };
    });
    const generated = await t.mutation(generateForRun, {
        runId: fixture.runId,
        expectedExecutionGeneration: 1,
    });
    await t.run((ctx) =>
        ctx.db.patch(fixture.runId, {
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
        }),
    );
    const analyst = t.withIdentity({
        subject: `${fixture.userId}|proposal-session`,
    });

    await expect(
        analyst.query(getCurrent, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
        }),
    ).resolves.toMatchObject({
        proposalId: generated.proposalId,
        version: 1,
        effectiveStatus: "ready",
        effectiveIncludedCount: 1,
    });
    await expect(
        analyst.query(listItemsPage, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            disposition: "recommended",
            paginationOpts: { numItems: 12, cursor: null },
        }),
    ).resolves.toMatchObject({
        page: [
            expect.objectContaining({
                sourceId: fixture.sources[0],
                decision: "rejected",
                included: false,
            }),
            expect.objectContaining({
                sourceId: fixture.sources[1],
                decision: "pending",
                included: true,
            }),
        ],
    });
    await expect(
        analyst.query(getAdjustmentSets, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
        }),
    ).resolves.toMatchObject({
        included: [expect.objectContaining({ sourceId: fixture.sources[1] })],
        available: expect.arrayContaining([
            expect.objectContaining({ sourceId: fixture.sources[0] }),
            expect.objectContaining({ sourceId: fixture.sources[2] }),
        ]),
    });

    process.env.SOURCE_RECOMMENDED_TARGET = "3";
    await expect(
        analyst.query(getCurrent, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
        }),
    ).resolves.toMatchObject({ effectiveStatus: "stale" });
    await expect(
        analyst.mutation(recompute, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            expectedProposalId: generated.proposalId,
        }),
    ).resolves.toMatchObject({ version: 2, status: "ready" });
    await expect(
        analyst.query(getCurrent, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
        }),
    ).resolves.toMatchObject({ effectiveStatus: "ready", version: 2 });
});

test("backfills a missing draft proposal idempotently without touching approved revisions", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
        const adminUserId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "proposal-admin",
            role: "admin",
            codeDigest: "proposal-admin-digest",
            status: "claimed",
            createdAt: 1,
        });
        await ctx.db.insert("visitors", {
            authUserId: adminUserId,
            invitationId,
            role: "admin",
            status: "active",
            analysesReserved: 0,
            admittedAt: 1,
        });
        const runId = await ctx.db.insert("researchRuns", {
            coveragePreset: "balanced",
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 1,
        });
        const revisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "draft",
            createdAt: 1,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: revisionId });
        return { adminUserId, revisionId };
    });
    const admin = t.withIdentity({
        subject: `${fixture.adminUserId}|proposal-backfill`,
    });
    const args = { paginationOpts: { numItems: 10, cursor: null } };

    const first = await admin.mutation(backfillSourceSelectionProposals, args);
    const second = await admin.mutation(backfillSourceSelectionProposals, args);

    expect(first.page).toEqual([
        expect.objectContaining({
            revisionId: fixture.revisionId,
            proposalId: expect.any(String),
            outcome: "created",
        }),
    ]);
    expect(second.page).toEqual([
        expect.objectContaining({
            revisionId: fixture.revisionId,
            proposalId: first.page[0]?.proposalId,
            outcome: "unchanged",
        }),
    ]);
});
