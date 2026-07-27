import schema from '@convex/schema';
import { makeFunctionReference } from 'convex/server';
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';

const modules = import.meta.glob('/convex/**/*.ts');
const getOperations = makeFunctionReference<
    'query',
    Record<string, never>,
    unknown
>('adminOperations:get');
const setPaidWorkEnabled = makeFunctionReference<
    'mutation',
    { enabled: boolean; reason: string },
    { enabled: boolean }
>('adminOperations:setPaidWorkEnabled');
const recordAttempt = makeFunctionReference<
    'mutation',
    {
        service: 'exa';
        operation: string;
        operationKey: string;
        status: 'started';
        attempt: number;
    },
    string
>('providerCalls:recordAttempt');

async function createVisitors(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
        const adminUserId = await ctx.db.insert('users', {
            isAnonymous: true,
        });
        const analystUserId = await ctx.db.insert('users', {
            isAnonymous: true,
        });
        const adminInvitationId = await ctx.db.insert('invitations', {
            slotKey: 'admin',
            role: 'admin',
            codeDigest: 'admin-ops',
            status: 'claimed',
            createdAt: 1,
        });
        const analystInvitationId = await ctx.db.insert('invitations', {
            slotKey: 'analyst',
            role: 'analyst',
            codeDigest: 'analyst-ops',
            status: 'claimed',
            createdAt: 1,
        });
        await ctx.db.insert('visitors', {
            authUserId: adminUserId,
            invitationId: adminInvitationId,
            role: 'admin',
            status: 'active',
            analysesReserved: 0,
            admittedAt: 1,
        });
        await ctx.db.insert('visitors', {
            authUserId: analystUserId,
            invitationId: analystInvitationId,
            role: 'analyst',
            status: 'active',
            analysesReserved: 1,
            admittedAt: 1,
        });
        return { adminUserId, analystUserId };
    });
}

test('admin controls paid work while analysts remain unauthorized', async () => {
    const t = convexTest(schema, modules);
    const { adminUserId, analystUserId } = await createVisitors(t);
    const admin = t.withIdentity({ subject: `${adminUserId}|admin-ops` });
    const analyst = t.withIdentity({
        subject: `${analystUserId}|analyst-ops`,
    });

    await expect(analyst.query(getOperations, {})).rejects.toThrow(
        'Unauthorized',
    );
    await expect(
        analyst.mutation(setPaidWorkEnabled, {
            enabled: false,
            reason: 'Provider spend must stop now.',
        }),
    ).rejects.toThrow('Unauthorized');
    await expect(
        admin.mutation(setPaidWorkEnabled, {
            enabled: false,
            reason: 'Provider spend must stop now.',
        }),
    ).resolves.toEqual({ enabled: false });
    await expect(admin.query(getOperations, {})).resolves.toMatchObject({
        paidWork: {
            enabled: false,
            reason: 'Provider spend must stop now.',
        },
    });
    await expect(
        t.mutation(recordAttempt, {
            service: 'exa',
            operation: 'search',
            operationKey: 'blocked-paid-step',
            status: 'started',
            attempt: 1,
        }),
    ).rejects.toThrow('Paid provider work is disabled');
    await expect(
        t.run(async (ctx) =>
            ctx.db
                .query('auditEvents')
                .filter((builder) =>
                    builder.eq(builder.field('action'), 'paid_work_toggled'),
                )
                .collect(),
        ),
    ).resolves.toHaveLength(1);
});
