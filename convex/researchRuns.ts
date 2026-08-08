import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { mergeRunCompanyMetadata } from "./domain/companyMetadata";
import { assertLifecycleTransition } from "./domain/transitions";
import {
    executionStatusValidator,
    researchRunLifecycleValidator,
    workflowStepKeyValidator,
} from "./domain/validators";

export const createDraft = internalMutation({
    args: {},
    returns: v.id("researchRuns"),
    handler: async (ctx) => {
        const now = Date.now();
        const runId = await ctx.db.insert("researchRuns", {
            executionGeneration: 0,
            lifecycleState: "draft",
            executionStatus: "idle",
            nextEventSequence: 1,
            createdAt: now,
            updatedAt: now,
        });
        await ctx.db.insert("runEvents", {
            runId,
            sequence: 1,
            type: "run_created",
            lifecycleState: "draft",
            executionStatus: "idle",
            occurredAt: now,
        });
        return runId;
    },
});

export const transition = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        expectedExecutionGeneration: v.number(),
        lifecycleState: researchRunLifecycleValidator,
        executionStatus: executionStatusValidator,
        stepKey: workflowStepKeyValidator,
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run) {
            throw new Error("Research run not found");
        }
        if (run.executionGeneration !== args.expectedExecutionGeneration) {
            throw new Error("Stale research execution generation");
        }
        if (
            run.executionStatus === "cancelled" ||
            run.executionStatus === "failed"
        ) {
            throw new Error("Research run execution is terminal");
        }
        assertLifecycleTransition(
            run.lifecycleState,
            args.lifecycleState,
            args.executionStatus,
        );

        const now = Date.now();
        const pauseReason =
            args.lifecycleState === "awaiting_evidence_sufficiency_review"
                ? ("evidence_sufficiency_review" as const)
                : args.lifecycleState === "awaiting_source_review"
                  ? ("source_review" as const)
                  : args.lifecycleState === "awaiting_assessment_review"
                    ? ("assessment_review" as const)
                    : undefined;
        await ctx.db.patch(args.runId, {
            lifecycleState: args.lifecycleState,
            executionStatus: args.executionStatus,
            pauseReason,
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: now,
        });
        const previousSteps = await ctx.db
            .query("workflowSteps")
            .withIndex("by_run_and_key", (query) =>
                query.eq("runId", args.runId),
            )
            .collect();
        for (const step of previousSteps) {
            if (step.state === "running") {
                await ctx.db.patch(step._id, {
                    state: "completed",
                    completedAt: now,
                    updatedAt: now,
                });
            }
        }
        await ctx.db.insert("workflowSteps", {
            runId: args.runId,
            key: args.stepKey,
            state:
                args.executionStatus === "paused"
                    ? "needs_review"
                    : args.executionStatus === "completed" ||
                        args.executionStatus === "idle"
                      ? "completed"
                      : "running",
            attempt: 1,
            startedAt: now,
            completedAt:
                args.executionStatus === "completed" ||
                args.executionStatus === "idle"
                    ? now
                    : undefined,
            updatedAt: now,
        });
        await ctx.db.insert("runEvents", {
            runId: args.runId,
            sequence: run.nextEventSequence + 1,
            type: "run_transitioned",
            lifecycleState: args.lifecycleState,
            executionStatus: args.executionStatus,
            stepKey: args.stepKey,
            occurredAt: now,
        });
        return null;
    },
});

export const get = internalQuery({
    args: { runId: v.id("researchRuns") },
    handler: async (ctx, args) => ctx.db.get(args.runId),
});

export const listEvents = internalQuery({
    args: { runId: v.id("researchRuns") },
    handler: async (ctx, args) =>
        ctx.db
            .query("runEvents")
            .withIndex("by_run_and_sequence", (query) =>
                query.eq("runId", args.runId),
            )
            .collect(),
});

export const listSteps = internalQuery({
    args: { runId: v.id("researchRuns") },
    handler: async (ctx, args) =>
        ctx.db
            .query("workflowSteps")
            .withIndex("by_run_and_key", (builder) =>
                builder.eq("runId", args.runId),
            )
            .collect(),
});

export const listMyEvents = query({
    args: { runId: v.id("researchRuns") },
    handler: async (ctx, args) => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            throw new Error("Not authenticated");
        }
        const visitor = await ctx.db
            .query("visitors")
            .withIndex("by_auth_user_id", (builder) =>
                builder.eq("authUserId", authUserId),
            )
            .unique();
        const run = await ctx.db.get(args.runId);
        if (
            visitor?.status !== "active" ||
            run?.ownerVisitorId !== visitor._id
        ) {
            throw new Error("Unauthorized");
        }
        return ctx.db
            .query("runEvents")
            .withIndex("by_run_and_sequence", (builder) =>
                builder.eq("runId", run._id),
            )
            .collect();
    },
});

async function getActiveVisitor(ctx: QueryCtx) {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) {
        throw new Error("Not authenticated");
    }
    const visitor = await ctx.db
        .query("visitors")
        .withIndex("by_auth_user_id", (builder) =>
            builder.eq("authUserId", authUserId),
        )
        .unique();
    if (visitor?.status !== "active") {
        throw new Error("Unauthorized");
    }
    return visitor;
}

async function projectRun(ctx: QueryCtx, run: Doc<"researchRuns">) {
    const company = run.companyId ? await ctx.db.get(run.companyId) : null;
    const companySnapshot = mergeRunCompanyMetadata(
        run.companySnapshot,
        company,
    );
    const providerFailures = (await ctx.db.query("providerCalls").collect())
        .filter((call) => call.runId === run._id && call.status === "failed")
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, 5)
        .map((call) => ({
            service: call.service,
            operation: call.operation,
            errorCode: call.errorCode,
            occurredAt: call.completedAt ?? call.createdAt,
        }));
    return {
        runId: run._id,
        company: companySnapshot
            ? {
                  legalName: companySnapshot.legalName,
                  ticker: companySnapshot.ticker,
                  exchange: companySnapshot.exchange,
                  cik: companySnapshot.cik,
                  investorRelationsUrl: companySnapshot.investorRelationsUrl,
                  websiteUrl: companySnapshot.websiteUrl,
                  websiteUrlSource: companySnapshot.websiteUrlSource,
              }
            : null,
        lifecycleState: run.lifecycleState,
        executionStatus: run.executionStatus,
        pauseReason: run.pauseReason,
        coveragePreset: run.coveragePreset,
        researchAngle: run.researchAngle,
        activeCorpusRevisionId: run.activeCorpusRevisionId,
        completionOutcome: run.completionOutcome,
        updatedAt: run.updatedAt,
        providerFailures,
    };
}

export const getMine = query({
    args: { runId: v.id("researchRuns") },
    handler: async (ctx, args) => {
        const visitor = await getActiveVisitor(ctx);
        const run = await ctx.db.get(args.runId);
        if (run?.ownerVisitorId !== visitor._id) {
            throw new Error("Unauthorized");
        }
        return projectRun(ctx, run);
    },
});

export const listMine = query({
    args: {},
    handler: async (ctx) => {
        const visitor = await getActiveVisitor(ctx);
        const runs = await ctx.db
            .query("researchRuns")
            .withIndex("by_owner_and_execution_status", (builder) =>
                builder.eq("ownerVisitorId", visitor._id),
            )
            .collect();
        return Promise.all(
            runs
                .sort((left, right) => right.updatedAt - left.updatedAt)
                .map((run) => projectRun(ctx, run)),
        );
    },
});

export const listAnalyzedCompanies = listMine;
