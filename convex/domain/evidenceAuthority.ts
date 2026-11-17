import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export interface EffectiveAcceptedSourceHead {
    sourceId: Id<"sources">;
    acceptedDecisionId: Id<"sourceDecisions">;
}

/**
 * Validates the complete execution and authority fence for Phase 5 evidence extraction.
 * Verifies active running run, extracting_evidence lifecycle, generation match, active revision match,
 * frozen status doc match, current sourceReviewItem latestDecisionId match + accepted,
 * sourceDecision accepted, and source matching run.
 */
export async function assertEvidenceExecutionFence(
    db: GenericDatabaseReader<DataModel>,
    args: {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
        sourceId: Id<"sources">;
        acceptedDecisionId: Id<"sourceDecisions">;
        executionGeneration: number;
    },
) {
    const run = await db.get(args.runId);
    if (
        run?.executionStatus !== "running" ||
        run.lifecycleState !== "extracting_evidence" ||
        run.executionGeneration !== args.executionGeneration ||
        run.activeCorpusRevisionId !== args.corpusRevisionId
    ) {
        throw new Error(
            "Research execution fence violation: run is no longer actively extracting evidence for this generation and revision",
        );
    }

    const statusDoc = await db
        .query("evidenceSourceStatuses")
        .withIndex("by_run_corpus_generation_source", (q) =>
            q
                .eq("runId", args.runId)
                .eq("corpusRevisionId", args.corpusRevisionId)
                .eq("executionGeneration", args.executionGeneration)
                .eq("sourceId", args.sourceId),
        )
        .unique();

    if (
        !statusDoc ||
        statusDoc.acceptedDecisionId !== args.acceptedDecisionId
    ) {
        throw new Error(
            "Research execution fence violation: frozen source status mismatch or missing",
        );
    }

    const sourceReviewItem = await db
        .query("sourceReviewItems")
        .withIndex("by_revision_and_source", (q) =>
            q
                .eq("corpusRevisionId", args.corpusRevisionId)
                .eq("sourceId", args.sourceId),
        )
        .unique();

    if (
        !sourceReviewItem ||
        sourceReviewItem.runId !== args.runId ||
        sourceReviewItem.corpusRevisionId !== args.corpusRevisionId ||
        sourceReviewItem.sourceId !== args.sourceId ||
        sourceReviewItem.latestDecisionId !== args.acceptedDecisionId ||
        sourceReviewItem.decision !== "accepted"
    ) {
        throw new Error(
            "Research execution fence violation: source review item mismatch or latest decision is not the accepted decision",
        );
    }

    const sourceDecision = await db.get(args.acceptedDecisionId);
    if (
        !sourceDecision ||
        sourceDecision.runId !== args.runId ||
        sourceDecision.corpusRevisionId !== args.corpusRevisionId ||
        sourceDecision.sourceId !== args.sourceId ||
        sourceDecision.decision !== "accepted"
    ) {
        throw new Error(
            "Research execution fence violation: accepted decision mismatch or not accepted",
        );
    }

    const source = await db.get(args.sourceId);
    if (!source || source.runId !== args.runId) {
        throw new Error(
            "Research execution fence violation: source not found or run mismatch",
        );
    }

    return {
        run,
        statusDoc,
        sourceReviewItem,
        sourceDecision,
        source,
    };
}

/**
 * Reads and revalidates all effective source review heads for an approved corpus revision.
 * Authority comes exclusively from sourceReviewItems.latestDecisionId verified against
 * the matching sourceDecision row and confirming decision === "accepted".
 */
export async function loadEffectiveAcceptedSourceHeads(
    ctx: QueryCtx | MutationCtx,
    args: {
        runId: Id<"researchRuns">;
        corpusRevisionId: Id<"corpusRevisions">;
    },
): Promise<EffectiveAcceptedSourceHead[]> {
    const reviewItems = await ctx.db
        .query("sourceReviewItems")
        .withIndex("by_revision_and_source", (query) =>
            query.eq("corpusRevisionId", args.corpusRevisionId),
        )
        .collect();

    const acceptedHeads: EffectiveAcceptedSourceHead[] = [];

    for (const item of reviewItems) {
        if (
            item.runId !== args.runId ||
            item.corpusRevisionId !== args.corpusRevisionId
        ) {
            throw new Error("Source review item run or revision mismatch");
        }

        const decision = await ctx.db.get(item.latestDecisionId);
        if (!decision) {
            throw new Error("Source review item references missing decision");
        }
        if (
            decision.runId !== args.runId ||
            decision.corpusRevisionId !== args.corpusRevisionId ||
            decision.sourceId !== item.sourceId
        ) {
            throw new Error(
                "Source decision does not match review item identity",
            );
        }
        if (decision.decision !== item.decision) {
            throw new Error(
                "Source decision outcome does not match review item projection",
            );
        }

        if (item.decision === "accepted" && decision.decision === "accepted") {
            const source = await ctx.db.get(item.sourceId);
            if (!source || source.runId !== args.runId) {
                throw new Error("Source does not belong to research run");
            }
            acceptedHeads.push({
                sourceId: item.sourceId,
                acceptedDecisionId: decision._id,
            });
        }
    }

    if (acceptedHeads.length === 0) {
        throw new Error("At least one accepted source is required");
    }

    return acceptedHeads;
}
