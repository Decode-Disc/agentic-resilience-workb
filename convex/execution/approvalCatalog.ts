import type { Doc } from "@convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "@convex/_generated/server";
import { sourcesContinuationAvailable } from "@convex/domain/sources";
import {
    requestSourcesSettlement,
    sourcesSettlementBlock,
} from "@convex/domain/sourcesSettlement";
import {
    pauseResearch,
    readResearchControlReadiness,
    resumeResearch,
} from "@convex/execution/researchControlCore";
import type { ApprovalAction, AuditActor } from "./approvalContracts";
import { executionError } from "./errors";

export type ApprovalActionDefinition = {
    readonly exclusiveWith: readonly ApprovalAction[];
    availability(
        ctx: QueryCtx,
        run: Doc<"researchRuns">,
    ): Promise<string | null>;
    apply(
        ctx: MutationCtx,
        args: { run: Doc<"researchRuns">; actor: AuditActor },
    ): Promise<void>;
};

async function resumeResearchAvailability(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
): Promise<string | null> {
    const readiness = await readResearchControlReadiness(ctx, run, "resume");
    if (readiness.block) return readiness.block;
    if (readiness.transition === "renew_window")
        return "sources_time_limit_decision";
    return null;
}

async function continueSourcesPreparationAvailability(
    ctx: QueryCtx,
    run: Doc<"researchRuns">,
): Promise<string | null> {
    const readiness = await readResearchControlReadiness(ctx, run, "resume");
    if (readiness.transition === null && readiness.block)
        return readiness.block;
    if (readiness.transition !== "renew_window") return "action_not_applicable";
    if (readiness.block) return readiness.block;
    const preparation = run.sourcePreparationId
        ? await ctx.db.get(run.sourcePreparationId)
        : null;
    if (
        !preparation ||
        !(await sourcesContinuationAvailable(ctx, run, preparation))
    )
        return "sources_capacity_exhausted";
    return null;
}

export const approvalCatalog = {
    pause_research: {
        exclusiveWith: [],
        async availability(ctx, run) {
            return (await readResearchControlReadiness(ctx, run, "pause"))
                .block;
        },
        async apply(ctx, { run }) {
            await pauseResearch(ctx, {
                runId: run._id,
                expectedGeneration: run.executionGeneration,
            });
        },
    },
    resume_research: {
        exclusiveWith: [],
        availability: resumeResearchAvailability,
        async apply(ctx, { run }) {
            const block = await resumeResearchAvailability(ctx, run);
            if (block) throw executionError(block);
            await resumeResearch(ctx, {
                runId: run._id,
                expectedGeneration: run.executionGeneration,
            });
        },
    },
    continue_sources_preparation: {
        exclusiveWith: ["settle_sources_preparation"],
        availability: continueSourcesPreparationAvailability,
        async apply(ctx, { run }) {
            const block = await continueSourcesPreparationAvailability(
                ctx,
                run,
            );
            if (block) throw executionError(block);
            await resumeResearch(ctx, {
                runId: run._id,
                expectedGeneration: run.executionGeneration,
            });
        },
    },
    settle_sources_preparation: {
        exclusiveWith: ["continue_sources_preparation"],
        availability: sourcesSettlementBlock,
        apply: requestSourcesSettlement,
    },
} satisfies Record<ApprovalAction, ApprovalActionDefinition>;
