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
const listMine = makeFunctionReference<"query", Record<string, never>, unknown>(
    "researchRuns:listMine",
);

test("projects only the current visitor runs with canonical company data", async () => {
    const t = convexTest(schema, modules);
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
    await expect(analyst.query(listMine, {})).resolves.toEqual([
        expect.objectContaining({ runId: fixture.runId }),
    ]);
});
