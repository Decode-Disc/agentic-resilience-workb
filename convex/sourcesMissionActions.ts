"use node";

import { lookup } from "node:dns/promises";
import { internal } from "@convex/_generated/api";
import { internalAction } from "@convex/_generated/server";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { preparationFailureCode } from "@convex/domain/sourcePreparationAuthority";
import { SOURCES_RESOURCE_LIMIT_CODES } from "@convex/domain/sources";
import {
    consultableSourceResult,
    discoveryResult,
    documentarySubmissionResult,
} from "@convex/domain/sourcesContracts";
import { documentaryQuotationMatches } from "@convex/domain/sourceUsage";
import {
    executionFailureCode,
    executionFailureValidation,
} from "@convex/execution/errors";
import { operationOutcomeValidator } from "@convex/execution/executionProtocol";
import { operationSuccess } from "@convex/execution/operationResults";
import { examineDocumentaryContributions } from "@convex/integrations/documentaryControl";
import {
    createExaDiscoveryAdapter,
    exaDiscoveryDisposition,
} from "@convex/integrations/exa";
import {
    simulatedDocumentaryControl,
    simulatedSourceCandidate,
} from "@convex/sourcesSimulation";
import { type Infer, v } from "convex/values";
import { validateExaCandidates } from "./exaDiscoveryActions";
import { executePreparationModel } from "./sourcePreparationActions";
import { ensureSourceCaptureIndex } from "./sourceRetrievalActions";
import { fetchExaSearch } from "./sourceSelectionProposalActions";

/** A canonical durable operation reuses acquisition, discovery, model receipts and indexing owners. */
export const execute = internalAction({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: operationOutcomeValidator,
    handler: async (
        ctx,
        args,
    ): Promise<Infer<typeof operationOutcomeValidator>> => {
        try {
            const {
                preparation,
                input,
                contributions,
                inputHash,
                sourceId,
                needContext,
                discoveryLimit,
            } = await ctx.runMutation(internal.sourcesMission.reserve, args);
            const active = async () => {
                return ctx.runQuery(internal.sourcesMission.assertActive, args);
            };
            const simulation = await ctx.runQuery(
                internal.sourcesSimulation.enabled,
                { runId: preparation.runId },
            );
            if (input.kind === "make_source_consultable") {
                if (!sourceId)
                    return {
                        kind: "refused",
                        code: "acquisition_target_invalid",
                    };
                const result = await ctx.runAction(
                    internal.sourcePreparationActions.inspectSource,
                    { preparationId: preparation._id, sourceId },
                );
                if (!result.sourceCaptureId || result.status === "unavailable")
                    return {
                        kind: "unavailable",
                        code: result.reasonCode ?? "capture_unavailable",
                    };
                if (!result.contentHash)
                    return {
                        kind: "unavailable",
                        code: "capture_artifact_missing",
                    };
                await active();
                await ctx.runMutation(internal.sourcesMission.retainCapture, {
                    ...args,
                    captureId: result.sourceCaptureId,
                });
                await ensureSourceCaptureIndex(ctx, {
                    preparationId: preparation._id,
                    captureId: result.sourceCaptureId,
                    mode: "lexical",
                });
                return {
                    ...operationSuccess(
                        consultableSourceResult,
                        {
                            sourceId,
                            captureId: result.sourceCaptureId,
                            status: result.status,
                            contentHash: result.contentHash,
                        },
                        {
                            progressKeys: [
                                sha256Hex(`capture:${result.sourceCaptureId}`),
                            ],
                        },
                    ),
                };
            }
            if (input.kind === "discover_sources_for_need") {
                if (!simulation && !process.env.EXA_API_KEY?.trim())
                    return {
                        kind: "unavailable",
                        code: "missing_configuration",
                    };
                const attempt = {
                    runId: preparation.runId,
                    corpusRevisionId: preparation.corpusRevisionId,
                    preparationId: preparation._id,
                    executionGeneration: preparation.executionGeneration,
                    workflowVersion: preparation.workflowVersion,
                    stepKey: "source_preparation",
                    service: "exa" as const,
                    operation: "source_need_search",
                    operationKey: `sources:${args.requestId}:search`,
                    inputHash,
                    attempt: 1,
                };
                const capacity = await active();
                const searchLimit = Math.min(
                    discoveryLimit ?? 0,
                    capacity?.discoveryLimit ?? 0,
                );
                if (!searchLimit)
                    return { kind: "refused", code: "source_candidate_limit" };
                const claimed = simulation
                    ? null
                    : await ctx.runMutation(
                          internal.providerCalls.recordAttempt,
                          { ...attempt, status: "started" },
                      );
                if (claimed && !claimed.shouldExecute)
                    return {
                        kind: "unavailable",
                        code: claimed.errorCode ?? "operation_outcome_unknown",
                    };
                const startedAt = Date.now();
                let responseReceived = false;
                try {
                    const adapter = createExaDiscoveryAdapter({
                        search: (query, options) =>
                            fetchExaSearch(
                                process.env.EXA_API_KEY ?? "",
                                query,
                                options,
                            ),
                    });
                    const found = simulation
                        ? {
                              candidates: [
                                  simulatedSourceCandidate(preparation.runId),
                              ],
                              rejected: 0,
                              costDollars: 0,
                              searchTime: 0,
                          }
                        : await adapter.search(input.query, searchLimit);
                    responseReceived = true;
                    if (!simulation)
                        await ctx.runMutation(
                            internal.providerCalls.recordAttempt,
                            {
                                ...attempt,
                                status: "succeeded",
                                latencyMs: Date.now() - startedAt,
                                reportedCost: found.costDollars,
                                dispatchOutcome: "response_received",
                                usage: {
                                    searchTime: found.searchTime,
                                    accepted: 0,
                                    rejected: found.rejected,
                                    returned: found.candidates.length,
                                    validationComplete: false,
                                },
                            },
                        );
                    await active();
                    const validated = await validateExaCandidates(
                        found.candidates.slice(0, searchLimit),
                        async (hostname) =>
                            simulation
                                ? ["93.184.216.34"]
                                : (
                                      await lookup(hostname, {
                                          all: true,
                                          verbatim: true,
                                      })
                                  ).map((r) => r.address),
                        AbortSignal.timeout(20_000),
                    );
                    const rejected = found.rejected + validated.rejected;
                    const disposition = exaDiscoveryDisposition(
                        validated.candidates.length,
                        rejected,
                    );
                    if (disposition === "failed") {
                        if (!simulation)
                            await ctx.runMutation(
                                internal.providerCalls.recordAttempt,
                                {
                                    ...attempt,
                                    status: "failed",
                                    errorCode: "invalid_provider_response",
                                    retryable: false,
                                    latencyMs: Date.now() - startedAt,
                                    reportedCost: found.costDollars,
                                    dispatchOutcome: "response_received",
                                    usage: {
                                        accepted: 0,
                                        rejected,
                                        searchTime: found.searchTime,
                                        validationComplete: true,
                                    },
                                },
                            );
                        return {
                            kind: "unavailable",
                            code: "invalid_provider_response",
                        };
                    }
                    const persisted = await ctx.runMutation(
                        internal.sourceDiscovery.persistCandidates,
                        {
                            runId: preparation.runId,
                            corpusRevisionId: preparation.corpusRevisionId,
                            preparationId: preparation._id,
                            executionGeneration:
                                preparation.executionGeneration,
                            operationKey: attempt.operationKey,
                            candidates: validated.candidates.map((c) => ({
                                ...c,
                                origin: "exa" as const,
                                category: "research_lead",
                            })),
                            providerCompletion: claimed
                                ? {
                                      providerCallId: claimed.providerCallId,
                                      status: disposition,
                                      latencyMs: Date.now() - startedAt,
                                      accepted: validated.candidates.length,
                                      rejected,
                                      searchTime: found.searchTime,
                                      reportedCost: found.costDollars,
                                  }
                                : undefined,
                        },
                    );
                    return operationSuccess(
                        discoveryResult,
                        {
                            needId: input.needId,
                            query: input.query,
                            ...persisted,
                        },
                        {
                            progressKeys: [
                                sha256Hex(
                                    `search:${input.needId}:${input.query}`,
                                ),
                            ],
                        },
                    );
                } catch (error) {
                    if (!simulation && !responseReceived)
                        await ctx.runMutation(
                            internal.providerCalls.recordAttempt,
                            {
                                ...attempt,
                                status: "failed",
                                latencyMs: Date.now() - startedAt,
                                errorCode: "discovery_unavailable",
                                retryable: false,
                            },
                        );
                    const code =
                        executionFailureCode(error) ??
                        preparationFailureCode(error);
                    if (code) return { kind: "unavailable", code };
                    throw error;
                }
            }
            if (!sourceId) return { kind: "refused", code: "source_not_owned" };
            const cached = await ctx.runQuery(
                internal.sourcesMission.cachedControl,
                { ...args, inputHash },
            );
            if (
                cached?.output.kind === "documentary_control" &&
                cached.providerCallId
            ) {
                const result = await ctx.runMutation(
                    internal.sourcesMission.retainControl,
                    {
                        ...args,
                        inputHash,
                        contributions,
                        control: cached.output.control,
                        providerCallId: cached.providerCallId,
                    },
                );
                return operationSuccess(documentarySubmissionResult, result, {
                    progressKeys: [sha256Hex(`control:${inputHash}`)],
                });
            }
            if (!simulation && !process.env.OPENROUTER_API_KEY?.trim())
                return { kind: "unavailable", code: "missing_configuration" };
            const evidence = [];
            const grouped = new Map<
                import("@convex/_generated/dataModel").Id<"sourceCaptures">,
                Map<number, (typeof contributions)[number]["evidence"][number]>
            >();
            for (const reference of contributions.flatMap((c) => c.evidence)) {
                const passages = grouped.get(reference.captureId) ?? new Map();
                passages.set(reference.passageOrder, reference);
                grouped.set(reference.captureId, passages);
            }
            for (const [captureId, references] of grouped) {
                const capture = await ctx.runQuery(
                    internal.sourceRetrieval.captureIdentityForPreparation,
                    {
                        preparationId: preparation._id,
                        captureId,
                    },
                );
                const batch = await ctx.runAction(
                    internal.sourceRetrievalActions
                        .readApprovedMaterialForMission,
                    {
                        runId: preparation.runId,
                        expectedGeneration: args.expectedGeneration,
                        sourceId: capture.sourceId,
                        request: {
                            kind: "contexts",
                            passageOrders: [...references.keys()],
                        },
                    },
                );
                if (batch.status !== "ready" || batch.kind !== "contexts")
                    return {
                        kind: "unavailable",
                        code:
                            batch.status === "unavailable"
                                ? batch.reason
                                : "documentary_quote_invalid",
                    };
                for (const reference of references.values()) {
                    const reading = batch.contexts.find(
                        (r) => r.passage.order === reference.passageOrder,
                    );
                    if (
                        reading?.captureId !== reference.captureId ||
                        !documentaryQuotationMatches(
                            {
                                ...reading.passage,
                                contentHash: reading.contentHash,
                            },
                            capture.contentHash,
                            reference.quotation,
                        )
                    )
                        return {
                            kind: "unavailable",
                            code: "documentary_quote_invalid",
                        };
                    evidence.push(reading);
                    if (
                        new TextEncoder().encode(
                            JSON.stringify({
                                contributions,
                                evidence,
                                needs: needContext,
                            }),
                        ).length >
                        128 * 1024
                    )
                        return {
                            kind: "unavailable",
                            code: "model_input_capacity",
                        };
                }
            }
            const examination = { contributions, evidence, needs: needContext };
            const outcome = simulation
                ? {
                      result: {
                          status: "succeeded" as const,
                          output: simulatedDocumentaryControl(contributions),
                      },
                      providerCallId: undefined,
                  }
                : await executePreparationModel<
                      import("@convex/integrations/documentaryControl").DocumentaryControlAttempt
                  >(ctx, {
                      preparation,
                      sourceId,
                      operation: "source_documentary_control",
                      inputHash,
                      invocationInputJson: JSON.stringify(examination),
                      validate: async () => {
                          await active();
                      },
                      execute: (route, dependencies) =>
                          examineDocumentaryContributions(examination, route, {
                              apiKey: process.env.OPENROUTER_API_KEY ?? "",
                              ...dependencies,
                          }),
                  });
            if ("reasonCode" in outcome)
                return {
                    kind: "unavailable",
                    code:
                        outcome.reasonCode === "invalid_output"
                            ? "documentary_control_unfinished"
                            : outcome.reasonCode,
                    ...(outcome.reasonCode === "invalid_output" ||
                    outcome.diagnosticReason
                        ? {
                              validation: {
                                  path: "documentaryControl",
                                  expected: `A complete documentary examination matching the submitted contribution identities (${outcome.diagnosticReason ?? "invalid_output"}).`,
                              },
                          }
                        : {}),
                };
            if (outcome.result.status !== "succeeded")
                return {
                    kind: "unavailable",
                    code: "documentary_control_unfinished",
                };
            const result = await ctx.runMutation(
                internal.sourcesMission.retainControl,
                {
                    ...args,
                    inputHash,
                    contributions,
                    control: outcome.result.output,
                    providerCallId: outcome.providerCallId,
                },
            );
            return operationSuccess(documentarySubmissionResult, result, {
                progressKeys: [sha256Hex(`control:${inputHash}`)],
            });
        } catch (error) {
            const code =
                executionFailureCode(error) ?? preparationFailureCode(error);
            if (!code) throw error;
            if (
                code === "source_candidate_limit" ||
                Object.values(SOURCES_RESOURCE_LIMIT_CODES).some(
                    (limitCode) => limitCode === code,
                )
            )
                return { kind: "refused", code };
            const validation = executionFailureValidation(error);
            return {
                kind: "unavailable",
                code,
                ...(validation ? { validation } : {}),
            };
        }
    },
});
