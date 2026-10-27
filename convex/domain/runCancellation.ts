import type { Doc } from "@convex/_generated/dataModel";
import type { MutationCtx } from "@convex/_generated/server";
import { cancelAgentMissionsForRun } from "@convex/execution/cancellation";
import { workflow } from "@convex/workflow";
import type { WorkflowId } from "@convex-dev/workflow";

/** Fences all late callbacks before cancelling either durable execution. */
export async function cancelRunExecution(
    ctx: MutationCtx,
    run: Doc<"researchRuns">,
) {
    if (run.executionStatus === "cancelled") {
        return { cancelled: false };
    }
    if (run.executionStatus === "completed") {
        throw new Error("Research run cannot be cancelled");
    }

    const preparation = run.sourcePreparationId
        ? await ctx.db.get(run.sourcePreparationId)
        : null;
    const now = Date.now();
    // Fence callbacks before component cancellation: completion callbacks can run in this transaction.
    await ctx.db.patch(run._id, {
        executionStatus: "cancelled",
        workflowId: undefined,
        executionGeneration: run.executionGeneration + 1,
        nextEventSequence: run.nextEventSequence + 1,
        updatedAt: now,
    });
    await cancelAgentMissionsForRun(ctx, run._id, now, run.executionGeneration);
    if (
        preparation?.kind === "preparation" &&
        preparation.runId === run._id &&
        preparation.executionGeneration === run.executionGeneration &&
        (preparation.status === "started" ||
            preparation.stopCode === "execution_slot_unavailable")
    ) {
        await ctx.db.patch(preparation._id, {
            status: "blocked",
            stopCode: "cancelled",
            completedAt: now,
            workflowId: undefined,
        });
    }
    if (run.workflowId)
        await workflow.cancel(ctx, run.workflowId as WorkflowId);
    if (
        preparation?.kind === "preparation" &&
        preparation.executionGeneration === run.executionGeneration &&
        preparation.status === "started" &&
        preparation.workflowId &&
        preparation.workflowId !== run.workflowId
    ) {
        await workflow.cancel(ctx, preparation.workflowId as WorkflowId);
    }
    await ctx.db.insert("runEvents", {
        runId: run._id,
        sequence: run.nextEventSequence + 1,
        type: "run_cancelled",
        lifecycleState: run.lifecycleState,
        executionStatus: "cancelled",
        occurredAt: now,
    });
    return { cancelled: true };
}
