import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';

async function requireAdmin(ctx: QueryCtx | MutationCtx) {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) {
        throw new Error('Not authenticated');
    }
    const visitor = await ctx.db
        .query('visitors')
        .withIndex('by_auth_user_id', (builder) =>
            builder.eq('authUserId', authUserId),
        )
        .unique();
    if (visitor?.status !== 'active' || visitor.role !== 'admin') {
        throw new Error('Unauthorized');
    }
    return visitor;
}

export const get = query({
    args: {},
    handler: async (ctx) => {
        await requireAdmin(ctx);
        const [runs, checkpoints, providerCalls, visitors, paidWork] =
            await Promise.all([
                ctx.db.query('researchRuns').collect(),
                ctx.db.query('checkpointDecisions').collect(),
                ctx.db.query('providerCalls').collect(),
                ctx.db.query('visitors').collect(),
                ctx.db
                    .query('paidWorkControls')
                    .withIndex('by_key', (builder) =>
                        builder.eq('key', 'global'),
                    )
                    .unique(),
            ]);
        return {
            paidWork: {
                enabled: paidWork?.enabled ?? true,
                reason: paidWork?.reason,
                updatedAt: paidWork?.updatedAt,
            },
            runs: runs
                .filter(({ executionStatus }) =>
                    ['running', 'paused', 'failed'].includes(executionStatus),
                )
                .sort((left, right) => right.updatedAt - left.updatedAt)
                .map((run) => ({
                    runId: run._id,
                    lifecycleState: run.lifecycleState,
                    executionStatus: run.executionStatus,
                    pauseReason: run.pauseReason,
                    updatedAt: run.updatedAt,
                })),
            checkpoints: checkpoints
                .sort((left, right) => right.occurredAt - left.occurredAt)
                .slice(0, 50)
                .map((checkpoint) => ({
                    runId: checkpoint.runId,
                    checkpoint: checkpoint.checkpoint,
                    decision: checkpoint.decision,
                    occurredAt: checkpoint.occurredAt,
                })),
            providerCalls: providerCalls
                .sort((left, right) => right.createdAt - left.createdAt)
                .slice(0, 50)
                .map((call) => ({
                    runId: call.runId,
                    service: call.service,
                    operation: call.operation,
                    status: call.status,
                    usage: call.usage,
                    reportedCost: call.reportedCost,
                    errorCode: call.errorCode,
                    createdAt: call.createdAt,
                })),
            reservations: visitors.map((visitor) => ({
                visitorId: visitor._id,
                role: visitor.role,
                remaining: Math.max(0, 3 - visitor.analysesReserved),
            })),
            restorableRuns: runs
                .filter(
                    (run) =>
                        run.lifecycleState === 'draft' &&
                        run.executionStatus === 'idle' &&
                        run.reservationStatus === 'consumed' &&
                        run.ownerVisitorId !== undefined,
                )
                .sort((left, right) => right.createdAt - left.createdAt)
                .map((run) => ({
                    runId: run._id,
                    ownerVisitorId: run.ownerVisitorId,
                    createdAt: run.createdAt,
                })),
        };
    },
});

export const setPaidWorkEnabled = mutation({
    args: { enabled: v.boolean(), reason: v.string() },
    returns: v.object({ enabled: v.boolean() }),
    handler: async (ctx, args) => {
        const admin = await requireAdmin(ctx);
        const reason = args.reason.trim();
        if (reason.length < 12 || reason.length > 500) {
            throw new Error(
                'Paid work changes require a reason of 12 to 500 characters',
            );
        }
        const existing = await ctx.db
            .query('paidWorkControls')
            .withIndex('by_key', (builder) => builder.eq('key', 'global'))
            .unique();
        const now = Date.now();
        if (existing) {
            await ctx.db.patch(existing._id, {
                enabled: args.enabled,
                updatedByVisitorId: admin._id,
                reason,
                updatedAt: now,
            });
        } else {
            await ctx.db.insert('paidWorkControls', {
                key: 'global',
                enabled: args.enabled,
                updatedByVisitorId: admin._id,
                reason,
                updatedAt: now,
            });
        }
        await ctx.db.insert('auditEvents', {
            actor: { type: 'visitor', visitorId: admin._id },
            action: 'paid_work_toggled',
            targetType: 'paid_work_control',
            targetId: 'global',
            reason,
            occurredAt: now,
        });
        return { enabled: args.enabled };
    },
});
