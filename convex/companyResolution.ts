import { patchQualificationReceipt } from "@convex/qualificationUsage";
import { getAuthUserId } from "@convex-dev/auth/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
    type ActionCtx,
    action,
    internalAction,
    internalMutation,
    internalQuery,
} from "./_generated/server";
import {
    mergeRunCompanyMetadata,
    requireCompanyWebsiteUrl,
} from "./domain/companyMetadata";
import { companySnapshotValidator } from "./domain/validators";
import { configuredExaWebsiteSearch } from "./integrations/exaSdkSearch";
import {
    classifyIrAsWebsite,
    createSecCompanyResolver,
} from "./integrations/sec";
import { resolveWebsiteUrl } from "./integrations/websiteResolver";
import {
    COMPANY_PREFLIGHT_TTL_MS as PREFLIGHT_TTL_MS,
    COMPANY_WEBSITE_CACHE_TTL_MS as WEBSITE_CACHE_TTL_MS,
    COMPANY_WEBSITE_TIMEOUT_MS as WEBSITE_TIMEOUT_MS,
} from "./resourcePolicy";

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

const RESOLVER_VERSION = "sec-company-v2";
const WEBSITE_RESOLVER_VERSION = "exa-company-website-v1";

class WebsiteResolutionTimeoutError extends Error {
    constructor() {
        super("Exa website resolution exceeded its application timeout");
        this.name = "WebsiteResolutionTimeoutError";
    }
}

export async function withWebsiteTimeout<T>(
    work: Promise<T>,
    timeoutMs = WEBSITE_TIMEOUT_MS,
): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            work,
            new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(
                    () => reject(new WebsiteResolutionTimeoutError()),
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

/** Revalidates the selected CIK and persists an expiring confirmation without reserving quota. Website enrichment is best-effort and cannot change the SEC identity. */
export async function preflightCompanyWithResolver<PreflightId extends string>(
    args: { cik: string },
    dependencies: {
        resolver: SecCompanyResolver;
        now: () => number;
        persist: PersistPreflight<PreflightId>;
        resolveWebsite: (company: SecCompanyMatch) => Promise<{
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

    const enriched = await enrichCompanyWithWebsite(
        company,
        dependencies.resolveWebsite,
    );

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
    const company = mergeRunCompanyMetadata(args.companySnapshot, args.company);
    if (company?.websiteUrl) {
        if (
            args.companySnapshot?.websiteUrl !== company.websiteUrl ||
            args.companySnapshot?.websiteUrlSource !== company.websiteUrlSource
        ) {
            await dependencies.persist({
                runId: args.runId,
                companyId: args.companyId,
                websiteUrl: company.websiteUrl,
                ...(company.websiteUrlSource
                    ? { websiteUrlSource: company.websiteUrlSource }
                    : {}),
            });
        }
        return {
            websiteUrl: company.websiteUrl,
            websiteUrlSource: company.websiteUrlSource,
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
        const websiteUrl =
            args.company.websiteUrl ?? existingCompany?.websiteUrl;
        if (websiteUrl !== undefined) requireCompanyWebsiteUrl(websiteUrl);
        const websiteUrlSource =
            args.company.websiteUrlSource ?? existingCompany?.websiteUrlSource;
        const websiteResolvedAt =
            existingCompany && websiteUrl === existingCompany.websiteUrl
                ? existingCompany.websiteResolvedAt
                : websiteUrl
                  ? now
                  : undefined;
        const persistedCompany: SecCompanyMatch = {
            ...args.company,
            websiteUrl,
            websiteUrlSource,
        };
        const companyId = existingCompany
            ? existingCompany._id
            : await ctx.db.insert("companies", {
                  ...persistedCompany,
                  websiteResolvedAt: websiteUrl ? now : undefined,
                  canonicalizedAt: now,
              });
        if (existingCompany) {
            await ctx.db.patch(existingCompany._id, {
                ...persistedCompany,
                websiteResolvedAt,
                canonicalizedAt: now,
            });
        }

        const preflightId = await ctx.db.insert("companyPreflights", {
            ownerAuthUserId: authUserId,
            ownerVisitorId:
                visitor?.status === "active" ? visitor._id : undefined,
            query: args.query,
            companyId,
            companySnapshot: persistedCompany,
            resolverVersion: args.resolverVersion,
            status: "resolved",
            expiresAt: args.expiresAt,
            createdAt: now,
        });
        return {
            preflightId,
            company: persistedCompany,
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
        if (!(await ctx.runQuery(internal.runWorkspace.authorizeProvider, {})))
            throw new Error("paid_work_disabled");
        const results = [
            ...(await searchCompaniesWithResolver(args, {
                resolver: createPublicCompanyResolver(
                    ctx,
                    `search:${authUserId}:${Date.now()}`,
                ),
            })),
        ];
        // Best-effort cache-only enrichment during search/typeahead: reuse any
        // website already persisted on the `companies` record (or SEC IR root)
        // without consuming the user's Exa website quota on intermediate
        // search keystrokes. External Exa resolution runs on `preflight`.
        try {
            const uncachedCiks = results
                .filter((candidate) => !candidate.websiteUrl)
                .map((candidate) => candidate.cik);
            if (uncachedCiks.length > 0) {
                const cachedEntries = await ctx.runQuery(
                    internal.companyResolution.getWebsiteCachesByCiks,
                    { ciks: uncachedCiks },
                );
                const cacheByCik = new Map(
                    cachedEntries.map((entry) => [entry.cik, entry]),
                );
                for (let i = 0; i < results.length; i += 1) {
                    const candidate = results[i];
                    if (!candidate || candidate.websiteUrl) continue;
                    const cached = cacheByCik.get(candidate.cik);
                    if (cached) {
                        results[i] = {
                            ...candidate,
                            websiteUrl: cached.websiteUrl,
                            ...(cached.websiteUrlSource
                                ? { websiteUrlSource: cached.websiteUrlSource }
                                : {}),
                        };
                        continue;
                    }
                    const secWebsite = classifyIrAsWebsite(
                        candidate.investorRelationsUrl,
                    );
                    if (secWebsite) {
                        results[i] = {
                            ...candidate,
                            websiteUrl: secWebsite,
                            websiteUrlSource: "sec_ir",
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
        if (!(await ctx.runQuery(internal.runWorkspace.authorizeProvider, {})))
            throw new Error("paid_work_disabled");
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
            resolveWebsite: (company) =>
                resolveWebsiteForCompany(ctx, authUserId, company),
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
        if (
            !(await ctx.runQuery(internal.runWorkspace.authorizeProvider, {
                runId: args.runId,
            }))
        )
            throw new Error("paid_work_disabled");
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            throw new Error("Not authenticated");
        }
        const runCompany: RunCompanyForWebsiteBackfill = await ctx.runQuery(
            getRunCompanyForWebsiteBackfillRef,
            { runId: args.runId, authUserId },
        );
        return backfillRunCompanyWebsiteWithResolver(runCompany, {
            resolveWebsite: (company) =>
                resolveWebsiteForCompany(ctx, authUserId, company),
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
        requireCompanyWebsiteUrl(args.websiteUrl);

        const snapshot = run.companySnapshot ?? {
            cik: company.cik,
            legalName: company.legalName,
            ticker: company.ticker,
            exchange: company.exchange,
            investorRelationsUrl: company.investorRelationsUrl,
            websiteUrl: company.websiteUrl,
            websiteUrlSource: company.websiteUrlSource,
        };
        mergeRunCompanyMetadata(run.companySnapshot, {
            ...company,
            websiteUrl: args.websiteUrl,
        });
        if (
            company.websiteUrl === args.websiteUrl &&
            (!args.websiteUrlSource ||
                company.websiteUrlSource === args.websiteUrlSource) &&
            snapshot.websiteUrl === args.websiteUrl &&
            (!args.websiteUrlSource ||
                snapshot.websiteUrlSource === args.websiteUrlSource)
        ) {
            return null;
        }

        const now = Date.now();
        const companyWebsiteUrlSource =
            args.websiteUrlSource ??
            (company.websiteUrl === args.websiteUrl
                ? company.websiteUrlSource
                : undefined);
        const snapshotWebsiteUrlSource =
            args.websiteUrlSource ??
            (snapshot.websiteUrl === args.websiteUrl
                ? snapshot.websiteUrlSource
                : undefined);
        const websiteResolvedAt =
            company.websiteUrl === args.websiteUrl &&
            company.websiteResolvedAt !== undefined
                ? company.websiteResolvedAt
                : now;
        const nextSnapshot = {
            ...snapshot,
            websiteUrl: args.websiteUrl,
            websiteUrlSource: snapshotWebsiteUrlSource,
        };
        await ctx.db.patch(company._id, {
            websiteUrl: args.websiteUrl,
            websiteUrlSource: companyWebsiteUrlSource,
            websiteResolvedAt,
            canonicalizedAt: now,
        });
        await ctx.db.patch(run._id, {
            companySnapshot: nextSnapshot,
            updatedAt: now,
        });
        return null;
    },
});

const cachedWebsiteEntryValidator = v.object({
    websiteUrl: v.string(),
    websiteUrlSource: v.optional(
        v.union(v.literal("sec_ir"), v.literal("exa"), v.literal("probe")),
    ),
    websiteResolvedAt: v.optional(v.number()),
});

const cachedWebsiteValidator = v.union(cachedWebsiteEntryValidator, v.null());

export const getWebsiteCacheByCik = internalQuery({
    args: { cik: v.string() },
    returns: cachedWebsiteValidator,
    handler: async (ctx, args) => {
        const company = await ctx.db
            .query("companies")
            .withIndex("by_cik", (query) => query.eq("cik", args.cik))
            .unique();
        if (!company?.websiteUrl) {
            return null;
        }
        return {
            websiteUrl: company.websiteUrl,
            websiteUrlSource: company.websiteUrlSource,
            websiteResolvedAt: company.websiteResolvedAt,
        };
    },
});

export const getWebsiteCachesByCiks = internalQuery({
    args: { ciks: v.array(v.string()) },
    returns: v.array(
        v.object({
            cik: v.string(),
            websiteUrl: v.string(),
            websiteUrlSource: v.optional(
                v.union(
                    v.literal("sec_ir"),
                    v.literal("exa"),
                    v.literal("probe"),
                ),
            ),
            websiteResolvedAt: v.optional(v.number()),
        }),
    ),
    handler: async (ctx, args) => {
        const uniqueCiks = [...new Set(args.ciks)];
        const entries = await Promise.all(
            uniqueCiks.map((cik) =>
                ctx.db
                    .query("companies")
                    .withIndex("by_cik", (query) => query.eq("cik", cik))
                    .unique(),
            ),
        );
        return entries.flatMap((company) =>
            company?.websiteUrl
                ? [
                      {
                          cik: company.cik,
                          websiteUrl: company.websiteUrl,
                          websiteUrlSource: company.websiteUrlSource,
                          websiteResolvedAt: company.websiteResolvedAt,
                      },
                  ]
                : [],
        );
    },
});

export const persistWebsiteResolution = internalMutation({
    args: {
        company: secCompanyMatchValidator,
        websiteUrl: v.string(),
        websiteUrlSource: v.union(
            v.literal("sec_ir"),
            v.literal("exa"),
            v.literal("probe"),
        ),
        providerCallId: v.id("providerCalls"),
        status: v.union(v.literal("succeeded"), v.literal("partial")),
        latencyMs: v.number(),
        accepted: v.number(),
        rejected: v.number(),
        searchTime: v.optional(v.number()),
        reportedCost: v.optional(v.number()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const now = Date.now();
        const providerCall = await ctx.db.get(args.providerCallId);
        if (
            providerCall?.service !== "exa" ||
            providerCall.operation !== "resolve_company_website" ||
            providerCall.status !== "started" ||
            (providerCall.leaseExpiresAt !== undefined &&
                providerCall.leaseExpiresAt <= now)
        ) {
            throw new Error("Website provider lease is no longer active");
        }
        requireCompanyWebsiteUrl(args.websiteUrl);
        const existing = await ctx.db
            .query("companies")
            .withIndex("by_cik", (query) => query.eq("cik", args.company.cik))
            .unique();
        if (existing) {
            await ctx.db.patch(existing._id, {
                ...args.company,
                websiteUrl: args.websiteUrl,
                websiteUrlSource: args.websiteUrlSource,
                websiteResolvedAt: now,
                canonicalizedAt: now,
            });
        } else {
            await ctx.db.insert("companies", {
                ...args.company,
                websiteUrl: args.websiteUrl,
                websiteUrlSource: args.websiteUrlSource,
                websiteResolvedAt: now,
                canonicalizedAt: now,
            });
        }
        await patchQualificationReceipt(ctx, providerCall, {
            status: args.status,
            latencyMs: args.latencyMs,
            usage: {
                accepted: args.accepted,
                rejected: args.rejected,
                searchTime: args.searchTime,
            },
            reportedCost: args.reportedCost,
            completedAt: now,
        });
        return null;
    },
});

/** Resolves cached or bounded Exa website metadata without blocking SEC. */
async function resolveWebsiteForCompany(
    ctx: ActionCtx,
    authUserId: Id<"users">,
    company: SecCompanyMatch,
): Promise<{ url: string; source: "sec_ir" | "exa" | "probe" } | null> {
    const cache = await ctx.runQuery(
        internal.companyResolution.getWebsiteCacheByCik,
        { cik: company.cik },
    );
    const cachedResolution = cache
        ? {
              url: cache.websiteUrl,
              source: cache.websiteUrlSource ?? ("exa" as const),
          }
        : null;
    if (
        cachedResolution &&
        (cache?.websiteResolvedAt === undefined ||
            cache.websiteResolvedAt > Date.now() - WEBSITE_CACHE_TTL_MS)
    ) {
        return cachedResolution;
    }
    const secWebsite = classifyIrAsWebsite(company.investorRelationsUrl);
    if (secWebsite) {
        return { url: secWebsite, source: "sec_ir" };
    }
    const adapter = configuredExaWebsiteSearch();
    if (!adapter) {
        return cachedResolution;
    }
    try {
        await ctx.runMutation(
            internal.providerCalls.reserveExaWebsiteRateLimit,
            { authUserId },
        );
    } catch {
        return cachedResolution;
    }
    const operationKey = `company:${company.cik}:resolver:${WEBSITE_RESOLVER_VERSION}:window:${Math.floor(Date.now() / WEBSITE_CACHE_TTL_MS)}`;
    let lease: {
        providerCallId: Id<"providerCalls">;
        shouldExecute: boolean;
        status: "started" | "succeeded" | "partial" | "failed";
    };
    try {
        lease = await ctx.runMutation(internal.providerCalls.recordAttempt, {
            service: "exa",
            operation: "resolve_company_website",
            operationKey,
            status: "started",
            attempt: 1,
        });
    } catch {
        return cachedResolution;
    }
    if (!lease.shouldExecute) {
        const replayedCache = await ctx.runQuery(
            internal.companyResolution.getWebsiteCacheByCik,
            { cik: company.cik },
        );
        return replayedCache
            ? {
                  url: replayedCache.websiteUrl,
                  source: replayedCache.websiteUrlSource ?? ("exa" as const),
              }
            : cachedResolution;
    }

    const startedAt = Date.now();
    try {
        const batch = await withWebsiteTimeout(
            adapter.search(`${company.legalName} official website`),
        );
        const resolution = await resolveWebsiteUrl(
            {
                legalName: company.legalName,
                ticker: company.ticker,
                investorRelationsUrl: undefined,
            },
            {
                exaSearch: async () => batch.candidates,
                classifyIr: () => undefined,
            },
        );
        if (!resolution) {
            await ctx.runMutation(internal.providerCalls.recordAttempt, {
                service: "exa",
                operation: "resolve_company_website",
                operationKey,
                status: "failed",
                attempt: 1,
                latencyMs: Date.now() - startedAt,
                usage: {
                    accepted: batch.candidates.length,
                    rejected: batch.rejected,
                    searchTime: batch.searchTime,
                },
                reportedCost: batch.costDollars,
                errorCode:
                    batch.candidates.length === 0 && batch.rejected > 0
                        ? "invalid_provider_response"
                        : "website_not_resolved",
            });
            return cachedResolution;
        }
        await ctx.runMutation(
            internal.companyResolution.persistWebsiteResolution,
            {
                company,
                websiteUrl: resolution.url,
                websiteUrlSource: resolution.source,
                providerCallId: lease.providerCallId,
                status: batch.rejected > 0 ? "partial" : "succeeded",
                latencyMs: Date.now() - startedAt,
                accepted: batch.candidates.length,
                rejected: batch.rejected,
                searchTime: batch.searchTime,
                reportedCost: batch.costDollars,
            },
        );
        return resolution;
    } catch (error) {
        try {
            await ctx.runMutation(internal.providerCalls.recordAttempt, {
                service: "exa",
                operation: "resolve_company_website",
                operationKey,
                status: "failed",
                attempt: 1,
                latencyMs: Date.now() - startedAt,
                errorCode:
                    error instanceof Error
                        ? error.name
                        : "UnknownProviderError",
            });
        } catch {
            // A terminal provider record from another replay wins.
        }
        return cachedResolution;
    }
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
        const company = mergeRunCompanyMetadata(
            run.companySnapshot,
            await ctx.db.get(run.companyId),
        );
        if (!company) {
            throw new Error("Confirmed company was not found");
        }
        return {
            executionGeneration: run.executionGeneration,
            company: {
                cik: company.cik,
                legalName: company.legalName,
                ticker: company.ticker,
                exchange: company.exchange,
                investorRelationsUrl: company.investorRelationsUrl,
                websiteUrl: company.websiteUrl,
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
        const knownCompany = mergeRunCompanyMetadata(
            run.companySnapshot,
            company,
        );
        if (knownCompany?.cik === args.resolved.cik && company) {
            const now = Date.now();
            const companyMetadata = {
                ...args.resolved,
                websiteUrl: args.resolved.websiteUrl ?? knownCompany.websiteUrl,
                websiteUrlSource:
                    args.resolved.websiteUrlSource ??
                    knownCompany.websiteUrlSource,
                investorRelationsUrl:
                    args.resolved.investorRelationsUrl ??
                    knownCompany.investorRelationsUrl,
            };
            if (companyMetadata.websiteUrl !== undefined)
                requireCompanyWebsiteUrl(companyMetadata.websiteUrl);
            const websiteResolvedAt =
                company.websiteUrl === companyMetadata.websiteUrl &&
                company.websiteResolvedAt !== undefined
                    ? company.websiteResolvedAt
                    : companyMetadata.websiteUrl
                      ? now
                      : undefined;
            await ctx.db.patch(company._id, {
                ...companyMetadata,
                websiteResolvedAt,
                canonicalizedAt: now,
            });
            await ctx.db.patch(run._id, {
                companySnapshot: companyMetadata,
                updatedAt: now,
            });
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
        const simulation = await ctx.runQuery(
            internal.sourcesSimulation.enabled,
            args,
        );
        if (simulation) {
            const valid = await ctx.runMutation(
                internal.companyResolution.verifyRevalidation,
                {
                    runId: args.runId,
                    executionGeneration: current.executionGeneration,
                    resolved: current.company,
                },
            );
            if (!valid) throw new Error("Confirmed company identity changed");
            return {
                cik: current.company.cik,
                secFilingCount: 0,
                investorRelationsPresent: true,
                filings: [],
            };
        }
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
