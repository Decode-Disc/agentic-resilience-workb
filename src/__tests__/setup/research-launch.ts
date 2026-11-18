import type { Id } from "@convex/_generated/dataModel";
import type { convexTest } from "convex-test";

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
