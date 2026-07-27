import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
    type ActionCtx,
    action,
    internalAction,
    internalMutation,
    internalQuery,
} from './_generated/server';
import { companySnapshotValidator } from './domain/validators';
import { createSecCompanyResolver } from './integrations/sec';

const secCompanyMatchValidator = companySnapshotValidator;

export type SecCompanyMatch = {
    cik: string;
    legalName: string;
    ticker: string;
    exchange: string;
    investorRelationsUrl?: string;
};

export interface SecCompanyResolver {
    search(query: string): Promise<ReadonlyArray<SecCompanyMatch>>;
    revalidate(cik: string): Promise<SecCompanyMatch>;
}

export type CompanyPreflightResult<
    PreflightId extends string = Id<'companyPreflights'>,
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
const RESOLVER_VERSION = 'sec-company-v2';

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
        throw new Error('Company query must contain 1 to 160 characters');
    }
    return dependencies.resolver.search(query);
}

/**
 * Revalidates an explicitly selected CIK and persists an expiring confirmation
 * token without reserving quota or starting durable work.
 */
export async function preflightCompanyWithResolver<PreflightId extends string>(
    args: { cik: string },
    dependencies: {
        resolver: SecCompanyResolver;
        now: () => number;
        persist: PersistPreflight<PreflightId>;
    },
): Promise<CompanyPreflightResult<PreflightId>> {
    const rawCik = args.cik.trim();
    if (!/^\d{1,10}$/.test(rawCik)) {
        throw new Error('Selected company must have a valid CIK');
    }
    const cik = rawCik.replace(/^0+/, '') || '0';
    const company = await dependencies.resolver.revalidate(cik);
    if (company.cik !== cik) {
        throw new Error('Selected company identity could not be verified');
    }
    return dependencies.persist({
        query: cik,
        company,
        expiresAt: dependencies.now() + PREFLIGHT_TTL_MS,
        resolverVersion: RESOLVER_VERSION,
    });
}

export const persistPreflight = internalMutation({
    args: {
        query: v.string(),
        company: secCompanyMatchValidator,
        expiresAt: v.number(),
        resolverVersion: v.string(),
    },
    returns: v.object({
        preflightId: v.id('companyPreflights'),
        company: secCompanyMatchValidator,
        expiresAt: v.number(),
    }),
    handler: async (ctx, args) => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            throw new Error('Not authenticated');
        }
        const visitor = await ctx.db
            .query('visitors')
            .withIndex('by_auth_user_id', (query) =>
                query.eq('authUserId', authUserId),
            )
            .unique();

        const now = Date.now();
        const existingCompany = await ctx.db
            .query('companies')
            .withIndex('by_cik', (query) => query.eq('cik', args.company.cik))
            .unique();
        const companyId = existingCompany
            ? existingCompany._id
            : await ctx.db.insert('companies', {
                  ...args.company,
                  canonicalizedAt: now,
              });
        if (existingCompany) {
            await ctx.db.patch(existingCompany._id, {
                ...args.company,
                canonicalizedAt: now,
            });
        }

        const preflightId = await ctx.db.insert('companyPreflights', {
            ownerAuthUserId: authUserId,
            ownerVisitorId:
                visitor?.status === 'active' ? visitor._id : undefined,
            query: args.query,
            companyId,
            companySnapshot: args.company,
            resolverVersion: args.resolverVersion,
            status: 'resolved',
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
        throw new Error('SEC company resolution is not configured');
    }
    return createSecCompanyResolver({
        fetch: globalThis.fetch,
        now: Date.now,
        userAgent,
        reserveRequest: async () => {
            const { scheduledAt } = await ctx.runMutation(
                internal.providerCalls.reserveSecRateLimit,
                { now: Date.now() },
            );
            const waitMs = Math.max(0, scheduledAt - Date.now());
            if (waitMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, waitMs));
            }
        },
        recordAttempt: async (attempt) => {
            const result = await ctx.runMutation(
                internal.providerCalls.recordAttempt,
                {
                    service: 'sec',
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
            throw new Error('Not authenticated');
        }
        return [
            ...(await searchCompaniesWithResolver(args, {
                resolver: createPublicCompanyResolver(
                    ctx,
                    `search:${authUserId}:${Date.now()}`,
                ),
            })),
        ];
    },
});

export const preflight = action({
    args: { cik: v.string() },
    returns: v.object({
        preflightId: v.id('companyPreflights'),
        company: secCompanyMatchValidator,
        expiresAt: v.number(),
    }),
    handler: async (ctx, args): Promise<CompanyPreflightResult> => {
        const authUserId = await getAuthUserId(ctx);
        if (!authUserId) {
            throw new Error('Not authenticated');
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
        });
    },
});

export const getRunCompany = internalQuery({
    args: { runId: v.id('researchRuns') },
    returns: v.object({
        executionGeneration: v.number(),
        company: secCompanyMatchValidator,
    }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (
            !run?.companyId ||
            run.executionStatus !== 'running' ||
            !['draft', 'checking_public_evidence'].includes(run.lifecycleState)
        ) {
            throw new Error('Research run has no confirmed company');
        }
        const company = await ctx.db.get(run.companyId);
        const snapshot = run.companySnapshot ?? company;
        if (!snapshot) {
            throw new Error('Confirmed company was not found');
        }
        return {
            executionGeneration: run.executionGeneration,
            company: {
                cik: snapshot.cik,
                legalName: snapshot.legalName,
                ticker: snapshot.ticker,
                exchange: snapshot.exchange,
                investorRelationsUrl: snapshot.investorRelationsUrl,
            },
        };
    },
});

export const verifyRevalidation = internalMutation({
    args: {
        runId: v.id('researchRuns'),
        executionGeneration: v.number(),
        resolved: secCompanyMatchValidator,
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (
            !run?.companyId ||
            run.executionGeneration !== args.executionGeneration ||
            run.executionStatus !== 'running'
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
            executionStatus: 'failed',
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: now,
        });
        await ctx.db.insert('runEvents', {
            runId: run._id,
            sequence: run.nextEventSequence + 1,
            type: 'run_failed',
            lifecycleState: run.lifecycleState,
            executionStatus: 'failed',
            failureCode: 'company_identity_mismatch',
            occurredAt: now,
        });
        return false;
    },
});

export const revalidateRun = internalAction({
    args: { runId: v.id('researchRuns') },
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
            throw new Error('SEC company resolution is not configured');
        }
        const resolver = createSecCompanyResolver({
            fetch: globalThis.fetch,
            now: Date.now,
            userAgent,
            reserveRequest: async () => {
                const { scheduledAt } = await ctx.runMutation(
                    internal.providerCalls.reserveSecRateLimit,
                    { now: Date.now() },
                );
                const waitMs = Math.max(0, scheduledAt - Date.now());
                if (waitMs > 0) {
                    await new Promise((resolve) => setTimeout(resolve, waitMs));
                }
            },
            recordAttempt: async (attempt) => {
                const result = await ctx.runMutation(
                    internal.providerCalls.recordAttempt,
                    {
                        runId: args.runId,
                        executionGeneration: current.executionGeneration,
                        workflowVersion: 2,
                        stepKey: 'check_public_evidence',
                        service: 'sec',
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
            throw new Error('Confirmed company identity changed');
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
