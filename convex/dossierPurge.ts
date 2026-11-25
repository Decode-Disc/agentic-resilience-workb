import type { Id, TableNames } from "@convex/_generated/dataModel";
import {
    internalAction,
    internalMutation,
    type MutationCtx,
} from "@convex/_generated/server";
import { cancelRunExecution } from "@convex/domain/runCancellation";
import { cancelAgentMissionsForRun } from "@convex/execution/cancellation";
import { executionError } from "@convex/execution/errors";
import {
    contextObservationTextKey,
    purgeInvocationJournalBatch,
} from "@convex/execution/journal";
import {
    missionTextualResultKey,
    textualOutcomeKey,
} from "@convex/execution/missionData";
import { purgeDossierOperationBatch } from "@convex/execution/operations";
import { deleteRetainedTextBatch } from "@convex/execution/retainedText";
import {
    deliveryMigrationTextKey,
    retainedDeliveryKey,
} from "@convex/integrations/agentStorage";
import {
    CONVEX_MAX_DOCUMENT_BYTES,
    DOSSIER_PURGE_BATCH,
    DOSSIER_PURGE_PARENT_SCAN_BYTES,
} from "@convex/resourcePolicy";
import { v } from "convex/values";
import { internal } from "./_generated/api";

const purgeParentPage = {
    cursor: null,
    numItems: DOSSIER_PURGE_BATCH,
    maximumBytesRead: DOSSIER_PURGE_PARENT_SCAN_BYTES,
} as const;

// Nested scans can visit several parents in a step. A matching child batch
// stops traversal, with read capacity reserved for cleanup of its records.
const purgePayloadChildren = Math.floor(
    DOSSIER_PURGE_PARENT_SCAN_BYTES / CONVEX_MAX_DOCUMENT_BYTES,
);

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

/** The session owns its commit keys from the first fragment, including unpublished commits. */
async function dropSession(ctx: MutationCtx, sessionId: Id<"piSessions">) {
    const commit = await ctx.db
        .query("piCommits")
        .withIndex("by_session_and_sequence", (q) =>
            q.eq("sessionId", sessionId),
        )
        .first();
    if (commit) {
        if (
            commit.textId &&
            !(await deleteRetainedTextBatch(
                ctx,
                commit.textId,
                `${sessionId}:${commit.key}`,
                DOSSIER_PURGE_BATCH,
            ))
        )
            return true;
        await ctx.db.delete(commit._id);
        return true;
    }
    const staged = await ctx.db
        .query("retainedTexts")
        .withIndex("by_key", (q) =>
            q.gte("key", `${sessionId}:`).lt("key", `${sessionId};`),
        )
        .first();
    if (staged)
        await deleteRetainedTextBatch(
            ctx,
            staged._id,
            staged.key,
            DOSSIER_PURGE_BATCH,
        );
    else await ctx.db.delete(sessionId);
    return true;
}

/** Ordered children-first steps; each deletes at most one batch for one dossier. */
const steps: Record<
    string,
    (ctx: MutationCtx, runId: RunId) => Promise<boolean>
> = {
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
    claims: async (ctx, runId) => {
        const parents = await ctx.db
            .query("claims")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .take(DOSSIER_PURGE_BATCH);
        for (const claim of parents) {
            const rows = await ctx.db
                .query("claimEvidence")
                .withIndex("by_claim", (q) => q.eq("claimId", claim._id))
                .take(DOSSIER_PURGE_BATCH);
            if (rows.length) return drop(ctx, rows).then(() => true);
        }
        return drop(ctx, parents);
    },
    sourceVersions: async (ctx, runId) => {
        const parents = await ctx.db
            .query("sourceVersions")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .take(DOSSIER_PURGE_BATCH);
        for (const version of parents) {
            const rows = await ctx.db
                .query("sourcePassages")
                .withIndex("by_source_version_and_order", (q) =>
                    q.eq("sourceVersionId", version._id),
                )
                .take(DOSSIER_PURGE_BATCH);
            if (rows.length) return drop(ctx, rows).then(() => true);
        }
        return drop(ctx, parents, (row) => releaseStorage(ctx, row.storageId));
    },
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
    sources: async (ctx, runId) => {
        const parents = await ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (q) => q.eq("runId", runId))
            .take(DOSSIER_PURGE_BATCH);
        for (const source of parents) {
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
                .take(purgePayloadChildren);
            if (captures.length)
                return drop(ctx, captures, (row) =>
                    releaseStorage(ctx, row.storageId),
                ).then(() => true);
        }
        return drop(ctx, parents);
    },
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
    corpusRevisions: async (ctx, runId) => {
        const revisions = await ctx.db
            .query("corpusRevisions")
            .withIndex("by_run_and_revision", (q) => q.eq("runId", runId))
            .take(DOSSIER_PURGE_BATCH);
        for (const revision of revisions) {
            const reviewItems = await ctx.db
                .query("sourceReviewItems")
                .withIndex("by_revision_and_source", (q) =>
                    q.eq("corpusRevisionId", revision._id),
                )
                .take(purgePayloadChildren);
            if (reviewItems.length)
                return drop(ctx, reviewItems).then(() => true);
            const proposals = await ctx.db
                .query("sourceSelectionProposals")
                .withIndex("by_corpus_revision_id_and_version", (q) =>
                    q.eq("corpusRevisionId", revision._id),
                )
                .take(DOSSIER_PURGE_BATCH);
            for (const proposal of proposals) {
                const items = await ctx.db
                    .query("sourceSelectionProposalItems")
                    .withIndex("by_proposal_and_source", (q) =>
                        q.eq("proposalId", proposal._id),
                    )
                    .take(DOSSIER_PURGE_BATCH);
                if (items.length) return drop(ctx, items).then(() => true);
            }
            if (proposals.length) return drop(ctx, proposals).then(() => true);
            const preparations = await ctx.db
                .query("sourceSelectionProposalRebuilds")
                .withIndex("by_revision_and_created_at", (q) =>
                    q.eq("corpusRevisionId", revision._id),
                )
                .take(purgePayloadChildren);
            if (preparations.length)
                return drop(ctx, preparations).then(() => true);
        }
        return drop(ctx, revisions);
    },
    aiTaskResults: async (ctx, runId) => {
        const { page, isDone } = await ctx.db
            .query("aiTaskResults")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .paginate(purgeParentPage);
        await drop(ctx, page);
        return !isDone;
    },
    providerCalls: async (ctx, runId) => {
        const { page, isDone } = await ctx.db
            .query("providerCalls")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .paginate(purgeParentPage);
        await drop(ctx, page);
        return !isDone;
    },
    agentExecutionEvents: async (ctx, runId) => {
        const { page: events, isDone } = await ctx.db
            .query("agentExecutionEvents")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .paginate(purgeParentPage);
        for (const event of events) {
            if (!event.contextObservation) continue;
            if (event.nativeInputSequence === undefined)
                throw executionError("journal_payload_invalid");
            if (
                !(await deleteRetainedTextBatch(
                    ctx,
                    event.contextObservation.textId,
                    contextObservationTextKey(runId, event.nativeInputSequence),
                    DOSSIER_PURGE_BATCH,
                ))
            )
                return true;
            await ctx.db.delete(event._id);
            return true;
        }
        await drop(ctx, events);
        return !isDone;
    },
    agentOperationRequests: (ctx, runId) =>
        purgeDossierOperationBatch(ctx, runId, DOSSIER_PURGE_BATCH),
    agentInvocations: async (ctx, runId) => {
        const { page: invocations, isDone } = await ctx.db
            .query("agentInvocations")
            .withIndex("by_run_and_task_key", (q) => q.eq("runId", runId))
            .paginate(purgeParentPage);
        for (const invocation of invocations) {
            if (await purgeInvocationJournalBatch(ctx, invocation._id))
                return true;
            for (const field of [
                "receivedOutputTextId",
                "outputTextId",
                "rawOutputTextId",
                "inputTextId",
            ] as const) {
                const id = invocation[field];
                if (!id) continue;
                const text = await ctx.db.get(id);
                const key =
                    field === "inputTextId"
                        ? `${invocation._id}:input`
                        : field === "rawOutputTextId"
                          ? `${invocation._id}:raw_output`
                          : `${invocation._id}:response:${text?.contentHash}`;
                if (
                    text &&
                    !(await deleteRetainedTextBatch(
                        ctx,
                        id,
                        key,
                        DOSSIER_PURGE_BATCH,
                    ))
                )
                    return true;
                await ctx.db.patch(invocation._id, { [field]: undefined });
                return true;
            }
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
        await drop(ctx, invocations);
        return !isDone;
    },
    workbenchInstructions: async (ctx, runId) =>
        drop(
            ctx,
            await ctx.db
                .query("workbenchInstructions")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .take(DOSSIER_PURGE_BATCH),
        ),
    agentMessageDeliveries: async (ctx, runId) => {
        const { page: deliveries, isDone } = await ctx.db
            .query("agentMessageDeliveries")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .paginate(purgeParentPage);
        for (const delivery of deliveries) {
            if (
                delivery.storageMigrationCopy &&
                delivery.storageMigrationCopy.textId !== delivery.bodyTextId
            ) {
                const done = await deleteRetainedTextBatch(
                    ctx,
                    delivery.storageMigrationCopy.textId,
                    deliveryMigrationTextKey(delivery._id),
                    DOSSIER_PURGE_BATCH,
                );
                if (done)
                    await ctx.db.patch(delivery._id, {
                        storageMigrationCopy: undefined,
                    });
                return true;
            }
            if (!delivery.bodyTextId) continue;
            const turn = delivery.turnId
                ? await ctx.db.get(delivery.turnId)
                : null;
            const mission = turn?.missionId
                ? await ctx.db.get(turn.missionId)
                : null;
            if (
                mission &&
                "protocolVersion" in mission &&
                mission.textualOutcome?.textId === delivery.bodyTextId
            ) {
                await ctx.db.delete(delivery._id);
                return true;
            }
            if (
                !(await deleteRetainedTextBatch(
                    ctx,
                    delivery.bodyTextId,
                    retainedDeliveryKey(delivery),
                    DOSSIER_PURGE_BATCH,
                ))
            )
                return true;
            await ctx.db.delete(delivery._id);
            return true;
        }
        await drop(ctx, deliveries);
        return !isDone;
    },
    agentConversationTurns: async (ctx, runId) => {
        const { page, isDone } = await ctx.db
            .query("agentConversationTurns")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .paginate(purgeParentPage);
        await drop(ctx, page);
        return !isDone;
    },
    agentMissions: async (ctx, runId) => {
        const { page: missions, isDone } = await ctx.db
            .query("agentMissions")
            .withIndex("by_run_and_status", (q) => q.eq("runId", runId))
            .paginate(purgeParentPage);
        for (const mission of missions) {
            const session = await ctx.db
                .query("piSessions")
                .withIndex("by_mission", (q) => q.eq("missionId", mission._id))
                .first();
            if (session) return dropSession(ctx, session._id);

            if (
                "protocolVersion" in mission &&
                mission.legacyTextualResultCopy
            ) {
                const staged = mission.legacyTextualResultCopy.textId;
                if (
                    staged !== mission.textualOutcome?.textId &&
                    !(await deleteRetainedTextBatch(
                        ctx,
                        staged,
                        missionTextualResultKey(mission._id),
                        DOSSIER_PURGE_BATCH,
                    ))
                )
                    return true;
                await ctx.db.patch(mission._id, {
                    legacyTextualResultCopy: undefined,
                });
                return true;
            }
            if ("protocolVersion" in mission && mission.textualOutcome) {
                const textId = mission.textualOutcome.textId;
                const delivery = await ctx.db
                    .query("agentMessageDeliveries")
                    .withIndex("by_body_text", (q) =>
                        q.eq("bodyTextId", textId),
                    )
                    .first();
                if (
                    !delivery &&
                    !(await deleteRetainedTextBatch(
                        ctx,
                        textId,
                        textualOutcomeKey(mission),
                        DOSSIER_PURGE_BATCH,
                    ))
                )
                    return true;
                await ctx.db.patch(mission._id, { textualOutcome: undefined });
                return true;
            }
            if (!("protocolVersion" in mission) || !mission.resultTextId)
                continue;
            if (
                !(await deleteRetainedTextBatch(
                    ctx,
                    mission.resultTextId,
                    `${mission._id}:result`,
                    DOSSIER_PURGE_BATCH,
                ))
            )
                return true;
            await ctx.db.patch(mission._id, { resultTextId: undefined });
            return true;
        }
        await drop(ctx, missions);
        return !isDone;
    },
    agentConversations: async (ctx, runId) => {
        const conversations = await ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .take(DOSSIER_PURGE_BATCH);
        for (const conversation of conversations) {
            const session = await ctx.db
                .query("piSessions")
                .withIndex("by_conversation", (q) =>
                    q.eq("conversationId", conversation._id),
                )
                .first();
            if (session) return dropSession(ctx, session._id);
        }
        return drop(ctx, conversations);
    },
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
        const started = await ctx.db
            .query("auditEvents")
            .withIndex("by_target", (q) =>
                q.eq("targetType", "research_run").eq("targetId", run._id),
            )
            .filter((q) => q.eq(q.field("action"), "dossier_purged"))
            .first();
        if (started && run.withdrawnAt !== undefined) return null;
        const now = Date.now();
        if (
            run.executionStatus !== "cancelled" &&
            run.executionStatus !== "completed"
        )
            await cancelRunExecution(ctx, run);
        else if (
            run.executionStatus === "completed" &&
            run.withdrawnAt === undefined
        )
            await cancelAgentMissionsForRun(
                ctx,
                run._id,
                now,
                run.executionGeneration,
            );
        await ctx.db.patch(run._id, {
            withdrawnAt: run.withdrawnAt ?? now,
            updatedAt: now,
        });
        if (
            !started &&
            run.reservationStatus === "consumed" &&
            run.withdrawnAt === undefined &&
            run.ownerVisitorId
        ) {
            const owner = await ctx.db.get(run.ownerVisitorId);
            if (owner && owner.analysesReserved > 0)
                await ctx.db.patch(owner._id, {
                    analysesReserved: owner.analysesReserved - 1,
                });
        }
        if (!started)
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
