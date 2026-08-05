import { getAuthUserId } from "@convex-dev/auth/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import Exa from "exa-js";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
    type ActionCtx,
    action,
    internalAction,
    internalMutation,
    internalQuery,
} from "./_generated/server";
import { companySnapshotValidator } from "./domain/validators";
import { createExaWebsiteAdapter } from "./integrations/exa";
import {
    classifyIrAsWebsite,
    createSecCompanyResolver,
} from "./integrations/sec";
import { resolveWebsiteUrl } from "./integrations/websiteResolver";

const secCompanyMatchValidator = companySnapshotValidator;

export type SecCompanyMatch = {
    cik: string;
    legalName: string;
    ticker: string;
    exchange: string;
    investorRelationsUrl?: string;
    websiteUrl?: string;
    websiteUrlSource?: "sec_ir" | "exa" | "probe";
};

export interface SecCompanyResolver {
    search(query: string): Promise<ReadonlyArray<SecCompanyMatch>>;
    revalidate(cik: string): Promise<SecCompanyMatch>;
}

export type CompanyPreflightResult<
    PreflightId extends string = Id<"companyPreflights">,
> = {
    preflightId: PreflightId;
    company: SecCompanyMatch;
    expiresAt: number;
};

type PersistPreflight<PreflightId extends string> = (input: {
    query: string;
    company: SecCompanyMatch;
    expiresAt: number;
    resolverVersion: string;
}) => Promise<CompanyPreflightResult<PreflightId>>;

const PREFLIGHT_TTL_MS = 15 * 60 * 1_000;
const RESOLVER_VERSION = "sec-company-v2";

/**
 * Searches the SEC company index without persisting a selection or reserving
 * analysis capacity.
 */
export async function searchCompaniesWithResolver(
    args: { query: string },
    dependencies: { resolver: SecCompanyResolver },
): Promise<ReadonlyArray<SecCompanyMatch>> {
    const query = args.query.trim();
    if (query.length === 0 || query.length > 160) {
        throw new Error("Company query must contain 1 to 160 characters");
    }
    return dependencies.resolver.search(query);
}

/**
 * Revalidates an explicitly selected CIK and persists an expiring confirmation
 * token without reserving quota or starting durable work.
 *
 * When `resolveWebsite` is provided, the company snapshot is enriched with its
 * marketing `websiteUrl` (and `websiteUrlSource`) before persistence. The dep
 * is optional only for backward-compat with existing tests; the live
 * `preflight` action always wires it.
 */
export async function preflightCompanyWithResolver<PreflightId extends string>(
    args: { cik: string },
    dependencies: {
        resolver: SecCompanyResolver;
        now: () => number;
        persist: PersistPreflight<PreflightId>;
        resolveWebsite?: (company: SecCompanyMatch) => Promise<{
            url: string;
            source: "sec_ir" | "exa" | "probe";
        } | null>;
    },
): Promise<CompanyPreflightResult<PreflightId>> {
    const rawCik = args.cik.trim();
    if (!/^\d{1,10}$/.test(rawCik)) {
        throw new Error("Selected company must have a valid CIK");
    }
    const cik = rawCik.replace(/^0+/, "") || "0";
    const company = await dependencies.resolver.revalidate(cik);
    if (company.cik !== cik) {
        throw new Error("Selected company identity could not be verified");
    }

    const enriched = dependencies.resolveWebsite
        ? await enrichCompanyWithWebsite(company, dependencies.resolveWebsite)
        : company;

    return dependencies.persist({
        query: cik,
        company: enriched,
        expiresAt: dependencies.now() + PREFLIGHT_TTL_MS,
        resolverVersion: RESOLVER_VERSION,
    });
}

/**
 * Augments a SEC-resolved company with its marketing website URL using the
 * injected resolver. Errors from the resolver are swallowed: a transient
 * provider failure must not break preflight (Product Invariant: honest
 * failure beats confident wrongness). The auditor can spot persistent
 * failures via the `providerCalls` records kept by the live wiring.
 */
async function enrichCompanyWithWebsite(
    company: SecCompanyMatch,
    resolve: (
        company: SecCompanyMatch,
    ) => Promise<{ url: string; source: "sec_ir" | "exa" | "probe" } | null>,
): Promise<SecCompanyMatch> {
    try {
        const resolution = await resolve(company);
        if (!resolution) {
            return company;
        }
        return {
            ...company,
            websiteUrl: resolution.url,
            websiteUrlSource: resolution.source,
        };
    } catch {
        return company;
    }
}

type WebsiteBackfillResult = Pick<
    SecCompanyMatch,
    "websiteUrl" | "websiteUrlSource"
>;

/**
 * Resolves website metadata for a legacy run whose company snapshot predates
 * `websiteUrl`. Existing metadata wins without another provider call;
 * otherwise a successful resolution is persisted through the injected
 * boundary. This enriches only company display metadata, never analyst
 * decisions, evidence, or workflow state.
 */
export async function backfillRunCompanyWebsiteWithResolver<
    RunId extends string,
    CompanyId extends string,
>(
    args: {
        runId: RunId;
        companyId: CompanyId;
        company: SecCompanyMatch;
        companySnapshot?: SecCompanyMatch;
    },
    dependencies: {
        resolveWebsite: (company: SecCompanyMatch) => Promise<{
            url: string;
            source: "sec_ir" | "exa" | "probe";
        } | null>;
        persist: (input: {
            runId: RunId;
            companyId: CompanyId;
            websiteUrl: string;
            websiteUrlSource?: "sec_ir" | "exa" | "probe";
        }) => Promise<void>;
    },
): Promise<WebsiteBackfillResult> {
    if (args.companySnapshot?.websiteUrl) {
        return {
            websiteUrl: args.companySnapshot.websiteUrl,
            websiteUrlSource: args.companySnapshot.websiteUrlSource,
        };
    }
    if (args.company.websiteUrl) {
        await dependencies.persist({
            runId: args.runId,
            companyId: args.companyId,
            websiteUrl: args.company.websiteUrl,
            ...(args.company.websiteUrlSource
                ? { websiteUrlSource: args.company.websiteUrlSource }
                : {}),
        });
        return {
            websiteUrl: args.company.websiteUrl,
            websiteUrlSource: args.company.websiteUrlSource,
        };
    }

    const resolution = await dependencies.resolveWebsite(args.company);
    if (!resolution) {
        return {};
    }
    await dependencies.persist({
        runId: args.runId,
        companyId: args.companyId,
        websiteUrl: resolution.url,
        websiteUrlSource: resolution.source,
    });
    return {
        websiteUrl: resolution.url,
        websiteUrlSource: resolution.source,
    };
}

export const persistPreflight = internalMutation({
    args: {
        query: v.string(),
        company: secCompanyMatchValidator,
        expiresAt: v.number(),
        resolverVersion: v.string(),
    },
    returns: v.object({
        preflightId: v.id("companyPreflights"),
        company: secCompanyMatchValidator,
        expiresAt: v.number(),
    }),
    handler: async (ctx, args) => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            throw new Error("Not authenticated");
        }
        const visitor = await ctx.db
            .query("visitors")
            .withIndex("by_auth_user_id", (query) =>
                query.eq("authUserId", authUserId),
            )
            .unique();

        const now = Date.now();
        const existingCompany = await ctx.db
            .query("companies")
            .withIndex("by_cik", (query) => query.eq("cik", args.company.cik))
            .unique();
        const companyId = existingCompany
            ? existingCompany._id
            : await ctx.db.insert("companies", {
                  ...args.company,
                  canonicalizedAt: now,
              });
        if (existingCompany) {
            await ctx.db.patch(existingCompany._id, {
                ...args.company,
                canonicalizedAt: now,
            });
        }

        const preflightId = await ctx.db.insert("companyPreflights", {
            ownerAuthUserId: authUserId,
            ownerVisitorId:
                visitor?.status === "active" ? visitor._id : undefined,
            query: args.query,
            companyId,
            companySnapshot: args.company,
            resolverVersion: args.resolverVersion,
            status: "resolved",
            expiresAt: args.expiresAt,
            createdAt: now,
        });
        return {
            preflightId,
            company: args.company,
            expiresAt: args.expiresAt,
        };
    },
});

function createPublicCompanyResolver(
    ctx: ActionCtx,
    operationScope: string,
): SecCompanyResolver {
    const userAgent = process.env.SEC_USER_AGENT?.trim();
    if (!userAgent) {
        throw new Error("SEC company resolution is not configured");
    }
    return createSecCompanyResolver({
        fetch: globalThis.fetch,
        now: Date.now,
        userAgent,
        reserveRequest: async () => {
            const { retryAfter } = await ctx.runMutation(
                internal.providerCalls.reserveSecRateLimit,
                {},
            );
            if (retryAfter && retryAfter > 0) {
                await new Promise((resolve) => setTimeout(resolve, retryAfter));
            }
        },
        recordAttempt: async (attempt) => {
            const result = await ctx.runMutation(
                internal.providerCalls.recordAttempt,
                {
                    service: "sec",
                    ...attempt,
                },
            );
            return { shouldExecute: result.shouldExecute };
        },
        operationScope,
    });
}

export const search = action({
    args: { query: v.string() },
    returns: v.array(secCompanyMatchValidator),
    handler: async (ctx, args): Promise<Array<SecCompanyMatch>> => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            throw new Error("Not authenticated");
        }
        const results = [
            ...(await searchCompaniesWithResolver(args, {
                resolver: createPublicCompanyResolver(
                    ctx,
                    `search:${authUserId}:${Date.now()}`,
                ),
            })),
        ];
        // Best-effort enrichment: resolve marketing website URLs for the top
        // candidates so the search dropdown can render favicons. Wrapped in a
        // try-catch so a transient Exa failure never breaks the core search
        // flow — candidates without a websiteUrl fall back to the building
        // icon in the UI.
        try {
            const ENRICH_LIMIT = 3;
            for (
                let i = 0;
                i < Math.min(ENRICH_LIMIT, results.length);
                i += 1
            ) {
                const candidate = results[i];
                if (candidate && !candidate.websiteUrl) {
                    const resolution =
                        await resolveWebsiteForCompany(candidate);
                    if (resolution) {
                        results[i] = {
                            ...candidate,
                            websiteUrl: resolution.url,
                            websiteUrlSource: resolution.source,
                        };
                    }
                }
            }
        } catch {
            // Enrichment is best-effort; core search results are still valid.
        }
        return results;
    },
});

export const preflight = action({
    args: { cik: v.string() },
    returns: v.object({
        preflightId: v.id("companyPreflights"),
        company: secCompanyMatchValidator,
        expiresAt: v.number(),
    }),
    handler: async (ctx, args): Promise<CompanyPreflightResult> => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            throw new Error("Not authenticated");
        }
        const resolver = createPublicCompanyResolver(
            ctx,
            `preflight:${authUserId}:${args.cik}:${Date.now()}`,
        );
        return preflightCompanyWithResolver(args, {
            resolver,
            now: Date.now,
            persist: (input) =>
                ctx.runMutation(
                    internal.companyResolution.persistPreflight,
                    input,
                ),
            resolveWebsite: (company) => resolveWebsiteForCompany(company),
        });
    },
});

const websiteBackfillResultValidator = v.object({
    websiteUrl: v.optional(v.string()),
    websiteUrlSource: v.optional(
        v.union(v.literal("sec_ir"), v.literal("exa"), v.literal("probe")),
    ),
});

type RunCompanyForWebsiteBackfill = {
    runId: Id<"researchRuns">;
    companyId: Id<"companies">;
    company: SecCompanyMatch;
    companySnapshot?: SecCompanyMatch;
};

const getRunCompanyForWebsiteBackfillRef = makeFunctionReference<
    "query",
    { runId: Id<"researchRuns">; authUserId: Id<"users"> },
    RunCompanyForWebsiteBackfill
>("companyResolution:getRunCompanyForWebsiteBackfill");

const persistRunCompanyWebsiteRef = makeFunctionReference<
    "mutation",
    {
        runId: Id<"researchRuns">;
        companyId: Id<"companies">;
        websiteUrl: string;
        websiteUrlSource?: "sec_ir" | "exa" | "probe";
    },
    null
>("companyResolution:persistRunCompanyWebsite");

/**
 * Lazily enriches an admitted visitor's legacy run with a marketing website.
 * The UI calls this only when `listMine` projects a company without one. The
 * persistence mutation is idempotent, so reactive renders cannot duplicate
 * updates once a URL exists.
 */
export const ensureRunCompanyWebsite = action({
    args: { runId: v.id("researchRuns") },
    returns: websiteBackfillResultValidator,
    handler: async (ctx, args): Promise<WebsiteBackfillResult> => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            throw new Error("Not authenticated");
        }
        const runCompany: RunCompanyForWebsiteBackfill = await ctx.runQuery(
            getRunCompanyForWebsiteBackfillRef,
            { runId: args.runId, authUserId },
        );
        return backfillRunCompanyWebsiteWithResolver(runCompany, {
            resolveWebsite: resolveWebsiteForCompany,
            persist: async (input): Promise<void> => {
                await ctx.runMutation(persistRunCompanyWebsiteRef, input);
            },
        });
    },
});

export const getRunCompanyForWebsiteBackfill = internalQuery({
    args: {
        runId: v.id("researchRuns"),
        authUserId: v.id("users"),
    },
    returns: v.object({
        runId: v.id("researchRuns"),
        companyId: v.id("companies"),
        company: secCompanyMatchValidator,
        companySnapshot: v.optional(secCompanyMatchValidator),
    }),
    handler: async (ctx, args) => {
        const visitor = await ctx.db
            .query("visitors")
            .withIndex("by_auth_user_id", (query) =>
                query.eq("authUserId", args.authUserId),
            )
            .unique();
        const run = await ctx.db.get(args.runId);
        if (
            visitor?.status !== "active" ||
            run?.ownerVisitorId !== visitor._id
        ) {
            throw new Error("Unauthorized");
        }
        if (!run.companyId) {
            throw new Error("Research run has no confirmed company");
        }
        const company = await ctx.db.get(run.companyId);
        if (!company) {
            throw new Error("Confirmed company was not found");
        }
        return {
            runId: run._id,
            companyId: company._id,
            company: {
                cik: company.cik,
                legalName: company.legalName,
                ticker: company.ticker,
                exchange: company.exchange,
                investorRelationsUrl: company.investorRelationsUrl,
                websiteUrl: company.websiteUrl,
                websiteUrlSource: company.websiteUrlSource,
            },
            companySnapshot: run.companySnapshot,
        };
    },
});

export const persistRunCompanyWebsite = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        companyId: v.id("companies"),
        websiteUrl: v.string(),
        websiteUrlSource: v.optional(
            v.union(v.literal("sec_ir"), v.literal("exa"), v.literal("probe")),
        ),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        const company = await ctx.db.get(args.companyId);
        if (!run || run.companyId !== args.companyId || !company) {
            throw new Error("Research run company metadata is unavailable");
        }

        const snapshot = run.companySnapshot ?? {
            cik: company.cik,
            legalName: company.legalName,
            ticker: company.ticker,
            exchange: company.exchange,
            investorRelationsUrl: company.investorRelationsUrl,
            websiteUrl: company.websiteUrl,
            websiteUrlSource: company.websiteUrlSource,
        };
        if (snapshot.websiteUrl) {
            return null;
        }

        const now = Date.now();
        await ctx.db.patch(company._id, {
            websiteUrl: args.websiteUrl,
            ...(args.websiteUrlSource
                ? { websiteUrlSource: args.websiteUrlSource }
                : {}),
            canonicalizedAt: now,
        });
        await ctx.db.patch(run._id, {
            companySnapshot: {
                ...snapshot,
                websiteUrl: args.websiteUrl,
                ...(args.websiteUrlSource
                    ? { websiteUrlSource: args.websiteUrlSource }
                    : {}),
            },
            updatedAt: now,
        });
        return null;
    },
});

/**
 * Builds the website-resolution closure for a single company using Exa's
 * semantic company search as the primary source. SEC IR classification and
 * HEAD-probe are layered by `resolveWebsiteUrl`. Exa is optional: when no key
 * is configured the resolver returns null gracefully, and the company
 * snapshot keeps its (likely empty) `websiteUrl` from `parseSubmission`.
 */
async function resolveWebsiteForCompany(
    company: SecCompanyMatch,
): Promise<{ url: string; source: "sec_ir" | "exa" | "probe" } | null> {
    const exaKey = process.env.EXA_API_KEY?.trim();
    if (!exaKey) {
        return null;
    }
    const client = new Exa(exaKey);
    const adapter = createExaWebsiteAdapter({
        search: (query, options) => client.search(query, options),
    });
    return resolveWebsiteUrl(
        {
            legalName: company.legalName,
            ticker: company.ticker,
            investorRelationsUrl: company.investorRelationsUrl,
        },
        {
            exaSearch: (query) => adapter.search(query),
            classifyIr: classifyIrAsWebsite,
        },
    );
}

export const getRunCompany = internalQuery({
    args: { runId: v.id("researchRuns") },
    returns: v.object({
        executionGeneration: v.number(),
        company: secCompanyMatchValidator,
    }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (
            !run?.companyId ||
            run.executionStatus !== "running" ||
            !["draft", "checking_public_evidence"].includes(run.lifecycleState)
        ) {
            throw new Error("Research run has no confirmed company");
        }
        const company = await ctx.db.get(run.companyId);
        const snapshot = run.companySnapshot ?? company;
        if (!snapshot) {
            throw new Error("Confirmed company was not found");
        }
        return {
            executionGeneration: run.executionGeneration,
            company: {
                cik: snapshot.cik,
                legalName: snapshot.legalName,
                ticker: snapshot.ticker,
                exchange: snapshot.exchange,
                investorRelationsUrl: snapshot.investorRelationsUrl,
                websiteUrl: snapshot.websiteUrl,
            },
        };
    },
});

export const verifyRevalidation = internalMutation({
    args: {
        runId: v.id("researchRuns"),
        executionGeneration: v.number(),
        resolved: secCompanyMatchValidator,
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (
            !run?.companyId ||
            run.executionGeneration !== args.executionGeneration ||
            run.executionStatus !== "running"
        ) {
            return false;
        }
        const company = await ctx.db.get(run.companyId);
        const snapshot = run.companySnapshot ?? company;
        const matches =
            snapshot?.cik === args.resolved.cik &&
            snapshot.ticker === args.resolved.ticker &&
            snapshot.exchange === args.resolved.exchange;
        if (matches) {
            return true;
        }
        const now = Date.now();
        await ctx.db.patch(run._id, {
            executionStatus: "failed",
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: now,
        });
        await ctx.db.insert("runEvents", {
            runId: run._id,
            sequence: run.nextEventSequence + 1,
            type: "run_failed",
            lifecycleState: run.lifecycleState,
            executionStatus: "failed",
            failureCode: "company_identity_mismatch",
            occurredAt: now,
        });
        return false;
    },
});

export const revalidateRun = internalAction({
    args: { runId: v.id("researchRuns") },
    returns: v.object({
        cik: v.string(),
        secFilingCount: v.number(),
        investorRelationsPresent: v.boolean(),
        filings: v.array(
            v.object({
                accessionNumber: v.string(),
                form: v.optional(v.string()),
                filingDate: v.optional(v.string()),
                primaryDocument: v.optional(v.string()),
            }),
        ),
    }),
    handler: async (
        ctx,
        args,
    ): Promise<{
        cik: string;
        secFilingCount: number;
        investorRelationsPresent: boolean;
        filings: Array<{
            accessionNumber: string;
            form?: string;
            filingDate?: string;
            primaryDocument?: string;
        }>;
    }> => {
        const current = await ctx.runQuery(
            internal.companyResolution.getRunCompany,
            args,
        );
        const userAgent = process.env.SEC_USER_AGENT?.trim();
        if (!userAgent) {
            throw new Error("SEC company resolution is not configured");
        }
        const resolver = createSecCompanyResolver({
            fetch: globalThis.fetch,
            now: Date.now,
            userAgent,
            reserveRequest: async () => {
                const { retryAfter } = await ctx.runMutation(
                    internal.providerCalls.reserveSecRateLimit,
                    {},
                );
                if (retryAfter && retryAfter > 0) {
                    await new Promise((resolve) =>
                        setTimeout(resolve, retryAfter),
                    );
                }
            },
            recordAttempt: async (attempt) => {
                const result = await ctx.runMutation(
                    internal.providerCalls.recordAttempt,
                    {
                        runId: args.runId,
                        executionGeneration: current.executionGeneration,
                        workflowVersion: 2,
                        stepKey: "check_public_evidence",
                        service: "sec",
                        ...attempt,
                    },
                );
                return { shouldExecute: result.shouldExecute };
            },
            operationScope: `run:${args.runId}:workflow:2:generation:${current.executionGeneration}:revalidate`,
        });
        const evidence = await resolver.inspectEvidence(current.company.cik);
        const valid = await ctx.runMutation(
            internal.companyResolution.verifyRevalidation,
            {
                runId: args.runId,
                executionGeneration: current.executionGeneration,
                resolved: evidence.company,
            },
        );
        if (!valid) {
            throw new Error("Confirmed company identity changed");
        }
        return {
            cik: evidence.company.cik,
            secFilingCount: evidence.filingCount,
            investorRelationsPresent: Boolean(
                evidence.company.investorRelationsUrl,
            ),
            filings: [...evidence.filings],
        };
    },
});
