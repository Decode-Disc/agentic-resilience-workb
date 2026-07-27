import { digestInvitationCode } from '@convex/domain/invitationCodes';
import schema from '@convex/schema';
import { makeFunctionReference } from 'convex/server';
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';

const modules = import.meta.glob('/convex/**/*.ts');

type SeedEntry = {
    slotKey: string;
    role: 'admin' | 'analyst';
    codeDigest: string;
};

const seedInvitations = makeFunctionReference<
    'mutation',
    { invitations: Array<SeedEntry> },
    { created: number; total: number }
>('invitations:seedForSetup');
const bootstrapConfiguredInvitations = makeFunctionReference<
    'action',
    Record<string, never>,
    { created: number; total: number }
>('invitations:bootstrapConfigured');
const listInvitations = makeFunctionReference<
    'query',
    Record<string, never>,
    Array<unknown>
>('invitations:listForSetup');
const claimInvitation = makeFunctionReference<
    'action',
    { code: string },
    { visitorId: string; role: 'admin' | 'analyst' }
>('invitations:claim');
const currentVisitor = makeFunctionReference<
    'query',
    Record<string, never>,
    unknown
>('visitors:current');
const reserveAnalysis = makeFunctionReference<
    'mutation',
    { idempotencyKey: string },
    { runId: string; remainingAnalyses: number }
>('researchRuns:reserve');
const restoreQuota = makeFunctionReference<
    'mutation',
    { runId: string; reason: string },
    { restored: boolean }
>('admin:restoreQuota');
const listAuditEvents = makeFunctionReference<
    'query',
    { targetType: string; targetId: string },
    Array<unknown>
>('audit:listByTarget');
const rotateAdminInvitation = makeFunctionReference<
    'action',
    Record<string, never>,
    null
>('invitations:rotateAdminFromConfig');

const invitationCodes = ['1000', '2000', '3000', '4000', '5000'];
const invitationPepper = 'test-only-invitation-pepper';

async function buildInvitationSeed(): Promise<Array<SeedEntry>> {
    const roles = [
        'admin',
        'analyst',
        'analyst',
        'analyst',
        'analyst',
    ] as const;
    return Promise.all(
        invitationCodes.map(async (code, index) => ({
            slotKey: index === 0 ? 'admin' : `analyst-${index}`,
            role: roles[index] ?? 'analyst',
            codeDigest: await digestInvitationCode(code, invitationPepper),
        })),
    );
}

test('setup seeds exactly five invitation slots idempotently', async () => {
    const t = convexTest(schema, modules);
    const invitationSeed = await buildInvitationSeed();

    await expect(
        t.mutation(seedInvitations, { invitations: invitationSeed }),
    ).resolves.toEqual({
        created: 5,
        total: 5,
    });
    await expect(
        t.mutation(seedInvitations, { invitations: invitationSeed }),
    ).resolves.toEqual({
        created: 0,
        total: 5,
    });
    await expect(t.query(listInvitations, {})).resolves.toHaveLength(5);
});

test('the deployment bootstrap seeds configured invitations without exposing codes', async () => {
    const t = convexTest(schema, modules);
    process.env.INVITATION_CODE_PEPPER = invitationPepper;
    process.env.INVITATION_SEED_CONFIG = JSON.stringify([
        { slotKey: 'admin', role: 'admin', code: '1000' },
        {
            slotKey: 'analyst-1',
            role: 'analyst',
            code: '2000',
        },
        {
            slotKey: 'analyst-2',
            role: 'analyst',
            code: '3000',
        },
        {
            slotKey: 'analyst-3',
            role: 'analyst',
            code: '4000',
        },
        {
            slotKey: 'analyst-4',
            role: 'analyst',
            code: '5000',
        },
    ]);

    await expect(t.action(bootstrapConfiguredInvitations, {})).resolves.toEqual(
        {
            created: 5,
            total: 5,
        },
    );
    await expect(t.action(bootstrapConfiguredInvitations, {})).resolves.toEqual(
        {
            created: 0,
            total: 5,
        },
    );
});

test('the deployment bootstrap rotates configured OTPs without recreating invitation slots', async () => {
    const t = convexTest(schema, modules);
    process.env.INVITATION_CODE_PEPPER = invitationPepper;
    process.env.INVITATION_SEED_CONFIG = JSON.stringify([
        { slotKey: 'admin', role: 'admin', code: '1000' },
        { slotKey: 'analyst-1', role: 'analyst', code: '2000' },
        { slotKey: 'analyst-2', role: 'analyst', code: '3000' },
        { slotKey: 'analyst-3', role: 'analyst', code: '4000' },
        { slotKey: 'analyst-4', role: 'analyst', code: '5000' },
    ]);
    await t.action(bootstrapConfiguredInvitations, {});

    process.env.INVITATION_SEED_CONFIG = JSON.stringify([
        { slotKey: 'admin', role: 'admin', code: '1111' },
        { slotKey: 'analyst-1', role: 'analyst', code: '2222' },
        { slotKey: 'analyst-2', role: 'analyst', code: '3333' },
        { slotKey: 'analyst-3', role: 'analyst', code: '4444' },
        { slotKey: 'analyst-4', role: 'analyst', code: '5555' },
    ]);

    await expect(t.action(bootstrapConfiguredInvitations, {})).resolves.toEqual(
        {
            created: 0,
            total: 5,
        },
    );

    const userId = await t.run((ctx) =>
        ctx.db.insert('users', { isAnonymous: true }),
    );
    const user = t.withIdentity({ subject: `${userId}|rotated-session` });
    await expect(
        user.action(claimInvitation, { code: '2222' }),
    ).resolves.toMatchObject({ role: 'analyst' });
});

test('an authenticated user claims one invitation exactly once', async () => {
    const t = convexTest(schema, modules);
    process.env.INVITATION_CODE_PEPPER = invitationPepper;
    const invitationSeed = await buildInvitationSeed();
    await t.mutation(seedInvitations, { invitations: invitationSeed });
    const firstUserId = await t.run((ctx) =>
        ctx.db.insert('users', { isAnonymous: true }),
    );
    const secondUserId = await t.run((ctx) =>
        ctx.db.insert('users', { isAnonymous: true }),
    );
    const firstUser = t.withIdentity({ subject: `${firstUserId}|session-1` });
    const secondUser = t.withIdentity({ subject: `${secondUserId}|session-2` });

    await expect(
        firstUser.action(claimInvitation, { code: invitationCodes[1] ?? '' }),
    ).resolves.toMatchObject({
        role: 'analyst',
    });
    await expect(firstUser.query(currentVisitor, {})).resolves.toMatchObject({
        authUserId: firstUserId,
        role: 'analyst',
        status: 'active',
    });
    const resumedSession = t.withIdentity({
        subject: `${firstUserId}|session-3`,
    });
    await expect(
        resumedSession.query(currentVisitor, {}),
    ).resolves.toMatchObject({
        authUserId: firstUserId,
        status: 'active',
    });
    await expect(
        secondUser.action(claimInvitation, { code: invitationCodes[1] ?? '' }),
    ).rejects.toThrow('Invitation is not available');
});

test('invitation claims reject values outside the four-digit OTP contract', async () => {
    const t = convexTest(schema, modules);
    process.env.INVITATION_CODE_PEPPER = invitationPepper;
    const userId = await t.run((ctx) =>
        ctx.db.insert('users', { isAnonymous: true }),
    );
    const user = t.withIdentity({ subject: `${userId}|session` });

    await expect(
        user.action(claimInvitation, { code: '12345' }),
    ).rejects.toThrow('Invitation code must contain exactly four digits');
});

test('invitation claims lock one anonymous session after five failed OTP attempts', async () => {
    const t = convexTest(schema, modules);
    process.env.INVITATION_CODE_PEPPER = invitationPepper;
    await t.mutation(seedInvitations, {
        invitations: await buildInvitationSeed(),
    });
    const userId = await t.run((ctx) =>
        ctx.db.insert('users', { isAnonymous: true }),
    );
    const user = t.withIdentity({ subject: `${userId}|session` });

    for (const code of ['0101', '0102', '0103', '0104', '0105']) {
        await expect(user.action(claimInvitation, { code })).rejects.toThrow(
            'Invitation is not available',
        );
    }

    await expect(
        user.action(claimInvitation, { code: invitationCodes[1] ?? '' }),
    ).rejects.toThrow('Too many invitation attempts');
});

test('an admitted visitor atomically reserves at most three analyses', async () => {
    const t = convexTest(schema, modules);
    process.env.INVITATION_CODE_PEPPER = invitationPepper;
    const invitationSeed = await buildInvitationSeed();
    await t.mutation(seedInvitations, { invitations: invitationSeed });
    const userId = await t.run((ctx) =>
        ctx.db.insert('users', { isAnonymous: true }),
    );
    const visitor = t.withIdentity({ subject: `${userId}|session` });
    await visitor.action(claimInvitation, { code: invitationCodes[2] ?? '' });

    const reservations = await Promise.all(
        ['run-a', 'run-b', 'run-c'].map((idempotencyKey) =>
            visitor.mutation(reserveAnalysis, { idempotencyKey }),
        ),
    );

    expect(
        reservations.map((reservation) => reservation.remainingAnalyses).sort(),
    ).toEqual([0, 1, 2]);
    await expect(
        visitor.mutation(reserveAnalysis, { idempotencyKey: 'run-a' }),
    ).resolves.toEqual({
        runId: reservations[0]?.runId,
        remainingAnalyses: 0,
    });
    await expect(
        visitor.mutation(reserveAnalysis, { idempotencyKey: 'run-d' }),
    ).rejects.toThrow('Analysis limit reached');
});

test('the invited admin restores an unused reservation with an audited reason', async () => {
    const t = convexTest(schema, modules);
    process.env.INVITATION_CODE_PEPPER = invitationPepper;
    const invitationSeed = await buildInvitationSeed();
    await t.mutation(seedInvitations, { invitations: invitationSeed });
    const adminUserId = await t.run((ctx) =>
        ctx.db.insert('users', { isAnonymous: true }),
    );
    const analystUserId = await t.run((ctx) =>
        ctx.db.insert('users', { isAnonymous: true }),
    );
    const admin = t.withIdentity({ subject: `${adminUserId}|admin-session` });
    const analyst = t.withIdentity({
        subject: `${analystUserId}|analyst-session`,
    });
    await admin.action(claimInvitation, { code: invitationCodes[0] ?? '' });
    await analyst.action(claimInvitation, { code: invitationCodes[3] ?? '' });
    const reserved = await analyst.mutation(reserveAnalysis, {
        idempotencyKey: 'restorable-run',
    });

    await expect(
        admin.mutation(restoreQuota, {
            runId: reserved.runId,
            reason: 'The run was abandoned before workflow launch',
        }),
    ).resolves.toEqual({ restored: true });
    await expect(
        t.query(listAuditEvents, {
            targetType: 'research_run',
            targetId: reserved.runId,
        }),
    ).resolves.toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                action: 'quota_restored',
                reason: 'The run was abandoned before workflow launch',
            }),
        ]),
    );
    await expect(
        analyst.mutation(reserveAnalysis, {
            idempotencyKey: 'replacement-run',
        }),
    ).resolves.toMatchObject({ remainingAnalyses: 2 });
});

test('the break-glass path revokes a lost admin session before reissuing its slot', async () => {
    const t = convexTest(schema, modules);
    process.env.INVITATION_CODE_PEPPER = invitationPepper;
    process.env.INVITATION_ADMIN_RECOVERY_CODE = '9000';
    const invitationSeed = await buildInvitationSeed();
    await t.mutation(seedInvitations, { invitations: invitationSeed });
    const oldAdminUserId = await t.run((ctx) =>
        ctx.db.insert('users', { isAnonymous: true }),
    );
    const newAdminUserId = await t.run((ctx) =>
        ctx.db.insert('users', { isAnonymous: true }),
    );
    const oldAdmin = t.withIdentity({
        subject: `${oldAdminUserId}|old-admin-session`,
    });
    const newAdmin = t.withIdentity({
        subject: `${newAdminUserId}|new-admin-session`,
    });
    await oldAdmin.action(claimInvitation, { code: invitationCodes[0] ?? '' });

    await t.action(rotateAdminInvitation, {});

    await expect(oldAdmin.query(currentVisitor, {})).resolves.toMatchObject({
        status: 'revoked',
    });
    await expect(
        newAdmin.action(claimInvitation, {
            code: '9000',
        }),
    ).resolves.toMatchObject({ role: 'admin' });
});
