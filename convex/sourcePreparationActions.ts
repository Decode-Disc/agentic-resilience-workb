"use node";

import { lookup } from "node:dns/promises";
import {
    PublicSourceUrlError,
    validatePublicSourceUrl,
} from "@convex/domain/publicSourceUrl";
import {
    materializeSourceComparisonOutput,
    prepareSourceComparisonInput,
    rankSourceComparisonPrimaryMetadata,
    SOURCE_COMPARISON_MAX_PRIMARY_CAPTURES,
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
    preparationBudgetOutcome,
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
import { executionFailureCode } from "@convex/execution/errors";
import type { SourceDocumentRetrievalInput } from "@convex/integrations/approvedSourceRetrieval";
import {
    createExaContentsAdapter,
    createExaDiscoveryAdapter,
} from "@convex/integrations/exa";
import { createExaContentsClient } from "@convex/integrations/exaContentsClient";
import { retrieveAndNormalizeExaFiling } from "@convex/integrations/exaEvidence";
import {
    createSecCompanyResolver,
    SecRetryableError,
} from "@convex/integrations/sec";
import { retrieveAndNormalizeSecFiling } from "@convex/integrations/secEvidence";
import {
    compareSourceContributions,
    type QualificationAttemptResult,
    qualifySourceDocument,
    type SourceComparisonAttemptResult,
} from "@convex/integrations/sourceQualification";
import type { SourceQualificationRoute } from "@convex/integrations/sourceQualificationConfig";
import { revisionRoute } from "@convex/modelConfiguration";
import type { FunctionReturnType } from "convex/server";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction } from "./_generated/server";
import { discoveryFailure } from "./domain/sourceDiscoveryRecovery";
import {
    SOURCE_COVERAGE_ROLES,
    SOURCE_ROLE_REQUIREMENTS,
} from "./domain/sourceSelectionPolicy";
import { validateExaCandidates } from "./exaDiscoveryActions";
import { SOURCE_EMBEDDING_PROFILE } from "./integrations/sourceEmbeddings";
import { MAX_APPROVED_SOURCE_BYTES } from "./resourceLimits";
import { requestPinnedPublicSource } from "./sourceActions";
import {
    secFilingCandidate,
    selectSecFilingsForDiscovery,
} from "./sourceDiscoveryActions";
import {
    ensureSourceCaptureIndex,
    retrieveSourcePassages,
} from "./sourceRetrievalActions";
import { fetchExaSearch } from "./sourceSelectionProposalActions";

type PreparationModelReceipt = {
    latencyMs: number;
    reportedCost?: number;
    usage: unknown;
};

/** Owns dispatch admission, pinned routing, bounded technical retry and receipts for both model tasks. */
async function executePreparationModel<
    Result extends QualificationAttemptResult | SourceComparisonAttemptResult,
>(
    ctx: ActionCtx,
    input: {
        preparation: Doc<"sourceSelectionProposalRebuilds">;
        sourceId: Id<"sources">;
        operation: "source_qualification" | "source_comparison";
        inputHash: string;
        invocationInputJson: string;
        validate?: () => Promise<void>;
        execute: (
            route: SourceQualificationRoute,
            signal: AbortSignal,
            beforeDispatch: (requestJson: string) => Promise<void>,
        ) => Promise<Result>;
    },
): Promise<
    | {
          result: Result;
          providerCallId: Id<"providerCalls">;
          receipt: PreparationModelReceipt;
      }
    | {
          reasonCode: string;
          providerCallId?: Id<"providerCalls">;
          receipt?: PreparationModelReceipt;
      }
> {
    const { preparation } = input;
    let providerCallId: Id<"providerCalls"> | undefined;
    let receipt: PreparationModelReceipt | undefined;
    let firstAttempt: number | undefined;
    while (true) {
        const plan = await ctx.runQuery(
            internal.providerCalls.nextPreparationAttemptForInput,
            {
                preparationId: preparation._id,
                sourceId: input.sourceId,
                operation: input.operation,
                inputHash: input.inputHash,
                now: Date.now(),
            },
        );
        if (!plan.attempt)
            return {
                reasonCode: plan.errorCode ?? "preparation_unavailable",
                providerCallId,
                receipt,
            };
        firstAttempt ??= plan.attempt;
        await input.validate?.();
        let configured: Doc<"modelRevisions">;
        try {
            configured = await ctx.runMutation(
                internal.modelConfiguration.forPreparation,
                {
                    preparationId: preparation._id,
                    expectedGeneration: preparation.executionGeneration,
                },
            );
        } catch (error) {
            const code =
                preparationFailureCode(error) ?? executionFailureCode(error);
            if (code === "stale_execution")
                return { reasonCode: code, providerCallId, receipt };
            if (code === "model_unavailable" || code === "model_not_compatible")
                return {
                    reasonCode: "missing_configuration",
                    providerCallId,
                    receipt,
                };
            throw error;
        }
        const route = revisionRoute(configured);
        const attempt = {
            inputHash: input.inputHash,
            runId: preparation.runId,
            corpusRevisionId: preparation.corpusRevisionId,
            sourceId: input.sourceId,
            preparationId: preparation._id,
            executionGeneration: preparation.executionGeneration,
            workflowVersion: preparation.workflowVersion,
            stepKey: "source_preparation",
            service: "model" as const,
            operation: input.operation,
            operationKey: `${preparation.operationKey}:step:${input.operation === "source_comparison" ? "source_comparison" : "source_preparation"}:input:${input.inputHash}:attempt:${plan.attempt}`,
            attempt: plan.attempt,
        };
        const claimed = await ctx.runMutation(
            internal.providerCalls.recordAttempt,
            { ...attempt, status: "started" },
        );
        providerCallId = claimed.providerCallId;
        if (!claimed.shouldExecute)
            return {
                reasonCode: claimed.errorCode ?? "attempt_already_recorded",
                providerCallId,
                receipt,
            };
        const invocationId = await ctx.runMutation(
            internal.execution.invocationLifecycle.beginOneShot,
            {
                providerCallId,
                inputJson: input.invocationInputJson,
            },
        );
        const result = await input.execute(
            route,
            AbortSignal.timeout(
                Math.max(1, (preparation.deadlineAt ?? 0) - Date.now()),
            ),
            async (requestJson) => {
                const retained = await ctx.runMutation(
                    internal.execution.invocationLifecycle.retainRequest,
                    {
                        invocationId,
                        expectedGeneration: preparation.executionGeneration,
                        requestJson,
                    },
                );
                if (retained.kind === "blocked")
                    throw sourcePreparationError(retained.code);
                await ctx.runQuery(
                    internal.execution.invocationLifecycle.authorizeDispatch,
                    {
                        invocationId,
                        expectedGeneration: preparation.executionGeneration,
                    },
                );
            },
        );
        receipt = {
            latencyMs: result.latencyMs,
            reportedCost: result.reportedCost,
            usage: {
                model: result.model,
                resolvedModel: result.resolvedModel,
                provider: result.provider,
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
                reasoningTokens: result.reasoningTokens,
                cachedInputTokens: result.cachedInputTokens,
                inputHash: input.inputHash,
            },
        };
        if (result.status === "not_run") {
            await ctx.runMutation(
                internal.execution.invocationLifecycle.finishOneShot,
                {
                    invocationId,
                    attempt: {
                        ...attempt,
                        ...receipt,
                        status: "failed",
                        errorCode: result.reason,
                        dispatchOutcome: "not_dispatched",
                        retryable: false,
                    },
                    outputJson: JSON.stringify({
                        status: result.status,
                        reason: result.reason,
                        output: result.output,
                    }),
                },
            );
            return { result, providerCallId, receipt };
        }
        await ctx.runMutation(
            internal.execution.invocationLifecycle.finishOneShot,
            {
                invocationId,
                ...(result.observableReplyJson
                    ? { observableReplyJson: result.observableReplyJson }
                    : {}),
                attempt: {
                    ...attempt,
                    ...receipt,
                    status: result.status,
                    dispatchOutcome: result.dispatchOutcome,
                    httpStatus: result.httpStatus,
                    retryAfterAt: result.retryAfterAt,
                    ...(result.status === "failed"
                        ? {
                              errorCode: result.errorCode,
                              retryable: result.retryable,
                              diagnostic: result.outputDiagnostic,
                          }
                        : {}),
                },
                outputJson: JSON.stringify(
                    result.status === "succeeded"
                        ? {
                              status: result.status,
                              result:
                                  "qualification" in result
                                      ? result.qualification
                                      : result.output,
                          }
                        : {
                              status: result.status,
                              errorCode: result.errorCode,
                              diagnostic: result.outputDiagnostic ?? null,
                          },
                ),
            },
        );
        if (result.status === "succeeded")
            return { result, providerCallId, receipt };
        if (
            firstAttempt !== 1 ||
            plan.attempt !== 1 ||
            !result.retryable ||
            preparationBudgetOutcome(result) === "reserved"
        )
            return { reasonCode: result.errorCode, providerCallId, receipt };
    }
}

/** Shares authorization, pinned public transport and aggregate throttling for every preparation SEC request. */
function preparationSecResolver(
    ctx: ActionCtx,
    preparation: Doc<"sourceSelectionProposalRebuilds">,
    attempts: Pick<
        Parameters<typeof createSecCompanyResolver>[0],
        "recordAttempt" | "firstAttempt" | "maxAttempts" | "operationScope"
    >,
) {
    const verifyActive = () =>
        ctx.runQuery(internal.sourcePreparation.getForExecution, {
            preparationId: preparation._id,
            now: Date.now(),
        });
    const remaining = () =>
        Math.max(1, (preparation.deadlineAt ?? 0) - Date.now());
    const userAgent =
        process.env.SEC_USER_AGENT?.trim() ||
        "Evidence Workbench research@evidence-workbench.org";
    return createSecCompanyResolver({
        ...attempts,
        now: Date.now,
        userAgent,
        retryPolicy: "confirmed_response",
        timeoutMs: Math.min(10_000, remaining()),
        reserveRequest: async () => {
            await verifyActive();
            const { retryAfter } = await ctx.runMutation(
                internal.providerCalls.reserveSecRateLimit,
                {},
            );
            if (retryAfter)
                await new Promise((resolve) =>
                    setTimeout(resolve, Math.min(retryAfter, remaining())),
                );
            await verifyActive();
        },
        fetch: async (url, init) => {
            await verifyActive();
            const signal = AbortSignal.any([
                AbortSignal.timeout(Math.min(10_000, remaining())),
                ...(init?.signal ? [init.signal] : []),
            ]);
            signal.throwIfAborted();
            let timer: ReturnType<typeof setTimeout> | undefined;
            let destination: Awaited<
                ReturnType<typeof validatePublicSourceUrl>
            >;
            try {
                destination = await Promise.race([
                    validatePublicSourceUrl(String(url), async (hostname) => {
                        const records = await lookup(hostname, {
                            all: true,
                            verbatim: true,
                        });
                        signal.throwIfAborted();
                        return records.map((record) => record.address);
                    }),
                    new Promise<never>((_, reject) => {
                        timer = setTimeout(
                            () =>
                                reject(
                                    sourcePreparationError(
                                        "source_url_unavailable",
                                    ),
                                ),
                            Math.min(10_000, remaining()),
                        );
                    }),
                ]);
            } finally {
                clearTimeout(timer);
            }
            const address = destination.addresses[0];
            if (!address)
                throw sourcePreparationError("source_url_unavailable");
            await verifyActive();
            signal.throwIfAborted();
            return requestPinnedPublicSource(
                destination.canonicalUrl,
                address,
                {
                    headers: {
                        Accept:
                            new Headers(init?.headers).get("Accept") ??
                            "application/json",
                        "User-Agent": userAgent,
                    },
                    maxBytes: MAX_APPROVED_SOURCE_BYTES,
                    signal,
                    timeoutMs: Math.min(10_000, remaining()),
                },
            );
        },
    });
}

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
        // Node replaces process.env between invocations; the generated env export holds the old object.
        const available = Boolean(process.env.OPENROUTER_API_KEY?.trim());
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
        const apiKey = process.env.EXA_API_KEY?.trim();
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
                        exa: Boolean(apiKey),
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
            const adapter = createExaDiscoveryAdapter({
                search: (query, options) =>
                    fetchExaSearch(apiKey as string, query, options, signal),
            });
            const batch = await adapter.search(
                reservation.query.query,
                4,
                reservation.query.includeDomains,
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
    handler: qualifyCapturedSource,
});

async function qualifyCapturedSource(
    ctx: ActionCtx,
    args: Infer<typeof qualificationArgsValidator>,
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
        if (!process.env.OPENROUTER_API_KEY?.trim())
            return {
                status: "unavailable",
                reasonCode: "missing_configuration",
            };

        const outcome = await executePreparationModel(ctx, {
            preparation,
            sourceId: source._id,
            operation: "source_qualification",
            inputHash: prepared.inputHash,
            invocationInputJson: JSON.stringify(prepared.request),
            execute: (route, signal, beforeDispatch) =>
                qualifySourceDocument(prepared, route, {
                    apiKey: process.env.OPENROUTER_API_KEY ?? "",
                    signal,
                    beforeDispatch,
                }),
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
            if (!process.env.OPENROUTER_API_KEY?.trim()) {
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
                execute: (route, signal, beforeDispatch) =>
                    compareSourceContributions(prepared, route, {
                        apiKey: process.env.OPENROUTER_API_KEY ?? "",
                        signal,
                        beforeDispatch,
                    }),
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

const inspectionResultValidator = v.object({
    status: v.union(
        v.literal("complete"),
        v.literal("partial"),
        v.literal("unavailable"),
    ),
    sourceCaptureId: v.optional(v.id("sourceCaptures")),
    reasonCode: v.optional(v.string()),
});
type InspectionResult = Infer<typeof inspectionResultValidator>;

const sourcePreparationArgsValidator = v.object({
    preparationId: v.id("sourceSelectionProposalRebuilds"),
    sourceId: v.id("sources"),
});

export const inspectSource = internalAction({
    args: sourcePreparationArgsValidator,
    returns: inspectionResultValidator,
    handler: inspectSourceDocument,
});

async function inspectSourceDocument(
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
                  }
                : {
                      status: "unavailable",
                      sourceCaptureId: capture._id,
                      reasonCode:
                          capture.failureCode ?? "inspection_in_progress",
                  };
        }
        if (source.origin !== "sec" && !process.env.EXA_API_KEY?.trim()) {
            throw sourcePreparationError("missing_configuration");
        }
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
                                10_000,
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
        const acquisitionPlan = await ctx.runQuery(
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
        const retrieval =
            source.origin === "sec"
                ? await retrieveAndNormalizeSecFiling(
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
                  )
                : await retrieveAndNormalizeExaFiling(
                      createExaContentsAdapter(
                          createExaContentsClient(
                              process.env.EXA_API_KEY?.trim() ?? "",
                          ),
                          {
                              recordAttempt,
                              operationScope,
                              firstAttempt,
                              maxAttempts,
                              retryPolicy: "confirmed_response",
                              timeoutMs: Math.min(120_000, remainingMs),
                          },
                      ),
                      input,
                  );
        if (boundaryError !== undefined) throw boundaryError;
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
        return { status: readingCompleteness, sourceCaptureId: captureId };
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

/** One durable source operation; intermediate captures and receipts remain independently persisted. */
export const prepareSource = internalAction({
    args: sourcePreparationArgsValidator,
    returns: sourcePreparationOutcomeValidator,
    handler: async (
        ctx,
        args,
    ): Promise<Infer<typeof sourcePreparationOutcomeValidator>> => {
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
        const qualification = await qualifyCapturedSource(ctx, {
            preparationId: args.preparationId,
            sourceCaptureId: inspection.sourceCaptureId,
        });
        return {
            sourceId: args.sourceId,
            result: {
                ...qualification,
                sourceCaptureId: inspection.sourceCaptureId,
            },
        };
    },
});
