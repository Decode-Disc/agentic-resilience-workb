import type { Doc } from "@convex/_generated/dataModel";
import type { QueryCtx } from "@convex/_generated/server";
import { executionError } from "@convex/execution/errors";

/** Resolves the committed documentary brief; the original request remains historical input. */
export async function readResearchContext(
    ctx: Pick<QueryCtx, "db">,
    run: Doc<"researchRuns">,
) {
    if (run.startMode !== "framed")
        return {
            framing: null,
            scope: run.researchAngle,
            researchAngle: run.researchAngle,
        };
    const framing = run.fixedFramingRevisionId
        ? await ctx.db.get(run.fixedFramingRevisionId)
        : null;
    if (!framing || framing.runId !== run._id)
        throw executionError("fixed_framing_unavailable");
    const scope = framing.content.scope;
    const questions = framing.content.questions.map(
        (question) => question.text,
    );
    return {
        framing,
        scope,
        researchAngle: questions.length
            ? [scope, "Research questions:", ...questions].join("\n")
            : scope,
    };
}
