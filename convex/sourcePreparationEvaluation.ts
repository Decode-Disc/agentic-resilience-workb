import { vWorkflowStep } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { EVALUATION_IO_POLICY } from "./resourcePolicy";
import { assertLocalFixture } from "./retrievalEvaluation";
import schema from "./schema";
import { workflow } from "./workflow";

export const inspect = internalQuery({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        details: v.optional(v.boolean()),
    },
    returns: v.object({
        preparation: schema.doc("sourceSelectionProposalRebuilds"),
        run: schema.doc("researchRuns"),
        steps: v.array(vWorkflowStep),
        calls: v.array(schema.doc("providerCalls")),
        tasks: v.array(schema.doc("aiTaskResults")),
    }),
    handler: async (ctx, args) => {
        // authorize also requires an active lease; completed studies need only the same local gate.
        const p = await ctx.db.get(args.preparationId);
        if (!p?.preparationStudy) throw new Error("Preparation study missing");
        const run = await ctx.db.get(p.runId);
        if (!run) throw new Error("Study dossier missing");
        assertLocalFixture();
        if (args.details === false)
            return { preparation: p, run, steps: [], calls: [], tasks: [] };
        const handle = p.preparationStudy.workflowId;
        const steps = handle
            ? (
                  await workflow.listSteps(ctx, handle, {
                      paginationOpts: {
                          cursor: null,
                          numItems:
                              EVALUATION_IO_POLICY.workflowStepInspectionPageSize,
                      },
                  })
              ).page
            : [];
        return {
            preparation: p,
            run,
            steps,
            calls: await ctx.db
                .query("providerCalls")
                .withIndex("by_run", (q) => q.eq("runId", p.runId))
                .take(129),
            tasks: await ctx.db
                .query("aiTaskResults")
                .withIndex("by_run_and_task_type_and_input_hash", (q) =>
                    q.eq("runId", p.runId),
                )
                .take(121),
        };
    },
});
