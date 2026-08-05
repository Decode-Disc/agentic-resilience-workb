import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import { rateLimiter } from "./rateLimiter";

const serviceValidator = v.union(
    v.literal("sec"),
    v.literal("exa"),
    v.literal("url_metadata"),
);
const providerCallStatusValidator = v.union(
    v.literal("started"),
    v.literal("succeeded"),
    v.literal("failed"),
);

export const reserveSecRateLimit = internalMutation({
    args: {},
    returns: v.object({ retryAfter: v.optional(v.number()) }),
    handler: async (ctx, _args) => {
        const { retryAfter } = await rateLimiter.limit(ctx, "secRequests");
        return { retryAfter };
    },
});

export const recordAttempt = internalMutation({
    args: {
        runId: v.optional(v.id("researchRuns")),
        corpusRevisionId: v.optional(v.id("corpusRevisions")),
        executionGeneration: v.optional(v.number()),
        workflowVersion: v.optional(v.number()),
        stepKey: v.optional(v.string()),
        service: serviceValidator,
        operation: v.string(),
        operationKey: v.string(),
        status: providerCallStatusValidator,
        attempt: v.number(),
        latencyMs: v.optional(v.number()),
        usage: v.optional(v.any()),
        reportedCost: v.optional(v.number()),
        errorCode: v.optional(v.string()),
    },
    returns: v.object({
        providerCallId: v.id("providerCalls"),
        shouldExecute: v.boolean(),
        status: providerCallStatusValidator,
    }),
    handler: async (ctx, args) => {
        if (args.service === "exa" && args.status === "started") {
            const paidWork = await ctx.db
                .query("paidWorkControls")
                .withIndex("by_key", (query) => query.eq("key", "global"))
                .unique();
            if (paidWork?.enabled === false) {
                throw new Error("Paid provider work is disabled");
            }
        }
        const matches = await ctx.db
            .query("providerCalls")
            .withIndex("by_operation_key", (query) =>
                query.eq("operationKey", args.operationKey),
            )
            .collect();
        const existing = matches.find(
            (call) =>
                call.service === args.service &&
                call.operation === args.operation &&
                call.attempt === args.attempt &&
                call.runId === args.runId,
        );
        const now = Date.now();
        if (args.status === "started") {
            if (existing) {
                return {
                    providerCallId: existing._id,
                    shouldExecute: false,
                    status: existing.status,
                };
            }
            if (args.runId) {
                const run = await ctx.db.get(args.runId);
                const executionIsActive =
                    args.service === "url_metadata"
                        ? run?.executionStatus === "paused" &&
                          [
                              "awaiting_evidence_sufficiency_review",
                              "awaiting_source_review",
                          ].includes(run.lifecycleState)
                        : run?.executionStatus === "running";
                if (
                    !run ||
                    args.executionGeneration === undefined ||
                    run.executionGeneration !== args.executionGeneration ||
                    !executionIsActive
                ) {
                    throw new Error("Research execution is no longer active");
                }
            }
            const providerCallId = await ctx.db.insert("providerCalls", {
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                executionGeneration: args.executionGeneration,
                workflowVersion: args.workflowVersion,
                stepKey: args.stepKey,
                service: args.service,
                operation: args.operation,
                operationKey: args.operationKey,
                status: "started",
                attempt: args.attempt,
                createdAt: now,
            });
            return {
                providerCallId,
                shouldExecute: true,
                status: "started" as const,
            };
        }
        if (!existing) {
            throw new Error("Provider attempt was not started");
        }
        await ctx.db.patch(existing._id, {
            status: args.status,
            latencyMs: args.latencyMs,
            usage: args.usage,
            reportedCost: args.reportedCost,
            errorCode: args.errorCode,
            completedAt: now,
        });
        return {
            providerCallId: existing._id,
            shouldExecute: false,
            status: args.status,
        };
    },
});

export const getSucceededUrlMetadata = internalQuery({
    args: { operationKey: v.string() },
    returns: v.union(
        v.object({
            canonicalUrl: v.string(),
            title: v.string(),
        }),
        v.null(),
    ),
    handler: async (ctx, args) => {
        const calls = await ctx.db
            .query("providerCalls")
            .withIndex("by_operation_key", (query) =>
                query.eq("operationKey", args.operationKey),
            )
            .collect();
        const succeeded = calls.find(
            (call) =>
                call.service === "url_metadata" &&
                call.operation === "inspect_launch_manual_source" &&
                call.status === "succeeded",
        );
        const usage = succeeded?.usage;
        if (
            !usage ||
            typeof usage !== "object" ||
            typeof usage.canonicalUrl !== "string" ||
            typeof usage.title !== "string"
        ) {
            return null;
        }
        return {
            canonicalUrl: usage.canonicalUrl,
            title: usage.title,
        };
    },
});

export const recordConfigurationFailure = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        executionGeneration: v.number(),
        service: serviceValidator,
        operation: v.string(),
        operationKey: v.string(),
        errorCode: v.string(),
    },
    returns: v.id("providerCalls"),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (
            !run ||
            run.executionGeneration !== args.executionGeneration ||
            run.executionStatus !== "running"
        ) {
            throw new Error("Research execution is no longer active");
        }
        const existing = await ctx.db
            .query("providerCalls")
            .withIndex("by_operation_key", (query) =>
                query.eq("operationKey", args.operationKey),
            )
            .first();
        if (existing) {
            return existing._id;
        }
        const now = Date.now();
        return ctx.db.insert("providerCalls", {
            runId: run._id,
            service: args.service,
            operation: args.operation,
            operationKey: args.operationKey,
            status: "failed",
            attempt: 0,
            errorCode: args.errorCode,
            createdAt: now,
            completedAt: now,
        });
    },
});
