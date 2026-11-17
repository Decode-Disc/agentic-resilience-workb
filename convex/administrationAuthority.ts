import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/** Shared admission boundary for administrative reads and configuration changes. */
export async function requireAdmin(ctx: QueryCtx | MutationCtx) {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) throw new Error("Not authenticated");
    const visitor = await ctx.db
        .query("visitors")
        .withIndex("by_auth_user_id", (q) => q.eq("authUserId", authUserId))
        .unique();
    if (visitor?.status !== "active" || visitor.role !== "admin")
        throw new Error("Unauthorized");
    const invitation = await ctx.db.get(visitor.invitationId);
    if (
        invitation?.status !== "claimed" ||
        invitation.claimedByVisitorId !== visitor._id
    )
        throw new Error("Unauthorized");
    return visitor;
}
