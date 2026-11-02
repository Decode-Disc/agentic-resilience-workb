"use node";

import { lookup } from "node:dns/promises";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./_generated/server";
import { classifyManualSourceIntakeError } from "./domain/manualSourceIntake";
import {
    extractPassagesFromNormalizedText,
    sha256Hex,
} from "./domain/sourcePassages";
import type {
    ApprovedSourceRetrievalInput,
    ApprovedSourceRetrievalResult,
} from "./integrations/approvedSourceRetrieval";
import { createExaContentsAdapter } from "./integrations/exa";
import { createExaContentsClient } from "./integrations/exaContentsClient";
import { retrieveAndNormalizeExaFiling } from "./integrations/exaEvidence";
import { retrieveAndNormalizePublicPdf } from "./integrations/publicPdfEvidence";
import { createSecCompanyResolver } from "./integrations/sec";
import { retrieveAndNormalizeSecFiling } from "./integrations/secEvidence";
import {
    MAX_NORMALIZED_ARTIFACT_BYTES,
    MAX_PASSAGES_PER_SOURCE,
} from "./resourceLimits";
import {
    inspectPublicSourceMetadata,
    requestPinnedPublicSource,
} from "./sourceActions";

const getFrozenSourceForExecutionRef =
    internal.evidenceArtifacts.getFrozenSourceForExecution;

const updateEvidenceSourceStatusRef =
    internal.evidenceArtifacts.updateEvidenceSourceStatus;

const reserveUploadLeaseRef = internal.evidenceArtifacts.reserveUploadLease;

const attachStorageToLeaseRef = internal.evidenceArtifacts.attachStorageToLease;

const finalizeSourceVersionRef =
    internal.evidenceArtifacts.finalizeSourceVersion;

const markLeaseOrphanedRef = internal.evidenceArtifacts.markLeaseOrphaned;

const reserveSecRateLimitRef = internal.providerCalls.reserveSecRateLimit;

const recordAttemptRef = internal.providerCalls.recordAttempt;

const recordConfigurationFailureRef =
    internal.providerCalls.recordConfigurationFailure;

const assertExecutionFenceQueryRef =
    internal.evidenceArtifacts.assertExecutionFenceQuery;

export type RetrieveSourceResult = {
    status: "succeeded" | "partial" | "failed";
    sourceVersionId?: Id<"sourceVersions">;
    reused?: boolean;
    failureReason?: string;
};

const actionArgs = {
    runId: v.id("researchRuns"),
    corpusRevisionId: v.id("corpusRevisions"),
    sourceId: v.id("sources"),
    acceptedDecisionId: v.id("sourceDecisions"),
    executionGeneration: v.number(),
    workerKey: v.optional(v.string()),
};

const actionReturns = v.object({
    status: v.union(
        v.literal("succeeded"),
        v.literal("partial"),
        v.literal("failed"),
    ),
    sourceVersionId: v.optional(v.id("sourceVersions")),
    reused: v.optional(v.boolean()),
    failureReason: v.optional(v.string()),
});

type ExecutionActionArgs = {
    runId: Id<"researchRuns">;
    corpusRevisionId: Id<"corpusRevisions">;
    sourceId: Id<"sources">;
    acceptedDecisionId: Id<"sourceDecisions">;
    executionGeneration: number;
    workerKey?: string;
};

type FrozenSourceData = NonNullable<
    FunctionReturnType<
        typeof internal.evidenceArtifacts.getFrozenSourceForExecution
    >
>;

function terminalSourceResult({
    statusDoc,
}: FrozenSourceData): RetrieveSourceResult | null {
    if (statusDoc.status === "succeeded" || statusDoc.status === "partial") {
        return {
            status: statusDoc.status,
            sourceVersionId: statusDoc.sourceVersionId,
            reused: true,
            failureReason: statusDoc.failureReason,
        };
    }
    return statusDoc.status === "failed"
        ? { status: "failed", failureReason: statusDoc.failureReason }
        : null;
}

/** Materializes the approved proposal's bytes. Missing captures never fall through to retrieval. */
async function materializePreparedSource(
    ctx: ActionCtx,
    args: ExecutionActionArgs,
    frozen: FrozenSourceData,
): Promise<RetrieveSourceResult | null> {
    if (frozen.preparedCapture === undefined) return null;
    const { workerKey: _workerKey, ...fence } = args;
    const capture = frozen.preparedCapture;
    const blob = capture?.storageId
        ? await ctx.storage.get(capture.storageId)
        : null;
    let failureReason: string | undefined;
    let text: string | undefined;
    if (!capture || !blob || blob.size > MAX_NORMALIZED_ARTIFACT_BYTES)
        failureReason = "capture_unavailable";
    else {
        text = await blob.text();
        if (
            sha256Hex(text) !== capture.contentHash ||
            blob.size !== capture.byteCount
        )
            failureReason = "capture_corrupt";
    }
    if (failureReason || !capture?.contentHash || text === undefined) {
        failureReason ??= "capture_unavailable";
        await ctx.runMutation(
            internal.evidenceArtifacts.updateEvidenceSourceStatus,
            { ...fence, status: "failed", failureReason },
        );
        return { status: "failed", failureReason };
    }
    let passages: ReturnType<typeof extractPassagesFromNormalizedText>;
    try {
        if (
            frozen.preparedPassageReferences?.some(
                (ref) =>
                    ref.quotation &&
                    text.slice(ref.startOffset, ref.endOffset) !==
                        ref.quotation,
            )
        )
            throw new Error("required_passage_unavailable");
        passages = extractPassagesFromNormalizedText({
            text,
            canonicalUrl: capture.resolvedUrl ?? capture.requestedUrl,
            sourceVersionHash: capture.contentHash,
            ...(frozen.preparedPassageReferences
                ? {
                      preparationVersion: frozen.preparationVersion,
                      maxPassages: MAX_PASSAGES_PER_SOURCE,
                      requiredSpans: frozen.preparedPassageReferences,
                  }
                : {}),
        });
    } catch (error) {
        if (
            !(error instanceof Error) ||
            ![
                "required_passages_exceed_limit",
                "required_passage_unavailable",
            ].includes(error.message)
        )
            throw error;
        await ctx.runMutation(
            internal.evidenceArtifacts.updateEvidenceSourceStatus,
            { ...fence, status: "failed", failureReason: error.message },
        );
        return { status: "failed", failureReason: error.message };
    }
    return ctx.runMutation(
        internal.evidenceArtifacts.materializeInspectedSource,
        { ...fence, contentHash: capture.contentHash, passages },
    );
}

async function persistEvidenceArtifact(
    ctx: ActionCtx,
    args: ExecutionActionArgs,
    retrievalResult: ApprovedSourceRetrievalResult,
): Promise<RetrieveSourceResult> {
    if (
        retrievalResult.status === "failed" ||
        !retrievalResult.normalizedText ||
        !retrievalResult.contentHash ||
        !retrievalResult.normalizerVersion ||
        !retrievalResult.mediaType ||
        typeof retrievalResult.byteCount !== "number" ||
        !retrievalResult.retrievalVersion
    ) {
        try {
            await ctx.runMutation(updateEvidenceSourceStatusRef, {
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                sourceId: args.sourceId,
                acceptedDecisionId: args.acceptedDecisionId,
                executionGeneration: args.executionGeneration,
                status: "failed",
                failureReason:
                    retrievalResult.failureReason ??
                    "Retrieval and normalization failed",
            });
        } catch {
            // Execution fence rejection
        }
        return {
            status: "failed" as const,
            failureReason: retrievalResult.failureReason,
        };
    }

    let leaseId: Id<"artifactUploadLeases"> | null = null;
    let storageId: Id<"_storage"> | null = null;
    try {
        const leaseReservation = (await ctx.runMutation(reserveUploadLeaseRef, {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            sourceId: args.sourceId,
            acceptedDecisionId: args.acceptedDecisionId,
            contentHash: retrievalResult.contentHash,
            normalizerVersion: retrievalResult.normalizerVersion,
            executionGeneration: args.executionGeneration,
        })) as {
            leaseId: Id<"artifactUploadLeases"> | null;
            reuseSourceVersionId: Id<"sourceVersions"> | null;
        };

        const reusedSourceVersionId = leaseReservation.reuseSourceVersionId;
        if (reusedSourceVersionId) {
            await ctx.runMutation(updateEvidenceSourceStatusRef, {
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                sourceId: args.sourceId,
                acceptedDecisionId: args.acceptedDecisionId,
                executionGeneration: args.executionGeneration,
                status: retrievalResult.status,
                sourceVersionId: reusedSourceVersionId,
                failureReason: retrievalResult.failureReason,
            });
            return {
                status: retrievalResult.status,
                sourceVersionId: reusedSourceVersionId,
                reused: true,
                ...(retrievalResult.failureReason
                    ? { failureReason: retrievalResult.failureReason }
                    : {}),
            };
        }

        leaseId = leaseReservation.leaseId;
        if (!leaseId) {
            throw new Error("Failed to reserve artifact upload lease");
        }

        const blob = new Blob([retrievalResult.normalizedText], {
            type: "text/plain; charset=utf-8",
        });
        storageId = await ctx.storage.store(blob);

        await ctx.runMutation(attachStorageToLeaseRef, {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            sourceId: args.sourceId,
            acceptedDecisionId: args.acceptedDecisionId,
            executionGeneration: args.executionGeneration,
            leaseId,
            storageId,
        });

        const finalResult = (await ctx.runMutation(finalizeSourceVersionRef, {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            sourceId: args.sourceId,
            acceptedDecisionId: args.acceptedDecisionId,
            executionGeneration: args.executionGeneration,
            leaseId,
            storageId,
            contentHash: retrievalResult.contentHash,
            normalizerVersion: retrievalResult.normalizerVersion,
            mediaType: retrievalResult.mediaType,
            byteCount: retrievalResult.byteCount,
            pageCount: retrievalResult.pageCount,
            canonicalUrl: retrievalResult.canonicalUrl,
            retrievalVersion: retrievalResult.retrievalVersion,
            retrievalMetadata: retrievalResult.retrievalMetadata,
            finalStatus: retrievalResult.status,
            failureReason: retrievalResult.failureReason,
            passages: (retrievalResult.passages ?? []).map((p) => ({
                order: p.order,
                exactQuotation: p.exactQuotation,
                quotationHash: p.quotationHash,
                locatorVersion: p.locatorVersion,
                locator: p.locator,
                contextBefore: p.contextBefore,
                contextAfter: p.contextAfter,
                headingPath: p.headingPath,
            })),
        })) as {
            sourceVersionId: Id<"sourceVersions">;
            reused: boolean;
            loserStorageId?: Id<"_storage">;
        };

        if (finalResult.loserStorageId) {
            try {
                await ctx.runMutation(
                    internal.evidenceArtifacts.deleteUnreferencedArtifact,
                    { storageId: finalResult.loserStorageId },
                );
            } catch {
                // Best-effort delete
            }
        }

        return {
            status: retrievalResult.status,
            sourceVersionId: finalResult.sourceVersionId,
            reused: finalResult.reused,
            ...(retrievalResult.failureReason
                ? { failureReason: retrievalResult.failureReason }
                : {}),
        };
    } catch (error) {
        if (leaseId) {
            try {
                await ctx.runMutation(markLeaseOrphanedRef, { leaseId });
            } catch {
                // Best effort
            }
        }
        if (storageId) {
            try {
                await ctx.runMutation(
                    internal.evidenceArtifacts.deleteUnreferencedArtifact,
                    { storageId },
                );
            } catch {
                // Best effort
            }
        }
        try {
            await ctx.runMutation(updateEvidenceSourceStatusRef, {
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                sourceId: args.sourceId,
                acceptedDecisionId: args.acceptedDecisionId,
                executionGeneration: args.executionGeneration,
                status: "failed",
                failureReason:
                    error instanceof Error ? error.message : "Finalize failure",
            });
        } catch {
            // Status update rejected by execution fence
        }
        return {
            status: "failed" as const,
            failureReason:
                error instanceof Error ? error.message : "Finalize failure",
        };
    }
}

export const retrieveAndNormalizeSecSource = internalAction({
    args: actionArgs,
    returns: actionReturns,
    handler: async (ctx, args): Promise<RetrieveSourceResult> => {
        const frozenData = (await ctx.runQuery(getFrozenSourceForExecutionRef, {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            sourceId: args.sourceId,
            acceptedDecisionId: args.acceptedDecisionId,
            executionGeneration: args.executionGeneration,
        })) as FrozenSourceData | null;

        if (!frozenData?.source) {
            try {
                await ctx.runMutation(updateEvidenceSourceStatusRef, {
                    runId: args.runId,
                    corpusRevisionId: args.corpusRevisionId,
                    sourceId: args.sourceId,
                    acceptedDecisionId: args.acceptedDecisionId,
                    executionGeneration: args.executionGeneration,
                    status: "failed",
                    failureReason:
                        "Frozen source not found or execution is no longer active",
                });
            } catch {
                // Stale generation
            }
            return {
                status: "failed" as const,
                failureReason: "Frozen source not found or execution inactive",
            };
        }

        const existing = terminalSourceResult(frozenData);
        if (existing) return existing;
        const materialized = await materializePreparedSource(
            ctx,
            args,
            frozenData,
        );
        if (materialized) return materialized;
        const { source, companyCik } = frozenData;

        try {
            await ctx.runMutation(updateEvidenceSourceStatusRef, {
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                sourceId: args.sourceId,
                acceptedDecisionId: args.acceptedDecisionId,
                executionGeneration: args.executionGeneration,
                status: "running",
            });
        } catch (fenceError) {
            return {
                status: "failed" as const,
                failureReason:
                    fenceError instanceof Error
                        ? fenceError.message
                        : "Execution fence rejected running status",
            };
        }

        const userAgent =
            typeof process !== "undefined" && process.env?.SEC_USER_AGENT
                ? process.env.SEC_USER_AGENT
                : "Evidence Workbench research@evidence-workbench.org";

        const resolver = createSecCompanyResolver({
            fetch: globalThis.fetch,
            now: Date.now,
            userAgent,
            reserveRequest: async () => {
                await ctx.runMutation(reserveSecRateLimitRef, {});
            },
            recordAttempt: async (attempt) => {
                return (await ctx.runMutation(recordAttemptRef, {
                    runId: args.runId,
                    corpusRevisionId: args.corpusRevisionId,
                    sourceId: args.sourceId,
                    acceptedDecisionId: args.acceptedDecisionId,
                    executionGeneration: args.executionGeneration,
                    workflowVersion: 2,
                    stepKey: "extracting_evidence",
                    service: "sec",
                    operation: attempt.operation,
                    operationKey: attempt.operationKey,
                    status: attempt.status,
                    attempt: attempt.attempt,
                    latencyMs: attempt.latencyMs,
                    errorCode: attempt.errorCode,
                })) as { shouldExecute: boolean };
            },
            operationScope: `run:${args.runId}:gen:${args.executionGeneration}:source:${args.sourceId}${args.workerKey ? `:${args.workerKey}` : ""}`,
        });

        const input: ApprovedSourceRetrievalInput = {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            sourceId: args.sourceId,
            acceptedDecisionId: args.acceptedDecisionId,
            executionGeneration: args.executionGeneration,
            canonicalUrl: source.canonicalUrl,
            origin: "sec",
            providerReference: source.providerReference,
            secAccessionNumber: source.secAccessionNumber,
            secForm: source.secForm,
            secPrimaryDocument: source.secPrimaryDocument,
            companyCik,
        };

        const retrievalResult = await retrieveAndNormalizeSecFiling(
            resolver,
            input,
        );

        return await persistEvidenceArtifact(ctx, args, retrievalResult);
    },
});

export const retrieveAndNormalizeExaSource = internalAction({
    args: actionArgs,
    returns: actionReturns,
    handler: async (ctx, args): Promise<RetrieveSourceResult> => {
        const frozenData = (await ctx.runQuery(getFrozenSourceForExecutionRef, {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            sourceId: args.sourceId,
            acceptedDecisionId: args.acceptedDecisionId,
            executionGeneration: args.executionGeneration,
        })) as FrozenSourceData | null;

        if (!frozenData?.source) {
            try {
                await ctx.runMutation(updateEvidenceSourceStatusRef, {
                    runId: args.runId,
                    corpusRevisionId: args.corpusRevisionId,
                    sourceId: args.sourceId,
                    acceptedDecisionId: args.acceptedDecisionId,
                    executionGeneration: args.executionGeneration,
                    status: "failed",
                    failureReason:
                        "Frozen source not found or execution is no longer active",
                });
            } catch {
                // Stale generation
            }
            return {
                status: "failed" as const,
                failureReason: "Frozen source not found or execution inactive",
            };
        }

        const existing = terminalSourceResult(frozenData);
        if (existing) return existing;
        const materialized = await materializePreparedSource(
            ctx,
            args,
            frozenData,
        );
        if (materialized) return materialized;
        const { source } = frozenData;

        try {
            await ctx.runMutation(updateEvidenceSourceStatusRef, {
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                sourceId: args.sourceId,
                acceptedDecisionId: args.acceptedDecisionId,
                executionGeneration: args.executionGeneration,
                status: "running",
            });
        } catch (fenceError) {
            return {
                status: "failed" as const,
                failureReason:
                    fenceError instanceof Error
                        ? fenceError.message
                        : "Execution fence rejected running status",
            };
        }

        const apiKey =
            typeof process !== "undefined"
                ? process.env?.EXA_API_KEY?.trim()
                : undefined;

        if (!apiKey) {
            const operationScope = `run:${args.runId}:gen:${args.executionGeneration}:source:${args.sourceId}${args.workerKey ? `:${args.workerKey}` : ""}`;
            const operationKey = `${operationScope}:get_contents:${source.canonicalUrl}`;
            try {
                await ctx.runMutation(recordConfigurationFailureRef, {
                    runId: args.runId,
                    corpusRevisionId: args.corpusRevisionId,
                    sourceId: args.sourceId,
                    acceptedDecisionId: args.acceptedDecisionId,
                    executionGeneration: args.executionGeneration,
                    service: "exa",
                    operation: "get_contents",
                    operationKey,
                    errorCode: "missing_api_key",
                });
            } catch {
                // Best effort telemetry
            }

            await ctx.runMutation(updateEvidenceSourceStatusRef, {
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                sourceId: args.sourceId,
                acceptedDecisionId: args.acceptedDecisionId,
                executionGeneration: args.executionGeneration,
                status: "failed",
                failureReason: "Exa API key is not configured",
            });

            return {
                status: "failed" as const,
                failureReason: "Exa API key is not configured",
            };
        }

        const client = createExaContentsClient(apiKey);
        const adapter = createExaContentsAdapter(client, {
            now: Date.now,
            operationScope: `run:${args.runId}:gen:${args.executionGeneration}:source:${args.sourceId}${args.workerKey ? `:${args.workerKey}` : ""}`,
            recordAttempt: async (attempt) => {
                return (await ctx.runMutation(recordAttemptRef, {
                    runId: args.runId,
                    corpusRevisionId: args.corpusRevisionId,
                    sourceId: args.sourceId,
                    acceptedDecisionId: args.acceptedDecisionId,
                    executionGeneration: args.executionGeneration,
                    workflowVersion: 2,
                    stepKey: "extracting_evidence",
                    service: "exa",
                    operation: attempt.operation,
                    operationKey: attempt.operationKey,
                    status: attempt.status,
                    attempt: attempt.attempt,
                    latencyMs: attempt.latencyMs,
                    errorCode: attempt.errorCode,
                    usage: attempt.usage,
                    reportedCost: attempt.reportedCost,
                })) as { shouldExecute: boolean };
            },
        });

        const input: ApprovedSourceRetrievalInput = {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            sourceId: args.sourceId,
            acceptedDecisionId: args.acceptedDecisionId,
            executionGeneration: args.executionGeneration,
            canonicalUrl: source.canonicalUrl,
            origin: "exa",
            providerReference: source.providerReference,
        };

        const retrievalResult = await retrieveAndNormalizeExaFiling(
            adapter,
            input,
        );

        return await persistEvidenceArtifact(ctx, args, retrievalResult);
    },
});

export const retrieveAndNormalizeManualSource = internalAction({
    args: actionArgs,
    returns: actionReturns,
    handler: async (ctx, args): Promise<RetrieveSourceResult> => {
        const fence = {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            sourceId: args.sourceId,
            acceptedDecisionId: args.acceptedDecisionId,
            executionGeneration: args.executionGeneration,
        };
        const frozen = await ctx.runQuery(
            internal.evidenceArtifacts.getFrozenSourceForExecution,
            fence,
        );
        if (!frozen)
            return {
                status: "failed",
                failureReason: "Frozen source not found or execution inactive",
            };
        const existing = terminalSourceResult(frozen);
        if (existing) return existing;
        const materialized = await materializePreparedSource(ctx, args, frozen);
        if (materialized) return materialized;
        const operationKey = `run:${args.runId}:revision:${args.corpusRevisionId}:decision:${args.acceptedDecisionId}:workflow:2:gen:${args.executionGeneration}:source:${args.sourceId}:inspect_approved_manual_source`;
        try {
            await ctx.runMutation(
                internal.evidenceArtifacts.updateEvidenceSourceStatus,
                { ...fence, status: "running" },
            );
            for (let attempt = 1; attempt <= 2; attempt += 1) {
                const startedAt = Date.now();
                const record = {
                    ...fence,
                    workflowVersion: 2,
                    stepKey: "extracting_evidence",
                    service: "url_metadata" as const,
                    operation: "inspect_approved_manual_source",
                    operationKey,
                    attempt,
                };
                const lease = await ctx.runMutation(
                    internal.providerCalls.recordAttempt,
                    { ...record, status: "started" },
                );
                if (!lease.shouldExecute) {
                    throw new Error(
                        "Approved source metadata inspection is already recorded",
                    );
                }
                let metadata: Awaited<
                    ReturnType<typeof inspectPublicSourceMetadata>
                >;
                try {
                    metadata = await inspectPublicSourceMetadata(
                        frozen.source.canonicalUrl,
                        {
                            resolveAddresses: async (hostname) => {
                                await ctx.runQuery(
                                    internal.evidenceArtifacts
                                        .assertExecutionFenceQuery,
                                    fence,
                                );
                                const addresses = await lookup(hostname, {
                                    all: true,
                                    verbatim: true,
                                });
                                return addresses.map(({ address }) => address);
                            },
                            request: async (url, address) => {
                                await ctx.runQuery(
                                    internal.evidenceArtifacts
                                        .assertExecutionFenceQuery,
                                    fence,
                                );
                                return requestPinnedPublicSource(url, address);
                            },
                        },
                    );
                    await ctx.runMutation(
                        internal.providerCalls.recordAttempt,
                        {
                            ...record,
                            status: "succeeded",
                            latencyMs: Date.now() - startedAt,
                            usage: {
                                canonicalUrl: metadata.canonicalUrl,
                                contentType: metadata.contentType,
                            },
                        },
                    );
                } catch (error) {
                    const classified = classifyManualSourceIntakeError(error);
                    await ctx.runMutation(
                        internal.providerCalls.recordAttempt,
                        {
                            ...record,
                            status: "failed",
                            latencyMs: Date.now() - startedAt,
                            errorCode: classified.data.code,
                        },
                    );
                    if (!classified.data.retryable || attempt === 2)
                        throw classified;
                    continue;
                }
                return metadata.contentType === "application/pdf"
                    ? await ctx.runAction(
                          internal.evidenceActions
                              .retrieveAndNormalizePublicPdfSource,
                          args,
                      )
                    : await ctx.runAction(
                          internal.evidenceActions
                              .retrieveAndNormalizeExaSource,
                          args,
                      );
            }
            throw new Error(
                "Approved source metadata inspection exhausted its attempts",
            );
        } catch (error) {
            return persistEvidenceArtifact(ctx, args, {
                status: "failed",
                canonicalUrl: frozen.source.canonicalUrl,
                failureReason:
                    error instanceof Error
                        ? error.message
                        : "Approved source metadata inspection failed",
            });
        }
    },
});

export const retrieveAndNormalizePublicPdfSource = internalAction({
    args: actionArgs,
    returns: actionReturns,
    handler: async (ctx, args): Promise<RetrieveSourceResult> => {
        const frozenData = (await ctx.runQuery(getFrozenSourceForExecutionRef, {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            sourceId: args.sourceId,
            acceptedDecisionId: args.acceptedDecisionId,
            executionGeneration: args.executionGeneration,
        })) as FrozenSourceData | null;

        if (!frozenData?.source) {
            try {
                await ctx.runMutation(updateEvidenceSourceStatusRef, {
                    runId: args.runId,
                    corpusRevisionId: args.corpusRevisionId,
                    sourceId: args.sourceId,
                    acceptedDecisionId: args.acceptedDecisionId,
                    executionGeneration: args.executionGeneration,
                    status: "failed",
                    failureReason:
                        "Frozen source not found or execution is no longer active",
                });
            } catch {
                // Stale generation
            }
            return {
                status: "failed" as const,
                failureReason: "Frozen source not found or execution inactive",
            };
        }

        const existing = terminalSourceResult(frozenData);
        if (existing) return existing;
        const materialized = await materializePreparedSource(
            ctx,
            args,
            frozenData,
        );
        if (materialized) return materialized;
        const { source } = frozenData;

        try {
            await ctx.runMutation(updateEvidenceSourceStatusRef, {
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
                sourceId: args.sourceId,
                acceptedDecisionId: args.acceptedDecisionId,
                executionGeneration: args.executionGeneration,
                status: "running",
            });
        } catch (fenceError) {
            return {
                status: "failed" as const,
                failureReason:
                    fenceError instanceof Error
                        ? fenceError.message
                        : "Execution fence rejected running status",
            };
        }

        const deps = {
            beforeResolve: async () => {
                await ctx.runQuery(assertExecutionFenceQueryRef, {
                    runId: args.runId,
                    corpusRevisionId: args.corpusRevisionId,
                    sourceId: args.sourceId,
                    acceptedDecisionId: args.acceptedDecisionId,
                    executionGeneration: args.executionGeneration,
                });
            },
            resolveAddresses: async (hostname: string) => {
                const records = await lookup(hostname, {
                    all: true,
                    verbatim: true,
                });
                return records.map((record) => record.address);
            },
            request: requestPinnedPublicSource,
            now: Date.now,
            operationScope: `run:${args.runId}:gen:${args.executionGeneration}:source:${args.sourceId}${args.workerKey ? `:${args.workerKey}` : ""}`,
            recordAttempt: async (attempt: {
                operation: string;
                operationKey: string;
                status: "started" | "succeeded" | "failed";
                attempt: number;
                latencyMs?: number;
                errorCode?: string;
            }) => {
                return (await ctx.runMutation(recordAttemptRef, {
                    runId: args.runId,
                    corpusRevisionId: args.corpusRevisionId,
                    sourceId: args.sourceId,
                    acceptedDecisionId: args.acceptedDecisionId,
                    executionGeneration: args.executionGeneration,
                    workflowVersion: 2,
                    stepKey: "extracting_evidence",
                    service: "pdf",
                    operation: attempt.operation,
                    operationKey: attempt.operationKey,
                    status: attempt.status,
                    attempt: attempt.attempt,
                    latencyMs: attempt.latencyMs,
                    errorCode: attempt.errorCode,
                })) as { shouldExecute: boolean };
            },
        };

        const input: ApprovedSourceRetrievalInput = {
            runId: args.runId,
            corpusRevisionId: args.corpusRevisionId,
            sourceId: args.sourceId,
            acceptedDecisionId: args.acceptedDecisionId,
            executionGeneration: args.executionGeneration,
            canonicalUrl: source.canonicalUrl,
            origin: "analyst_url",
            providerReference: source.providerReference,
        };

        const retrievalResult = await retrieveAndNormalizePublicPdf(
            deps,
            input,
        );

        return await persistEvidenceArtifact(ctx, args, retrievalResult);
    },
});
