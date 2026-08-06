import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type PausedCheckpoint =
    | {
          lifecycleState: "awaiting_evidence_sufficiency_review";
          pauseReason: "evidence_sufficiency_review";
      }
    | {
          lifecycleState: "awaiting_source_review";
          pauseReason: "source_review";
      };

/**
 * Claims the visitor's single running slot and advances the execution
 * generation in the caller's mutation transaction.
 */
export async function claimPausedRunExecution(
    ctx: MutationCtx,
    args: {
        visitor: Doc<"visitors">;
        run: Doc<"researchRuns">;
        checkpoint: PausedCheckpoint;
        now: number;
    },
): Promise<number> {
    if (
        args.visitor.status !== "active" ||
        args.run.ownerVisitorId !== args.visitor._id
    ) {
        throw new Error("Unauthorized");
    }
    if (
        args.run.lifecycleState !== args.checkpoint.lifecycleState ||
        args.run.executionStatus !== "paused" ||
        args.run.pauseReason !== args.checkpoint.pauseReason
    ) {
        throw new Error("Research run is not awaiting this checkpoint");
    }

    const concurrent = await ctx.db
        .query("researchRuns")
        .withIndex("by_owner_and_execution_status", (query) =>
            query
                .eq("ownerVisitorId", args.visitor._id)
                .eq("executionStatus", "running"),
        )
        .first();
    if (concurrent) {
        throw new Error("A research workflow is already running");
    }

    const executionGeneration = args.run.executionGeneration + 1;
    await ctx.db.patch(args.run._id, {
        executionStatus: "running",
        executionGeneration,
        pauseReason: undefined,
        updatedAt: args.now,
    });
    return executionGeneration;
}
