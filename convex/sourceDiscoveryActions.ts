import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

export const discoverForRun = internalAction({
    args: {
        runId: v.id("researchRuns"),
        cik: v.string(),
        filings: v.array(
            v.object({
                accessionNumber: v.string(),
                form: v.optional(v.string()),
                filingDate: v.optional(v.string()),
                primaryDocument: v.optional(v.string()),
            }),
        ),
    },
    returns: v.object({ total: v.number() }),
    handler: async (ctx, args): Promise<{ total: number }> => {
        const context = await ctx.runQuery(
            internal.researchPlanning.getDiscoveryContext,
            { runId: args.runId },
        );
        const environment =
            typeof process === "undefined" ? undefined : process.env;
        const initialCapacity = await ctx.runQuery(
            internal.sourceDiscovery.getCandidateCapacity,
            {
                runId: args.runId,
                executionGeneration: context.executionGeneration,
            },
        );
        const candidates = args.filings
            .slice(0, Math.min(8, initialCapacity.remaining))
            .map((filing) => {
                const accession = filing.accessionNumber.replaceAll("-", "");
                const baseUrl = `https://www.sec.gov/Archives/edgar/data/${args.cik}/${accession}/`;
                return {
                    canonicalUrl: filing.primaryDocument
                        ? `${baseUrl}${filing.primaryDocument}`
                        : baseUrl,
                    title: `${filing.form ?? "SEC filing"} · ${filing.filingDate ?? filing.accessionNumber}`,
                    origin: "sec" as const,
                    category: "regulatory",
                    publishedAt: filing.filingDate
                        ? Date.parse(filing.filingDate)
                        : undefined,
                    providerReference: filing.accessionNumber,
                };
            });
        const result = await ctx.runMutation(
            internal.sourceDiscovery.persistCandidates,
            {
                runId: args.runId,
                corpusRevisionId: context.corpusRevisionId,
                executionGeneration: context.executionGeneration,
                operationKey: `run:${args.runId}:workflow:2:generation:${context.executionGeneration}:corpus:${context.corpusRevisionId}:step:discover_sources:sec`,
                candidates,
            },
        );
        if (result.total >= initialCapacity.limit) {
            return { total: result.total };
        }
        if (environment?.EXA_API_KEY?.trim()) {
            return ctx.runAction(internal.exaDiscoveryActions.discoverForRun, {
                runId: args.runId,
            });
        }
        await ctx.runMutation(
            internal.providerCalls.recordConfigurationFailure,
            {
                runId: args.runId,
                executionGeneration: context.executionGeneration,
                service: "exa",
                operation: "search",
                operationKey: `run:${args.runId}:generation:${context.executionGeneration}:exa:configuration`,
                errorCode: "exa_not_configured",
            },
        );
        return { total: result.total };
    },
});
