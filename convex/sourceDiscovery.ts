import { v } from 'convex/values';

import { internalMutation, internalQuery } from './_generated/server';

const candidateValidator = v.object({
    canonicalUrl: v.string(),
    title: v.string(),
    origin: v.union(v.literal('sec'), v.literal('exa')),
    category: v.string(),
    publishedAt: v.optional(v.number()),
    providerReference: v.optional(v.string()),
});

export const persistCandidates = internalMutation({
    args: {
        runId: v.id('researchRuns'),
        corpusRevisionId: v.id('corpusRevisions'),
        executionGeneration: v.number(),
        operationKey: v.string(),
        candidates: v.array(candidateValidator),
    },
    returns: v.object({ inserted: v.number(), total: v.number() }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        const revision = await ctx.db.get(args.corpusRevisionId);
        if (
            !run ||
            run.executionGeneration !== args.executionGeneration ||
            run.executionStatus !== 'running' ||
            run.lifecycleState !== 'discovering_sources' ||
            run.activeCorpusRevisionId !== args.corpusRevisionId ||
            revision?.runId !== run._id ||
            revision.status !== 'draft'
        ) {
            throw new Error('Research execution is no longer active');
        }

        let inserted = 0;
        const seen = new Set<string>();
        const now = Date.now();
        for (const candidate of args.candidates) {
            if (seen.has(candidate.canonicalUrl)) {
                continue;
            }
            seen.add(candidate.canonicalUrl);
            const existing = await ctx.db
                .query('sources')
                .withIndex('by_run_and_url', (query) =>
                    query
                        .eq('runId', run._id)
                        .eq('canonicalUrl', candidate.canonicalUrl),
                )
                .unique();
            if (existing) {
                continue;
            }
            const sourceId = await ctx.db.insert('sources', {
                runId: run._id,
                ...candidate,
                createdAt: now,
            });
            await ctx.db.insert('sourceDecisions', {
                runId: run._id,
                corpusRevisionId: revision._id,
                sourceId,
                decisionKey: `${args.operationKey}:${candidate.canonicalUrl}`,
                decision: 'pending',
                occurredAt: now,
            });
            inserted += 1;
        }
        const total = (
            await ctx.db
                .query('sources')
                .withIndex('by_run_and_url', (query) =>
                    query.eq('runId', run._id),
                )
                .collect()
        ).length;
        await ctx.db.patch(run._id, {
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: now,
        });
        await ctx.db.insert('runEvents', {
            runId: run._id,
            sequence: run.nextEventSequence + 1,
            type: 'source_discovery_progress',
            lifecycleState: run.lifecycleState,
            executionStatus: run.executionStatus,
            stepKey: 'discover_sources',
            messageKey: 'source_candidates_persisted',
            current: total,
            occurredAt: now,
        });
        return { inserted, total };
    },
});

export const countCandidates = internalQuery({
    args: {
        runId: v.id('researchRuns'),
        executionGeneration: v.number(),
    },
    returns: v.object({ total: v.number() }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (
            !run ||
            run.executionGeneration !== args.executionGeneration ||
            run.executionStatus !== 'running' ||
            run.lifecycleState !== 'discovering_sources'
        ) {
            throw new Error('Research execution is no longer active');
        }
        const sources = await ctx.db
            .query('sources')
            .withIndex('by_run_and_url', (query) => query.eq('runId', run._id))
            .collect();
        return { total: sources.length };
    },
});

export const isExecutionActive = internalQuery({
    args: {
        runId: v.id('researchRuns'),
        executionGeneration: v.number(),
    },
    returns: v.boolean(),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        return (
            run?.executionGeneration === args.executionGeneration &&
            run.executionStatus === 'running' &&
            run.lifecycleState === 'discovering_sources'
        );
    },
});
