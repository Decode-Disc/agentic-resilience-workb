import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalMutation, internalQuery } from './_generated/server';
import { coveragePresetValidator } from './domain/validators';
import { workflow } from './workflow';

const MAX_ANALYSES_PER_VISITOR = 3;
const preparedManualSourceValidator = v.object({
    canonicalUrl: v.string(),
    title: v.string(),
    providerReference: v.string(),
});

export const authorizeLaunchPreparation = internalQuery({
    args: {
        preflightId: v.id('companyPreflights'),
        idempotencyKey: v.string(),
    },
    returns: v.object({ shouldPrepareManualSources: v.boolean() }),
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
        if (visitor?.status !== 'active') {
            throw new Error('Unauthorized');
        }
        const idempotencyKey = args.idempotencyKey.trim();
        if (idempotencyKey.length === 0 || idempotencyKey.length > 128) {
            throw new Error('Invalid idempotency key');
        }
        const existing = await ctx.db
            .query('researchRuns')
            .withIndex('by_owner_and_reservation_key', (query) =>
                query
                    .eq('ownerVisitorId', visitor._id)
                    .eq('reservationKey', idempotencyKey),
            )
            .unique();
        if (existing) {
            if (existing.companyPreflightId !== args.preflightId) {
                throw new Error(
                    'Idempotency key belongs to another company preflight',
                );
            }
            return { shouldPrepareManualSources: false };
        }
        const running = await ctx.db
            .query('researchRuns')
            .withIndex('by_owner_and_execution_status', (query) =>
                query
                    .eq('ownerVisitorId', visitor._id)
                    .eq('executionStatus', 'running'),
            )
            .first();
        if (running) {
            throw new Error('A research workflow is already running');
        }
        if (visitor.analysesReserved >= MAX_ANALYSES_PER_VISITOR) {
            throw new Error('Analysis limit reached');
        }
        const preflight = await ctx.db.get(args.preflightId);
        const belongsToSession =
            preflight?.ownerAuthUserId !== undefined
                ? preflight.ownerAuthUserId === authUserId
                : preflight?.ownerVisitorId === visitor._id;
        if (
            !preflight ||
            !belongsToSession ||
            preflight.status !== 'resolved'
        ) {
            throw new Error('Company preflight is not available');
        }
        if (preflight.expiresAt <= Date.now()) {
            throw new Error('Company preflight has expired');
        }
        if (!(await ctx.db.get(preflight.companyId))) {
            throw new Error('Resolved company was not found');
        }
        return { shouldPrepareManualSources: true };
    },
});

export const confirmAndStartReserved = internalMutation({
    args: {
        preflightId: v.id('companyPreflights'),
        idempotencyKey: v.string(),
        coveragePreset: coveragePresetValidator,
        researchAngle: v.optional(v.string()),
        manualSources: v.optional(v.array(preparedManualSourceValidator)),
    },
    returns: v.object({
        runId: v.id('researchRuns'),
        remainingAnalyses: v.number(),
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
        if (visitor?.status !== 'active') {
            throw new Error('Unauthorized');
        }

        const idempotencyKey = args.idempotencyKey.trim();
        if (idempotencyKey.length === 0 || idempotencyKey.length > 128) {
            throw new Error('Invalid idempotency key');
        }
        const researchAngle = args.researchAngle?.trim();
        if (researchAngle && researchAngle.length > 500) {
            throw new Error('Research angle cannot exceed 500 characters');
        }

        const existing = await ctx.db
            .query('researchRuns')
            .withIndex('by_owner_and_reservation_key', (query) =>
                query
                    .eq('ownerVisitorId', visitor._id)
                    .eq('reservationKey', idempotencyKey),
            )
            .unique();
        if (existing) {
            if (existing.companyPreflightId !== args.preflightId) {
                throw new Error(
                    'Idempotency key belongs to another company preflight',
                );
            }
            return {
                runId: existing._id,
                remainingAnalyses:
                    MAX_ANALYSES_PER_VISITOR - visitor.analysesReserved,
            };
        }

        const running = await ctx.db
            .query('researchRuns')
            .withIndex('by_owner_and_execution_status', (query) =>
                query
                    .eq('ownerVisitorId', visitor._id)
                    .eq('executionStatus', 'running'),
            )
            .first();
        if (running) {
            throw new Error('A research workflow is already running');
        }
        if (visitor.analysesReserved >= MAX_ANALYSES_PER_VISITOR) {
            throw new Error('Analysis limit reached');
        }

        const preflight = await ctx.db.get(args.preflightId);
        const now = Date.now();
        const preflightBelongsToSession =
            preflight?.ownerAuthUserId !== undefined
                ? preflight.ownerAuthUserId === authUserId
                : preflight?.ownerVisitorId === visitor._id;
        if (
            !preflight ||
            !preflightBelongsToSession ||
            preflight.status !== 'resolved'
        ) {
            throw new Error('Company preflight is not available');
        }
        if (preflight.expiresAt <= now) {
            throw new Error('Company preflight has expired');
        }
        const company = await ctx.db.get(preflight.companyId);
        if (!company) {
            throw new Error('Resolved company was not found');
        }
        const companySnapshot = preflight.companySnapshot ?? {
            cik: company.cik,
            legalName: company.legalName,
            ticker: company.ticker,
            exchange: company.exchange,
            investorRelationsUrl: company.investorRelationsUrl,
            websiteUrl: company.websiteUrl,
            websiteUrlSource: company.websiteUrlSource,
        };

        const runId = await ctx.db.insert('researchRuns', {
            ownerVisitorId: visitor._id,
            reservationKey: idempotencyKey,
            reservationStatus: 'consumed',
            companyId: company._id,
            companySnapshot,
            companyPreflightId: preflight._id,
            coveragePreset: args.coveragePreset,
            researchAngle: researchAngle || undefined,
            lifecycleState: 'draft',
            executionStatus: 'running',
            executionGeneration: 1,
            nextEventSequence: 2,
            workflowVersion: 2,
            retryCount: 0,
            createdAt: now,
            updatedAt: now,
        });
        const corpusRevisionId = await ctx.db.insert('corpusRevisions', {
            runId,
            revision: 1,
            status: 'draft',
            createdAt: now,
        });
        for (const manualSource of args.manualSources ?? []) {
            const sourceId = await ctx.db.insert('sources', {
                runId,
                canonicalUrl: manualSource.canonicalUrl,
                title: manualSource.title,
                origin: 'analyst_url',
                category: 'analyst_supplied',
                providerReference: manualSource.providerReference,
                createdAt: now,
            });
            await ctx.db.insert('sourceDecisions', {
                runId,
                corpusRevisionId,
                sourceId,
                decisionKey: `manual:${sourceId}`,
                decision: 'pending',
                reviewerVisitorId: visitor._id,
                occurredAt: now,
            });
            await ctx.db.insert('auditEvents', {
                actor: { type: 'visitor', visitorId: visitor._id },
                action: 'manual_source_added',
                targetType: 'source',
                targetId: sourceId,
                occurredAt: now,
            });
        }
        const workflowId = await workflow.start(
            ctx,
            internal.researchWorkflow.run,
            { runId },
            {
                onComplete: internal.researchWorkflow.onComplete,
                context: { runId },
            },
        );
        await ctx.db.patch(runId, {
            activeCorpusRevisionId: corpusRevisionId,
            workflowId,
        });
        await ctx.db.patch(preflight._id, {
            ownerVisitorId: visitor._id,
            status: 'consumed',
        });
        await ctx.db.patch(visitor._id, {
            analysesReserved: visitor.analysesReserved + 1,
        });
        await ctx.db.insert('runEvents', {
            runId,
            sequence: 1,
            type: 'run_created',
            lifecycleState: 'draft',
            executionStatus: 'running',
            occurredAt: now,
        });
        await ctx.db.insert('runEvents', {
            runId,
            sequence: 2,
            type: 'company_confirmed',
            lifecycleState: 'draft',
            executionStatus: 'running',
            occurredAt: now,
        });
        await ctx.db.insert('auditEvents', {
            actor: { type: 'visitor', visitorId: visitor._id },
            action: 'analysis_reserved',
            targetType: 'research_run',
            targetId: runId,
            occurredAt: now,
        });
        await ctx.db.insert('auditEvents', {
            actor: { type: 'visitor', visitorId: visitor._id },
            action: 'company_confirmed',
            targetType: 'research_run',
            targetId: runId,
            occurredAt: now,
        });
        return {
            runId,
            remainingAnalyses:
                MAX_ANALYSES_PER_VISITOR - (visitor.analysesReserved + 1),
        };
    },
});

export const confirmAndStart = action({
    args: {
        preflightId: v.id('companyPreflights'),
        idempotencyKey: v.string(),
        coveragePreset: coveragePresetValidator,
        researchAngle: v.optional(v.string()),
        manualSourceUrls: v.optional(v.array(v.string())),
    },
    returns: v.object({
        runId: v.id('researchRuns'),
        remainingAnalyses: v.number(),
    }),
    handler: async (
        ctx,
        args,
    ): Promise<{
        runId: Id<'researchRuns'>;
        remainingAnalyses: number;
    }> => {
        let manualSources:
            | Array<{
                  canonicalUrl: string;
                  title: string;
                  providerReference: string;
              }>
            | undefined;
        if (args.manualSourceUrls && args.manualSourceUrls.length > 0) {
            const preparation = await ctx.runQuery(
                internal.researchLaunch.authorizeLaunchPreparation,
                {
                    preflightId: args.preflightId,
                    idempotencyKey: args.idempotencyKey,
                },
            );
            if (preparation.shouldPrepareManualSources) {
                manualSources = await ctx.runAction(
                    internal.sourceActions.prepareLaunchUrls,
                    {
                        idempotencyKey: args.idempotencyKey,
                        urls: args.manualSourceUrls,
                    },
                );
            }
        }
        return ctx.runMutation(
            internal.researchLaunch.confirmAndStartReserved,
            {
                preflightId: args.preflightId,
                idempotencyKey: args.idempotencyKey,
                coveragePreset: args.coveragePreset,
                researchAngle: args.researchAngle,
                manualSources,
            },
        );
    },
});
