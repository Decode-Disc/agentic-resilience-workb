import type { Id } from "@convex/_generated/dataModel";
import type { MutationCtx } from "@convex/_generated/server";

export type SourceReviewDecision = "accepted" | "rejected" | "pending";

export function sourceReviewDecisionRank(
    decision: SourceReviewDecision,
): number {
    if (decision === "pending") {
        return 0;
    }
    if (decision === "accepted") {
        return 1;
    }
    return 2;
}

export async function upsertSourceReviewItem(
    ctx: MutationCtx,
    value: {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        sourceId: Id<"sources">;
        decision: SourceReviewDecision;
        sourceCreatedAt: number;
        latestDecisionId: Id<"sourceDecisions">;
        decisionOccurredAt: number;
        reason?: string;
    },
): Promise<void> {
    const existing = await ctx.db
        .query("sourceReviewItems")
        .withIndex("by_revision_and_source", (query) =>
            query
                .eq("corpusRevisionId", value.corpusRevisionId)
                .eq("sourceId", value.sourceId),
        )
        .unique();
    const projection = {
        ...value,
        decisionRank: sourceReviewDecisionRank(value.decision),
    };

    if (existing) {
        await ctx.db.patch(existing._id, projection);
        return;
    }
    await ctx.db.insert("sourceReviewItems", projection);
}
