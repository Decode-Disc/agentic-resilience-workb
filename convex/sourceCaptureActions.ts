"use node";

import { lookup } from "node:dns/promises";
import { addAbortListener } from "node:events";
import { PINNED_PUBLIC_RETRIEVAL_VERSION } from "@convex/domain/documentaryAccess";
import { type DateEvidence, documentDates } from "@convex/domain/documentDates";
import { SEC_RETRIEVAL_VERSION } from "@convex/domain/evidenceArtifacts";
import { ManualSourceIntakeError } from "@convex/domain/manualSourceIntake";
import {
    PublicSourceUrlError,
    validatePublicSourceUrl,
} from "@convex/domain/publicSourceUrl";
import { acquireDocumentResult } from "@convex/domain/savedMaterialOperationResults";
import { documentaryReference } from "@convex/domain/savedMaterialOperations";
import { DiscoveryRequestError } from "@convex/domain/sourceDiscoveryRecovery";
import {
    type ObserveProviderDispatch,
    preparationFailureCode,
    sourcePreparationError,
} from "@convex/domain/sourcePreparationAuthority";
import { prepareQualificationInput } from "@convex/domain/sourceQualification";
import {
    capturedDocumentMetadata,
    sourceDocumentMetadata,
} from "@convex/domain/sourceRetrievalPolicy";
import {
    executionError as executionFailure,
    executionFailureCode,
} from "@convex/execution/errors";
import {
    operationOutcomeValidator,
    scheduledOperationArgs,
} from "@convex/execution/executionProtocol";
import { operationSuccess } from "@convex/execution/operationResults";
import { executeScheduledOperation } from "@convex/execution/operations";
import { verifyRetainedText } from "@convex/execution/retainedText";
import type { SourceDocumentRetrievalInput } from "@convex/integrations/approvedSourceRetrieval";
import {
    extractHtmlPublicationEvidence,
    extractObservedDestinations,
    normalizeExaText,
    normalizeQualificationText,
    normalizeSecHtml,
} from "@convex/integrations/evidenceNormalization";
import {
    createExaContentsAdapter,
    ExaContentsError,
} from "@convex/integrations/exa";
import { configuredExaContentsClient } from "@convex/integrations/exaContentsClient";
import {
    EXA_RETRIEVAL_VERSION,
    retrieveAndNormalizeExaFiling,
} from "@convex/integrations/exaEvidence";
import { secFilingPublicationTime } from "@convex/integrations/sec";
import { retrieveAndNormalizeSecFiling } from "@convex/integrations/secEvidence";
import {
    DEFAULT_EXA_CONTENTS_TIMEOUT_MS,
    DEFAULT_SEC_TIMEOUT_MS,
    EXA_DISCOVERY_TIMEOUT_MS,
    MANUAL_SOURCE_METADATA_TIMEOUT_MS,
    MAX_APPROVED_SOURCE_BYTES,
    MAX_EXA_TEXT_CHARACTERS,
    MAX_REDIRECTS,
    nodeActionGenerationDeadline,
} from "@convex/resourcePolicy";
import { requestPinnedPublicSource } from "@convex/sourceActions";
import {
    simulatedSourceCandidate,
    simulatedSourceText,
} from "@convex/sourcesSimulation";
import {
    framingProviderInputHash,
    framingSecReadInput,
} from "@convex/workbenchPublicContext";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
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
    args: Infer<typeof sourcePreparationArgsValidator> & {
        operationRequestId?: Id<"agentOperationRequests">;
    },
): Promise<InspectionResult> {
    let captureId: Id<"sourceCaptures"> | undefined;
    let unattached: Id<"_storage"> | undefined;
    const { operationRequestId, ...preparationArgs } = args;
    const captureWriter = operationRequestId
        ? { operationRequestId }
        : { preparationId: args.preparationId };
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
            { ...preparationArgs, now: Date.now() },
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
                        operationRequestId,
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
                              ...captureWriter,
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
            ...preparationArgs,
            now: Date.now(),
        });
        if (operationRequestId) {
            const normalized = normalizeQualificationText(
                retrieval.normalizedText,
            );
            if (!normalized.normalizedText)
                throw sourcePreparationError("retrieval_unavailable");
            const storageId = await ctx.storage.store(
                new Blob([normalized.normalizedText], {
                    type: "text/plain; charset=utf-8",
                }),
            );
            unattached = storageId;
            const owner = { captureId: capture._id, operationRequestId };
            await ctx.runMutation(internal.sourceCaptures.attachStorage, {
                ...owner,
                storageId,
            });
            unattached = undefined;
            const status =
                retrieval.status === "partial" ? "partial" : "complete";
            await ctx.runMutation(internal.sourceCaptures.finalize, {
                ...owner,
                contentHash: normalized.contentHash,
                byteCount: normalized.byteCount,
                resolvedUrl: retrieval.canonicalUrl,
                retrievalVersion: retrieval.retrievalVersion,
                normalizerVersion: capture.normalizerVersion,
                retrievedAt: Date.now(),
                representationCompleteness:
                    status === "complete" && source.origin !== "sec" && !frozen
                        ? "unknown"
                        : status,
                document: capturedDocumentMetadata(
                    sourceDocumentMetadata(source),
                    normalized.normalizedText,
                ),
                observedDestinations: extractObservedDestinations(
                    retrieval.rawContent ?? retrieval.normalizedText,
                    retrieval.canonicalUrl,
                ),
            });
            return {
                status,
                sourceCaptureId: capture._id,
                contentHash: normalized.contentHash,
            };
        }
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
        if (unattached)
            await ctx.runMutation(
                internal.evidenceArtifacts.deleteUnreferencedArtifact,
                { storageId: unattached },
            );
        if (captureId) {
            await ctx.runMutation(internal.sourceCaptures.markUnavailable, {
                ...captureWriter,
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

type Request = FunctionArgs<
    typeof internal.workbenchPublicContext.forExecution
>;
type DocumentaryProviderRequest = Request & {
    piLease?: import("@convex/execution/piSession").PiDispatchLease;
};
type SuppliedReference = NonNullable<
    FunctionReturnType<
        typeof internal.workbenchPublicContext.forExecution
    >["suppliedReference"]
>;

export const importRetainedDocument = internalAction({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: v.union(
        v.object({
            status: v.literal("ready"),
            captureId: v.id("sourceCaptures"),
        }),
        v.object({ status: v.literal("unavailable"), reason: v.string() }),
    ),
    async handler(
        ctx,
        args,
    ): Promise<
        | { status: "ready"; captureId: Id<"sourceCaptures"> }
        | { status: "unavailable"; reason: string }
    > {
        const reservation = await ctx.runMutation(
            internal.sourceCaptures.reserveRetainedImport,
            args,
        );
        if (reservation.status === "unavailable") return reservation;
        const capture = reservation.capture;
        const register = async () => {
            await ctx.runMutation(
                internal.sourcesMission.retainImportedCapture,
                {
                    ...args,
                    captureId: capture._id,
                },
            );
            return { status: "ready" as const, captureId: capture._id };
        };
        if (reservation.status === "ready") return register();
        if (
            !capture.retainedImport ||
            !capture.contentHash ||
            !capture.document ||
            !capture.representationCompleteness
        )
            throw executionFailure("capture_identity_conflict");
        const owner = {
            captureId: capture._id,
            operationRequestId: args.requestId,
            attemptRevision: capture.retainedImport.attemptRevision,
        };
        const identity = {
            contentHash: capture.contentHash,
            characters: reservation.characters,
            sizeBytes: reservation.sizeBytes,
        };
        let unattached: Id<"_storage"> | undefined;
        let finalizing = false;
        try {
            if (capture.storageId) {
                const blob = await ctx.storage.get(capture.storageId);
                if (!blob || blob.size !== identity.sizeBytes)
                    throw executionFailure("capture_corrupt");
                verifyRetainedText(
                    identity,
                    new TextDecoder("utf-8", { ignoreBOM: true }).decode(
                        await blob.arrayBuffer(),
                    ),
                );
            } else {
                const parts = [];
                for (let index = 0; index < reservation.fragments; index++) {
                    const part = await ctx.runQuery(
                        internal.sourceCaptures.readRetainedImportPart,
                        { ...owner, index },
                    );
                    parts.push(part);
                }
                const text = verifyRetainedText(identity, parts.join(""));
                unattached = await ctx.storage.store(
                    new Blob([text], { type: "text/plain; charset=utf-8" }),
                );
                await ctx.runMutation(internal.sourceCaptures.attachStorage, {
                    ...owner,
                    storageId: unattached,
                });
                unattached = undefined;
            }
            finalizing = true;
            await ctx.runMutation(internal.sourceCaptures.finalize, {
                ...owner,
                contentHash: identity.contentHash,
                byteCount: identity.sizeBytes,
                resolvedUrl: capture.requestedUrl,
                document: capture.document,
                representationCompleteness: capture.representationCompleteness,
                normalizerVersion: capture.normalizerVersion,
                retrievedAt: capture.retrievedAt,
            });
        } catch (error) {
            if (finalizing) {
                const replay = await ctx.runMutation(
                    internal.sourceCaptures.reserveRetainedImport,
                    args,
                );
                if (replay.status === "ready") return register();
            }
            if (unattached)
                await ctx.runMutation(
                    internal.evidenceArtifacts.deleteUnreferencedArtifact,
                    { storageId: unattached },
                );
            const code =
                preparationFailureCode(error) ?? executionFailureCode(error);
            await ctx.runMutation(internal.sourceCaptures.markUnavailable, {
                ...owner,
                failureCode: code ?? "documentary_import_failed",
            });
            if (!code) throw error;
            return { status: "unavailable", reason: code };
        }
        return register();
    },
});

export const acquireDocument = internalAction({
    args: scheduledOperationArgs,
    returns: v.union(operationOutcomeValidator, v.null()),
    async handler(
        ctx,
        scheduledArgs,
    ): Promise<Infer<typeof operationOutcomeValidator> | null> {
        const { requestId, expectedGeneration } = scheduledArgs;
        const args = { requestId, expectedGeneration };
        return executeScheduledOperation(ctx, scheduledArgs, async () => {
            const scheduled = await ctx.runQuery(
                internal.execution.operations.readScheduledInput,
                scheduledArgs,
            );
            if (
                scheduled.pin.kind === "documentary_v1" &&
                scheduled.pin.scope.kind === "sources"
            ) {
                const reserved = await ctx.runMutation(
                    internal.sourcesMission.reserve,
                    scheduledArgs,
                );
                if (
                    reserved.input.kind !== "acquire_document" ||
                    !reserved.sourceId
                )
                    throw executionFailure("acquisition_target_invalid");
                const result = await inspectSourceDocument(ctx, {
                    preparationId: reserved.preparation._id,
                    sourceId: reserved.sourceId,
                    operationRequestId: args.requestId,
                });
                if (result.status === "unavailable" || !result.sourceCaptureId)
                    return {
                        kind: "unavailable",
                        code: result.reasonCode ?? "capture_unavailable",
                    };
                await ctx.runMutation(internal.sourcesMission.retainCapture, {
                    ...scheduledArgs,
                    captureId: result.sourceCaptureId,
                });
                const { capture, indexed } = await ctx.runQuery(
                    internal.sourceCaptures.acquiredDocumentaryCapture,
                    {
                        ...args,
                        captureId: result.sourceCaptureId,
                    },
                );
                return documentaryCaptureOutcome(
                    args.requestId,
                    capture,
                    indexed,
                );
            }
            const authority = await ctx.runQuery(
                internal.workbenchPublicContext.forExecution,
                args,
            );
            const reference = authority.suppliedReference;
            if (authority.operation !== "acquire_document" || !reference)
                throw executionFailure("operation_not_allowed");
            if (authority.replay?.unavailable)
                return { kind: "unavailable", code: "missing_configuration" };
            const reservation = await ctx
                .runMutation(internal.sourceCaptures.reserveFramingUpload, args)
                .catch((error: unknown) => {
                    if (
                        executionFailureCode(error) === "source_candidate_limit"
                    )
                        return null;
                    throw error;
                });
            if (!reservation)
                return { kind: "unavailable", code: "source_candidate_limit" };
            const { capture, source, shouldExecute } = reservation;
            if (!shouldExecute) {
                if (capture.status === "committed") {
                    const { indexed } = await ctx.runQuery(
                        internal.sourceCaptures.acquiredDocumentaryCapture,
                        { ...args, captureId: capture._id },
                    );
                    return documentaryCaptureOutcome(
                        args.requestId,
                        capture,
                        indexed,
                    );
                }
                return {
                    kind: "unavailable",
                    code: capture.failureCode ?? "inspection_in_progress",
                };
            }

            const owner = {
                captureId: capture._id,
                operationRequestId: args.requestId,
            };
            let unattached: Id<"_storage"> | undefined;
            try {
                const acquisition = await acquireWorkbenchPublicDocument(
                    ctx,
                    args,
                    authority,
                    reference,
                    Math.min(
                        authority.deadlineAt,
                        nodeActionGenerationDeadline(Date.now()),
                    ),
                );
                if (acquisition.kind === "unavailable") {
                    await ctx.runMutation(
                        internal.sourceCaptures.markUnavailable,
                        {
                            ...owner,
                            failureCode: acquisition.code,
                        },
                    );
                    return acquisition;
                }
                const { url, text, dateEvidence, publishedAt } =
                    acquisition.value;
                const fromExa =
                    authority.selectedCandidate && !reference.confirmedSec;
                const normalized = normalizeQualificationText(
                    fromExa && !authority.replay
                        ? normalizeExaText(text).normalizedText
                        : text,
                );
                if (!normalized.normalizedText)
                    throw executionFailure("source_read_unavailable");
                const documentSource = {
                    ...source,
                    origin: reference.confirmedSec
                        ? ("sec" as const)
                        : source.origin,
                    publishedAt,
                };
                const initial = sourceDocumentMetadata(documentSource);
                const document = capturedDocumentMetadata(
                    {
                        ...initial,
                        dates: documentDates({
                            metadata: dateEvidence,
                            text: "",
                            previous: initial.dates,
                        }),
                    },
                    normalized.normalizedText,
                );
                const representationCompleteness =
                    fromExa && !authority.replay
                        ? text.length >= MAX_EXA_TEXT_CHARACTERS
                            ? ("partial" as const)
                            : ("unknown" as const)
                        : ("complete" as const);
                await ctx.runQuery(
                    internal.workbenchPublicContext.forExecution,
                    args,
                );
                const storageId = await ctx.storage.store(
                    new Blob([normalized.normalizedText], {
                        type: "text/plain; charset=utf-8",
                    }),
                );
                unattached = storageId;
                await ctx.runMutation(internal.sourceCaptures.attachStorage, {
                    ...owner,
                    storageId,
                });
                unattached = undefined;
                const recorded = {
                    contentHash: normalized.contentHash,
                    byteCount: normalized.byteCount,
                    document,
                    representationCompleteness,
                    resolvedUrl: url,
                    retrievalVersion: authority.replay
                        ? `framing-replay:${authority.replay.materialHash}`
                        : reference.confirmedSec
                          ? SEC_RETRIEVAL_VERSION
                          : fromExa
                            ? EXA_RETRIEVAL_VERSION
                            : PINNED_PUBLIC_RETRIEVAL_VERSION,
                    normalizerVersion: capture.normalizerVersion,
                    retrievedAt: Date.now(),
                };
                try {
                    await ctx.runMutation(internal.sourceCaptures.finalize, {
                        ...owner,
                        ...recorded,
                    });
                } catch (error) {
                    if (
                        executionFailureCode(error) ||
                        preparationFailureCode(error)
                    )
                        throw error;
                    const replay = await ctx.runMutation(
                        internal.sourceCaptures.reserveFramingUpload,
                        args,
                    );
                    if (replay.capture.status !== "committed") throw error;
                    return documentaryCaptureOutcome(
                        args.requestId,
                        replay.capture,
                    );
                }
                return documentaryCaptureOutcome(args.requestId, {
                    ...capture,
                    ...recorded,
                });
            } catch (error) {
                if (unattached)
                    await ctx.runMutation(
                        internal.evidenceArtifacts.deleteUnreferencedArtifact,
                        {
                            storageId: unattached,
                        },
                    );
                await ctx.runMutation(internal.sourceCaptures.markUnavailable, {
                    ...owner,
                    failureCode:
                        executionFailureCode(error) ?? "inspection_failed",
                });
                throw error;
            }
        });
    },
});

function documentaryCaptureOutcome(
    requestId: Id<"agentOperationRequests">,
    capture: Doc<"sourceCaptures">,
    indexed = false,
) {
    if (
        !capture.contentHash ||
        !capture.document ||
        !capture.representationCompleteness ||
        capture.retrievedAt === undefined
    )
        throw executionFailure("capture_identity_changed");
    return operationSuccess(
        acquireDocumentResult,
        {
            kind: "acquire_document",
            sourceId: capture.sourceId,
            captureId: capture._id,
            contentHash: capture.contentHash,
            canonicalUrl: capture.requestedUrl,
            document: capture.document,
            representationCompleteness: capture.representationCompleteness,
            retrievedAt: capture.retrievedAt,
            indexStatus: indexed ? "indexed" : "not_indexed",
            readingReference: documentaryReference({
                issuer: "operation",
                operationId: requestId,
                item: "document",
            }),
        },
        {
            captureId: capture._id,
            progressKey: `acquired:${capture._id}:${capture.contentHash}`,
        },
    );
}

export async function observeWorkbenchDocumentaryProvider<T>(
    ctx: ActionCtx,
    { piLease, ...request }: DocumentaryProviderRequest,
    operation: "framing_context_search" | "framing_context_read",
    input: unknown,
    deadlineAt: number,
    timeout: number,
    dispatch: (
        signal: AbortSignal,
        observeDispatch: ObserveProviderDispatch,
    ) => Promise<{ value: T; cost?: number }>,
    service: "exa" | "sec" | "url_metadata" = "exa",
    stepKey: string = operation,
) {
    const authority = await ctx.runQuery(
        internal.workbenchPublicContext.forExecution,
        request,
    );
    const attempt = {
        missionId: authority.missionId,
        runId: authority.runId,
        corpusRevisionId: authority.corpusRevisionId,
        workflowVersion: authority.workflowVersion,
        executionGeneration: request.expectedGeneration,
        operationRequestId: request.requestId,
        service,
        operation,
        stepKey,
        attempt: 1,
        inputHash: framingProviderInputHash(
            input,
            authority.acquisitionInputHash,
        ),
        ...(operation === "framing_context_search"
            ? { searchQuery: authority.query }
            : {}),
        operationKey: `workbench:${request.requestId}:${stepKey}`,
    };
    const admitted = await ctx.runMutation(
        internal.providerCalls.recordAttempt,
        { ...attempt, status: "started", piLease },
    );
    if (!admitted.shouldExecute)
        return {
            kind: "unavailable" as const,
            code: "operation_outcome_unknown",
        };
    const startedAt = Date.now();
    const available = Math.min(deadlineAt, authority.deadlineAt) - startedAt;
    if (available <= 0) {
        await ctx.runMutation(internal.providerCalls.recordAttempt, {
            ...attempt,
            status: "failed",
            errorCode: "execution_deadline",
            retryable: false,
            dispatchOutcome: "not_dispatched",
        });
        return { kind: "unavailable" as const, code: "execution_deadline" };
    }
    const attemptObservation: {
        outcome: "not_dispatched" | "unknown" | "response_received";
    } = { outcome: "not_dispatched" };
    let observation: { value: T; cost?: number };
    try {
        observation = await dispatch(
            AbortSignal.timeout(Math.min(available, timeout)),
            (outcome) => {
                attemptObservation.outcome = outcome;
            },
        );
    } catch (error) {
        const code =
            error instanceof PublicSourceUrlError
                ? error.data.code === "dns_failed"
                    ? "source_url_unavailable"
                    : "source_url_not_public"
                : error instanceof DiscoveryRequestError
                  ? error.code
                  : error instanceof ExaContentsError
                    ? error.errorCode
                    : error instanceof ManualSourceIntakeError
                      ? error.data.code
                      : (executionFailureCode(error) ??
                        "framing_provider_failed");
        await ctx.runMutation(internal.providerCalls.recordAttempt, {
            ...attempt,
            status: "failed",
            errorCode: code,
            retryable: false,
            dispatchOutcome: attemptObservation.outcome,
            latencyMs: Date.now() - startedAt,
        });
        return {
            kind: "unavailable" as const,
            code,
        };
    }
    await ctx.runMutation(internal.providerCalls.recordAttempt, {
        ...attempt,
        status: "succeeded",
        reportedCost: observation.cost,
        dispatchOutcome: "response_received",
        latencyMs: Date.now() - startedAt,
    });
    return { kind: "observed" as const, value: observation.value };
}

export async function resolvePublicDocumentAddresses(hostname: string) {
    return (await lookup(hostname, { all: true, verbatim: true })).map(
        ({ address }) => address,
    );
}

async function readPinnedPublisher(
    ctx: ActionCtx,
    { requestId, expectedGeneration }: Request,
    url: string,
    confirmedSec: boolean,
    signal: AbortSignal,
    observeDispatch: ObserveProviderDispatch,
    media: "document" | "json" = "document",
) {
    let current = url;
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
        await ctx.runQuery(internal.workbenchPublicContext.forExecution, {
            requestId,
            expectedGeneration,
        });
        signal.throwIfAborted();
        let abort: ReturnType<typeof addAbortListener> | undefined;
        const destination = await Promise.race([
            validatePublicSourceUrl(current, resolvePublicDocumentAddresses),
            new Promise<never>((_, reject) => {
                abort = addAbortListener(signal, () => reject(signal.reason));
            }),
        ]).finally(() => abort?.[Symbol.dispose]());
        const address = destination.addresses[0];
        if (!address) throw executionFailure("source_url_not_public");
        await ctx.runQuery(internal.workbenchPublicContext.forExecution, {
            requestId,
            expectedGeneration,
        });
        signal.throwIfAborted();
        if (confirmedSec) {
            const { retryAfter } = await ctx.runMutation(
                internal.providerCalls.reserveSecRateLimit,
                {},
            );
            if (retryAfter) throw executionFailure("sec_rate_limit");
            await ctx.runQuery(internal.workbenchPublicContext.forExecution, {
                requestId,
                expectedGeneration,
            });
            signal.throwIfAborted();
        }
        const response = await requestPinnedPublicSource(
            destination.canonicalUrl,
            address,
            {
                signal,
                observeDispatch,
                maxBytes: MAX_APPROVED_SOURCE_BYTES,
                ...(confirmedSec
                    ? {
                          headers: {
                              ...(media === "json"
                                  ? { Accept: "application/json" }
                                  : {}),
                              "User-Agent":
                                  process.env.SEC_USER_AGENT?.trim() ||
                                  "Evidence Workbench research@evidence-workbench.org",
                          },
                      }
                    : {}),
            },
        );
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get("location");
            await response.body?.cancel();
            if (confirmedSec)
                throw executionFailure("sec_filing_identity_changed");
            if (!location)
                throw executionFailure("source_redirect_unavailable");
            current = new URL(location, destination.canonicalUrl).toString();
            continue;
        }
        const mediaType = response.headers
            .get("content-type")
            ?.split(";")[0]
            ?.trim();
        if (
            !response.ok ||
            !(
                media === "json"
                    ? ["application/json"]
                    : ["text/html", "application/xhtml+xml", "text/plain"]
            ).includes(mediaType ?? "")
        ) {
            await response.body?.cancel();
            throw executionFailure("source_read_unavailable");
        }
        return {
            url: destination.canonicalUrl,
            text: await response.text(),
            mediaType,
        };
    }
    throw executionFailure("source_redirect_unavailable");
}

export async function acquireWorkbenchSuppliedReference(
    ctx: ActionCtx,
    args: DocumentaryProviderRequest,
    supplied: SuppliedReference,
    deadlineAt: number,
) {
    const filingInput = framingSecReadInput(supplied, "sec_filing");
    if (filingInput) {
        let publishedAt = supplied.publishedAt;
        const submissions = framingSecReadInput(supplied, "sec_submissions");
        if (submissions) {
            const metadata = await observeWorkbenchDocumentaryProvider(
                ctx,
                args,
                "framing_context_read",
                submissions,
                deadlineAt,
                DEFAULT_SEC_TIMEOUT_MS,
                async (signal, observeDispatch) => {
                    const page = await readPinnedPublisher(
                        ctx,
                        args,
                        submissions.url,
                        true,
                        signal,
                        observeDispatch,
                        "json",
                    );
                    return {
                        value: secFilingPublicationTime(
                            JSON.parse(page.text),
                            submissions,
                        ),
                    };
                },
                "sec",
                "sec_submissions",
            );
            if (metadata.kind === "unavailable") return metadata;
            publishedAt = metadata.value;
        }
        return observeWorkbenchDocumentaryProvider(
            ctx,
            args,
            "framing_context_read",
            filingInput,
            deadlineAt,
            DEFAULT_SEC_TIMEOUT_MS,
            async (signal, observeDispatch) => {
                const page = await readPinnedPublisher(
                    ctx,
                    args,
                    filingInput.url,
                    true,
                    signal,
                    observeDispatch,
                );
                const filing = await retrieveAndNormalizeSecFiling(
                    { retrieveDocumentHtml: async () => page.text },
                    { canonicalUrl: filingInput.url, origin: "sec" },
                );
                if (filing.status !== "succeeded" || !filing.normalizedText)
                    throw executionFailure("sec_filing_unavailable");
                return {
                    value: {
                        url: filing.canonicalUrl,
                        text: filing.normalizedText,
                        dateEvidence: [] as DateEvidence[],
                        publishedAt,
                    },
                };
            },
            "sec",
            "sec_filing",
        );
    }
    return observeWorkbenchDocumentaryProvider(
        ctx,
        args,
        "framing_context_read",
        supplied,
        deadlineAt,
        MANUAL_SOURCE_METADATA_TIMEOUT_MS,
        async (signal, observeDispatch) => {
            const page = await readPinnedPublisher(
                ctx,
                args,
                supplied.url,
                false,
                signal,
                observeDispatch,
            );
            const knownPublishedAt =
                page.url === supplied.url ? supplied.publishedAt : undefined;
            return {
                value: {
                    url: page.url,
                    text: normalizeSecHtml(page.text).normalizedText,
                    dateEvidence: extractHtmlPublicationEvidence(page.text),
                    publishedAt: knownPublishedAt,
                },
            };
        },
        "url_metadata",
    );
}

export async function acquireWorkbenchPublicDocument(
    ctx: ActionCtx,
    args: DocumentaryProviderRequest,
    authority: FunctionReturnType<
        typeof internal.workbenchPublicContext.forExecution
    >,
    reference: SuppliedReference,
    deadlineAt: number,
) {
    const read = configuredExaContentsClient();
    let text: string;
    let dateEvidence: DateEvidence[] = [];
    let publishedAt = reference.publishedAt;
    let url = reference.url;
    if (authority.replay) {
        const doc = authority.replay.documents.find((doc) => doc.url === url);
        if (!doc)
            return {
                kind: "unavailable" as const,
                code: "source_reference_not_observed",
            };
        text = reference.confirmedSec
            ? normalizeSecHtml(doc.text).normalizedText
            : doc.text;
        publishedAt =
            doc.publishedAt === undefined
                ? undefined
                : Date.parse(doc.publishedAt);
    } else if (authority.selectedCandidate && !reference.confirmedSec) {
        if (!read)
            return {
                kind: "unavailable" as const,
                code: "missing_configuration",
            };
        const options = {
            text: { maxCharacters: MAX_EXA_TEXT_CHARACTERS },
        };
        const result = await observeWorkbenchDocumentaryProvider(
            ctx,
            args,
            "framing_context_read",
            { urls: [url], options },
            deadlineAt,
            DEFAULT_EXA_CONTENTS_TIMEOUT_MS,
            async (signal, observeDispatch) => {
                await validatePublicSourceUrl(
                    url,
                    resolvePublicDocumentAddresses,
                );
                await ctx.runQuery(
                    internal.workbenchPublicContext.forExecution,
                    {
                        requestId: args.requestId,
                        expectedGeneration: args.expectedGeneration,
                    },
                );
                signal.throwIfAborted();
                const contents = await read.getContents([url], options, {
                    signal,
                    observeDispatch,
                });
                return {
                    value: contents.results,
                    cost: contents.costDollars?.total,
                };
            },
        );
        if (result.kind === "unavailable") return result;
        const matching = result.value.filter((item) => item.url === url);
        text = matching.length === 1 ? (matching[0]?.text ?? "") : "";
    } else {
        const result = await acquireWorkbenchSuppliedReference(
            ctx,
            args,
            reference,
            deadlineAt,
        );
        if (result.kind === "unavailable") return result;
        ({ text, url, publishedAt } = result.value);
        dateEvidence = result.value.dateEvidence;
    }
    return {
        kind: "observed" as const,
        value: { text, url, publishedAt, dateEvidence },
    };
}
