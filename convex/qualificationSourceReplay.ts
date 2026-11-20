import type { Id } from "@convex/_generated/dataModel";
import { internalQuery, type QueryCtx } from "@convex/_generated/server";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { sourcePreparationError } from "@convex/domain/sourcePreparationAuthority";
import {
    sourcesReplayContent,
    sourcesReplaySchema,
} from "@convex/qualificationCampaignPolicy";
import { requireCampaignLot } from "@convex/qualificationCampaigns";
import {
    localBrowserFixturesEnabled,
    requireBrowserTestRunOwner,
} from "@convex/runWorkspace";
import { v } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import type { z } from "zod";

/** Reads only the immutable corpus of the owning active local campaign; revoked replay never becomes live retrieval. */
export async function readSourcesReplay(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
) {
    const run = await ctx.db.get(runId);
    if (!run?.browserTestContextId) return null;
    const context = await ctx.db.get(run.browserTestContextId);
    const lot = context?.campaignLotId
        ? await ctx.db.get(context.campaignLotId)
        : null;
    const campaign = lot ? await ctx.db.get(lot.campaignId) : null;
    if (!context || !lot || !campaign || campaign.manifest.version === 1)
        return null;
    const binding = (
        context.paidQualification?.scenarios ?? context.simulatedScenarios
    )?.find((s) => s.runId === runId);
    const scenario = campaign.manifest.scenarios.find(
        (s) => s.id === binding?.id,
    );
    if (!scenario?.sourcesReplay) return null;
    if (
        !localBrowserFixturesEnabled() ||
        run.purpose !== "browser_test" ||
        run.withdrawnAt !== undefined ||
        context.status !== "active" ||
        context.expiresAt <= Date.now() ||
        context.ownerVisitorId !== run.ownerVisitorId ||
        lot.contextId !== context._id ||
        campaign.manifest.capability !== "sources"
    )
        throw sourcePreparationError("sources_replay_not_authorized");
    await requireCampaignLot(ctx, lot._id);
    await requireBrowserTestRunOwner(ctx, run);
    const replay = sourcesReplaySchema.parse(scenario.sourcesReplay);
    if (sha256Hex(sourcesReplayContent(replay)) !== replay.materialHash)
        throw sourcePreparationError("sources_replay_hash_mismatch");
    return replay;
}

export const read = internalQuery({
    args: { runId: v.id("researchRuns") },
    returns: v.union(zodToConvex(sourcesReplaySchema), v.null()),
    handler: (ctx, { runId }) => readSourcesReplay(ctx, runId),
});

/** Discovery and persistence share the exact metadata projection of the frozen corpus. */
export function sourcesReplayCandidates(
    replay: z.infer<typeof sourcesReplaySchema>,
) {
    return replay.documents.map((doc) => ({
        canonicalUrl: doc.url,
        title: doc.title,
        providerReference: `sources-replay:${replay.materialHash}`,
        ...(doc.publishedAt
            ? { publishedAt: Date.parse(doc.publishedAt) }
            : {}),
    }));
}
