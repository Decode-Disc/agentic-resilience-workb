"use node";

import Exa from "exa-js";
import { lookup } from "node:dns/promises";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { paidWorkDisabledErrorData } from "./domain/providerAvailability";
import {
    PublicSourceUrlError,
    validatePublicSourceUrl,
} from "./domain/publicSourceUrl";
import { createExaDiscoveryAdapter } from "./integrations/exa";

const MAX_EXA_ATTEMPTS = 2;
const EXA_DISCOVERY_TIMEOUT_MS = 10_000;

class ExaLogicalTimeoutError extends Error {
    constructor() {
        super("Exa search exceeded its application timeout");
        this.name = "ExaLogicalTimeoutError";
    }
}

async function withLogicalTimeout<T>(
    work: Promise<T>,
    timeoutMs: number,
): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            work,
            new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(
                    () => reject(new ExaLogicalTimeoutError()),
                    timeoutMs,
                );
            }),
        ]);
    } finally {
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }
    }
}

export async function validateExaCandidates<
    Candidate extends { canonicalUrl: string },
>(
    candidates: ReadonlyArray<Candidate>,
    resolveAddresses: (hostname: string) => Promise<ReadonlyArray<string>>,
): Promise<{ candidates: Array<Candidate>; rejected: number }> {
    const results = await Promise.allSettled(
        candidates.map(async (candidate) => {
            const validated = await validatePublicSourceUrl(
                candidate.canonicalUrl,
                resolveAddresses,
            );
            return {
                ...candidate,
                canonicalUrl: validated.canonicalUrl,
            };
        }),
    );
    return {
        candidates: results.flatMap((result) =>
            result.status === "fulfilled" ? [result.value] : [],
        ),
        rejected: results.filter(({ status }) => status === "rejected").length,
    };
}

export const discoverForRun = internalAction({
    args: { runId: v.id("researchRuns") },
    returns: v.object({ total: v.number() }),
    handler: async (ctx, args): Promise<{ total: number }> => {
        const exaKey = process.env.EXA_API_KEY?.trim();
        if (!exaKey) {
            throw new Error("Exa source discovery is not configured");
        }
        const context = await ctx.runQuery(
            internal.researchPlanning.getDiscoveryContext,
            args,
        );
        let exa: ReturnType<typeof createExaDiscoveryAdapter> | undefined;
        for (const [index, planQuery] of context.queries.entries()) {
            const capacity = await ctx.runQuery(
                internal.sourceDiscovery.getCandidateCapacity,
                {
                    runId: args.runId,
                    executionGeneration: context.executionGeneration,
                },
            );
            if (capacity.remaining === 0) {
                return { total: capacity.total };
            }
            const operationKey = `run:${args.runId}:workflow:2:generation:${context.executionGeneration}:corpus:${context.corpusRevisionId}:step:discover_sources:exa:${index}`;
            for (let attempt = 1; attempt <= MAX_EXA_ATTEMPTS; attempt += 1) {
                const startedAt = Date.now();
                const lease = await ctx.runMutation(
                    internal.providerCalls.recordAttempt,
                    {
                        runId: args.runId,
                        corpusRevisionId: context.corpusRevisionId,
                        executionGeneration: context.executionGeneration,
                        workflowVersion: 2,
                        stepKey: "discover_sources",
                        service: "exa",
                        operation: "search",
                        operationKey,
                        status: "started",
                        attempt,
                    },
                );
                if (!lease.shouldExecute) {
                    if (lease.status === "failed") {
                        throw new ConvexError(paidWorkDisabledErrorData());
                    }
                    if (
                        lease.status === "succeeded" ||
                        lease.status === "partial"
                    ) {
                        break;
                    }
                    if (lease.status === "started") {
                        throw new Error(
                            "Exa provider attempt is already in progress",
                        );
                    }
                    continue;
                }
                try {
                    if (!exa) {
                        const exaClient = new Exa(exaKey);
                        exa = createExaDiscoveryAdapter({
                            search: (query, options) =>
                                exaClient.search(query, options),
                        });
                    }
                    const batch = await withLogicalTimeout(
                        exa.search(
                            planQuery.query,
                            Math.min(4, capacity.remaining),
                            planQuery.includeDomains,
                        ),
                        EXA_DISCOVERY_TIMEOUT_MS,
                    );
                    const capacityBeforeInspection = await ctx.runQuery(
                        internal.sourceDiscovery.getCandidateCapacity,
                        {
                            runId: args.runId,
                            executionGeneration: context.executionGeneration,
                        },
                    );
                    const validated =
                        capacityBeforeInspection.remaining === 0
                            ? { candidates: [], rejected: 0 }
                            : await validateExaCandidates(
                                  batch.candidates
                                      .slice(
                                          0,
                                          capacityBeforeInspection.remaining,
                                      )
                                      .map((candidate) => ({
                                          ...candidate,
                                          origin: "exa" as const,
                                          category: planQuery.category,
                                          discoveryQueryIndex: index,
                                      })),
                                  async (hostname) =>
                                      (
                                          await lookup(hostname, {
                                              all: true,
                                              verbatim: true,
                                          })
                                      ).map(({ address }) => address),
                              );
                    const rejected = batch.rejected + validated.rejected;
                    if (validated.candidates.length === 0 && rejected > 0) {
                        await ctx.runMutation(
                            internal.providerCalls.recordAttempt,
                            {
                                runId: args.runId,
                                corpusRevisionId: context.corpusRevisionId,
                                executionGeneration:
                                    context.executionGeneration,
                                workflowVersion: 2,
                                stepKey: "discover_sources",
                                service: "exa",
                                operation: "search",
                                operationKey,
                                status: "failed",
                                attempt,
                                latencyMs: Date.now() - startedAt,
                                usage: {
                                    accepted: 0,
                                    rejected,
                                    searchTime: batch.searchTime,
                                },
                                reportedCost: batch.costDollars,
                                errorCode: "invalid_provider_response",
                            },
                        );
                        break;
                    }
                    await ctx.runMutation(
                        internal.sourceDiscovery.persistCandidates,
                        {
                            runId: args.runId,
                            corpusRevisionId: context.corpusRevisionId,
                            executionGeneration: context.executionGeneration,
                            operationKey,
                            candidates: validated.candidates,
                            providerCompletion: {
                                providerCallId: lease.providerCallId,
                                status: rejected > 0 ? "partial" : "succeeded",
                                latencyMs: Date.now() - startedAt,
                                accepted: validated.candidates.length,
                                rejected,
                                searchTime: batch.searchTime,
                                reportedCost: batch.costDollars,
                            },
                        },
                    );
                    break;
                } catch (error) {
                    const executionIsActive = await ctx.runQuery(
                        internal.sourceDiscovery.isExecutionActive,
                        {
                            runId: args.runId,
                            executionGeneration: context.executionGeneration,
                        },
                    );
                    await ctx.runMutation(
                        internal.providerCalls.recordAttempt,
                        {
                            runId: args.runId,
                            corpusRevisionId: context.corpusRevisionId,
                            executionGeneration: context.executionGeneration,
                            workflowVersion: 2,
                            stepKey: "discover_sources",
                            service: "exa",
                            operation: "search",
                            operationKey,
                            status: "failed",
                            attempt,
                            latencyMs: Date.now() - startedAt,
                            errorCode: executionIsActive
                                ? error instanceof Error
                                    ? error.name
                                    : "UnknownProviderError"
                                : "stale_execution",
                        },
                    );
                    if (!executionIsActive) {
                        throw new Error(
                            "Research execution is no longer active",
                        );
                    }
                    if (error instanceof PublicSourceUrlError) {
                        break;
                    }
                }
            }
        }
        return ctx.runQuery(internal.sourceDiscovery.countCandidates, {
            runId: args.runId,
            executionGeneration: context.executionGeneration,
        });
    },
});
