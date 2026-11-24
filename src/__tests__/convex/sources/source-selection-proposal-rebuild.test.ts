import { api } from "@convex/_generated/api";
import { SOURCE_SELECTION_POLICY_VERSION } from "@convex/domain/sourceSelectionPolicy";
import schema from "@convex/schema";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";

import rateLimiterTest from "../integrations/rate-limiter-test-register.js";

const modules = import.meta.glob("/convex/**/*.ts");
const originalSecUserAgent = process.env.SEC_USER_AGENT;
const originalExaKey = process.env.EXA_API_KEY;

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    if (originalSecUserAgent === undefined) delete process.env.SEC_USER_AGENT;
    else process.env.SEC_USER_AGENT = originalSecUserAgent;
    if (originalExaKey === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = originalExaKey;
});

async function seedDraft(existing?: TestConvex<typeof schema>) {
    const t = existing ?? convexTest(schema, modules);
    if (!existing) rateLimiterTest.register(t);
    const fixture = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: `rebuild-owner:${userId}`,
            role: "analyst",
            codeDigest: "rebuild-digest",
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
            executionGeneration: 4,
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
            canonicalUrl: "https://www.servicenow.com/products.html",
            title: "Products",
            origin: "exa",
            category: "official_product",
            createdAt: 1,
        });
        const decisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId,
            sourceId,
            decisionKey: "accepted-before-rebuild",
            decision: "accepted",
            reviewerVisitorId: visitorId,
            occurredAt: 2,
        });
        await ctx.db.insert("sourceReviewItems", {
            runId,
            corpusRevisionId,
            sourceId,
            decision: "accepted",
            decisionRank: 0,
            sourceCreatedAt: 1,
            latestDecisionId: decisionId,
            decisionOccurredAt: 2,
        });
        const proposalId = await ctx.db.insert("sourceSelectionProposals", {
            runId,
            corpusRevisionId,
            version: 1,
            policyVersion: "source-selection-v1",
            coveragePreset: "balanced",
            recommendedTarget: 12,
            candidateFingerprint: "legacy",
            status: "ready",
            counts: { recommended: 1, needsAttention: 0, alternative: 0 },
            gaps: [],
            createdAt: 2,
        });
        await ctx.db.patch(corpusRevisionId, {
            sourceSelectionProposalId: proposalId,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: corpusRevisionId });
        return { userId, runId, corpusRevisionId, proposalId, sourceId };
    });
    return { t, fixture };
}

test("coverage follows effective source decisions without rewriting the proposal", async () => {
    const { t, fixture } = await seedDraft();
    await t.run(async (ctx) => {
        await ctx.db.patch(fixture.sourceId, {
            origin: "sec",
            canonicalUrl:
                "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000001/now-20251231.htm",
            secForm: "10-K",
            secAccessionNumber: "0001373715-26-000001",
        });
        await ctx.db.patch(fixture.proposalId, {
            policyVersion: SOURCE_SELECTION_POLICY_VERSION,
        });
    });
    const owner = t.withIdentity({
        subject: `${fixture.userId}|coverage-session`,
    });
    const args = {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
    };
    const proposal = await owner.mutation(
        api.sourceSelectionProposals.recompute,
        {
            ...args,
            expectedProposalId: fixture.proposalId,
        },
    );
    const before = await owner.query(
        api.sourceSelectionProposals.getCurrent,
        args,
    );
    expect(before?.coverageGaps).not.toContain("regulatory_annual");
    await owner.mutation(api.sources.decide, {
        ...args,
        sourceId: fixture.sourceId,
        decision: "rejected",
        decisionKey: "remove-annual",
    });
    const after = await owner.query(
        api.sourceSelectionProposals.getCurrent,
        args,
    );
    expect(after?.coverageGaps).toContain("regulatory_annual");
    expect(after?.proposalId).toBe(proposal.proposalId);
    await owner.mutation(api.sources.decide, {
        ...args,
        sourceId: fixture.sourceId,
        decision: "accepted",
        decisionKey: "restore-annual",
    });
    expect(
        (await owner.query(api.sourceSelectionProposals.getCurrent, args))
            ?.coverageGaps,
    ).not.toContain("regulatory_annual");
});

async function seedRecoverableDraft(existing?: TestConvex<typeof schema>) {
    const { t, fixture } = await seedDraft(existing);
    const owner = t.withIdentity({
        subject: `${fixture.userId}|recovery-session`,
    });
    await t.run((ctx) =>
        ctx.db.patch(fixture.proposalId, {
            policyVersion: SOURCE_SELECTION_POLICY_VERSION,
        }),
    );
    const current = await owner.mutation(
        api.sourceSelectionProposals.recompute,
        {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            expectedProposalId: fixture.proposalId,
        },
    );
    await t.run((ctx) =>
        ctx.db.patch(current.proposalId, {
            rebuildOutcome: "partial",
            failedDiscoveryFamilies: ["official_product"],
        }),
    );
    return {
        t,
        fixture: { ...fixture, proposalId: current.proposalId },
        owner,
    };
}

test("refreshing a proposal preserves unresolved discovery warnings", async () => {
    const { fixture, owner } = await seedRecoverableDraft();
    await owner.mutation(api.sourceSelectionProposals.recompute, {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        expectedProposalId: fixture.proposalId,
    });
    expect(
        await owner.query(api.sourceSelectionProposals.getCurrent, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
        }),
    ).toMatchObject({
        rebuildOutcome: "partial",
        failedDiscoveryFamilies: ["official_product"],
    });
});

test("manual inclusion does not manufacture automatic coverage", async () => {
    const { t, fixture, owner } = await seedRecoverableDraft();
    await t.run((ctx) =>
        ctx.db.patch(fixture.sourceId, { origin: "analyst_url" }),
    );
    await owner.mutation(api.sourceSelectionProposals.recompute, {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        expectedProposalId: fixture.proposalId,
    });
    const current = await owner.query(api.sourceSelectionProposals.getCurrent, {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
    });
    expect(current?.effectiveIncludedCount).toBe(1);
    expect(current?.coverageGaps).toContain("official_product_platform");
});
