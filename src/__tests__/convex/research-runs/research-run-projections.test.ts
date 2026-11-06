import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

const modules = import.meta.glob("/convex/**/*.ts");
const getMine = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns"> },
    unknown
>("researchRuns:getMine");

test("projects only the current visitor runs with canonical company data", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const fixture = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const otherUserId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "analyst-projection",
            role: "analyst",
            codeDigest: "projection",
            status: "claimed",
            createdAt: 1,
        });
        const otherInvitationId = await ctx.db.insert("invitations", {
            slotKey: "other-projection",
            role: "analyst",
            codeDigest: "other-projection",
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
        const otherVisitorId = await ctx.db.insert("visitors", {
            authUserId: otherUserId,
            invitationId: otherInvitationId,
            role: "analyst",
            status: "active",
            analysesReserved: 1,
            admittedAt: 1,
        });
        const companyId = await ctx.db.insert("companies", {
            cik: "1818201",
            legalName: "CCC Intelligent Solutions Holdings Inc.",
            ticker: "CCCS",
            exchange: "NASDAQ",
            websiteUrl: "https://cccis.com/",
            websiteUrlSource: "exa",
            canonicalizedAt: 1,
        });
        const runId = await ctx.db.insert("researchRuns", {
            purpose: "research",
            ownerVisitorId: visitorId,
            companyId,
            companySnapshot: {
                cik: "1818201",
                legalName: "CCC Intelligent Solutions Holdings Inc.",
                ticker: "CCCS",
                exchange: "NASDAQ",
                websiteUrl: "https://old.example/",
            },
            reservationKey: "mine",
            reservationStatus: "consumed",
            executionGeneration: 1,
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 2,
        });
        await ctx.db.insert("researchRuns", {
            purpose: "research",
            ownerVisitorId: otherVisitorId,
            companyId,
            reservationKey: "other",
            reservationStatus: "consumed",
            executionGeneration: 1,
            lifecycleState: "checking_public_evidence",
            executionStatus: "running",
            nextEventSequence: 1,
            createdAt: 1,
            updatedAt: 3,
        });
        for (let index = 0; index < 80; index++) {
            await ctx.db.insert("providerCalls", {
                runId,
                service: "exa",
                operation: "search",
                operationKey: `success-${index}`,
                status: "succeeded",
                attempt: 1,
                createdAt: 200 + index,
            });
        }
        for (const [index, createdAt] of [
            5, 10, 10, 10, 10, 10, 10, 20, 30, 40, 50,
        ].entries()) {
            await ctx.db.insert("providerCalls", {
                runId,
                service: "exa",
                operation: `failure-${index}`,
                operationKey: `failure-${index}`,
                status: "failed",
                attempt: 1,
                createdAt,
            });
        }
        for (let index = 0; index < 80; index++) {
            await ctx.db.insert("providerCalls", {
                runId,
                service: "exa",
                operation: `old-failure-${index}`,
                operationKey: `old-failure-${index}`,
                status: "failed",
                attempt: 1,
                createdAt: -100 - index,
            });
        }
        return { userId, runId };
    });
    const analyst = t.withIdentity({
        subject: `${fixture.userId}|projection-session`,
    });

    await expect(
        analyst.query(getMine, { runId: fixture.runId }),
    ).resolves.toMatchObject({
        runId: fixture.runId,
        company: {
            legalName: "CCC Intelligent Solutions Holdings Inc.",
            ticker: "CCCS",
            websiteUrl: "https://cccis.com/",
        },
        lifecycleState: "awaiting_source_review",
        executionStatus: "paused",
    });
    const measured = await analyst.run(async (ctx) => {
        const value = await ctx.runQuery(api.researchRuns.getMine, {
            runId: fixture.runId,
        });
        return { value, metrics: await ctx.meta.getTransactionMetrics() };
    });
    expect(measured.metrics.documentsRead.used).toBeLessThanOrEqual(30);
    expect(
        measured.value.providerFailures.map((failure) => failure.operation),
    ).toEqual([
        "failure-10",
        "failure-9",
        "failure-8",
        "failure-7",
        "failure-1",
    ]);
    const visitor = await analyst.query(api.visitors.current, {});
    if (!visitor?.workspace) throw new Error("Expected admitted workspace");
    await expect(
        analyst.query(api.researchRuns.listMine, {
            workspaceKey: visitor.workspace.key,
            paginationOpts: { numItems: 12, cursor: null },
        }),
    ).resolves.toMatchObject({
        page: [expect.objectContaining({ runId: fixture.runId })],
    });
});
