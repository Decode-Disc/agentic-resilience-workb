import type { Id } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import { executionError } from "@convex/execution/errors";
import {
    assertPreparationExecutionFence,
    assertPreparationObservationFence,
    assertPreparationSettlementFence,
} from "./sourcePreparationAuthority";
import { SOURCES_PROTOCOL } from "./sourcesScope";

/** Execution admits paid work before the deadline; observation retains results during a pause; settlement hands off existing material at any time. */
export async function requireSourcesPreparation(
    ctx: Pick<QueryCtx, "db">,
    preparationId: Id<"sourceSelectionProposalRebuilds">,
    mode: "execution" | "observation" | "settlement" = "execution",
) {
    const { preparation, run, revision } =
        mode === "observation"
            ? await assertPreparationObservationFence(ctx.db, { preparationId })
            : mode === "settlement"
              ? await assertPreparationSettlementFence(ctx.db, {
                    preparationId,
                })
              : await assertPreparationExecutionFence(ctx.db, {
                    preparationId,
                    now: Date.now(),
                });
    if (!preparation.sourcesMission || run.sourcesProtocol !== SOURCES_PROTOCOL)
        throw executionError("sources_scope_invalid");
    return { preparation, run, revision, data: preparation.sourcesMission };
}
