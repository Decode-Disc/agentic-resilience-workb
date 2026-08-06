'use node';

import Exa from 'exa-js';
import { lookup } from 'node:dns/promises';
import { v } from 'convex/values';

import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import {
    PublicSourceUrlError,
    validatePublicSourceUrl,
} from './domain/publicSourceUrl';
import { createExaDiscoveryAdapter } from './integrations/exa';

const MAX_EXA_ATTEMPTS = 2;

export async function validateExaCandidates<
    Candidate extends { canonicalUrl: string },
>(
    candidates: ReadonlyArray<Candidate>,
    resolveAddresses: (hostname: string) => Promise<ReadonlyArray<string>>,
): Promise<Array<Candidate>> {
    return Promise.all(
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
}

export const discoverForRun = internalAction({
    args: { runId: v.id('researchRuns') },
    returns: v.object({ total: v.number() }),
    handler: async (ctx, args): Promise<{ total: number }> => {
        const exaKey = process.env.EXA_API_KEY?.trim();
        if (!exaKey) {
            throw new Error('Exa source discovery is not configured');
        }
        const context = await ctx.runQuery(
            internal.researchPlanning.getDiscoveryContext,
            args,
        );
        const exaClient = new Exa(exaKey);
        const exa = createExaDiscoveryAdapter({
            search: (query, options) => exaClient.search(query, options),
        });
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
                        stepKey: 'discover_sources',
                        service: 'exa',
                        operation: 'search',
                        operationKey,
                        status: 'started',
                        attempt,
                    },
                );
                if (!lease.shouldExecute) {
                    if (lease.status === 'succeeded') {
                        break;
                    }
                    if (lease.status === 'started') {
                        throw new Error(
                            'Exa provider attempt is already in progress',
                        );
                    }
                    continue;
                }
                try {
                    const results = await exa.search(
                        planQuery.query,
                        Math.min(4, capacity.remaining),
                    );
                    const capacityBeforeInspection = await ctx.runQuery(
                        internal.sourceDiscovery.getCandidateCapacity,
                        {
                            runId: args.runId,
                            executionGeneration:
                                context.executionGeneration,
                        },
                    );
                    const candidates =
                        capacityBeforeInspection.remaining === 0
                            ? []
                            : await validateExaCandidates(
                                  results
                                      .slice(
                                          0,
                                          capacityBeforeInspection.remaining,
                                      )
                                      .map((candidate) => ({
                                          ...candidate,
                                          origin: 'exa' as const,
                                          category: planQuery.category,
                                      })),
                                  async (hostname) =>
                                      (
                                          await lookup(hostname, {
                                              all: true,
                                              verbatim: true,
                                          })
                                      ).map(({ address }) => address),
                              );
                    await ctx.runMutation(
                        internal.sourceDiscovery.persistCandidates,
                        {
                            runId: args.runId,
                            corpusRevisionId: context.corpusRevisionId,
                            executionGeneration: context.executionGeneration,
                            operationKey,
                            candidates,
                        },
                    );
                    await ctx.runMutation(
                        internal.providerCalls.recordAttempt,
                        {
                            runId: args.runId,
                            corpusRevisionId: context.corpusRevisionId,
                            executionGeneration: context.executionGeneration,
                            workflowVersion: 2,
                            stepKey: 'discover_sources',
                            service: 'exa',
                            operation: 'search',
                            operationKey,
                            status: 'succeeded',
                            attempt,
                            latencyMs: Date.now() - startedAt,
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
                            stepKey: 'discover_sources',
                            service: 'exa',
                            operation: 'search',
                            operationKey,
                            status: 'failed',
                            attempt,
                            latencyMs: Date.now() - startedAt,
                            errorCode: executionIsActive
                                ? error instanceof Error
                                    ? error.name
                                    : 'UnknownProviderError'
                                : 'stale_execution',
                        },
                    );
                    if (!executionIsActive) {
                        throw new Error(
                            'Research execution is no longer active',
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
