import type { Doc } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import { executionError } from "@convex/execution/errors";
import { campaignConfiguration } from "./qualificationCampaignPolicy";
import { requireCampaignLot } from "./qualificationCampaigns";
import {
    localBrowserFixturesEnabled,
    requireBrowserTestRunOwner,
} from "./runWorkspace";

export function retainedMethodVersion(
    definitionId: "workbench_v1" | "sources_v1",
) {
    return definitionId === "workbench_v1" ? 8 : 6;
}
const nativeMethodVersions = { workbench_v1: 7, sources_v1: 5 } as const;

/** A comparison binding is selected only by the immutable lot owning this local fixture. */
export async function taskMethodDefinitionVersion(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
    definitionId: Doc<"agentMissions">["definitionId"],
): Promise<number | undefined> {
    if (definitionId !== "workbench_v1" && definitionId !== "sources_v1")
        return undefined;
    if (run.purpose !== "browser_test" || !run.browserTestContextId)
        return undefined;
    const context = await ctx.db.get(run.browserTestContextId);
    if (!context?.campaignLotId) return undefined;
    const lot = await ctx.db.get(context.campaignLotId);
    const campaign = lot ? await ctx.db.get(lot.campaignId) : null;
    if (!lot || !campaign || campaign.manifest.version === 1) return undefined;
    const methods = campaignConfiguration(
        campaign.manifest,
        lot.configurationId,
    ).taskMethods;
    if (!methods) return undefined;
    await requireCampaignLot(ctx, lot._id);
    const bindings =
        context.paidQualification?.scenarios ?? context.simulatedScenarios;
    if (
        !localBrowserFixturesEnabled() ||
        context.status !== "active" ||
        context.expiresAt <= Date.now() ||
        context.ownerVisitorId !== run.ownerVisitorId ||
        lot.contextId !== context._id ||
        !bindings?.some((entry) => entry.runId === run._id)
    )
        throw executionError("task_method_comparison_not_authorized");
    await requireBrowserTestRunOwner(ctx, run);
    return methods === "retained_control"
        ? retainedMethodVersion(definitionId)
        : nativeMethodVersions[definitionId];
}

/** Retained-method controls cannot be used by ordinary dossiers or another campaign arm. */
export async function requireRetainedMethodControl(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
    run: Doc<"researchRuns">,
): Promise<void> {
    if (
        (mission.definitionId !== "workbench_v1" &&
            mission.definitionId !== "sources_v1") ||
        mission.definitionVersion !==
            retainedMethodVersion(mission.definitionId) ||
        (await taskMethodDefinitionVersion(ctx, run, mission.definitionId)) !==
            mission.definitionVersion
    )
        throw executionError("task_method_comparison_not_authorized");
}
