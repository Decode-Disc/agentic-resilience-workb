"use node";

import { lookup } from "node:dns/promises";
import {
    materializeSourceComparisonOutput,
    prepareSourceComparisonInput,
    rankSourceComparisonPrimaryMetadata,
    type SourceComparisonCheckStatus,
    type SourceComparisonOutput,
    type SourceComparisonPrimaryCandidate,
    sourceFindingNeedsComparison,
} from "@convex/domain/sourceComparison";
import {
    extractPassagesFromNormalizedText,
    sha256Hex,
} from "@convex/domain/sourcePassages";
import {
    preparationFailureCode,
    sourcePreparationError,
    sourcePreparationOutcomeValidator,
    sourcePreparationStopCodeValidator,
} from "@convex/domain/sourcePreparationAuthority";
import {
    prepareQualificationInput,
    qualificationExecutionVersion,
} from "@convex/domain/sourceQualification";
import {
    SOURCE_RETRIEVAL_VERSION,
    sourceComparisonQuery,
} from "@convex/domain/sourceRetrievalPolicy";
import { isOpenRouterConfigured } from "@convex/integrations/openRouterConfiguration";
import { SecRetryableError } from "@convex/integrations/sec";
import {
    compareSourceContributions,
    qualifySourceDocument,
} from "@convex/integrations/sourceQualification";
import { SOURCE_COMPARISON_MAX_PRIMARY_CAPTURES } from "@convex/resourcePolicy";
import type { FunctionReturnType } from "convex/server";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction } from "./_generated/server";
import { discoveryFailure } from "./domain/sourceDiscoveryRecovery";
import {
    SOURCE_COVERAGE_ROLES,
    SOURCE_ROLE_REQUIREMENTS,
} from "./domain/sourceSelectionPolicy";
import { validateExaCandidates } from "./integrations/exaCandidateValidation";
import { configuredExaHttpDiscovery } from "./integrations/exaSearchClient";
import { SOURCE_EMBEDDING_PROFILE } from "./integrations/sourceEmbeddings";
import { nodeActionGenerationDeadline } from "./resourcePolicy";
import {
    inspectSourceDocument,
    sourcePreparationArgsValidator,
} from "./sourceCaptureActions";
import {
    secFilingCandidate,
    selectSecFilingsForDiscovery,
} from "./sourceDiscoveryActions";
import {
    ensureSourceCaptureIndex,
    retrieveSourcePassages,
} from "./sourceRetrievalActions";
import { executePreparationModel } from "./sources/preparationModel";
import { preparationSecResolver } from "./sources/preparationSec";

// Retained function path for persisted Workflow handles.
export { inspectSource } from "./sourceCaptureActions";

const supplementResultValidator = v.union(
    v.object({ status: v.literal("searched") }),
    v.object({ status: v.literal("complete") }),
    v.object({
        status: v.literal("blocked"),
        reasonCode: sourcePreparationStopCodeValidator,
        retryAt: v.optional(v.number()),
    }),
);

/** Checks the invocation environment before acquisition, without contacting a provider. */
export const checkConfiguration = internalAction({
    args: { preparationId: v.id("sourceSelectionProposalRebuilds") },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        await ctx.runQuery(internal.sourcePreparation.getForExecution, {
            ...args,
            now: Date.now(),
        });
        const available = isOpenRouterConfigured();
        await ctx.runMutation(
            internal.sourcePreparation.recordConfigurationCheck,
            { ...args, available },
        );
        return available;
    },
});

export const searchSupplement = internalAction({
    args: { preparationId: v.id("sourceSelectionProposalRebuilds") },
    returns: supplementResultValidator,
    handler: async (
        ctx,
        args,
    ): Promise<Infer<typeof supplementResultValidator>> => {
        const verifyActive = () =>
            ctx.runQuery(internal.sourcePreparation.getForExecution, {
                ...args,
                now: Date.now(),
            });
        const preparation = await verifyActive();
        if (preparation.target && preparation.insertedCount !== undefined)
            return { status: "complete" };
        const searchExa = configuredExaHttpDiscovery();
        const userAgent = process.env.SEC_USER_AGENT?.trim();
        let reservation: FunctionReturnType<
            typeof internal.sourcePreparation.reserveNextSupplementSearch
        >;
        try {
            reservation = await ctx.runMutation(
                internal.sourcePreparation.reserveNextSupplementSearch,
                {
                    ...args,
                    configuration: {
                        sec: Boolean(userAgent),
                        exa: Boolean(searchExa),
                    },
                },
            );
        } catch (error) {
            const code = preparationFailureCode(error);
            if (
                code === "missing_configuration" ||
                code === "paid_work_disabled"
            )
                return { status: "blocked", reasonCode: code };
            throw error;
        }
        if (!reservation) return { status: "complete" };
        if (!reservation.shouldExecute)
            return {
                status: "blocked",
                reasonCode: reservation.reasonCode ?? "transport_unavailable",
                retryAt: reservation.retryAt,
            };
        const regulatory = reservation.query.discoveryIntent === "regulatory";
        const startedAt = Date.now();
        const attempt = {
            runId: preparation.runId,
            corpusRevisionId: preparation.corpusRevisionId,
            preparationId: preparation._id,
            executionGeneration: preparation.executionGeneration,
            workflowVersion: preparation.workflowVersion,
            stepKey: "source_preparation",
            service: regulatory ? ("sec" as const) : ("exa" as const),
            operation: "source_supplement_search",
            operationKey: reservation.operationKey,
            attempt: reservation.attempt ?? 1,
        };
        try {
            await verifyActive();
            const signal = AbortSignal.timeout(
                Math.max(1, (preparation.deadlineAt ?? startedAt) - Date.now()),
            );
            if (regulatory && reservation.companyCik) {
                const resolver = preparationSecResolver(ctx, preparation, {
                    maxAttempts: 1,
                    recordAttempt: async () => ({ shouldExecute: true }),
                });
                const result = await resolver.inspectEvidence(
                    reservation.companyCik,
                );
                if (
                    result.company.cik !==
                    reservation.companyCik.replace(/^0+/, "")
                )
                    throw sourcePreparationError("request_invalid");
                await verifyActive();
                const filings = selectSecFilingsForDiscovery(
                    result.filings,
                    4,
                    undefined,
                    preparation.target?.kind === "coverage"
                        ? preparation.target.role
                        : undefined,
                );
                const candidates = filings
                    .filter(
                        (f) =>
                            /^\d{10}-\d{2}-\d{6}$/.test(f.accessionNumber) &&
                            (!f.primaryDocument ||
                                /^[\w.-]+$/.test(f.primaryDocument)),
                    )
                    .map((filing, index) =>
                        secFilingCandidate(result.company.cik, filing, index),
                    );
                await ctx.runMutation(
                    internal.sourceDiscovery.persistCandidates,
                    {
                        ...args,
                        runId: preparation.runId,
                        corpusRevisionId: preparation.corpusRevisionId,
                        executionGeneration: preparation.executionGeneration,
                        operationKey: reservation.operationKey,
                        candidates,
                        providerCompletion: {
                            providerCallId: reservation.providerCallId,
                            status:
                                candidates.length === filings.length
                                    ? "succeeded"
                                    : "partial",
                            latencyMs: Date.now() - startedAt,
                            accepted: candidates.length,
                            rejected: filings.length - candidates.length,
                        },
                    },
                );
                return { status: "searched" };
            }
            if (!searchExa)
                throw sourcePreparationError("missing_configuration");
            const batch = await searchExa(
                reservation.query.query,
                4,
                reservation.query.includeDomains,
                signal,
            );
            const validated = await validateExaCandidates(
                batch.candidates.slice(0, 4),
                async (hostname) => {
                    await verifyActive();
                    signal.throwIfAborted();
                    return (
                        await lookup(hostname, { all: true, verbatim: true })
                    ).map(({ address }) => address);
                },
                signal,
            );
            await verifyActive();
            const rejected =
                batch.rejected +
                validated.rejected +
                Math.max(0, batch.candidates.length - 4);
            await ctx.runMutation(internal.sourceDiscovery.persistCandidates, {
                ...args,
                runId: preparation.runId,
                corpusRevisionId: preparation.corpusRevisionId,
                executionGeneration: preparation.executionGeneration,
                operationKey: reservation.operationKey,
                candidates: validated.candidates.map((candidate) => ({
                    ...candidate,
                    origin: "exa" as const,
                    category:
                        reservation.query.discoveryIntent ??
                        reservation.query.category,
                })),
                providerCompletion: {
                    providerCallId: reservation.providerCallId,
                    status: rejected > 0 ? "partial" : "succeeded",
                    latencyMs: Date.now() - startedAt,
                    accepted: validated.candidates.length,
                    rejected,
                    searchTime: batch.searchTime,
                    reportedCost: batch.costDollars,
                },
            });
            return { status: "searched" };
        } catch (error) {
            const failure =
                error instanceof SecRetryableError
                    ? {
                          code:
                              error.httpStatus !== undefined
                                  ? `http_${error.httpStatus}`
                                  : error.name === "SecTimeoutError"
                                    ? "timeout"
                                    : "sec_unavailable",
                          retryable: true,
                          retryAfterAt: error.retryAfterAt,
                      }
                    : discoveryFailure(error);
            await ctx.runMutation(internal.providerCalls.recordAttempt, {
                ...attempt,
                status: "failed",
                errorCode: failure.code,
                dispatchOutcome: /^http_\d{3}$/.test(failure.code)
                    ? "response_received"
                    : "unknown",
                httpStatus: /^http_\d{3}$/.test(failure.code)
                    ? Number(failure.code.slice(5))
                    : undefined,
                retryAfterAt:
                    "retryAfterAt" in failure
                        ? failure.retryAfterAt
                        : undefined,
                retryable: false,
                latencyMs: Date.now() - startedAt,
            });
            const code = preparationFailureCode(error);
            if (
                code &&
                code !== "request_invalid" &&
                code !== "source_url_unavailable"
            )
                throw error;
            return {
                status: "blocked",
                reasonCode: failure.retryable
                    ? "transport_unavailable"
                    : "request_invalid",
                retryAt:
                    "retryAfterAt" in failure
                        ? failure.retryAfterAt
                        : undefined,
            };
        }
    },
});

const qualificationResultValidator = v.union(
    v.object({ status: v.literal("qualified"), taskId: v.id("aiTaskResults") }),
    v.object({ status: v.literal("unavailable"), reasonCode: v.string() }),
);

const comparisonResultValidator = v.object({
    status: v.union(
        v.literal("compared"),
        v.literal("not_run"),
        v.literal("cached"),
        v.literal("unavailable"),
    ),
    taskId: v.optional(v.id("aiTaskResults")),
    reasonCode: v.optional(v.string()),
});

const qualificationArgsValidator = v.object({
    preparationId: v.id("sourceSelectionProposalRebuilds"),
    sourceCaptureId: v.id("sourceCaptures"),
});

export const qualifySource = internalAction({
    args: qualificationArgsValidator,
    returns: qualificationResultValidator,
    handler: (ctx, args) =>
        qualifyCapturedSource(
            ctx,
            args,
            nodeActionGenerationDeadline(Date.now()),
        ),
});

async function qualifyCapturedSource(
    ctx: ActionCtx,
    args: Infer<typeof qualificationArgsValidator>,
    executionDeadlineAt: number,
): Promise<Infer<typeof qualificationResultValidator>> {
    try {
        const { capture, source, company, asOfTime, researchAngle } =
            await ctx.runQuery(
                internal.sourcePreparation.getQualificationInput,
                { ...args, now: Date.now() },
            );
        if (!capture.storageId)
            throw sourcePreparationError("capture_unavailable");
        const blob = await ctx.storage.get(capture.storageId);
        if (!blob || blob.size > 16 * 1024 * 1024)
            throw sourcePreparationError("capture_unavailable");
        const text = await blob.text();
        if (sha256Hex(text) !== capture.contentHash)
            throw sourcePreparationError("capture_corrupt");
        const preparation = await ctx.runQuery(
            internal.sourcePreparation.getForExecution,
            {
                preparationId: args.preparationId,
                sourceId: source._id,
                now: Date.now(),
            },
        );
        const qualificationInput = {
            protocolVersion: qualificationExecutionVersion(
                preparation.qualificationVersion,
            ),
            company,
            canonicalUrl: capture.resolvedUrl ?? source.canonicalUrl,
            title: source.title,
            asOfTime,
            researchAngle,
            text,
            retrievalCompleteness: capture.readingCompleteness,
            selectionPolicy: capture.qualificationInputPolicy,
        };
        const wholeDocument = capture.qualificationInputPolicy
            ? prepareQualificationInput(qualificationInput)
            : undefined;
        let retrieval: Parameters<
            typeof prepareQualificationInput
        >[0]["retrieval"];
        if (
            preparation.retrievalVersion === SOURCE_RETRIEVAL_VERSION &&
            preparation.retrievalMode &&
            !wholeDocument?.retainsAllPassages
        ) {
            await ensureSourceCaptureIndex(ctx, {
                preparationId: args.preparationId,
                captureId: capture._id,
                mode: preparation.retrievalMode,
            });
            const result = await retrieveSourcePassages(ctx, {
                preparationId: args.preparationId,
                captureIds: [capture._id],
                mode: preparation.retrievalMode,
                queries: SOURCE_COVERAGE_ROLES.map(
                    (role) =>
                        `${role.replaceAll("_", " ")} ${researchAngle ?? ""} ${SOURCE_ROLE_REQUIREMENTS[role].description}`,
                ),
            });
            retrieval = {
                metadata: result.metadata,
                passageOrders: result.passages.map((p) => p.order),
            };
        }
        const prepared = retrieval
            ? prepareQualificationInput({
                  ...qualificationInput,
                  retrieval,
              })
            : (wholeDocument ?? prepareQualificationInput(qualificationInput));
        const cached = await ctx.runQuery(
            internal.sourcePreparation.getQualification,
            {
                runId: capture.runId,
                inputHash: prepared.inputHash,
            },
        );
        if (cached) return { status: "qualified", taskId: cached._id };
        if (!isOpenRouterConfigured())
            return {
                status: "unavailable",
                reasonCode: "missing_configuration",
            };

        const outcome = await executePreparationModel(ctx, {
            preparation,
            executionDeadlineAt,
            sourceId: source._id,
            operation: "source_qualification",
            inputHash: prepared.inputHash,
            invocationInputJson: JSON.stringify(prepared.request),
            execute: (route, dependencies) =>
                qualifySourceDocument(prepared, route, dependencies),
        });
        if ("reasonCode" in outcome)
            return {
                status: "unavailable",
                reasonCode: outcome.reasonCode,
            };
        if (outcome.result.status !== "succeeded")
            throw sourcePreparationError("qualification_unavailable");
        const taskId = await ctx.runMutation(
            internal.sourcePreparation.saveQualification,
            {
                ...args,
                receipt: outcome.receipt,
                providerCallId: outcome.providerCallId,
                inputHash: prepared.inputHash,
                qualification: outcome.result.qualification,
                ...(prepared.request.document.selectionStrategy
                    ? {
                          selectionStrategy:
                              prepared.request.document.selectionStrategy,
                      }
                    : {}),
                readingCompleteness:
                    capture.readingCompleteness === "partial"
                        ? "partial"
                        : prepared.readingCompleteness,
                omittedPassageCount: Math.max(
                    capture.omittedPassageCount ?? 0,
                    prepared.omittedPassageCount,
                ),
                ...(prepared.request.retrieval
                    ? { retrieval: prepared.request.retrieval }
                    : {}),
                selectedPassages: prepared.request.document.passages.map(
                    (passage) => ({
                        passageKey: passage.passageKey,
                        startOffset: passage.startOffset,
                        endOffset: passage.endOffset,
                    }),
                ),
            },
        );
        return { status: "qualified", taskId };
    } catch (error) {
        const reasonCode = preparationFailureCode(error);
        if (!reasonCode) throw error;
        return { status: "unavailable", reasonCode };
    }
}

export const compareSource = internalAction({
    args: {
        preparationId: v.id("sourceSelectionProposalRebuilds"),
        sourceCaptureId: v.id("sourceCaptures"),
        qualificationTaskId: v.id("aiTaskResults"),
    },
    returns: comparisonResultValidator,
    handler: async (
        ctx,
        args,
    ): Promise<Infer<typeof comparisonResultValidator>> => {
        const executionDeadlineAt = nodeActionGenerationDeadline(Date.now());
        const persist = async (result: {
            inputHash: string;
            qualificationTaskId: Id<"aiTaskResults">;
            output: SourceComparisonOutput;
            providerCallId?: Id<"providerCalls">;
            receipt?: {
                latencyMs: number;
                usage?: unknown;
                reportedCost?: number;
            };
        }) => {
            const taskId = await ctx.runMutation(
                internal.sourcePreparation.saveComparison,
                {
                    preparationId: args.preparationId,
                    sourceCaptureId: args.sourceCaptureId,
                    comparisonContextHash,
                    ...result,
                },
            );
            return taskId;
        };
        let comparisonContextHash: string | undefined;
        const makeTerminalOutput = (
            prepared: ReturnType<typeof prepareSourceComparisonInput>,
            checkStatus: SourceComparisonCheckStatus,
        ) => {
            const result = materializeSourceComparisonOutput(
                prepared,
                { findings: [] },
                checkStatus,
            );
            if (result.status !== "valid")
                throw sourcePreparationError("comparison_output_invalid");
            return result.output;
        };
        try {
            const input = await ctx.runQuery(
                internal.sourcePreparation.getComparisonInput,
                {
                    ...args,
                    now: Date.now(),
                },
            );
            comparisonContextHash = input.comparisonContextHash;
            const modelBudgetExhausted = input.modelBudgetBlocked;
            if (!input.targetCapture.storageId)
                throw sourcePreparationError("capture_unavailable");
            const targetBlob = await ctx.storage.get(
                input.targetCapture.storageId,
            );
            if (
                !targetBlob ||
                targetBlob.size > 16 * 1024 * 1024 ||
                !input.targetCapture.contentHash
            )
                throw sourcePreparationError("capture_unavailable");
            const targetText = await targetBlob.text();
            if (sha256Hex(targetText) !== input.targetCapture.contentHash)
                throw sourcePreparationError("capture_corrupt");

            const target = {
                runId: String(input.run._id),
                corpusRevisionId: String(input.revision._id),
                sourceId: String(input.targetSource._id),
                captureId: String(input.targetCapture._id),
                contentHash: input.targetCapture.contentHash,
                qualificationTaskId: String(input.qualificationTask._id),
                qualificationVersion: input.qualificationTask.schemaVersion,
                title: input.targetSource.title,
                canonicalUrl:
                    input.targetCapture.resolvedUrl ??
                    input.targetSource.canonicalUrl,
                text: targetText,
                selectedPassages:
                    input.qualificationTask.output.kind ===
                    "source_qualification"
                        ? input.qualificationTask.output.selectedPassages
                        : [],
                qualification:
                    input.qualificationTask.output.kind ===
                    "source_qualification"
                        ? input.qualificationTask.output.qualification
                        : {
                              companyMatch: "uncertain" as const,
                              companyPassages: [],
                              documentKind: "unknown" as const,
                              reportingPeriodEnd: null,
                              reportingPeriodPassages: [],
                              findings: [],
                              limitations: [],
                          },
            };
            const retained = input.retainedComparison;
            if (
                retained?.output.kind === "source_comparison" &&
                (!retained.output.retrieval ||
                    retained.output.retrieval.effectiveMode ===
                        input.preparation.retrievalMode)
            ) {
                const checked = new Set<string>();
                let readBytes = targetBlob.size;
                for (const finding of retained.output.findings) {
                    for (const passage of finding.targetPassages)
                        if (
                            targetText.slice(
                                passage.startOffset,
                                passage.endOffset,
                            ) !== passage.quotation
                        )
                            throw sourcePreparationError(
                                "cached_comparison_invalid",
                            );
                    for (const passage of finding.primaryPassages) {
                        const candidate = input.primaryCandidates.find(
                            (p) =>
                                p.capture._id === passage.captureId &&
                                p.capture.contentHash === passage.contentHash,
                        );
                        if (!candidate?.capture.storageId)
                            throw sourcePreparationError(
                                "cached_comparison_invalid",
                            );
                        if (checked.has(passage.captureId)) continue;
                        checked.add(passage.captureId);
                        const blob = await ctx.storage.get(
                            candidate.capture.storageId,
                        );
                        if (
                            !blob ||
                            blob.size !== candidate.capture.byteCount ||
                            blob.size > 16 * 1024 * 1024
                        )
                            throw sourcePreparationError("capture_unavailable");
                        readBytes += blob.size;
                        if (readBytes > 32 * 1024 * 1024)
                            throw sourcePreparationError(
                                "retrieval_read_limit",
                            );
                        const text = await blob.text();
                        if (sha256Hex(text) !== passage.contentHash)
                            throw sourcePreparationError("capture_corrupt");
                        for (const check of retained.output.findings
                            .flatMap((f) => f.primaryPassages)
                            .filter((p) => p.captureId === passage.captureId))
                            if (
                                text.slice(
                                    check.startOffset,
                                    check.endOffset,
                                ) !== check.quotation
                            )
                                throw sourcePreparationError(
                                    "cached_comparison_invalid",
                                );
                    }
                }
                await ctx.runMutation(
                    internal.sourcePreparation.confirmComparisonContext,
                    {
                        ...args,
                        taskId: retained._id,
                        inputHash: retained.inputHash,
                        comparisonContextHash: input.comparisonContextHash,
                    },
                );
                return { status: "cached", taskId: retained._id };
            }
            if (
                !target.qualification.findings.some((finding) =>
                    sourceFindingNeedsComparison(
                        finding,
                        target.qualification.limitations,
                    ),
                )
            ) {
                const prepared = prepareSourceComparisonInput({
                    company: input.company,
                    target,
                    primaryCandidates: [],
                });
                const existing = await ctx.runQuery(
                    internal.sourcePreparation.getComparison,
                    { ...args, inputHash: prepared.inputHash, now: Date.now() },
                );
                if (existing.status === "stale")
                    throw sourcePreparationError("cached_comparison_invalid");
                if (existing.status === "cached")
                    return { status: "cached", taskId: existing.taskId };
                return {
                    status: "not_run",
                    taskId: await persist({
                        inputHash: prepared.inputHash,
                        qualificationTaskId: args.qualificationTaskId,
                        output: makeTerminalOutput(prepared, "not_run"),
                    }),
                };
            }
            const metadata = input.primaryCandidates.map((candidate) => ({
                sourceId: String(candidate.source._id),
                captureId: String(candidate.capture._id),
                contentHash: candidate.capture.contentHash as string,
                title: candidate.source.title,
                canonicalUrl:
                    candidate.capture.resolvedUrl ??
                    candidate.source.canonicalUrl,
                authorityTier: candidate.context.authorityTier,
                documentKind: candidate.context.documentKind,
                documentPurpose: candidate.source.category,
                coverageRole: candidate.context.coverageRole,
                reportingPeriodEnd: candidate.reportingPeriodEnd,
                publishedAt: candidate.source.publishedAt,
            }));
            const retrievalPreparation = await ctx.runQuery(
                internal.sourcePreparation.getForExecution,
                { preparationId: args.preparationId, now: Date.now() },
            );
            let retrieval: Parameters<
                typeof prepareSourceComparisonInput
            >[0]["retrieval"];
            let indexReadBytes = 0;
            if (
                retrievalPreparation.retrievalVersion ===
                    SOURCE_RETRIEVAL_VERSION &&
                retrievalPreparation.retrievalMode
            ) {
                const retrievalMode = retrievalPreparation.retrievalMode;
                const indexedIds: Id<"sourceCaptures">[] = [];
                const readyIndexes = new Map<string, boolean>();
                for (
                    let offset = 0;
                    offset < input.primaryCandidates.length;
                    offset += 8
                ) {
                    const entries = await ctx.runQuery(
                        internal.sourceRetrieval.getCaptureIndexBatch,
                        {
                            preparationId: args.preparationId,
                            captureIds: input.primaryCandidates
                                .slice(offset, offset + 8)
                                .map((p) => p.capture._id),
                        },
                    );
                    for (const { capture, state } of entries)
                        readyIndexes.set(
                            capture._id,
                            !!state &&
                                (retrievalMode === "lexical" ||
                                    state.embeddingProfile ===
                                        SOURCE_EMBEDDING_PROFILE.id),
                        );
                }
                for (const candidate of input.primaryCandidates) {
                    try {
                        const indexed = readyIndexes.get(candidate.capture._id)
                            ? { readBytes: 0 }
                            : await ensureSourceCaptureIndex(ctx, {
                                  preparationId: args.preparationId,
                                  captureId: candidate.capture._id,
                                  mode: retrievalMode,
                                  allowProviderCalls: !modelBudgetExhausted,
                                  maxReadBytes:
                                      32 * 1024 * 1024 -
                                      targetBlob.size -
                                      indexReadBytes,
                              });
                        indexReadBytes += indexed.readBytes;
                    } catch (error) {
                        if (
                            preparationFailureCode(error) ===
                            "retrieval_read_limit"
                        )
                            continue;
                        throw error;
                    }
                    indexedIds.push(candidate.capture._id);
                }
                const findings = target.qualification.findings.flatMap(
                    (finding, findingIndex) =>
                        sourceFindingNeedsComparison(
                            finding,
                            target.qualification.limitations,
                            target.qualificationVersion,
                        )
                            ? [{ finding, findingIndex }]
                            : [],
                );
                const result = await retrieveSourcePassages(ctx, {
                    preparationId: args.preparationId,
                    captureIds: indexedIds,
                    mode: retrievalMode,
                    allowProviderCalls: !modelBudgetExhausted,
                    queries: findings.map(({ finding }) =>
                        sourceComparisonQuery(
                            finding,
                            target.qualification.reportingPeriodEnd,
                        ),
                    ),
                });
                const byId = new Map(
                    result.passages.map((p) => [
                        p.id,
                        `${p.captureId}:p${p.order}`,
                    ]),
                );
                retrieval = {
                    metadata: result.metadata,
                    rankings: result.rankings.map((ids, i) => {
                        const finding = findings[i];
                        if (!finding)
                            throw sourcePreparationError(
                                "retrieval_query_invalid",
                            );
                        return {
                            findingIndex: finding.findingIndex,
                            passageKeys: ids.map((id) => {
                                const key = byId.get(id);
                                if (!key)
                                    throw sourcePreparationError(
                                        "retrieval_passage_invalid",
                                    );
                                return key;
                            }),
                        };
                    }),
                };
                const captureRanks = new Map<string, number>();
                for (const [rank, p] of result.passages.entries())
                    if (!captureRanks.has(p.captureId))
                        captureRanks.set(p.captureId, rank);
                metadata.sort(
                    (a, b) =>
                        (captureRanks.get(a.captureId) ??
                            Number.MAX_SAFE_INTEGER) -
                        (captureRanks.get(b.captureId) ??
                            Number.MAX_SAFE_INTEGER),
                );
            }
            const rankedMetadata = retrieval
                ? metadata
                : rankSourceComparisonPrimaryMetadata(target, metadata);
            const selectedMetadata = rankedMetadata.slice(
                0,
                SOURCE_COMPARISON_MAX_PRIMARY_CAPTURES,
            );
            let supportingBytes = targetBlob.size + indexReadBytes;
            let omittedPrimaryCaptureCount = Math.max(
                rankedMetadata.length - selectedMetadata.length,
                0,
            );
            const metadataByIdentity = new Map(
                input.primaryCandidates.map((candidate) => [
                    `${candidate.source._id}:${candidate.capture._id}:${candidate.capture.contentHash}`,
                    candidate,
                ]),
            );
            const primaryCandidates: SourceComparisonPrimaryCandidate[] = [];
            for (const selected of selectedMetadata) {
                const candidate = metadataByIdentity.get(
                    `${selected.sourceId}:${selected.captureId}:${selected.contentHash}`,
                );
                const declaredBytes = candidate?.capture.byteCount;
                if (
                    !candidate?.capture.storageId ||
                    !declaredBytes ||
                    declaredBytes > 16 * 1024 * 1024 ||
                    supportingBytes + declaredBytes > 32 * 1024 * 1024
                ) {
                    omittedPrimaryCaptureCount += 1;
                    continue;
                }
                const blob = await ctx.storage.get(candidate.capture.storageId);
                if (!blob || blob.size !== declaredBytes) {
                    omittedPrimaryCaptureCount += 1;
                    continue;
                }
                supportingBytes += blob.size;
                const text = await blob.text();
                if (sha256Hex(text) !== candidate.capture.contentHash) {
                    omittedPrimaryCaptureCount += 1;
                    continue;
                }
                const passages = extractPassagesFromNormalizedText({
                    text,
                    canonicalUrl: selected.canonicalUrl,
                    sourceVersionHash: selected.contentHash,
                    ...(retrieval
                        ? { preparationVersion: SOURCE_RETRIEVAL_VERSION }
                        : {}),
                }).map((passage) => ({
                    passageKey: `p${passage.order}`,
                    startOffset: passage.locator.startOffset ?? 0,
                    endOffset: passage.locator.endOffset ?? 0,
                    quotation: passage.exactQuotation,
                    headingPath: passage.headingPath ?? [],
                    order: passage.order,
                    contextBefore: passage.contextBefore,
                    contextAfter: passage.contextAfter,
                }));
                primaryCandidates.push({
                    ...selected,
                    text,
                    passages,
                });
            }
            const prepared = prepareSourceComparisonInput({
                company: {
                    cik: input.company.cik,
                    legalName: input.company.legalName,
                    ticker: input.company.ticker,
                },
                target,
                primaryCandidates,
                ...(retrieval ? { retrieval } : {}),
                omittedPrimaryCaptureCount,
                candidateMetadataLimitReached:
                    input.candidateMetadataLimitReached,
            });
            const currentInput = await ctx.runQuery(
                internal.sourcePreparation.getComparisonInput,
                { ...args, now: Date.now() },
            );
            if (
                currentInput.comparisonBaseContextHash !==
                input.comparisonBaseContextHash
            )
                throw sourcePreparationError("stale_execution");
            comparisonContextHash = currentInput.comparisonContextHash;
            const cached = await ctx.runQuery(
                internal.sourcePreparation.getComparison,
                {
                    ...args,
                    qualificationTaskId: input.qualificationTask._id,
                    inputHash: prepared.inputHash,
                    now: Date.now(),
                },
            );
            if (cached.status === "cached") {
                await ctx.runMutation(
                    internal.sourcePreparation.confirmComparisonContext,
                    {
                        ...args,
                        taskId: cached.taskId,
                        inputHash: prepared.inputHash,
                        comparisonContextHash,
                    },
                );
                return { status: "cached", taskId: cached.taskId };
            }
            if (cached.status === "stale")
                return {
                    status: "unavailable",
                    reasonCode: "cached_comparison_invalid",
                };

            const inputAuthority = await ctx.runQuery(
                internal.sourcePreparation.validateComparisonAuthority,
                {
                    ...args,
                    qualificationTaskId: input.qualificationTask._id,
                    primaryCaptures: prepared.request.primarySources.map(
                        (source) => ({
                            sourceId: source.sourceId as Id<"sources">,
                            captureId: source.captureId as Id<"sourceCaptures">,
                            contentHash: source.contentHash,
                        }),
                    ),
                    now: Date.now(),
                },
            );
            if (!inputAuthority)
                throw sourcePreparationError("stale_execution");

            const hasComparableInput = prepared.request.findings.some(
                (finding) => finding.primaryPassageKeys.length > 0,
            );
            if (!hasComparableInput) {
                const output = makeTerminalOutput(prepared, "not_run");
                const taskId = await persist({
                    ...args,
                    qualificationTaskId: input.qualificationTask._id,
                    inputHash: prepared.inputHash,
                    output,
                });
                return { status: "not_run", taskId };
            }
            if (!isOpenRouterConfigured()) {
                const output = makeTerminalOutput(
                    prepared,
                    "provider_unavailable",
                );
                const taskId = await persist({
                    ...args,
                    qualificationTaskId: input.qualificationTask._id,
                    inputHash: prepared.inputHash,
                    output,
                });
                return {
                    status: "unavailable",
                    taskId,
                    reasonCode: "missing_configuration",
                };
            }
            const preparation = await ctx.runQuery(
                internal.sourcePreparation.getForExecution,
                {
                    preparationId: args.preparationId,
                    now: Date.now(),
                },
            );
            const outcome = await executePreparationModel(ctx, {
                preparation,
                executionDeadlineAt,
                sourceId: input.targetSource._id,
                operation: "source_comparison",
                inputHash: prepared.inputHash,
                invocationInputJson: JSON.stringify(prepared.request),
                validate: async () => {
                    const current = await ctx.runQuery(
                        internal.sourcePreparation.validateComparisonAuthority,
                        {
                            ...args,
                            qualificationTaskId: input.qualificationTask._id,
                            primaryCaptures:
                                prepared.request.primarySources.map(
                                    (source) => ({
                                        sourceId:
                                            source.sourceId as Id<"sources">,
                                        captureId:
                                            source.captureId as Id<"sourceCaptures">,
                                        contentHash: source.contentHash,
                                    }),
                                ),
                            now: Date.now(),
                        },
                    );
                    if (!current)
                        throw sourcePreparationError("stale_execution");
                },
                execute: (route, dependencies) =>
                    compareSourceContributions(prepared, route, dependencies),
            });
            if (!("reasonCode" in outcome)) {
                if (outcome.result.status === "failed")
                    throw sourcePreparationError("comparison_unavailable");
                const taskId = await persist({
                    ...args,
                    qualificationTaskId: input.qualificationTask._id,
                    inputHash: prepared.inputHash,
                    output: outcome.result.output,
                    ...(outcome.result.status === "succeeded"
                        ? {
                              providerCallId: outcome.providerCallId,
                              receipt: outcome.receipt,
                          }
                        : {}),
                });
                return {
                    status:
                        outcome.result.status === "not_run"
                            ? "not_run"
                            : "compared",
                    taskId,
                };
            }
            if (outcome.reasonCode === "cancelled")
                throw sourcePreparationError("stale_execution");
            const taskId = await persist({
                ...args,
                qualificationTaskId: input.qualificationTask._id,
                inputHash: prepared.inputHash,
                output: makeTerminalOutput(
                    prepared,
                    outcome.reasonCode === "invalid_output"
                        ? "invalid_output"
                        : "provider_unavailable",
                ),
                ...(outcome.providerCallId
                    ? { providerCallId: outcome.providerCallId }
                    : {}),
                ...(outcome.receipt ? { receipt: outcome.receipt } : {}),
            });
            return {
                status: "unavailable",
                taskId,
                reasonCode: outcome.reasonCode,
            };
        } catch (error) {
            const reasonCode = preparationFailureCode(error);
            if (!reasonCode) throw error;
            return { status: "unavailable", reasonCode };
        }
    },
});

/** One durable source operation; intermediate captures and receipts remain independently persisted. */
export const prepareSource = internalAction({
    args: sourcePreparationArgsValidator,
    returns: sourcePreparationOutcomeValidator,
    handler: async (
        ctx,
        args,
    ): Promise<Infer<typeof sourcePreparationOutcomeValidator>> => {
        const executionDeadlineAt = nodeActionGenerationDeadline(Date.now());
        const inspection = await inspectSourceDocument(ctx, args);
        if (inspection.status === "unavailable") {
            return {
                sourceId: args.sourceId,
                result: {
                    status: "unavailable",
                    sourceCaptureId: inspection.sourceCaptureId,
                    reasonCode:
                        inspection.reasonCode ?? "inspection_unavailable",
                },
            };
        }
        if (!inspection.sourceCaptureId)
            throw new Error("Inspected source has no capture");
        const qualification = await qualifyCapturedSource(
            ctx,
            {
                preparationId: args.preparationId,
                sourceCaptureId: inspection.sourceCaptureId,
            },
            executionDeadlineAt,
        );
        return {
            sourceId: args.sourceId,
            result: {
                ...qualification,
                sourceCaptureId: inspection.sourceCaptureId,
            },
        };
    },
});
