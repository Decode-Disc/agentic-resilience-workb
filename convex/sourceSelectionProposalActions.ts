"use node";

import { lookup } from "node:dns/promises";
import { providerRetryAfterAt } from "@convex/domain/sourcePreparationAuthority";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { FunctionReturnType } from "convex/server";
import { type Infer, v } from "convex/values";

import { api, internal } from "./_generated/api";
import { type ActionCtx, action } from "./_generated/server";
import { isPaidWorkDisabledError } from "./domain/providerAvailability";
import {
    DiscoveryRequestError,
    discoveryFailure,
    discoveryFamilyValidator,
    type RecoveryTarget,
    recoveryReasonValidator,
    recoveryTargetValidator,
} from "./domain/sourceDiscoveryRecovery";
import { preparationFailureCode } from "./domain/sourcePreparationAuthority";
import {
    SOURCE_FAMILIES as DISCOVERY_FAMILIES,
    SOURCE_SELECTION_POLICY_VERSION,
} from "./domain/sourceSelectionPolicy";
import { validateExaCandidates } from "./exaDiscoveryActions";
import {
    createExaDiscoveryAdapter,
    readExaResponseJson,
} from "./integrations/exa";
import { sourcePreparationEnabled } from "./resourceLimits";
import {
    secFilingCandidate,
    selectSecFilingsForDiscovery,
} from "./sourceDiscoveryActions";

const MAX_ATTEMPTS = 2;
const PROVIDER_TIMEOUT_MS = 10_000;

type SecFiling = {
    accessionNumber: string;
    form?: string;
    filingDate?: string;
    primaryDocument?: string;
};

type RebuildAuthorization = Extract<
    FunctionReturnType<typeof internal.sourceSelectionProposals.claimRebuild>,
    { shouldExecute: true }
>;
type RebuildResult = Infer<typeof discoveryResult>;

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
            throw new DiscoveryRequestError(
                `http_${response.status}`,
                response.status === 408 ||
                    response.status === 429 ||
                    response.status >= 500,
                providerRetryAfterAt(
                    response.headers.get("retry-after"),
                    Date.now(),
                ),
            );
        }
        return await response.json();
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
    requestSignal?: AbortSignal,
) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
        const signal = requestSignal
            ? AbortSignal.any([controller.signal, requestSignal])
            : controller.signal;
        signal.throwIfAborted();
        const response = await fetch("https://api.exa.ai/search", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
            },
            // `false` opts out in the SDK; the HTTP API expects this field omitted.
            body: JSON.stringify({ query, ...options, contents: undefined }),
            signal,
            redirect: "error",
        });
        if (!response.ok) {
            await response.body?.cancel();
            throw new DiscoveryRequestError(
                `http_${response.status}`,
                response.status === 408 ||
                    response.status === 429 ||
                    response.status >= 500,
            );
        }
        const payload: unknown = await readExaResponseJson(response, signal);
        if (!payload || typeof payload !== "object") {
            throw new DiscoveryRequestError("invalid_response", false);
        }
        const record = payload as Record<string, unknown>;
        if (!Array.isArray(record.results)) {
            throw new DiscoveryRequestError("invalid_response", false);
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

const discoveryArgsValidator = v.object({
    runId: v.id("researchRuns"),
    corpusRevisionId: v.id("corpusRevisions"),
    expectedProposalId: v.id("sourceSelectionProposals"),
});
const discoveryArgs = discoveryArgsValidator.fields;
const discoveryResult = v.object({
    proposalId: v.id("sourceSelectionProposals"),
    version: v.number(),
    outcome: v.union(
        v.literal("complete"),
        v.literal("partial"),
        v.literal("blocked"),
    ),
    failedDiscoveryFamilies: v.array(discoveryFamilyValidator),
    reason: v.optional(recoveryReasonValidator),
});
type DiscoveryArgs = Infer<typeof discoveryArgsValidator>;

async function startDiscovery(
    ctx: ActionCtx,
    args: DiscoveryArgs,
    recovery?: { requestId: string; target: RecoveryTarget },
): Promise<RebuildResult> {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) throw new Error("Not authenticated");
    const before = await ctx.runQuery(api.sourceSelectionProposals.getCurrent, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
    });
    if (!before) throw new Error("Source selection proposal unavailable");
    if (before.preparation || (!recovery && sourcePreparationEnabled())) {
        let preparation: FunctionReturnType<
            typeof api.sourcePreparation.startForReview
        >;
        try {
            preparation = await ctx.runMutation(
                api.sourcePreparation.startForReview,
                {
                    ...args,
                    requestId:
                        recovery?.requestId ??
                        `legacy:${args.expectedProposalId}`,
                    ...(recovery ? { target: recovery.target } : {}),
                },
            );
        } catch (error) {
            const code = preparationFailureCode(error);
            if (!code) throw error;
            return {
                proposalId: before.proposalId,
                version: before.version,
                outcome: "blocked",
                failedDiscoveryFamilies: before.failedDiscoveryFamilies,
                reason:
                    code === "search_limit_reached" ||
                    code === "preparation_deadline_elapsed"
                        ? "capacity_reached"
                        : code === "search_cooldown"
                          ? "cooldown"
                          : code === "request_invalid"
                            ? "request_rejected"
                            : "unavailable",
            };
        }
        const current = await ctx.runQuery(
            api.sourceSelectionProposals.getCurrent,
            {
                runId: args.runId,
                corpusRevisionId: args.corpusRevisionId,
            },
        );
        if (!current) throw new Error("Source selection proposal unavailable");
        return {
            proposalId: current.proposalId,
            version: current.version,
            outcome:
                preparation.status === "started"
                    ? "blocked"
                    : preparation.status,
            failedDiscoveryFamilies: current.failedDiscoveryFamilies,
            ...(preparation.status === "started"
                ? { reason: "in_progress" as const }
                : preparation.status === "blocked"
                  ? { reason: "unavailable" as const }
                  : {}),
        };
    }
    const claim = await ctx.runMutation(
        internal.sourceSelectionProposals.claimRebuild,
        { ...args, authUserId, recovery },
    );
    if (!claim.shouldExecute)
        return {
            proposalId: claim.proposalId,
            version: claim.version,
            outcome: claim.outcome,
            failedDiscoveryFamilies: claim.failedDiscoveryFamilies,
            reason: claim.reason,
        };
    return executeDiscovery(ctx, args, claim, recovery?.target);
}

export const rebuild = action({
    args: discoveryArgs,
    returns: discoveryResult,
    handler: (ctx, args): Promise<RebuildResult> => startDiscovery(ctx, args),
});
export const recoverDiscovery = action({
    args: {
        ...discoveryArgs,
        requestId: v.string(),
        target: recoveryTargetValidator,
    },
    returns: discoveryResult,
    handler: (ctx, { requestId, target, ...args }): Promise<RebuildResult> =>
        startDiscovery(ctx, args, { requestId, target }),
});

async function executeDiscovery(
    ctx: ActionCtx,
    args: DiscoveryArgs,
    context: RebuildAuthorization,
    target?: RecoveryTarget,
): Promise<RebuildResult> {
    const operationScope = `run:${args.runId}:generation:${context.executionGeneration}:corpus:${args.corpusRevisionId}:proposal:${args.expectedProposalId}:policy:${SOURCE_SELECTION_POLICY_VERSION}:rebuild:${context.rebuildId}:cycle:${context.cycle}`;
    const succeededFamilies = new Set<DiscoveryFamily>();
    const failedFamilies = new Set<DiscoveryFamily>(
        context.initialFailedFamilies,
    );
    let insertedCount = 0;
    let requestRejected = false;
    const verifyActive = () =>
        ctx.runQuery(internal.sourceSelectionProposals.verifyRebuildActive, {
            rebuildId: context.rebuildId,
            cycle: context.cycle,
            ...args,
            executionGeneration: context.executionGeneration,
        });
    const secUserAgent = process.env.SEC_USER_AGENT?.trim();
    if (context.families.includes("regulatory")) {
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
                        undefined,
                        target?.kind === "coverage" ? target.role : undefined,
                    );
                    const candidates = filings.map((filing, index) =>
                        secFilingCandidate(context.company.cik, filing, index),
                    );
                    const persisted = await ctx.runMutation(
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
                    insertedCount += persisted.inserted;
                    succeededFamilies.add("regulatory");
                    break;
                } catch (error) {
                    const failure = discoveryFailure(error);
                    requestRejected ||= !failure.retryable;
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
                            errorCode: failure.code,
                            retryable: failure.retryable,
                        },
                    );
                    if (attempt === MAX_ATTEMPTS || !failure.retryable) {
                        failedFamilies.add("regulatory");
                        break;
                    }
                }
            }
        }
    }
    const exaKey = process.env.EXA_API_KEY?.trim();
    if (!exaKey) {
        for (const query of context.queries) {
            const family = discoveryFamily(query.discoveryIntent);
            if (family && family !== "regulatory") failedFamilies.add(family);
        }
    } else {
        const exa = createExaDiscoveryAdapter({
            search: (query, options) => fetchExaSearch(exaKey, query, options),
        });
        for (const [index, query] of context.queries.entries()) {
            const family = discoveryFamily(query.discoveryIntent);
            if (!family || family === "regulatory") continue;
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
                            async (hostname) => {
                                await verifyActive();
                                return (
                                    await lookup(hostname, {
                                        all: true,
                                        verbatim: true,
                                    })
                                ).map(({ address }) => address);
                            },
                        ),
                    );
                    const rejected = batch.rejected + validated.rejected;
                    const persisted = await ctx.runMutation(
                        internal.sourceSelectionProposals
                            .persistRebuildCandidates,
                        {
                            rebuildId: context.rebuildId,
                            cycle: context.cycle,
                            ...args,
                            executionGeneration: context.executionGeneration,
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
                    insertedCount += persisted.inserted;
                    succeededFamilies.add(family);
                    if (rejected > 0) {
                        failedFamilies.add(family);
                    }
                    break;
                } catch (error) {
                    const failure = discoveryFailure(error);
                    requestRejected ||= !failure.retryable;
                    await ctx.runMutation(
                        internal.providerCalls.recordAttempt,
                        {
                            runId: args.runId,
                            corpusRevisionId: args.corpusRevisionId,
                            executionGeneration: context.executionGeneration,
                            workflowVersion: 2,
                            stepKey: "source_review",
                            service: "exa",
                            operation: "rebuild_source_proposal_exa",
                            operationKey,
                            status: "failed",
                            attempt,
                            latencyMs: Date.now() - startedAt,
                            errorCode: failure.code,
                            retryable: failure.retryable,
                        },
                    );
                    if (attempt === MAX_ATTEMPTS || !failure.retryable) {
                        failedFamilies.add(family);
                        break;
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
    return ctx.runMutation(internal.sourceSelectionProposals.finishRebuild, {
        rebuildId: context.rebuildId,
        cycle: context.cycle,
        ...args,
        executionGeneration: context.executionGeneration,
        outcome,
        insertedCount,
        blockedReason: requestRejected ? "request_rejected" : "unavailable",
        failedDiscoveryFamilies: orderedFailures,
    });
}
