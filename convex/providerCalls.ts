import { ConvexError, v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import { assertEvidenceExecutionFence } from "./domain/evidenceAuthority";
import { manualSourceIntakeError } from "./domain/manualSourceIntake";
import { rateLimiter } from "./rateLimiter";

const serviceValidator = v.union(
    v.literal("sec"),
    v.literal("exa"),
    v.literal("url_metadata"),
    v.literal("pdf"),
);
const providerCallStatusValidator = v.union(
    v.literal("started"),
    v.literal("succeeded"),
    v.literal("partial"),
    v.literal("failed"),
);

const PROVIDER_LEASE_MS = {
    sec: 15_000,
    exa: 15_000,
    url_metadata: 15_000,
    pdf: 15_000,
} as const;

function providerLeaseDurationMs(
    service: "sec" | "exa" | "url_metadata" | "pdf",
    operation: string,
): number {
    if (service === "exa" && operation === "get_contents") {
        return 150_000;
    }
    if (service === "exa" && operation === "resolve_company_website") {
        return 10_000;
    }
    return PROVIDER_LEASE_MS[service];
}

export const reserveSecRateLimit = internalMutation({
    args: {},
    returns: v.object({ retryAfter: v.optional(v.number()) }),
    handler: async (ctx, _args) => {
        const { retryAfter } = await rateLimiter.limit(ctx, "secRequests");
        return { retryAfter };
    },
});

export const reserveExaWebsiteRateLimit = internalMutation({
    args: { authUserId: v.id("users") },
    returns: v.null(),
    handler: async (ctx, args) => {
        const globalStatus = await rateLimiter.limit(ctx, "exaWebsiteGlobal");
        const sessionStatus = await rateLimiter.limit(
            ctx,
            "exaWebsitePerUser",
            { key: `auth:${args.authUserId}` },
        );
        if (!globalStatus.ok || !sessionStatus.ok) {
            throw new Error("Exa website enrichment rate limit reached");
        }
        return null;
    },
});

export const reserveSourceMetadataRateLimit = internalMutation({
    args: { authUserId: v.id("users") },
    returns: v.null(),
    handler: async (ctx, args) => {
        const globalStatus = await rateLimiter.limit(
            ctx,
            "sourceMetadataGlobal",
        );
        const sessionStatus = await rateLimiter.limit(
            ctx,
            "sourceMetadataPerUser",
            { key: `auth:${args.authUserId}` },
        );
        if (!globalStatus.ok || !sessionStatus.ok) {
            throw new ConvexError(
                manualSourceIntakeError("intake_rate_limited").data,
            );
        }
        return null;
    },
});

export const recordAttempt = internalMutation({
    args: {
        runId: v.optional(v.id("researchRuns")),
        corpusRevisionId: v.optional(v.id("corpusRevisions")),
        sourceId: v.optional(v.id("sources")),
        acceptedDecisionId: v.optional(v.id("sourceDecisions")),
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
        retryable: v.optional(v.boolean()),
    },
    returns: v.object({
        providerCallId: v.id("providerCalls"),
        shouldExecute: v.boolean(),
        status: providerCallStatusValidator,
    }),
    handler: async (ctx, args) => {
        const now = Date.now();
        if (
            args.stepKey === "extracting_evidence" ||
            (args.sourceId && args.acceptedDecisionId)
        ) {
            if (
                !args.runId ||
                !args.corpusRevisionId ||
                !args.sourceId ||
                !args.acceptedDecisionId ||
                args.executionGeneration === undefined
            ) {
                throw new Error(
                    "Research execution fence violation: missing required fence arguments",
                );
            }
            await assertEvidenceExecutionFence(ctx.db, {
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                sourceId: args.sourceId,
                acceptedDecisionId: args.acceptedDecisionId,
                executionGeneration: args.executionGeneration,
            });
        }

        if (args.status === "started") {
            if (
                !(
                    args.stepKey === "extracting_evidence" ||
                    (args.sourceId && args.acceptedDecisionId)
                ) &&
                args.runId
            ) {
                const run = await ctx.db.get(args.runId);
                const executionIsActive = args.operation.startsWith(
                    "rebuild_source_proposal_",
                )
                    ? run?.executionStatus === "paused" &&
                      run.lifecycleState === "awaiting_source_review" &&
                      run.pauseReason === "source_review"
                    : args.service === "url_metadata"
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

            if (args.service === "exa") {
                const paidWork = await ctx.db
                    .query("paidWorkControls")
                    .withIndex("by_key", (query) => query.eq("key", "global"))
                    .unique();
                if (paidWork?.enabled === false) {
                    const existing = await ctx.db
                        .query("providerCalls")
                        .withIndex("by_operation_key", (query) =>
                            query.eq("operationKey", args.operationKey),
                        )
                        .first();
                    if (existing) {
                        return {
                            providerCallId: existing._id,
                            shouldExecute: false,
                            status: "failed" as const,
                        };
                    }
                    const providerCallId = await ctx.db.insert(
                        "providerCalls",
                        {
                            runId: args.runId,
                            corpusRevisionId: args.corpusRevisionId,
                            executionGeneration: args.executionGeneration,
                            workflowVersion: args.workflowVersion,
                            stepKey: args.stepKey,
                            service: args.service,
                            operation: args.operation,
                            operationKey: args.operationKey,
                            status: "failed",
                            attempt: args.attempt,
                            errorCode: "paid_work_disabled",
                            createdAt: now,
                            completedAt: now,
                        },
                    );
                    return {
                        providerCallId,
                        shouldExecute: false,
                        status: "failed" as const,
                    };
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
            if (existing) {
                if (
                    existing.status === "started" &&
                    existing.leaseExpiresAt !== undefined &&
                    existing.leaseExpiresAt <= now
                ) {
                    const leaseExpiresAt =
                        now +
                        providerLeaseDurationMs(args.service, args.operation);
                    await ctx.db.patch(existing._id, {
                        leaseExpiresAt,
                        createdAt: now,
                    });
                    return {
                        providerCallId: existing._id,
                        shouldExecute: true,
                        status: "started" as const,
                    };
                }
                return {
                    providerCallId: existing._id,
                    shouldExecute: false,
                    status: existing.status,
                };
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
                leaseExpiresAt:
                    now + providerLeaseDurationMs(args.service, args.operation),
                createdAt: now,
            });
            return {
                providerCallId,
                shouldExecute: true,
                status: "started" as const,
            };
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
        if (!existing) {
            throw new Error("Provider attempt was not started");
        }
        await ctx.db.patch(existing._id, {
            status: args.status,
            latencyMs: args.latencyMs,
            usage: args.usage,
            reportedCost: args.reportedCost,
            errorCode: args.errorCode,
            retryable: args.retryable,
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
        corpusRevisionId: v.optional(v.id("corpusRevisions")),
        sourceId: v.optional(v.id("sources")),
        acceptedDecisionId: v.optional(v.id("sourceDecisions")),
        executionGeneration: v.number(),
        service: serviceValidator,
        operation: v.string(),
        operationKey: v.string(),
        errorCode: v.string(),
    },
    returns: v.id("providerCalls"),
    handler: async (ctx, args) => {
        if (args.sourceId && args.acceptedDecisionId && args.corpusRevisionId) {
            await assertEvidenceExecutionFence(ctx.db, {
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                sourceId: args.sourceId,
                acceptedDecisionId: args.acceptedDecisionId,
                executionGeneration: args.executionGeneration,
            });
        } else {
            const run = await ctx.db.get(args.runId);
            if (
                !run ||
                run.executionGeneration !== args.executionGeneration ||
                run.executionStatus !== "running"
            ) {
                throw new Error("Research execution is no longer active");
            }
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
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            executionGeneration: args.executionGeneration,
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
