import type { Id } from "./_generated/dataModel";
import { env, type QueryCtx } from "./_generated/server";
import { BROWSER_TEST_SLOT } from "./domain/browserFixtureAccess";
export async function ownedCampaign(
    ctx: QueryCtx,
    campaignId: Id<"qualificationCampaigns">,
) {
    // Status and cleanup remain available after temporary fixture flags are restored.
    let hostname: string;
    try {
        hostname = new URL(env.CONVEX_CLOUD_URL).hostname;
    } catch {
        throw new Error("Local campaign configuration invalid");
    }
    if (!["localhost", "127.0.0.1"].includes(hostname))
        throw new Error("Local campaign required");
    const campaign = await ctx.db.get(campaignId);
    const invitation = await ctx.db
        .query("invitations")
        .withIndex("by_slot_key", (q) => q.eq("slotKey", BROWSER_TEST_SLOT))
        .unique();
    const owner = campaign ? await ctx.db.get(campaign.ownerVisitorId) : null;
    if (
        !campaign ||
        invitation?.claimedByVisitorId !== owner?._id ||
        owner?.status !== "active"
    )
        throw new Error("Campaign owner unavailable");
    return campaign;
}
export async function requireCampaignLot(
    ctx: QueryCtx,
    lotId: Id<"qualificationLots">,
) {
    const lot = await ctx.db.get(lotId);
    if (!lot) throw new Error("Campaign lot unavailable");
    const campaign = await ownedCampaign(ctx, lot.campaignId);
    if (
        campaign.status !== "active" ||
        campaign.manifest.expiresAt <= Date.now() ||
        campaign.activeLotId !== lotId ||
        lot.status !== "running"
    )
        throw new Error("Campaign lot is not active");
    return { lot, campaign };
}
