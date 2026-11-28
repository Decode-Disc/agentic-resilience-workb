import { internal } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "@convex/_generated/server";
import type { AuditActor } from "@convex/execution/approvalContracts";
import { executionError } from "@convex/execution/errors";
import {
    notifyResearchControlWaits,
    recordResearchObservation,
} from "@convex/execution/researchControlCore";
import { readSourcesMission } from "./sources";
import { isSourcesSettlementPause } from "./transitions";
export async function sourcesSettlementBlock(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
): Promise<string | null> {
    if (!isSourcesSettlementPause(run) || !run.sourcePreparationId)
        return "stale_execution";
    const preparation = await ctx.db.get(run.sourcePreparationId);
    if (
        preparation?.status !== "started" ||
        preparation.settlementRequestedAt !== undefined
    )
        return "stale_execution";
    return null;
}

export async function requestSourcesSettlement(
    ctx: MutationCtx,
    { run, actor }: { run: Doc<"researchRuns">; actor: AuditActor },
): Promise<void> {
    const block = await sourcesSettlementBlock(ctx, run);
    if (block) throw executionError(block);
    if (!run.sourcePreparationId) throw executionError("stale_execution");
    let eventActor: NonNullable<Doc<"agentExecutionEvents">["actor"]> = {
        type: "system",
    };
    if (actor.type === "visitor") {
        const visitorId = ctx.db.normalizeId("visitors", actor.visitorId);
        if (!visitorId) throw executionError("not_authorized");
        eventActor = { type: "visitor", visitorId };
    }
    const mission = await readSourcesMission(ctx, run);
    await ctx.db.patch(run.sourcePreparationId, {
        settlementRequestedAt: Date.now(),
    });
    if (mission?.status === "blocked") {
        // Settlement eligibility comes from the recorded decision; preserve the actual stop reason.
        await ctx.runMutation(internal.execution.handoffs.finishChild, {
            missionId: mission._id,
        });
    }
    await notifyResearchControlWaits(ctx, run._id);
    await recordResearchObservation(
        ctx,
        run._id,
        "sources_settlement_requested",
        eventActor,
    );
}
