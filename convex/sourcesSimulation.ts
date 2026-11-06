import type { Doc, Id } from "@convex/_generated/dataModel";
import { internalQuery, type QueryCtx } from "@convex/_generated/server";
import { requireCampaignLot } from "@convex/qualificationCampaigns";
import {
    localBrowserFixturesEnabled,
    readWorkbenchQualification,
    SOURCES_QUALIFICATION_ENVELOPE,
} from "@convex/runWorkspace";
import { v } from "convex/values";

/** Local, campaign-bound fixture authority. A revoked simulation throws before any live fallback. */
export async function sourcesSimulationEnabled(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
): Promise<boolean> {
    const run = await ctx.db.get(runId);
    if (!run?.browserTestContextId) return false;
    const context = await ctx.db.get(run.browserTestContextId);
    if (!context?.campaignLotId) return false;
    const lot = await ctx.db.get(context.campaignLotId);
    const campaign = lot ? await ctx.db.get(lot.campaignId) : null;
    if (
        campaign?.manifest.capability !== "sources" ||
        campaign.manifest.mode !== "deterministic"
    )
        return false;
    if (
        !localBrowserFixturesEnabled() ||
        run.purpose !== "browser_test" ||
        run.withdrawnAt !== undefined ||
        context.status !== "active" ||
        context.expiresAt <= Date.now() ||
        context.ownerVisitorId !== run.ownerVisitorId ||
        context.paidQualification ||
        (run.researchStartedAt !== undefined &&
            Date.now() >= run.researchStartedAt + 15 * 60_000)
    )
        throw new Error("Active local Sources simulation required");
    if (
        campaign.manifest.version === 2 &&
        !context.simulatedScenarios?.some((s) => s.runId === run._id)
    )
        throw new Error("Declared campaign scenario required");
    await requireCampaignLot(ctx, context.campaignLotId);
    return true;
}
export const enabled = internalQuery({
    args: { runId: v.id("researchRuns") },
    returns: v.boolean(),
    handler: (ctx, args) => sourcesSimulationEnabled(ctx, args.runId),
});

export const simulatedSourceText =
    "Simulation only. This fixture describes a documentary workflow. A researcher discovers a candidate, captures its text, reads an exact passage, and submits the passage for documentary control. It establishes no fact about any company and supports no economic conclusion.";

/** Fixed advisory response; never evidence of model quality or a real company's facts. */
export function simulatedDocumentaryControl(
    contributions: readonly { id: string }[],
) {
    return {
        findings: contributions.map((c) => ({
            contributionId: c.id,
            conclusion: "supported" as const,
            permittedUse: "context_only" as const,
            diagnostic:
                "Simulation: fixed documentary-control response; no real model judgment.",
        })),
        coherence: true,
        limitations: [
            "Simulation only; no company facts or economic conclusions established.",
        ],
    };
}

/** One admission policy for the Start affordance, quota accounting and workflow envelope. */
export async function sourcesQualificationEnabled(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
): Promise<boolean> {
    return (
        !!(await readWorkbenchQualification(ctx, run))?.sourcesLot ||
        (await sourcesSimulationEnabled(ctx, run._id))
    );
}

/** Frozen search response shared with candidate admission; no network lookup or provider receipt. */
export function simulatedSourceCandidate(runId: Id<"researchRuns">) {
    return {
        canonicalUrl: `https://example.com/simulation/${runId}`,
        title: "Simulation only: documentary workflow",
        providerReference: "sources-simulation-v1",
    };
}

/** Version 2 owns logical work limits per scenario; legacy grants retain their frozen envelope. */
export async function sourcesQualificationEnvelope(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
) {
    if (!(await sourcesQualificationEnabled(ctx, run))) return undefined;
    const context = run.browserTestContextId
        ? await ctx.db.get(run.browserTestContextId)
        : null;
    const lot = context?.campaignLotId
        ? await ctx.db.get(context.campaignLotId)
        : null;
    const campaign = lot ? await ctx.db.get(lot.campaignId) : null;
    if (campaign?.manifest.version !== 2) return SOURCES_QUALIFICATION_ENVELOPE;
    const binding = (
        context?.paidQualification?.scenarios ?? context?.simulatedScenarios
    )?.find((s) => s.runId === run._id);
    const scenario = campaign.manifest.scenarios.find(
        (s) => s.id === binding?.id,
    );
    if (!scenario) throw new Error("Declared campaign scenario required");
    if (scenario.sourcesEnvelope) return scenario.sourcesEnvelope;
    const budget = campaign.manifest.perLot;
    return {
        version: 1 as const,
        maxNeeds: 160,
        initialSearches: Math.min(
            160,
            Math.max(1, scenario.limits?.search ?? budget.search),
        ),
        complementSearches: Math.min(
            160,
            Math.max(1, scenario.limits?.search ?? budget.search),
        ),
        acquisitions: Math.min(
            60,
            Math.max(1, scenario.limits?.acquisition ?? budget.acquisition),
        ),
        controls: 160,
    };
}
