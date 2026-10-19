import type { Id } from "@convex/_generated/dataModel";
import { internal } from "@convex/_generated/api";
import {
    extractPassagesFromNormalizedText,
    sha256Hex,
} from "@convex/domain/sourcePassages";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

const modules = import.meta.glob("/convex/**/*.ts");

const backfillPhase5Authority = makeFunctionReference<
    "mutation",
    { paginationOpts: { cursor: string | null; numItems: number } },
    {
        page: Array<{
            revisionId: string;
            questionsBackfilled: number;
            handleCleared: boolean;
            handleReviewRequired: boolean;
        }>;
        isDone: boolean;
        continueCursor: string | null;
    }
>("adminOperations:backfillPhase5Authority");

const listQuestionsForPlan = makeFunctionReference<
    "query",
    { planId: Id<"researchPlans"> },
    Array<{
        runId: string;
        researchPlanId: string;
        planVersion: number;
        questionKey: string;
        prompt: string;
        dimensionKeys: Array<string>;
        createdAt: number;
    }>
>("researchPlanning:listQuestionsForPlan");

async function createAdmin(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "admin",
            role: "admin",
            codeDigest: "phase-5-backfill",
            status: "claimed",
            createdAt: 1,
        });
        await ctx.db.insert("visitors", {
            authUserId: userId,
            invitationId,
            role: "admin",
            status: "active",
            analysesReserved: 0,
            admittedAt: 1,
        });
        return { userId };
    });
}

async function seedApprovedPlanWithoutQuestions(
    t: ReturnType<typeof convexTest>,
) {
    return t.run(async (ctx) => {
        const companyId = await ctx.db.insert("companies", {
            cik: "1373715",
            legalName: "ServiceNow, Inc.",
            ticker: "NOW",
            exchange: "NYSE",
            websiteUrl: "https://www.servicenow.com/",
            investorRelationsUrl: "https://investor.servicenow.com/",
            canonicalizedAt: 1,
        });
        const runId = await ctx.db.insert("researchRuns", {
            companyId,
            coveragePreset: "balanced",
            researchAngle: "agentic revenue",
            lifecycleState: "corpus_approved",
            executionStatus: "idle",
            executionGeneration: 2,
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 1,
        });
        const planId = await ctx.db.insert("researchPlans", {
            runId,
            version: 1,
            coveragePreset: "balanced",
            researchAngle: "agentic revenue",
            queries: [],
            createdAt: 1,
        });
        const revisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "approved",
            createdAt: 1,
        });
        await ctx.db.patch(runId, { activeCorpusRevisionId: revisionId });
        return { runId, planId, revisionId };
    });
}

test("only admins can run the Phase 5 authority backfill", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await createAdmin(t);
    const analystUserId = await t.run(async (ctx) =>
        ctx.db.insert("users", { isAnonymous: true }),
    );
    const analystInvitationId = await t.run(async (ctx) =>
        ctx.db.insert("invitations", {
            slotKey: "analyst",
            role: "analyst",
            codeDigest: "phase-5-backfill-analyst",
            status: "claimed",
            createdAt: 1,
        }),
    );
    await t.run(async (ctx) =>
        ctx.db.insert("visitors", {
            authUserId: analystUserId,
            invitationId: analystInvitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 0,
            admittedAt: 1,
        }),
    );
    const analyst = t.withIdentity({
        subject: `${analystUserId}|phase-5-backfill-analyst`,
    });

    await expect(
        analyst.mutation(backfillPhase5Authority, {
            paginationOpts: { cursor: null, numItems: 10 },
        }),
    ).rejects.toThrow("Unauthorized");

    const admin = t.withIdentity({ subject: `${userId}|phase-5-backfill` });
    await expect(
        admin.mutation(backfillPhase5Authority, {
            paginationOpts: { cursor: null, numItems: 10 },
        }),
    ).resolves.toMatchObject({ page: [], isDone: true });
});

test("retains unknown workflow handles for review", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await createAdmin(t);
    const admin = t.withIdentity({ subject: `${userId}|phase-5-backfill` });
    const { revisionId } = await seedApprovedPlanWithoutQuestions(t);
    await t.run(async (ctx) => {
        const revision = await ctx.db.get(revisionId);
        if (!revision) {
            throw new Error("Revision not found");
        }
        const run = await ctx.db.get(revision.runId);
        if (!run) {
            throw new Error("Run not found");
        }
        await ctx.db.patch(run._id, { workflowId: "not-a-real-workflow-id" });
    });

    const result = await admin.mutation(backfillPhase5Authority, {
        paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(result.page).toHaveLength(1);
    expect(result.page[0]).toMatchObject({
        revisionId,
        questionsBackfilled: expect.any(Number),
        handleCleared: false,
        handleReviewRequired: true,
    });
});

test("backfills stable questions for existing approved plans", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await createAdmin(t);
    const admin = t.withIdentity({ subject: `${userId}|phase-5-backfill` });
    const { runId, planId, revisionId } =
        await seedApprovedPlanWithoutQuestions(t);

    const first = await admin.mutation(backfillPhase5Authority, {
        paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(first.page).toHaveLength(1);
    const firstResult = first.page[0];
    expect(firstResult).toBeDefined();
    if (!firstResult) throw new Error("Expected firstResult");
    expect(firstResult).toMatchObject({
        revisionId,
        questionsBackfilled: expect.any(Number),
        handleCleared: false,
        handleReviewRequired: false,
    });
    expect(firstResult.questionsBackfilled).toBeGreaterThan(0);

    const questions = await t.query(listQuestionsForPlan, { planId });
    expect(questions).toHaveLength(firstResult.questionsBackfilled);
    for (const q of questions) {
        expect(q.runId).toBe(runId);
        expect(q.researchPlanId).toBe(planId);
        expect(q.planVersion).toBe(1);
        expect(Array.isArray(q.dimensionKeys)).toBe(true);
        expect(q.dimensionKeys.length).toBeGreaterThan(0);
    }
    const angleQuestion = questions.find(
        (q) => q.questionKey === "research-angle",
    );
    expect(angleQuestion?.prompt).toBe(
        "What public evidence addresses this research focus: agentic revenue?",
    );
    expect(angleQuestion?.dimensionKeys).toHaveLength(10);

    const second = await admin.mutation(backfillPhase5Authority, {
        paginationOpts: { cursor: null, numItems: 10 },
    });
    const secondResult = second.page[0];
    expect(secondResult).toBeDefined();
    expect(secondResult?.questionsBackfilled).toBe(0);
});

test("backfilled historical plans load reproducible claim input", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await createAdmin(t);
    const admin = t.withIdentity({ subject: `${userId}|phase-5-backfill` });
    const { runId, planId, revisionId } =
        await seedApprovedPlanWithoutQuestions(t);
    const originalPlan = await t.run((ctx) => ctx.db.get(planId));
    await t.run(async (ctx) => {
        await ctx.db.patch(runId, {
            researchAngle: "A later focus must not rewrite the plan",
        });
        const visitor = await ctx.db
            .query("visitors")
            .withIndex("by_auth_user_id", (q) => q.eq("authUserId", userId))
            .unique();
        if (!visitor) throw new Error("Missing admin");
        const canonicalUrl = "https://example.com/evidence";
        const sourceId = await ctx.db.insert("sources", {
            runId,
            canonicalUrl,
            title: "Evidence",
            origin: "exa",
            category: "official_product",
            createdAt: 1,
        });
        const decisionId = await ctx.db.insert("sourceDecisions", {
            runId,
            corpusRevisionId: revisionId,
            sourceId,
            decisionKey: "accepted",
            decision: "accepted",
            reviewerVisitorId: visitor._id,
            occurredAt: 1,
        });
        const text =
            "The platform connects company workflows through a documented public API.";
        const contentHash = sha256Hex(text);
        const storageId = await ctx.storage.store(new Blob([text]));
        const versionId = await ctx.db.insert("sourceVersions", {
            runId,
            corpusRevisionId: revisionId,
            sourceId,
            acceptedDecisionId: decisionId,
            contentHash,
            storageId,
            normalizerVersion: "fixture-v1",
            retrievalVersion: "fixture-v1",
            mediaType: "text/plain",
            byteCount: text.length,
            canonicalUrl,
            executionGeneration: 2,
            createdAt: 1,
        });
        for (const passage of extractPassagesFromNormalizedText({
            text,
            canonicalUrl,
            sourceVersionHash: contentHash,
        })) {
            await ctx.db.insert("sourcePassages", {
                sourceVersionId: versionId,
                ...passage,
                createdAt: 1,
            });
        }
        await ctx.db.insert("evidenceSourceStatuses", {
            runId,
            corpusRevisionId: revisionId,
            sourceId,
            acceptedDecisionId: decisionId,
            sourceVersionId: versionId,
            executionGeneration: 2,
            status: "succeeded",
            createdAt: 1,
            updatedAt: 1,
        });
    });
    await admin.mutation(backfillPhase5Authority, {
        paginationOpts: { cursor: null, numItems: 10 },
    });
    const input = await t.query(
        internal.claimGeneration.getNormalizedClaimInput,
        { runId, executionGeneration: 2 },
    );
    expect(input?.normalizedInput.passages).toHaveLength(1);
    expect(input?.normalizedInput.questions).toHaveLength(11);
    expect(
        input?.normalizedInput.questions.find(
            (q) => q.questionKey === "research-angle",
        )?.prompt,
    ).toBe(
        "What public evidence addresses this research focus: agentic revenue?",
    );
    expect(await t.run((ctx) => ctx.db.get(planId))).toEqual(originalPlan);
    const again = await admin.mutation(backfillPhase5Authority, {
        paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(again.page[0]?.questionsBackfilled).toBe(0);
});

test("reports existing question version mismatches without rewriting them", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await createAdmin(t);
    const admin = t.withIdentity({ subject: `${userId}|phase-5-backfill` });
    const { runId, planId } = await seedApprovedPlanWithoutQuestions(t);
    const questionId = await t.run((ctx) =>
        ctx.db.insert("researchPlanQuestions", {
            runId,
            researchPlanId: planId,
            planVersion: 2,
            questionKey: "dimension:context_ownership",
            prompt: "Historical question",
            dimensionKeys: ["context_ownership"],
            createdAt: 1,
        }),
    );
    const before = await t.run((ctx) => ctx.db.get(questionId));
    const result = await admin.mutation(backfillPhase5Authority, {
        paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(result.page[0]).toMatchObject({
        questionsBackfilled: 0,
        questionVersionReviewRequired: true,
    });
    expect(await t.run((ctx) => ctx.db.get(questionId))).toEqual(before);
});
