import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test } from "vitest";
import rateLimiterTest from "../integrations/rate-limiter-test-register.js";

const modules = import.meta.glob("/convex/**/*.ts");
const originalSourceCandidateLimit = process.env.SOURCE_CANDIDATE_LIMIT;

afterEach(() => {
    if (originalSourceCandidateLimit === undefined) {
        delete process.env.SOURCE_CANDIDATE_LIMIT;
    } else {
        process.env.SOURCE_CANDIDATE_LIMIT = originalSourceCandidateLimit;
    }
});
const getReviewSummary = makeFunctionReference<
    "query",
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
    },
    {
        revision: number;
        status: "draft" | "approved";
        counts: { accepted: number; rejected: number; pending: number };
        total: number;
        candidateLimit: number;
    }
>("sources:getReviewSummary");
const listForReviewPage = makeFunctionReference<
    "query",
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        filter: "all" | "accepted" | "rejected" | "pending";
        paginationOpts: { numItems: number; cursor: string | null };
    },
    {
        page: Array<{
            sourceId: Id<"sources">;
            decision: "accepted" | "rejected" | "pending";
        }>;
        isDone: boolean;
        continueCursor: string;
    }
>("sources:listForReviewPage");
const decideSource = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        sourceId: Id<"sources">;
        decision: "accepted" | "rejected" | "pending";
        decisionKey: string;
        reason?: string;
    },
    { accepted: boolean }
>("sources:decide");
const submitManualUrl = makeFunctionReference<
    "action",
    {
        requestKey: string;
        url: string;
        target: {
            kind: "run";
            runId: Id<"researchRuns">;
            corpusRevisionId: Id<"corpusRevisions">;
        };
    },
    {
        kind: "persisted";
        sourceId: Id<"sources">;
        canonicalUrl: string;
        title: string;
    }
>("sourceActions:submitManualUrl");
const persistManualCandidate = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        executionGeneration: number;
        providerReference: string;
        canonicalUrl: string;
        title: string;
    },
    Id<"sources">
>("sources:persistManualCandidate");
const approveCorpus = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        decisionKey: string;
    },
    { accepted: boolean }
>("sources:approveCorpusRevision");
const backfillSourceReviewProjection = makeFunctionReference<
    "mutation",
    { paginationOpts: { numItems: number; cursor: string | null } },
    {
        page: Array<{
            revisionId: Id<"corpusRevisions">;
            sourceTotal: number;
            projectionTotal: number;
        }>;
        isDone: boolean;
        continueCursor: string;
    }
>("adminOperations:backfillSourceReviewProjection");

async function createSourceReviewFixture(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const otherUserId = await ctx.db.insert("users", {
            isAnonymous: true,
        });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-1",
            role: "analyst",
            codeDigest: "source-review-digest",
            status: "claimed",
            createdAt: 1,
        });
        const otherInvitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-2",
            role: "analyst",
            codeDigest: "other-source-review-digest",
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
        await ctx.db.insert("visitors", {
            authUserId: otherUserId,
            invitationId: otherInvitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 0,
            admittedAt: 1,
        });
        const runId = await ctx.db.insert("researchRuns", {
            ownerVisitorId: visitorId,
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
            executionGeneration: 1,
            workflowId: "paused-workflow",
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
            canonicalUrl: "https://example.com/report",
            title: "Public report",
            origin: "exa",
            category: "independent_analysis",
            createdAt: 1,
        });
        const decisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId,
            sourceId,
            decisionKey: "initial-pending",
            decision: "pending",
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
        return {
            userId,
            otherUserId,
            runId,
            corpusRevisionId,
            sourceId,
        };
    });
}

test("owner appends source decisions while other visitors are rejected", async () => {
    const t = convexTest(schema, modules);
    const fixture = await createSourceReviewFixture(t);
    const owner = t.withIdentity({
        subject: `${fixture.userId}|source-owner`,
    });
    const other = t.withIdentity({
        subject: `${fixture.otherUserId}|source-other`,
    });

    await expect(
        other.query(getReviewSummary, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
        }),
    ).rejects.toThrow("Unauthorized");
    await expect(
        owner.mutation(decideSource, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            sourceId: fixture.sourceId,
            decision: "accepted",
            decisionKey: "accept-report",
        }),
    ).resolves.toEqual({ accepted: true });
    await expect(
        owner.query(getReviewSummary, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
        }),
    ).resolves.toMatchObject({
        counts: { accepted: 1, rejected: 0, pending: 0 },
        total: 1,
        candidateLimit: 48,
    });
    await expect(
        owner.query(listForReviewPage, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            filter: "accepted",
            paginationOpts: { numItems: 12, cursor: null },
        }),
    ).resolves.toMatchObject({
        page: [
            {
                sourceId: fixture.sourceId,
                decision: "accepted",
            },
        ],
        isDone: true,
    });
});

test("rejects manual URL intake before network access for a non-owner", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    const fixture = await createSourceReviewFixture(t);
    const other = t.withIdentity({
        subject: `${fixture.otherUserId}|source-other`,
    });

    await expect(
        other.action(submitManualUrl, {
            requestKey: "non-owner-manual-source",
            url: "https://127.0.0.1/private",
            target: {
                kind: "run",
                runId: fixture.runId,
                corpusRevisionId: fixture.corpusRevisionId,
            },
        }),
    ).rejects.toMatchObject({
        data: {
            code: "not_authorized",
            retryable: false,
        },
    });
});

test("paginates the all view by pending, accepted, then rejected groups", async () => {
    const t = convexTest(schema, modules);
    const fixture = await createSourceReviewFixture(t);
    const { acceptedSourceId, rejectedSourceId } = await t.run(async (ctx) => {
        const addProjectedSource = async (
            decision: "accepted" | "rejected",
            suffix: string,
        ) => {
            const sourceId = await ctx.db.insert("sources", {
                runId: fixture.runId,
                canonicalUrl: `https://example.com/${suffix}`,
                title: `${decision} source`,
                origin: "exa",
                category: "independent_analysis",
                createdAt: 0,
            });
            const decisionId = await ctx.db.insert("sourceDecisions", {
                runId: fixture.runId,
                corpusRevisionId: fixture.corpusRevisionId,
                sourceId,
                decisionKey: `${decision}-${suffix}`,
                decision,
                occurredAt: 1,
            });
            await ctx.db.insert("sourceReviewItems", {
                runId: fixture.runId,
                corpusRevisionId: fixture.corpusRevisionId,
                sourceId,
                decision,
                decisionRank: decision === "accepted" ? 1 : 2,
                sourceCreatedAt: 0,
                latestDecisionId: decisionId,
                decisionOccurredAt: 1,
            });
            return sourceId;
        };
        return {
            acceptedSourceId: await addProjectedSource("accepted", "accepted"),
            rejectedSourceId: await addProjectedSource("rejected", "rejected"),
        };
    });
    const owner = t.withIdentity({
        subject: `${fixture.userId}|source-owner`,
    });

    const first = await owner.query(listForReviewPage, {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        filter: "all",
        paginationOpts: { numItems: 1, cursor: null },
    });
    const second = await owner.query(listForReviewPage, {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        filter: "all",
        paginationOpts: { numItems: 1, cursor: first.continueCursor },
    });
    const third = await owner.query(listForReviewPage, {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        filter: "all",
        paginationOpts: { numItems: 1, cursor: second.continueCursor },
    });

    expect(first.page[0]?.sourceId).toBe(fixture.sourceId);
    expect(second.page[0]?.sourceId).toBe(acceptedSourceId);
    expect(third.page[0]?.sourceId).toBe(rejectedSourceId);
});

test("rejects a manual URL before inspection when the dossier is at capacity", async () => {
    process.env.SOURCE_CANDIDATE_LIMIT = "1";
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    const fixture = await createSourceReviewFixture(t);
    const owner = t.withIdentity({
        subject: `${fixture.userId}|source-owner`,
    });

    await expect(
        owner.action(submitManualUrl, {
            requestKey: "capacity-manual-source",
            url: "https://example.com/never-inspected",
            target: {
                kind: "run",
                runId: fixture.runId,
                corpusRevisionId: fixture.corpusRevisionId,
            },
        }),
    ).rejects.toMatchObject({
        data: {
            code: "candidate_limit",
            retryable: false,
        },
    });
});

test("rejects duplicate and stale manual candidates without inserting source state", async () => {
    const t = convexTest(schema, modules);
    const fixture = await createSourceReviewFixture(t);
    const owner = t.withIdentity({
        subject: `${fixture.userId}|source-owner`,
    });

    await expect(
        owner.mutation(persistManualCandidate, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            executionGeneration: 1,
            providerReference: "url_metadata:duplicate",
            canonicalUrl: "https://example.com/report",
            title: "Duplicate report",
        }),
    ).rejects.toMatchObject({
        data: { code: "duplicate_source", retryable: false },
    });
    await expect(
        owner.mutation(persistManualCandidate, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            executionGeneration: 0,
            providerReference: "url_metadata:stale",
            canonicalUrl: "https://example.com/stale-report",
            title: "Stale report",
        }),
    ).rejects.toMatchObject({
        data: { code: "stale_execution", retryable: false },
    });

    await expect(
        t.run(async (ctx) => ({
            sources: await ctx.db.query("sources").collect(),
            decisions: await ctx.db.query("sourceDecisions").collect(),
            reviewItems: await ctx.db.query("sourceReviewItems").collect(),
        })),
    ).resolves.toMatchObject({
        sources: [expect.objectContaining({ _id: fixture.sourceId })],
        decisions: [expect.objectContaining({ sourceId: fixture.sourceId })],
        reviewItems: [expect.objectContaining({ sourceId: fixture.sourceId })],
    });
});

test("does not resume source review while another owner run is running", async () => {
    const t = convexTest(schema, modules);
    const fixture = await createSourceReviewFixture(t);
    const owner = t.withIdentity({
        subject: `${fixture.userId}|source-owner`,
    });

    await owner.mutation(decideSource, {
        runId: fixture.runId,
        corpusRevisionId: fixture.corpusRevisionId,
        sourceId: fixture.sourceId,
        decision: "accepted",
        decisionKey: "accept-before-conflict",
    });
    await t.run(async (ctx) => {
        const paused = await ctx.db.get(fixture.runId);
        if (!paused?.ownerVisitorId) {
            throw new Error("Fixture owner was not found");
        }
        await ctx.db.insert("researchRuns", {
            ownerVisitorId: paused.ownerVisitorId,
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            executionGeneration: 1,
            nextEventSequence: 1,
            createdAt: 2,
            updatedAt: 2,
        });
    });

    await expect(
        owner.mutation(approveCorpus, {
            runId: fixture.runId,
            corpusRevisionId: fixture.corpusRevisionId,
            decisionKey: "approve-with-conflict",
        }),
    ).rejects.toThrow("already running");
    await expect(
        t.run((ctx) => ctx.db.get(fixture.corpusRevisionId)),
    ).resolves.toMatchObject({ status: "draft" });
});

test("backfills the derived source review projection idempotently", async () => {
    const t = convexTest(schema, modules);
    const fixture = await createSourceReviewFixture(t);
    const adminUserId = await t.run(async (ctx) => {
        const existing = await ctx.db
            .query("sourceReviewItems")
            .withIndex("by_revision_and_source", (query) =>
                query
                    .eq("corpusRevisionId", fixture.corpusRevisionId)
                    .eq("sourceId", fixture.sourceId),
            )
            .unique();
        if (!existing) {
            throw new Error("Fixture projection missing");
        }
        await ctx.db.delete(existing._id);
        const adminUserId = await ctx.db.insert("users", {
            isAnonymous: true,
        });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "source-backfill-admin",
            role: "admin",
            codeDigest: "source-backfill-admin-digest",
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
        return adminUserId;
    });
    const admin = t.withIdentity({
        subject: `${adminUserId}|source-backfill`,
    });
    const args = { paginationOpts: { numItems: 10, cursor: null } };

    await expect(
        admin.mutation(backfillSourceReviewProjection, args),
    ).resolves.toMatchObject({
        page: [
            {
                revisionId: fixture.corpusRevisionId,
                sourceTotal: 1,
                projectionTotal: 1,
            },
        ],
    });
    await expect(
        admin.mutation(backfillSourceReviewProjection, args),
    ).resolves.toMatchObject({
        page: [
            {
                revisionId: fixture.corpusRevisionId,
                sourceTotal: 1,
                projectionTotal: 1,
            },
        ],
    });
});
