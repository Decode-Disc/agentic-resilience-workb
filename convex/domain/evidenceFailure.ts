import type { Id } from "@convex/_generated/dataModel";
import type { MutationCtx } from "@convex/_generated/server";

/**
 * Applies the typed evidence-extraction failed transition in the current
 * mutation transaction. Shared by `researchRuns.failEvidenceExtraction` and
 * the strong-handoff boundary so a zero-passage / zero-valid-claim result
 * transitions exactly once without nesting a subtransaction.
 */
export async function applyEvidenceExtractionFailed(
    ctx: MutationCtx,
    args: {
        runId: Id<"researchRuns">;
        expectedExecutionGeneration: number;
        failureCode: string;
    },
): Promise<void> {
    const run = await ctx.db.get(args.runId);
    if (!run) {
        throw new Error("Research run not found");
    }
    if (run.executionGeneration !== args.expectedExecutionGeneration) {
        throw new Error("Stale research execution generation");
    }
    if (
        run.lifecycleState !== "extracting_evidence" ||
        run.executionStatus !== "running"
    ) {
        throw new Error("Research run is not extracting evidence");
    }
    const now = Date.now();
    await ctx.db.patch(run._id, {
        executionStatus: "failed",
        workflowId: undefined,
        nextEventSequence: run.nextEventSequence + 1,
        updatedAt: now,
    });
    const runningSteps = await ctx.db
        .query("workflowSteps")
        .withIndex("by_run_and_key", (query) => query.eq("runId", run._id))
        .take(65);
    if (runningSteps.length > 64) {
        throw new Error("Workflow step limit exceeded");
    }
    for (const step of runningSteps) {
        if (step.state === "running") {
            await ctx.db.patch(step._id, {
                state: "failed",
                completedAt: now,
                updatedAt: now,
            });
        }
    }
    await ctx.db.insert("runEvents", {
        runId: run._id,
        sequence: run.nextEventSequence + 1,
        type: "run_failed",
        lifecycleState: run.lifecycleState,
        executionStatus: "failed",
        stepKey: "generate_claims",
        failureCode: args.failureCode,
        occurredAt: now,
    });
}
