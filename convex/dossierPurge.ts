import type { Id, TableNames } from "@convex/_generated/dataModel";
import {
    internalAction,
    internalMutation,
    type MutationCtx,
} from "@convex/_generated/server";
import { cancelRunExecution } from "@convex/domain/runCancellation";
import { deleteRetainedTextBatch } from "@convex/execution/retainedText";
import { DOSSIER_PURGE_BATCH } from "@convex/resourcePolicy";
import { v } from "convex/values";
import { internal } from "./_generated/api";

type RunId = Id<"researchRuns">;

/** Deletes one batch; true while rows remain. */
async function drop<R extends { _id: Id<TableNames> }>(
    ctx: MutationCtx,
    rows: R[],
    after?: (row: R) => Promise<void>,
) {
    for (const row of rows) {
        await ctx.db.delete(row._id);
        await after?.(row);
    }
    return rows.length === DOSSIER_PURGE_BATCH;
}

/** A stored file is released only when no remaining record, in any dossier, still points to it. */
async function releaseStorage(ctx: MutationCtx, storageId?: Id<"_storage">) {
    if (!storageId) return;
    const [capture, lease, version] = await Promise.all([
        ctx.db
            .query("sourceCaptures")
            .withIndex("by_storage_id", (q) => q.eq("storageId", storageId))
            .first(),
        ctx.db
            .query("artifactUploadLeases")
            .withIndex("by_storage_id", (q) => q.eq("storageId", storageId))
            .first(),
        ctx.db
            .query("sourceVersions")
            .withIndex("by_storage_id", (q) => q.eq("storageId", storageId))
            .first(),
    ]);
    if (!capture && !lease && !version) await ctx.storage.delete(storageId);
}

/** Removes a batch of a Pi session's commits, then the session itself once it has none. */
async function dropSession(ctx: MutationCtx, sessionId: Id<"piSessions">) {
    const commits = await ctx.db
        .query("piCommits")
        .withIndex("by_session_and_sequence", (q) =>
            q.eq("sessionId", sessionId),
        )
        .take(DOSSIER_PURGE_BATCH);
    if (commits.length) await drop(ctx, commits);
    else await ctx.db.delete(sessionId);
    return true;
}

/** Ordered children-first steps; each deletes at most one batch for one dossier. */
const steps: Record<
    string,
    (ctx: MutationCtx, runId: RunId) => Promise<boolean>
> = {
    claimEvidence: async (ctx, runId) => {
        for (const claim of await ctx.db
            .query("claims")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .take(DOSSIER_PURGE_BATCH)) {
            const rows = await ctx.db
                .query("claimEvidence")
                .withIndex("by_claim", (q) => q.eq("claimId", claim._id))
                .take(DOSSIER_PURGE_BATCH);
            if (rows.length) return drop(ctx, rows).then(() => true);
        }
        return false;
    },
    claimDimensionLinks: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("claimDimensionLinks")
                .withIndex("by_run_and_corpus_and_dimension", (q) =>
                    q.eq("runId", runId),
                )
                .take(DOSSIER_PURGE_BATCH),
        ),
    policyEvaluations: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("policyEvaluations")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
        ),
    claims: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("claims")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
        ),
    sourcePassages: async (ctx, runId) => {
        for (const version of await ctx.db
            .query("sourceVersions")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .take(DOSSIER_PURGE_BATCH)) {
            const rows = await ctx.db
                .query("sourcePassages")
                .withIndex("by_source_version_and_order", (q) =>
                    q.eq("sourceVersionId", version._id),
                )
                .take(DOSSIER_PURGE_BATCH);
            if (rows.length) return drop(ctx, rows).then(() => true);
        }
        return false;
    },
    sourceVersions: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("sourceVersions")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
            (row) => releaseStorage(ctx, row.storageId),
        ),
    evidenceSourceStatuses: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("evidenceSourceStatuses")
                .withIndex("by_run_and_execution_generation", (q) =>
                    q.eq("runId", runId),
                )
                .take(DOSSIER_PURGE_BATCH),
        ),
    artifactUploadLeases: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("artifactUploadLeases")
                .withIndex("by_run_and_execution_generation", (q) =>
                    q.eq("runId", runId),
                )
                .take(DOSSIER_PURGE_BATCH),
            (row) => releaseStorage(ctx, row.storageId),
        ),
    // Retrieval scopes are keyed `${runId}:${corpusRevisionId}:${version}`.
    sourceSearchPassages: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("sourceSearchPassages")
                .withIndex("by_scope_capture_order", (q) =>
                    q.gte("scopeKey", `${runId}:`).lt("scopeKey", `${runId};`),
                )
                .take(DOSSIER_PURGE_BATCH),
        ),
    sourceSearchCaptures: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("sourceSearchCaptures")
                .withIndex("by_scope_and_capture", (q) =>
                    q.gte("scopeKey", `${runId}:`).lt("scopeKey", `${runId};`),
                )
                .take(DOSSIER_PURGE_BATCH),
        ),
    proposalItemsAndReviewItems: async (ctx, runId) => {
        for (const revision of await ctx.db
            .query("corpusRevisions")
            .withIndex("by_run_and_revision", (q) => q.eq("runId", runId))
            .take(DOSSIER_PURGE_BATCH)) {
            const reviewItems = await ctx.db
                .query("sourceReviewItems")
                .withIndex("by_revision_and_source", (q) =>
                    q.eq("corpusRevisionId", revision._id),
                )
                .take(DOSSIER_PURGE_BATCH);
            if (reviewItems.length)
                return drop(ctx, reviewItems).then(() => true);
            for (const proposal of await ctx.db
                .query("sourceSelectionProposals")
                .withIndex("by_corpus_revision_id_and_version", (q) =>
                    q.eq("corpusRevisionId", revision._id),
                )
                .take(DOSSIER_PURGE_BATCH)) {
                const items = await ctx.db
                    .query("sourceSelectionProposalItems")
                    .withIndex("by_proposal_and_source", (q) =>
                        q.eq("proposalId", proposal._id),
                    )
                    .take(DOSSIER_PURGE_BATCH);
                if (items.length) return drop(ctx, items).then(() => true);
            }
        }
        return false;
    },
    proposalsAndPreparations: async (ctx, runId) => {
        for (const revision of await ctx.db
            .query("corpusRevisions")
            .withIndex("by_run_and_revision", (q) => q.eq("runId", runId))
            .take(DOSSIER_PURGE_BATCH)) {
            const proposals = await ctx.db
                .query("sourceSelectionProposals")
                .withIndex("by_corpus_revision_id_and_version", (q) =>
                    q.eq("corpusRevisionId", revision._id),
                )
                .take(DOSSIER_PURGE_BATCH);
            if (proposals.length) return drop(ctx, proposals).then(() => true);
            const preparations = await ctx.db
                .query("sourceSelectionProposalRebuilds")
                .withIndex("by_revision_and_created_at", (q) =>
                    q.eq("corpusRevisionId", revision._id),
                )
                .take(DOSSIER_PURGE_BATCH);
            if (preparations.length)
                return drop(ctx, preparations).then(() => true);
        }
        return false;
    },
    sourceCapturesAndPreviews: async (ctx, runId) => {
        for (const source of await ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (q) => q.eq("runId", runId))
            .take(DOSSIER_PURGE_BATCH)) {
            const previews = await ctx.db
                .query("previewCaches")
                .withIndex("by_source", (q) => q.eq("sourceId", source._id))
                .take(DOSSIER_PURGE_BATCH);
            if (previews.length) return drop(ctx, previews).then(() => true);
            const captures = await ctx.db
                .query("sourceCaptures")
                .withIndex("by_source_and_updated_at", (q) =>
                    q.eq("sourceId", source._id),
                )
                .take(DOSSIER_PURGE_BATCH);
            if (captures.length)
                return drop(ctx, captures, (row) =>
                    releaseStorage(ctx, row.storageId),
                ).then(() => true);
        }
        return false;
    },
    sources: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("sources")
                .withIndex("by_run_and_url", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
        ),
    sourceDecisions: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("sourceDecisions")
                .withIndex("by_run_and_decision_key", (q) =>
                    q.eq("runId", runId),
                )
                .take(DOSSIER_PURGE_BATCH),
        ),
    corpusRevisions: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("corpusRevisions")
                .withIndex("by_run_and_revision", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
        ),
    aiTaskResults: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("aiTaskResults")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
        ),
    providerCalls: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("providerCalls")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
        ),
    piCommitsAndSessions: async (ctx, runId) => {
        for (const mission of await ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_status", (q) => q.eq("runId", runId))
            .take(DOSSIER_PURGE_BATCH)) {
            const session = await ctx.db
                .query("piSessions")
                .withIndex("by_mission", (q) => q.eq("missionId", mission._id))
                .first();
            if (session) return dropSession(ctx, session._id);
        }
        for (const conversation of await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .take(DOSSIER_PURGE_BATCH)) {
            const session = await ctx.db
                .query("piSessions")
                .withIndex("by_conversation", (q) =>
                    q.eq("conversationId", conversation._id),
                )
                .first();
            if (session) return dropSession(ctx, session._id);
        }
        return false;
    },
    agentInvocationPayloads: async (ctx, runId) => {
        for (const invocation of await ctx.db
            .query("agentInvocations")
            .withIndex("by_run_and_task_key", (q) => q.eq("runId", runId))
            .take(DOSSIER_PURGE_BATCH)) {
            const rows = await ctx.db
                .query("agentInvocationPayloads")
                .withIndex("by_invocation_and_part", (q) =>
                    q.eq("invocationId", invocation._id),
                )
                .take(DOSSIER_PURGE_BATCH);
            if (rows.length) return drop(ctx, rows).then(() => true);
        }
        return false;
    },
    agentExecutionEvents: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("agentExecutionEvents")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
        ),
    agentOperationRequests: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("agentOperationRequests")
                .withIndex("by_run_and_status", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
        ),
    agentInvocations: async (ctx, runId) => {
        const invocations = await ctx.db
            .query("agentInvocations")
            .withIndex("by_run_and_task_key", (q) => q.eq("runId", runId))
            .take(DOSSIER_PURGE_BATCH);
        for (const invocation of invocations) {
            if (!invocation.visibleOutput) continue;
            const done = await deleteRetainedTextBatch(
                ctx,
                invocation.visibleOutput.textId,
                `${invocation._id}:visible`,
                DOSSIER_PURGE_BATCH,
            );
            if (!done) return true;
            await ctx.db.patch(invocation._id, { visibleOutput: undefined });
            return true;
        }
        return drop(ctx, invocations);
    },
    workbenchInstructions: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("workbenchInstructions")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
        ),
    agentMessageDeliveries: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("agentMessageDeliveries")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
        ),
    agentConversationTurns: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("agentConversationTurns")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
        ),
    agentMissions: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("agentMissions")
                .withIndex("by_run_and_status", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
        ),
    agentConversations: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("agentConversations")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
        ),
    researchPlanQuestions: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("researchPlanQuestions")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
        ),
    researchPlans: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("researchPlans")
                .withIndex("by_run_and_version", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
        ),
    evidenceAvailabilityEvaluations: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("evidenceAvailabilityEvaluations")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
        ),
    workflowSteps: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("workflowSteps")
                .withIndex("by_run_and_key", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
        ),
    runEvents: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("runEvents")
                .withIndex("by_run_and_sequence", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
        ),
    checkpointDecisions: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("checkpointDecisions")
                .withIndex("by_run_and_checkpoint", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
        ),
    framingRevisions: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("framingRevisions")
                .withIndex("by_run_and_revision", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
        ),
};
const stepNames = Object.keys(steps);

/** Stops execution, restores a consumed analysis and records the purge before any record is removed. */
export const beginPurge = internalMutation({
    args: { runId: v.id("researchRuns"), reason: v.string() },
    returns: v.null(),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run) return null;
        if (run.purpose !== "research")
            throw new Error("Only analyst research dossiers can be purged");
        if (
            run.executionStatus === "running" ||
            run.executionStatus === "paused"
        )
            await cancelRunExecution(ctx, run);
        if (
            run.reservationStatus === "consumed" &&
            !run.withdrawnAt &&
            run.ownerVisitorId
        ) {
            const owner = await ctx.db.get(run.ownerVisitorId);
            if (owner && owner.analysesReserved > 0)
                await ctx.db.patch(owner._id, {
                    analysesReserved: owner.analysesReserved - 1,
                });
        }
        await ctx.db.insert("auditEvents", {
            actor: { type: "system" },
            action: "dossier_purged",
            targetType: "research_run",
            targetId: run._id,
            reason: args.reason.trim(),
            occurredAt: Date.now(),
        });
        return null;
    },
});

/** Removes one batch from one step; the caller repeats until every step is empty. */
export const purgeStep = internalMutation({
    args: { runId: v.id("researchRuns"), step: v.string() },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        const step = steps[args.step];
        if (!step) throw new Error("Unknown purge step");
        return step(ctx, args.runId);
    },
});

export const finishPurge = internalMutation({
    args: { runId: v.id("researchRuns") },
    returns: v.null(),
    handler: async (ctx, args) => {
        if (await ctx.db.get(args.runId)) await ctx.db.delete(args.runId);
        return null;
    },
});

/**
 * Permanently deletes analyst research dossiers and the records they own.
 * Operator-only (internal); retained texts, companies and component state are
 * shared or harmless and are left in place.
 */
export const purgeResearchDossiers = internalAction({
    args: { runIds: v.array(v.id("researchRuns")), reason: v.string() },
    returns: v.array(
        v.object({ runId: v.id("researchRuns"), batches: v.number() }),
    ),
    handler: async (ctx, args) => {
        if (args.reason.trim().length < 12)
            throw new Error("A purge requires a specific reason");
        const results = [];
        for (const runId of args.runIds) {
            await ctx.runMutation(internal.dossierPurge.beginPurge, {
                runId,
                reason: args.reason,
            });
            let batches = 0;
            for (const step of stepNames)
                while (
                    await ctx.runMutation(internal.dossierPurge.purgeStep, {
                        runId,
                        step,
                    })
                )
                    batches++;
            await ctx.runMutation(internal.dossierPurge.finishPurge, {
                runId,
            });
            results.push({ runId, batches });
        }
        return results;
    },
});
