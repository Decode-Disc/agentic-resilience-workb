"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { lookup } from "node:dns/promises";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { SOURCE_SELECTION_POLICY_VERSION } from "./domain/sourceSelectionPolicy";
import { isPaidWorkDisabledError } from "./domain/providerAvailability";
import { validateExaCandidates } from "./exaDiscoveryActions";
import { createExaDiscoveryAdapter } from "./integrations/exa";
import { selectSecFilingsForDiscovery } from "./sourceDiscoveryActions";

const MAX_ATTEMPTS = 2;
const PROVIDER_TIMEOUT_MS = 10_000;

type SecFiling = {
    accessionNumber: string;
    form?: string;
    filingDate?: string;
    primaryDocument?: string;
};

type RebuildAuthorization = {
    rebuildId: Id<"sourceSelectionProposalRebuilds">;
    cycle: number;
    executionGeneration: number;
    company: {
        cik: string;
        legalName: string;
        ticker: string;
        websiteUrl?: string;
        investorRelationsUrl?: string;
    };
    queries: Array<{
        query: string;
        category: string;
        discoveryIntent: string;
        includeDomains?: Array<string>;
        dimensionKeys: Array<string>;
    }>;
    remainingCapacity: number;
};

type RebuildResult = {
    proposalId: Id<"sourceSelectionProposals">;
    version: number;
    outcome: "complete" | "partial" | "blocked";
    failedDiscoveryFamilies: Array<DiscoveryFamily>;
};

const DISCOVERY_FAMILIES = [
    "regulatory",
    "investor_relations",
    "official_product",
    "official_commercial",
    "counter_evidence",
    "official_security",
    "independent_analysis",
] as const;

type DiscoveryFamily = (typeof DISCOVERY_FAMILIES)[number];

function discoveryFamily(value: string): DiscoveryFamily | undefined {
    return DISCOVERY_FAMILIES.find((family) => family === value);
}

function parseSecFilings(
    value: unknown,
    expectedCik: string,
): Array<SecFiling> {
    if (!value || typeof value !== "object") {
        throw new Error("Invalid SEC response");
    }
    const record = value as Record<string, unknown>;
    const responseCik = String(record.cik ?? "").replace(/^0+/, "") || "0";
    const normalizedExpected = expectedCik.replace(/^0+/, "") || "0";
    if (responseCik !== normalizedExpected) {
        throw new Error("SEC company identity changed");
    }
    const recent = (record.filings as { recent?: unknown } | undefined)?.recent;
    if (!recent || typeof recent !== "object") {
        throw new Error("Invalid SEC filing response");
    }
    const fields = recent as Record<string, unknown>;
    const accessions = fields.accessionNumber;
    const forms = fields.form;
    const dates = fields.filingDate;
    const documents = fields.primaryDocument;
    if (!Array.isArray(accessions)) {
        throw new Error("Invalid SEC filing response");
    }
    return accessions.flatMap((accessionNumber, index) =>
        typeof accessionNumber === "string"
            ? [
                  {
                      accessionNumber,
                      form:
                          Array.isArray(forms) &&
                          typeof forms[index] === "string"
                              ? forms[index]
                              : undefined,
                      filingDate:
                          Array.isArray(dates) &&
                          typeof dates[index] === "string"
                              ? dates[index]
                              : undefined,
                      primaryDocument:
                          Array.isArray(documents) &&
                          typeof documents[index] === "string"
                              ? documents[index]
                              : undefined,
                  },
              ]
            : [],
    );
}

async function fetchWithTimeout(
    url: string,
    userAgent: string,
): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            headers: { Accept: "application/json", "User-Agent": userAgent },
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`SEC request failed with ${response.status}`);
        }
        return response.json();
    } finally {
        clearTimeout(timeout);
    }
}

async function withTimeout<T>(work: Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            work,
            new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(
                    () => reject(new Error("Provider request timed out")),
                    PROVIDER_TIMEOUT_MS,
                );
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

export async function fetchExaSearch(
    apiKey: string,
    query: string,
    options: {
        type: "auto";
        numResults: number;
        contents: false;
        includeDomains?: Array<string>;
    },
) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
        const response = await fetch("https://api.exa.ai/search", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
            },
            body: JSON.stringify({ query, ...options }),
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`Exa request failed with ${response.status}`);
        }
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object") {
            throw new Error("Invalid Exa response");
        }
        const record = payload as Record<string, unknown>;
        if (!Array.isArray(record.results)) {
            throw new Error("Invalid Exa response");
        }
        const results = record.results.flatMap((value) => {
            if (!value || typeof value !== "object") return [];
            const result = value as Record<string, unknown>;
            if (
                typeof result.id !== "string" ||
                typeof result.url !== "string"
            ) {
                return [];
            }
            return [
                {
                    id: result.id,
                    url: result.url,
                    title:
                        typeof result.title === "string" ? result.title : null,
                    publishedDate:
                        typeof result.publishedDate === "string"
                            ? result.publishedDate
                            : undefined,
                },
            ];
        });
        const costDollars =
            record.costDollars && typeof record.costDollars === "object"
                ? (record.costDollars as Record<string, unknown>)
                : undefined;
        return {
            results,
            searchTime:
                typeof record.searchTime === "number"
                    ? record.searchTime
                    : undefined,
            costDollars:
                typeof costDollars?.total === "number"
                    ? { total: costDollars.total }
                    : undefined,
        };
    } finally {
        clearTimeout(timeout);
    }
}

export const rebuild = action({
    args: {
        runId: v.id("researchRuns"),
        corpusRevisionId: v.id("corpusRevisions"),
        expectedProposalId: v.id("sourceSelectionProposals"),
    },
    returns: v.object({
        proposalId: v.id("sourceSelectionProposals"),
        version: v.number(),
        outcome: v.union(
            v.literal("complete"),
            v.literal("partial"),
            v.literal("blocked"),
        ),
        failedDiscoveryFamilies: v.array(
            v.union(
                v.literal("regulatory"),
                v.literal("investor_relations"),
                v.literal("official_product"),
                v.literal("official_commercial"),
                v.literal("counter_evidence"),
                v.literal("official_security"),
                v.literal("independent_analysis"),
            ),
        ),
    }),
    handler: async (ctx, args): Promise<RebuildResult> => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            throw new Error("Not authenticated");
        }
        const claim = await ctx.runMutation(
            internal.sourceSelectionProposals.claimRebuild,
            { ...args, authUserId },
        );
        if (!claim.shouldExecute) {
            return {
                proposalId: claim.proposalId,
                version: claim.version,
                outcome: claim.outcome,
                failedDiscoveryFamilies: claim.failedDiscoveryFamilies,
            };
        }
        const context: RebuildAuthorization = claim;

        const operationScope = `run:${args.runId}:generation:${context.executionGeneration}:corpus:${args.corpusRevisionId}:proposal:${args.expectedProposalId}:policy:${SOURCE_SELECTION_POLICY_VERSION}:rebuild:${context.rebuildId}:cycle:${context.cycle}`;
        const succeededFamilies = new Set<DiscoveryFamily>();
        const failedFamilies = new Set<DiscoveryFamily>();
        const verifyActive = () =>
            ctx.runQuery(
                internal.sourceSelectionProposals.verifyRebuildActive,
                {
                    rebuildId: context.rebuildId,
                    cycle: context.cycle,
                    ...args,
                    executionGeneration: context.executionGeneration,
                },
            );
        const secUserAgent = process.env.SEC_USER_AGENT?.trim();
        if (!secUserAgent) {
            failedFamilies.add("regulatory");
        } else if (context.remainingCapacity === 0) {
            succeededFamilies.add("regulatory");
        } else {
            const operationKey = `${operationScope}:sec`;
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
                await verifyActive();
                const startedAt = Date.now();
                const lease = await ctx.runMutation(
                    internal.providerCalls.recordAttempt,
                    {
                        runId: args.runId,
                        corpusRevisionId: args.corpusRevisionId,
                        executionGeneration: context.executionGeneration,
                        workflowVersion: 2,
                        stepKey: "source_review",
                        service: "sec",
                        operation: "rebuild_source_proposal_sec",
                        operationKey,
                        status: "started",
                        attempt,
                    },
                );
                if (!lease.shouldExecute) {
                    if (
                        lease.status === "succeeded" ||
                        lease.status === "partial"
                    ) {
                        succeededFamilies.add("regulatory");
                        break;
                    }
                    if (lease.status === "started") {
                        failedFamilies.add("regulatory");
                        break;
                    }
                    continue;
                }
                try {
                    const { retryAfter } = await ctx.runMutation(
                        internal.providerCalls.reserveSecRateLimit,
                        {},
                    );
                    if (retryAfter && retryAfter > 0) {
                        await new Promise((resolve) =>
                            setTimeout(resolve, retryAfter),
                        );
                    }
                    await verifyActive();
                    const paddedCik = context.company.cik.padStart(10, "0");
                    const response = await fetchWithTimeout(
                        `https://data.sec.gov/submissions/CIK${paddedCik}.json`,
                        secUserAgent,
                    );
                    const filings = selectSecFilingsForDiscovery(
                        parseSecFilings(response, context.company.cik),
                        Math.min(5, context.remainingCapacity),
                    );
                    const candidates = filings.map((filing, index) => {
                        const accession = filing.accessionNumber.replaceAll(
                            "-",
                            "",
                        );
                        const baseUrl = `https://www.sec.gov/Archives/edgar/data/${context.company.cik}/${accession}/`;
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
                            secForm: filing.form,
                            secAccessionNumber: filing.accessionNumber,
                            providerResultPosition: index,
                            discoveryQueryIndex: -1,
                        };
                    });
                    await ctx.runMutation(
                        internal.sourceSelectionProposals
                            .persistRebuildCandidates,
                        {
                            rebuildId: context.rebuildId,
                            cycle: context.cycle,
                            ...args,
                            executionGeneration: context.executionGeneration,
                            operationKey,
                            providerCallId: lease.providerCallId,
                            providerStatus: "succeeded",
                            latencyMs: Date.now() - startedAt,
                            rejected: 0,
                            candidates,
                        },
                    );
                    succeededFamilies.add("regulatory");
                    break;
                } catch (error) {
                    await ctx.runMutation(
                        internal.providerCalls.recordAttempt,
                        {
                            runId: args.runId,
                            corpusRevisionId: args.corpusRevisionId,
                            executionGeneration: context.executionGeneration,
                            workflowVersion: 2,
                            stepKey: "source_review",
                            service: "sec",
                            operation: "rebuild_source_proposal_sec",
                            operationKey,
                            status: "failed",
                            attempt,
                            latencyMs: Date.now() - startedAt,
                            errorCode:
                                error instanceof Error
                                    ? error.name
                                    : "ProviderError",
                        },
                    );
                    if (attempt === MAX_ATTEMPTS) {
                        failedFamilies.add("regulatory");
                    }
                }
            }
        }

        const exaKey = process.env.EXA_API_KEY?.trim();
        if (!exaKey) {
            for (const query of context.queries) {
                const family = discoveryFamily(query.discoveryIntent);
                if (family) failedFamilies.add(family);
            }
        } else {
            const exa = createExaDiscoveryAdapter({
                search: (query, options) =>
                    fetchExaSearch(exaKey, query, options),
            });
            for (const [index, query] of context.queries.entries()) {
                const family = discoveryFamily(query.discoveryIntent);
                if (!family) continue;
                const latest = await verifyActive();
                if (latest.remainingCapacity === 0) break;
                const operationKey = `${operationScope}:exa:${index}`;
                for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
                    await verifyActive();
                    const startedAt = Date.now();
                    const lease = await (async () => {
                        try {
                            return await ctx.runMutation(
                                internal.providerCalls.recordAttempt,
                                {
                                    runId: args.runId,
                                    corpusRevisionId: args.corpusRevisionId,
                                    executionGeneration:
                                        context.executionGeneration,
                                    workflowVersion: 2,
                                    stepKey: "source_review",
                                    service: "exa",
                                    operation: "rebuild_source_proposal_exa",
                                    operationKey,
                                    status: "started",
                                    attempt,
                                },
                            );
                        } catch (error) {
                            if (isPaidWorkDisabledError(error)) {
                                return undefined;
                            }
                            throw error;
                        }
                    })();
                    if (!lease) {
                        failedFamilies.add(family);
                        break;
                    }
                    if (!lease.shouldExecute) {
                        if (lease.status === "failed") {
                            failedFamilies.add(family);
                            break;
                        }
                        if (
                            lease.status === "succeeded" ||
                            lease.status === "partial"
                        ) {
                            succeededFamilies.add(family);
                            if (lease.status === "partial") {
                                failedFamilies.add(family);
                            }
                            break;
                        }
                        if (lease.status === "started") {
                            failedFamilies.add(family);
                            break;
                        }
                        continue;
                    }
                    try {
                        await verifyActive();
                        const batch = await exa.search(
                            query.query,
                            Math.min(4, latest.remainingCapacity),
                            query.includeDomains,
                        );
                        const validated = await withTimeout(
                            validateExaCandidates(
                                batch.candidates,
                                async (hostname) =>
                                    (
                                        await lookup(hostname, {
                                            all: true,
                                            verbatim: true,
                                        })
                                    ).map(({ address }) => address),
                            ),
                        );
                        const rejected = batch.rejected + validated.rejected;
                        await ctx.runMutation(
                            internal.sourceSelectionProposals
                                .persistRebuildCandidates,
                            {
                                rebuildId: context.rebuildId,
                                cycle: context.cycle,
                                ...args,
                                executionGeneration:
                                    context.executionGeneration,
                                operationKey,
                                providerCallId: lease.providerCallId,
                                providerStatus:
                                    rejected > 0 ? "partial" : "succeeded",
                                latencyMs: Date.now() - startedAt,
                                rejected,
                                searchTime: batch.searchTime,
                                reportedCost: batch.costDollars,
                                candidates: validated.candidates.map(
                                    (candidate) => ({
                                        ...candidate,
                                        origin: "exa" as const,
                                        category: query.discoveryIntent,
                                        discoveryQueryIndex: index,
                                    }),
                                ),
                            },
                        );
                        succeededFamilies.add(family);
                        if (rejected > 0) {
                            failedFamilies.add(family);
                        }
                        break;
                    } catch (error) {
                        await ctx.runMutation(
                            internal.providerCalls.recordAttempt,
                            {
                                runId: args.runId,
                                corpusRevisionId: args.corpusRevisionId,
                                executionGeneration:
                                    context.executionGeneration,
                                workflowVersion: 2,
                                stepKey: "source_review",
                                service: "exa",
                                operation: "rebuild_source_proposal_exa",
                                operationKey,
                                status: "failed",
                                attempt,
                                latencyMs: Date.now() - startedAt,
                                errorCode:
                                    error instanceof Error
                                        ? error.name
                                        : "ProviderError",
                            },
                        );
                        if (attempt === MAX_ATTEMPTS) {
                            failedFamilies.add(family);
                        }
                    }
                }
            }
        }

        const orderedFailures = DISCOVERY_FAMILIES.filter((family) =>
            failedFamilies.has(family),
        );
        const outcome =
            succeededFamilies.size === 0
                ? ("blocked" as const)
                : orderedFailures.length > 0
                  ? ("partial" as const)
                  : ("complete" as const);
        return ctx.runMutation(
            internal.sourceSelectionProposals.finishRebuild,
            {
                rebuildId: context.rebuildId,
                cycle: context.cycle,
                ...args,
                executionGeneration: context.executionGeneration,
                outcome,
                failedDiscoveryFamilies: orderedFailures,
            },
        );
    },
});
