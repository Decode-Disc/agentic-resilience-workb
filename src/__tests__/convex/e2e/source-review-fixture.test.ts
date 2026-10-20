import type { Id } from "@convex/_generated/dataModel";
import { api } from "@convex/_generated/api";
import "@convex/evidenceActions";
import "@convex/sourceSelectionProposalActions";
import { lookup } from "node:dns/promises";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import rateLimiterTest from "../integrations/rate-limiter-test-register.js";
import workflowTest from "../workflows/workflow-test-register.js";

const modules = import.meta.glob("/convex/**/*.ts");
const originalE2eFixturesEnabled = process.env.E2E_FIXTURES_ENABLED;

vi.mock("node:dns/promises", () => {
    const lookup = vi
        .fn()
        .mockRejectedValue(new Error("Fixture must not resolve DNS"));
    return { lookup, default: { lookup } };
});

const seedSourceReviewScenario = makeFunctionReference<
    "mutation",
    { slotKey: string; fixtureKey: string; recoveryScenario?: boolean },
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        proposalId: Id<"sourceSelectionProposals">;
        proposalVersion: number;
        sourceIds: Array<Id<"sources">>;
    }
>("e2eFixtures:seedSourceReviewScenario");

const inspectSourceReviewScenario = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns">; fixtureKey: string },
    {
        lifecycleState: string;
        executionStatus: string;
        revisionStatus: string;
        decisions: Array<{
            title: string;
            decision: "accepted" | "pending" | "rejected";
        }>;
        providerCallCount: number;
    }
>("e2eFixtures:inspectSourceReviewScenario");

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    if (originalE2eFixturesEnabled === undefined) {
        delete process.env.E2E_FIXTURES_ENABLED;
    } else {
        process.env.E2E_FIXTURES_ENABLED = originalE2eFixturesEnabled;
    }
});

async function createAdmittedVisitor(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "e2e-analyst",
            role: "analyst",
            codeDigest: "e2e-digest",
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
        await ctx.db.patch(invitationId, {
            claimedByVisitorId: visitorId,
            claimedAt: 1,
        });
        return { visitorId, userId };
    });
}

test("rejects source review fixtures unless E2E mode is enabled", async () => {
    process.env.E2E_FIXTURES_ENABLED = "true";
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    await createAdmittedVisitor(t);

    const seeded = await t.mutation(seedSourceReviewScenario, {
        slotKey: "e2e-analyst",
        fixtureKey: "disabled",
    });
    delete process.env.E2E_FIXTURES_ENABLED;

    await expect(
        t.mutation(seedSourceReviewScenario, {
            slotKey: "e2e-analyst",
            fixtureKey: "disabled",
        }),
    ).rejects.toThrow("E2E fixtures are disabled");
    await expect(
        t.query(inspectSourceReviewScenario, {
            runId: seeded.runId,
            fixtureKey: "disabled",
        }),
    ).rejects.toThrow("E2E fixtures are disabled");
});

test("source approval starts real extraction with explicit fixture failures and no provider I/O", async () => {
    vi.useFakeTimers();
    vi.stubEnv("E2E_FIXTURES_ENABLED", "true");
    vi.stubEnv("EXA_API_KEY", "");
    const fetchSpy = vi
        .fn()
        .mockRejectedValue(new Error("Fixture must not fetch"));
    vi.stubGlobal("fetch", fetchSpy);
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);
    const { userId } = await createAdmittedVisitor(t);
    const seeded = await t.mutation(seedSourceReviewScenario, {
        slotKey: "e2e-analyst",
        fixtureKey: "automatic-evidence-continuation",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t
        .withIdentity({ subject: `${userId}|fixture-session` })
        .mutation(api.sourceSelectionProposals.approveProposedCorpus, {
            runId: seeded.runId,
            corpusRevisionId: seeded.corpusRevisionId,
            proposalId: seeded.proposalId,
            proposalVersion: seeded.proposalVersion,
            decisionKey: "approve-fixture-once",
        });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const result = await t.query(inspectSourceReviewScenario, {
        runId: seeded.runId,
        fixtureKey: "automatic-evidence-continuation",
    });
    expect(result).toMatchObject({
        lifecycleState: "extracting_evidence",
        executionStatus: "failed",
        revisionStatus: "approved",
        providerCallCount: 0,
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    await t.run(async (ctx) => {
        const run = await ctx.db.get(seeded.runId);
        expect(run).toMatchObject({
            executionGeneration: 3,
            workflowVersion: 2,
        });
        const frozen = await ctx.db
            .query("evidenceSourceStatuses")
            .withIndex("by_run_and_execution_generation", (q) =>
                q.eq("runId", seeded.runId).eq("executionGeneration", 3),
            )
            .take(4);
        expect(frozen).toHaveLength(3);
        expect(
            frozen.every(
                (row) =>
                    row.status === "failed" &&
                    row.failureReason === "e2e_fixture_acquisition_unavailable",
            ),
        ).toBe(true);
        expect(await ctx.db.query("sourceVersions").take(1)).toEqual([]);
    });
});

test("seeds an owned source review checkpoint through production projections", async () => {
    process.env.E2E_FIXTURES_ENABLED = "true";
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    const { visitorId } = await createAdmittedVisitor(t);

    await t.run(async (ctx) => {
        const companyId = await ctx.db.insert("companies", {
            cik: "e2e-noise",
            legalName: "E2E Noise Company",
            ticker: "NOISE",
            exchange: "NASDAQ",
            canonicalizedAt: 1,
        });
        for (let index = 0; index < 101; index += 1) {
            await ctx.db.insert("researchRuns", {
                ownerVisitorId: visitorId,
                reservationKey: `e2e:noise-${index}`,
                reservationStatus: "consumed",
                companyId,
                companySnapshot: {
                    cik: "e2e-noise",
                    legalName: "E2E Noise Company",
                    ticker: "NOISE",
                    exchange: "NASDAQ",
                },
                coveragePreset: "balanced",
                lifecycleState: "draft",
                executionStatus: "idle",
                executionGeneration: 1,
                nextEventSequence: 1,
                workflowVersion: 1,
                createdAt: index + 1,
                updatedAt: index + 1,
            });
        }
    });

    const seeded = await t.mutation(seedSourceReviewScenario, {
        slotKey: "e2e-analyst",
        fixtureKey: "source-review-reactivity",
    });

    expect(seeded.sourceIds).toHaveLength(3);
    const snapshot = await t.run(async (ctx) => {
        const run = await ctx.db.get(seeded.runId);
        const revision = await ctx.db.get(seeded.corpusRevisionId);
        const proposal = await ctx.db.get(seeded.proposalId);
        const proposalItems = await ctx.db
            .query("sourceSelectionProposalItems")
            .withIndex("by_proposal_and_rank_and_source", (query) =>
                query.eq("proposalId", seeded.proposalId),
            )
            .collect();
        const reviewItems = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_queue", (query) =>
                query.eq("corpusRevisionId", seeded.corpusRevisionId),
            )
            .collect();
        return { run, revision, proposal, proposalItems, reviewItems };
    });

    expect(snapshot.run).toMatchObject({
        ownerVisitorId: visitorId,
        reservationKey: "e2e:source-review-reactivity",
        lifecycleState: "awaiting_source_review",
        executionStatus: "paused",
        pauseReason: "source_review",
        activeCorpusRevisionId: seeded.corpusRevisionId,
        workflowId: expect.any(String),
    });
    expect(snapshot.revision).toMatchObject({
        status: "draft",
        sourceSelectionProposalId: seeded.proposalId,
    });
    expect(snapshot.proposal).toMatchObject({
        status: "ready",
        version: seeded.proposalVersion,
        counts: { recommended: 3, needsAttention: 0, alternative: 0 },
    });
    expect(snapshot.proposalItems).toHaveLength(3);
    expect(snapshot.reviewItems).toHaveLength(3);
    expect(snapshot.reviewItems.map(({ decision }) => decision)).toEqual([
        "pending",
        "pending",
        "pending",
    ]);

    await expect(
        t.query(inspectSourceReviewScenario, {
            runId: seeded.runId,
            fixtureKey: "source-review-reactivity",
        }),
    ).resolves.toEqual({
        lifecycleState: "awaiting_source_review",
        executionStatus: "paused",
        revisionStatus: "draft",
        decisions: [
            { title: "Annual report", decision: "pending" },
            {
                title: "Product architecture overview",
                decision: "pending",
            },
            {
                title: "Reactive Systems Test Company analysis",
                decision: "pending",
            },
        ],
        providerCallCount: 0,
    });
});

test("source recovery fixture exercises capacity and reactive coverage without provider I/O", async () => {
    process.env.E2E_FIXTURES_ENABLED = "true";
    vi.stubEnv("SOURCE_CANDIDATE_LIMIT", "3");
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    rateLimiterTest.register(t);
    const { userId } = await createAdmittedVisitor(t);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const seeded = await t.mutation(seedSourceReviewScenario, {
        slotKey: "e2e-analyst",
        fixtureKey: "recovery-capacity",
        recoveryScenario: true,
    });
    expect(seeded.sourceIds).toHaveLength(3);
    const owner = t.withIdentity({ subject: `${userId}|fixture-session` });
    const args = {
        runId: seeded.runId,
        corpusRevisionId: seeded.corpusRevisionId,
    };
    const current = await owner.query(
        api.sourceSelectionProposals.getCurrent,
        args,
    );
    expect(current).toMatchObject({
        rebuildOutcome: "partial",
        failedDiscoveryFamilies: ["official_product"],
    });
    expect(current?.coverageGaps).not.toContain("official_product_platform");
    expect(
        await owner.action(
            api.sourceSelectionProposalActions.recoverDiscovery,
            {
                ...args,
                expectedProposalId: seeded.proposalId,
                requestId: "capacity-fixture",
                target: { kind: "failed_discovery" },
            },
        ),
    ).toMatchObject({ reason: "capacity_reached" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
        (
            await t.query(inspectSourceReviewScenario, {
                runId: seeded.runId,
                fixtureKey: "recovery-capacity",
            })
        ).providerCallCount,
    ).toBe(0);
});
