import { ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
    localBrowserFixturesEnabled,
    requireBrowserTestRunOwner,
} from "./domain/browserFixtureAccess";
import { requireCampaignLot } from "./qualificationCampaignAccess";
import {
    RESOURCE_POLICY_VERSION,
    SOURCES_QUALIFICATION_RESEARCH_WINDOW_MS,
} from "./resourcePolicy";

async function readQualificationScope(ctx: QueryCtx, run: Doc<"researchRuns">) {
    if (run.purpose !== "browser_test" || !run.browserTestContextId)
        return null;
    const context = await ctx.db.get(run.browserTestContextId);
    const grant = context?.paidQualification;
    if (
        !context ||
        !grant ||
        context.ownerVisitorId !== run.ownerVisitorId ||
        !(grant.scenarios
            ? grant.scenarios.some((s) => s.runId === run._id)
            : grant.sourcesLot
              ? grant.sourcesLot.includes(run._id)
              : grant.runId === run._id)
    )
        return null;
    const lot = context.campaignLotId
        ? await ctx.db.get(context.campaignLotId)
        : null;
    const campaign = lot ? await ctx.db.get(lot.campaignId) : null;
    const durationMs =
        campaign && campaign.manifest.version !== 1
            ? campaign.manifest.researchDurationMs
            : undefined;
    const researchDeadlineAt =
        grant.sourcesLot && run.researchStartedAt !== undefined
            ? run.researchStartedAt +
              (durationMs ?? SOURCES_QUALIFICATION_RESEARCH_WINDOW_MS)
            : undefined;
    const deadlineAt = Math.min(
        context.expiresAt,
        context.campaignLotId ? (campaign?.manifest.expiresAt ?? 0) : Infinity,
        researchDeadlineAt ?? Infinity,
    );
    return {
        context,
        deadlineAt,
        campaignResearchDeadlineAt:
            durationMs !== undefined && researchDeadlineAt !== undefined
                ? deadlineAt
                : undefined,
    };
}

/** Factual bound, including expired grants. This projection never grants spending or progression authority. */
export async function readWorkbenchQualificationDeadline(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
) {
    return (await readQualificationScope(ctx, run))?.deadlineAt;
}

/** Original explicit campaign bound, including expiry; absence preserves legacy clocks. This does not authorize I/O. */
export async function readCampaignResearchDeadline(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
) {
    return (await readQualificationScope(ctx, run))?.campaignResearchDeadlineAt;
}

/** A fixture remains unpaid unless its active local context explicitly authorizes this framing dossier. */
export async function readWorkbenchQualification(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
) {
    if (
        !localBrowserFixturesEnabled() ||
        run.purpose !== "browser_test" ||
        !run.browserTestContextId ||
        run.withdrawnAt !== undefined
    )
        return null;
    const scope = await readQualificationScope(ctx, run);
    if (scope?.context.status !== "active" || scope.deadlineAt <= Date.now())
        return null;
    const { context } = scope;
    if (
        !context.paidQualification?.sourcesLot &&
        (run.lifecycleState !== "framing" ||
            run.researchStartedAt !== undefined ||
            run.executionStatus !== "idle")
    )
        return null;
    if (
        context.paidQualification?.resourcePolicy !== RESOURCE_POLICY_VERSION ||
        context.paidQualification.costAccountingPolicy !== "known_final_v1"
    )
        throw new ConvexError({
            area: "execution",
            code: "resource_policy_unsupported",
        });
    if (context.campaignLotId)
        await requireCampaignLot(ctx, context.campaignLotId);
    const visitor = await requireBrowserTestRunOwner(ctx, run);
    if (
        visitor._id !== context.ownerVisitorId ||
        visitor.authUserId !== context.authUserId
    )
        return null;
    return {
        ...context.paidQualification,
        deadlineAt: scope.deadlineAt,
    };
}

/** Fixed limits of the explicitly authorized local two-dossier Sources qualification. */
export const SOURCES_QUALIFICATION_ENVELOPE = {
    version: 1 as const,
    maxNeeds: 4,
    initialSearches: 2,
    complementSearches: 1,
    acquisitions: 6,
    controls: 8,
};
