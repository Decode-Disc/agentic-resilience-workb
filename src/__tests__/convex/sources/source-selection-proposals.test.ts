import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

const modules = import.meta.glob("/convex/**/*.ts");
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
        const companyId = await ctx.db.insert("companies", {
            cik: "1373715",
            legalName: "ServiceNow, Inc.",
            ticker: "NOW",
            exchange: "NYSE",
            websiteUrl: "https://www.servicenow.com/",
            canonicalizedAt: 1,
        });
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            companyId,
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
            canonicalUrl:
                "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000001/now-20251231.htm",
            title: "10-K filing",
            origin: "sec",
            category: "regulatory",
            secForm: "10-K",
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
        policyVersion: "source-selection-v14",
        publisherRegistryVersion: "source-publishers-v4",
        coveragePreset: "balanced",
        recommendedTarget: 24,
        recommendationCeiling: 24,
        status: "ready",
        counts: { recommended: 1, needsAttention: 0, alternative: 1 },
    });
    const items = await t.run(async (ctx) =>
        ctx.db
            .query("sourceSelectionProposalItems")
            .withIndex("by_proposal_and_rank_and_source", (query) =>
                query.eq("proposalId", generated.proposalId),
            )
            .collect(),
    );
    expect(
        items.find((item) => item.disposition === "recommended"),
    ).toMatchObject({
        selectionRationale: {
            version: 1,
            trigger: "required_role",
            role: "regulatory_annual",
            contributions: [],
        },
    });
    expect(items).toHaveLength(2);
    expect(items.map(({ disposition }) => disposition)).toEqual([
        "recommended",
        "alternative",
    ]);
    expect(items[0]).toMatchObject({
        documentKind: "regulatory_annual",
        authorityTier: "regulator_primary",
        companyLinkageBasis: "structural",
        coverageContributions: expect.arrayContaining(["regulatory_annual"]),
        recommendationContributions: [],
        declaredCoverageRoles: ["regulatory_annual"],
        eligibleCoverageRoles: ["regulatory_annual"],
    });
});

test("uses current company website metadata when a legacy run snapshot is stale", async () => {
    const t = convexTest(schema, modules);
    const { runId, sourceId } = await t.run(async (ctx) => {
        const companyId = await ctx.db.insert("companies", {
            cik: "1373715",
            legalName: "ServiceNow, Inc.",
            ticker: "NOW",
            exchange: "NYSE",
            websiteUrl: "https://www.servicenow.com/",
            canonicalizedAt: 2,
        });
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            companyId,
            companySnapshot: {
                cik: "1373715",
                legalName: "ServiceNow, Inc.",
                ticker: "NOW",
                exchange: "NYSE",
                websiteUrl: "https://old.example/",
            },
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
        const sourceId = await ctx.db.insert("sources", {
            runId,
            canonicalUrl: "https://www.servicenow.com/lpgp/pricing.html",
            title: "Pricing",
            origin: "exa",
            category: "official_commercial",
            createdAt: 1,
        });
        return { runId, sourceId };
    });

    const proposal = await t.mutation(generateForRun, {
        runId,
        expectedExecutionGeneration: 1,
    });
    const item = await t.run(async (ctx) =>
        ctx.db
            .query("sourceSelectionProposalItems")
            .withIndex("by_proposal_and_source", (query) =>
                query
                    .eq("proposalId", proposal.proposalId)
                    .eq("sourceId", sourceId),
            )
            .unique(),
    );

    expect(item).toMatchObject({
        sourceId,
        disposition: "recommended",
        authorityTier: "company_primary",
        documentKind: "official_pricing",
        reasonCodes: ["required_coverage_role"],
    });
});

test("marks and refreshes a proposal after current company website enrichment", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "company-enrichment-owner",
            role: "analyst",
            codeDigest: "company-enrichment-digest",
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
        const companyId = await ctx.db.insert("companies", {
            cik: "1373715",
            legalName: "ServiceNow, Inc.",
            ticker: "NOW",
            exchange: "NYSE",
            canonicalizedAt: 1,
        });
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            ownerVisitorId: visitorId,
            companyId,
            companySnapshot: {
                cik: "1373715",
                legalName: "ServiceNow, Inc.",
                ticker: "NOW",
                exchange: "NYSE",
            },
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
        const sourceId = await ctx.db.insert("sources", {
            runId,
            canonicalUrl: "https://www.servicenow.com/lpgp/pricing.html",
            title: "Pricing",
            origin: "exa",
            category: "official_commercial",
            createdAt: 1,
        });
        const decisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId,
            sourceId,
            decisionKey: "company-enrichment-pending",
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
        return { userId, companyId, runId, corpusRevisionId, sourceId };
    });
    const initial = await t.mutation(generateForRun, {
        runId: fixture.runId,
        expectedExecutionGeneration: 1,
    });
    await t.run(async (ctx) => {
        await ctx.db.patch(fixture.runId, {
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
        });
        await ctx.db.patch(fixture.companyId, {
            websiteUrl: "https://www.servicenow.com/",
            canonicalizedAt: 2,
        });
    });
    const owner = t.withIdentity({
        subject: `${fixture.userId}|company-enrichment-session`,
    });
    const args = {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
    };

    await expect(owner.query(getCurrent, args)).resolves.toMatchObject({
        proposalId: initial.proposalId,
        effectiveStatus: "stale",
    });
    const refreshed = await owner.mutation(recompute, {
        ...args,
        expectedProposalId: initial.proposalId,
    });
    const refreshedItem = await t.run(async (ctx) =>
        ctx.db
            .query("sourceSelectionProposalItems")
            .withIndex("by_proposal_and_source", (query) =>
                query
                    .eq("proposalId", refreshed.proposalId)
                    .eq("sourceId", fixture.sourceId),
            )
            .unique(),
    );

    expect(refreshedItem).toMatchObject({
        disposition: "recommended",
        authorityTier: "company_primary",
        documentKind: "official_pricing",
    });
    if (!refreshedItem) throw new Error("Missing refreshed item");
    await t.run(async (ctx) =>
        ctx.db.patch(refreshedItem._id, { selectionRationale: undefined }),
    );
    await expect(owner.query(getCurrent, args)).resolves.toMatchObject({
        effectiveStatus: "ready",
        selectionExplanationRefreshAvailable: true,
    });
    const explained = await owner.mutation(recompute, {
        ...args,
        expectedProposalId: refreshed.proposalId,
    });
    expect(explained.version).toBe(refreshed.version + 1);
    await expect(owner.query(getCurrent, args)).resolves.toMatchObject({
        effectiveStatus: "ready",
        selectionExplanationRefreshAvailable: false,
    });
    const page = await owner.query(listItemsPage, {
        ...args,
        disposition: "recommended",
        paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page[0]).toMatchObject({
        sourceId: fixture.sourceId,
        decision: "pending",
        selectionRationale: {
            trigger: "required_role",
            role: "official_commercial_pricing",
        },
    });
    await expect(
        owner.mutation(recompute, {
            ...args,
            expectedProposalId: refreshed.proposalId,
        }),
    ).rejects.toThrow("cannot be recomputed");
});

test("rejects proposal generation for a stale execution generation", async () => {
    const t = convexTest(schema, modules);
    const runId = await t.run(async (ctx) =>
        ctx.db.insert("researchRuns", {
            purpose: "research",
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
            purpose: "research",
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
            purpose: "research",
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

test("hydrates legacy proposal items without automatic role metadata", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "legacy-proposal-owner",
            role: "analyst",
            codeDigest: "legacy-proposal-digest",
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
            purpose: "research",
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
        const sourceId = await ctx.db.insert("sources", {
            runId,
            canonicalUrl:
                "https://www.sec.gov/Archives/edgar/data/1373715/legacy.htm",
            title: "Legacy annual report",
            origin: "sec",
            category: "regulatory",
            createdAt: 1,
        });
        const proposalId = await ctx.db.insert("sourceSelectionProposals", {
            runId,
            corpusRevisionId,
            version: 1,
            policyVersion: "source-selection-v3",
            coveragePreset: "balanced",
            recommendedTarget: 24,
            candidateFingerprint: "legacy-fingerprint",
            status: "ready",
            counts: { recommended: 1, needsAttention: 0, alternative: 0 },
            gaps: [],
            createdAt: 1,
        });
        await ctx.db.insert("sourceSelectionProposalItems", {
            runId,
            corpusRevisionId,
            proposalId,
            sourceId,
            disposition: "recommended",
            sourceFamily: "regulatory",
            documentKind: "regulatory_annual",
            authorityTier: "regulator_primary",
            coverageContributions: ["regulatory_annual"],
            rank: 0,
            reasonCodes: ["required_coverage_role"],
            createdAt: 1,
        });
        const decisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId,
            sourceId,
            decisionKey: "legacy-proposal-pending",
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
        await ctx.db.patch(corpusRevisionId, {
            sourceSelectionProposalId: proposalId,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });
        return { userId, runId, corpusRevisionId };
    });
    const owner = t.withIdentity({
        subject: `${fixture.userId}|legacy-proposal-session`,
    });

    await expect(
        owner.query(listItemsPage, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            disposition: "recommended",
            paginationOpts: { numItems: 10, cursor: null },
        }),
    ).resolves.toMatchObject({
        page: [
            expect.objectContaining({
                companyLinkageBasis: "not_evaluated",
                recommendationContributions: [],
                declaredCoverageRoles: [],
                eligibleCoverageRoles: [],
            }),
        ],
    });
});

test("projects recommendation pages and adjustment sets through analyst decisions", async () => {
    process.env.SOURCE_RECOMMENDATION_CEILING = "2";
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
        const companyId = await ctx.db.insert("companies", {
            cik: "1373715",
            legalName: "ServiceNow, Inc.",
            ticker: "NOW",
            exchange: "NYSE",
            websiteUrl: "https://www.servicenow.com/",
            canonicalizedAt: 1,
        });
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            ownerVisitorId: visitorId,
            companyId,
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
        const candidates = [
            {
                canonicalUrl:
                    "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000001/now-20251231.htm",
                title: "ServiceNow annual report",
                origin: "sec" as const,
                category: "regulatory",
                secForm: "10-K",
            },
            {
                canonicalUrl:
                    "https://www.reuters.com/technology/servicenow-workflow-risk",
                title: "ServiceNow workflow migration risks",
                origin: "exa" as const,
                category: "counter_evidence",
            },
            {
                canonicalUrl: "https://www.morningstar.com/workflow-analysis",
                title: "Independent ServiceNow workflow analysis",
                origin: "exa" as const,
                category: "independent_analysis",
            },
        ];
        for (const [index, candidate] of candidates.entries()) {
            const sourceId = await ctx.db.insert("sources", {
                runId,
                ...candidate,
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

    process.env.SOURCE_RECOMMENDATION_CEILING = "3";
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
        const adminVisitorId = await ctx.db.insert("visitors", {
            authUserId: adminUserId,
            invitationId,
            role: "admin",
            status: "active",
            analysesReserved: 0,
            admittedAt: 1,
        });
        await ctx.db.patch(invitationId, {
            claimedByVisitorId: adminVisitorId,
        });
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
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

const startNewCorpusRevision = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
    },
    {
        corpusRevisionId: Id<"corpusRevisions">;
        proposalId: Id<"sourceSelectionProposals">;
    }
>("sourceSelectionProposals:startNewCorpusRevision");

test("creates a new draft revision and reopens the source checkpoint", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "new-revision-owner",
            role: "analyst",
            codeDigest: "new-revision-digest",
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
        const companyId = await ctx.db.insert("companies", {
            cik: "1373715",
            legalName: "ServiceNow, Inc.",
            ticker: "NOW",
            exchange: "NYSE",
            websiteUrl: "https://www.servicenow.com/",
            canonicalizedAt: 1,
        });
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            ownerVisitorId: visitorId,
            companyId,
            coveragePreset: "balanced",
            lifecycleState: "corpus_approved",
            executionStatus: "idle",
            executionGeneration: 3,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 1,
        });
        const revisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "approved",
            approvedByVisitorId: visitorId,
            approvedAt: 2,
            createdAt: 1,
        });
        await ctx.db.insert("sources", {
            runId,
            canonicalUrl:
                "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000001/now-20251231.htm",
            title: "10-K",
            origin: "sec",
            category: "regulatory",
            secForm: "10-K",
            createdAt: 1,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: revisionId });
        return { userId, runId, revisionId };
    });

    const owner = t.withIdentity({
        subject: `${fixture.userId}|new-revision-session`,
    });
    const result = await owner.mutation(startNewCorpusRevision, {
        runId: fixture.runId,
        corpusRevisionId: fixture.revisionId,
    });

    expect(result.corpusRevisionId).not.toBe(fixture.revisionId);

    const run = await t.run((ctx) => ctx.db.get(fixture.runId));
    expect(run?.activeCorpusRevisionId).toBe(result.corpusRevisionId);
    expect(run?.lifecycleState).toBe("awaiting_source_review");
    expect(run?.executionStatus).toBe("paused");
    expect(run?.executionGeneration).toBe(4);

    const newRevision = await t.run((ctx) =>
        ctx.db.get(result.corpusRevisionId),
    );
    expect(newRevision?.status).toBe("draft");
    expect(newRevision?.revision).toBe(2);

    const proposal = await t.run((ctx) => ctx.db.get(result.proposalId));
    expect(proposal?.corpusRevisionId).toBe(result.corpusRevisionId);
    expect(proposal?.version).toBe(1);
    expect(proposal?.policyVersion).toBe("source-selection-v14");
});

test("rejects starting a new revision when the current corpus is not approved", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "new-revision-denied",
            role: "analyst",
            codeDigest: "new-revision-denied-digest",
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
        const companyId = await ctx.db.insert("companies", {
            cik: "1373715",
            legalName: "ServiceNow, Inc.",
            ticker: "NOW",
            exchange: "NYSE",
            websiteUrl: "https://www.servicenow.com/",
            canonicalizedAt: 1,
        });
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            ownerVisitorId: visitorId,
            companyId,
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
        return { userId, runId, revisionId };
    });

    const owner = t.withIdentity({
        subject: `${fixture.userId}|denied-session`,
    });
    await expect(
        owner.mutation(startNewCorpusRevision, {
            runId: fixture.runId,
            corpusRevisionId: fixture.revisionId,
        }),
    ).rejects.toThrow(
        "Current corpus revision must be approved before starting a new one",
    );
});

test("rejects an unauthorized visitor", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
        const ownerUserId = await ctx.db.insert("users", {
            isAnonymous: true,
        });
        const ownerInvitation = await ctx.db.insert("invitations", {
            slotKey: "new-revision-owner-only",
            role: "analyst",
            codeDigest: "new-revision-owner-digest",
            status: "claimed",
            createdAt: 1,
        });
        const ownerVisitorId = await ctx.db.insert("visitors", {
            authUserId: ownerUserId,
            invitationId: ownerInvitation,
            role: "analyst",
            status: "active",
            analysesReserved: 1,
            admittedAt: 1,
        });
        const companyId = await ctx.db.insert("companies", {
            cik: "1373715",
            legalName: "ServiceNow, Inc.",
            ticker: "NOW",
            exchange: "NYSE",
            websiteUrl: "https://www.servicenow.com/",
            canonicalizedAt: 1,
        });
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            ownerVisitorId: ownerVisitorId,
            companyId,
            coveragePreset: "balanced",
            lifecycleState: "corpus_approved",
            executionStatus: "idle",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 1,
        });
        const revisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "approved",
            createdAt: 1,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: revisionId });

        const intruderUserId = await ctx.db.insert("users", {
            isAnonymous: true,
        });
        const intruderInvitation = await ctx.db.insert("invitations", {
            slotKey: "intruder",
            role: "analyst",
            codeDigest: "intruder-digest",
            status: "claimed",
            createdAt: 1,
        });
        await ctx.db.insert("visitors", {
            authUserId: intruderUserId,
            invitationId: intruderInvitation,
            role: "analyst",
            status: "active",
            analysesReserved: 1,
            admittedAt: 1,
        });
        return { intruderUserId, runId, revisionId };
    });

    const intruder = t.withIdentity({
        subject: `${fixture.intruderUserId}|intruder-session`,
    });
    await expect(
        intruder.mutation(startNewCorpusRevision, {
            runId: fixture.runId,
            corpusRevisionId: fixture.revisionId,
        }),
    ).rejects.toThrow("Unauthorized");
});
