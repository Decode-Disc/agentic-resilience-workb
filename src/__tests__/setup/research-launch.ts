import { type api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type schema from "@convex/schema";
import { workflow } from "@convex/workflow";
import type { FunctionArgs } from "convex/server";
import type { convexTest, TestConvex } from "convex-test";

export async function createAdmittedPreflight(
    t: ReturnType<typeof convexTest>,
    company = {
        cik: "1818201",
        legalName: "CCC Intelligent Solutions Holdings Inc.",
        ticker: "CCCS",
        exchange: "NASDAQ",
    },
): Promise<{
    userId: Id<"users">;
    preflightId: Id<"companyPreflights">;
}> {
    return t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-1",
            role: "analyst",
            codeDigest: "launch-test-digest",
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
        await ctx.db.patch(invitationId, { claimedByVisitorId: visitorId });
        const companyId = await ctx.db.insert("companies", {
            ...company,
            canonicalizedAt: Date.now(),
        });
        const preflightId = await ctx.db.insert("companyPreflights", {
            ownerVisitorId: visitorId,
            query: company.ticker,
            companyId,
            resolverVersion: "sec-company-v1",
            status: "resolved",
            expiresAt: Date.now() + 60_000,
            createdAt: Date.now(),
        });
        return { userId, preflightId };
    });
}

/** Seeds an already-admitted historical dossier and resumes its real registered workflow, without reopening retired admission. */
export async function seedHistoricalResearch(
    t: TestConvex<typeof schema>,
    args: Pick<
        FunctionArgs<typeof api.researchLaunch.confirmAndStart>,
        "preflightId" | "idempotencyKey" | "coveragePreset" | "researchAngle"
    >,
    prepareSources = false,
) {
    return t.run(async (ctx) => {
        const preflight = await ctx.db.get(args.preflightId);
        if (!preflight?.ownerVisitorId)
            throw new Error("Historical fixture needs an admitted preflight");
        const visitor = await ctx.db.get(preflight.ownerVisitorId);
        const company = await ctx.db.get(preflight.companyId);
        if (!visitor || !company)
            throw new Error(
                "Historical fixture ownership or company is missing",
            );
        const now = Date.now();
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            ownerVisitorId: visitor._id,
            reservationKey: args.idempotencyKey,
            reservationStatus: "consumed",
            companyId: company._id,
            companyPreflightId: preflight._id,
            companySnapshot: preflight.companySnapshot ?? {
                cik: company.cik,
                legalName: company.legalName,
                ticker: company.ticker,
                exchange: company.exchange,
                websiteUrl: company.websiteUrl,
                websiteUrlSource: company.websiteUrlSource,
                investorRelationsUrl: company.investorRelationsUrl,
            },
            coveragePreset: args.coveragePreset,
            researchAngle: args.researchAngle,
            lifecycleState: "draft",
            executionStatus: "running",
            executionGeneration: 1,
            nextEventSequence: 2,
            workflowVersion: 2,
            retryCount: 0,
            createdAt: now,
            updatedAt: now,
        });
        const corpusRevisionId = await ctx.db.insert("corpusRevisions", {
            runId,
            revision: 1,
            status: "draft",
            createdAt: now,
        });
        await ctx.db.patch(preflight._id, { status: "consumed" });
        await ctx.db.patch(visitor._id, {
            analysesReserved: visitor.analysesReserved + 1,
        });
        for (const [index, type] of (
            ["run_created", "company_confirmed"] as const
        ).entries()) {
            await ctx.db.insert("runEvents", {
                runId,
                sequence: index + 1,
                type,
                lifecycleState: "draft",
                executionStatus: "running",
                occurredAt: now,
            });
        }
        const workflowId = await workflow.start(
            ctx,
            internal.researchWorkflow.run,
            {
                runId,
                executionGeneration: 1,
                prepareSources,
            },
            {
                onComplete: internal.researchWorkflow.onComplete,
                context: { runId },
            },
        );
        await ctx.db.patch(runId, {
            activeCorpusRevisionId: corpusRevisionId,
            workflowId,
        });
        return { runId };
    });
}
