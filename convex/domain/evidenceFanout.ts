import type { Id } from "@convex/_generated/dataModel";

/**
 * A single frozen-source branch dispatched by `fanOutFrozenBranches`.
 *
 * `origin` is the retrieval provider class for source content. It is carried
 * here (not on the persisted status row) only so the workflow dispatcher can
 * select the right retrieval action for the branch without re-querying.
 */
export type BranchDispatch = {
    runId: Id<"researchRuns">;
    corpusRevisionId: Id<"corpusRevisions">;
    sourceId: Id<"sources">;
    acceptedDecisionId: Id<"sourceDecisions">;
    executionGeneration: number;
    origin: "sec" | "exa" | "analyst_url";
};

/** A branch that rejected unexpectedly after the workflow's bounded retries. */
export type SourceDispatchRejection = {
    sourceId: Id<"sources">;
    reason: string;
};

export type ExecuteBranch = (branch: BranchDispatch) => Promise<void>;
export type TerminalizeBranch = (
    branch: BranchDispatch,
    reason: string,
) => Promise<void>;

/**
 * Dispatches every frozen source branch independently and in parallel, then
 * terminalizes exactly the branches that reject unexpectedly.
 *
 * Every branch's `execute` promise is created before any branch is awaited, so
 * a slow, hung, or rejected first branch never prevents the others from
 * starting or terminalizing — `Promise.all` only gates the caller on every
 * branch reaching settle. Rejections are isolated: one rejected branch can
 * never reject the aggregate or abort a sibling's dispatch.
 *
 * The caller supplies `terminalize`, which must be the exact-row, idempotent
 * internal status mutation. It is invoked once per rejecting branch, with the
 * branch's stable identity (run/revision/source/accepted decision/generation),
 * after every branch has settled. A terminalization that itself fails (for
 * example because the execution fence already rejected a cancelled or stale
 * generation) is swallowed: the run's onComplete/cancel path owns terminal
 * state in that case.
 */
export async function fanOutFrozenBranches(
    branches: BranchDispatch[],
    execute: ExecuteBranch,
    terminalize: TerminalizeBranch,
): Promise<SourceDispatchRejection[]> {
    const settled: Array<{
        branch: BranchDispatch;
        error?: unknown;
    }> = await Promise.all(
        branches.map(async (branch) => {
            try {
                await execute(branch);
                return { branch };
            } catch (error) {
                return { branch, error };
            }
        }),
    );

    const rejections: SourceDispatchRejection[] = [];
    for (const outcome of settled) {
        if (outcome.error === undefined) {
            continue;
        }
        const reason =
            outcome.error instanceof Error
                ? outcome.error.message
                : "Unexpected retrieval rejection after workflow retries";
        try {
            await terminalize(outcome.branch, reason);
        } catch {
            // Execution fence already rejected; onComplete/cancel owns state.
        }
        rejections.push({ sourceId: outcome.branch.sourceId, reason });
    }
    return rejections;
}
