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

type ClaimGenerationUnavailableCheckpoint = {
    lifecycleState: "extracting_evidence";
    pauseReason: "claim_generation_unavailable";
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

/**
 * Claims the visitor's single running slot for a run paused at claim_generation_unavailable.
 * Advances the execution generation, clears pauseReason, and sets running.
 * The caller must have already verified that claim generation capability is now available.
 */
export async function claimUnavailableResumeExecution(
    ctx: MutationCtx,
    args: {
        visitor: Doc<"visitors">;
        run: Doc<"researchRuns">;
        checkpoint: ClaimGenerationUnavailableCheckpoint;
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
        throw new Error(
            "Research run is not paused for claim generation unavailable",
        );
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

/**
 * Claims the visitor's single running slot for a failed evidence-extraction
 * retry. Keeps the extracting_evidence lifecycle, advances the generation,
 * clears pauseReason, and returns to running. The caller has already confirmed
 * the run is in the typed failed/retryable outcome.
 */
export async function claimEvidenceRetryExecution(
    ctx: MutationCtx,
    args: {
        visitor: Doc<"visitors">;
        run: Doc<"researchRuns">;
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
        args.run.lifecycleState !== "extracting_evidence" ||
        args.run.executionStatus !== "failed" ||
        args.run.workflowId !== undefined
    ) {
        throw new Error(
            "Research run is not a retryable failed evidence extraction",
        );
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

/**
 * Claims the visitor's single running slot for a run with an approved corpus
 * and advances the execution generation for evidence extraction.
 */
export async function claimCorpusApprovedRunExecution(
    ctx: MutationCtx,
    args: {
        visitor: Doc<"visitors">;
        run: Doc<"researchRuns">;
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
        args.run.lifecycleState !== "corpus_approved" ||
        args.run.executionStatus !== "idle"
    ) {
        throw new Error("Research run is not in approved corpus state");
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
        lifecycleState: "extracting_evidence",
        executionStatus: "running",
        executionGeneration,
        pauseReason: undefined,
        updatedAt: args.now,
    });
    return executionGeneration;
}
