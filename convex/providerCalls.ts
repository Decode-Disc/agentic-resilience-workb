import { ConvexError, type Infer, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { assertEvidenceExecutionFence } from "./domain/evidenceAuthority";
import { manualSourceIntakeError } from "./domain/manualSourceIntake";
import {
    assertPreparationComparisonFence,
    assertPreparationExecutionFence,
    sourcePreparationError,
} from "./domain/sourcePreparationAuthority";
import { rateLimiter } from "./rateLimiter";
import {
    MAX_CONCURRENT_SOURCE_EMBEDDING_CALLS,
    MAX_PREPARATION_MODEL_ATTEMPTS,
    MAX_SOURCE_EMBEDDING_ATTEMPTS,
    MAX_SOURCE_EMBEDDING_BATCH_TEXTS,
    MAX_SOURCE_EMBEDDING_INPUT_BYTES,
    MAX_SOURCE_EMBEDDING_TEXT_BYTES,
} from "./resourceLimits";

const serviceValidator = v.union(
    v.literal("model"),
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
    model: 70_000,
    sec: 15_000,
    exa: 15_000,
    url_metadata: 15_000,
    pdf: 15_000,
} as const;

function providerLeaseDurationMs(
    service: "sec" | "exa" | "url_metadata" | "pdf" | "model",
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

const recordAttemptResultValidator = v.object({
    providerCallId: v.id("providerCalls"),
    shouldExecute: v.boolean(),
    status: providerCallStatusValidator,
    errorCode: v.optional(v.string()),
    retryable: v.optional(v.boolean()),
});

export const recordAttempt = internalMutation({
    args: {
        inputHash: v.optional(v.string()),
        runId: v.optional(v.id("researchRuns")),
        corpusRevisionId: v.optional(v.id("corpusRevisions")),
        sourceId: v.optional(v.id("sources")),
        preparationId: v.optional(v.id("sourceSelectionProposalRebuilds")),
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
        embeddingInputBytes: v.optional(v.number()),
        errorCode: v.optional(v.string()),
        retryable: v.optional(v.boolean()),
    },
    returns: recordAttemptResultValidator,
    handler: async (
        ctx,
        args,
    ): Promise<Infer<typeof recordAttemptResultValidator>> => {
        const now = Date.now();
        if (
            args.service === "model" &&
            (!args.preparationId ||
                !args.inputHash ||
                !/^[a-f0-9]{64}$/.test(args.inputHash) ||
                ![
                    "source_qualification",
                    "source_comparison",
                    "source_embedding",
                ].includes(args.operation) ||
                ![1, 2].includes(args.attempt))
        ) {
            throw sourcePreparationError(
                args.operation === "source_comparison"
                    ? "comparison_attempt_invalid"
                    : "qualification_attempt_invalid",
            );
        }
        if (args.preparationId) {
            const preparation = await ctx.db.get(args.preparationId);
            if (
                preparation?.kind !== "preparation" ||
                preparation.runId !== args.runId ||
                preparation.corpusRevisionId !== args.corpusRevisionId ||
                preparation.executionGeneration !== args.executionGeneration ||
                preparation.workflowVersion !== args.workflowVersion ||
                args.acceptedDecisionId ||
                (!args.sourceId &&
                    !(
                        (args.service === "exa" || args.service === "sec") &&
                        args.operation === "source_supplement_search"
                    )) ||
                args.stepKey !== "source_preparation"
            ) {
                throw sourcePreparationError("stale_execution");
            }
            if (args.service === "model") {
                const operationStep =
                    args.operation === "source_comparison"
                        ? "source_comparison"
                        : args.operation === "source_embedding"
                          ? "source_embedding"
                          : "source_preparation";
                if (
                    args.operationKey !==
                    `${preparation.operationKey}:step:${operationStep}:input:${args.inputHash}:attempt:${args.attempt}`
                )
                    throw sourcePreparationError(
                        args.operation === "source_comparison"
                            ? "comparison_attempt_invalid"
                            : "qualification_attempt_invalid",
                    );
            }
            if (args.status === "started") {
                if (args.operation === "source_comparison" && args.sourceId) {
                    await assertPreparationComparisonFence(ctx.db, {
                        preparationId: args.preparationId,
                        sourceId: args.sourceId,
                        now,
                    });
                } else {
                    await assertPreparationExecutionFence(ctx.db, {
                        preparationId: args.preparationId,
                        sourceId: args.sourceId,
                        now,
                    });
                }
            }
        }
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

            if (args.service === "exa" || args.service === "model") {
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
                            preparationId: args.preparationId,
                            sourceId: args.sourceId,
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
                        ...(args.preparationId
                            ? { errorCode: "paid_work_disabled" }
                            : {}),
                    };
                }
            }

            const logicalAttempt =
                args.service === "model" && args.inputHash
                    ? await ctx.db
                          .query("providerCalls")
                          .withIndex(
                              "by_run_operation_input_and_attempt",
                              (q) =>
                                  q
                                      .eq("runId", args.runId)
                                      .eq("operation", args.operation)
                                      .eq("inputHash", args.inputHash)
                                      .eq("attempt", args.attempt),
                          )
                          .first()
                    : null;
            const matches = logicalAttempt
                ? [logicalAttempt]
                : await ctx.db
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
                    if (args.preparationId) {
                        await ctx.db.patch(existing._id, {
                            status: "failed",
                            errorCode: "attempt_outcome_unknown",
                            retryable: false,
                            completedAt: now,
                        });
                        return {
                            providerCallId: existing._id,
                            shouldExecute: false,
                            status: "failed" as const,
                            errorCode: "attempt_outcome_unknown",
                        };
                    }
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
                    ...(args.service === "model"
                        ? {
                              errorCode: existing.errorCode,
                              retryable: existing.retryable,
                          }
                        : {}),
                };
            }

            if (args.operation === "source_embedding") {
                const run = args.runId ? await ctx.db.get(args.runId) : null;
                const bytes = args.embeddingInputBytes;
                if (
                    !run ||
                    args.attempt !== 1 ||
                    bytes === undefined ||
                    !Number.isSafeInteger(bytes) ||
                    bytes < 1 ||
                    bytes >
                        MAX_SOURCE_EMBEDDING_BATCH_TEXTS *
                            MAX_SOURCE_EMBEDDING_TEXT_BYTES
                )
                    throw sourcePreparationError(
                        "embedding_reservation_invalid",
                    );
                const used = run.sourceEmbeddingReservedBytes ?? 0;
                // One UTF-8 byte per token deliberately overestimates ordinary English tokenization.
                if (
                    used + bytes > MAX_SOURCE_EMBEDDING_INPUT_BYTES ||
                    (run.sourceEmbeddingAttemptCount ?? 0) >=
                        MAX_SOURCE_EMBEDDING_ATTEMPTS
                )
                    throw sourcePreparationError("embedding_budget_exhausted");
                const calls = await ctx.db
                    .query("providerCalls")
                    .withIndex("by_run_operation_input_and_attempt", (q) =>
                        q
                            .eq("runId", run._id)
                            .eq("operation", "source_embedding"),
                    )
                    .take(129);
                if (
                    calls.filter(
                        (call) =>
                            call.status === "started" &&
                            (call.leaseExpiresAt ?? 0) > now,
                    ).length >= MAX_CONCURRENT_SOURCE_EMBEDDING_CALLS
                )
                    throw sourcePreparationError("embedding_concurrency_limit");
                await ctx.db.patch(run._id, {
                    sourceEmbeddingReservedBytes: used + bytes,
                    sourceEmbeddingAttemptCount:
                        (run.sourceEmbeddingAttemptCount ?? 0) + 1,
                });
            }
            if (
                args.service === "model" &&
                args.preparationId &&
                args.operation !== "source_embedding"
            ) {
                const preparation = await ctx.db.get(args.preparationId);
                const run = args.runId ? await ctx.db.get(args.runId) : null;
                const usedAttempts =
                    run?.sourceQualificationAttemptCount ??
                    preparation?.modelAttemptCount ??
                    0;
                if (
                    !preparation ||
                    !run ||
                    usedAttempts >= MAX_PREPARATION_MODEL_ATTEMPTS ||
                    (preparation.modelAttemptCount ?? 0) >=
                        MAX_PREPARATION_MODEL_ATTEMPTS
                )
                    throw sourcePreparationError("model_attempt_limit_reached");
                await ctx.db.patch(preparation._id, {
                    modelAttemptCount: (preparation.modelAttemptCount ?? 0) + 1,
                });
                await ctx.db.patch(run._id, {
                    sourceQualificationAttemptCount: usedAttempts + 1,
                });
            }
            const providerCallId = await ctx.db.insert("providerCalls", {
                inputHash:
                    args.service === "model" ? args.inputHash : undefined,
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                preparationId: args.preparationId,
                sourceId: args.sourceId,
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
                usage:
                    args.operation === "source_embedding"
                        ? { reservedInputBytes: args.embeddingInputBytes }
                        : undefined,
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
