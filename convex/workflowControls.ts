import type { WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation } from "./_generated/server";
import { cancelRunExecution } from "./domain/runCancellation";
import { sourcePreparationEnabled } from "./resourceLimits";
import { requireWorkspaceRun } from "./runWorkspace";
import {
    assessmentReviewApproved,
    sourceReviewApproved,
    workflow,
} from "./workflow";

export const startReserved = internalMutation({
    args: { runId: v.id("researchRuns") },
    returns: v.string(),
    handler: async (ctx, args): Promise<string> => {
        const run = await ctx.db.get(args.runId);
        if (run?.reservationStatus !== "consumed") {
            throw new Error("Active analysis reservation not found");
        }
        if (
            !run.companyId ||
            !run.companyPreflightId ||
            !run.activeCorpusRevisionId
        ) {
            throw new Error("A confirmed company reservation is required");
        }
        if (
            run.lifecycleState !== "draft" ||
            run.executionStatus !== "idle" ||
            run.workflowId
        ) {
            throw new Error("Research run cannot be started");
        }
        const concurrent = await ctx.db
            .query("researchRuns")
            .withIndex("by_owner_and_execution_status", (query) =>
                query
                    .eq("ownerVisitorId", run.ownerVisitorId)
                    .eq("executionStatus", "running"),
            )
            .first();
        if (concurrent) {
            throw new Error("A research workflow is already running");
        }
        const executionGeneration = run.executionGeneration + 1;
        const workflowId = await workflow.start(
            ctx,
            internal.researchWorkflow.run,
            {
                runId: run._id,
                executionGeneration,
                prepareSources: sourcePreparationEnabled(),
            },
            {
                onComplete: internal.researchWorkflow.onComplete,
                context: { runId: run._id },
            },
        );
        await ctx.db.patch(run._id, {
            workflowId,
            workflowVersion: 2,
            executionStatus: "running",
            executionGeneration,
            updatedAt: Date.now(),
        });
        return workflowId;
    },
});

export const approveCheckpoint = mutation({
    args: {
        runId: v.id("researchRuns"),
        checkpoint: v.union(
            v.literal("source_review"),
            v.literal("assessment_review"),
        ),
        decisionKey: v.string(),
    },
    returns: v.object({ accepted: v.boolean() }),
    handler: async (ctx, args) => {
        const { visitor, run } = await requireWorkspaceRun(ctx, args.runId);
        if (
            !run.workflowId ||
            run.executionStatus !== "paused" ||
            run.pauseReason !== args.checkpoint
        ) {
            throw new Error("Research run is not awaiting this checkpoint");
        }
        const decisionKey = args.decisionKey.trim();
        if (decisionKey.length === 0 || decisionKey.length > 128) {
            throw new Error("Invalid decision key");
        }
        const existing = await ctx.db
            .query("checkpointDecisions")
            .withIndex("by_run_and_decision_key", (query) =>
                query.eq("runId", run._id).eq("decisionKey", decisionKey),
            )
            .unique();
        if (existing) {
            if (existing.checkpoint !== args.checkpoint) {
                throw new Error(
                    "Decision key already belongs to another checkpoint",
                );
            }
            return { accepted: false };
        }
        const previousDecision = await ctx.db
            .query("checkpointDecisions")
            .withIndex("by_run_and_checkpoint", (query) =>
                query.eq("runId", run._id).eq("checkpoint", args.checkpoint),
            )
            .unique();
        if (previousDecision) {
            return { accepted: false };
        }

        const now = Date.now();
        const decisionId = await ctx.db.insert("checkpointDecisions", {
            runId: run._id,
            checkpoint: args.checkpoint,
            decisionKey,
            reviewerVisitorId: visitor._id,
            decision: "approved",
            occurredAt: now,
        });
        const event =
            args.checkpoint === "source_review"
                ? sourceReviewApproved
                : assessmentReviewApproved;
        await workflow.sendEvent(ctx, {
            ...event,
            workflowId: run.workflowId as WorkflowId,
            value: { decisionId },
        });
        await ctx.db.insert("auditEvents", {
            actor: { type: "visitor", visitorId: visitor._id },
            action: "checkpoint_decided",
            targetType: "research_run",
            targetId: run._id,
            occurredAt: now,
        });
        return { accepted: true };
    },
});

export const cancel = mutation({
    args: { runId: v.id("researchRuns") },
    returns: v.object({ cancelled: v.boolean() }),
    handler: async (ctx, args) => {
        const { run } = await requireWorkspaceRun(ctx, args.runId);
        return cancelRunExecution(ctx, run);
    },
});

export const failCheckpoint = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        checkpoint: v.union(
            v.literal("source_review"),
            v.literal("assessment_review"),
        ),
        error: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (
            !run?.workflowId ||
            run.executionStatus !== "paused" ||
            run.pauseReason !== args.checkpoint
        ) {
            throw new Error("Research run is not awaiting this checkpoint");
        }
        const event =
            args.checkpoint === "source_review"
                ? sourceReviewApproved
                : assessmentReviewApproved;
        await workflow.sendEvent(ctx, {
            name: event.name,
            workflowId: run.workflowId as WorkflowId,
            error: args.error,
        });
        return null;
    },
});

export const retry = mutation({
    args: { runId: v.id("researchRuns") },
    returns: v.object({ retryCount: v.number() }),
    handler: async (ctx, args) => {
        const { run } = await requireWorkspaceRun(ctx, args.runId);
        if (
            run.executionStatus !== "failed" ||
            !run.workflowId ||
            !run.pauseReason
        ) {
            throw new Error("Only a failed checkpoint workflow can be retried");
        }
        const retryCount = run.retryCount ?? 0;
        if (retryCount >= 2) {
            throw new Error("Retry limit reached");
        }

        const eventName =
            run.pauseReason === "source_review"
                ? sourceReviewApproved.name
                : assessmentReviewApproved.name;
        await workflow.restart(ctx, run.workflowId as WorkflowId, {
            from: eventName,
            startAsync: true,
        });
        const now = Date.now();
        await ctx.db.patch(run._id, {
            executionStatus: "paused",
            executionGeneration: run.executionGeneration + 1,
            retryCount: retryCount + 1,
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: now,
        });
        await ctx.db.insert("runEvents", {
            runId: run._id,
            sequence: run.nextEventSequence + 1,
            type: "run_retried",
            lifecycleState: run.lifecycleState,
            executionStatus: "paused",
            occurredAt: now,
        });
        return { retryCount: retryCount + 1 };
    },
});
