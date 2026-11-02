import type { Id } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";

/** Resolves current treatment separately from the retained transmission receipt. */
export async function readWorkbenchInstructions(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
) {
    const requests = await ctx.db
        .query("workbenchInstructions")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .order("desc")
        .take(20);
    return Promise.all(
        requests.map(async (request) => {
            const preparation = request.preparationId
                ? await ctx.db.get(request.preparationId)
                : null;
            const finished = preparation && preparation.status !== "started";
            return {
                ...request,
                transmissionStatus: request.status,
                status: finished
                    ? preparation.status === "complete"
                        ? ("completed" as const)
                        : ("limited" as const)
                    : request.status,
                outcome: finished
                    ? "This preparation has ended. Inspect Sources for the retained material, limitations and any unfinished work."
                    : request.outcome,
            };
        }),
    );
}
