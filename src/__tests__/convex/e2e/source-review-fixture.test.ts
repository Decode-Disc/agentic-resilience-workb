import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test } from "vitest";
import workflowTest from "../workflows/workflow-test-register.js";

const modules = import.meta.glob("/convex/**/*.ts");
const originalE2eFixturesEnabled = process.env.E2E_FIXTURES_ENABLED;

const seedSourceReviewScenario = makeFunctionReference<
    "mutation",
    { slotKey: string; fixtureKey: string },
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
    { fixtureKey: string },
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
        return { visitorId };
    });
}

test("rejects source review fixtures unless E2E mode is enabled", async () => {
    delete process.env.E2E_FIXTURES_ENABLED;
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    await createAdmittedVisitor(t);

    await expect(
        t.mutation(seedSourceReviewScenario, {
            slotKey: "e2e-analyst",
            fixtureKey: "disabled",
        }),
    ).rejects.toThrow("E2E fixtures are disabled");
    await expect(
        t.query(inspectSourceReviewScenario, { fixtureKey: "disabled" }),
    ).rejects.toThrow("E2E fixtures are disabled");
});

test("seeds an owned source review checkpoint through production projections", async () => {
    process.env.E2E_FIXTURES_ENABLED = "true";
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    const { visitorId } = await createAdmittedVisitor(t);

    const seeded = await t.mutation(seedSourceReviewScenario, {
        slotKey: "e2e-analyst",
        fixtureKey: "source-review-reactivity",
    });

    expect(seeded.sourceIds).toHaveLength(2);
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
        counts: { recommended: 2, needsAttention: 0, alternative: 0 },
    });
    expect(snapshot.proposalItems).toHaveLength(2);
    expect(snapshot.reviewItems).toHaveLength(2);
    expect(snapshot.reviewItems.map(({ decision }) => decision)).toEqual([
        "pending",
        "pending",
    ]);

    await expect(
        t.query(inspectSourceReviewScenario, {
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
        ],
        providerCallCount: 0,
    });
});
