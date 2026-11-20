"use node";

import { lookup } from "node:dns/promises";
import { internal } from "@convex/_generated/api";
import type { ActionCtx } from "@convex/_generated/server";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { preparationFailureCode } from "@convex/domain/sourcePreparationAuthority";
import { discoveryResult } from "@convex/domain/sourcesContracts";
import { executionFailureCode } from "@convex/execution/errors";
import type { operationOutcomeValidator } from "@convex/execution/executionProtocol";
import { operationSuccess } from "@convex/execution/operationResults";
import { exaDiscoveryDisposition } from "@convex/integrations/exa";
import { validateExaCandidates } from "@convex/integrations/exaCandidateValidation";
import { configuredExaHttpDiscovery } from "@convex/integrations/exaSearchClient";
import { sourcesReplayCandidates } from "@convex/qualificationSourceReplay";
import { SOURCE_PUBLIC_ADDRESS_TIMEOUT_MS } from "@convex/resourcePolicy";
import { simulatedSourceCandidate } from "@convex/sourcesSimulation";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { Infer } from "convex/values";

type Reservation = FunctionReturnType<typeof internal.sourcesMission.reserve>;

/** Settles each observed search before adopting candidates for the active need. */
export async function discoverForNeed(
    ctx: ActionCtx,
    args: FunctionArgs<typeof internal.sourcesMission.reserve>,
    { preparation, inputHash, discoveryLimit, discovery }: Reservation,
    input: Extract<Reservation["input"], { kind: "discover_sources_for_need" }>,
    simulation: boolean,
): Promise<Infer<typeof operationOutcomeValidator>> {
    if (!discovery)
        return {
            kind: "unavailable",
            code: "discovery_reservation_unavailable",
        };
    const { query } = discovery;
    const replay = await ctx.runQuery(internal.qualificationSourceReplay.read, {
        runId: preparation.runId,
    });
    const frozen = simulation || replay !== null;
    const searchExa = frozen ? undefined : configuredExaHttpDiscovery();
    if (!frozen && !searchExa)
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
    const capacity = await ctx.runQuery(
        internal.sourcesMission.assertActive,
        args,
    );
    const searchLimit = Math.min(
        discoveryLimit ?? 0,
        capacity?.discoveryLimit ?? 0,
    );
    if (!searchLimit)
        return { kind: "refused", code: "source_candidate_limit" };
    const claimed = frozen
        ? null
        : await ctx.runMutation(internal.providerCalls.recordAttempt, {
              ...attempt,
              status: "started",
          });
    if (claimed && !claimed.shouldExecute)
        return {
            kind: "unavailable",
            code: claimed.errorCode ?? "operation_outcome_unknown",
        };
    const startedAt = Date.now();
    let responseReceived = false;
    try {
        const found = !searchExa
            ? {
                  candidates: replay
                      ? sourcesReplayCandidates(replay)
                      : [simulatedSourceCandidate(preparation.runId)],
                  rejected: 0,
                  costDollars: 0,
                  searchTime: 0,
              }
            : await searchExa(query, searchLimit);
        responseReceived = true;
        if (!frozen)
            await ctx.runMutation(internal.providerCalls.recordAttempt, {
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
            });
        await ctx.runQuery(internal.sourcesMission.assertActive, args);
        const validated = await validateExaCandidates(
            found.candidates.slice(0, searchLimit),
            async (hostname) =>
                frozen
                    ? ["93.184.216.34"]
                    : (
                          await lookup(hostname, {
                              all: true,
                              verbatim: true,
                          })
                      ).map((r) => r.address),
            AbortSignal.timeout(SOURCE_PUBLIC_ADDRESS_TIMEOUT_MS),
        );
        const rejected = found.rejected + validated.rejected;
        const disposition = exaDiscoveryDisposition(
            validated.candidates.length,
            rejected,
        );
        if (disposition === "failed") {
            if (!frozen)
                await ctx.runMutation(internal.providerCalls.recordAttempt, {
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
                });
            return {
                kind: "unavailable",
                code: "invalid_provider_response",
            };
        }
        if (replay)
            await ctx.runQuery(internal.qualificationSourceReplay.read, {
                runId: preparation.runId,
            });
        const persisted = await ctx.runMutation(
            internal.sourceDiscovery.persistCandidates,
            {
                runId: preparation.runId,
                corpusRevisionId: preparation.corpusRevisionId,
                preparationId: preparation._id,
                executionGeneration: preparation.executionGeneration,
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
                query,
                ...persisted,
            },
            {
                progressKeys: [sha256Hex(`search:${input.needId}:${query}`)],
            },
        );
    } catch (error) {
        if (!frozen && !responseReceived)
            await ctx.runMutation(internal.providerCalls.recordAttempt, {
                ...attempt,
                status: "failed",
                latencyMs: Date.now() - startedAt,
                errorCode: "discovery_unavailable",
                retryable: false,
            });
        const code =
            executionFailureCode(error) ?? preparationFailureCode(error);
        if (code) return { kind: "unavailable", code };
        throw error;
    }
}
