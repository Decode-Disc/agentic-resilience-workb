"use node";

import { lookup } from "node:dns/promises";
import {
    PublicSourceUrlError,
    validatePublicSourceUrl,
} from "@convex/domain/publicSourceUrl";
import {
    preparationFailureCode,
    sourcePreparationError,
} from "@convex/domain/sourcePreparationAuthority";
import { prepareQualificationInput } from "@convex/domain/sourceQualification";
import type { SourceDocumentRetrievalInput } from "@convex/integrations/approvedSourceRetrieval";
import { extractObservedDestinations } from "@convex/integrations/evidenceNormalization";
import { createExaContentsAdapter } from "@convex/integrations/exa";
import { configuredExaContentsClient } from "@convex/integrations/exaContentsClient";
import { retrieveAndNormalizeExaFiling } from "@convex/integrations/exaEvidence";
import { retrieveAndNormalizeSecFiling } from "@convex/integrations/secEvidence";
import {
    DEFAULT_EXA_CONTENTS_TIMEOUT_MS,
    EXA_DISCOVERY_TIMEOUT_MS,
} from "@convex/resourcePolicy";
import {
    simulatedSourceCandidate,
    simulatedSourceText,
} from "@convex/sourcesSimulation";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction } from "./_generated/server";
import { preparationSecResolver } from "./sources/preparationSec";

const inspectionResultValidator = v.object({
    status: v.union(
        v.literal("complete"),
        v.literal("partial"),
        v.literal("unavailable"),
    ),
    sourceCaptureId: v.optional(v.id("sourceCaptures")),
    contentHash: v.optional(v.string()),
    reasonCode: v.optional(v.string()),
});
type InspectionResult = Infer<typeof inspectionResultValidator>;

export const sourcePreparationArgsValidator = v.object({
    preparationId: v.id("sourceSelectionProposalRebuilds"),
    sourceId: v.id("sources"),
});

export const inspectSource = internalAction({
    args: sourcePreparationArgsValidator,
    returns: inspectionResultValidator,
    handler: inspectSourceDocument,
});

export async function inspectSourceDocument(
    ctx: ActionCtx,
    args: Infer<typeof sourcePreparationArgsValidator>,
): Promise<InspectionResult> {
    let captureId: Id<"sourceCaptures"> | undefined;
    try {
        const reservation = await ctx.runMutation(
            internal.sourceCaptures.reserveUpload,
            args,
        );
        const { capture, source, company } = reservation;
        captureId = capture._id;
        if (!reservation.shouldExecute) {
            return capture.status === "committed"
                ? {
                      status: capture.readingCompleteness ?? "partial",
                      sourceCaptureId: capture._id,
                      contentHash: capture.contentHash,
                  }
                : {
                      status: "unavailable",
                      sourceCaptureId: capture._id,
                      reasonCode:
                          capture.failureCode ?? "inspection_in_progress",
                  };
        }
        const simulation = await ctx.runQuery(
            internal.sourcesSimulation.enabled,
            { runId: capture.runId },
        );
        const replay = await ctx.runQuery(
            internal.qualificationSourceReplay.read,
            { runId: capture.runId },
        );
        const replayDocument = replay?.documents.find(
            (doc) => doc.url === source.canonicalUrl,
        );
        if (
            (replay && !replayDocument) ||
            (source.providerReference?.startsWith("sources-replay:") && !replay)
        )
            throw sourcePreparationError("sources_replay_target_unavailable");
        if (replayDocument?.acquisition.status === "unavailable")
            throw sourcePreparationError(replayDocument.acquisition.code);
        const frozen = simulation || replay !== null;
        if (
            simulation &&
            !replay &&
            source.canonicalUrl !==
                simulatedSourceCandidate(capture.runId).canonicalUrl
        )
            throw sourcePreparationError("acquisition_target_invalid");
        const exaClient =
            source.origin === "sec" && !replay
                ? undefined
                : frozen
                  ? {
                        getContents: async (urls: ReadonlyArray<string>) => ({
                            results: urls.map((url) => ({
                                id: replay
                                    ? `sources-replay:${replay.materialHash}`
                                    : "sources-simulation-v1",
                                url,
                                text:
                                    replayDocument &&
                                    replayDocument.acquisition.status !==
                                        "unavailable"
                                        ? replayDocument.acquisition.text
                                        : simulatedSourceText,
                            })),
                        }),
                    }
                  : configuredExaContentsClient();
        if (source.origin !== "sec" && !exaClient)
            throw sourcePreparationError("missing_configuration");
        const preparation = await ctx.runQuery(
            internal.sourcePreparation.getForExecution,
            { ...args, now: Date.now() },
        );
        let canonicalUrl: string;
        let resolutionTimer: ReturnType<typeof setTimeout> | undefined;
        try {
            const destination = await Promise.race([
                validatePublicSourceUrl(
                    source.canonicalUrl,
                    async (hostname) => {
                        if (frozen) return ["93.184.216.34"];
                        const addresses = await lookup(hostname, {
                            all: true,
                            verbatim: true,
                        });
                        return addresses.map((record) => record.address);
                    },
                ),
                new Promise<never>((_resolve, reject) => {
                    resolutionTimer = setTimeout(
                        () =>
                            reject(
                                sourcePreparationError(
                                    "source_url_unavailable",
                                ),
                            ),
                        Math.max(
                            1,
                            Math.min(
                                EXA_DISCOVERY_TIMEOUT_MS,
                                (preparation.deadlineAt ?? 0) - Date.now(),
                            ),
                        ),
                    );
                }),
            ]);
            canonicalUrl = destination.canonicalUrl;
        } catch (error) {
            if (!(error instanceof PublicSourceUrlError)) throw error;
            throw sourcePreparationError(
                error.data.code === "dns_failed"
                    ? "source_url_unavailable"
                    : "source_url_not_public",
            );
        } finally {
            clearTimeout(resolutionTimer);
        }
        const input: SourceDocumentRetrievalInput = {
            canonicalUrl:
                source.origin === "sec"
                    ? (capture.resolvedUrl ?? canonicalUrl)
                    : canonicalUrl,
            origin: source.origin,
            companyCik: company.cik,
            providerReference: source.providerReference,
            secAccessionNumber: source.secAccessionNumber,
            secForm: source.secForm,
            secPrimaryDocument: source.secPrimaryDocument,
        };
        const operationScope = `${preparation.operationKey}:step:source_preparation:source:${source._id}:capture:${capture._id}`;
        const acquisitionOperation =
            source.origin === "sec" ? "retrieve_filing_html" : "get_contents";
        const acquisitionPlan = frozen
            ? { attempt: 1, errorCode: undefined }
            : await ctx.runQuery(
                  internal.providerCalls.nextPreparationAttemptForInput,
                  {
                      preparationId: args.preparationId,
                      sourceId: source._id,
                      operation: acquisitionOperation,
                      inputHash: capture.requestInputHash,
                      now: Date.now(),
                  },
              );
        if (!acquisitionPlan.attempt)
            throw sourcePreparationError(
                acquisitionPlan.errorCode ?? "retrieval_unavailable",
            );
        const firstAttempt = acquisitionPlan.attempt as 1 | 2 | 3;
        const maxAttempts = firstAttempt === 3 ? 3 : 2;
        let boundaryError: unknown;
        const subrequestAttempts = new Map<string, number>();
        const recordAttempt = async (attempt: {
            operation: string;
            operationKey: string;
            status: "started" | "succeeded" | "failed";
            attempt: number;
            latencyMs?: number;
            errorCode?: string;
            usage?: unknown;
            reportedCost?: number;
        }) => {
            try {
                const key = `${attempt.operation}:${attempt.attempt}`;
                let logicalAttempt =
                    subrequestAttempts.get(key) ?? attempt.attempt;
                if (
                    attempt.status === "started" &&
                    attempt.operation !== acquisitionOperation
                ) {
                    const plan = await ctx.runQuery(
                        internal.providerCalls.nextPreparationAttemptForInput,
                        {
                            preparationId: args.preparationId,
                            sourceId: source._id,
                            operation: attempt.operation,
                            inputHash: capture.requestInputHash,
                            now: Date.now(),
                        },
                    );
                    if (!plan.attempt)
                        throw sourcePreparationError(
                            plan.errorCode ?? "retrieval_unavailable",
                        );
                    logicalAttempt = plan.attempt;
                    subrequestAttempts.set(key, logicalAttempt);
                }
                const recorded = await ctx.runMutation(
                    internal.providerCalls.recordAttempt,
                    {
                        ...attempt,
                        attempt: logicalAttempt,
                        inputHash: capture.requestInputHash,
                        runId: capture.runId,
                        corpusRevisionId: preparation.corpusRevisionId,
                        sourceId: source._id,
                        preparationId: args.preparationId,
                        executionGeneration: preparation.executionGeneration,
                        workflowVersion: preparation.workflowVersion,
                        stepKey: "source_preparation",
                        service: source.origin === "sec" ? "sec" : "exa",
                    },
                );
                if (attempt.status === "started" && !recorded.shouldExecute) {
                    throw sourcePreparationError(
                        recorded.errorCode ?? "attempt_already_recorded",
                    );
                }
                return recorded;
            } catch (error) {
                boundaryError = error;
                throw error;
            }
        };
        const remainingMs = Math.max(
            1,
            (preparation.deadlineAt ?? 0) - Date.now(),
        );
        const retrieval = exaClient
            ? await retrieveAndNormalizeExaFiling(
                  createExaContentsAdapter(exaClient, {
                      ...(frozen
                          ? { maxAttempts: 1 }
                          : {
                                recordAttempt,
                                operationScope,
                                firstAttempt,
                                maxAttempts,
                            }),
                      retryPolicy: "confirmed_response",
                      timeoutMs: Math.min(
                          DEFAULT_EXA_CONTENTS_TIMEOUT_MS,
                          remainingMs,
                      ),
                  }),
                  input,
              )
            : await retrieveAndNormalizeSecFiling(
                  preparationSecResolver(ctx, preparation, {
                      recordAttempt,
                      operationScope,
                      firstAttempt,
                      maxAttempts,
                  }),
                  input,
                  async (resolvedUrl) => {
                      await ctx.runMutation(
                          internal.sourceCaptures.retainSecDocumentUrl,
                          {
                              preparationId: args.preparationId,
                              captureId: capture._id,
                              resolvedUrl,
                          },
                      );
                  },
              );
        if (boundaryError !== undefined) throw boundaryError;
        if (replay && replayDocument && retrieval.status !== "failed") {
            retrieval.retrievalVersion = `sources-replay:${replay.materialHash}`;
            if (replayDocument.acquisition.status === "partial")
                retrieval.status = "partial";
            await ctx.runQuery(internal.qualificationSourceReplay.read, {
                runId: capture.runId,
            });
        }
        if (
            retrieval.status === "failed" ||
            !retrieval.normalizedText ||
            !retrieval.retrievalVersion ||
            !retrieval.normalizerVersion
        ) {
            throw sourcePreparationError(
                retrieval.errorCode ?? "retrieval_unavailable",
            );
        }
        await ctx.runQuery(internal.sourceCaptures.assertActive, {
            ...args,
            now: Date.now(),
        });
        const prepared = prepareQualificationInput({
            company,
            canonicalUrl: retrieval.canonicalUrl,
            title: source.title,
            asOfTime: preparation.asOfTime ?? preparation.createdAt,
            text: retrieval.normalizedText,
            retrievalCompleteness:
                retrieval.status === "partial" ? "partial" : "complete",
        });
        const readingCompleteness =
            retrieval.status === "partial"
                ? "partial"
                : prepared.readingCompleteness;
        const storageId = await ctx.storage.store(
            new Blob([prepared.normalizedText], {
                type: "text/plain; charset=utf-8",
            }),
        );
        await ctx.runMutation(internal.sourceCaptures.attachStorage, {
            preparationId: args.preparationId,
            captureId,
            storageId,
        });
        await ctx.runMutation(internal.sourceCaptures.finalize, {
            ...(preparation.sourcesMission
                ? {
                      representationCompleteness:
                          retrieval.status === "partial"
                              ? ("partial" as const)
                              : ("complete" as const),
                      observedDestinations: extractObservedDestinations(
                          retrieval.rawContent ?? retrieval.normalizedText,
                          retrieval.canonicalUrl,
                      ),
                  }
                : {}),
            preparationId: args.preparationId,
            captureId,
            contentHash: prepared.request.document.contentHash,
            byteCount: new TextEncoder().encode(prepared.normalizedText)
                .byteLength,
            resolvedUrl: retrieval.canonicalUrl,
            retrievalVersion: retrieval.retrievalVersion,
            normalizerVersion: `${retrieval.normalizerVersion}+${prepared.normalizerVersion}`,
            retrievedAt: Date.now(),
            readingCompleteness,
            omittedPassageCount: Math.max(
                readingCompleteness === "partial" ? 1 : 0,
                prepared.omittedPassageCount,
            ),
        });
        return {
            status: readingCompleteness,
            sourceCaptureId: captureId,
            contentHash: prepared.request.document.contentHash,
        };
    } catch (error) {
        const reasonCode = preparationFailureCode(error);
        if (captureId) {
            await ctx.runMutation(internal.sourceCaptures.markUnavailable, {
                preparationId: args.preparationId,
                captureId,
                failureCode: reasonCode ?? "inspection_failed",
            });
        }
        if (!reasonCode) throw error;
        return {
            status: "unavailable",
            ...(captureId ? { sourceCaptureId: captureId } : {}),
            reasonCode,
        };
    }
}
