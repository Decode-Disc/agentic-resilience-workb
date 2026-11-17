import { recordContextObservation } from "@convex/execution/journal";
import type { WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { evaluatePublicEvidenceAvailability } from "./domain/evidenceAvailabilityPolicy";
import { claimPausedRunExecution } from "./domain/executionClaim";
import { requireWorkspaceRun } from "./runWorkspace";
import { evidenceSufficiencyDecided, workflow } from "./workflow";

const evaluationResultValidator = v.object({
    policyVersion: v.literal("public-evidence-v1"),
    secFilingCount: v.number(),
    investorRelationsPresent: v.boolean(),
    manualCandidateCount: v.number(),
    outcome: v.union(v.literal("sufficient"), v.literal("insufficient")),
    reasons: v.array(v.literal("no_public_evidence_candidates")),
});

export const evaluateForRun = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        expectedExecutionGeneration: v.number(),
        secFilingCount: v.number(),
        investorRelationsPresent: v.boolean(),
    },
    returns: evaluationResultValidator,
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (run?.executionGeneration !== args.expectedExecutionGeneration) {
            throw new Error("Stale research execution generation");
        }
        if (
            run?.lifecycleState !== "checking_public_evidence" ||
            run.executionStatus !== "running"
        ) {
            throw new Error("Research run is not checking public evidence");
        }
        const sources = await ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (query) =>
                query.eq("runId", args.runId),
            )
            .collect();
        const evaluation = evaluatePublicEvidenceAvailability({
            secFilingCount: args.secFilingCount,
            investorRelationsPresent: args.investorRelationsPresent,
            manualCandidateCount: sources.filter(
                (source) => source.origin === "analyst_url",
            ).length,
        });
        const now = Date.now();
        await ctx.db.insert("evidenceAvailabilityEvaluations", {
            runId: args.runId,
            ...evaluation,
            reasons: [...evaluation.reasons],
            createdAt: now,
        });
        await ctx.db.patch(run._id, {
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: now,
        });
        await ctx.db.insert("runEvents", {
            runId: run._id,
            sequence: run.nextEventSequence + 1,
            type: "evidence_sufficiency_evaluated",
            lifecycleState: run.lifecycleState,
            executionStatus: run.executionStatus,
            messageKey:
                evaluation.outcome === "sufficient"
                    ? "public_evidence_sufficient"
                    : "public_evidence_insufficient",
            occurredAt: now,
        });
        return { ...evaluation, reasons: [...evaluation.reasons] };
    },
});

export const completeInsufficient = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        expectedExecutionGeneration: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (run?.executionGeneration !== args.expectedExecutionGeneration) {
            throw new Error("Stale research execution generation");
        }
        if (
            run?.lifecycleState !== "awaiting_evidence_sufficiency_review" ||
            run.executionStatus !== "paused"
        ) {
            throw new Error(
                "Research run is not awaiting evidence sufficiency review",
            );
        }
        const now = Date.now();
        await ctx.db.patch(run._id, {
            lifecycleState: "completed",
            executionStatus: "completed",
            completionOutcome: "insufficient_public_evidence",
            pauseReason: undefined,
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: now,
        });
        await ctx.db.insert("workflowSteps", {
            runId: run._id,
            key: "evidence_sufficiency_review",
            state: "completed",
            attempt: 1,
            startedAt: now,
            completedAt: now,
            updatedAt: now,
        });
        await ctx.db.insert("runEvents", {
            runId: run._id,
            sequence: run.nextEventSequence + 1,
            type: "run_transitioned",
            lifecycleState: "completed",
            executionStatus: "completed",
            stepKey: "evidence_sufficiency_review",
            messageKey: "insufficient_public_evidence_completed",
            occurredAt: now,
        });
        return null;
    },
});

const sufficiencyDecisionValidator = v.union(
    v.object({
        kind: v.literal("recheck"),
        decisionKey: v.string(),
    }),
    v.object({
        kind: v.literal("force_continue"),
        decisionKey: v.string(),
        reason: v.string(),
    }),
    v.object({
        kind: v.literal("complete_insufficient"),
        decisionKey: v.string(),
        reason: v.string(),
    }),
);

export const decide = mutation({
    args: {
        runId: v.id("researchRuns"),
        decision: sufficiencyDecisionValidator,
    },
    returns: v.object({ accepted: v.boolean() }),
    handler: async (ctx, args) => {
        const { visitor, run } = await requireWorkspaceRun(ctx, args.runId);
        if (
            !run.workflowId ||
            run.lifecycleState !== "awaiting_evidence_sufficiency_review" ||
            run.executionStatus !== "paused" ||
            run.pauseReason !== "evidence_sufficiency_review"
        ) {
            throw new Error(
                "Research run is not awaiting evidence sufficiency review",
            );
        }
        const decisionKey = args.decision.decisionKey.trim();
        if (decisionKey.length === 0 || decisionKey.length > 128) {
            throw new Error("Invalid decision key");
        }
        const reason =
            args.decision.kind === "recheck"
                ? undefined
                : args.decision.reason.trim();
        if (reason !== undefined && reason.length < 12) {
            throw new Error(
                "Decision reason must contain at least 12 characters",
            );
        }
        const existing = await ctx.db
            .query("checkpointDecisions")
            .withIndex("by_run_and_decision_key", (query) =>
                query.eq("runId", run._id).eq("decisionKey", decisionKey),
            )
            .unique();
        if (existing) {
            return { accepted: false };
        }

        const now = Date.now();
        let executionGeneration = run.executionGeneration;
        if (args.decision.kind !== "complete_insufficient") {
            executionGeneration = await claimPausedRunExecution(ctx, {
                visitor,
                run,
                checkpoint: {
                    lifecycleState: "awaiting_evidence_sufficiency_review",
                    pauseReason: "evidence_sufficiency_review",
                },
                now,
            });
        }
        const decisionId = await ctx.db.insert("checkpointDecisions", {
            runId: run._id,
            checkpoint: "evidence_sufficiency_review",
            decisionKey,
            reviewerVisitorId: visitor._id,
            decision: args.decision.kind,
            reason,
            occurredAt: now,
        });
        await workflow.sendEvent(ctx, {
            ...evidenceSufficiencyDecided,
            workflowId: run.workflowId as WorkflowId,
            value: {
                kind: args.decision.kind,
                decisionId,
                executionGeneration,
            },
        });
        await ctx.db.insert("auditEvents", {
            actor: { type: "visitor", visitorId: visitor._id },
            action:
                args.decision.kind === "force_continue"
                    ? "evidence_sufficiency_overridden"
                    : args.decision.kind === "complete_insufficient"
                      ? "evidence_sufficiency_completed"
                      : "checkpoint_decided",
            targetType: "research_run",
            targetId: run._id,
            reason,
            occurredAt: now,
        });
        await recordContextObservation(ctx, run._id, {
            key: `checkpoint-decision:${decisionId}`,
            topic: "analyst_decision",
            actor: { type: "visitor", visitorId: visitor._id },
            value: {
                event: "evidence_sufficiency_decided",
                decisionId,
                decision: args.decision.kind,
                reason: reason ?? null,
                executionGeneration,
            },
        });
        return { accepted: true };
    },
});
