import type { Id } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import { executionError } from "@convex/execution/errors";
import {
    localBrowserFixturesEnabled,
    requireBrowserFixtureContext,
    requireBrowserTestRunOwner,
} from "./browserFixtureAccess";
export async function requireFixtureScope(
    ctx: QueryCtx,
    runId: Id<"researchRuns">,
) {
    if (!localBrowserFixturesEnabled())
        throw executionError("simulation_not_authorized");
    const run = await ctx.db.get(runId);
    if (run?.purpose !== "browser_test")
        throw executionError("simulation_not_authorized");
    const visitor = await requireBrowserTestRunOwner(ctx, run);
    const contextId = await requireBrowserFixtureContext(ctx, visitor);
    if (
        run.ownerVisitorId !== visitor._id ||
        run.browserTestContextId !== contextId
    )
        throw executionError("simulation_not_authorized");
}
